#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const snapshotDir = resolve(root, "docs/upstream/obsidian-help");
const reportDir = resolve(root, ".tmp/obsidian-docs-drift");
const update = process.argv.includes("--update");

const upstreamDocs = [
  {
    id: "bases-syntax",
    title: "Bases syntax",
    url: "https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Bases%20syntax.md",
    snapshot: "bases-syntax.md",
  },
  {
    id: "bases-functions",
    title: "Bases functions",
    url: "https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Functions.md",
    snapshot: "bases-functions.md",
  },
  {
    id: "bases-formulas",
    title: "Bases formulas",
    url: "https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Bases/Formulas.md",
    snapshot: "bases-formulas.md",
  },
];

const results = [];

for (const doc of upstreamDocs) {
  const response = await fetch(doc.url, {
    headers: {
      "User-Agent": "obsidian-bases-expression-docs-drift-check",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${doc.url}: ${response.status} ${response.statusText}`);
  }

  const upstream = normalize(await response.text());
  const snapshotPath = resolve(snapshotDir, doc.snapshot);
  const previous = readSnapshot(snapshotPath);
  const upstreamHash = hash(upstream);
  const snapshotHash = previous === null ? null : hash(previous);
  const changed = previous === null || upstreamHash !== snapshotHash;

  if (update || previous === null) {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, upstream);
  }

  results.push({
    ...doc,
    snapshotPath,
    changed,
    snapshotHash,
    upstreamHash,
    missingSnapshot: previous === null,
  });
}

const changedDocs = results.filter((result) => result.changed);
writeReport(results, changedDocs);
writeGitHubOutput(changedDocs);

if (changedDocs.length === 0) {
  console.log("No Obsidian Bases documentation drift detected.");
} else {
  console.log(`Detected Obsidian documentation drift in ${changedDocs.length} document(s).`);
  for (const doc of changedDocs) {
    console.log(`- ${doc.title}: ${doc.snapshotHash ?? "missing"} -> ${doc.upstreamHash}`);
  }
}

function normalize(source) {
  return `${source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()}\n`;
}

function readSnapshot(path) {
  try {
    return normalize(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeReport(allDocs, changedDocs) {
  mkdirSync(reportDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const body = [
    "# Obsidian Bases documentation drift",
    "",
    `Generated: ${generatedAt}`,
    "",
    changedDocs.length === 0
      ? "No watched upstream documents changed."
      : "One or more watched Obsidian help documents differ from the committed snapshots.",
    "",
    "## Watched documents",
    "",
    ...allDocs.flatMap((doc) => [
      `- ${doc.changed ? "[changed]" : "[unchanged]"} ${doc.title}`,
      `  - URL: ${doc.url}`,
      `  - Snapshot: \`${relative(doc.snapshotPath)}\``,
      `  - Previous SHA-256: \`${doc.snapshotHash ?? "missing"}\``,
      `  - Upstream SHA-256: \`${doc.upstreamHash}\``,
    ]),
    "",
    "## Review checklist",
    "",
    "- Inspect the upstream docs diff.",
    "- Decide whether the expression spec or compatibility notes need updating.",
    "- Run `npm run oracle:generate` in a local Obsidian test vault if the docs change may affect runtime behavior.",
    "- Run `npm run verify` after updating fixtures or implementation behavior.",
    "- Review and merge the auto-committed snapshot update once the change has been triaged.",
    "",
  ].join("\n");

  writeFileSync(resolve(reportDir, "report.md"), body);
  writeFileSync(
    resolve(reportDir, "result.json"),
    `${JSON.stringify({ generatedAt, changed: changedDocs.length > 0, docs: allDocs }, null, 2)}\n`,
  );
}

function writeGitHubOutput(changedDocs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [
    `changed=${changedDocs.length > 0 ? "true" : "false"}`,
    `changed_count=${changedDocs.length}`,
    `changed_docs=${changedDocs.map((doc) => doc.id).join(",")}`,
  ];
  writeFileSync(outputPath, `${lines.join("\n")}\n`, { flag: "a" });
}

function relative(path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
