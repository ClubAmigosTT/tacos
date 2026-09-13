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

AREA_REGIONS = {
    "cdmx": ("MX-CMX", "Ciudad de Mexico"),
    "edomex": ("MX-MEX", "Estado de Mexico"),
}

DEFAULT_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
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
        "--bbox",
        nargs=4,
        type=float,
        metavar=("SOUTH", "WEST", "NORTH", "EAST"),
        default=DEFAULT_BBOX,
    )
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


def selectors(area_filter: str) -> list[str]:
    return [
        f'nwr["amenity"~"^(restaurant|fast_food|food_court)$"]'
        f'["cuisine"~"taco|mexican",i]({area_filter});',
        f'nwr["name"~"taquer[ií]a|tacos?",i]({area_filter});',
        f'nwr["brand"~"taquer[ií]a|tacos?",i]({area_filter});',
    ]


def build_bbox_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    area = f"{south},{west},{north},{east}"
    query_selectors = selectors(area)
    return "\n".join(
        [
            "[out:json][timeout:240];",
            "(",
            *[f"  {selector}" for selector in query_selectors],
            ");",
            "out center tags;",
        ]
    )


def build_area_query(iso_code: str) -> str:
    query_selectors = selectors("area.target")
    return "\n".join(
        [
            "[out:json][timeout:240];",
            f'area["ISO3166-2"="{iso_code}"]["boundary"="administrative"]->.target;',
            "(",
            *[f"  {selector}" for selector in query_selectors],
            ");",
            "out center tags;",
        ]
    )


def discovery_queries(
    region: str,
    bbox: tuple[float, float, float, float],
) -> list[tuple[str, str]]:
    if region == "bbox":
        return [("bbox", build_bbox_query(bbox))]
    region_names = ("cdmx", "edomex") if region == "cdmx-edomex" else (region,)
    return [
        (label, build_area_query(AREA_REGIONS[label][0])) for label in region_names
    ]


def fetch_overpass(query: str) -> list[dict]:
    configured = os.environ.get("OVERPASS_URL", "").strip()
    endpoints = (configured,) if configured else DEFAULT_ENDPOINTS
    user_agent = os.environ.get(
        "TACO_DISCOVERY_USER_AGENT",
        "TacosCatalog/1.0 (local catalog discovery)",
    )
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    errors: list[str] = []

    for attempt, endpoint in enumerate(endpoints, start=1):
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
            print(f"Consultando OpenStreetMap ({attempt}/{len(endpoints)}): {endpoint}")
            with urllib.request.urlopen(request, timeout=300) as response:
                document = json.loads(response.read().decode("utf-8"))
            return document.get("elements", [])
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
            errors.append(f"{endpoint}: {error}")
            if attempt < len(endpoints):
                time.sleep(3)

    raise RuntimeError("No fue posible consultar Overpass. " + " | ".join(errors))


def coordinates(element: dict) -> tuple[float | None, float | None]:
    if element.get("type") == "node":
        return element.get("lat"), element.get("lon")
    center = element.get("center") or {}
    return center.get("lat"), center.get("lon")


def classify(tags: dict) -> tuple[str, str]:
    name = normalized(tags.get("name"))
    brand = normalized(tags.get("brand"))
    cuisine = normalized(tags.get("cuisine"))

    if any(term in name or term in brand for term in ("taco", "taqueria")):
        return "name_or_brand", "high"
    if "taco" in cuisine:
        return "cuisine_taco", "high"
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
            first_seen_at, last_seen_at
        ) VALUES (?, 'openstreetmap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            last_seen_at = excluded.last_seen_at
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


def export_ids(connection: sqlite3.Connection, txt_path: Path, csv_path: Path) -> int:
    rows = connection.execute(
        """
        SELECT source_id, provider_id, name, latitude, longitude,
               confidence, match_reason, coverage, source_url, first_seen_at, last_seen_at
        FROM taqueria_source_ids
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


def main() -> int:
    args = parse_args()
    if args.batch_size < 1:
        raise ValueError("--batch-size debe ser mayor que cero")
    if args.max_records < 0:
        raise ValueError("--max-records no puede ser negativo")

    started_at = utc_now()
    queries = discovery_queries(args.region, tuple(args.bbox))
    elements: list[dict] = []
    rows_by_source: dict[str, dict] = {}
    for label, query in queries:
        print(f"Cobertura: {label}")
        region_elements = fetch_overpass(query)
        print(f"  Resultados recibidos: {len(region_elements)}")
        elements.extend(region_elements)
        for row in prepare_rows(region_elements, label):
            previous = rows_by_source.get(row["source_id"])
            if previous is None:
                rows_by_source[row["source_id"]] = row
            elif previous["coverage"] != row["coverage"]:
                previous["coverage"] = "cdmx-edomex"
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
