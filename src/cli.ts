#!/usr/bin/env node

import { realpathSync } from "fs";
import { writeFile, mkdir, readFile } from "fs/promises";
import { basename, dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  ctxpAnalyze,
  ctxpBlast,
  ctxpFind,
  ctxpHub,
  ctxpIdentifiers,
  ctxpNavigate,
  ctxpPack,
  ctxpProposeCommit,
  ctxpRestore,
  ctxpRestoreList,
  ctxpShowByPath,
  ctxpTree,
} from "./services/primitives.js";

const ROOT_DIR = process.cwd();
const DEFAULT_FIND_STATE = ".mcp_data/ctxp-find-last.json";

type Args = Record<string, string | boolean>;

export function inferCommandFromBin(binPath = process.argv[1] ?? ""): string {
  const bin = basename(binPath).replace(/\.(cmd|ps1|exe)$/i, "");
  if (bin.startsWith("ctxp-")) return bin.slice("ctxp-".length);
  return "";
}

export function parseArgs(
  argv: string[],
  inferredCommand = inferCommandFromBin(),
): { command: string; positionals: string[]; args: Args } {
  const command = inferredCommand || (argv[0] ?? "");
  const rest = inferredCommand
    ? (argv[0] === inferredCommand ? argv.slice(1) : argv)
    : argv.slice(1);
  const args: Args = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const [k, v] = token.slice(2).split("=", 2);
      if (v !== undefined) {
        args[k] = v;
      } else if (rest[i + 1] && !rest[i + 1].startsWith("--")) {
        args[k] = rest[++i];
      } else {
        args[k] = true;
      }
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, args };
}

