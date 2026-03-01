// Unix-style primitive services for low-context workflows
// Shared by CLI and can be reused by MCP wrappers

import { readFile } from "fs/promises";
import { relative, resolve } from "path";
import { semanticCodeSearchResults, type SemanticSearchOptions } from "../tools/semantic-search.js";
import { invalidateSearchCache } from "../tools/semantic-search.js";
import { semanticIdentifierSearch } from "../tools/semantic-identifiers.js";
import { invalidateIdentifierSearchCache } from "../tools/semantic-identifiers.js";
import { getContextTree } from "../tools/context-tree.js";
import { getFileSkeleton } from "../tools/file-skeleton.js";
import { getBlastRadiusData } from "../tools/blast-radius.js";
import { runStaticAnalysis } from "../tools/static-analysis.js";
import { getFeatureHub } from "../tools/feature-hub.js";
import { semanticNavigate } from "../tools/semantic-navigate.js";
import { proposeCommit } from "../tools/propose-commit.js";
import { listRestorePoints, restorePoint } from "../git/shadow.js";
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

function normalizePathWithinRootAllowRoot(rootDir: string, targetPath: string): string {
  const root = resolve(rootDir);
  const full = resolve(root, targetPath);
  const rel = relative(root, full).replace(/\\/g, "/");
  if (rel === "" || rel === ".") return ".";
  if (rel === ".." || rel.startsWith("../")) {
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

export async function ctxpTree(options: {
  rootDir: string;
  targetPath?: string;
  depthLimit?: number;
  includeSymbols?: boolean;
  maxTokens?: number;
}) {
  const targetPath = options.targetPath
    ? normalizePathWithinRootAllowRoot(options.rootDir, options.targetPath)
    : undefined;
  const text = await getContextTree({
    rootDir: options.rootDir,
    targetPath,
    depthLimit: options.depthLimit,
    includeSymbols: options.includeSymbols,
    maxTokens: options.maxTokens,
  });
  return { tree: text };
}

export async function ctxpIdentifiers(options: {
  rootDir: string;
  query: string;
  topK?: number;
  topCallsPerIdentifier?: number;
}) {
  const text = await semanticIdentifierSearch({
    rootDir: options.rootDir,
    query: options.query,
    topK: options.topK,
    topCallsPerIdentifier: options.topCallsPerIdentifier,
  });
  return { query: options.query, result: text };
}

export async function ctxpAnalyze(options: { rootDir: string; targetPath?: string }) {
  const targetPath = options.targetPath
    ? normalizePathWithinRootAllowRoot(options.rootDir, options.targetPath)
    : undefined;
  const text = await runStaticAnalysis({ rootDir: options.rootDir, targetPath });
  return { targetPath: targetPath ?? null, result: text };
}

export async function ctxpHub(options: {
  rootDir: string;
  hubPath?: string;
  featureName?: string;
  showOrphans?: boolean;
}) {
  const hubPath = options.hubPath
    ? normalizePathWithinRoot(options.rootDir, options.hubPath)
    : undefined;
  const text = await getFeatureHub({
    rootDir: options.rootDir,
    hubPath,
    featureName: options.featureName,
    showOrphans: options.showOrphans,
  });
  return { result: text };
}

export async function ctxpNavigate(options: { rootDir: string; maxDepth?: number; maxClusters?: number }) {
  const text = await semanticNavigate({ rootDir: options.rootDir, maxDepth: options.maxDepth, maxClusters: options.maxClusters });
  return { result: text };
}

export async function ctxpProposeCommit(options: {
  rootDir: string;
  filePath: string;
  newContent: string;
}) {
  const path = normalizePathWithinRoot(options.rootDir, options.filePath);
  const result = await proposeCommit({ rootDir: options.rootDir, filePath: path, newContent: options.newContent });
  invalidateSearchCache();
  invalidateIdentifierSearchCache();
  return { filePath: path, result };
}

export async function ctxpRestoreList(rootDir: string) {
  const points = await listRestorePoints(rootDir);
  return { count: points.length, points };
}

export async function ctxpRestore(options: { rootDir: string; pointId: string }) {
  const restored = await restorePoint(options.rootDir, options.pointId);
  if (restored.length > 0) {
    invalidateSearchCache();
    invalidateIdentifierSearchCache();
  }
  return { pointId: options.pointId, restoredCount: restored.length, restored };
}
