import { describe, it, expect } from "vitest";
import {
  buildOrgMap,
  resolveContributorLabel,
  resolveContributorLabels,
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