function intArg(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function intArgAllowZero(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function floatArg(value: string | boolean | undefined, fallback?: number): number | undefined {
  if (typeof value !== "string") return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolArg(value: string | boolean | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}

function stringListArg(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== "string") return undefined;
  const items = value.split(",").map((v) => v.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

async function writeJson(path: string, obj: unknown): Promise<void> {
  const full = resolve(ROOT_DIR, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

async function loadLastFind(path: string) {
  const full = resolve(ROOT_DIR, path);
  try {
    return JSON.parse(await readFile(full, "utf-8")) as Awaited<ReturnType<typeof ctxpFind>>;
  } catch {
    throw new Error(`Unable to read find state at "${path}". Run "ctxp find <query>" first or pass --from.`);
  }
}

async function cmdFind(positionals: string[], args: Args): Promise<void> {
  const query = positionals.join(" ").trim();
  if (!query) throw new Error("find requires a query string");
  const topK = intArg(args["top-k"], 8);

  const out = await ctxpFind({
    rootDir: ROOT_DIR,
    query,
    topK,
    semanticWeight: floatArg(args["semantic-weight"]),
    keywordWeight: floatArg(args["keyword-weight"]),
    minSemanticScore: floatArg(args["min-semantic-score"]),
    minKeywordScore: floatArg(args["min-keyword-score"]),
    minCombinedScore: floatArg(args["min-combined-score"]),
    requireKeywordMatch: boolArg(args["require-keyword-match"]),
    requireSemanticMatch: boolArg(args["require-semantic-match"]),
  });
  const statePath = typeof args.out === "string" ? args.out : DEFAULT_FIND_STATE;
  await writeJson(statePath, out);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdShow(positionals: string[], args: Args): Promise<void> {
  const byPath = typeof args.path === "string" ? args.path : undefined;
  const byId = typeof args.id === "string" ? args.id : undefined;
  const mode = args.mode === "snippet" ? "snippet" : "skeleton";
  const maxChars = intArg(args["max-chars"], 4000);

  let path = byPath;
  if (!path && byId) {
    const statePath = typeof args.from === "string" ? args.from : DEFAULT_FIND_STATE;
    const last = await loadLastFind(statePath);
    path = last.hits.find((h) => h.id === byId)?.path;
  }
  if (!path) throw new Error("show requires --path or --id with prior find state");

  const out = await ctxpShowByPath({ rootDir: ROOT_DIR, path, mode, maxChars });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdBlast(positionals: string[], args: Args): Promise<void> {
  const symbol = (typeof args.symbol === "string" ? args.symbol : positionals[0])?.trim();
  if (!symbol) throw new Error("blast requires symbol (positional or --symbol)");
  const fileContext = typeof args.file === "string" ? args.file : undefined;

  const out = await ctxpBlast({ rootDir: ROOT_DIR, symbol, fileContext });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdSkel(positionals: string[], args: Args): Promise<void> {
  const path = (typeof args.path === "string" ? args.path : positionals[0])?.trim();
  if (!path) throw new Error("skel requires file path");
  const maxChars = intArg(args["max-chars"], 4000);
  const out = await ctxpShowByPath({ rootDir: ROOT_DIR, path, mode: "skeleton", maxChars });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdPack(positionals: string[], args: Args): Promise<void> {
  const query = positionals.join(" ").trim();
  if (!query) throw new Error("pack requires a query string");
  const out = await ctxpPack({
    rootDir: ROOT_DIR,
    query,
    topK: intArg(args["top-k"], 8),
    includePerHitChars: intArg(args["include-per-hit-chars"], 1000),
    budgetChars: intArg(args["budget-chars"], 6000),
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdTree(args: Args): Promise<void> {
  const out = await ctxpTree({
    rootDir: ROOT_DIR,
    targetPath: typeof args.path === "string" ? args.path : undefined,
    depthLimit: intArgAllowZero(args["depth-limit"], 0),
    includeSymbols: boolArg(args["include-symbols"]),
    maxTokens: intArg(args["max-tokens"], 20000),
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdIdentifiers(positionals: string[], args: Args): Promise<void> {
  const query = positionals.join(" ").trim();
  if (!query) throw new Error("identifiers requires a query string");
  const out = await ctxpIdentifiers({
    rootDir: ROOT_DIR,
    query,
    topK: intArg(args["top-k"], 5),
    topCallsPerIdentifier: intArg(args["top-calls"], 10),
    includeKinds: stringListArg(args["include-kinds"]),
    semanticWeight: floatArg(args["semantic-weight"]),
    keywordWeight: floatArg(args["keyword-weight"]),
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdAnalyze(positionals: string[], args: Args): Promise<void> {
  const targetPath = (typeof args.path === "string" ? args.path : positionals[0]) || undefined;
  const out = await ctxpAnalyze({ rootDir: ROOT_DIR, targetPath });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdHub(positionals: string[], args: Args): Promise<void> {
  const out = await ctxpHub({
    rootDir: ROOT_DIR,
    hubPath: (typeof args.path === "string" ? args.path : undefined) ?? (positionals[0] || undefined),
    featureName: typeof args.feature === "string" ? args.feature : undefined,
    showOrphans: args["show-orphans"] === true,
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdNavigate(args: Args): Promise<void> {
  const out = await ctxpNavigate({
    rootDir: ROOT_DIR,
    maxDepth: intArg(args["max-depth"], 3),
    maxClusters: intArg(args["max-clusters"], 20),
  });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdProposeCommit(args: Args): Promise<void> {
  const filePath = typeof args["file-path"] === "string" ? args["file-path"] : undefined;
  const newContent = typeof args["new-content"] === "string" ? args["new-content"] : undefined;
  if (!filePath || newContent === undefined) {
    throw new Error("propose-commit requires --file-path and --new-content");
  }
  const out = await ctxpProposeCommit({ rootDir: ROOT_DIR, filePath, newContent });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdRestoreList(): Promise<void> {
  const out = await ctxpRestoreList(ROOT_DIR);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function cmdRestore(args: Args): Promise<void> {
  const pointId = typeof args["point-id"] === "string" ? args["point-id"] : undefined;
  if (!pointId) throw new Error("restore requires --point-id");
  const out = await ctxpRestore({ rootDir: ROOT_DIR, pointId });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const { command, positionals, args } = parseArgs(argv);
  switch (command) {
    case "find":
      await cmdFind(positionals, args);
      break;
    case "show":
      await cmdShow(positionals, args);
      break;
    case "blast":
      await cmdBlast(positionals, args);
      break;
    case "skel":
      await cmdSkel(positionals, args);
      break;
    case "pack":
      await cmdPack(positionals, args);
      break;
    case "tree":
      await cmdTree(args);
      break;
    case "identifiers":
      await cmdIdentifiers(positionals, args);
      break;
    case "analyze":
      await cmdAnalyze(positionals, args);
      break;
    case "hub":
      await cmdHub(positionals, args);
      break;
    case "navigate":
      await cmdNavigate(args);
      break;
    case "propose-commit":
      await cmdProposeCommit(args);
      break;
    case "restore-list":
      await cmdRestoreList();
      break;
    case "restore":
      await cmdRestore(args);
      break;
    default:
      process.stderr.write("Usage: ctxp <find|show|blast|skel|pack|tree|identifiers|analyze|hub|navigate|propose-commit|restore-list|restore> ...\n");
      process.exit(2);
  }
}

const invokedPath = process.argv[1];
const currentFilePath = fileURLToPath(import.meta.url);
const isEntrypoint = (() => {
  if (!invokedPath) return false;
  try {
    return realpathSync(invokedPath) === realpathSync(currentFilePath);
  } catch {
    return import.meta.url === pathToFileURL(invokedPath).href;
  }
})();

if (isEntrypoint) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(1);
  });
}
