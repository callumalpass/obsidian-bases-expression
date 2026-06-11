import { describe, expect, it } from "vitest";
import {
  compileExpression,
  compileFilter,
  compileFormulaSet,
  createContextFromRow,
  createEvaluationContext,
  createLinkResolutionMap,
  evaluateBatch,
  evaluateFilter,
  evaluateToPlain,
  evaluateToString,
  ExpressionError,
  frontmatterLink,
  inferDefaultsFromFilter,
  toPlain,
} from "../src/index.js";

describe("high-level evaluation API", () => {
  it("evaluates to plain and string values", () => {
    const context = createEvaluationContext({
      note: { price: 12.5, quantity: 4, status: "Todo" },
    });
    expect(evaluateToPlain("price * quantity", context)).toBe(50);
    expect(evaluateToString('status + "!"', context)).toBe("Todo!");
  });

  it("throws stable ExpressionError objects when requested", () => {
    expect(() => evaluateToPlain("number('nope')", {}, { throwOnError: true })).toThrow(ExpressionError);
    try {
      evaluateToPlain("number('nope')", {}, { throwOnError: true });
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).value?.type).toBe("Error");
    }
  });

  it("compiles once and evaluates many contexts", () => {
    const expression = compileExpression('status == "Todo" && priority > 1');
    expect(expression.dependencies.noteProperties).toEqual(["priority", "status"]);
    expect(expression.evaluateToPlain({ note: { status: "Todo", priority: 2 } })).toBe(true);
    expect(expression.evaluateToPlain({ note: { status: "Done", priority: 5 } })).toBe(false);
  });

  it("evaluates arbitrary named object contexts", () => {
    const context = createEvaluationContext({
      note: { status: "Todo" },
      objects: {
        trigger: { type: "drag", zone: { id: "next" } },
        steps: { query: { total: 3 } },
      },
    });
    expect(evaluateToPlain('trigger.type == "drag" && trigger.zone.id == "next"', context)).toBe(true);
    expect(evaluateToPlain("steps.query.total", context)).toBe(3);
  });

  it("keeps object roots separate from note fields and reserved names", () => {
    const context = createEvaluationContext({
      note: {
        file: "note-file",
        status: "Todo",
        trigger: "frontmatter trigger",
        values: ["note value"],
      },
      objects: {
        file: { path: "Objects/File.md" },
        trigger: { type: "drop", zone: { id: "next" } },
        steps: { matches: [{ path: "Tasks/A.md" }] },
        values: ["object value"],
      },
      file: { path: "Real/File.md" },
    });
    expect(evaluateToPlain("trigger.type", context)).toBe("drop");
    expect(evaluateToPlain("trigger.zone.missing == null", context)).toBe(true);
    expect(evaluateToPlain("steps.matches[0].path", context)).toBe("Tasks/A.md");
    expect(evaluateToPlain("file.path", context)).toBe("Real/File.md");
    expect(evaluateToPlain("values[0]", context)).toBe("note value");
  });
});

describe("context builders", () => {
  it("normalizes frontmatter links and link resolution maps", () => {
    const context = createEvaluationContext({
      note: { target: "[[Other|Alias]]" },
      propertyTypes: { target: "link" },
      file: {
        path: "Inbox/Row.md",
        links: [{ path: "Other", display: "Alias", resolvedPath: "Inbox/Other.md" }],
      },
      files: [{ path: "Inbox/Other.md" }],
    });
    expect(evaluateToString("target", context)).toBe("[[Other|Alias]]");
    expect(evaluateToPlain("target.asFile().path", context)).toBe("Inbox/Other.md");
    expect(evaluateToPlain('file.hasLink("other.md")', context)).toBe(true);
  });

  it("builds contexts from row-like data", () => {
    const context = createContextFromRow({
      path: "Tasks/T1.md",
      properties: { status: "Todo", points: 3 },
      links: [{ path: "Project.md" }],
    });
    expect(evaluateToPlain('file.path + ":" + status', context)).toBe("Tasks/T1.md:Todo");
    expect(evaluateToPlain('file.hasLink("Project.md")', context)).toBe(true);
  });

  it("exposes small helpers for consumers that manage their own context", () => {
    const map = createLinkResolutionMap([{ path: "Projects/Alpha.md" }], [{ target: "Loose", resolvedPath: null }]);
    expect(map["Alpha"]).toBe("Projects/Alpha.md");
    expect(map["alpha"]).toBe("Projects/Alpha.md");
    expect(map["Loose"]).toBeNull();
    expect(toPlain(frontmatterLink("Projects/Alpha", "Alpha"))).toBe("Projects/Alpha");
  });
});

