import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Modal, Notice, setIcon, type App } from "obsidian";
import {
  builderNodeToFilterExpression,
  createBuilderCondition,
  createBuilderExpression,
  createBuilderGroup,
  createDefaultBuilderNode,
  findBuilderProperty,
  getBuilderOperator,
  getBuilderOperatorsForType,
  getBuilderProperties,
  parseBuilderNode,
  serializeBuilderNode,
  validateBuilderNode,
  type BuilderCondition,
  type BuilderConjunction,
  type BuilderExpression,
  type BuilderGroup,
  type BuilderNode,
  type BuilderOperator,
  type BuilderOperatorId,
  type BuilderValidationResult,
  type EvaluationContext,
  type FilterExpression,
  type FormulaLanguageSchema,
} from "obsidian-bases-expression";
import { collectObsidianBasesSchema } from "./schema.js";
import { basesExpressionEditorExtensions, type BasesExpressionEditorOptions } from "./codemirror.js";
import { BasesExpressionSuggest, BasesOperatorSuggest, BasesPropertySuggest, BasesValueSuggest } from "./suggest.js";

export interface BasesExpressionBuilderChange {
  node: BuilderNode;
  source: string;
  filter: FilterExpression;
  validation: BuilderValidationResult;
}

export interface BasesExpressionBuilderOptions {
  app: App;
  schema?: FormulaLanguageSchema;
  initialNode?: BuilderNode;
  initialExpression?: string;
  sampleContext?: EvaluationContext;
  autofocus?: boolean;
  showPreview?: boolean;
  suggestionPreviewLength?: number;
  onChange?: (change: BasesExpressionBuilderChange) => void;
  onApply?: (change: BasesExpressionBuilderChange) => void;
}

export class BasesExpressionBuilder {
  readonly app: App;
  private readonly options: BasesExpressionBuilderOptions;
  private schema: FormulaLanguageSchema;
  private node: BuilderNode;
  private containerEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private readonly suggests: Array<{ close(): void }> = [];
  private readonly editors: EditorView[] = [];
  private lastChange: BasesExpressionBuilderChange | null = null;

  constructor(options: BasesExpressionBuilderOptions) {
    this.options = options;
    this.app = options.app;
    this.schema = options.schema ?? collectObsidianBasesSchema(options.app);
    this.node = initialNodeFromOptions(options, this.schema);
  }

  mount(containerEl: HTMLElement): void {
    this.containerEl = containerEl;
    containerEl.classList.add("obe-builder");
    this.render();
  }

  destroy(): void {
    this.closeSuggests();
    this.closeEditors();
    this.containerEl?.replaceChildren();
    this.containerEl = null;
    this.summaryEl = null;
  }

  getNode(): BuilderNode {
    return structuredClone(this.node) as BuilderNode;
  }

  getSource(): string {
    return serializeBuilderNode(this.node, { schema: this.schema });
  }

  getFilter(): FilterExpression {
    return builderNodeToFilterExpression(this.node, this.schema);
  }

  setNode(node: BuilderNode): void {
    this.node = node;
    this.render();
  }

  setExpression(source: string): void {
    this.node = parseBuilderNode(source, this.schema).node;
    this.render();
  }

  setSchema(schema: FormulaLanguageSchema): void {
    this.schema = schema;
    this.render();
  }

  apply(): BasesExpressionBuilderChange {
    const change = this.emitChange();
    this.options.onApply?.(change);
    return change;
  }

  private render(): void {
    const containerEl = this.containerEl;
    if (!containerEl) return;
    this.closeSuggests();
    this.closeEditors();
    containerEl.replaceChildren();

    const body = document.createElement("div");
    body.className = "bases-query-container obe-builder-body";
    containerEl.appendChild(body);
    this.renderNode(this.node, body, { index: 0, parent: null });

    if (this.options.showPreview ?? true) {
      this.summaryEl = document.createElement("div");
      this.summaryEl.className = "obe-builder-summary";
      containerEl.appendChild(this.summaryEl);
    }

    this.updateSummary();
    if (this.options.autofocus) {
      queueMicrotask(() => {
        containerEl.querySelector<HTMLElement>("input, textarea, select, .cm-content")?.focus();
      });
    }
  }

  private renderNode(node: BuilderNode, parentEl: HTMLElement, context: RenderContext): void {
    if (node.kind === "group") {
      this.renderGroup(node, parentEl, context);
    } else {
      this.renderRow(node, parentEl, context);
    }
  }

