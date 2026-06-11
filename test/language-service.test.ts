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
    {
      name: "status",
      type: "string",
      values: [
        { value: "Todo", label: "Todo", count: 3 },
        { value: "Done", label: "Done", count: 1 },
      ],
    },
    { name: "due", type: "date" },
    { name: "priority", type: "number" },
    { name: "done", type: "boolean" },
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

  it("warns on unknown bare members on typed values", () => {
    const result = validateExpressionDetailed('status == "asdf".asdfasdf', schema);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "method-not-available",
          severity: "warning",
          message: 'Cannot find "asdfasdf" on type String',
        }),
      ]),
    );
    expect(validateExpressionDetailed("now().asdfasdf", schema).diagnostics.map((diagnostic) => diagnostic.code)).toContain("method-not-available");
    expect(validateExpressionDetailed("random().asdfasdf", schema).diagnostics.map((diagnostic) => diagnostic.code)).toContain("method-not-available");
    expect(validateExpressionDetailed('file("Tasks/A.md").asdfasdf', schema).diagnostics.map((diagnostic) => diagnostic.code)).toContain("method-not-available");
  });

  it("allows known bare fields and known method names on typed values", () => {
    expect(validateExpressionDetailed('"asdf".length == 4', schema).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("method-not-available");
    expect(validateExpressionDetailed("now().year > 2025", schema).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("method-not-available");
    expect(validateExpressionDetailed('file("Tasks/A.md").name == "A"', schema).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("method-not-available");
    expect(validateExpressionDetailed('"asdf".lower', schema).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("method-not-available");
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

  it("completes methods from call and parenthesized receivers", () => {
    expect(completeExpression("now().", "now().".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["format", "relative", "time"]),
    );
    expect(completeExpression("date(\"2026-06-11\").fo", "date(\"2026-06-11\").fo".length, schema).map((item) => item.label)).toContain("format");
    expect(completeExpression("(due).", "(due).".length, schema).map((item) => item.label)).toContain("format");
    expect(completeExpression("now().date().", "now().date().".length, schema).map((item) => item.label)).toContain("relative");
  });

  it("completes methods for non-date receiver types", () => {
    expect(completeExpression("\"Todo\".", "\"Todo\".".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["contains", "lower", "startsWith"]),
    );
    expect(completeExpression("random().", "random().".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["round", "toFixed"]),
    );
    expect(completeExpression("list(\"a\").", "list(\"a\").".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["filter", "map", "unique"]),
    );
    expect(completeExpression("file(\"Tasks/A.md\").", "file(\"Tasks/A.md\").".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["asLink", "hasTag", "inFolder"]),
    );
    expect(completeExpression("link(\"Tasks/A.md\").", "link(\"Tasks/A.md\").".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["asFile", "linksTo"]),
    );
    expect(completeExpression("/todo/.", "/todo/.".length, schema).map((item) => item.label)).toContain("matches");
  });

  it("completes methods after chained method return types", () => {
    expect(completeExpression("date(\"2026-06-11\").format(\"YYYY\").", "date(\"2026-06-11\").format(\"YYYY\").".length, schema).map((item) => item.label)).toContain("lower");
    expect(completeExpression("\"a,b\".split(\",\").", "\"a,b\".split(\",\").".length, schema).map((item) => item.label)).toContain("join");
    expect(completeExpression("file(\"Tasks/A.md\").asLink().", "file(\"Tasks/A.md\").asLink().".length, schema).map((item) => item.label)).toContain("asFile");
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

  it("completes known property values in value positions", () => {
    const quoted = completeExpression('status == "To', 'status == "To'.length, schema);
    expect(quoted.find((item) => item.label === "Todo")).toMatchObject({
      kind: "value",
      insertText: "Todo",
      from: 'status == "'.length,
      to: 'status == "To'.length,
      value: "Todo",
    });

    const unquoted = completeExpression("status == To", "status == To".length, schema);
    expect(unquoted.find((item) => item.label === "Todo")).toMatchObject({
      kind: "value",
      insertText: "\"Todo\"",
      from: "status == ".length,
      to: "status == To".length,
    });
  });

  it("uses expected types for value-position completions", () => {
    expect(completeExpression("due < ", "due < ".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["date", "now", "today"]),
    );
    expect(completeExpression("priority > ", "priority > ".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["number", "random", "priority"]),
    );
    expect(completeExpression("done == ", "done == ".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["true", "false"]),
    );
  });

  it("uses function parameter types for argument completions", () => {
    expect(completeExpression("due.format(", "due.format(".length, schema).map((item) => item.label)).toContain("status");
    expect(completeExpression("priority.round(", "priority.round(".length, schema).map((item) => item.label)).toEqual(
      expect.arrayContaining(["number", "random", "priority"]),
    );
  });

  it("does not offer completions after an invalid literal call parenthesis", () => {
    expect(completeExpression('status == "Todo"(', 'status == "Todo"('.length, schema)).toEqual([]);
    expect(completeExpression('status == "Todo"(s', 'status == "Todo"(s'.length, schema)).toEqual([]);
  });

  it("still completes inside grouping and valid call parentheses", () => {
    expect(completeExpression("(sta", "(sta".length, schema).map((item) => item.label)).toContain("status");
    expect(completeExpression("date(", "date(".length, schema).map((item) => item.label)).toContain("status");
  });
});

describe("type-aware diagnostics", () => {
  it("warns about obvious literal type mismatches", () => {
    expect(validateExpressionDetailed('priority > "high"', schema).diagnostics.map((diagnostic) => diagnostic.code)).toContain("type-mismatch");
    expect(validateExpressionDetailed('due < "not-a-date"', schema).diagnostics.map((diagnostic) => diagnostic.code)).toContain("type-mismatch");
    expect(validateExpressionDetailed("date(123)", schema).diagnostics.map((diagnostic) => diagnostic.code)).toContain("type-mismatch");
  });

  it("does not warn for coercible date and number literals", () => {
    expect(validateExpressionDetailed('priority > "2"', schema).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("type-mismatch");
    expect(validateExpressionDetailed('due < "2026-06-11"', schema).diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("type-mismatch");
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
    expect(getHoverInfo("now().format", "now().format".length, schema)).toMatchObject({
      kind: "function",
      label: "format",
      detail: "format(format: string): string",
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
