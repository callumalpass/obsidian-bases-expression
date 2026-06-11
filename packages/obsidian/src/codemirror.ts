import { autocompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { linter } from "@codemirror/lint";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, hoverTooltip, keymap, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import {
  completeExpression,
  getHoverInfo,
  tokenize,
  toCodeMirrorCompletions,
  toCodeMirrorDiagnostics,
  validateExpression,
  type Token,
  type FormulaLanguageSchema,
  type ValidationOptions,
} from "obsidian-bases-expression";

export interface BasesExpressionEditorOptions {
  schema?: FormulaLanguageSchema;
  validation?: ValidationOptions;
  activateOnTyping?: boolean;
}

export function basesExpressionCompletionSource(options: BasesExpressionEditorOptions = {}): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const source = context.state.doc.toString();
    const coreCompletions = completeExpression(source, context.pos, options.schema ?? {});
    const token = context.matchBefore(/[A-Za-z_$][\w$]*$/) ?? context.matchBefore(/[A-Za-z_$][\w$.]*$/);
    if (!coreCompletions.length && !token && !context.explicit) return null;
    if (!coreCompletions.length) return null;
    const completions = toCodeMirrorCompletions(coreCompletions);
    const from = completions[0]?.from ?? token?.from ?? context.pos;
    const to = completions[0]?.to ?? context.pos;
    return {
      from,
      to,
      options: completions.map((item): Completion => {
        const completion: Completion = {
          label: item.label,
          type: item.type,
          apply: item.apply,
        };
        if (item.detail) completion.detail = item.detail;
        if (item.info) completion.info = item.info;
        return completion;
      }),
      validFor: coreCompletions.some((item) => item.kind === "value") ? /^[^"'),\]}]*$/ : /^[A-Za-z_$][\w$]*$/,
    };
  };
}

export function basesExpressionLinter(options: BasesExpressionEditorOptions = {}): Extension {
  return linter((view) => {
    const diagnostics = validateExpression(
      view.state.doc.toString(),
      options.schema ?? {},
      options.validation?.context,
    );
    return toCodeMirrorDiagnostics(diagnostics);
  });
}

export function basesExpressionHover(options: BasesExpressionEditorOptions = {}): Extension {
  return hoverTooltip((view, position) => {
    const source = view.state.doc.toString();
    const hover = getHoverInfo(source, position, options.schema ?? {});
    if (!hover) return null;
    return {
      pos: hover.span.start,
      end: hover.span.end,
      create() {
        const dom = document.createElement("div");
        dom.className = "obe-builder-cm-hover";
        const label = document.createElement("div");
        label.className = "obe-builder-cm-hover-label";
        label.textContent = hover.label;
        dom.appendChild(label);
        if (hover.detail) {
          const detail = document.createElement("div");
          detail.className = "obe-builder-cm-hover-detail";
          detail.textContent = hover.detail;
          dom.appendChild(detail);
        }
        if (hover.documentation) {
          const documentation = document.createElement("div");
          documentation.className = "obe-builder-cm-hover-doc";
          documentation.textContent = hover.documentation;
          dom.appendChild(documentation);
        }
        return { dom };
      },
    };
  });
}

export function basesExpressionEditorExtensions(options: BasesExpressionEditorOptions = {}): Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    basesExpressionSyntaxHighlighting(),
    autocompletion({
      activateOnTyping: options.activateOnTyping ?? true,
      override: [basesExpressionCompletionSource(options)],
    }),
    basesExpressionLinter(options),
    basesExpressionHover(options),
  ];
}

export function basesExpressionSyntaxHighlighting(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildTokenDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildTokenDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function buildTokenDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { tokens } = tokenize(view.state.doc.toString());
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.type === "eof" || token.start === token.end) continue;
    const className = tokenClass(token, tokens[index + 1], tokens[index - 1]);
    if (!className) continue;
    builder.add(token.start, token.end, Decoration.mark({ class: className }));
  }
  return builder.finish();
}

function tokenClass(token: Token, next: Token | undefined, previous: Token | undefined): string | null {
  if (token.type === "string") return "obe-builder-cm-token-string";
  if (token.type === "number") return "obe-builder-cm-token-number";
  if (token.type === "regex") return "obe-builder-cm-token-regex";
  if (token.type === "operator") return "obe-builder-cm-token-operator";
  if (token.type === "punct") return "obe-builder-cm-token-punctuation";
  if (token.type !== "identifier") return null;
  if (["true", "false", "null"].includes(token.value)) return "obe-builder-cm-token-constant";
  if (["file", "note", "formula", "this"].includes(token.value)) return "obe-builder-cm-token-keyword";
  if (next?.value === "(") return "obe-builder-cm-token-function";
  if (previous?.value === ".") return "obe-builder-cm-token-property";
  return "obe-builder-cm-token-identifier";
}
