import {
  createEvaluationContext,
  evaluateToPlain,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";

export const workflowExpressionSchema: FormulaLanguageSchema = {
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
};

const context = createEvaluationContext({
  note: { status: "Todo" },
  objects: {
    trigger: { type: "drag", zone: { id: "doing", label: "Doing" } },
    steps: { query: { total: 4 } },
  },
});

const shouldRun = evaluateToPlain(
  'trigger.type == "drag" && trigger.zone.id == "doing" && steps.query.total > 0',
  context,
);

console.log({ shouldRun, workflowExpressionSchema });
