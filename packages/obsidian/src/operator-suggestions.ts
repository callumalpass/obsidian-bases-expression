import type { BuilderOperator } from "obsidian-bases-expression";

export interface OperatorSuggestionOptions {
  selectedId?: string;
  limit?: number;
}

export function getOperatorSuggestions(
  operators: BuilderOperator[],
  query: string,
  options: OperatorSuggestionOptions = {},
): BuilderOperator[] {
  const selectedOperator = operators.find((operator) => operator.id === options.selectedId);
  const needle = normalize(query);
  const selectedLabel = selectedOperator ? normalize(selectedOperator.label) : "";
  const selectedId = selectedOperator ? normalize(selectedOperator.id) : "";
  const effectiveNeedle = selectedOperator && (needle === selectedLabel || needle === selectedId) ? "" : needle;
  return operators
    .map((operator, index) => ({ operator, index, score: scoreOperator(operator, effectiveNeedle, options.selectedId) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, options.limit ?? 50)
    .map((item) => item.operator);
}

function scoreOperator(operator: BuilderOperator, needle: string, selectedId?: string): number {
  if (!needle) return operator.id === selectedId ? 2 : 1;
  const label = normalize(operator.label);
  const id = normalize(operator.id);
  if (label === needle || id === needle) return 100;
  if (label.startsWith(needle) || id.startsWith(needle)) return 80;
  if (label.includes(needle) || id.includes(needle)) return 50;
  if (operator.documentation && normalize(operator.documentation).includes(needle)) return 20;
  return 0;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
