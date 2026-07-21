# Changelog

## Unreleased

### Added

- Added an explicit mdbase v0.3 `thisRecord` context with effective, raw,
  presence, and file namespaces while retaining Obsidian's `this.file`
  fallback for ordinary Bases evaluation.
- Added conservative `.base`-to-mdbase view conversion. Portable filters,
  formulas, columns, sorting, grouping, summaries, and presentation metadata
  are mapped structurally; behavior-changing dialect features produce explicit
  diagnostics and retain their source under `x-obsidian`.

## 0.2.0 - 2026-06-11

### Added

- Added named `objects` on evaluation contexts for host-owned expression data such as workflow events, action results, and canvas active zones.
- Added `FormulaLanguageSchema.objects` so editor integrations can complete, hover, type-check, and report dependencies for nested object paths like `trigger.zone.id` and `steps.query.total`.
- Added `compileFilter()` and `evaluateFilter()` for Obsidian Bases-style structured filter trees using expression strings plus `and`, `or`, and `not`.
- Added `inferDefaultsFromExpression()` and `inferDefaultsFromFilter()` for conservative note-creation defaults from positive equality and tag constraints.
- Added oracle compatibility metadata fields for Obsidian version/build values when the generator can discover them.
- Added headless builder primitives for type-aware condition/group editing, expression serialization, structured-filter conversion, validation, and simple-expression parsing.
- Added the `obsidian-bases-expression-builder` companion package with native Obsidian builder UI, property/value/expression suggestions, CodeMirror extensions, and metadata-cache schema collection.
- Added a dummy Obsidian smoke plugin under `examples/dummy-obsidian-plugin` for live modal/view testing in the test vault.
- Added a suggest-backed operator picker and CodeMirror-powered advanced expression rows with syntax highlighting, positional suggestions, lint diagnostics, and hover tooltips.
- Added native-style suggestion rows with type icons, compact labels, and right-aligned metadata.
- Added a generated diagnostics oracle for native Bases parser validity, runtime error values, and warning-message parity.

### Changed

- Rejected object literal syntax by default to match the observed Obsidian Bases runtime. Object values from context data, such as `file.properties`, `note`, and host-provided `objects`, remain supported.

### Documentation

- Documented public API boundaries for expressions, structured filters, object schemas, compatibility metadata, and note-default inference.
- Added examples for workflow event contexts and note-default inference.
- Documented the Obsidian builder package architecture, peer dependencies, and smoke-test workflow.

### Fixed

- Updated builder row validation messages immediately when condition values change.
- Removed the visible border around expression rows for a cleaner native Obsidian look.
- Matched native Bases runtime errors for unknown typed members and methods while keeping those expressions syntactically valid.
