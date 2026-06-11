import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEvaluationContext,
  evaluateExpression,
  parseExpression,
  toPlain,
  validateExpressionDetailed,
  type FormulaLanguageSchema,
} from "../src/index.js";

const fixturePath = new URL("./fixtures/diagnostics.generated.json", import.meta.url);

interface DiagnosticsFixture {
  generatedAt: string;
  cases: Array<{
    name: string;
    expression: string;
    native: {
      parse: {
        type: string;
        parseError: string | null;
        errorMessage: string | null;
      };
      value: unknown;
      thrown: string | null;
      testResult: unknown;
      testThrown: string | null;
    };
  }>;
}

const schema: FormulaLanguageSchema = {
  properties: [
    { name: "status", type: "string", values: [{ value: "Todo" }, { value: "Done" }] },
    { name: "priority", type: "number", values: [{ value: 1 }, { value: 2 }] },
  ],
  propertyTypes: {
    status: "string",
    priority: "number",
  },
};

describe("native Bases diagnostics fixtures", () => {
  if (!existsSync(fixturePath)) {
    it.skip("diagnostic fixtures have not been generated", () => {});
    return;
  }

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as DiagnosticsFixture;
  const context = createEvaluationContext({
    now: fixture.generatedAt,
    note: {
      status: "Todo",
      priority: 1,
    },
    propertyTypes: schema.propertyTypes,
    file: {
      path: "__codex_bases_diagnostics_oracle/row.md",
    },
  });

  for (const testCase of fixture.cases) {
    it(`matches native parser validity for ${testCase.name}`, () => {
      const parsed = parseExpression(testCase.expression);
      const diagnostics = validateExpressionDetailed(testCase.expression, schema);

      if (testCase.native.parse.type === "invalid") {
        expect(parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
        expect(diagnostics.valid).toBe(false);
      } else {
        expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
        expect(diagnostics.valid).toBe(true);
      }
    });

    if (testCase.native.parse.type !== "invalid") {
      it(`matches native evaluation value for ${testCase.name}`, () => {
        const result = toPlain(evaluateExpression(testCase.expression, context).value);
        expect(result).toEqual(testCase.native.value);
      });
    }

    if (isNativeRuntimeError(testCase.native.value)) {
      it(`surfaces a package warning for native runtime failure in ${testCase.name}`, () => {
        const diagnostics = validateExpressionDetailed(testCase.expression, schema).diagnostics;
        expect(diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              severity: "warning",
              message: testCase.native.value.error,
            }),
          ]),
        );
      });
    }
  }
});

function isNativeRuntimeError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value && typeof (value as { error?: unknown }).error === "string";
}