describe("batch and formula helpers", () => {
  it("evaluates a compiled expression over rows", () => {
    const compiled = compileExpression('status == "Todo" && points >= 2');
    const results = evaluateBatch(compiled, [
      { path: "A.md", properties: { status: "Todo", points: 3 } },
      { path: "B.md", properties: { status: "Done", points: 5 } },
    ]);
    expect(results.map((result) => result.plain)).toEqual([true, false]);
  });

  it("evaluates formula graphs with dependency order", () => {
    const formulas = compileFormulaSet({
      total: "price * quantity",
      label: 'status + " " + formula.total.toString()',
    });
    expect(formulas.evaluationOrder).toEqual(["total", "label"]);
    expect(formulas.evaluateToPlain({ note: { price: 10, quantity: 2, status: "Todo" } })).toEqual({
      total: 20,
      label: "Todo 20",
    });
  });
});

describe("filters and note-creation inference", () => {
  it("evaluates structured filters", () => {
    const filter = compileFilter({
      and: ['status == "Todo"', { or: ["priority >= 2", 'file.hasTag("urgent")'] }],
    });
    const context = createEvaluationContext({
      note: { status: "Todo", priority: 1 },
      file: { path: "Inbox/T1.md", tags: ["urgent"] },
    });
    expect(filter.evaluateToBoolean(context)).toBe(true);
    expect(evaluateFilter({ not: 'status == "Done"' }, context).matches).toBe(true);
    expect(filter.dependencies.noteProperties).toEqual(["priority", "status"]);
  });

  it("short-circuits structured filters at runtime while preserving compile diagnostics", () => {
    const context = createEvaluationContext({ note: { status: "Todo" } });
    expect(compileFilter({ and: ["false", "unknownFunction()"] }).evaluateToBoolean(context)).toBe(false);
    expect(compileFilter({ or: ["true", "unknownFunction()"] }).evaluateToBoolean(context)).toBe(true);
    expect(compileFilter({ not: ["true", "true"] }).evaluateToBoolean(context)).toBe(false);
    expect(compileFilter({ not: ["true", "false"] }).evaluateToBoolean(context)).toBe(true);

    const filter = compileFilter({ or: ["true", "status +"] });
    expect(filter.valid).toBe(false);
    expect(filter.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    expect(filter.evaluateToBoolean(context)).toBe(true);
  });

  it("reports malformed structured filters", () => {
    const filter = compileFilter({ and: ["status"], or: ["priority"] });
    expect(filter.valid).toBe(false);
    expect(filter.diagnostics[0]).toMatchObject({ code: "invalid-filter", severity: "error" });
  });

  it("infers safe defaults from positive filters", () => {
    const inferred = inferDefaultsFromFilter({
      and: ['status == "Todo"', 'note.project == "Alpha"', 'file.hasTag("#work")'],
    });
    expect(inferred.properties).toEqual({ project: "Alpha", status: "Todo" });
    expect(inferred.tags).toEqual(["work"]);
    expect(inferred.unsupported).toEqual([]);
  });

  it("reports note-default inference boundaries", () => {
    expect(inferDefaultsFromFilter('"Todo" == status').properties).toEqual({ status: "Todo" });
    expect(inferDefaultsFromFilter("status").properties).toEqual({ status: true });

    const conflict = inferDefaultsFromFilter({ and: ['status == "Todo"', 'status == "Done"'] });
    expect(conflict.properties).toEqual({ status: "Todo" });
    expect(conflict.unsupported.map((item) => item.reason)).toContain("Conflicting inferred defaults for status");

    for (const filter of [
      { or: ['status == "Todo"', 'status == "Done"'] },
      { not: 'status == "Done"' },
      "priority > 2",
      "status.lower()",
    ]) {
      expect(inferDefaultsFromFilter(filter).unsupported.length).toBeGreaterThan(0);
    }
  });
});
