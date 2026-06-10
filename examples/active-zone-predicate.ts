import {
  compileExpression,
  createContextFromRow,
  type BasesRowLike,
} from "obsidian-bases-expression";

const predicate = compileExpression('status == "Todo" && file.hasTag("project") && priority >= 2');

const row: BasesRowLike = {
  path: "Tasks/Write proposal.md",
  properties: {
    status: "Todo",
    priority: 3,
  },
  file: {
    path: "Tasks/Write proposal.md",
    tags: ["project/client-a"],
  },
};

const context = createContextFromRow(row);
const shouldRenderInZone = predicate.evaluateToPlain(context);

console.log({ shouldRenderInZone });
