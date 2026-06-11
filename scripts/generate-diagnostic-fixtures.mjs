#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outputPath = resolve(root, "test/fixtures/diagnostics.generated.json");

const cases = [
  { name: "unknown bare string member", expression: '"asdf".asdfasdf' },
  { name: "unknown string method", expression: '"asdf".asdfasdf()' },
  { name: "known bare string field", expression: '"asdf".length' },
  { name: "known string method", expression: '"asdf".lower()' },
  { name: "unknown bare date member", expression: "now().asdfasdf" },
  { name: "known bare date field", expression: "now().year" },
  { name: "unknown bare number member", expression: "(1).asdfasdf" },
  { name: "known number method", expression: "(1.2).round()" },
  { name: "unknown bare file member", expression: "file.asdfasdf" },
  { name: "known bare file field", expression: "file.name" },
  { name: "unknown global function", expression: "doesNotExist()" },
  { name: "invalid incomplete comparison", expression: "status ==" },
  { name: "missing note property", expression: "missing" },
];

const code = `
(async () => {
  const cases = ${JSON.stringify(cases)};
  const dir = "__codex_bases_diagnostics_oracle";
  const basePath = dir + "/diagnostics.base";
  const notePath = dir + "/row.md";
  let scratchLeaf = null;
  const cleanup = async () => {
    if (scratchLeaf) {
      await scratchLeaf.detach();
      scratchLeaf = null;
    }
    const folder = app.vault.getAbstractFileByPath(dir);
    if (folder) await app.vault.delete(folder, true);
  };
  const waitFor = async (predicate, label, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for " + label);
  };
  const normalize = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return value;
    const type = value.constructor?.type ?? value.constructor?.name;
    if (type === "Null") return null;
    if (type === "Error") return { error: value.message ?? value.toString?.() };
    if ("data" in value) {
      if (Array.isArray(value.data)) return value.data.map(normalize);
      if (value.data instanceof Date) return moment(value.data).format("YYYY-MM-DD HH:mm:ss");
      if (value.data && typeof value.data === "object") {
        return Object.fromEntries(Object.entries(value.data).map(([key, item]) => [key, normalize(item)]));
      }
      return value.data;
    }
    if (type === "Date" && value.moment) return value.moment.format("YYYY-MM-DD HH:mm:ss");
    return value.toString?.() ?? String(value);
  };
  const readParseState = (formula) => {
    const parsed = formula.formula;
    let errorMessage = null;
    try {
      errorMessage = typeof parsed?.getErrorMessage === "function" ? parsed.getErrorMessage() : parsed?.parseError ?? null;
    } catch (error) {
      errorMessage = error?.message ?? String(error);
    }
    return {
      type: parsed?.type ?? null,
      parseError: parsed?.parseError ?? null,
      errorMessage,
    };
  };
  try {
    await cleanup();
    await app.vault.createFolder(dir);
    const note = await app.vault.create(notePath, "---\\nstatus: Todo\\npriority: 1\\n---\\nDiagnostics row\\n");
    const base = await app.vault.create(basePath, "formulas:\\n  seed: \\"1\\"\\nviews:\\n  - type: table\\n    name: Diagnostics\\n");
    scratchLeaf = app.workspace.getLeaf(true);
    await scratchLeaf.openFile(base);
    const controller = await waitFor(
      () => scratchLeaf?.view?.controller?.ctx?.formulas?.seed && scratchLeaf.view.controller,
      "visible scratch Base controller"
    );
    const FormulaCtor = Object.getPrototypeOf(controller.ctx.formulas.seed).constructor;
    const ContextCtor = Object.getPrototypeOf(controller.ctx).constructor;
    const formulas = { seed: new FormulaCtor("1") };
    const ctx = new ContextCtor(app, null, formulas, note);
    const results = [];
    for (const testCase of cases) {
      const formula = new FormulaCtor(testCase.expression);
      let value = null;
      let thrown = null;
      try {
        value = normalize(formula.getValue(ctx.local));
      } catch (error) {
        thrown = error?.message ?? String(error);
      }
      let testResult = null;
      let testThrown = null;
      try {
        testResult = formula.test(ctx.local);
      } catch (error) {
        testThrown = error?.message ?? String(error);
      }
      results.push({
        ...testCase,
        native: {
          parse: readParseState(formula),
          value,
          thrown,
          testResult,
          testThrown,
        },
      });
    }
    await cleanup();
    console.log("DIAGNOSTICS_ORACLE_JSON_START" + JSON.stringify({
      generatedAt: new Date().toISOString(),
      obsidian: {
        version: typeof app.getVersion === "function" ? app.getVersion() : app.version ?? null,
        build: app.build ?? app.appId ?? null,
      },
      cases: results,
    }) + "DIAGNOSTICS_ORACLE_JSON_END");
  } catch (error) {
    await cleanup().catch(() => {});
    console.log("DIAGNOSTICS_ORACLE_ERROR", error?.stack ?? error?.message ?? String(error));
  }
})()
`;

const result = spawnSync("obsidian", ["vault=test", "eval", `code=${code}`], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 20,
});

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

const output = `${result.stdout}\n${result.stderr}`;
const match = output.match(/DIAGNOSTICS_ORACLE_JSON_START(.*)DIAGNOSTICS_ORACLE_JSON_END/s);
if (!match) {
  console.error("Could not find diagnostics oracle JSON in Obsidian CLI output.");
  console.error(output);
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(JSON.parse(match[1]), null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
