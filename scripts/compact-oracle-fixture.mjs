#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "test/fixtures/oracle.generated.json");
const outputPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(root, "test/fixtures/oracle.compact.json");
const input = JSON.parse(readFileSync(inputPath, "utf8"));
const [first, ...rest] = input.cases;
if (!first?.context) throw new Error("Oracle fixture has no shared context");
const serializedContext = JSON.stringify(first.context);
for (const testCase of rest) {
  if (JSON.stringify(testCase.context) !== serializedContext) {
    throw new Error(`Oracle context differs for ${testCase.name}`);
  }
}
const output = {
  generatedAt: input.generatedAt,
  obsidian: input.obsidian,
  context: first.context,
  cases: input.cases.map(({ context: _context, ...testCase }) => testCase),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
