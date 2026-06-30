import { describe, it, expect } from "vitest";
import {
  buildOrgMap,
  resolveContributorLabel,
  resolveContributorLabels,
  isServiceAccountEmail,
  type ContributorOrgEntry,
} from "@/lib/pma/contributor-orgs";

const entries: ContributorOrgEntry[] = [
  { identityKind: "email", identityKey: "amir@innovina.it", org: "Innovina" },
  { identityKind: "name", identityKey: "Sara Bianchi", org: "Innovina" },
  { identityKind: "name", identityKey: "Tom Acme", org: "Acme" },
];

describe("buildOrgMap + resolveContributorLabel", () => {
  const map = buildOrgMap(entries);

  it("matches by email first, case-insensitively", () => {
    expect(
      resolveContributorLabel({ name: "A. Hosseini", email: "AMIR@innovina.it" }, map),
    ).toBe("Innovina");
  });

  it("matches by display name when no email match", () => {
    expect(resolveContributorLabel({ name: "Sara Bianchi", email: null }, map)).toBe(
      "Innovina",
    );
  });

  it("prefers an email match over the name", () => {
    // email maps to Innovina even though the name is mapped to Acme
    const m = buildOrgMap([
      { identityKind: "email", identityKey: "x@innovina.it", org: "Innovina" },
      { identityKind: "name", identityKey: "Tom Acme", org: "Acme" },
    ]);
    expect(resolveContributorLabel({ name: "Tom Acme", email: "x@innovina.it" }, m)).toBe(
      "Innovina",
    );
  });

  it("falls back to the person's name verbatim when unmapped", () => {
    expect(resolveContributorLabel({ name: "Giulia", email: null }, map)).toBe("Giulia");
  });

  it("email-mapped contributor resolves via stored displayName when a revision is name-only", () => {
    // The default flow maps by email; Drive's revisions.list frequently returns a
    // revision's displayName with NO email. The stored displayName must still map.
    const m = buildOrgMap([
      {
        identityKind: "email",
        identityKey: "amir@innovina.it",
        org: "Innovina",
        displayName: "Amir Hosseini",
      },
    ]);
    // name-only revision (email omitted) → org, NOT the leaked name
    expect(resolveContributorLabel({ name: "Amir Hosseini", email: null }, m)).toBe(
      "Innovina",
    );
    // email-bearing revision → org
    expect(
      resolveContributorLabel({ name: "Amir Hosseini", email: "amir@innovina.it" }, m),
    ).toBe("Innovina");
  });

  it("matches display names case-insensitively", () => {
    const m = buildOrgMap([{ identityKind: "name", identityKey: "Sara Bianchi", org: "Innovina" }]);
    expect(resolveContributorLabel({ name: "sara bianchi", email: null }, m)).toBe(
      "Innovina",
    );
  });

  it("never credits a service account — dropped even when mapped", () => {
    const sa = "959497083111-compute@developer.gserviceaccount.com";
    expect(isServiceAccountEmail(sa)).toBe(true);
    expect(isServiceAccountEmail("amir@innovina.it")).toBe(false);
    // even if someone explicitly mapped the SA, it must not surface in a report
    const m = buildOrgMap([
      { identityKind: "email", identityKey: sa, org: "Innovina", displayName: "Compute Engine" },
    ]);
    expect(resolveContributorLabel({ name: "Compute Engine", email: sa }, m)).toBeNull();
    // and it's dropped from a set, leaving only the real human
    expect(
      resolveContributorLabels(
        [
          { name: "Compute Engine", email: sa },
          { name: "Amir", email: null },
        ],
        m,
      ),
    ).toEqual(["Amir"]);
  });

  it("returns null when neither name nor a mapped email is present", () => {
    expect(resolveContributorLabel({ name: null, email: null }, map)).toBeNull();
    expect(resolveContributorLabel({ name: null, email: "nobody@x.io" }, map)).toBeNull();
  });

  it("ignores entries with a blank org", () => {
    const m = buildOrgMap([{ identityKind: "name", identityKey: "X", org: "  " }]);
    expect(resolveContributorLabel({ name: "X", email: null }, m)).toBe("X");
  });
});

describe("resolveContributorLabels", () => {
  const map = buildOrgMap(entries);

  it("collapses same-org contributors to one label, preserving order", () => {
    const labels = resolveContributorLabels(
      [
        { name: "Sara Bianchi", email: null }, // Innovina
        { name: "A. Hosseini", email: "amir@innovina.it" }, // Innovina
        { name: "Tom Acme", email: null }, // Acme
      ],
      map,
    );
    expect(labels).toEqual(["Innovina", "Acme"]);
  });

  it("keeps unmapped names alongside resolved orgs", () => {
    const labels = resolveContributorLabels(
      [
        { name: "Tom Acme", email: null },
        { name: "Giulia", email: null },
      ],
      map,
    );
    expect(labels).toEqual(["Acme", "Giulia"]);
  });

  it("collapses an email-mapped person's mixed revisions (email + name-only) to one org", () => {
    // Regression: a person with one revision carrying email and one name-only must
    // NOT produce ["Innovina", "Amir Hosseini"] — the name must never leak.
    const m = buildOrgMap([
      {
        identityKind: "email",
        identityKey: "amir@innovina.it",
        org: "Innovina",
        displayName: "Amir Hosseini",
      },
    ]);
    const labels = resolveContributorLabels(
      [
        { name: "Amir Hosseini", email: "amir@innovina.it" },
        { name: "Amir Hosseini", email: null },
      ],
      m,
    );
    expect(labels).toEqual(["Innovina"]);
  });

  it("empty map → every contributor resolves to their own name", () => {
    const labels = resolveContributorLabels(
      [
        { name: "Amir", email: null },
        { name: "Sara", email: null },
      ],
      buildOrgMap([]),
    );
    expect(labels).toEqual(["Amir", "Sara"]);
  });

  it("drops contributors that resolve to nothing (anonymous, unmapped email-only)", () => {
    const labels = resolveContributorLabels(
      [
        { name: null, email: null },
        { name: "Tom Acme", email: null },
      ],
      map,
    );
    expect(labels).toEqual(["Acme"]);
  });
});