  private renderGroup(group: BuilderGroup, parentEl: HTMLElement, context: RenderContext): void {
    const groupEl = document.createElement("div");
    groupEl.className = "filter-group obe-builder-group";
    parentEl.appendChild(groupEl);

    const headerEl = document.createElement("div");
    headerEl.className = "filter-group-header";
    groupEl.appendChild(headerEl);

    const selectEl = document.createElement("select");
    selectEl.className = "conjunction dropdown";
    for (const option of conjunctionOptions) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      optionEl.selected = group.conjunction === option.value;
      selectEl.appendChild(optionEl);
    }
    selectEl.addEventListener("change", () => {
      group.conjunction = selectEl.value as BuilderConjunction;
      this.updateSummary();
      this.render();
    });
    headerEl.appendChild(selectEl);

    const headerActions = document.createElement("div");
    headerActions.className = "filter-group-header-actions";
    headerEl.appendChild(headerActions);
    const parentGroup = context.parent;
    if (parentGroup) {
      headerActions.appendChild(iconButton("trash-2", "Remove filter group", () => {
        removeChild(parentGroup, group);
        this.render();
      }));
    }

    const statementsEl = document.createElement("div");
    statementsEl.className = "filter-group-statements";
    groupEl.appendChild(statementsEl);
    group.children.forEach((child, index) => {
      this.renderNode(child, statementsEl, { index, parent: group });
    });

