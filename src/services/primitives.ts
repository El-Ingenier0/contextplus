// Unix-style primitive services for low-context workflows
// Shared by CLI and can be reused by MCP wrappers

import { readFile } from "fs/promises";
import { relative, resolve } from "path";
import { semanticCodeSearchResults, type SemanticSearchOptions } from "../tools/semantic-search.js";
import { getFileSkeleton } from "../tools/file-skeleton.js";
import { getBlastRadiusData } from "../tools/blast-radius.js";
import { walkDirectory } from "../core/walker.js";

export interface PrimitiveFindResult {
  query: string;
  hits: Array<{
    id: string;
    path: string;
    score: number;
    semanticScore: number;
    keywordScore: number;
    header: string;
    matchedSymbols: string[];
    matchedSymbolLocations: string[];
  }>;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function normalizePathWithinRoot(rootDir: string, targetPath: string): string {
  const root = resolve(rootDir);
  const full = resolve(root, targetPath);
  const rel = relative(root, full).replace(/\\/g, "/");
  if (!rel || rel === "." || rel === ".." || rel.startsWith("../")) {
    throw new Error(`Path "${targetPath}" is outside the project root.`);
  }
  return rel;
}

function truncateToLimit(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars <= 0) return "";
  const suffix = "\n...[truncated]";
  if (maxChars <= suffix.length) return content.slice(0, maxChars);
  return `${content.slice(0, maxChars - suffix.length)}${suffix}`;
}

async function keywordFallbackFind(options: SemanticSearchOptions) {
  const entries = await walkDirectory({ rootDir: options.rootDir, depthLimit: 0 });
  const files = entries.filter((e) => !e.isDirectory).slice(0, 200);
  const q = options.query.toLowerCase();
  const topK = normalizePositiveInt(options.topK, 8);
  const hits: PrimitiveFindResult["hits"] = [];

  for (const file of files) {
    try {
      const content = await readFile(resolve(options.rootDir, file.relativePath), "utf-8");
      const lower = content.toLowerCase();
      if (!lower.includes(q)) continue;
      hits.push({
        id: `hit-${hits.length + 1}`,
        path: file.relativePath,
        score: 50,
        semanticScore: 0,
        keywordScore: 100,
        header: content.split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "",
        matchedSymbols: [],
        matchedSymbolLocations: [],
      });
      if (hits.length >= topK) break;
    } catch {
      // ignore unreadable files in fallback mode
    }
  }

  return hits;
}

export async function ctxpFind(options: SemanticSearchOptions): Promise<PrimitiveFindResult> {
  const topK = normalizePositiveInt(options.topK, 8);
  const disableEmbeddings = (process.env.CONTEXTPLUS_DISABLE_EMBEDDINGS ?? "").toLowerCase() === "true";
  const results = disableEmbeddings
    ? await keywordFallbackFind({ ...options, topK })
    : (await semanticCodeSearchResults({ ...options, topK })).map((r, idx) => ({
      id: `hit-${idx + 1}`,
      path: r.path,
      score: r.score,
      semanticScore: r.semanticScore,
      keywordScore: r.keywordScore,
      header: r.header,
      matchedSymbols: r.matchedSymbols,
      matchedSymbolLocations: r.matchedSymbolLocations,
    }));

  return {
    query: options.query,
    hits: results,
  };
}

export async function ctxpShowByPath(options: {
  rootDir: string;
  path: string;
  maxChars?: number;
  mode?: "skeleton" | "snippet";
}): Promise<{ path: string; mode: string; content: string }> {
  const mode = options.mode ?? "skeleton";
  const maxChars = normalizePositiveInt(options.maxChars, 4000);
  const path = normalizePathWithinRoot(options.rootDir, options.path);

  let content: string;
  if (mode === "skeleton") {
    content = await getFileSkeleton({ rootDir: options.rootDir, filePath: path });
  } else {
    content = await readFile(resolve(options.rootDir, path), "utf-8");
  }

  return { path, mode, content: truncateToLimit(content, maxChars) };
}

export async function ctxpBlast(options: {
  rootDir: string;
  symbol: string;
  fileContext?: string;
}): Promise<{
  symbol: string;
  usageCount: number;
  fileCount: number;
  lowUsageWarning: boolean;
  usagesByFile: Record<string, Array<{ line: number; context: string }>>;
}> {
  const data = await getBlastRadiusData({
    rootDir: options.rootDir,
    symbolName: options.symbol,
    fileContext: options.fileContext,
  });

  return {
    symbol: data.symbolName,
    usageCount: data.usageCount,
    fileCount: data.fileCount,
    lowUsageWarning: data.lowUsageWarning,
    usagesByFile: Object.fromEntries(
      Object.entries(data.usagesByFile).map(([file, entries]) => [
        file,
        entries.map((e) => ({ line: e.line, context: e.context })),
      ]),
    ),
  };
}

export async function ctxpPack(options: {
  rootDir: string;
  query: string;
  topK?: number;
  includePerHitChars?: number;
  budgetChars?: number;
}): Promise<{
  query: string;
  selected: string[];
  items: Array<{ path: string; excerpt: string }>;
  budgetChars: number;
}> {
  const includePerHitChars = normalizePositiveInt(options.includePerHitChars, 1000);
  const budgetChars = normalizePositiveInt(options.budgetChars, 6000);
  const topK = normalizePositiveInt(options.topK, 8);
  const find = await ctxpFind({ rootDir: options.rootDir, query: options.query, topK });

  const items: Array<{ path: string; excerpt: string }> = [];
  let used = 0;
  for (const hit of find.hits) {
    const remaining = budgetChars - used;
    if (remaining <= 0) break;
    const shown = await ctxpShowByPath({
      rootDir: options.rootDir,
      path: hit.path,
      mode: "skeleton",
      maxChars: Math.min(includePerHitChars, remaining),
    });
    const excerpt = truncateToLimit(shown.content, remaining);
    if (excerpt.length === 0) break;
    items.push({ path: hit.path, excerpt });
    used += excerpt.length;
  }

  return {
    query: options.query,
    selected: items.map((i) => i.path),
    items,
    budgetChars,
  };
}
