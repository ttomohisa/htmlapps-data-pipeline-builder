# Offline / local-only verification

1. Run `npm test`.
2. Build the standalone HTML with `build-standalone.bat` on Windows/PowerShell.
3. Confirm the generated HTML contains no unresolved `__...__` build placeholders.
4. Confirm the CSP contains `connect-src 'none'`.
5. Confirm no DuckDB-WASM or Apache Arrow runtime is embedded.
6. Open the standalone HTML offline and test CSV / TSV, JSONL and Parquet input.
7. For Parquet, test a supported flat file and verify unsupported nested/repeated schemas fail with an explanatory error.
8. Verify Preview and Select Columns work without network access.
9. Connect CSV, JSONL, and Parquet Output nodes, run all outputs, and verify the result list shows every generated file.
10. Save each result explicitly and confirm running a pipeline never triggers an automatic download.
11. Open a generated Parquet output with the bundled Parquet input reader and confirm flat scalar data round-trips.

## v1.0.0 Stable Release

Stable-release checks cover the existing CSV / TSV / JSONL / Parquet paths, transforms, Join / Union / Group By, Recipes, Pipeline JSON, Multi Output, Japanese / English UI, narrow-screen layout, CSP, readable standalone HTML, screenshots, and self-extract restoration. The v0.9.0 accessibility and reduced-motion fixes remain part of the final regression set.

## v0.8.1 Recipe / Pipeline JSON / UX

- Canvasでノードを選択し、ノード上部の **削除** を押すと、削除確認が表示され実際に削除できること。
- Delete / Backspaceでも削除確認の実行ボタンに **削除** と表示されること。
- 確認ダイアログがPC / スマートフォンで画面外にはみ出さず、外側クリックはキャンセル扱いになること。
- 保存済みRecipeを展開し、必要なInputへファイルをドラッグ＆ドロップして割り当てられること。

- Recipe definitions are stored only in browser local storage. Input `File` objects and filenames are excluded.
- Pipeline JSON includes graph/settings/positions/connections/output settings, but not input files or generated results.
- Quick Recipe execution evaluates an isolated graph and does not mutate the current Canvas.
