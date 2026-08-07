import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateExpression, toPlain } from "../src/index.js";

const fixturePath = new URL("./fixtures/oracle.compact.json", import.meta.url);

describe("Obsidian oracle fixtures", () => {
  if (!existsSync(fixturePath)) {
    it.skip("oracle fixtures have not been generated", () => {});
    return;
  }

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    generatedAt: string;
    context: Parameters<typeof evaluateExpression>[1] & { timezone?: string };
    cases: Array<{
      name: string;
      expression: string;
      expected: unknown;
      knownDivergence?: string;
      assertion?: "range01";
    }>;
  };
  const { timezone, ...context } = fixture.context;
  if (timezone) process.env.TZ = timezone;

  for (const testCase of fixture.cases) {
    if (testCase.knownDivergence) {
      it(`records known divergence for ${testCase.name}`, () => {
        const result = toPlain(evaluateExpression(testCase.expression, context).value);
        expect(result).not.toEqual(testCase.expected);
        expect(testCase.knownDivergence.length).toBeGreaterThan(0);
      });
      continue;
    }

    if (testCase.assertion === "range01") {
      it(`matches Obsidian shape for ${testCase.name}`, () => {
        expect(typeof testCase.expected).toBe("number");
        expect(testCase.expected as number).toBeGreaterThanOrEqual(0);
        expect(testCase.expected as number).toBeLessThan(1);
        const result = toPlain(
          evaluateExpression(testCase.expression, {
            ...context,
            random: () => testCase.expected as number,
          }).value,
        );
        expect(result).toEqual(testCase.expected);
      });
      continue;
    }

    it(`matches Obsidian for ${testCase.name}`, () => {
      const result = toPlain(evaluateExpression(testCase.expression, context).value);
      expect(result).toEqual(testCase.expected);
    });
  }
});
