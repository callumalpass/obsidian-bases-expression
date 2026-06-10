# Changelog

## Unreleased

### Added

- Added named `objects` on evaluation contexts for host-owned expression data such as workflow events, action results, and canvas active zones.
- Added `FormulaLanguageSchema.objects` so editor integrations can complete, hover, type-check, and report dependencies for nested object paths like `trigger.zone.id` and `steps.query.total`.
- Added `compileFilter()` and `evaluateFilter()` for Obsidian Bases-style structured filter trees using expression strings plus `and`, `or`, and `not`.
- Added `inferDefaultsFromExpression()` and `inferDefaultsFromFilter()` for conservative note-creation defaults from positive equality and tag constraints.
- Added oracle compatibility metadata fields for Obsidian version/build values when the generator can discover them.

### Documentation

- Documented public API boundaries for expressions, structured filters, object schemas, compatibility metadata, and note-default inference.
- Added examples for workflow event contexts and note-default inference.
