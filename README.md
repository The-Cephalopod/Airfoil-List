Needed a sortable list of airfoils for a project. Made with AI (sorry). On github becuase I need to host it on a website.

## What is included

- Full-catalog discovery from a UIUC-compatible coordinate mirror
- A bundled 61-airfoil offline starter catalog
- Search, sorting, pagination, table/card views, and family filters
- Relevance **color coding** instead of exclusionary filters
- Project-specific ranking using estimated chord Reynolds number and Mach number
- Separate wing and horizontal-stabilizer ranking modes
- Want-to-try and tried collections
- Up to six-airfoil geometry comparison
- Airfoil detail pages with geometry-derived thickness, camber, and trailing-edge thickness
- Links to coordinate sources and external specification/polar pages
- Per-airfoil notes and real-world test records
- JSON backup/import and CSV exports
- Responsive, dependency-free static hosting

## Important scope

“Every airfoil” is not a finite, controlled set: proprietary, unpublished, custom, and newly designed sections cannot be exhaustively indexed. This project indexes every entry available from the configured coordinate source. The UIUC source contains roughly 1,650 coordinate entries, and the import script can also ingest any folder of Selig-format `.dat` files.

The app deliberately separates:

1. **Geometry-derived data** — thickness, camber, their chordwise positions, trailing-edge thickness, and approximate symmetry.
2. **Published evidence** — source and polar links where available.
3. **Heuristic classifications** — broad family/use/Reynolds recommendations used by the ranking model.
4. **Your measurements** — flight, tunnel, or bench-test records entered in the browser.

It does not invent lift coefficient, drag coefficient, stall angle, or pitching moment for sections that lack compatible data.

## Run locally

Opening `index.html` directly will block JSON loading in most browsers. Serve the folder:

```bash
cd airfoil-atlas
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Build the full static catalog

The website discovers the complete mirror index in the browser, so this step is optional. Prebuilding provides geometry metrics for all entries and removes dependence on runtime GitHub API discovery.

Official UIUC source:

```bash
python scripts/build_catalog.py --source official
```

Public UIUC-compatible mirror:

```bash
python scripts/build_catalog.py --source github
```

A local folder of `.dat` files:

```bash
python scripts/build_catalog.py \
  --source local \
  --local-dir /path/to/airfoils
```

Useful options:

```bash
python scripts/build_catalog.py --source official --workers 8 --limit 25
python scripts/build_catalog.py --source local --local-dir ./my-foils --include-coordinates
```

The script uses only the Python standard library. It records parse failures in the resulting JSON instead of silently dropping them.

## Files

- `index.html` — application shell
- `styles.css` — responsive interface
- `app.js` — catalog, ranking, geometry, comparison, and local data logic
- `data/airfoils.json` — bundled catalog or generated full catalog
- `scripts/build_catalog.py` — source importer and geometry analyzer
- `CNAME` — custom-domain declaration
- `CREDITS.md` — data-source and methodology notes

## License

Application code is MIT licensed. Airfoil coordinate files and linked polar/test data retain the terms and attribution of their original sources. This repository links to or imports those sources; it does not relicense them.
