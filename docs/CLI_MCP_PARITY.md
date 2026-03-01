# MCP ↔ CLI Parity Matrix

Generated from `contracts/mcp-cli-parity.json`. Do not hand-edit.

- Tools covered: **11**
- Args mapped: **31/31 (100.0%)**

| MCP Tool | CLI Command | MCP Arg | CLI Flag | Status |
|---|---|---|---|---|
| get_context_tree | tree | target_path | --path | supported |
| get_context_tree | tree | depth_limit | --depth-limit | supported |
| get_context_tree | tree | include_symbols | --include-symbols | supported |
| get_context_tree | tree | max_tokens | --max-tokens | supported |
| semantic_identifier_search | identifiers | query | <positional> | supported |
| semantic_identifier_search | identifiers | top_k | --top-k | supported |
| semantic_identifier_search | identifiers | top_calls_per_identifier | --top-calls | supported |
| semantic_identifier_search | identifiers | include_kinds | --include-kinds | supported |
| semantic_identifier_search | identifiers | semantic_weight | --semantic-weight | supported |
| semantic_identifier_search | identifiers | keyword_weight | --keyword-weight | supported |
| get_file_skeleton | skel | file_path | <positional> | supported |
| get_file_skeleton | skel | note | Also available via ctxp-show --path <file>. | info |
| semantic_code_search | find | query | <positional> | supported |
| semantic_code_search | find | top_k | --top-k | supported |
| semantic_code_search | find | semantic_weight | --semantic-weight | supported |
| semantic_code_search | find | keyword_weight | --keyword-weight | supported |
| semantic_code_search | find | min_semantic_score | --min-semantic-score | supported |
| semantic_code_search | find | min_keyword_score | --min-keyword-score | supported |
| semantic_code_search | find | min_combined_score | --min-combined-score | supported |
| semantic_code_search | find | require_keyword_match | --require-keyword-match | supported |
| semantic_code_search | find | require_semantic_match | --require-semantic-match | supported |
| get_blast_radius | blast | symbol_name | <positional> | supported |
| get_blast_radius | blast | file_context | --file | supported |
| run_static_analysis | analyze | target_path | --path | supported |
| propose_commit | propose-commit | file_path | --file-path | supported |
| propose_commit | propose-commit | new_content | --new-content | supported |
| list_restore_points | restore-list | *(none)* | *(none)* | supported |
| undo_change | restore | point_id | --point-id | supported |
| semantic_navigate | navigate | max_depth | --max-depth | supported |
| semantic_navigate | navigate | max_clusters | --max-clusters | supported |
| get_feature_hub | hub | hub_path | --path | supported |
| get_feature_hub | hub | feature_name | --feature | supported |
| get_feature_hub | hub | show_orphans | --show-orphans | supported |

