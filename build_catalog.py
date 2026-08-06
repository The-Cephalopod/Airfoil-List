#!/usr/bin/env python3
"""Build a static Airfoil Atlas catalog from UIUC-format .dat coordinate files.

Sources:
  official  Parse the UIUC Airfoil Coordinates Database page.
  github    Read the public UIUC-compatible GitHub mirror tree.
  local     Read .dat files from a local directory.

The script derives geometry only. It does not invent lift, drag, stall angle, or
operating limits. Family and broad use labels are explicitly heuristic.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import html.parser
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import zipfile
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, quote
from urllib.request import Request, urlopen

UIUC_INDEX = "https://m-selig.ae.illinois.edu/ads/coord_database.html"
UIUC_BASE = "https://m-selig.ae.illinois.edu/ads/coord/"
UIUC_ZIP = "https://m-selig.ae.illinois.edu/ads/archives/coord_seligFmt.zip"
GITHUB_TREE = "https://api.github.com/repos/vrona/Airfoil-DNA/git/trees/master?recursive=1"
GITHUB_RAW = "https://raw.githubusercontent.com/vrona/Airfoil-DNA/master/coord_seligFmt/"
AIRFOILTOOLS = "https://airfoiltools.com/airfoil/details?airfoil="
USER_AGENT = "AirfoilAtlasCatalogBuilder/1.0 (+https://finnclayton.com)"


class DatLinkParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href and href.lower().endswith(".dat"):
            self.links.append(urljoin(UIUC_INDEX, href))


def fetch_bytes(url: str, *, retries: int = 3, timeout: int = 30) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last = exc
            if attempt + 1 < retries:
                time.sleep(0.75 * (2**attempt))
    raise RuntimeError(f"could not fetch {url}: {last}")


def fetch_text(url: str, **kwargs: object) -> str:
    return fetch_bytes(url, **kwargs).decode("utf-8", errors="replace")




def official_archive_sources(directory: Path) -> list[tuple[str, str]]:
    """Download the official archive once and expose its .dat files locally."""
    archive = zipfile.ZipFile(io.BytesIO(fetch_bytes(UIUC_ZIP)))
    files: list[tuple[str, str]] = []
    seen: set[str] = set()
    for info in archive.infolist():
        filename = Path(info.filename).name
        if not filename.lower().endswith(".dat") or filename.lower() in seen:
            continue
        seen.add(filename.lower())
        target = directory / filename
        target.write_bytes(archive.read(info))
        files.append((filename, str(target)))
    if not files:
        raise RuntimeError("official archive contained no .dat files")
    return sorted(files, key=lambda item: item[0].lower())


def official_sources() -> list[tuple[str, str]]:
    parser = DatLinkParser()
    parser.feed(fetch_text(UIUC_INDEX))
    unique = {}
    for url in parser.links:
        name = url.rsplit("/", 1)[-1]
        unique[name.lower()] = (name, url)
    if not unique:
        raise RuntimeError("UIUC page returned no .dat links")
    return sorted(unique.values())


def github_sources() -> list[tuple[str, str]]:
    payload = json.loads(fetch_text(GITHUB_TREE))
    files = []
    for item in payload.get("tree", []):
        path = item.get("path", "")
        if item.get("type") == "blob" and re.fullmatch(r"coord_seligFmt/.*\.dat", path, re.I):
            filename = path.rsplit("/", 1)[-1]
            files.append((filename, GITHUB_RAW + quote(filename)))
    if not files:
        raise RuntimeError("GitHub mirror returned no coordinate files")
    return sorted(files, key=lambda item: item[0].lower())


def local_sources(directory: Path) -> list[tuple[str, str]]:
    if not directory.is_dir():
        raise RuntimeError(f"local directory does not exist: {directory}")
    files = sorted(directory.rglob("*.dat"), key=lambda p: p.name.lower())
    if not files:
        raise RuntimeError(f"no .dat files found under {directory}")
    return [(path.name, str(path)) for path in files]


def parse_dat(text: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for line in text.splitlines():
        clean = line.strip().replace(",", " ")
        if not clean or clean.startswith(("#", "!")):
            continue
        parts = clean.split()
        if len(parts) < 2:
            continue
        try:
            x, y = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if math.isfinite(x) and math.isfinite(y):
            points.append((x, y))
    if len(points) < 5:
        raise ValueError("fewer than five coordinate points")
    xs = [p[0] for p in points]
    x_min, x_max = min(xs), max(xs)
    chord = x_max - x_min
    if chord <= 0:
        raise ValueError("zero coordinate chord")
    return [((x - x_min) / chord, y / chord) for x, y in points]


def dedupe(points: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    values: dict[float, tuple[float, float]] = {}
    for x, y in points:
        key = round(x, 7)
        prior = values.get(key)
        if prior is None or abs(y) > abs(prior[1]):
            values[key] = (x, y)
    return sorted(values.values())


def interpolate(points: list[tuple[float, float]], x: float) -> float | None:
    if not points or x < points[0][0] - 1e-7 or x > points[-1][0] + 1e-7:
        return None
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        if x <= b[0] + 1e-10:
            dx = b[0] - a[0]
            if abs(dx) < 1e-12:
                return (a[1] + b[1]) / 2
            q = (x - a[0]) / dx
            return a[1] + q * (b[1] - a[1])
    return points[-1][1]


def geometry_metrics(points: list[tuple[float, float]]) -> dict[str, float | bool | None]:
    le_index = min(range(len(points)), key=lambda i: points[i][0])
    upper = dedupe(reversed(points[: le_index + 1]))
    lower = dedupe(points[le_index:])
    if len(upper) < 2 or len(lower) < 2:
        by_x = sorted(points)
        upper = dedupe(p for p in by_x if p[1] >= 0)
        lower = dedupe(p for p in by_x if p[1] <= 0)

    maximum_thickness = -math.inf
    thickness_x = 0.0
    maximum_camber = 0.0
    camber_x = 0.0
    for i in range(501):
        x = i / 500
        yu, yl = interpolate(upper, x), interpolate(lower, x)
        if yu is None or yl is None:
            continue
        thickness = yu - yl
        camber = (yu + yl) / 2
        if thickness > maximum_thickness:
            maximum_thickness, thickness_x = thickness, x
        if abs(camber) > abs(maximum_camber):
            maximum_camber, camber_x = camber, x

    te_u, te_l = interpolate(upper, 1.0), interpolate(lower, 1.0)
    return {
        "thickness": round(maximum_thickness * 100, 4) if math.isfinite(maximum_thickness) else None,
        "thicknessPosition": round(thickness_x * 100, 3),
        "camber": round(maximum_camber * 100, 4) if math.isfinite(maximum_camber) else None,
        "camberPosition": round(camber_x * 100, 3),
        "trailingEdgeThickness": round((te_u - te_l) * 100, 4) if te_u is not None and te_l is not None else None,
        "symmetric": abs(maximum_camber) < 0.0025 if math.isfinite(maximum_camber) else None,
    }


def human_name(identifier: str) -> str:
    clean = re.sub(r"\.dat$", "", identifier, flags=re.I)
    if match := re.fullmatch(r"naca(.+)", clean, re.I):
        return f"NACA {match.group(1).upper()}"
    if clean.lower() == "clarky":
        return "Clark Y"
    if re.fullmatch(r"e\d+", clean, re.I):
        return "Eppler " + clean.upper()
    spaced = re.sub(r"([A-Za-z])([0-9])", r"\1 \2", clean.replace("_", "-"))
    spaced = re.sub(r"([0-9])([A-Za-z])", r"\1 \2", spaced)
    return " ".join(part.capitalize() for part in spaced.split())


def classify(identifier: str, metrics: dict[str, object]) -> dict[str, object]:
    compact = re.sub(r"[\s_\-()]", "", identifier.lower())
    symmetric = metrics.get("symmetric")
    base: dict[str, object] = {
        "family": "Other / historical",
        "recommendedRe": [250_000, 3_000_000],
        "recommendedMach": [0, 0.30],
        "speedClass": "Subsonic / application dependent",
        "altitudeClass": "Altitude depends on Reynolds number",
        "useCases": ["General comparison"],
        "traits": [],
        "classificationConfidence": "heuristic",
        "evidence": "Coordinate geometry; aerodynamic evidence varies",
    }
    if re.fullmatch(r"naca\d{4}", compact):
        digits = compact[-4:]
        camber = int(digits[0])
        base.update(
            family="NACA 4-digit",
            recommendedRe=[200_000, 8_000_000] if camber == 0 else [300_000, 8_000_000],
            useCases=["Stabilizer", "Aerobatic wing", "Bidirectional loading"] if camber == 0 else ["General aircraft wing", "Trainer", "UAV"],
            traits=["Symmetric", "Predictable", "Broadly documented"] if camber == 0 else ["Conventional camber", "Broadly documented"],
            classificationConfidence="high",
            evidence="Analytical NACA family; extensive published historical data for many sections",
        )
    elif re.match(r"naca(23|24|25)\d{3}", compact):
        base.update(family="NACA 5-digit", recommendedRe=[500_000, 10_000_000], useCases=["General aircraft wing", "Higher design lift"], traits=["Designed lift coefficient", "Historical test data"], classificationConfidence="medium")
    elif re.match(r"naca(6|63|64|65|66|67)", compact):
        base.update(family="NACA 6-series", recommendedRe=[1_000_000, 15_000_000], recommendedMach=[0.1, 0.7], speedClass="Efficient subsonic / laminar-flow design", useCases=["Efficient cruise", "Laminar-flow wing"], traits=["Low-drag bucket", "Surface-finish sensitive"], classificationConfidence="medium")
    elif compact.startswith("clark"):
        base.update(family="Clark", recommendedRe=[150_000, 5_000_000], useCases=["Low-speed wing", "Trainer", "UAV"], traits=["Simple construction", "Forgiving", "Flat-ish lower surface"], evidence="Historical geometry and published test data available")
    elif re.match(r"ag\d", compact):
        base.update(family="Drela AG", recommendedRe=[50_000, 700_000], speedClass="Low speed / low Reynolds number", altitudeClass="Small UAV and model-aircraft regimes", useCases=["Low-Re UAV", "Glider", "Endurance"], traits=["Low-Re design", "Smooth-surface sensitive"], evidence="UIUC low-speed program includes selected AG sections")
    elif compact.startswith("sd"):
        base.update(family="Selig/Donovan (SD)", recommendedRe=[60_000, 1_000_000], speedClass="Low speed / low Reynolds number", useCases=["UAV", "Model aircraft", "Glider"], traits=["Low-Re design", "Common model-aircraft family"])
    elif re.match(r"s\d{3,4}", compact):
        base.update(family="Selig / NREL S-series", recommendedRe=[80_000, 1_500_000], speedClass="Low speed, section dependent", useCases=["UAV", "Wind turbine", "High lift"], traits=["Very high lift" if compact.startswith("s12") else "Low-Re design", "Wind-tunnel data for selected sections"], evidence="Selected S-series sections have published UIUC/NREL data")
    elif re.match(r"e\d{2,4}", compact) or compact.startswith("eppler"):
        base.update(family="Eppler", recommendedRe=[60_000, 1_500_000], speedClass="Low to moderate speed", useCases=["Glider", "UAV", "Efficient cruise"], traits=["Low-Re family", "Section-specific sensitivity"])
    elif compact.startswith("fx"):
        base.update(family="Wortmann FX", recommendedRe=[80_000, 2_500_000], speedClass="Low to moderate speed", useCases=["Glider", "UAV", "Sailplane"], traits=["Laminar-flow intent", "Surface-finish sensitive"])
    elif compact.startswith("mh"):
        base.update(family="Martin Hepperle (MH)", recommendedRe=[50_000, 1_500_000], speedClass="Low speed / model aircraft", useCases=["UAV", "Model aircraft", "Propeller or wing, section dependent"], traits=["Low-Re family"])
    elif compact.startswith("rg"):
        base.update(family="RG", recommendedRe=[60_000, 1_200_000], useCases=["Glider", "Model aircraft", "UAV"], traits=["Low-Re family"])
    elif compact.startswith(("sc", "nasasc", "sc2")):
        base.update(family="NASA supercritical", recommendedRe=[3_000_000, 30_000_000], recommendedMach=[0.55, 0.82], speedClass="High subsonic / transonic", altitudeClass="Transport-aircraft operating regimes", useCases=["High-subsonic cruise", "Transonic wing"], traits=["Supercritical", "Poor fit for most small low-speed UAVs"])
    elif compact.startswith("rae"):
        base.update(family="RAE", recommendedRe=[1_000_000, 20_000_000], recommendedMach=[0.25, 0.8], speedClass="Moderate to transonic, section dependent", useCases=["Research benchmark", "High-speed aircraft"], traits=["Published benchmark data for selected sections"])
    elif compact.startswith("du"):
        base.update(family="Delft DU", recommendedRe=[1_000_000, 20_000_000], useCases=["Wind turbine", "High-Re wing"], traits=["Wind-turbine family", "Often relatively thick"])
    elif compact.startswith(("ffa", "oso")):
        base.update(family="FFA" if compact.startswith("ffa") else "OSO", recommendedRe=[2_500_000, 20_000_000], useCases=["Wind turbine"], traits=["Thick structural section", "High Reynolds number"])
    elif compact.startswith("nlf"):
        base.update(family="NASA NLF", recommendedRe=[500_000, 10_000_000], useCases=["Natural laminar flow", "Efficient cruise"], traits=["Laminar-flow intent", "Surface-finish sensitive"])
    elif compact.startswith("ls"):
        base.update(family="NASA LS", recommendedRe=[500_000, 10_000_000], useCases=["Low-speed aircraft", "Efficient cruise"], traits=["Low-speed design"])
    elif compact.startswith(("hq", "hqu")):
        base.update(family="HQ", recommendedRe=[80_000, 1_500_000], useCases=["Glider", "Model aircraft"], traits=["Low-Re family"])
    if symmetric is True and "Stabilizer" not in base["useCases"]:
        base["useCases"] = list(base["useCases"]) + ["Stabilizer candidate"]
    return base


def build_one(source: tuple[str, str], source_kind: str, include_coordinates: bool) -> dict[str, object]:
    filename, location = source
    identifier = re.sub(r"\.dat$", "", filename, flags=re.I)
    text = Path(location).read_text(errors="replace") if source_kind in {"local", "official_archive"} else fetch_text(location)
    points = parse_dat(text)
    metrics = geometry_metrics(points)
    entry: dict[str, object] = {
        "id": identifier,
        "filename": filename,
        "name": human_name(identifier),
        **metrics,
        **classify(identifier, metrics),
        "geometrySource": "UIUC Airfoil Coordinates Database" if source_kind in {"official", "official_archive"} else ("UIUC-compatible coordinate mirror" if source_kind == "github" else "Local coordinate file"),
        "coordinateUrl": (UIUC_BASE + quote(filename)) if source_kind == "official_archive" else (location if source_kind != "local" else None),
        "officialSourceUrl": UIUC_INDEX,
        "specificationUrl": AIRFOILTOOLS + quote(identifier) + "-il",
    }
    if include_coordinates:
        entry["coordinates"] = [[round(x, 7), round(y, 7)] for x, y in points]
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("official", "github", "local"), default="official")
    parser.add_argument("--local-dir", type=Path, help="directory used with --source local")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "airfoils.json")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--include-coordinates", action="store_true", help="embed all normalized coordinates; produces a much larger JSON file")
    parser.add_argument("--limit", type=int, help="process only the first N entries for testing")
    args = parser.parse_args()

    temporary: tempfile.TemporaryDirectory[str] | None = None
    worker_source = args.source
    try:
        if args.source == "official":
            temporary = tempfile.TemporaryDirectory(prefix="airfoil-atlas-")
            try:
                sources = official_archive_sources(Path(temporary.name))
                worker_source = "official_archive"
            except Exception as archive_error:
                print(f"official archive failed ({archive_error}); falling back to individual index links", file=sys.stderr)
                sources = official_sources()
                worker_source = "official"
        elif args.source == "github":
            sources = github_sources()
        else:
            if not args.local_dir:
                parser.error("--local-dir is required with --source local")
            sources = local_sources(args.local_dir)
    except Exception as exc:
        if temporary:
            temporary.cleanup()
        print(f"source discovery failed: {exc}", file=sys.stderr)
        return 2

    if args.limit:
        sources = sources[: args.limit]
    print(f"Discovered {len(sources):,} coordinate files from {args.source}.")

    entries: list[dict[str, object]] = []
    failures: list[dict[str, str]] = []
    with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        future_map = {pool.submit(build_one, source, worker_source, args.include_coordinates): source for source in sources}
        for index, future in enumerate(cf.as_completed(future_map), 1):
            filename, location = future_map[future]
            try:
                entries.append(future.result())
            except Exception as exc:
                failures.append({"filename": filename, "location": location, "error": str(exc)})
            if index % 100 == 0 or index == len(sources):
                print(f"Processed {index:,}/{len(sources):,}; failures: {len(failures):,}")

    entries.sort(key=lambda x: str(x["name"]).lower())
    payload = {
        "schema": "airfoil-atlas-catalog-v1",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source": args.source,
        "sourceUrl": UIUC_INDEX if args.source == "official" else (GITHUB_TREE if args.source == "github" else str(args.local_dir)),
        "count": len(entries),
        "failureCount": len(failures),
        "airfoils": entries,
        "failures": failures,
        "notes": [
            "Thickness and camber are derived from coordinate geometry.",
            "Recommended ranges and use labels are heuristic family classifications, not measured limits.",
            "Aerodynamic polar data must be joined from a compatible experimental or computational dataset."
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(entries):,} entries to {args.output}")
    if failures:
        print(f"Warning: {len(failures):,} files could not be parsed; details are stored in the output JSON.", file=sys.stderr)
    if temporary:
        temporary.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