    const actionsEl = document.createElement("div");
    actionsEl.className = "filter-group-actions";
    groupEl.appendChild(actionsEl);
    actionsEl.appendChild(textIconButton("plus", "Add filter", () => {
      group.children.push(defaultCondition(this.schema));
      this.render();
    }));
    actionsEl.appendChild(textIconButton("plus", "Add advanced filter", () => {
      group.children.push(createBuilderExpression(""));
      this.render();
    }));
    actionsEl.appendChild(textIconButton("plus", "Add filter group", () => {
      group.children.push(createBuilderGroup([defaultCondition(this.schema)]));
      this.render();
    }));
  }

  private renderRow(node: BuilderCondition | BuilderExpression, parentEl: HTMLElement, context: RenderContext): void {
    const rowEl = document.createElement("div");
    rowEl.className = "filter-row";
    parentEl.appendChild(rowEl);

    const conjunctionEl = document.createElement("span");
    conjunctionEl.className = "conjunction";
    conjunctionEl.textContent = conjunctionLabel(context);
    rowEl.appendChild(conjunctionEl);

    const statementEl = document.createElement("div");
    statementEl.className = "filter-statement";
    rowEl.appendChild(statementEl);

    const expressionEl = document.createElement("div");
    expressionEl.className = node.kind === "condition"
      ? "filter-expression metadata-property obe-builder-simple-row"
      : "filter-expression metadata-property obe-builder-advanced-row";
    statementEl.appendChild(expressionEl);

    const errorEl = document.createElement("div");
    errorEl.className = "filter-row-error";
    const refreshRowError = () => this.updateRowError(node, errorEl);

    if (node.kind === "condition") this.renderCondition(node, expressionEl, refreshRowError);
    else this.renderExpression(node, expressionEl, refreshRowError);

    const actionsEl = document.createElement("div");
    actionsEl.className = "filter-row-actions";
    expressionEl.appendChild(actionsEl);
    actionsEl.appendChild(iconButton(
      node.kind === "condition" ? "code-xml" : "mouse-pointer-click",
      node.kind === "condition" ? "Advanced filter" : "Simple filter",
      () => this.toggleRowMode(node, context.parent),
    ));
    actionsEl.appendChild(iconButton("trash-2", "Remove filter", () => {
      if (context.parent) removeChild(context.parent, node);
      this.render();
    }));

    this.updateRowError(node, errorEl);
    statementEl.appendChild(errorEl);
  }

  private renderCondition(condition: BuilderCondition, expressionEl: HTMLElement, refreshRowError: () => void): void {
    const property = findBuilderProperty(this.schema, condition.property);
    const lhsEl = document.createElement("div");
    lhsEl.className = "filter-lhs-container";
    expressionEl.appendChild(lhsEl);

    const propertyInput = document.createElement("input");
    propertyInput.className = "metadata-input metadata-input-text obe-builder-property-input";
    propertyInput.type = "text";
    propertyInput.placeholder = "Property";
    propertyInput.value = condition.property;
    lhsEl.appendChild(propertyInput);
    this.suggests.push(new BasesPropertySuggest(this.app, propertyInput, {
      schema: this.schema,
      ...this.suggestionPreviewOptions(),
      onSelect: (selected) => {
        condition.property = selected.id;
        const operators = getBuilderOperatorsForType(selected.type);
        if (!operators.some((operator) => operator.id === condition.operator)) {
          condition.operator = operators[0]?.id ?? "is";
        }
        this.render();
      },
    }));
    propertyInput.addEventListener("input", () => {
      condition.property = propertyInput.value;
      this.updateSummary();
      refreshRowError();
    });
    propertyInput.addEventListener("change", () => this.render());

    const warningEl = document.createElement("div");
    warningEl.className = "clickable-icon metadata-property-warning-icon";
    warningEl.ariaLabel = "Type mismatch";
    warningEl.style.display = "none";
    setIcon(warningEl, "alert-triangle");
    lhsEl.appendChild(warningEl);

    const operators = getBuilderOperatorsForType(property?.type);
    const operator = getBuilderOperator(condition.operator) ?? operators[0];
    if (operator) {
      if (condition.operator !== operator.id) condition.operator = operator.id;
      this.renderOperatorInput(condition, operator, operators, expressionEl);
      this.renderValueInput(condition, operator, property?.type, expressionEl, refreshRowError);
    }
  }

  private renderOperatorInput(
    condition: BuilderCondition,
    selected: BuilderOperator,
    operators: BuilderOperator[],
    expressionEl: HTMLElement,
  ): void {
    const inputEl = document.createElement("input");
    inputEl.className = "metadata-input metadata-input-text filter-operator obe-builder-operator-input";
    inputEl.type = "text";
    inputEl.autocomplete = "off";
    inputEl.spellcheck = false;
    inputEl.ariaLabel = "Operator";
    inputEl.value = selected.label;
    inputEl.addEventListener("focus", () => inputEl.select());
    expressionEl.appendChild(inputEl);
    this.suggests.push(new BasesOperatorSuggest(this.app, inputEl, {
      operators,
      selected: () => condition.operator,
      ...this.suggestionPreviewOptions(),
      onSelect: (operator) => {
        if (condition.operator === operator.id) return;
        condition.operator = operator.id;
        this.render();
      },
    }));
  }

  private renderValueInput(
    condition: BuilderCondition,
    operator: BuilderOperator,
    type: string | undefined,
    expressionEl: HTMLElement,
    refreshRowError: () => void,
  ): void {
    const rhsEl = document.createElement("div");
    rhsEl.className = "filter-rhs-container metadata-property-value";
    expressionEl.appendChild(rhsEl);
    if (operator.valueKind === "none") {
      rhsEl.style.display = "none";
      return;
    }

    if (type === "boolean" || operator.valueKind === "boolean") {
      const selectEl = document.createElement("select");
      selectEl.className = "dropdown";
      for (const value of ["true", "false"]) {
        const optionEl = document.createElement("option");
        optionEl.value = value;
        optionEl.textContent = value;
        optionEl.selected = String(condition.value ?? "true") === value;
        selectEl.appendChild(optionEl);
      }
      selectEl.addEventListener("change", () => {
        condition.value = selectEl.value === "true";
        this.updateSummary();
        refreshRowError();
      });
      rhsEl.appendChild(selectEl);
      return;
    }

    const inputEl = document.createElement("input");
    inputEl.className = "metadata-input metadata-input-text";
    inputEl.type = inputTypeForValue(operator, type);
    inputEl.placeholder = "Empty";
    inputEl.value = condition.value === undefined || condition.value === null ? "" : String(condition.value);
    inputEl.addEventListener("input", () => {
      condition.value = inputEl.value;
      this.updateSummary();
      refreshRowError();
    });
    rhsEl.appendChild(inputEl);
    if (condition.valueSource === "expression") {
      this.suggests.push(new BasesExpressionSuggest(this.app, inputEl, {
        schema: this.schema,
        ...this.suggestionPreviewOptions(),
      }));
    } else {
      this.suggests.push(new BasesValueSuggest(this.app, inputEl, {
        schema: this.schema,
        property: () => condition.property,
        ...this.suggestionPreviewOptions(),
        onSelect: (suggestion) => {
          condition.value = suggestion.value;
          this.updateSummary();
          refreshRowError();
        },
      }));
    }
  }

  private renderExpression(expression: BuilderExpression, expressionEl: HTMLElement, refreshRowError: () => void): void {
    const editorContainer = document.createElement("div");
    editorContainer.className = "formula-editor-container node-insert-event obe-builder-expression-editor";
    expressionEl.appendChild(editorContainer);
    const state = EditorState.create({
      doc: expression.source,
      extensions: [
        ...basesExpressionEditorExtensions(this.expressionEditorOptions()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          expression.source = update.state.doc.toString();
          this.updateSummary();
          refreshRowError();
        }),
      ],
    });
    const view = new EditorView({
      state,
      parent: editorContainer,
    });
    this.editors.push(view);
  }

  private suggestionPreviewOptions(): { maxPreviewLength?: number } {
    return this.options.suggestionPreviewLength === undefined
      ? {}
      : { maxPreviewLength: this.options.suggestionPreviewLength };
  }

  private toggleRowMode(node: BuilderCondition | BuilderExpression, parent: BuilderGroup | null): void {
    if (!parent) {
      this.node = node.kind === "condition"
        ? createBuilderExpression(serializeBuilderNode(node, { schema: this.schema }))
        : parseBuilderNode(node.source, this.schema).node;
      this.render();
      return;
    }
    const index = parent.children.indexOf(node);
    if (index < 0) return;
    if (node.kind === "condition") {
      parent.children[index] = createBuilderExpression(serializeBuilderNode(node, { schema: this.schema }));
    } else {
      parent.children[index] = parseBuilderNode(node.source, this.schema).node;
    }
    this.render();
  }

  private rowIssue(node: BuilderNode): { message: string } | null {
    const validation = validateBuilderNode(node, this.schema, validationOptions(this.options));
    const error = validation.issues.find((issue) => issue.severity === "error")
      ?? validation.issues.find((issue) => issue.severity === "warning")
      ?? validation.diagnostics.find((diagnostic) => diagnostic.severity === "error")
      ?? validation.diagnostics.find((diagnostic) => diagnostic.severity === "warning");
    return error ? { message: error.message } : null;
  }

  private updateRowError(node: BuilderNode, errorEl: HTMLElement): void {
    const rowIssue = this.rowIssue(node);
    if (rowIssue) {
      errorEl.textContent = rowIssue.message;
      errorEl.style.display = "";
    } else {
      errorEl.textContent = "";
      errorEl.style.display = "none";
    }
  }

  private updateSummary(): void {
    const change = this.emitChange();
    if (!this.summaryEl) return;
    this.summaryEl.replaceChildren();
    const statusEl = document.createElement("div");
    statusEl.className = `obe-builder-status ${change.validation.valid ? "is-valid" : "is-invalid"}`;
    statusEl.textContent = change.validation.valid ? "Valid expression" : "Needs attention";
    this.summaryEl.appendChild(statusEl);

    const codeEl = document.createElement("code");
    codeEl.className = "obe-builder-source";
    codeEl.textContent = change.source;
    this.summaryEl.appendChild(codeEl);

    const messages = [
      ...change.validation.issues.map((issue) => issue.message),
      ...change.validation.diagnostics.map((diagnostic) => diagnostic.message),
    ];
    if (messages.length) {
      const listEl = document.createElement("ul");
      listEl.className = "obe-builder-messages";
      for (const message of messages.slice(0, 4)) {
        const itemEl = document.createElement("li");
        itemEl.textContent = message;
        listEl.appendChild(itemEl);
      }
      this.summaryEl.appendChild(listEl);
    }
  }

  private emitChange(): BasesExpressionBuilderChange {
    const validation = validateBuilderNode(this.node, this.schema, validationOptions(this.options));
    const change: BasesExpressionBuilderChange = {
      node: this.getNode(),
      source: validation.source,
      filter: validation.filter,
      validation,
    };
    this.lastChange = change;
    this.options.onChange?.(change);
    return change;
  }

  private closeSuggests(): void {
    for (const suggest of this.suggests.splice(0)) {
      suggest.close();
    }
  }

  private closeEditors(): void {
    for (const editor of this.editors.splice(0)) {
      editor.destroy();
    }
  }

  private expressionEditorOptions(): BasesExpressionEditorOptions {
    const options: BasesExpressionEditorOptions = { schema: this.schema };
    if (this.options.sampleContext) {
      options.validation = { context: this.options.sampleContext };
    }
    return options;
  }
}

