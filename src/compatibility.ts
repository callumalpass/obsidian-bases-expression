export interface KnownDivergence {
  caseName: string;
  behavior: string;
}

export interface CompatibilityProfile {
  packageName: "obsidian-bases-expression";
  compatibilityTarget: "Obsidian Bases expressions";
  implementationBasis: "published-docs-with-live-oracle-validation";
  oracle: {
    generatedAt: string;
    caseCount: number;
    knownDivergenceCount: number;
    obsidianVersion: string | null;
    obsidianBuild: string | null;
    repeatedAcrossObsidianVersions: boolean;
  };
  docsSources: string[];
  knownDivergences: KnownDivergence[];
  notes: string[];
}

export const compatibilityProfile: CompatibilityProfile = {
  packageName: "obsidian-bases-expression",
  compatibilityTarget: "Obsidian Bases expressions",
  implementationBasis: "published-docs-with-live-oracle-validation",
  oracle: {
    generatedAt: "2026-06-10T07:17:08.362Z",
    caseCount: 281,
    knownDivergenceCount: 8,
    obsidianVersion: null,
    obsidianBuild: null,
    repeatedAcrossObsidianVersions: false,
  },
  docsSources: [
    "https://help.obsidian.md/bases/syntax",
    "https://help.obsidian.md/bases/functions",
    "https://help.obsidian.md/formulas",
  ],
  knownDivergences: [
    {
      caseName: "unary plus",
      behavior: "The package supports unary plus as a JavaScript-like operator, but the current internal parser rejects it.",
    },
    {
      caseName: "any isTruthy number direct literal",
      behavior: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
    },
    {
      caseName: "any isTruthy zero direct literal",
      behavior: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
    },
    {
      caseName: "any toString number direct literal",
      behavior: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
    },
    {
      caseName: "number isEmpty false direct literal",
      behavior: "Public docs show direct numeric method syntax, but the current internal parser rejects it; parenthesized numeric literals work.",
    },
    {
      caseName: "object keys",
      behavior: "Public docs describe object literals, but the current internal parser rejects them.",
    },
    {
      caseName: "object values",
      behavior: "Public docs describe object literals, but the current internal parser rejects them.",
    },
    {
      caseName: "object isEmpty",
      behavior: "Public docs describe object literals, but the current internal parser rejects them.",
    },
  ],
  notes: [
    "The runtime does not import Obsidian or private Obsidian APIs.",
    "The oracle generator is test tooling only and probes a running Obsidian instance through the Obsidian CLI.",
    "Obsidian version/build metadata is recorded by newer oracle fixtures when the host exposes it.",
    "The oracle has not been repeated across multiple Obsidian versions.",
  ],
};
