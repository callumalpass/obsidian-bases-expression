import {
  completeExpression,
  getHoverInfo,
  getSignatureHelp,
  toCodeMirrorCompletions,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";

const schema: FormulaLanguageSchema = {
  properties: [
    { name: "status", type: "string" },
    { name: "due", type: "date" },
    { name: "estimate", type: "number" },
  ],
  formulas: [{ name: "isOverdue", type: "boolean" }],
};

const source = "due.form";
const completions = toCodeMirrorCompletions(completeExpression(source, source.length, schema));
const hover = getHoverInfo("today()", 2, schema);
const signature = getSignatureHelp("if(status == 'Todo',", 20, schema);

console.log({ completions, hover, signature });
