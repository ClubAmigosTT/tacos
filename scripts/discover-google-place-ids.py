#!/usr/bin/env python3
"""Discover Google Place IDs and reconcile them with the local taco catalog.

The script is deliberately a separate catalog operation. It does not run when
the mobile app opens, and it does not copy Google place content into the app.
It stores only Google Place IDs plus our own search scope and reconciliation
result. Names, addresses and coordinates returned by Google are used in memory
to improve matching and are never written to the output database.

Typical runs:

    GOOGLE_PLACES_API_KEY=... python scripts/discover-google-place-ids.py \
        --compare --region cdmx-edomex --grid-step 0.08 --max-requests 60

Run the same command again to continue. Each plan has persistent page checkpoints
and a cumulative HTTP request limit. Use --compare explicitly for Text Search Pro.
"""

from __future__ import annotations

import argparse
import hashlib
import contextlib
import csv
import difflib
import json
import math
import os
import re
import sqlite3
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import urllib.error
import urllib.request


GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
DEFAULT_CATALOG = "catalog/cdmx-edomex.json"
DEFAULT_BOUNDARIES = "catalog/osm-boundaries.json"
DEFAULT_DB = "catalog/google-place-candidates.sqlite"
DEFAULT_JSON = "catalog/google-place-candidates.json"
DEFAULT_CSV = "catalog/google-place-candidates.csv"
DEFAULT_MISSING_IDS = "catalog/google-place-ids-missing.txt"
DEFAULT_REVIEW_IDS = "catalog/google-place-ids-review.txt"

DEFAULT_TERMS = (
    "tacos",
    "taquería",
    "tacos de canasta",
    "tacos al pastor",
    "birria",
    "carnitas",
    "barbacoa",
    "suadero",
    "tacos de guisado",
    "tacos de cabeza",
)

# A coarse default is intentional. Dense coverage can be run in resumable
# passes with --grid-step 0.04 or 0.05 and a request budget.
DEFAULT_GRID_STEP = 0.12
MAX_GOOGLE_PAGES = 3
MAX_PAGE_SIZE = 20
REQUEST_RETRIES = 3


@dataclass(frozen=True)
class Area:
    key: str
    label: str
    polygon: list[list[tuple[float, float]]]
    south: float
    west: float
    north: float
    east: float


@dataclass(frozen=True)
class Cell:
    area: str
    south: float
    west: float
    north: float
    east: float

    @property
    def key(self) -> str:
        return f"{self.area}:{self.south:.6f}:{self.west:.6f}:{self.north:.6f}:{self.east:.6f}"


@dataclass
class Branch:
    branch_id: str
    name: str
    address: str
    latitude: float
    longitude: float
    area: str
    catalog_status: str = "active"


@dataclass
class Match:
    status: str
    branch_id: str | None
    confidence: float | None
    method: str | None
    catalog_status: str | None = None


class GoogleResponse:
    def __init__(self, status_code: int, body: str):
        self.status_code = status_code
        self.text = body

    def json(self) -> dict[str, Any]:
        return json.loads(self.text)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    text = str(value or "")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.lower().replace("&", " y ")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


GENERIC_NAME_TOKENS = {
    "taqueria",
    "taquería",
    "tacos",
    "taco",
    "restaurante",
    "restaurant",
    "comida",
    "mexicana",
    "mexicano",
    "antojitos",
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "y",
}


def tokens(value: Any, remove_generic: bool = False) -> set[str]:
    values = set(normalize_text(value).split())
    if remove_generic:
        values -= {normalize_text(token) for token in GENERIC_NAME_TOKENS}
    return values


def token_similarity(left: Any, right: Any, remove_generic: bool = False) -> float:
    left_tokens = tokens(left, remove_generic)
    right_tokens = tokens(right, remove_generic)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def text_similarity(left: Any, right: Any, remove_generic: bool = False) -> float:
    left_normalized = normalize_text(left)
    right_normalized = normalize_text(right)
    if not left_normalized or not right_normalized:
        return 0.0
    if remove_generic:
        left_normalized = " ".join(sorted(tokens(left, True)))
        right_normalized = " ".join(sorted(tokens(right, True)))
        if not left_normalized or not right_normalized:
            return 0.0
    sequence = difflib.SequenceMatcher(None, left_normalized, right_normalized).ratio()
    overlap = token_similarity(left, right, remove_generic)
    return max(sequence, overlap)


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    value = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0.0, 1 - value)))


