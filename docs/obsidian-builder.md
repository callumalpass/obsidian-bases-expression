# Obsidian Builder Package

`obsidian-bases-expression-builder` is the Obsidian-facing companion package for `obsidian-bases-expression`.

The split is intentional:

- `obsidian-bases-expression` stays host-agnostic and owns parsing, evaluation, diagnostics, compatibility metadata, language tooling, and headless builder serialization.
- `obsidian-bases-expression-builder` owns Obsidian integration: schema collection from `metadataCache`, native-looking builder controls, value/property/expression suggestions, modal/view mounting, and CodeMirror extension helpers.

## Peer Dependencies

The package declares these as peers:

- `obsidian`
- `obsidian-bases-expression`
- `@codemirror/autocomplete`
- `@codemirror/commands`
- `@codemirror/lint`
- `@codemirror/state`
- `@codemirror/view`

Consumer plugins should bundle `obsidian-bases-expression-builder` if desired, but should keep `obsidian` and CodeMirror host packages external in their Obsidian plugin build.

## UI Surfaces

Use `BasesExpressionBuilderModal` for the standard modal workflow:

```ts
new BasesExpressionBuilderModal(app, {
  schema: collectObsidianBasesSchema(app),
  initialExpression: 'status == "Todo"',
  onApply: ({ source }) => {
    console.log(source);
  },
}).open();
```

Use `BasesExpressionBuilder` for embedded settings panes or custom views:

```ts
const builder = new BasesExpressionBuilder({
  app,
  schema: collectObsidianBasesSchema(app),
  initialExpression: 'status == "Todo"',
  onChange: ({ source, validation }) => {
    console.log(source, validation.valid);
  },
});

builder.mount(containerEl);
```

The DOM intentionally uses Obsidian/Bases vocabulary such as `filter-group`, `filter-row`, `conjunction`, `metadata-property`, `metadata-input`, `text-icon-button`, and `clickable-icon`, with package-specific classes under `obe-builder-*`.

Simple condition rows use Obsidian suggestion dropdowns for property, operator, and value inputs instead of browser-native `<select>` controls or context menus. Suggestion rows use compact type icons, primary labels, and right-aligned metadata to stay close to the native Bases picker. Advanced rows mount CodeMirror directly and use the package editor extensions for syntax highlighting, positional completions, lint diagnostics, and hover tooltips.

## Suggestions

The package offers three suggestion layers:

- `BasesPropertySuggest` ranks schema properties and shows a type icon, technical property id, occurrence count, and a truncated sample-value preview.
- `BasesOperatorSuggest` wraps type-aware builder operators in the same icon-row dropdown style as value suggestions. `getOperatorSuggestions()` exposes the pure ranking helper for custom controls.
- `BasesValueSuggest` ranks known values for the selected property and renders value type/count metadata. `collectObsidianBasesSchema()` populates these from frontmatter using `maxValuesPerProperty`, and `getValueSuggestions()` exposes the pure ranking helper without Obsidian UI.
- `BasesExpressionSuggest` uses the core language service for plain input functions/properties/value positions and adds common Bases snippets like `today()`, `if()`, `file.hasTag()`, and `file.hasLink()`.

For CodeMirror editors, use `basesExpressionEditorExtensions()` to install syntax highlighting, completions, diagnostics, and hover tooltips. `basesExpressionSyntaxHighlighting()` is exported separately when a host wants only the token styling.

Schema collection options that affect suggestions:

- `includeValueSuggestions`: disable value collection when a plugin wants property names only.
- `maxValuesPerProperty`: cap distinct values stored per property.
- `maxPreviewLength`: cap the example preview rendered in property suggestions.
- `suggestionPreviewLength`: builder option for overriding rendered suggestion preview length per builder instance.

## Smoke Plugin

`examples/dummy-obsidian-plugin` is a real Obsidian plugin that consumes the package. Its build copies `main.js`, `manifest.json`, and `styles.css` into:

```text
/home/calluma/testvault/test/.obsidian/plugins/bases-expression-builder-smoke
```

Useful local commands:

```bash
npm run build:builder
npm run build:dummy
obsidian vault=test plugin:reload id=bases-expression-builder-smoke
obsidian vault=test command id=bases-expression-builder-smoke:open-builder-view
obsidian vault=test command id=bases-expression-builder-smoke:open-builder-modal
```

The plugin writes smoke state to `window.__obeBuilderSmoke`, which makes CLI validation straightforward:

```bash
obsidian vault=test eval code="JSON.stringify(window.__obeBuilderSmoke)"
```
