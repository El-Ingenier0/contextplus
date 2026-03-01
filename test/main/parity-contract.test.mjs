import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();

function toSet(values) {
  return new Set(values);
}

function extractToolSegment(indexText, toolName) {
  const marker = `"${toolName}"`;
  const toolStart = indexText.indexOf(marker);
  assert.ok(toolStart >= 0, `Could not locate MCP tool definition for ${toolName}`);

  const segmentStart = indexText.lastIndexOf("server.tool(", toolStart);
  assert.ok(segmentStart >= 0, `Could not locate server.tool start for ${toolName}`);

  const nextTool = indexText.indexOf("\nserver.tool(", segmentStart + 1);
  const segmentEnd = nextTool >= 0 ? nextTool : indexText.length;
  return indexText.slice(segmentStart, segmentEnd);
}

function extractSchemaArgNames(segment) {
  const args = [];
  const argRe = /(\w+)\s*:\s*z\./g;
  let hit;
  while ((hit = argRe.exec(segment)) !== null) {
    args.push(hit[1]);
  }
  return [...new Set(args)];
}

describe("mcp-cli parity contract", () => {
  it("keeps parity mapping in sync with MCP tool names and CLI commands", async () => {
    const [indexText, cliText, parityRaw] = await Promise.all([
      readFile(join(ROOT, "src", "index.ts"), "utf-8"),
      readFile(join(ROOT, "src", "cli.ts"), "utf-8"),
      readFile(join(ROOT, "contracts", "mcp-cli-parity.json"), "utf-8"),
    ]);

    const parity = JSON.parse(parityRaw);
    const entries = parity.entries;

    const mcpTools = [...indexText.matchAll(/server\.tool\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const cliCommands = [...cliText.matchAll(/case\s+"([^"]+)"\s*:/g)].map((m) => m[1]);

    assert.deepEqual(
      [...toSet(entries.map((e) => e.tool))].sort(),
      [...toSet(mcpTools)].sort(),
      "Parity map must include every MCP tool exactly once",
    );

    for (const entry of entries) {
      assert.ok(cliCommands.includes(entry.cliCommand), `Unknown CLI command in parity map: ${entry.cliCommand}`);
    }
  });

  it("tracks MCP args exhaustively and verifies mapped CLI flags are parsed", async () => {
    const [indexText, cliText, parityRaw] = await Promise.all([
      readFile(join(ROOT, "src", "index.ts"), "utf-8"),
      readFile(join(ROOT, "src", "cli.ts"), "utf-8"),
      readFile(join(ROOT, "contracts", "mcp-cli-parity.json"), "utf-8"),
    ]);

    const parity = JSON.parse(parityRaw);

    for (const entry of parity.entries) {
      const segment = extractToolSegment(indexText, entry.tool);
      const expectedMcpArgs = (entry.args ?? []).map((a) => a.mcp).sort();
      const actualMcpArgs = extractSchemaArgNames(segment).sort();
      assert.deepEqual(expectedMcpArgs, actualMcpArgs, `MCP args drift for ${entry.tool}`);

      if (expectedMcpArgs.length === 0) {
        assert.match(segment, /\{\s*\}\s*,\s*async/s, `${entry.tool} should keep an empty schema object`);
      }

      for (const arg of entry.args ?? []) {
        if (!arg.cli || arg.cli.startsWith("<")) continue;
        const flagName = arg.cli.replace(/^--/, "");
        const directBracket = cliText.includes(`args["${flagName}"]`);
        const directDot = /^[a-zA-Z_$][\w$]*$/.test(flagName) && cliText.includes(`args.${flagName}`);
        assert.ok(
          directBracket || directDot,
          `CLI parser missing mapped flag ${arg.cli} for ${entry.tool}`,
        );
      }
    }
  });
});
