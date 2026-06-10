import type { Expression } from "./ast.js";
import { parseExpression } from "./parser.js";

export interface ExpressionInspection {
  identifiers: string[];
  noteProperties: string[];
  fileProperties: string[];
  formulaProperties: string[];
  functions: string[];
  hasThisReference: boolean;
}

export function inspectExpression(sourceOrAst: string | Expression): ExpressionInspection {
  const ast = typeof sourceOrAst === "string" ? parseExpression(sourceOrAst).ast : sourceOrAst;
  const state = {
    identifiers: new Set<string>(),
    noteProperties: new Set<string>(),
    fileProperties: new Set<string>(),
    formulaProperties: new Set<string>(),
    functions: new Set<string>(),
    hasThisReference: false,
  };
  if (ast) visit(ast, state);
  return {
    identifiers: [...state.identifiers].sort(),
    noteProperties: [...state.noteProperties].sort(),
    fileProperties: [...state.fileProperties].sort(),
    formulaProperties: [...state.formulaProperties].sort(),
    functions: [...state.functions].sort(),
    hasThisReference: state.hasThisReference,
  };
}

function visit(
  expr: Expression,
  state: {
    identifiers: Set<string>;
    noteProperties: Set<string>;
    fileProperties: Set<string>;
    formulaProperties: Set<string>;
    functions: Set<string>;
    hasThisReference: boolean;
  },
): void {
  switch (expr.type) {
    case "Identifier":
      state.identifiers.add(expr.name);
      if (!["true", "false", "null", "file", "note", "formula", "this", "value", "index", "acc"].includes(expr.name)) {
        state.noteProperties.add(expr.name);
      }
      if (expr.name === "this") state.hasThisReference = true;
      break;
    case "Array":
      expr.elements.forEach((element) => visit(element, state));
      break;
    case "Object":
      expr.properties.forEach((property) => visit(property.value, state));
      break;
    case "Unary":
      visit(expr.argument, state);
      break;
    case "Binary":
      visit(expr.left, state);
      visit(expr.right, state);
      break;
    case "Member":
      if (!expr.computed && typeof expr.property === "string" && expr.object.type === "Identifier") {
        if (expr.object.name === "note") state.noteProperties.add(expr.property);
        else if (expr.object.name === "file") state.fileProperties.add(expr.property);
        else if (expr.object.name === "formula") state.formulaProperties.add(expr.property);
        else if (expr.object.name === "this") state.hasThisReference = true;
      }
      visit(expr.object, state);
      if (expr.computed && typeof expr.property !== "string") visit(expr.property, state);
      break;
    case "Call":
      if (expr.callee.type === "Identifier") state.functions.add(expr.callee.name);
      if (expr.callee.type === "Member" && typeof expr.callee.property === "string") state.functions.add(expr.callee.property);
      visit(expr.callee, state);
      expr.args.forEach((arg) => visit(arg, state));
      break;
    case "Literal":
    case "Regex":
      break;
  }
}
