import {
  compileFilter,
  createEvaluationContext,
  inferDefaultsFromFilter,
} from "obsidian-bases-expression";

const viewFilter = {
  and: [
    'status == "Todo"',
    'note.project == "Client A"',
    'file.hasTag("work")',
  ],
};

const inferred = inferDefaultsFromFilter(viewFilter);

const newNoteContext = createEvaluationContext({
  note: inferred.properties,
  file: {
    path: "Tasks/New task.md",
    tags: inferred.tags,
  },
});

const matchesAfterCreation = compileFilter(viewFilter).evaluateToBoolean(newNoteContext);

console.log({
  properties: inferred.properties,
  tags: inferred.tags,
  unsupported: inferred.unsupported,
  matchesAfterCreation,
});
