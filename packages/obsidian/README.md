# obsidian-bases-expression-builder

Native Obsidian UI helpers for building, validating, and editing Bases-compatible expressions.

```ts
import {
  BasesExpressionBuilderModal,
  collectObsidianBasesSchema,
} from "obsidian-bases-expression-builder";
import "obsidian-bases-expression-builder/styles.css";

const schema = collectObsidianBasesSchema(this.app, {
  maxValuesPerProperty: 50,
  maxPreviewLength: 96,
});

new BasesExpressionBuilderModal(this.app, {
  schema,
  initialExpression: 'status == "Todo"',
  onApply: ({ source, filter, validation }) => {
    console.log(source, filter, validation.valid);
  },
}).open();
```

`obsidian`, `obsidian-bases-expression`, and CodeMirror packages are peer dependencies so consuming plugins can use the same host-provided runtime.

The schema collector infers property types, counts property usage, and records bounded value suggestions from frontmatter. The visual builder uses those values in the right-hand value field, raw expression suggestions use them in value positions like `status == "`, and property suggestion previews are truncated by `maxPreviewLength`.

Simple rows use the same Obsidian suggestion dropdown style for properties, operators, and values, with compact type icons and right-aligned metadata similar to the native Bases builder. Advanced rows use CodeMirror with Bases syntax highlighting, positional completions, lint diagnostics, and hover tooltips.

Public suggestion helpers:

- `BasesPropertySuggest` for property inputs.
- `BasesOperatorSuggest` and `getOperatorSuggestions()` for type-aware operator inputs.
- `BasesValueSuggest` and `getValueSuggestions()` for schema-backed value inputs.
- `BasesExpressionSuggest`, `basesExpressionEditorExtensions()`, and `basesExpressionSyntaxHighlighting()` for raw expression inputs.
