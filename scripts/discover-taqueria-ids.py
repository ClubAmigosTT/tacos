#!/usr/bin/env python3
"""Descubre candidatos a taqueria en OpenStreetMap y conserva sus IDs.

Por defecto consulta los limites administrativos completos de Ciudad de Mexico
y Estado de Mexico. Los resultados se guardan en SQLite en lotes
transaccionales de 60 y se exportan como TXT y CSV en la raiz del proyecto.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / "taqueria_ids.sqlite"
DEFAULT_TXT = PROJECT_ROOT / "taqueria_ids.txt"
DEFAULT_CSV = PROJECT_ROOT / "taqueria_ids.csv"

# Rectangulo heredado para consultas manuales con --region bbox.
DEFAULT_BBOX = (18.80, -100.20, 20.40, -98.40)
DEFAULT_BATCH_SIZE = 60
DEFAULT_GRID_STEP = 0.25
DEFAULT_QUERY_DELAY = 0.75
DEFAULT_REQUEST_TIMEOUT = 180
DEFAULT_ENDPOINT_RETRIES = 2
DEFAULT_BOUNDARIES = PROJECT_ROOT / "catalog" / "osm-boundaries.json"

AREA_REGIONS = {
    "cdmx": ("MX-CMX", "Ciudad de Mexico"),
    "edomex": ("MX-MEX", "Estado de Mexico"),
}

DEFAULT_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

# The boundary checks prevent names such as "Espartaco" from being treated as
# a taco business merely because they contain the letters "taco".
NAME_SIGNAL_PATTERN = (
    r"(^|[^A-Za-z])(tacos?|taquer[ií]a|birria|carnitas?|barbacoa|"
    r"suadero|pastor|canasta|cabeza|trompo|quesabirria|guisad[oa]s?)([^A-Za-z]|$)"
)
QUERY_SIGNAL_GROUPS = (
    r"tacos?|taquer[ií]a|birria|quesabirria",
    r"carnitas?|barbacoa|suadero|cabeza",
    r"pastor|canasta|trompo",
    r"guisad[oa]s?|antojitos?",
)
# OSM contributors commonly put the taco signal outside ``name`` and
# ``cuisine``. Keep this list deliberately limited to food-business tags so a
# street or unrelated place whose name happens to contain a signal is not
# imported as a candidate.
SIGNAL_TAG_PATTERN = (
    r"^(name|brand|official_name|alt_name|operator|description|dish|menu|product)$"
)
FOOD_AMENITY_PATTERN = r"^(restaurant|fast_food|food_court|street_vendor|cafe|marketplace)$"
FOOD_SHOP_PATTERN = r"^(food|convenience|supermarket|bakery)$"
CUISINE_SIGNAL_PATTERN = (
    r"(^|[;,])(tacos?|taquer[ií]a|birria|carnitas?|barbacoa|"
    r"suadero|pastor|canasta|cabeza|trompo|quesabirria|guisad[oa]s?)([;,]|$)"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Descubre IDs OSM de posibles taquerias y los guarda localmente."
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--region",
        choices=("cdmx-edomex", "cdmx", "edomex", "bbox"),
        default="cdmx-edomex",
        help="Cobertura administrativa; bbox usa los cuatro valores de --bbox.",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=0,
        help="Limita el total procesado; 0 procesa todos los resultados.",
    )
    parser.add_argument(
        "--max-queries",
        type=int,
        default=0,
        help="Limita las consultas territoriales para pruebas o reanudaciones; 0 procesa todas.",
    )
    parser.add_argument(
        "--query-offset",
        type=int,
        default=0,
        help="Omite consultas territoriales iniciales para continuar una corrida por etapas.",
    )
    parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        metavar=("SOUTH", "WEST", "NORTH", "EAST"),
        default=DEFAULT_BBOX,
    )
    parser.add_argument(
        "--grid-step",
        type=float,
        default=DEFAULT_GRID_STEP,
        help="Tamaño en grados para dividir CDMX y Edomex en consultas pequeñas.",
    )
    parser.add_argument(
        "--query-delay",
        type=float,
        default=DEFAULT_QUERY_DELAY,
        help="Pausa entre consultas territoriales para respetar Overpass.",
    )
    parser.add_argument(
        "--request-timeout",
        type=int,
        default=DEFAULT_REQUEST_TIMEOUT,
        help="Tiempo máximo de espera por endpoint de Overpass.",
    )
    parser.add_argument(
        "--endpoint-retries",
        type=int,
        default=DEFAULT_ENDPOINT_RETRIES,
        help="Reintentos por endpoint para respuestas 429/5xx o timeouts.",
    )
    parser.add_argument(
        "--strategy",
        choices=("admin", "grid"),
        default="admin",
        help="admin consulta cada estado por grupos de señales; grid divide en celdas para zonas puntuales.",
    )
    parser.add_argument("--boundaries", type=Path, default=DEFAULT_BOUNDARIES)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--txt", type=Path, default=DEFAULT_TXT)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalized(value: str | None) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    return "".join(
        character for character in value if not unicodedata.combining(character)
    ).casefold()


def selectors_for_pattern(area_filter: str, pattern: str) -> list[str]:
    return [
        f'nwr["cuisine"~"{pattern}",i]({area_filter});',
        f'nwr["amenity"~"{FOOD_AMENITY_PATTERN}"]'
        f'[~"{SIGNAL_TAG_PATTERN}"~"{pattern}",i]({area_filter});',
        f'nwr["shop"~"{FOOD_SHOP_PATTERN}"]'
        f'[~"{SIGNAL_TAG_PATTERN}"~"{pattern}",i]({area_filter});',
    ]


def selectors(area_filter: str) -> list[str]:
    result: list[str] = []
    for pattern in QUERY_SIGNAL_GROUPS:
        result.extend(selectors_for_pattern(area_filter, pattern))
    return result


def build_bbox_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    area = f"{south},{west},{north},{east}"
    query_selectors = selectors(area)
    return build_selector_query(query_selectors)


def build_selector_query(query_selectors: list[str]) -> str:
    return "\n".join(
        [
            "[out:json][timeout:60];",
            "(",
            *[f"  {selector}" for selector in query_selectors],
            ");",
            "out center tags;",
        ]
    )


def build_bbox_queries(bbox: tuple[float, float, float, float]) -> list[str]:
    south, west, north, east = bbox
    area = f"{south},{west},{north},{east}"
    query_selectors = selectors(area)
    # Overpass handles a couple of indexed selectors well, but a large union
    # of regex scans can time out even on a small urban bbox. Keep each request
    # resumable and bounded to two selector scans.
    return [
        build_selector_query(query_selectors[offset : offset + 2])
        for offset in range(0, len(query_selectors), 2)
    ]


def build_area_queries(iso_code: str) -> list[str]:
    queries = []
    for pattern in QUERY_SIGNAL_GROUPS:
        query_selectors = selectors_for_pattern("area.target", pattern)
        queries.append(
            "\n".join(
                [
                    "[out:json][timeout:120];",
                    f'area["ISO3166-2"="{iso_code}"]["boundary"="administrative"]->.target;',
                    "(",
                    *[f"  {selector}" for selector in query_selectors],
                    ");",
                    "out center tags;",
                ]
            )
        )
    return queries


def geometry_points(geometry: dict) -> list[tuple[float, float]]:
    if not isinstance(geometry, dict):
        return []
    if geometry.get("type") == "Feature":
        return geometry_points(geometry.get("geometry") or {})

    points: list[tuple[float, float]] = []

    def walk(value: object) -> None:
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            points.append((float(value[1]), float(value[0])))
            return
        if isinstance(value, list):
            for item in value:
                walk(item)

    walk(geometry.get("coordinates"))
    return points


def load_region_bboxes(path: Path) -> dict[str, tuple[float, float, float, float]]:
    fallback = {
        "cdmx": (19.05, -99.40, 19.60, -98.90),
        "edomex": (18.30, -100.50, 20.40, -98.50),
    }
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback

    result = dict(fallback)
    for item in document.get("boundaries", []):
        name = normalized(item.get("name"))
        region = "cdmx" if name == "ciudad de mexico" else "edomex" if name == "estado de mexico" else None
        points = geometry_points(item.get("geometry") or {})
        if not region or not points:
            continue
        latitudes = [point[0] for point in points]
        longitudes = [point[1] for point in points]
        result[region] = (
            min(latitudes) - 0.01,
            min(longitudes) - 0.01,
            max(latitudes) + 0.01,
            max(longitudes) + 0.01,
        )
    return result


def split_bbox(
    bbox: tuple[float, float, float, float],
    step: float,
) -> list[tuple[float, float, float, float]]:
    south, west, north, east = bbox
    tiles: list[tuple[float, float, float, float]] = []
    latitude = south
    while latitude < north:
        tile_north = min(latitude + step, north)
        longitude = west
        while longitude < east:
            tile_east = min(longitude + step, east)
            tiles.append((latitude, longitude, tile_north, tile_east))
            longitude = tile_east
        latitude = tile_north
    return tiles


def discovery_queries(
    region: str,
    bbox: tuple[float, float, float, float],
    grid_step: float,
    boundaries_path: Path,
    strategy: str,
) -> list[tuple[str, str, str]]:
    if region == "bbox":
        return [
            (f"bbox-query-{index:02d}", query, "unknown")
            for index, query in enumerate(build_bbox_queries(bbox), start=1)
        ]

    region_names = ("cdmx", "edomex") if region == "cdmx-edomex" else (region,)
    if strategy == "admin":
        queries: list[tuple[str, str, str]] = []
        for label in region_names:
            area_queries = build_area_queries(AREA_REGIONS[label][0])
            for index, query in enumerate(area_queries, start=1):
                queries.append(
                    (
                        f"{label}-admin-query-{index:02d}/{len(area_queries):02d}",
                        query,
                        label,
                    )
                )
        return queries

    queries: list[tuple[str, str, str]] = []
    for label in region_names:
        queries.extend(
            grid_queries_for_region(
                label,
                grid_step,
                boundaries_path,
            )
        )
    return queries


def grid_queries_for_region(
    label: str,
    grid_step: float,
    boundaries_path: Path,
) -> list[tuple[str, str, str]]:
    bboxes = load_region_bboxes(boundaries_path)
    tiles = split_bbox(bboxes[label], grid_step)
    queries: list[tuple[str, str, str]] = []
    for index, tile in enumerate(tiles, start=1):
        tile_queries = build_bbox_queries(tile)
        for selector_index, query in enumerate(tile_queries, start=1):
            queries.append(
                (
                    f"{label}-tile-{index:03d}/{len(tiles):03d}-query-{selector_index:02d}/{len(tile_queries):02d}",
                    query,
                    label,
                )
            )
    return queries


def fetch_overpass(
    query: str,
    timeout: int = DEFAULT_REQUEST_TIMEOUT,
    endpoint_retries: int = DEFAULT_ENDPOINT_RETRIES,
) -> list[dict]:
    configured = os.environ.get("OVERPASS_URL", "").strip()
    endpoints = (configured,) if configured else DEFAULT_ENDPOINTS
    user_agent = os.environ.get(
        "TACO_DISCOVERY_USER_AGENT",
        "TacosCatalog/1.0 (local catalog discovery)",
    )
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    errors: list[str] = []

    for attempt, endpoint in enumerate(endpoints, start=1):
        for retry in range(1, endpoint_retries + 1):
            request = urllib.request.Request(
                endpoint,
                data=payload,
                method="POST",
                headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                    "User-Agent": user_agent,
                },
            )
            try:
                print(
                    f"Consultando OpenStreetMap ({attempt}/{len(endpoints)}), "
                    f"intento {retry}/{endpoint_retries}: {endpoint}"
                )
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    document = json.loads(response.read().decode("utf-8"))
                return document.get("elements", [])
            except urllib.error.HTTPError as error:
                errors.append(f"{endpoint}: HTTP {error.code} ({error.reason})")
                retryable = error.code in {429, 500, 502, 503, 504}
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                errors.append(f"{endpoint}: {error}")
                retryable = True

            if retry < endpoint_retries and retryable:
                delay = min(30, 5 * (2 ** (retry - 1)))
                print(f"  Endpoint ocupado; reintento en {delay}s")
                time.sleep(delay)

        if attempt < len(endpoints):
            time.sleep(3)

    raise RuntimeError("No fue posible consultar Overpass. " + " | ".join(errors))


def coordinates(element: dict) -> tuple[float | None, float | None]:
    if element.get("type") == "node":
        return element.get("lat"), element.get("lon")
    center = element.get("center") or {}
    return center.get("lat"), center.get("lon")


def classify(tags: dict) -> tuple[str, str]:
    signal_values = [
        normalized(tags.get(key))
        for key in (
            "name",
            "brand",
            "official_name",
            "alt_name",
            "operator",
            "description",
            "dish",
            "menu",
            "product",
        )
    ]
    cuisine = normalized(tags.get("cuisine"))

    signal_re = re.compile(NAME_SIGNAL_PATTERN, re.IGNORECASE)
    cuisine_re = re.compile(CUISINE_SIGNAL_PATTERN, re.IGNORECASE)

    if any(signal_re.search(value) for value in signal_values[:5]):
        return "name_or_brand", "high"
    if any(signal_re.search(value) for value in signal_values[5:]):
        return "description_signal", "high"
    if cuisine_re.search(cuisine):
        return "cuisine_taco", "high"
    if tags.get("amenity") == "street_vendor":
        return "street_vendor", "candidate"
    return "cuisine_mexican", "candidate"


def prepare_rows(elements: list[dict], coverage: str = "unknown") -> list[dict]:
    rows: dict[str, dict] = {}
    seen_at = utc_now()

    for element in elements:
        osm_type = str(element.get("type") or "").strip()
        osm_id = element.get("id")
        if osm_type not in {"node", "way", "relation"} or not isinstance(osm_id, int):
            continue

        latitude, longitude = coordinates(element)
        if latitude is None or longitude is None:
            continue

        tags = element.get("tags") or {}
        match_reason, confidence = classify(tags)
        source_id = f"osm:{osm_type}:{osm_id}"
        rows[source_id] = {
            "source_id": source_id,
            "provider_id": f"{osm_type}/{osm_id}",
            "osm_type": osm_type,
            "osm_id": osm_id,
            "name": str(tags.get("name") or tags.get("brand") or "").strip(),
            "latitude": float(latitude),
            "longitude": float(longitude),
            "match_reason": match_reason,
            "confidence": confidence,
            "coverage": coverage,
            "source_url": f"https://www.openstreetmap.org/{osm_type}/{osm_id}",
            "first_seen_at": seen_at,
            "last_seen_at": seen_at,
        }

    return sorted(
        rows.values(),
        key=lambda row: (
            0 if row["confidence"] == "high" else 1,
            normalized(row["name"]),
            row["source_id"],
        ),
    )


def open_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS taqueria_source_ids (
            source_id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            osm_type TEXT NOT NULL,
            osm_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            match_reason TEXT NOT NULL,
            confidence TEXT NOT NULL,
            source_url TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        )
        """
    )
    existing_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(taqueria_source_ids)")
    }
    if "coverage" not in existing_columns:
        connection.execute("ALTER TABLE taqueria_source_ids ADD COLUMN coverage TEXT")
    connection.execute(
        "UPDATE taqueria_source_ids SET coverage = COALESCE(NULLIF(coverage, ''), 'unknown')"
    )
    if "discovery_status" not in existing_columns:
        connection.execute(
            "ALTER TABLE taqueria_source_ids ADD COLUMN discovery_status TEXT NOT NULL DEFAULT 'seen'"
        )
    connection.execute(
        "UPDATE taqueria_source_ids SET discovery_status = COALESCE(NULLIF(discovery_status, ''), 'seen')"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS discovery_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL,
            source_results INTEGER NOT NULL,
            unique_results INTEGER NOT NULL,
            new_results INTEGER NOT NULL,
            batch_size INTEGER NOT NULL
        )
        """
    )
    run_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(discovery_runs)")
    }
    if "coverage" not in run_columns:
        connection.execute("ALTER TABLE discovery_runs ADD COLUMN coverage TEXT")
    connection.commit()
    return connection


def save_in_batches(
    connection: sqlite3.Connection,
    rows: list[dict],
    batch_size: int,
) -> int:
    existing = {
        row[0]
        for row in connection.execute("SELECT source_id FROM taqueria_source_ids")
    }
    new_count = sum(row["source_id"] not in existing for row in rows)
    statement = """
        INSERT INTO taqueria_source_ids (
            source_id, source, provider_id, osm_type, osm_id, name,
            latitude, longitude, match_reason, confidence, coverage, source_url,
            first_seen_at, last_seen_at, discovery_status
        ) VALUES (?, 'openstreetmap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seen')
        ON CONFLICT(source_id) DO UPDATE SET
            provider_id = excluded.provider_id,
            name = excluded.name,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            match_reason = excluded.match_reason,
            confidence = excluded.confidence,
            coverage = CASE
                WHEN taqueria_source_ids.coverage IS NULL OR taqueria_source_ids.coverage = 'unknown'
                THEN excluded.coverage
                WHEN taqueria_source_ids.coverage = excluded.coverage
                THEN taqueria_source_ids.coverage
            ELSE 'cdmx-edomex'
            END,
            source_url = excluded.source_url,
            last_seen_at = excluded.last_seen_at,
            discovery_status = 'seen'
    """

    for offset in range(0, len(rows), batch_size):
        batch = rows[offset : offset + batch_size]
        connection.executemany(
            statement,
            [
                (
                    row["source_id"],
                    row["provider_id"],
                    row["osm_type"],
                    row["osm_id"],
                    row["name"],
                    row["latitude"],
                    row["longitude"],
                    row["match_reason"],
                    row["confidence"],
                    row.get("coverage", "unknown"),
                    row["source_url"],
                    row["first_seen_at"],
                    row["last_seen_at"],
                )
                for row in batch
            ],
        )
        connection.commit()
        batch_number = offset // batch_size + 1
        print(f"Lote {batch_number}: {len(batch)} IDs guardados o actualizados")

    return new_count


def reconcile_discovery(
    connection: sqlite3.Connection,
    region: str,
    seen_source_ids: set[str],
) -> int:
    """Mark records absent from a complete state discovery as not_seen.

    We keep the rows for history and possible reappearance, but exclude them
    from the next enrichment/export. Partial runs deliberately skip this
    reconciliation so an interrupted Overpass call cannot hide valid IDs.
    """
    if region == "cdmx":
        coverages = ("cdmx",)
    elif region == "edomex":
        coverages = ("edomex",)
    elif region == "cdmx-edomex":
        coverages = ("cdmx", "edomex", "cdmx-edomex")
    else:
        return 0

    coverage_placeholders = ",".join("?" for _ in coverages)
    if seen_source_ids:
        source_placeholders = ",".join("?" for _ in seen_source_ids)
        parameters = [*coverages, *sorted(seen_source_ids)]
        cursor = connection.execute(
            f"""
            UPDATE taqueria_source_ids
            SET discovery_status = 'not_seen'
            WHERE coverage IN ({coverage_placeholders})
              AND source_id NOT IN ({source_placeholders})
              AND discovery_status <> 'not_seen'
            """,
            parameters,
        )
    else:
        cursor = connection.execute(
            f"""
            UPDATE taqueria_source_ids
            SET discovery_status = 'not_seen'
            WHERE coverage IN ({coverage_placeholders})
              AND discovery_status <> 'not_seen'
            """,
            list(coverages),
        )
    connection.commit()
    return cursor.rowcount


def export_ids(connection: sqlite3.Connection, txt_path: Path, csv_path: Path) -> int:
    rows = connection.execute(
        """
        SELECT source_id, provider_id, name, latitude, longitude,
               confidence, match_reason, coverage, source_url, first_seen_at, last_seen_at
        FROM taqueria_source_ids
        WHERE COALESCE(discovery_status, 'seen') = 'seen'
        ORDER BY CASE confidence WHEN 'high' THEN 0 ELSE 1 END,
                 lower(name), source_id
        """
    ).fetchall()

    txt_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    txt_path.write_text(
        "".join(f"{row[0]}\n" for row in rows),
        encoding="utf-8",
    )

    with csv_path.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.writer(output)
        writer.writerow(
            [
                "source_id",
                "provider_id",
                "name",
                "latitude",
                "longitude",
                "confidence",
                "match_reason",
                "coverage",
                "source_url",
                "first_seen_at",
                "last_seen_at",
            ]
        )
        writer.writerows(rows)

    return len(rows)


def persist_partial_progress(
    rows_by_source: dict[str, dict],
    db_path: Path,
    txt_path: Path,
    csv_path: Path,
    batch_size: int,
) -> None:
    """Persist successful queries without reconciling the snapshot.

    A failed Overpass request must never mark old records as absent. We still
    keep the successful portion so a later run can resume/update it.
    """
    if not rows_by_source:
        return
    connection = open_database(db_path.resolve())
    try:
        save_in_batches(connection, list(rows_by_source.values()), batch_size)
        total_count = export_ids(connection, txt_path.resolve(), csv_path.resolve())
    finally:
        connection.close()
    print(
        f"Progreso parcial guardado: {len(rows_by_source)} IDs únicos "
        f"({total_count} IDs exportados), sin reconciliación."
    )


def main() -> int:
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("--batch-size debe ser mayor que cero")
    if args.max_records < 0:
        raise ValueError("--max-records no puede ser negativo")
    if args.max_queries < 0:
        raise ValueError("--max-queries no puede ser negativo")
    if args.query_offset < 0:
        raise ValueError("--query-offset no puede ser negativo")
    if args.grid_step <= 0:
        raise ValueError("--grid-step debe ser mayor que cero")
    if args.query_delay < 0:
        raise ValueError("--query-delay no puede ser negativo")
    if args.request_timeout < 1:
        raise ValueError("--request-timeout debe ser mayor que cero")
    if args.endpoint_retries < 1:
        raise ValueError("--endpoint-retries debe ser mayor que cero")

    started_at = utc_now()
    queries = discovery_queries(
        args.region,
        tuple(args.bbox),
        args.grid_step,
        args.boundaries.resolve(),
        args.strategy,
    )
    complete_discovery = args.max_queries == 0 and args.query_offset == 0
    if args.query_offset:
        queries = queries[args.query_offset :]
    if args.max_queries:
        queries = queries[: args.max_queries]
    print(f"Consultas territoriales iniciales: {len(queries)}")
    elements: list[dict] = []
    rows_by_source: dict[str, dict] = {}
    pending_queries = list(queries)
    fallback_regions: set[str] = set()
    query_number = 0
    while pending_queries:
        label, query, coverage = pending_queries.pop(0)
        query_number += 1
        print(f"Cobertura: {label}")
        try:
            region_elements = fetch_overpass(
                query,
                args.request_timeout,
                args.endpoint_retries,
            )
        except RuntimeError as error:
            is_admin_query = "-admin-query-" in label
            can_fallback = (
                args.strategy == "admin"
                and is_admin_query
                and coverage in AREA_REGIONS
                and coverage not in fallback_regions
            )
            if not can_fallback:
                persist_partial_progress(
                    rows_by_source,
                    args.db,
                    args.txt,
                    args.csv,
                    args.batch_size,
                )
                raise

            fallback_regions.add(coverage)
            pending_queries = [
                item for item in pending_queries if item[2] != coverage
            ]
            fallback_queries = grid_queries_for_region(
                coverage,
                args.grid_step,
                args.boundaries.resolve(),
            )
            pending_queries = fallback_queries + pending_queries
            print(
                f"  Consulta administrativa no disponible; "
                f"se divide {coverage} en {len(fallback_queries)} consultas pequeñas."
            )
            print(f"  Detalle del error: {error}")
            continue

        print(f"  Resultados recibidos: {len(region_elements)}")
        elements.extend(region_elements)
        for row in prepare_rows(region_elements, coverage):
            previous = rows_by_source.get(row["source_id"])
            if previous is None:
                rows_by_source[row["source_id"]] = row
            elif previous["coverage"] != row["coverage"]:
                previous["coverage"] = "cdmx-edomex"

        # Persist each successful territorial query. This makes Ctrl+C, a
        # transient 429, or a timeout resumable without losing the successful
        # portion held in memory. Partial runs deliberately do not reconcile
        # old rows as absent.
        persist_partial_progress(
            rows_by_source,
            args.db,
            args.txt,
            args.csv,
            args.batch_size,
        )
        if args.query_delay and pending_queries:
            time.sleep(args.query_delay)
    rows = sorted(
        rows_by_source.values(),
        key=lambda row: (
            0 if row["confidence"] == "high" else 1,
            normalized(row["name"]),
            row["source_id"],
        ),
    )
    if args.max_records:
        rows = rows[: args.max_records]

    connection = open_database(args.db.resolve())
    try:
        new_count = save_in_batches(connection, rows, args.batch_size)
        reconciled = 0
        if complete_discovery and not args.max_records and args.region != "bbox":
            reconciled = reconcile_discovery(
                connection,
                args.region,
                {row["source_id"] for row in rows},
            )
        total_count = export_ids(connection, args.txt.resolve(), args.csv.resolve())
        connection.execute(
            """
            INSERT INTO discovery_runs (
                started_at, finished_at, source_results, unique_results,
                new_results, batch_size, coverage
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                started_at,
                utc_now(),
                len(elements),
                len(rows),
                new_count,
                args.batch_size,
                args.region,
            ),
        )
        connection.commit()
    finally:
        connection.close()

    print()
    print(f"Resultados recibidos: {len(elements)}")
    print(f"IDs unicos procesados: {len(rows)}")
    print(f"IDs nuevos: {new_count}")
    print(f"IDs marcados como no vistos: {reconciled}")
    print(f"IDs acumulados: {total_count}")
    print(f"SQLite: {args.db.resolve()}")
    print(f"TXT: {args.txt.resolve()}")
    print(f"CSV: {args.csv.resolve()}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrumpido por el usuario", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
