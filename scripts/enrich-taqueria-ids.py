#!/usr/bin/env python3
"""Enriquece IDs OSM guardados por discover-taqueria-ids.py.

Consulta OpenStreetMap en lotes de hasta 60 IDs, guarda los detalles en la
misma base SQLite y exporta copias CSV y JSON en la raiz del proyecto. El
proceso es reanudable: por defecto omite los registros con estado OK.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / "taqueria_ids.sqlite"
DEFAULT_CSV = PROJECT_ROOT / "taquerias_enriquecidas.csv"
DEFAULT_JSON = PROJECT_ROOT / "taquerias_enriquecidas.json"
DEFAULT_BATCH_SIZE = 60
DEFAULT_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

DETAIL_COLUMNS = {
    "coverage": "TEXT",
    "address": "TEXT",
    "street": "TEXT",
    "house_number": "TEXT",
    "neighborhood": "TEXT",
    "city": "TEXT",
    "postcode": "TEXT",
    "opening_hours": "TEXT",
    "phone": "TEXT",
    "website": "TEXT",
    "cuisine": "TEXT",
    "amenity": "TEXT",
    "description": "TEXT",
    "details_status": "TEXT",
    "details_updated_at": "TEXT",
    "details_attempts": "INTEGER NOT NULL DEFAULT 0",
    "raw_tags_json": "TEXT",
}

EXPORT_COLUMNS = (
    "source_id",
    "provider_id",
    "name",
    "address",
    "street",
    "house_number",
    "neighborhood",
    "city",
    "postcode",
    "latitude",
    "longitude",
    "opening_hours",
    "phone",
    "website",
    "image_url",
    "cuisine",
    "amenity",
    "description",
    "confidence",
    "match_reason",
    "coverage",
    "details_status",
    "details_updated_at",
    "source_url",
    "first_seen_at",
    "last_seen_at",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Enriquece IDs OSM en lotes reanudables de 60."
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument(
        "--max-records",
        type=int,
        default=0,
        help="Limita los registros de esta ejecucion; 0 procesa todos.",
    )
    parser.add_argument(
        "--confidence",
        choices=("all", "high", "candidate"),
        default="all",
        help="Filtra por confianza; por defecto procesa todos.",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Vuelve a consultar tambien los registros que ya tienen estado OK.",
    )
    parser.add_argument("--request-delay", type=float, default=0.75)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON)
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_database(connection: sqlite3.Connection) -> None:
    table = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'taqueria_source_ids'"
    ).fetchone()
    if table is None:
        raise RuntimeError(
            "No existe taqueria_source_ids. Ejecuta primero pnpm catalog:discover:ids."
        )

    existing_columns = {
        row[1] for row in connection.execute("PRAGMA table_info(taqueria_source_ids)")
    }
    for column_name, column_type in DETAIL_COLUMNS.items():
        if column_name not in existing_columns:
            connection.execute(
                f"ALTER TABLE taqueria_source_ids ADD COLUMN {column_name} {column_type}"
            )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS enrichment_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL,
            selected_records INTEGER NOT NULL,
            successful_records INTEGER NOT NULL,
            not_found_records INTEGER NOT NULL,
            error_records INTEGER NOT NULL,
            requests_used INTEGER NOT NULL,
            batch_size INTEGER NOT NULL,
            confidence_filter TEXT NOT NULL
        )
        """
    )
    connection.commit()


def build_query(rows: list[sqlite3.Row]) -> str:
    ids_by_type: dict[str, list[str]] = {
        "node": [],
        "way": [],
        "relation": [],
    }
    for row in rows:
        ids_by_type[row["osm_type"]].append(str(row["osm_id"]))

    selectors = [
        f"{osm_type}(id:{','.join(osm_ids)});"
        for osm_type, osm_ids in ids_by_type.items()
        if osm_ids
    ]
    return "\n".join(
        [
            "[out:json][timeout:60];",
            "(",
            *[f"  {selector}" for selector in selectors],
            ");",
            "out center tags;",
        ]
    )


def fetch_overpass(query: str) -> list[dict]:
    configured = os.environ.get("OVERPASS_URL", "").strip()
    endpoints = (configured,) if configured else DEFAULT_ENDPOINTS
    user_agent = os.environ.get(
        "TACO_DISCOVERY_USER_AGENT",
        "TacosCatalog/1.0 (local catalog enrichment)",
    )
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    errors: list[str] = []

    for endpoint in endpoints:
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
            with urllib.request.urlopen(request, timeout=75) as response:
                document = json.loads(response.read().decode("utf-8"))
            return document.get("elements", [])
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
            errors.append(f"{endpoint}: {error}")
            time.sleep(2)

    raise RuntimeError("No fue posible consultar Overpass. " + " | ".join(errors))


def coordinates(element: dict) -> tuple[float | None, float | None]:
    if element.get("type") == "node":
        return element.get("lat"), element.get("lon")
    center = element.get("center") or {}
    return center.get("lat"), center.get("lon")