def polygon_bbox(rings: list[list[tuple[float, float]]]) -> tuple[float, float, float, float]:
    points = [point for ring in rings for point in ring]
    return (
        min(point[1] for point in points),
        min(point[0] for point in points),
        max(point[1] for point in points),
        max(point[0] for point in points),
    )


def point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    previous_lon, previous_lat = ring[-1]
    for current_lon, current_lat in ring:
        crosses = (current_lat > lat) != (previous_lat > lat)
        if crosses:
            denominator = previous_lat - current_lat
            if denominator == 0:
                denominator = 1e-12
            crossing_lon = (previous_lon - current_lon) * (lat - current_lat) / denominator + current_lon
            if lon < crossing_lon:
                inside = not inside
        previous_lon, previous_lat = current_lon, current_lat
    return inside


def point_in_polygon(lon: float, lat: float, rings: list[list[tuple[float, float]]]) -> bool:
    if not rings or not point_in_ring(lon, lat, rings[0]):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in rings[1:])


def parse_geometry(raw_geometry: dict[str, Any]) -> list[list[tuple[float, float]]]:
    geometry_type = raw_geometry.get("type")
    coordinates = raw_geometry.get("coordinates", [])
    if geometry_type == "Polygon":
        return [[(float(point[0]), float(point[1])) for point in ring] for ring in coordinates]
    if geometry_type == "MultiPolygon" and coordinates:
        # The current boundary file uses polygons. For a multipolygon, keep
        # the largest exterior ring; this is sufficient for cell planning and
        # avoids sending requests from disconnected islands.
        polygons = []
        for polygon in coordinates:
            rings = [[(float(point[0]), float(point[1])) for point in ring] for ring in polygon]
            if rings:
                polygons.append(rings)
        if polygons:
            return max(polygons, key=lambda item: len(item[0]))
    raise ValueError(f"Geometría territorial no soportada: {geometry_type}")


def load_areas(path: Path, region: str) -> list[Area]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    areas: list[Area] = []
    boundaries = []
    for boundary in payload.get("boundaries", []):
        geometry = boundary["geometry"]
        parts = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        boundaries.extend({**boundary, "geometry": {"type": "Polygon", "coordinates": part}} for part in parts)
    for boundary in boundaries:
        label = str(boundary.get("name") or "").strip()
        normalized = normalize_text(label)
        if "ciudad de mexico" in normalized:
            key = "cdmx"
        elif "estado de mexico" in normalized:
            key = "edomex"
        else:
            continue
        if region not in ("cdmx-edomex", key):
            continue
        rings = parse_geometry(boundary["geometry"])
        south, west, north, east = polygon_bbox(rings)
        areas.append(Area(key, label, rings, south, west, north, east))
    if not areas:
        raise ValueError(f"No se encontraron límites para --region {region!r} en {path}")
    return areas


def segment_intersects_box(a, b, west, south, east, north):
    # Liang-Barsky: catches thin boundary strips and polygons inside a cell.
    low, high = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0]-west), (dx, east-a[0]), (-dy, a[1]-south), (dy, north-a[1])):
        if p == 0:
            if q < 0:
                return False
            continue
        ratio = q / p
        if p < 0:
            low = max(low, ratio)
        else:
            high = min(high, ratio)
        if low > high:
            return False
    return True


def generate_cells(area: Area, step: float) -> list[Cell]:
    cells: list[Cell] = []
    lat = area.south
    while lat < area.north:
        lon = area.west
        cell_north = min(lat + step, area.north)
        while lon < area.east:
            cell_east = min(lon + step, area.east)
            corners = (
                (lon, lat),
                (cell_east, lat),
                (lon, cell_north),
                (cell_east, cell_north),
                ((lon + cell_east) / 2, (lat + cell_north) / 2),
            )
            if (any(point_in_polygon(x, y, area.polygon) for x, y in corners)
                    or any(segment_intersects_box(a, b, lon, lat, cell_east, cell_north)
                           for ring in area.polygon for a, b in zip(ring, ring[1:] + ring[:1]))):
                cells.append(Cell(area.key, lat, lon, cell_north, cell_east))
            lon += step
        lat += step
    return cells


