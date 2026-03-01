#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = process.cwd();
const PARITY_PATH = resolve(ROOT, "contracts/mcp-cli-parity.json");
const OUT_PATH = resolve(ROOT, "docs/CLI_MCP_PARITY.md");

function pct(n, d) {
  if (d === 0) return "100.0";
  return ((n / d) * 100).toFixed(1);
}

async function main() {
  const raw = await readFile(PARITY_PATH, "utf-8");
  const parity = JSON.parse(raw);
  const entries = parity.entries ?? [];

  const allArgs = entries.flatMap((e) => e.args ?? []);
  const supported = allArgs.filter((a) => a.status === "supported").length;

  const lines = [];
  lines.push("# MCP ↔ CLI Parity Matrix");
  lines.push("");
  lines.push("Generated from `contracts/mcp-cli-parity.json`. Do not hand-edit.");
  lines.push("");
  lines.push(`- Tools covered: **${entries.length}**`);
  lines.push(`- Args mapped: **${supported}/${allArgs.length} (${pct(supported, allArgs.length)}%)**`);
  lines.push("");
  lines.push("| MCP Tool | CLI Command | MCP Arg | CLI Flag | Status |");
  lines.push("|---|---|---|---|---|");

  for (const entry of entries) {
    const args = entry.args ?? [];
    if (args.length === 0) {
      lines.push(`| ${entry.tool} | ${entry.cliCommand} | *(none)* | *(none)* | supported |`);
      continue;
    }
    for (const arg of args) {
      lines.push(`| ${entry.tool} | ${entry.cliCommand} | ${arg.mcp} | ${arg.cli} | ${arg.status} |`);
    }
    if (entry.notes) {
      lines.push(`| ${entry.tool} | ${entry.cliCommand} | note | ${entry.notes} | info |`);
    }
  }

  lines.push("");
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${lines.join("\n")}\n`, "utf-8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
