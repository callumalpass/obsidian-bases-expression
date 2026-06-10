import {
  compileExpression,
  evaluateBatch,
  type BasesRowLike,
} from "obsidian-bases-expression";

const rows: BasesRowLike[] = [
  { path: "Tasks/A.md", properties: { status: "Todo", priority: 3 } },
  { path: "Tasks/B.md", properties: { status: "Done", priority: 5 } },
  { path: "Tasks/C.md", properties: { status: "Todo", priority: 1 } },
];

const predicate = compileExpression('status == "Todo" && priority >= 2');
const matchingRows = evaluateBatch(predicate, rows)
  .filter((result) => result.plain === true)
  .map((result) => rows[result.index]?.path);

console.log(matchingRows);
