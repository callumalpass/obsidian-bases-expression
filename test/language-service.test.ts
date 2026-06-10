import { describe, expect, it } from "vitest";
import {
  completeExpression,
  createFormulaLanguageService,
  getHoverInfo,
  getSignatureHelp,
  inspectExpression,
  toCodeMirrorCompletions,
  toCodeMirrorDiagnostics,
  validateExpression,
  validateExpressionDetailed,
  type FormulaLanguageSchema,
} from "../src/index.js";

const schema = {
  properties: [
    { name: "status", type: "string" },
    { name: "due", type: "date" },
    { name: "priority", type: "number" },
  ],
  formulas: [{ name: "score", type: "number" }],
  objects: [
    {
      name: "trigger",
      type: "object",
      properties: [
        { name: "type", type: "string" },
        {
          name: "zone",
          type: "object",
          properties: [
            { name: "id", type: "string" },
            { name: "label", type: "string" },
          ],
        },
      ],
    },
    {
      name: "steps",
      type: "object",
      properties: [
        {
          name: "query",
          type: "object",
          properties: [{ name: "total", type: "number" }],
        },
      ],
    },
  ],
} satisfies FormulaLanguageSchema;

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

  it("returns detailed validation with dependencies", () => {
    const result = validateExpressionDetailed("due.lower() && file.notAProperty", schema);
    expect(result.dependencies.noteProperties).toEqual(["due"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["method-not-available", "unknown-file-property"]),
    );
  });

  it("validates schema object paths separately from note properties", () => {
    const result = validateExpressionDetailed('trigger.zone.id == "next" && steps.query.missing > 0', schema);
    expect(result.dependencies.noteProperties).toEqual([]);
    expect(result.dependencies.objectProperties).toEqual(["steps.query", "steps.query.missing", "trigger.zone", "trigger.zone.id"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unknown-object-property");
  });
});

describe("completeExpression", () => {
  it("completes note properties", () => {
    expect(completeExpression("sta", 3, schema).map((item) => item.label)).toContain("status");
  });

  it("completes file properties", () => {
    expect(completeExpression("file.pa", 7, schema).map((item) => item.label)).toContain("path");
  });

  it("completes methods from schema-inferred receiver types", () => {
    expect(completeExpression("due.fo", 6, schema).map((item) => item.label)).toContain("format");
    expect(completeExpression("priority.ro", 11, schema).map((item) => item.label)).toContain("round");
  });

  it("completes nested object schemas", () => {
    expect(completeExpression("tri", 3, schema).map((item) => item.label)).toContain("trigger");
    expect(completeExpression("trigger.zone.", 13, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["id", "label"]),
    );
    expect(completeExpression("steps.query.to", 14, schema).map((item) => item.label)).toContain("total");
  });

  it("adapts completions to CodeMirror-shaped objects", () => {
    const completions = toCodeMirrorCompletions(completeExpression("sta", 3, schema));
    expect(completions.find((item) => item.label === "status")).toMatchObject({
      type: "property",
      apply: "status",
    });
  });
});

describe("hover and signature help", () => {
  it("returns hover info for schema properties and functions", () => {
    expect(getHoverInfo("status == 'Todo'", 2, schema)).toMatchObject({
      kind: "property",
      label: "status",
      detail: "string",
    });
    expect(getHoverInfo("today()", 2, schema)).toMatchObject({
      kind: "function",
      label: "today",
      detail: "today(): date",
    });
  });

  it("returns signature help and CodeMirror diagnostics", () => {
    expect(getSignatureHelp("if(status,", 10, schema)).toMatchObject({
      name: "if",
      activeParameter: 1,
    });
    const diagnostics = toCodeMirrorDiagnostics(validateExpression("missing", schema));
    expect(diagnostics[0]).toMatchObject({
      source: "obsidian-bases-expression",
      severity: "warning",
    });
  });
});

describe("createFormulaLanguageService", () => {
  it("binds schema", () => {
    const service = createFormulaLanguageService(schema);
    expect(service.complete("prio", 4).map((item) => item.label)).toContain("priority");
  });
});