export class BasesExpressionBuilderModal extends Modal {
  private readonly builderOptions: Omit<BasesExpressionBuilderOptions, "app">;
  private builder: BasesExpressionBuilder | null = null;

  constructor(app: App, options: Omit<BasesExpressionBuilderOptions, "app"> = {}) {
    super(app);
    this.builderOptions = options;
  }

  override onOpen(): void {
    this.titleEl.setText("Expression builder");
    this.contentEl.replaceChildren();
    const builderHost = document.createElement("div");
    this.contentEl.appendChild(builderHost);
    this.builder = new BasesExpressionBuilder({
      app: this.app,
      ...this.builderOptions,
      onApply: (change) => {
        this.builderOptions.onApply?.(change);
        new Notice("Expression applied");
        this.close();
      },
    });
    this.builder.mount(builderHost);

    const footer = document.createElement("div");
    footer.className = "modal-button-container obe-builder-modal-actions";
    this.contentEl.appendChild(footer);
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => this.close());
    footer.appendChild(cancelButton);
    const applyButton = document.createElement("button");
    applyButton.className = "mod-cta";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", () => this.builder?.apply());
    footer.appendChild(applyButton);
  }

  override onClose(): void {
    this.builder?.destroy();
    this.builder = null;
    this.contentEl.replaceChildren();
  }
}

