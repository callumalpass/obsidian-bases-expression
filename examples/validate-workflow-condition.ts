import {
  createFormulaLanguageService,
  toCodeMirrorDiagnostics,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";

const schema: FormulaLanguageSchema = {
  properties: [
    { name: "status", type: "string" },
    { name: "priority", type: "number" },
    { name: "scheduled", type: "date" },
  ],
};

const service = createFormulaLanguageService(schema);
const result = service.validateDetailed('status == "Todo" && scheduled < today()');

console.log({
  valid: result.valid,
  dependencies: result.dependencies,
  diagnostics: toCodeMirrorDiagnostics(result.diagnostics),
});
