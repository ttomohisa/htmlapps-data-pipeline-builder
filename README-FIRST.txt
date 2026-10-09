Data Pipeline Builder v1.0.1

Start here:
- README.ja.md / README.md: overview and limitations
- APP_SPEC.md: formal specification and milestone plan
- VERIFY_OFFLINE.md: local-only verification notes

Implemented input formats:
- CSV / TSV
- JSONL / NDJSON
- Parquet (flat schemas; Uncompressed / Snappy / GZIP)

Implemented transform / combine / output:
- Select Columns / Rename / Sort / Limit / Cast / Deduplicate
- Filter Rows / Null Handling
- Join / Union
- Group By with Count / Sum / Average / Min / Max
- CSV / JSONL / Parquet Output
- Multiple Output nodes / Run All Outputs / Result list / individual save
- Pipeline JSON save / open
- Device-local Recipe library / Quick Recipe execution
- No automatic downloads

The runtime intentionally does not embed DuckDB-WASM or Apache Arrow.
Runtime network access is blocked by CSP (`connect-src 'none'`).
