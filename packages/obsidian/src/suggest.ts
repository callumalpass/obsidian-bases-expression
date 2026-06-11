import { AbstractInputSuggest, setIcon, type App } from "obsidian";
import {
  completeExpression,
  type BuilderOperator,
  getBuilderProperties,
  type BuilderProperty,
  type CompletionItem,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";
import { getOperatorSuggestions } from "./operator-suggestions.js";
import { getValueSuggestions, type ValueSuggestion } from "./value-suggestions.js";

export interface PropertySuggestOptions {
  schema: FormulaLanguageSchema;
  onSelect?: (property: BuilderProperty) => void;
  limit?: number;
  maxPreviewLength?: number;
}

export interface ExpressionSuggestOptions {
  schema: FormulaLanguageSchema;
  onSelect?: (item: ExpressionSuggestion) => void;
  limit?: number;
  maxPreviewLength?: number;
}

export interface ValueSuggestOptions {
  schema: FormulaLanguageSchema;
  property: string | (() => string);
  onSelect?: (item: ValueSuggestion) => void;
  limit?: number;
  maxPreviewLength?: number;
}

export interface OperatorSuggestOptions {
  operators: BuilderOperator[] | (() => BuilderOperator[]);
  selected?: string | (() => string | undefined);
  onSelect?: (operator: BuilderOperator) => void;
  limit?: number;
  maxPreviewLength?: number;
}

export interface ExpressionSuggestion {
  label: string;
  insertText: string;
  from?: number;
  to?: number;
  detail?: string;
  documentation?: string;
  type: "property" | "function" | "keyword" | "operator" | "value" | "snippet";
  value?: unknown;
}

const expressionSnippets: ExpressionSuggestion[] = [
  {
    label: "if(condition, then, else)",
    insertText: "if(, , )",
    detail: "Conditional result",
    documentation: "Use for branching formulas and filters.",
    type: "snippet",
  },
  {
    label: "today()",
    insertText: "today()",
    detail: "Current date",
    type: "snippet",
  },
  {
    label: "file.hasTag()",
    insertText: "file.hasTag(\"\")",
    detail: "Check file tags",
    type: "snippet",
  },
  {
    label: "file.hasLink()",
    insertText: "file.hasLink(\"\")",
    detail: "Check outgoing links",
    type: "snippet",
  },
];

export class BasesPropertySuggest extends AbstractInputSuggest<BuilderProperty> {
  private readonly options: PropertySuggestOptions;
  private readonly inputElRef: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement, options: PropertySuggestOptions) {
    super(app, inputEl);
    this.inputElRef = inputEl;
    this.options = options;
  }

  getSuggestions(query: string): BuilderProperty[] {
    const needle = normalize(query);
    return getBuilderProperties(this.options.schema)
      .map((property) => ({ property, score: scoreProperty(property, needle) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.property.label.localeCompare(b.property.label))
      .slice(0, this.options.limit ?? 50)
      .map((item) => item.property);
  }

  renderSuggestion(property: BuilderProperty, el: HTMLElement): void {
    renderSuggestionShell(el, {
      title: property.label,
      icon: iconForProperty(property),
      right: propertyRightText(property),
      note: property.source === "note" ? property.documentation : undefined,
      maxPreviewLength: this.options.maxPreviewLength,
    });
    el.classList.add(`obe-builder-suggestion-source-${property.source}`);
  }

  selectSuggestion(property: BuilderProperty): void {
    this.inputElRef.value = property.id;
    this.inputElRef.dispatchEvent(new Event("input", { bubbles: true }));
    this.options.onSelect?.(property);
    this.close();
  }
}

export class BasesOperatorSuggest extends AbstractInputSuggest<BuilderOperator> {
  private readonly options: OperatorSuggestOptions;
  private readonly inputElRef: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement, options: OperatorSuggestOptions) {
    super(app, inputEl);
    this.inputElRef = inputEl;
    this.options = options;
    this.inputElRef.addEventListener("focus", () => this.requestSuggestions());
    this.inputElRef.addEventListener("click", () => this.requestSuggestions());
    this.inputElRef.addEventListener("blur", () => {
      window.setTimeout(() => this.restoreSelectedLabel(), 0);
    });
  }

  getSuggestions(query: string): BuilderOperator[] {
    const selectedId = currentSelected(this.options.selected);
    return getOperatorSuggestions(currentOperators(this.options.operators), query, {
      ...(selectedId === undefined ? {} : { selectedId }),
      ...(this.options.limit === undefined ? {} : { limit: this.options.limit }),
    });
  }

  renderSuggestion(operator: BuilderOperator, el: HTMLElement): void {
    renderSuggestionShell(el, {
      title: operator.label,
      icon: iconForOperator(operator),
      right: operator.valueKind === "none" ? "No value" : valueKindLabel(operator.valueKind),
      note: operator.documentation,
      maxPreviewLength: this.options.maxPreviewLength,
    });
    el.classList.add("obe-builder-suggestion-type-operator");
    if (operator.id === currentSelected(this.options.selected)) el.classList.add("is-selected");
  }

  selectSuggestion(operator: BuilderOperator): void {
    this.inputElRef.value = operator.label;
    this.inputElRef.dispatchEvent(new Event("input", { bubbles: true }));
    this.options.onSelect?.(operator);
    this.close();
  }

  private requestSuggestions(): void {
    requestAnimationFrame(() => {
      this.inputElRef.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  private restoreSelectedLabel(): void {
    const selectedId = currentSelected(this.options.selected);
    const selectedOperator = currentOperators(this.options.operators).find((operator) => operator.id === selectedId);
    if (selectedOperator) this.inputElRef.value = selectedOperator.label;
  }
}

export class BasesExpressionSuggest extends AbstractInputSuggest<ExpressionSuggestion> {
  private readonly options: ExpressionSuggestOptions;
  private readonly inputElRef: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement, options: ExpressionSuggestOptions) {
    super(app, inputEl);
    this.inputElRef = inputEl;
    this.options = options;
  }

  getSuggestions(query: string): ExpressionSuggestion[] {
    const cursor = selectionStart(this.inputElRef);
    const completions = completeExpression(query, cursor, this.options.schema).map(completionToSuggestion);
    const prefix = currentPrefix(query, cursor).toLowerCase();
    const snippets = expressionSnippets.filter((item) => !prefix || item.label.toLowerCase().includes(prefix));
    return dedupeSuggestions([...completions, ...snippets])
      .slice(0, this.options.limit ?? 60);
  }

  renderSuggestion(item: ExpressionSuggestion, el: HTMLElement): void {
    renderSuggestionShell(el, {
      title: item.label,
      icon: iconForExpressionSuggestion(item),
      right: item.detail ?? item.type,
      note: item.documentation,
      maxPreviewLength: this.options.maxPreviewLength,
    });
    el.classList.add(`obe-builder-suggestion-type-${item.type}`);
  }

  selectSuggestion(item: ExpressionSuggestion): void {
    const cursor = selectionStart(this.inputElRef);
    const range = item.from !== undefined
      ? { from: item.from, to: item.to ?? cursor }
      : item.type === "value"
      ? valuePrefixRange(this.inputElRef.value, cursor)
      : currentPrefixRange(this.inputElRef.value, cursor);
    const from = range.from;
    const to = range.to;
    const before = this.inputElRef.value.slice(0, from);
    const after = this.inputElRef.value.slice(to);
    this.inputElRef.value = `${before}${item.insertText}${after}`;
    const nextCursor = cursorPositionAfterInsert(before.length, item.insertText);
    this.inputElRef.setSelectionRange(nextCursor, nextCursor);
    this.inputElRef.dispatchEvent(new Event("input", { bubbles: true }));
    this.options.onSelect?.(item);
    this.close();
  }
}

export class BasesValueSuggest extends AbstractInputSuggest<ValueSuggestion> {
  private readonly options: ValueSuggestOptions;
  private readonly inputElRef: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement, options: ValueSuggestOptions) {
    super(app, inputEl);
    this.inputElRef = inputEl;
    this.options = options;
  }

  getSuggestions(query: string): ValueSuggestion[] {
    return getValueSuggestions(
      this.options.schema,
      currentProperty(this.options.property),
      query,
      this.options.limit === undefined ? {} : { limit: this.options.limit },
    );
  }

  renderSuggestion(item: ValueSuggestion, el: HTMLElement): void {
    renderSuggestionShell(el, {
      title: item.label,
      icon: iconForType(item.type),
      right: item.detail ?? item.type,
      note: item.documentation,
      maxPreviewLength: this.options.maxPreviewLength,
    });
    el.classList.add("obe-builder-suggestion-type-value");
  }

  selectSuggestion(item: ValueSuggestion): void {
    this.inputElRef.value = item.insertText;
    this.inputElRef.dispatchEvent(new Event("input", { bubbles: true }));
    this.options.onSelect?.(item);
    this.close();
  }
}

function completionToSuggestion(item: CompletionItem): ExpressionSuggestion {
  const suggestion: ExpressionSuggestion = {
    label: item.label,
    insertText: item.insertText,
    type: item.kind,
  };
  if (item.detail) suggestion.detail = item.detail;
  if (item.documentation) suggestion.documentation = item.documentation;
  if ("value" in item) suggestion.value = item.value;
  if (item.from !== undefined) suggestion.from = item.from;
  if (item.to !== undefined) suggestion.to = item.to;
  return suggestion;
}

interface SuggestionRenderOptions {
  title: string;
  icon?: string | undefined;
  right?: string | undefined;
  note?: string | undefined;
  maxPreviewLength?: number | undefined;
}

function renderSuggestionShell(el: HTMLElement, options: SuggestionRenderOptions): void {
  el.replaceChildren();
  el.classList.add("obe-builder-suggestion");
  const iconEl = document.createElement("span");
  iconEl.className = "obe-builder-suggestion-icon";
  setIcon(iconEl, options.icon ?? "circle");
  el.appendChild(iconEl);

  const bodyEl = document.createElement("span");
  bodyEl.className = "obe-builder-suggestion-body";
  el.appendChild(bodyEl);

  const titleEl = document.createElement("div");
  titleEl.className = "suggestion-title";
  titleEl.textContent = options.title;
  bodyEl.appendChild(titleEl);

  if (options.note) {
    const noteEl = document.createElement("div");
    noteEl.className = "suggestion-note";
    noteEl.textContent = truncateText(options.note, options.maxPreviewLength ?? 96);
    if (noteEl.textContent !== options.note) noteEl.title = options.note;
    bodyEl.appendChild(noteEl);
  }

  if (options.right) {
    const detailEl = document.createElement("span");
    detailEl.className = "suggestion-aux";
    detailEl.textContent = truncateText(options.right, options.maxPreviewLength ?? 96);
    if (detailEl.textContent !== options.right) detailEl.title = options.right;
    el.appendChild(detailEl);
  }
}

function propertyRightText(property: BuilderProperty): string | undefined {
  if (property.id !== property.label) return property.id;
  if (property.id === property.type) return undefined;
  return property.detail ?? property.type;
}

function iconForProperty(property: BuilderProperty): string {
  if (property.id === "file" || property.type === "file") return "file";
  if (property.source === "formula") return "sigma";
  return iconForType(property.type);
}

function iconForType(type: string | undefined): string {
  switch (type) {
    case "boolean":
      return "toggle-left";
    case "number":
      return "hash";
    case "date":
      return "clock";
    case "duration":
      return "timer";
    case "list":
      return "list";
    case "object":
      return "braces";
    case "file":
      return "file";
    case "link":
      return "link";
    case "regexp":
      return "regex";
    case "html":
      return "code";
    case "image":
      return "image";
    case "icon":
      return "badge";
    case "boolean | string":
      return "toggle-left";
    case "string":
    default:
      return "text";
  }
}

function iconForOperator(operator: BuilderOperator): string {
  if (operator.id === "contains" || operator.id === "not-contains") return "search";
  if (operator.id === "starts-with" || operator.id === "ends-with") return "text-cursor-input";
  if (operator.id.includes("greater") || operator.id.includes("less")) return "chevrons-left-right";
  if (operator.id === "is-empty" || operator.id === "is-not-empty") return "circle-off";
  if (operator.id === "is-true" || operator.id === "is-false") return "toggle-left";
  if (operator.id === "has-tag" || operator.id === "not-has-tag") return "tag";
  if (operator.id === "links-to" || operator.id === "not-links-to") return "link";
  if (operator.id === "matches") return "regex";
  return "equal";
}

function iconForExpressionSuggestion(item: ExpressionSuggestion): string {
  switch (item.type) {
    case "function":
    case "snippet":
      return "braces";
    case "keyword":
      return "key";
    case "operator":
      return "equal";
    case "value":
      return iconForType(typeFromValue(item.value));
    case "property":
    default:
      return "text";
  }
}

function typeFromValue(value: unknown): string | undefined {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? typeof value
    : undefined;
}

function valueKindLabel(valueKind: BuilderOperator["valueKind"]): string | undefined {
  if (valueKind === "any") return undefined;
  if (valueKind === "regexp") return "regex";
  return valueKind;
}

function scoreProperty(property: BuilderProperty, needle: string): number {
  if (!needle) return 1;
  const label = normalize(property.label);
  const id = normalize(property.id);
  if (id === needle || label === needle) return 100;
  if (id.startsWith(needle) || label.startsWith(needle)) return 80;
  if (id.includes(needle) || label.includes(needle)) return 50;
  if (property.detail && normalize(property.detail).includes(needle)) return 20;
  return 0;
}

function dedupeSuggestions(items: ExpressionSuggestion[]): ExpressionSuggestion[] {
  const seen = new Set<string>();
  const result: ExpressionSuggestion[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function currentProperty(property: string | (() => string)): string {
  return typeof property === "function" ? property() : property;
}

function currentOperators(operators: BuilderOperator[] | (() => BuilderOperator[])): BuilderOperator[] {
  return typeof operators === "function" ? operators() : operators;
}

function currentSelected(selected: string | (() => string | undefined) | undefined): string | undefined {
  return typeof selected === "function" ? selected() : selected;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function currentPrefix(source: string, position: number): string {
  const range = currentPrefixRange(source, position);
  return source.slice(range.from, range.to);
}

function currentPrefixRange(source: string, position: number): { from: number; to: number } {
  const before = source.slice(0, position);
  const prefix = before.match(/[A-Za-z_$][\w$]*$/)?.[0] ?? "";
  return { from: position - prefix.length, to: position };
}

function valuePrefixRange(source: string, position: number): { from: number; to: number } {
  const before = source.slice(0, position);
  const quoteIndex = lastOpenQuoteIndex(before);
  if (quoteIndex >= 0) return { from: quoteIndex + 1, to: position };
  const raw = before.match(/[^\s,)\]}]*$/)?.[0] ?? "";
  return { from: position - raw.length, to: position };
}

function selectionStart(inputEl: HTMLInputElement | HTMLTextAreaElement): number {
  return inputEl.selectionStart ?? inputEl.value.length;
}

function cursorPositionAfterInsert(start: number, insertText: string): number {
  const emptyCall = insertText.match(/\(\)$/);
  if (emptyCall) return start + insertText.length - 1;
  const firstEmptyString = insertText.indexOf("\"\"");
  if (firstEmptyString >= 0) return start + firstEmptyString + 1;
  const firstCommaGap = insertText.indexOf("(,");
  if (firstCommaGap >= 0) return start + firstCommaGap + 1;
  return start + insertText.length;
}

function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function lastOpenQuoteIndex(source: string): number {
  let quote: string | null = null;
  let quoteIndex = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if ((char === "\"" || char === "'") && !isEscaped(source, index)) {
      if (quote === char) {
        quote = null;
        quoteIndex = -1;
      } else if (!quote) {
        quote = char;
        quoteIndex = index;
      }
    }
  }
  return quoteIndex;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}
