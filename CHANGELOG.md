# Changelog

## Unreleased

### Added

- Edit the download filename on generated Canvas and Quick Recipe result cards without rerunning or changing graph, Recipe, or history settings.
- Keep in-session filename drafts synchronized across result views, with stale-result event guards and Japanese/English labels.

### Fixed

- Normalize terminal CSV / JSONL / Parquet extensions for the actual output format, preventing doubled JSONL and Parquet suffixes.

### Previously added

- Add the Clean Text / 文字列を整える node with selected-column trimming and optional Unicode lowercase/uppercase conversion before joins or deduplication.
- Preserve non-string values and upstream tables, report empty/missing selections, and retain settings in Pipeline JSON, Recipes, and Undo / Redo.
- Add Japanese/English controls and help, plus transform, evaluator, history, and persistence regression coverage.

## 1.0.0 - 2026-09-17

### Changed

- Promote the v0.9.0 release candidate to the first stable release without changing the data-processing behavior.
- Rewrite the English and Japanese READMEs around the live demo, quick start, usage, privacy, limitations, and development workflow.
- Finalize release metadata, screenshots, and standalone distribution artifacts for v1.0.0.

## 0.9.0 - 2026-09-17

### Changed

- Prepare the v1.0.0 release candidate without adding new data-processing features.
- Honor `prefers-reduced-motion` for app UI transitions and the self-extract loader spinner.
- Keep Help and dialog close accessible names synchronized with the active Japanese / English UI language.
- Allow the Help dialog to close by clicking its backdrop, matching the rest of the dialog UX.
- Refresh release metadata and documentation for the RC milestone.

## 0.8.1 - 2026-09-17

### Fixed

- Fix the Canvas node toolbar Delete action by following the Node Editor Core action-id callback contract.
- Make Delete / Backspace confirmation use an explicit visible Delete action.

### Changed

- Refine the shared confirmation dialog into a compact, readable layout with clear normal / destructive actions and backdrop cancellation.
- Allow Quick Recipe input files to be assigned by drag and drop as well as the file picker.

## 0.8.0 - 2026-09-17

### Added

- Add Pipeline JSON save / open for portable pipeline definitions without source files or runtime results.
- Add a device-local Recipe library above the editor.
- Add Quick Recipe input-file assignment with **Apply to Canvas** and isolated **Use this Recipe** execution.
- Add Recipe result preview and explicit per-output save actions without changing the current Canvas.

### Changed

- Keep Input `File` objects, filenames, previews, runtime status, and generated results out of saved Recipes.
- Reuse the same local transform runtime for Canvas execution and isolated Quick Recipe execution.
- Embed Recipe utilities in the standalone HTML with no runtime network dependency.

## 0.7.1 - 2026-09-17

### Changed

- Close the enlarged intermediate-result preview when its backdrop is clicked.
- Write `created_by` as `Data Pipeline Builder` in generated Parquet metadata.
- Snappy-compress generated Parquet data pages while keeping the lightweight local writer.

## 0.7.0 - 2026-09-17

### Added

- Add JSONL Output with one JSON object per line and safe handling for Null, Date, BigInt, arrays, and objects.
- Add lightweight flat Parquet Output without DuckDB-WASM, Arrow, CDN, or runtime downloads.
- Add multiple Output nodes with Run All Outputs, a consolidated result list, output preview, and individual save actions.
- Add a lightweight Parquet writer to the standalone build.

### Changed

- Generalize output validation and execution across CSV / JSONL / Parquet nodes.
- Keep file saving explicit; running the pipeline never starts automatic downloads.
- Update help, README, offline verification notes, and release metadata for v0.7.0.

## 0.6.0 - 2026-09-17

### Added

- Add Group By with zero or more grouping columns.
- Add multiple Count / Sum / Average / Min / Max aggregations in one node.
- Add grouped intermediate Preview and schema inference for aggregate results.
- Add Japanese / English aggregate settings and node summaries.

### Changed

- Evaluate Group By against the complete upstream table before taking the 100-row Preview.
- Keep aggregate execution in the shared local Table Runtime without adding data-domain branches to Node Editor Core.
- Update help, README, and release metadata for v0.6.0.

## 0.5.0 - 2026-09-17

### Added

