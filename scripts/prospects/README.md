# Prospect list generator

Builds `business/prospects/verity_prospects_india_20000.*` from Overture Maps Places.

```bash
pip install pyarrow pandas openpyxl
python3 scripts/prospects/extract.py   # India slice of Overture Places -> out/india_bbox.parquet (~5.4M rows)
python3 scripts/prospects/build.py     # map, dedupe, exclude, score, pick 20,000 -> out/prospects.parquet + csv
python3 scripts/prospects/xlsx.py      # workbook -> out/verity_prospects_india_20000.xlsx
```

- `mapping.py`: Overture category → Verity business slug, plus name-based refinements.
- `hubs.json`: business slug → industry hub (from `verity-explore/industries/*`).
- Env: `PROSPECTS_OUT` (default `scripts/prospects/out/`, git-ignored),
  `VERITY_EXPLORE_BUSINESSES` (default `../verity-explore/businesses` beside this repo).
- To use a newer release, change the release string in `extract.py`. Scoring and exclusions are in `build.py`.
