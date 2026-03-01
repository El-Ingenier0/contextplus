# Context+ CLI Primitive Refactor Plan (TDD)

## Goal
Reduce context consumption by exposing bounded, Unix-style `ctxp-*` primitives that reuse refactored MCP logic.

## Strategy
1. Refactor core tool logic into reusable service functions.
2. Keep MCP handlers as thin adapters.
3. Add CLI primitives with strict JSON output and payload budgets.
4. Validate with fixture-driven tests.

## One-shot TDD tasks

### T1 — Structured semantic search service
- Tests first: ensure structured semantic results include `path/score/symbol locations`.
- Implement `semanticCodeSearchResults()` and keep legacy formatter.
- Done: existing MCP behavior preserved + structured function available.

### T2 — Structured blast-radius service
- Tests first: empty usage, grouped usages, low-usage warning.
- Implement `getBlastRadiusData()` and keep legacy formatter.
- Done: both structured + text forms pass tests.

### T3 — CLI primitive layer
- Tests first: `ctxp find/show/blast/skel/pack` return valid JSON and bounded output.
- Implement `src/services/primitives.ts` + `src/cli.ts`.
- Done: primitives work from build output in isolated fixture repo.

### T4 — Budget controls and deterministic state
- Tests first: `find` writes deterministic state file; `show --id` resolves from state.
- Implement `.mcp_data/ctxp-find-last.json` default behavior.
- Done: reproducible hit-id workflows for low-token retrieval.

### T5 — Docs + invocation contract
- Tests first: README snippets match actual commands.
- Add concise docs for `ctxp-*` usage and context-budget flags.
- Done: users can chain primitives in Unix pipelines.

## Acceptance criteria
- `ctxp-*` can replace common discovery/read flows without full MCP output.
- JSON output only (no prose framing).
- Bounded response controls: top-k and char-budget.
- Existing MCP tools keep working.
