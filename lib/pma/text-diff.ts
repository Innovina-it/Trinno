// U5 (revision delta) — a small, dependency-free line diff. Purpose-built for
// feeding Gemini a VERIFIED "what changed" block (old revision text → current
// text), so the recap stops inferring changes from current content alone.
//
// Classic LCS over line hashes with a size guard: project docs export to a few
// thousand lines at most, well inside the DP budget; anything bigger degrades
// gracefully to a counts-only summary (never an OOM, never a crash).

export type LineDiff = {
  added: number;
  removed: number;
  // Unified-style hunks: "+ line" / "- line" with 2 lines of context. Empty
  // when the texts are identical.
  text: string;
  truncated: boolean;
};

const MAX_DP_CELLS = 4_000_000; // ~2000×2000 lines — beyond this, summarize.
const CONTEXT = 2;

const splitLines = (s: string): string[] =>
  s.replace(/\r\n?/g, "\n").split("\n");

export function diffLines(
  oldText: string,
  newText: string,
  maxChars = 12_000,
): LineDiff {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Trim the common prefix/suffix first — cheap, and it usually shrinks the DP
  // problem dramatically for document edits.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length === 0 && midB.length === 0) {
    return { added: 0, removed: 0, text: "", truncated: false };
  }

  // Size guard: fall back to a set-based summary (still grounded, just coarser).
  if (midA.length * midB.length > MAX_DP_CELLS) {
    const oldSet = new Set(midA);
    const newSet = new Set(midB);
    const added = midB.filter((l) => !oldSet.has(l));
    const removed = midA.filter((l) => !newSet.has(l));
    const sample = [
      ...added.slice(0, 40).map((l) => `+ ${l}`),
      ...removed.slice(0, 40).map((l) => `- ${l}`),
    ]
      .join("\n")
      .slice(0, maxChars);
    return {
      added: added.length,
      removed: removed.length,
      text: `(diff too large for exact hunks — line-level summary)\n${sample}`,
      truncated: true,
    };
  }

  // LCS DP over the middle section.
  const n = midA.length;
  const m = midB.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] =
        midA[i] === midB[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  // Walk the table into an op list over the middle section.
  type Op = { kind: " " | "+" | "-"; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      ops.push({ kind: " ", line: midA[i] });
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      ops.push({ kind: "-", line: midA[i] });
      i++;
    } else {
      ops.push({ kind: "+", line: midB[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "-", line: midA[i++] });
  while (j < m) ops.push({ kind: "+", line: midB[j++] });

  // Render with CONTEXT lines around changes; the trimmed prefix/suffix stay out.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.kind === " ") return;
    for (let k = Math.max(0, idx - CONTEXT); k <= Math.min(ops.length - 1, idx + CONTEXT); k++) {
      keep[k] = true;
    }
  });
  const parts: string[] = [];
  // Re-attach up to CONTEXT lines of the trimmed common prefix (with an elision
  // marker for anything beyond), so a hunk at the top of the changed region
  // still shows where in the document it sits.
  if (start > CONTEXT) parts.push("  […]");
  for (const line of a.slice(Math.max(0, start - CONTEXT), start)) {
    parts.push(`  ${line}`);
  }
  let inGap = false;
  for (let k = 0; k < ops.length; k++) {
    if (!keep[k]) {
      if (!inGap) {
        parts.push("  […]");
        inGap = true;
      }
      continue;
    }
    inGap = false;
    parts.push(`${ops[k].kind} ${ops[k].line}`);
  }
  // Same for the trimmed common suffix.
  for (const line of a.slice(endA, Math.min(a.length, endA + CONTEXT))) {
    parts.push(`  ${line}`);
  }
  if (a.length - endA > CONTEXT) parts.push("  […]");
  let text = parts.join("\n");
  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n  […diff truncated]`;
    truncated = true;
  }
  return {
    added: ops.filter((o) => o.kind === "+").length,
    removed: ops.filter((o) => o.kind === "-").length,
    text,
    truncated,
  };
}
