import { describe, expect, it } from "vitest";
import {
  convertObsidianBaseToMdbaseView,
  translateObsidianExpressionToMdbase,
} from "../src/index.js";

describe("mdbase v0.3 compatibility", () => {
  it("translates portable namespaces, formulas, conditionals, and length", () => {
    const result = translateObsidianExpressionToMdbase(
      'if(note.status == "open", formula.score + values.length, 0)',
    );
    expect(result.portable).toBe(true);
    expect(result.expression).toBe(
      '(((record).status == "open") ? ((projection).score + (values).size()) : 0)',
    );
  });

  it("maps a portable Base into a canonical nested-query view record", () => {
    const result = convertObsidianBaseToMdbaseView({
      filters: { and: ['note.status != "done"', 'file.inFolder("Tasks")'] },
      formulas: { score: "priority + 1" },
      properties: { "formula.score": { displayName: "Score" } },
      views: [{
        type: "table",
        name: "Open tasks",
        order: ["note.title", "formula.score"],
        sort: [{ property: "formula.score", direction: "DESC" }],
        groupBy: { property: "note.status", direction: "ASC" },
        summaries: { "formula.score": "Sum" },
      }],
    }, { id: "tasks.views", name: "Task views" });

    expect(result.portable).toBe(true);
    expect(result.record).toBe(result.draft);
    expect(result.draft.query).toEqual({
      where: '(((record).status != "done")) && ((file).inFolder("Tasks"))',
      projections: { score: { expr: "(priority + 1)" } },
    });
    expect(result.draft.properties).toEqual({ "projection.score": { label: "Score" } });
    expect(result.draft.views).toEqual([expect.objectContaining({
      id: "open-tasks",
      select: ["title", "projection.score"],
      order_by: [{ field: "projection.score", direction: "desc" }],
      group_by: [{ field: "status", direction: "asc" }],
      summaries: [{ field: "projection.score", function: "sum" }],
      presentation: expect.objectContaining({ type: "table" }),
    })]);
  });

  it("retains source and refuses to label a partial translation portable", () => {
    const result = convertObsidianBaseToMdbaseView({
      formulas: { dueDate: "date(due)" },
      views: [{ type: "table", name: "All" }],
    }, { id: "tasks.views", name: "Task views" });

    expect(result.portable).toBe(false);
    expect(result.record).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported_function", location: "formulas.dueDate" }),
    ]);
    expect(result.draft["x-obsidian"]).toEqual(expect.objectContaining({
      source_format: "base",
      portable: false,
    }));
  });

  it("accepts portable ISO durations and rejects Obsidian shorthand", () => {
    expect(translateObsidianExpressionToMdbase('duration("P1DT2H")').portable).toBe(true);
    expect(translateObsidianExpressionToMdbase('duration("7d")')).toEqual(expect.objectContaining({
      portable: false,
      expression: null,
      diagnostics: [expect.objectContaining({ code: "unsupported_duration" })],
    }));
  });

  it("does not call schema-invalid identifiers portable", () => {
    const result = convertObsidianBaseToMdbaseView({
      formulas: { "bad formula": "1" },
      views: [{ type: "not a renderer", name: "All" }],
    }, { id: "not a view id", name: "Views" });

    expect(result.portable).toBe(false);
    expect(result.record).toBeNull();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_identifier", location: "id" }),
      expect.objectContaining({ code: "invalid_identifier", location: "formulas.bad formula" }),
      expect.objectContaining({ code: "invalid_identifier", location: "views.all.type" }),
    ]));
  });
});