- Add Join with Inner / Left / Right / Full modes and multiple key pairs.
- Preserve both sides of column-name collisions by suffixing right-side columns with `_right`.
- Add Union with 2 to 6 inputs, matching columns by name or position.
- Add schema mismatch guidance for Union and confirmation before reducing the input count when removed ports are connected.
- Add dedicated multi-input port labels and Japanese / English inspector controls.

### Changed

- Exercise Node Editor Core multi-input ports in a real Data Pipeline Builder consumer without adding data-domain branches to Core.
- Evaluate Join / Union against complete upstream tables before taking the 100-row Preview.
- Update help, README, and release metadata for v0.5.0.

## 0.4.0 - 2026-09-17

### Added

- Add Filter Rows with a condition builder supporting `=`, `!=`, `>`, `>=`, `<`, `<=`, contains, starts with, ends with, is Null, and is not Null.
- Add AND / OR combination for multiple filter conditions.
- Add Null Handling for removing rows containing Null in selected columns or replacing Null with a fixed value.
- Add Japanese / English inspector controls and Canvas summaries for the new transform nodes.

### Changed

- Evaluate Filter Rows and Null Handling against the full upstream result before taking the 100-row Preview.
- Keep Null distinct from empty strings in filtering and Null handling.
- Update help, README, and release metadata for v0.4.0.

## 0.3.0 - 2026-09-17

### Added

- Add Rename Columns with multiple source-to-target mappings.
- Add multi-key Sort with ascending / descending direction.
- Add Limit for keeping the first N rows.
- Add Cast for String, Integer, Number, Boolean, Date and Timestamp with explicit error / NULL handling.
- Add Deduplicate using all columns or selected key columns while keeping the first occurrence.
- Add localized inspector controls and Canvas summaries for every Basic Transform node.

### Changed

- Route Basic Transform execution through the shared local Table Runtime instead of adding data-domain logic to Node Editor Core.
- Evaluate Sort and Deduplicate against the full upstream result so the 100-row preview reflects global ordering and duplicate removal.
- Update help, README and release metadata for the v0.3.0 Basic Transform milestone.

### Fixed

- Focus the actual failing node when a transform raises an execution error.
- Clone transform rule settings before editing so Undo / Redo snapshots are not mutated in place.
- Prevent background preview reads from overwriting Run success / failure status messages.

## 0.2.0 - 2026-09-16

### Added

- Replace the app icon and favicon with the supplied Data Pipeline Builder artwork.
- Add schema-aware previews with inferred column types, NULL / empty counts, and up to 100 rows.
- Add JSONL Input with first-seen column union and line-aware parse errors.
- Add Parquet Input for flat schemas using a lightweight embedded JavaScript reader.
- Support Uncompressed, Snappy and GZIP Parquet pages.
- Show Parquet physical types alongside inferred preview types.
- Improve CSV delimiter auto-detection by sampling multiple rows while ignoring quoted delimiters.
- Add shared table utilities that are inlined into the standalone HTML at build time.

### Changed

- Update header and help copy from the CSV-only vertical slice to a table-data workflow.
- Keep DuckDB-WASM and Apache Arrow out of the runtime.
- Reject nested / repeated Parquet schemas and unsupported codecs with actionable errors instead of silently misreading data.

### Fixed

- Ignore stale asynchronous Select Columns inspector results after the user switches to another node.
- Stagger nodes added by palette click instead of stacking every new node at the exact canvas center.

## 0.1.0 - 2026-09-16

### Fixed

- Guard NodeCanvas initialization callbacks so startup no longer fails before language/help handlers are registered.
- Align the workspace shell with PDF Pipeline Builder: integrated toolbar, 3-column editor and bottom result bar.
- Remove DuckDB-WASM and Apache Arrow from the v0.1.0 runtime.
- Make the Node Editor canvas fill the full editor height instead of stopping at the Core 320px minimum.
- Restore the floating expanded workspace with Palette / Canvas / Inspector kept visible.
- Localize Japanese node names, Canvas tooltips, accessibility labels, and expanded-workspace controls.

### Added

- Initial Data Pipeline Builder vertical slice.
- Node Editor Core v1.1.0 integration.
- CSV / TSV Input node with local runtime file state.
- Select Columns node with column ordering.
- CSV Output node with explicit save action.
- Lightweight built-in JavaScript CSV parser/writer with no data-engine dependency.
- Upstream-only preview for the selected node, limited to 100 rows.
- Runtime node statuses, validation, error translation, and mobile workspace tabs.
- Browser Kitty local-only CSP with `connect-src 'none'`.