def first_tag(tags: dict, *names: str) -> str:
    for name in names:
        value = str(tags.get(name) or "").strip()
        if value:
            return value
    return ""


def image_url_from_raw_tags(raw_tags_json: str | None) -> str:
    """Return only an explicitly tagged HTTPS image; never invent a photo URL."""
    try:
        tags = json.loads(raw_tags_json or "{}")
    except (TypeError, json.JSONDecodeError):
        return ""
    if not isinstance(tags, dict):
        return ""
    for key in ("image", "image:url"):
        value = str(tags.get(key) or "").strip()
        if value.startswith("https://"):
            return value
    return ""


def build_address(tags: dict) -> dict[str, str]:
    full_address = first_tag(tags, "addr:full")
    street = first_tag(tags, "addr:street", "addr:place")
    house_number = first_tag(tags, "addr:housenumber")
    neighborhood = first_tag(
        tags,
        "addr:neighbourhood",
        "addr:suburb",
        "addr:quarter",
    )
    city = first_tag(tags, "addr:city", "addr:municipality", "addr:town")
    postcode = first_tag(tags, "addr:postcode")

    if not full_address:
        street_line = " ".join(value for value in (street, house_number) if value)
        full_address = ", ".join(
            value for value in (street_line, neighborhood, city, postcode) if value
        )

    return {
        "address": full_address,
        "street": street,
        "house_number": house_number,
        "neighborhood": neighborhood,
        "city": city,
        "postcode": postcode,
    }


def pending_rows(
    connection: sqlite3.Connection,
    batch_size: int,
    confidence: str,
    refresh: bool,
) -> list[sqlite3.Row]:
    conditions: list[str] = []
    parameters: list[object] = []
    if not refresh:
        conditions.append("COALESCE(details_status, '') NOT IN ('OK', 'NOT_FOUND')")
    if confidence != "all":
        conditions.append("confidence = ?")
        parameters.append(confidence)

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    parameters.append(batch_size)
    return connection.execute(
        f"""
        SELECT source_id, osm_type, osm_id
        FROM taqueria_source_ids
        {where_clause}
        ORDER BY CASE confidence WHEN 'high' THEN 0 ELSE 1 END,
                 first_seen_at, source_id
        LIMIT ?
        """,
        parameters,
    ).fetchall()


def save_batch(
    connection: sqlite3.Connection,
    requested_rows: list[sqlite3.Row],
    elements: list[dict],
) -> tuple[int, int]:
    now = utc_now()
    returned = {
        (element.get("type"), element.get("id")): element for element in elements
    }
    successful = 0
    not_found = 0

    for row in requested_rows:
        key = (row["osm_type"], row["osm_id"])
        element = returned.get(key)
        if element is None:
            connection.execute(
                """
                UPDATE taqueria_source_ids
                SET details_status = 'NOT_FOUND', details_updated_at = ?,
                    details_attempts = details_attempts + 1
                WHERE source_id = ?
                """,
                (now, row["source_id"]),
            )
            not_found += 1
            continue

        tags = element.get("tags") or {}
        address = build_address(tags)
        latitude, longitude = coordinates(element)
        name = first_tag(tags, "name", "brand")
        connection.execute(
            """
            UPDATE taqueria_source_ids
            SET name = CASE WHEN ? <> '' THEN ? ELSE name END,
                address = ?, street = ?, house_number = ?, neighborhood = ?,
                city = ?, postcode = ?,
                latitude = COALESCE(?, latitude),
                longitude = COALESCE(?, longitude),
                opening_hours = ?, phone = ?, website = ?, cuisine = ?,
                amenity = ?, description = ?, details_status = 'OK',
                details_updated_at = ?, details_attempts = details_attempts + 1,
                raw_tags_json = ?, last_seen_at = ?
            WHERE source_id = ?
            """,
            (
                name,
                name,
                address["address"],
                address["street"],
                address["house_number"],
                address["neighborhood"],
                address["city"],
                address["postcode"],
                latitude,
                longitude,
                first_tag(tags, "opening_hours"),
                first_tag(tags, "phone", "contact:phone", "mobile"),
                first_tag(tags, "website", "contact:website"),
                first_tag(tags, "cuisine"),
                first_tag(tags, "amenity"),
                first_tag(tags, "description"),
                now,
                json.dumps(tags, ensure_ascii=False, sort_keys=True),
                now,
                row["source_id"],
            ),
        )
        successful += 1

    connection.commit()
    return successful, not_found


def mark_batch_error(
    connection: sqlite3.Connection,
    rows: list[sqlite3.Row],
    error: Exception,
) -> None:
    now = utc_now()
    status = f"ERROR:{type(error).__name__}"[:80]
    connection.executemany(
        """
        UPDATE taqueria_source_ids
        SET details_status = ?, details_updated_at = ?,
            details_attempts = details_attempts + 1
        WHERE source_id = ?
        """,
        [(status, now, row["source_id"]) for row in rows],
    )
    connection.commit()


