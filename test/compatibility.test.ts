import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compatibilityProfile } from "../src/index.js";

const fixturePath = new URL("./fixtures/oracle.generated.json", import.meta.url);

describe("compatibilityProfile", () => {
  it("tracks the generated oracle fixture", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      generatedAt: string;
      obsidian?: {
        version?: string | null;
        build?: string | null;
      };
      cases: Array<{ knownDivergence?: string }>;
    };
    expect(compatibilityProfile.oracle.generatedAt).toBe(fixture.generatedAt);
    expect(compatibilityProfile.oracle.caseCount).toBe(fixture.cases.length);
    expect(compatibilityProfile.oracle.knownDivergenceCount).toBe(
      fixture.cases.filter((testCase) => testCase.knownDivergence).length,
    );
    expect(compatibilityProfile.oracle.obsidianVersion).toBe(fixture.obsidian?.version ?? null);
    expect(compatibilityProfile.oracle.obsidianBuild).toBe(fixture.obsidian?.build ?? null);
  });
});
