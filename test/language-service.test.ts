import { describe, expect, it } from "vitest";
import {
  completeExpression,
  createFormulaLanguageService,
  inspectExpression,
  validateExpression,
} from "../src/index.js";

const schema = {
  properties: [
    { name: "status", type: "string" },
    { name: "due", type: "date" },
    { name: "priority", type: "number" },
  ],
  formulas: [{ name: "score", type: "number" }],
};

describe("inspectExpression", () => {
  it("collects dependencies", () => {
    expect(inspectExpression('status == "Todo" && file.mtime > formula.score')).toMatchObject({
      noteProperties: ["status"],
      fileProperties: ["mtime"],
      formulaProperties: ["score"],
      functions: [],
    });
  });
});

describe("validateExpression", () => {
  it("warns about unknown note properties", () => {
    const diagnostics = validateExpression("unknown + priority", schema);
    expect(diagnostics.some((diagnostic) => diagnostic.code === "unknown-property")).toBe(true);
  });

  it("evaluates optionally for runtime warnings", () => {
    const diagnostics = validateExpression("number('x')", schema, {});
    expect(diagnostics.some((diagnostic) => diagnostic.code === "evaluation-error")).toBe(true);
  });
});

describe("completeExpression", () => {
  it("completes note properties", () => {
    expect(completeExpression("sta", 3, schema).map((item) => item.label)).toContain("status");
  });

  it("completes file properties", () => {
    expect(completeExpression("file.pa", 7, schema).map((item) => item.label)).toContain("path");
  });
});

describe("createFormulaLanguageService", () => {
  it("binds schema", () => {
    const service = createFormulaLanguageService(schema);
    expect(service.complete("prio", 4).map((item) => item.label)).toContain("priority");
  });
});