export function openBasesExpressionBuilder(app: App, options: Omit<BasesExpressionBuilderOptions, "app"> = {}): BasesExpressionBuilderModal {
  const modal = new BasesExpressionBuilderModal(app, options);
  modal.open();
  return modal;
}

interface RenderContext {
  index: number;
  parent: BuilderGroup | null;
}

const conjunctionOptions: Array<{ value: BuilderConjunction; label: string }> = [
  { value: "and", label: "All the following are true" },
  { value: "or", label: "Any of the following are true" },
  { value: "not", label: "None of the following are true" },
];

function initialNodeFromOptions(options: BasesExpressionBuilderOptions, schema: FormulaLanguageSchema): BuilderNode {
  if (options.initialNode) return structuredClone(options.initialNode) as BuilderNode;
  if (options.initialExpression) return createBuilderGroup([parseBuilderNode(options.initialExpression, schema).node]);
  return createDefaultBuilderNode(schema);
}

function defaultCondition(schema: FormulaLanguageSchema): BuilderCondition {
  const property = getBuilderProperties(schema)[0]?.id ?? "file.name";
  return createBuilderCondition(property, "is", "");
}

function removeChild(group: BuilderGroup, child: BuilderNode): void {
  const index = group.children.indexOf(child);
  if (index >= 0) group.children.splice(index, 1);
}

function conjunctionLabel(context: RenderContext): string {
  if (!context.parent || context.index === 0) return "where";
  if (context.parent.conjunction === "or") return "or";
  if (context.parent.conjunction === "not") return "not";
  return "and";
}

function validationOptions(options: BasesExpressionBuilderOptions) {
  return options.sampleContext
    ? { context: options.sampleContext, runEvaluation: true }
    : {};
}

function inputTypeForValue(operator: BuilderOperator, type: string | undefined): string {
  if (operator.valueKind === "number" || type === "number") return "number";
  if (operator.valueKind === "date" || type === "date") return "date";
  if (operator.valueKind === "datetime") return "datetime-local";
  return "text";
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "clickable-icon";
  button.type = "button";
  button.ariaLabel = label;
  setIcon(button, icon);
  button.addEventListener("click", onClick);
  return button;
}

function textIconButton(icon: string, label: string, onClick: () => void): HTMLDivElement {
  const button = document.createElement("div");
  button.className = "text-icon-button";
  button.tabIndex = 0;
  button.role = "button";
  const iconEl = document.createElement("span");
  iconEl.className = "text-button-icon";
  setIcon(iconEl, icon);
  button.appendChild(iconEl);
  const labelEl = document.createElement("span");
  labelEl.className = "text-button-label";
  labelEl.textContent = label;
  button.appendChild(labelEl);
  button.addEventListener("click", onClick);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  });
  return button;
}
