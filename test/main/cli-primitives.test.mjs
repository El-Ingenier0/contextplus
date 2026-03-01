import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "../../build/cli.js";
import { ctxpBlast, ctxpFind, ctxpPack, ctxpShowByPath } from "../../build/services/primitives.js";

const REPO_ROOT = process.cwd();
const FIXTURE_DIR = join(REPO_ROOT, "test", "_cli_fixtures");
const PREV_DISABLE = process.env.CONTEXTPLUS_DISABLE_EMBEDDINGS;

async function setup() {
  await rm(FIXTURE_DIR, { recursive: true, force: true });
  await mkdir(join(FIXTURE_DIR, "src"), { recursive: true });
  await writeFile(
    join(FIXTURE_DIR, "src", "alpha.ts"),
    "// Alpha module\nexport function computeVcr(marketCap:number,econ:number){return marketCap/econ}\n",
    "utf-8",
  );
  await writeFile(
    join(FIXTURE_DIR, "src", "beta.ts"),
    "// Beta module\nimport { computeVcr } from './alpha';\nexport function helper(){return computeVcr(10,2)}\n",
    "utf-8",
  );
  await writeFile(
    join(FIXTURE_DIR, "src", "gamma.ts"),
    "// Gamma module\nimport { computeVcr } from './alpha';\nexport const score = computeVcr(20,5);\nexport function fn1(){return score}\nexport function fn2(){return score}\nexport function fn3(){return score}\n",
    "utf-8",
  );
}

describe("cli-primitives", () => {
  before(async () => {
    process.env.CONTEXTPLUS_DISABLE_EMBEDDINGS = "true";
    await setup();
  });

  it("parseArgs supports explicit ctxp subcommands", () => {
    const parsed = parseArgs(["find", "computevcr", "--top-k", "3"]);
    assert.equal(parsed.command, "find");
    assert.deepEqual(parsed.positionals, ["computevcr"]);
    assert.equal(parsed.args["top-k"], "3");
  });

  it("parseArgs supports ctxp-* alias style arguments", () => {
    const parsed = parseArgs(["computevcr", "--top-k", "2"], "find");
    assert.equal(parsed.command, "find");
    assert.deepEqual(parsed.positionals, ["computevcr"]);
    assert.equal(parsed.args["top-k"], "2");
  });

  it("ctxp show returns bounded skeleton output", async () => {
    const out = await ctxpShowByPath({
      rootDir: FIXTURE_DIR,
      path: "src/gamma.ts",
      mode: "skeleton",
      maxChars: 120,
    });
    assert.equal(out.path, "src/gamma.ts");
    assert.equal(out.mode, "skeleton");
    assert.ok(out.content.length <= 120);
  });

  it("ctxp show rejects paths outside the project root", async () => {
    await assert.rejects(
      ctxpShowByPath({
        rootDir: FIXTURE_DIR,
        path: "../README.md",
        mode: "snippet",
      }),
      /outside the project root/,
    );
  });

  it("ctxp blast returns grouped usage JSON", async () => {
    const obj = await ctxpBlast({
      rootDir: FIXTURE_DIR,
      symbol: "computeVcr",
      fileContext: "src/alpha.ts",
    });
    assert.equal(obj.symbol, "computeVcr");
    assert.ok(obj.usageCount >= 2);
    assert.ok(typeof obj.usagesByFile === "object");
  });

  it("ctxp find normalizes invalid topK and returns stable hit ids", async () => {
    const out = await ctxpFind({ rootDir: FIXTURE_DIR, query: "module", topK: 0 });
    assert.equal(out.query, "module");
    assert.equal(out.hits.length, 1);
    assert.equal(out.hits[0].id, "hit-1");
  });

  it("ctxp pack respects budget and returns selected items", async () => {
    const obj = await ctxpPack({
      rootDir: FIXTURE_DIR,
      query: "module",
      budgetChars: 180,
      includePerHitChars: 120,
      topK: 5,
    });
    assert.equal(obj.query, "module");
    assert.ok(Array.isArray(obj.items));
    const total = obj.items.reduce((n, it) => n + it.excerpt.length, 0);
    assert.ok(total <= 180);
  });

  after(async () => {
    if (PREV_DISABLE === undefined) {
      delete process.env.CONTEXTPLUS_DISABLE_EMBEDDINGS;
    } else {
      process.env.CONTEXTPLUS_DISABLE_EMBEDDINGS = PREV_DISABLE;
    }
    await rm(FIXTURE_DIR, { recursive: true, force: true });
  });
});