def enrich_with_fallback(
    connection: sqlite3.Connection,
    rows: list[sqlite3.Row],
    minimum_batch_size: int = 10,
) -> tuple[int, int, int, int]:
    """Enriquece un lote y lo divide si Overpass no soporta su tamaño.

    Devuelve exitosos, no encontrados, errores y solicitudes lógicas.
    """
    try:
        elements = fetch_overpass(build_query(rows))
        successful, not_found = save_batch(connection, rows, elements)
        return successful, not_found, 0, 1
    except Exception as error:
        if len(rows) > minimum_batch_size:
            midpoint = len(rows) // 2
            left = rows[:midpoint]
            right = rows[midpoint:]
            print(
                f"  El lote de {len(rows)} falló; reintentando como "
                f"{len(left)} + {len(right)}"
            )
            totals = [0, 0, 0, 1]
            for smaller_batch in (left, right):
                successful, not_found, errors, requests_used = enrich_with_fallback(
                    connection,
                    smaller_batch,
                    minimum_batch_size,
                )
                totals[0] += successful
                totals[1] += not_found
                totals[2] += errors
                totals[3] += requests_used
                if errors:
                    break
            return tuple(totals)

        mark_batch_error(connection, rows, error)
        print(f"  ERROR definitivo: {error}", file=sys.stderr)
        return 0, 0, len(rows), 1


def export_details(
    connection: sqlite3.Connection,
    csv_path: Path,
    json_path: Path,
) -> int:
    select_columns = tuple(column for column in EXPORT_COLUMNS if column != "image_url") + ("raw_tags_json",)
    query = f"""
        SELECT {', '.join(select_columns)}
        FROM taqueria_source_ids
        ORDER BY CASE confidence WHEN 'high' THEN 0 ELSE 1 END,
                 lower(name), source_id
    """
    rows = connection.execute(query).fetchall()
    export_rows = []
    for row in rows:
        item = {column: row[column] for column in EXPORT_COLUMNS if column != "image_url"}
        item["image_url"] = image_url_from_raw_tags(row["raw_tags_json"])
        export_rows.append(item)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)

    with csv_path.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.writer(output)
        writer.writerow(EXPORT_COLUMNS)
        writer.writerows(tuple(item[column] for column in EXPORT_COLUMNS) for item in export_rows)

    payload = {
        "source": "OpenStreetMap",
        "sourceUrl": "https://www.openstreetmap.org",
        "license": "ODbL 1.0",
        "attribution": "© OpenStreetMap contributors",
        "exportedAt": utc_now(),
        "places": export_rows,
    }
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(rows)


def main() -> int:
    args = parse_args()
    if not 1 <= args.batch_size <= 60:
        raise ValueError("--batch-size debe estar entre 1 y 60")
    if args.max_records < 0:
        raise ValueError("--max-records no puede ser negativo")
    if args.request_delay < 0:
        raise ValueError("--request-delay no puede ser negativo")

    db_path = args.db.resolve()
    if not db_path.exists():
        raise RuntimeError(
            f"No existe {db_path}. Ejecuta primero pnpm catalog:discover:ids."
        )

    started_at = utc_now()
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    ensure_database(connection)

    selected_total = 0
    successful_total = 0
    not_found_total = 0
    error_total = 0
    requests_used = 0

    try:
        batch_number = 0
        while args.max_records == 0 or selected_total < args.max_records:
            remaining = (
                args.batch_size
                if args.max_records == 0
                else min(args.batch_size, args.max_records - selected_total)
            )
            rows = pending_rows(
                connection,
                remaining,
                args.confidence,
                args.refresh,
            )
            if not rows:
                break

            batch_number += 1
            print(f"Lote {batch_number}: consultando {len(rows)} IDs")
            successful, not_found, errors, batch_requests = enrich_with_fallback(
                connection,
                rows,
            )
            selected_total += successful + not_found + errors
            successful_total += successful
            not_found_total += not_found
            error_total += errors
            requests_used += batch_requests
            print(
                f"  OK: {successful} | No encontrados: {not_found} | "
                f"Errores: {errors}"
            )
            if errors:
                break

            if args.request_delay:
                time.sleep(args.request_delay)

        exported = export_details(
            connection,
            args.csv.resolve(),
            args.json.resolve(),
        )
        connection.execute(
            """
            INSERT INTO enrichment_runs (
                started_at, finished_at, selected_records, successful_records,
                not_found_records, error_records, requests_used, batch_size,
                confidence_filter
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                started_at,
                utc_now(),
                selected_total,
                successful_total,
                not_found_total,
                error_total,
                requests_used,
                args.batch_size,
                args.confidence,
            ),
        )
        connection.commit()
    finally:
        connection.close()

    print()
    print(f"Registros seleccionados: {selected_total}")
    print(f"Enriquecidos: {successful_total}")
    print(f"No encontrados: {not_found_total}")
    print(f"Errores: {error_total}")
    print(f"Requests utilizadas: {requests_used}")
    print(f"Registros exportados: {exported}")
    print(f"CSV: {args.csv.resolve()}")
    print(f"JSON: {args.json.resolve()}")
    return 0 if error_total == 0 else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrumpido por el usuario", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
