import { describe, expect, it } from "vitest";
import {
  adaptObsidianFilterConfig,
  adaptObsidianFilterNode,
  compileFilter,
  createEvaluationContext,
  inferDefaultsFromObsidianFilterConfig,
} from "../src/index.js";

const generatedProjectRelationshipFilter = String.raw`file.hasLink(this.file) && list(note.projects).map(file(value.replace(/^\[[^\]]+\]\((.*)\)$/, "$1").replace(/%20/g, " ")).asLink()).contains(this.file.asLink())`;

describe("Obsidian filter adapters", () => {
  it("adapts runtime conjunction groups and rule text", () => {
    const adapted = adaptObsidianFilterNode({
      conjunction: "and",
      filters: [
        { rule: { text: 'note.status == "Todo"' } },
        {
          conjunction: "or",
          filters: [
            { rule: { text: "priority >= 2" } },
            { rule: { text: 'file.hasTag("urgent")' } },
          ],
        },
      ],
    });

    expect(adapted.diagnostics).toEqual([]);
    expect(adapted.filter).toEqual({
      and: [
        'note.status == "Todo"',
        { or: ["priority >= 2", 'file.hasTag("urgent")'] },
      ],
    });

    const context = createEvaluationContext({
      note: { status: "Todo", priority: 1 },
      file: { path: "Tasks/A.md", tags: ["urgent"] },
    });
    expect(compileFilter(adapted.filter).evaluateToBoolean(context)).toBe(true);
  });

  it("treats a runtime group without an explicit conjunction as AND", () => {
    const adapted = adaptObsidianFilterNode({
      filters: [
        { rule: { text: 'status == "Todo"' } },
        { rule: { text: 'priority == "High"' } },
      ],
    });

    expect(adapted.filter).toEqual({ and: ['status == "Todo"', 'priority == "High"'] });
    expect(adapted.diagnostics).toEqual([]);
  });

  it("combines query-level and view-level config filters", () => {
    const adapted = adaptObsidianFilterConfig({
      query: {
        filters: {
          conjunction: "and",
          filters: [{ rule: { text: 'file.hasTag("task")' } }],
        },
      },
      filters: {
        rule: { text: 'note.status == "Todo"' },
      },
    });

    expect(adapted.filter).toEqual({
      and: [
        { and: ['file.hasTag("task")'] },
        'note.status == "Todo"',
      ],
    });
    expect(adapted.diagnostics).toEqual([]);
  });

  it("infers defaults directly from an Obsidian view config", () => {
    const inferred = inferDefaultsFromObsidianFilterConfig(
      {
        query: {
          filters: {
            conjunction: "and",
            filters: [
              { rule: { text: 'file.hasTag("task")' } },
              { rule: { text: generatedProjectRelationshipFilter } },
            ],
          },
        },
        filters: {
          rule: { text: 'note.status == "Todo"' },
        },
      },
      { thisFileLink: "[[Projects/Alpha|Alpha]]" },
    );

    expect(inferred.properties).toEqual({
      projects: ["[[Projects/Alpha|Alpha]]"],
      status: "Todo",
    });
    expect(inferred.tags).toEqual(["task"]);
    expect(inferred.unsupported).toEqual([]);
    expect(inferred.diagnostics).toEqual([]);
  });

  it("preserves conservative OR behavior after adaptation", () => {
    const inferred = inferDefaultsFromObsidianFilterConfig({
      filters: {
        conjunction: "or",
        filters: [
          { rule: { text: 'status == "Todo"' } },
          { rule: { text: 'status == "Done"' } },
        ],
      },
    });

    expect(inferred.properties).toEqual({});
    expect(inferred.unsupported[0]?.reason).toContain("or branch");
  });

  it.each([
    [{ rule: { text: 42 } }, "rule.text must be a string"],
    [{ conjunction: "xor", filters: [] }, "Unsupported Obsidian Bases conjunction"],
    [{ conjunction: "and", filters: "not-an-array" }, "must contain a filters array"],
    [
      { rule: { text: "status" }, conjunction: "and", filters: [] },
      "mixes incompatible logical, group, or rule shapes",
    ],
    [{ unknown: true }, "Unsupported Obsidian Bases filter object"],
  ])("returns diagnostics for malformed runtime filter nodes", (input, message) => {
    const adapted = adaptObsidianFilterNode(input);

    expect(adapted.filter).toBeNull();
    expect(adapted.diagnostics).toHaveLength(1);
    expect(adapted.diagnostics[0]).toMatchObject({
      code: "invalid-obsidian-filter",
      severity: "error",
    });
    expect(adapted.diagnostics[0]?.message).toContain(message);
  });

  it("returns a diagnostic when config input is not object-like", () => {
    const inferred = inferDefaultsFromObsidianFilterConfig(42);

    expect(inferred.properties).toEqual({});
    expect(inferred.diagnostics).toHaveLength(1);
    expect(inferred.diagnostics[0]?.code).toBe("invalid-obsidian-filter");
  });
});
