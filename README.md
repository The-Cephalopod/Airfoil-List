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

## Deploy at `airfoils.finnclayton.com`

### Cloudflare Pages

1. Put this folder in a Git repository.
2. Create a Pages project from the repository.
3. Use `python scripts/build_catalog.py --source official` as the optional build command to precompute the full official catalog. Set the output directory to the repository root. Leaving the build command empty still works because the browser can discover the mirror index at runtime.
4. Add `airfoils.finnclayton.com` as a custom domain in Pages.
5. Follow the DNS prompt. If DNS is elsewhere, create the requested `CNAME` record for host `airfoils`.

### GitHub Pages

1. Push the contents to a repository.
2. Push to the `main` branch and select **GitHub Actions** as the Pages source. The included workflow builds the full official catalog, falls back to the mirror if necessary, and deploys the root folder.
3. Enter `airfoils.finnclayton.com` under **Custom domain**.
4. Create the DNS record GitHub requests. The included `CNAME` file preserves the custom domain during deployment.

### Netlify

Drag the folder into Netlify Deploys or connect the repository, then assign the subdomain in **Domain management**. No build command is required.

## Project data and collaboration

This version is local-first. Notes, statuses, test records, comparison selections, settings, and fetched geometry are saved in browser `localStorage`. They are not uploaded anywhere.

Use **Data → Export project JSON** to back up or share a project, then import it on another machine. For simultaneous multi-user editing, replace the storage functions at the end of `app.js` with a database API such as Supabase, Firebase, or your own backend.

## Ranking model

The score is a screening tool, not an aerodynamic solver. It combines:

- Reynolds-number compatibility
- Mach-number compatibility
- Mission labels
- Geometry and stabilizer suitability
- Evidence/provenance quality
- User preferences for thickness, camber, symmetry, roughness tolerance, and test evidence

Changing a preference changes each row’s color and ordering; it does not remove candidates. Name search and project collections are the only intentional narrowing mechanisms.

For final selection, compare candidates at the actual Reynolds number, transition/roughness condition, angle-of-attack range, and target lift coefficient. Then account for three-dimensional wing planform, aspect ratio, twist, control surfaces, propeller slipstream, structural constraints, and stability margins.

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