def area_for_branch(row: dict[str, Any]) -> str:
    state = normalize_text(row.get("state"))
    if state == "ciudad de mexico" or state == "cdmx":
        return "cdmx"
    return "edomex" if "estado de mexico" in state or state in {"mexico", "edomex"} else "unknown"


def load_branches(path: Path, include_review: bool) -> list[Branch]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("branches") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError(f"El catálogo debe ser un array o un objeto con branches: {path}")
    branches: list[Branch] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not include_review and row.get("catalogStatus", "active") != "active":
            continue
        try:
            latitude = float(row["latitude"])
            longitude = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(latitude) or not math.isfinite(longitude) or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            continue
        area = area_for_branch(row)
        if area == "unknown":
            continue
        branches.append(
            Branch(
                branch_id=str(row.get("id") or row.get("taqueriaId") or ""),
                name=str(row.get("name") or row.get("taqueriaName") or ""),
                address=str(row.get("address") or ""),
                latitude=latitude,
                longitude=longitude,
                area=area,
                catalog_status=row.get("catalogStatus", "active"),
            )
        )
    return [branch for branch in branches if branch.branch_id]


def init_database(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS google_place_candidates (
            google_place_id TEXT PRIMARY KEY,
            search_region TEXT NOT NULL,
            search_area TEXT NOT NULL,
            search_query TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            last_checked_at TEXT,
            matched_branch_id TEXT,
            match_status TEXT NOT NULL,
            match_confidence REAL,
            match_method TEXT,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS google_candidates_status_idx
            ON google_place_candidates(search_region, match_status, last_seen_at);
        CREATE TABLE IF NOT EXISTS google_search_queries (
            query_key TEXT PRIMARY KEY,
            search_region TEXT NOT NULL,
            search_area TEXT NOT NULL,
            search_query TEXT NOT NULL,
            south REAL NOT NULL,
            west REAL NOT NULL,
            north REAL NOT NULL,
            east REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            requests_used INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            started_at TEXT,
            completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS google_search_queries_status_idx
            ON google_search_queries(status, search_area, search_query);
        """
    )
    connection.commit()


def seed_queries(connection: sqlite3.Connection, region: str, cells: list[Cell], terms: list[str]) -> None:
    connection.executemany(
        """
        INSERT OR IGNORE INTO google_search_queries (
            query_key, search_region, search_area, search_query,
            south, west, north, east
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                f"{cell.key}:{term}",
                region,
                cell.area,
                term,
                cell.south,
                cell.west,
                cell.north,
                cell.east,
            )
            for cell in cells
            for term in terms
        ],
    )
    connection.commit()


def build_spatial_index(branches: Iterable[Branch], bucket_size: float = 0.005) -> dict[tuple[int, int], list[Branch]]:
    index: dict[tuple[int, int], list[Branch]] = {}
    for branch in branches:
        key = (math.floor(branch.latitude / bucket_size), math.floor(branch.longitude / bucket_size))
        index.setdefault(key, []).append(branch)
    return index


def nearby_branches(
    index: dict[tuple[int, int], list[Branch]],
    latitude: float,
    longitude: float,
    area: str,
    bucket_size: float = 0.005,
) -> list[tuple[float, Branch]]:
    row = math.floor(latitude / bucket_size)
    column = math.floor(longitude / bucket_size)
    candidates: list[tuple[float, Branch]] = []
    for row_offset in range(-2, 3):
        for column_offset in range(-2, 3):
            for branch in index.get((row + row_offset, column + column_offset), []):
                distance = haversine_meters(latitude, longitude, branch.latitude, branch.longitude)
                if distance <= 550:
                    candidates.append((distance, branch))
    candidates.sort(key=lambda item: item[0])
    return candidates


def reconcile_place(place, area, spatial_index, include_name=True):
    if not include_name:
        return Match("unverified", None, None, "ids_only")
    location = place.get("location") or {}
    try:
        lat, lon = float(location["latitude"]), float(location["longitude"])
        if not math.isfinite(lat) or not math.isfinite(lon):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        return Match("unverified", None, None, "missing_location")
    candidates = nearby_branches(spatial_index, lat, lon, area)
    name = (place.get("displayName") or {}).get("text", "")
    if not name:
        return Match("unverified", None, None, "missing_name")
    ranked = []
    for distance, branch in candidates:
        similarity = text_similarity(name, branch.name, True)
        address = text_similarity(place.get("formattedAddress"), branch.address)
        score = .7 * similarity + .2 * (1 - distance / 550) + .1 * address
        ranked.append((score, similarity, distance, branch))
    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked:
        return Match("missing", None, None, "no_catalog_branch_within_550m")
    score, similarity, distance, branch = ranked[0]
    ambiguous = len(ranked) > 1 and score - ranked[1][0] < .12
    # An address alone never identifies one stall inside a market.
    if similarity >= .85 and distance <= 150 and not ambiguous:
        status = "matched" if branch.catalog_status == "active" else "matched_unpublished"
        return Match(status, branch.branch_id, score, "name_distance_address", branch.catalog_status)
    if similarity >= .45 or distance <= 100:
        return Match("review", branch.branch_id, score,
                     "ambiguous_neighbors" if ambiguous else "weak_match", branch.catalog_status)
    return Match("missing", None, None, "no_confident_catalog_match")


def save_candidate(connection, place_id, region, area, query, match, checked_at, error=None):
    # A full new comparison may downgrade an older incorrect match.
    # IDs-only observations never erase a previously assessed match.
    connection.execute("""
        INSERT INTO google_place_candidates (
            google_place_id, search_region, search_area, search_query,
            first_seen_at, last_seen_at, last_checked_at, matched_branch_id,
            match_status, match_confidence, match_method, last_error,
            matched_catalog_status, comparison_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)
        ON CONFLICT(google_place_id) DO UPDATE SET
            last_seen_at=excluded.last_seen_at,
            search_region=excluded.search_region,
            search_area=excluded.search_area,
            search_query=excluded.search_query
    """, (place_id, region, area, query, checked_at, checked_at, checked_at,
          match.branch_id, match.status, match.confidence, match.method, error,
          match.catalog_status))
    if match.status != "unverified":
        connection.execute("""
            UPDATE google_place_candidates SET last_checked_at=?, matched_branch_id=?,
            match_status=?, match_confidence=?, match_method=?, last_error=?,
            matched_catalog_status=?, comparison_version=2 WHERE google_place_id=?
        """, (checked_at, match.branch_id, match.status, match.confidence,
              match.method, error, match.catalog_status, place_id))


def google_search(
    api_key: str,
    query: str,
    cell: Cell,
    include_name: bool,
    page_token: str | None,
    timeout: float,
) -> GoogleResponse:
    field_mask = "places.id,nextPageToken"
    if include_name:
        field_mask = "places.id,places.displayName,places.formattedAddress,places.location,nextPageToken"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": field_mask,
    }
    body: dict[str, Any] = {
        "textQuery": query,
        "pageSize": MAX_PAGE_SIZE,
        "languageCode": "es",
        "regionCode": "MX",
        "locationRestriction": {
            "rectangle": {
                "low": {"latitude": cell.south, "longitude": cell.west},
                "high": {"latitude": cell.north, "longitude": cell.east},
            }
        },
    }
    if page_token:
        body["pageToken"] = page_token
    request = urllib.request.Request(
        GOOGLE_TEXT_SEARCH_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={**headers, "User-Agent": "tacos-catalog-reconciliation/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return GoogleResponse(response.status, response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as error:
        return GoogleResponse(error.code, error.read().decode("utf-8", errors="replace"))
    except urllib.error.URLError as error:
        raise RuntimeError(str(error.reason)) from error


def response_json_with_retries(
    api_key: str,
    query: str,
    cell: Cell,
    include_name: bool,
    page_token: str | None,
    timeout: float,
    attempt_limit: int = REQUEST_RETRIES,
) -> tuple[dict[str, Any] | None, str | None, int]:
    last_error: str | None = None
    for attempt in range(1, max(1, attempt_limit) + 1):
        try:
            response = google_search(api_key, query, cell, include_name, page_token, timeout)
            if response.status_code == 200:
                return response.json(), None, attempt
            last_error = f"HTTP {response.status_code}"
            if response.status_code in {400, 401, 403}:
                break
        except (OSError, RuntimeError, ValueError):
            last_error = "Network or invalid JSON response"
        if attempt < max(1, attempt_limit):
            time.sleep(min(8, 2 ** (attempt - 1)))
    return None, last_error or "Error desconocido de Google Places", attempt


def upgrade_database(db):
    init_database(db)
    columns = {row[1] for row in db.execute("PRAGMA table_info(google_place_candidates)")}
    for name, kind in (("matched_catalog_status", "TEXT"), ("comparison_version", "INTEGER NOT NULL DEFAULT 1")):
        if name not in columns:
            db.execute(f"ALTER TABLE google_place_candidates ADD COLUMN {name} {kind}")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS google_plans (
            id TEXT PRIMARY KEY, config TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS google_queries_v2 (
            plan_id TEXT NOT NULL, query_key TEXT NOT NULL,
            area TEXT NOT NULL, term TEXT NOT NULL, priority INTEGER NOT NULL,
            south REAL NOT NULL, west REAL NOT NULL, north REAL NOT NULL, east REAL NOT NULL,
            depth INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
            page_token TEXT, pages INTEGER NOT NULL DEFAULT 0,
            results INTEGER NOT NULL DEFAULT 0, requests INTEGER NOT NULL DEFAULT 0,
            last_error TEXT, PRIMARY KEY(plan_id, query_key)
        );
        CREATE TABLE IF NOT EXISTS google_observations_v2 (
            plan_id TEXT NOT NULL, query_key TEXT NOT NULL, place_id TEXT NOT NULL,
            PRIMARY KEY(plan_id, query_key, place_id)
        );
    """)
    db.commit()


def enqueue(db, plan, cell, term, priority, depth=0):
    db.execute("""
        INSERT OR IGNORE INTO google_queries_v2
        (plan_id,query_key,area,term,priority,south,west,north,east,depth)
        VALUES (?,?,?,?,?,?,?,?,?,?)
    """, (plan, cell.key + ":" + term, cell.area, term, priority,
          cell.south, cell.west, cell.north, cell.east, depth))


def split_cell(cell, minimum):
    lat, lon = (cell.south+cell.north)/2, (cell.west+cell.east)/2
    if min(lat-cell.south, lon-cell.west) < minimum - 1e-9:
        return []
    return [Cell(cell.area, s, w, n, e)
            for s, n in ((cell.south, lat), (lat, cell.north))
            for w, e in ((cell.west, lon), (lon, cell.east))]


def choose_query(db, plan):
    return db.execute("""
        SELECT * FROM google_queries_v2 WHERE plan_id=? AND status IN ('pending','running','error')
        ORDER BY CASE WHEN priority < 2 THEN 0 ELSE 1 END,
                 depth, priority, south, west, area LIMIT 1
    """, (plan,)).fetchone()


def report(db, args, plan, branches):
    columns = ["googlePlaceId","searchRegion","searchArea","searchQuery","firstSeenAt",
               "lastSeenAt","lastCheckedAt","matchedBranchId","matchStatus","matchConfidence",
               "matchMethod","lastError","matchedCatalogStatus","comparisonVersion"]
    rows = db.execute("""
        SELECT google_place_id, search_region, search_area, search_query,
        first_seen_at,last_seen_at,last_checked_at,matched_branch_id,match_status,
        match_confidence,match_method,last_error,matched_catalog_status,comparison_version
        FROM google_place_candidates ORDER BY google_place_id
    """).fetchall()
    items = [dict(zip(columns, row)) for row in rows]
    for item in items:
        if item["comparisonVersion"] < 2:
            item["previousMatchStatus"] = item["matchStatus"]
            item["matchStatus"] = "unverified"
            item["matchMethod"] = "legacy_requires_recheck"
    counts = {}
    for item in items:
        counts[item["matchStatus"]] = counts.get(item["matchStatus"], 0) + 1
    coverage = [dict(row) for row in db.execute("""
        SELECT area,term,status,COUNT(*) AS cells,SUM(requests) AS requests
        FROM google_queries_v2 WHERE plan_id=? GROUP BY area,term,status
    """, (plan,))]
    queries = [dict(row) for row in db.execute("""
        SELECT area,term,south,west,north,east,depth,status,pages,results,requests
        FROM google_queries_v2 WHERE plan_id=? ORDER BY priority,depth,south,west
    """, (plan,))]
    payload = {"generatedAt": utc_now(), "planId": plan, "catalogBranches": len(branches),
               "counts": counts, "coverage": coverage, "queries": queries,
               "completeInventoryGuaranteed": False, "candidates": items}
    outputs = [Path(args.output_json), Path(args.output_csv), Path(args.missing_ids), Path(args.review_ids)]
    for path in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
    outputs[0].write_text(json.dumps(payload, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    with outputs[1].open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(items)
    for path, status in ((outputs[2], "missing"), (outputs[3], "review"),
                         (outputs[2].with_name("google-place-ids-unpublished.txt"), "matched_unpublished"),
                         (outputs[2].with_name("google-place-ids-unverified.txt"), "unverified")):
        ids = [item["googlePlaceId"] for item in items if item["matchStatus"] == status]
        path.write_text("".join(value+"\n" for value in ids), encoding="utf-8")
    print(json.dumps({"counts": counts, "coverage": coverage}, ensure_ascii=True, indent=2))


def parse_args():
    parser = argparse.ArgumentParser(description="Google Place IDs: descubrimiento y comparación reanudable.")
    parser.add_argument("--catalog", default=DEFAULT_CATALOG)
    parser.add_argument("--boundaries", default=DEFAULT_BOUNDARIES)
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--output-json", default=DEFAULT_JSON)
    parser.add_argument("--output-csv", default=DEFAULT_CSV)
    parser.add_argument("--missing-ids", default=DEFAULT_MISSING_IDS)
    parser.add_argument("--review-ids", default=DEFAULT_REVIEW_IDS)
    parser.add_argument("--region", choices=("cdmx-edomex","cdmx","edomex"), default="cdmx-edomex")
    parser.add_argument("--grid-step", type=float, default=.12)
    parser.add_argument("--min-grid-step", type=float, default=.015)
    parser.add_argument("--query", dest="queries", action="append")
    parser.add_argument("--max-requests", type=int, default=60)
    parser.add_argument("--max-plan-requests", type=int, default=300)
    parser.add_argument("--max-queries", type=int)
    parser.add_argument("--request-delay", type=float, default=.25)
    parser.add_argument("--request-timeout", type=float, default=45)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--ids-only", action="store_true", help="Sólo ID y nextPageToken; no determina faltantes")
    mode.add_argument("--compare", action="store_true", help="Consulta campos Text Search Pro; puede tener costo")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report-only", action="store_true", help="Actualiza reportes sin consultas")
    args = parser.parse_args()
    args.ids_only = not args.compare
    for name in ("grid_step", "min_grid_step", "request_timeout"):
        if not math.isfinite(getattr(args, name)) or getattr(args, name) <= 0:
            parser.error(f"{name} debe ser positivo y finito")
    if args.grid_step > 1 or args.min_grid_step > args.grid_step:
        parser.error("Cuadrícula inválida")
    if args.max_requests <= 0 or args.max_plan_requests <= 0:
        parser.error("Los límites deben ser positivos; no existe ejecución ilimitada")
    if args.max_queries is not None and args.max_queries <= 0:
        parser.error("--max-queries debe ser positivo")
    if not math.isfinite(args.request_delay) or args.request_delay < 0:
        parser.error("--request-delay debe ser no negativo")
    return args


def run(db, args, plan, areas, spatial_index):
    used, finished = 0, 0
    api_key = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
    if not api_key:
        raise ValueError("Falta GOOGLE_PLACES_API_KEY en el entorno")
    plan_used = db.execute("SELECT COALESCE(SUM(requests),0) FROM google_queries_v2 WHERE plan_id=?", (plan,)).fetchone()[0]
    while used < args.max_requests and plan_used < args.max_plan_requests:
        if args.max_queries and finished >= args.max_queries:
            break
        row = choose_query(db, plan)
        if row is None:
            break
        cell = Cell(row["area"], row["south"], row["west"], row["north"], row["east"])
        key = (plan, row["query_key"])
        print(f"{row['term']} | {cell.key} | pagina {row['pages']+1}", flush=True)
        # Reserve each HTTP attempt before sending, including failed attempts.
        db.execute("UPDATE google_queries_v2 SET status='running',requests=requests+1 WHERE plan_id=? AND query_key=?", key)
        db.commit()
        used += 1
        plan_used += 1
        payload, error, _ = response_json_with_retries(api_key, row["term"], cell,
            args.compare, row["page_token"], args.request_timeout, attempt_limit=1)
        if error:
            if error == "HTTP 400" and row["page_token"]:
                # Tokens can expire between runs; restart that cell safely.
                db.execute("""UPDATE google_queries_v2 SET page_token=NULL,pages=0,results=0,
                    status='pending',last_error='expired_page_restart' WHERE plan_id=? AND query_key=?""", key)
            else:
                db.execute("UPDATE google_queries_v2 SET status='error',last_error=? WHERE plan_id=? AND query_key=?", (error, *key))
            db.commit()
            print(f"Detenido: {error}. Avance conservado.", flush=True)
            return 1
        places = payload.get("places", [])
        if not isinstance(places, list):
            raise ValueError("Google respondió con places inválido")
        for place in places:
            place_id = place.get("id")
            if not isinstance(place_id, str) or not place_id:
                continue
            actual_area = row["area"]
            if args.compare and place.get("location"):
                location = place["location"]
                actual_area = next((a.key for a in areas if point_in_polygon(
                    location["longitude"], location["latitude"], a.polygon)), None)
                if actual_area is None:
                    continue
            match = reconcile_place(place, actual_area, spatial_index, args.compare)
            save_candidate(db, place_id, args.region, actual_area, row["term"], match, utc_now())
            db.execute("INSERT OR IGNORE INTO google_observations_v2 VALUES (?,?,?)", (*key, place_id))
        pages, results = row["pages"]+1, row["results"]+len(places)
        token = payload.get("nextPageToken")
        status = "pending" if token and pages < MAX_GOOGLE_PAGES else "completed"
        if status == "completed" and (results >= 60 or token):
            children = split_cell(cell, args.min_grid_step)
            status = "split" if children else "saturated"
            for child in children:
                enqueue(db, plan, child, row["term"], row["priority"], row["depth"]+1)
        db.execute("""UPDATE google_queries_v2 SET status=?,page_token=?,pages=?,results=?,
            last_error=NULL WHERE plan_id=? AND query_key=?""",
            (status, token if status == "pending" else None, pages, results, *key))
        db.commit()
        if status != "pending":
            finished += 1
        time.sleep(args.request_delay)
    print(f"Solicitudes de esta corrida: {used}; acumuladas del plan: {plan_used}", flush=True)
    return 0


def main():
    args = parse_args()
    areas = load_areas(Path(args.boundaries), args.region)
    cells = list({cell.key: cell for area in areas for cell in generate_cells(area, args.grid_step)}.values())
    branches = load_branches(Path(args.catalog), True)
    terms = list(dict.fromkeys(args.queries or DEFAULT_TERMS))
    terms = [term for term in ("tacos", "taquería") if term in terms] + [term for term in terms if term not in ("tacos", "taquería")]
    config = {"version": 2, "region": args.region, "grid": args.grid_step,
              "minimum": args.min_grid_step, "terms": terms, "compare": args.compare,
              "catalogHash": hashlib.sha256(Path(args.catalog).read_bytes()).hexdigest(),
              "boundariesHash": hashlib.sha256(Path(args.boundaries).read_bytes()).hexdigest()}
    plan = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:20]
    print(f"Plan {plan}: {len(cells)} celdas iniciales; {len(cells)*len(terms)} consultas iniciales; {len(branches)} sucursales.")
    print(f"Modo: {'comparación Text Search Pro' if args.compare else 'sólo IDs, sin determinar faltantes'}. Límite corrida/plan: {args.max_requests}/{args.max_plan_requests}.")
    if args.dry_run:
        return 0
    path = Path(args.db)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Separate SQLite lock prevents concurrent workers on this candidate DB.
    with contextlib.closing(sqlite3.connect(str(path)+".lock", timeout=0)) as lock:
        lock.execute("BEGIN EXCLUSIVE")
        with contextlib.closing(sqlite3.connect(path)) as db:
            db.row_factory = sqlite3.Row
            upgrade_database(db)
            db.execute("INSERT OR IGNORE INTO google_plans VALUES (?,?,?)", (plan, json.dumps(config), utc_now()))
            for cell in cells:
                for priority, term in enumerate(terms):
                    enqueue(db, plan, cell, term, priority)
            db.commit()
            try:
                return 0 if args.report_only else run(db, args, plan, areas, build_spatial_index(branches))
            finally:
                db.rollback()
                report(db, args, plan, branches)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("Interrumpido; avance conservado.")
