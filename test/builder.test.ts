import { describe, expect, it } from "vitest";
import {
  builderNodeToFilterExpression,
  createBuilderCondition,
  createBuilderExpression,
  createBuilderGroup,
  createDefaultBuilderNode,
  formatExpressionLiteral,
  getBuilderOperatorsForType,
  getBuilderProperties,
  parseBuilderNode,
  propertyIdToExpression,
  serializeBuilderNode,
  validateBuilderNode,
  type FormulaLanguageSchema,
} from "../src/index.js";

const schema = {
  properties: [
    { name: "status", type: "string" },
    { name: "priority", type: "number" },
    { name: "due", type: "date" },
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
          properties: [{ name: "id", type: "string" }],
        },
      ],
    },
  ],
} satisfies FormulaLanguageSchema;

describe("builder properties", () => {
  it("flattens note, file, formula, and object properties", () => {
    const properties = getBuilderProperties(schema);
    expect(properties.map((property) => property.id)).toEqual(
      expect.arrayContaining(["status", "file.path", "formula.score", "trigger.zone.id"]),
    );
  });

  it("filters operators by value type", () => {
    expect(getBuilderOperatorsForType("number").map((operator) => operator.id)).toEqual(
      expect.arrayContaining(["greater-than", "less-than-or-equal"]),
    );
    expect(getBuilderOperatorsForType("boolean").map((operator) => operator.id)).toEqual(
      expect.arrayContaining(["is-true", "is-false"]),
    );
  });
});

describe("builder serialization", () => {
  it("serializes simple conditions with escaped property paths", () => {
    expect(serializeBuilderNode(createBuilderCondition("status", "is", "Todo"))).toBe('status == "Todo"');
    expect(propertyIdToExpression("custom field")).toBe('note["custom field"]');
  });

  it("serializes type-specific literals", () => {
    expect(formatExpressionLiteral("2026-06-11", "date")).toBe('date("2026-06-11")');
    expect(formatExpressionLiteral("PT30M", "duration")).toBe('duration("PT30M")');
    expect(formatExpressionLiteral(["a", 1], "list")).toBe('["a", 1]');
  });

  it("serializes grouped filters", () => {
    const group = createBuilderGroup([
      createBuilderCondition("status", "is", "Todo"),
      createBuilderCondition("priority", "greater-than-or-equal", 2),
    ]);
    expect(serializeBuilderNode(group, { schema })).toBe('(status == "Todo") && (priority >= 2)');
  });

  it("converts builder nodes to structured filter expressions", () => {
    const filter = builderNodeToFilterExpression(createBuilderGroup([
      createBuilderCondition("status", "is", "Todo"),
      createBuilderExpression("file.hasTag(\"work\")"),
    ], "or"), schema);
    expect(filter).toEqual({
      or: ['status == "Todo"', 'file.hasTag("work")'],
    });
  });
});

describe("builder validation", () => {
  it("validates generated expression source", () => {
    const result = validateBuilderNode(createBuilderCondition("status", "contains", "Todo"), schema);
    expect(result.source).toBe('status.contains("Todo")');
    expect(result.valid).toBe(true);
  });

  it("reports missing builder fields separately from expression diagnostics", () => {
    const result = validateBuilderNode(createBuilderCondition("", "is", ""), schema);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["missing-property", "missing-value"]));
    expect(result.valid).toBe(false);
  });

  it("creates a default builder from the schema", () => {
    const result = validateBuilderNode(createDefaultBuilderNode(schema), schema);
    expect(result.source).toContain(".isEmpty()");
    expect(result.valid).toBe(true);
  });
});

describe("builder parsing", () => {
  it("parses binary expressions into simple conditions", () => {
    const result = parseBuilderNode('status == "Todo"', schema);
    expect(result.mode).toBe("simple");
    expect(result.node).toMatchObject({
      kind: "condition",
      property: "status",
      operator: "is",
      value: "Todo",
    });
  });

  it("parses native-style method filters", () => {
    const result = parseBuilderNode('!file.hasTag("done")', schema);
    expect(result.mode).toBe("simple");
    expect(result.node).toMatchObject({
      kind: "condition",
      property: "file",
      operator: "not-has-tag",
      value: "done",
    });
  });

  it("keeps advanced expressions when no simple row matches", () => {
    const result = parseBuilderNode('if(status == "Todo", priority, 0)', schema);
    expect(result.mode).toBe("advanced");
    expect(result.node).toEqual({
      kind: "expression",
      source: 'if(status == "Todo", priority, 0)',
    });
  });
});
