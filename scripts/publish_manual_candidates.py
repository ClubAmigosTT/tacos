#!/usr/bin/env python3
"""Publish the small, high-confidence slice of the manual candidate feed.

The CSV exports are not published wholesale.  A row must already be classified
as a missing taco candidate, have a strong taco signal, and have a high-
confidence name+address geocode inside the target region.  Ratings, review
counts, photos, opening hours and Google identifiers are intentionally omitted:
the mobile catalog only receives the name, address and reusable coordinates.

Usage:
    python scripts/publish_manual_candidates.py
    python scripts/publish_manual_candidates.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from difflib import SequenceMatcher
from typing import Any


DEFAULT_INPUT = Path("catalog/reports/manual-candidates/manual-candidates-geocoded.json")
DEFAULT_CATALOG = Path("catalog/cdmx-edomex.json")
DEFAULT_REPORT_DIR = Path("catalog/reports/manual-candidates")

# Broad safety bounds for CDMX plus the metropolitan area of Estado de México.
MIN_LATITUDE = 18.8
MAX_LATITUDE = 20.5
MIN_LONGITUDE = -100.5
MAX_LONGITUDE = -98.5

TACO_SIGNAL_RE = re.compile(
    r"\b(?:taco|tacos|taqueria|birria|carnita|carnitas|barbacoa|suadero|"
    r"pastor|canasta|cabeza|trompo|quesabirria|guisado|guisados|antojito|"
    r"antojitos)\b",
    re.IGNORECASE,
)


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\x00", "").strip())


def normalized(value: Any) -> str:
    text = clean(value).lower().replace("&", " y ")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def in_target(latitude: float | None, longitude: float | None) -> bool:
    return (
        latitude is not None
        and longitude is not None
        and MIN_LATITUDE <= latitude <= MAX_LATITUDE
        and MIN_LONGITUDE <= longitude <= MAX_LONGITUDE
    )


def taco_signal(candidate: dict[str, Any]) -> bool:
    name = normalized(candidate.get("name"))
    category = normalized(candidate.get("category"))
    return bool(TACO_SIGNAL_RE.search(name) or re.search(r"\b(?:taco|tacos|taqueria|taquerias)\b", category))


def candidate_is_publishable(
    candidate: dict[str, Any],
    allow_address_only: bool = False,
) -> tuple[bool, str]:
    if candidate.get("status") != "missing_candidate":
        return False, "no es missing_candidate"
    if candidate.get("relevance") != "strong":
        return False, "señal de tacos no fuerte"
    geocode_status = candidate.get("geocode_status")
    if geocode_status != "geocoded":
        if not allow_address_only or geocode_status not in {
            "address_only_review",
            "address_low_confidence",
        }:
            return False, "coordenada no confirmada por nombre y dirección"
    if not taco_signal(candidate):
        return False, "nombre/categoría sin señal explícita de tacos"

    score = number(candidate.get("geocode_score")) or 0
    name_score = number(candidate.get("geocode_name_score")) or 0
    address_score = number(candidate.get("geocode_address_score")) or 0
    if geocode_status == "geocoded":
        if score < 0.78 or name_score < 0.70 or address_score < 0.45:
            return False, "puntuación de geocodificación insuficiente"
    elif score < 0.45 or address_score < 0.30:
        return False, "ubicación aproximada demasiado débil"

    latitude = number(candidate.get("latitude"))
    longitude = number(candidate.get("longitude"))
    if not in_target(latitude, longitude):
        return False, "coordenada fuera de CDMX/Edomex"
    if not clean(candidate.get("name")) or not clean(candidate.get("address")):
        return False, "falta nombre o dirección"
    if geocode_status == "geocoded":
        return True, "aprobado por señal y geocodificación alta"
    return True, "aprobado como ubicación aproximada aportada manualmente"


def distance_meters(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    # Equirectangular approximation is sufficient for a local duplicate check.
    lat_scale = 111_320.0
    lon_scale = 111_320.0 * math.cos(math.radians((lat_a + lat_b) / 2))
    return math.hypot((lat_a - lat_b) * lat_scale, (lon_a - lon_b) * lon_scale)


def compact_name(value: Any) -> str:
    ignored = {"taco", "tacos", "taqueria", "taquería", "restaurante", "restaurant"}
    return " ".join(token for token in normalized(value).split() if token not in ignored)


def matches_existing(candidate: dict[str, Any], branches: list[dict[str, Any]]) -> bool:
    candidate_name = compact_name(candidate.get("name"))
    candidate_address = normalized(candidate.get("address"))
    latitude = number(candidate.get("latitude"))
    longitude = number(candidate.get("longitude"))
    if not candidate_name or latitude is None or longitude is None:
        return False

    for branch in branches:
        names = [branch.get("name"), branch.get("taqueriaName")]
        branch_name = max((compact_name(name) for name in names if clean(name)), default="")
        if not branch_name:
            continue
        similarity = SequenceMatcher(None, candidate_name, branch_name).ratio()
        branch_address = normalized(branch.get("address"))
        if candidate_address and branch_address and candidate_address == branch_address:
            return True
        branch_coordinates = branch.get("coordinates") or {}
        branch_lat = number(branch_coordinates.get("latitude", branch.get("latitude")))
        branch_lon = number(branch_coordinates.get("longitude", branch.get("longitude")))
        if branch_lat is None or branch_lon is None:
            continue
        if similarity >= 0.82 and distance_meters(latitude, longitude, branch_lat, branch_lon) <= 250:
            return True
    return False


def style_for(candidate: dict[str, Any]) -> str:
    text = normalized(f"{candidate.get('name', '')} {candidate.get('category', '')}")
    for signal, style in (
        ("pastor", "Pastor"),
        ("suadero", "Suadero"),
        ("carnita", "Carnitas"),
        ("barbacoa", "Barbacoa"),
        ("birria", "Birria"),
    ):
        if signal in text:
            return style
    return "Clásico callejero"


def to_catalog_row(candidate: dict[str, Any], published_at: str, catalog_status: str = "active") -> dict[str, Any]:
    candidate_id = clean(candidate.get("candidate_id"))
    latitude = number(candidate.get("latitude"))
    longitude = number(candidate.get("longitude"))
    name = clean(candidate.get("name"))
    source_area = clean(candidate.get("source_area")) or "CDMX / Estado de México"
    location_precision = (
        "approximate_address"
        if candidate.get("geocode_status") != "geocoded"
        else "high_confidence"
    )
    tags = ["tacos", "manual-csv", "geocoded-osm", "pending-enrichment"]
    if catalog_status == "needs_review":
        tags.append("pending-review")
    return {
        "id": candidate_id,
        "taqueriaId": candidate_id,
        "taqueriaName": name,
        "name": name,
        "neighborhood": source_area,
        "latitude": latitude,
        "longitude": longitude,
        "distance": "cerca de ti",
        "openUntil": "23:00",
        "rating": 0,
        "reviewCount": 0,
        "style": style_for(candidate),
        "coordinates": {"latitude": latitude, "longitude": longitude},
        "locationPrecision": location_precision,
        "geocodeDisplayName": clean(candidate.get("geocode_display_name")),
        "geocodeMethod": clean(candidate.get("geocode_method")),
        "address": clean(candidate.get("address")),
        "hoursKnown": False,
        "source": {
            "name": "manual-csv",
            "license": "Datos aportados por el propietario del proyecto",
            "attribution": "Registro aportado manualmente; ubicación geocodificada con OpenStreetMap",
            "updatedAt": published_at,
        },
        "sourceName": "manual-csv",
        "sourceLicense": "Datos aportados por el propietario del proyecto",
        "sourceAttribution": "Registro aportado manualmente; ubicación geocodificada con OpenStreetMap",
        "sourceUpdatedAt": published_at,
        "image": "",
        "description": "",
        "tacos": [],
        "photos": [],
        "tags": tags,
        "catalogStatus": catalog_status,
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "candidate_id", "name", "address", "source_area", "category", "status",
        "relevance", "geocode_status", "geocode_score", "geocode_name_score",
        "geocode_address_score", "geocode_display_name", "publication_status",
        "publication_reason",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--allow-address-only",
        action="store_true",
        help=(
            "publica candidatos con nombre de tacos y coordenada de calle "
            "aproximada; se marcan como approximate_address"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.is_file():
        raise SystemExit(f"No existe el feed geocodificado: {args.input}")
    if not args.catalog.is_file():
        raise SystemExit(f"No existe el catálogo: {args.catalog}")

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not isinstance(candidates, list):
        raise SystemExit("El feed geocodificado no contiene candidates[]")

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    branches = catalog.get("branches") if isinstance(catalog, dict) else catalog
    if not isinstance(branches, list):
        raise SystemExit("El catálogo no contiene branches[]")

    report_rows: list[dict[str, Any]] = []
    approved: list[dict[str, Any]] = []
    published_at = datetime.now(timezone.utc).isoformat()
    existing_indexes = {
        clean(branch.get("id")): index
        for index, branch in enumerate(branches)
        if isinstance(branch, dict) and clean(branch.get("id"))
    }
    existing_ids = set(existing_indexes)

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        publishable, reason = candidate_is_publishable(
            candidate,
            allow_address_only=args.allow_address_only,
        )
        row = dict(candidate)
        row["publication_status"] = "eligible" if publishable else "held"
        row["publication_reason"] = reason
        if publishable:
            candidate_id = clean(candidate.get("candidate_id"))
            if not candidate_id:
                publishable = False
                row["publication_status"] = "held"
                row["publication_reason"] = "ID vacío"
            elif candidate_id in existing_ids:
                existing_branch = branches[existing_indexes[candidate_id]]
                existing_source = existing_branch.get("source") or {}
                if existing_source.get("name") == "manual-csv":
                    row["publication_status"] = "update"
                    row["publication_reason"] = "reparación idempotente del registro manual"
                    catalog_status = "active" if candidate.get("geocode_status") == "geocoded" else "needs_review"
                    approved.append(to_catalog_row(candidate, published_at, catalog_status))
                else:
                    publishable = False
                    row["publication_status"] = "held"
                    row["publication_reason"] = "ID ya publicado por otra fuente"
            elif matches_existing(candidate, branches):
                publishable = False
                row["publication_status"] = "held"
                row["publication_reason"] = "duplicado espacial/nombre con catálogo"
            else:
                catalog_status = "active" if candidate.get("geocode_status") == "geocoded" else "needs_review"
                catalog_row = to_catalog_row(candidate, published_at, catalog_status)
                approved.append(catalog_row)
                existing_ids.add(candidate_id)
        report_rows.append(row)

    new_rows = [
        row for row in approved
        if row["id"] not in existing_indexes
    ]
    updated_rows = [
        row for row in approved
        if row["id"] in existing_indexes
    ]

    if not args.dry_run and approved:
        branches.extend(new_rows)
        for row in updated_rows:
            branches[existing_indexes[row["id"]]] = row
        if isinstance(catalog, dict):
            stats = catalog.setdefault("stats", {})
            stats["branches"] = len(branches)
            stats["manualCandidatesAdded"] = stats.get("manualCandidatesAdded", 0) + len(new_rows)
            catalog["manualImport"] = {
                "source": str(args.input),
                "publishedAt": published_at,
                "added": len(new_rows),
                "updated": len(updated_rows),
            "policy": (
                "missing_candidate + strong taco signal + high-confidence "
                "name/address geocode"
                + ("; address-only approximate geocode explicitly allowed" if args.allow_address_only else "")
            ),
            }
        args.catalog.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    args.report_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "generatedAt": published_at,
        "input": str(args.input),
        "catalog": str(args.catalog),
        "dryRun": args.dry_run,
        "candidateRows": len(candidates),
        "eligibleRows": sum(row.get("publication_status") == "eligible" for row in report_rows),
        "publishedRows": 0 if args.dry_run else len(new_rows),
        "updatedRows": 0 if args.dry_run else len(updated_rows),
        "heldRows": sum(row.get("publication_status") == "held" for row in report_rows),
        "publishedIds": [row["id"] for row in new_rows],
        "updatedIds": [row["id"] for row in updated_rows],
        "policy": (
            "missing_candidate + strong taco signal + geocode_status=geocoded + no duplicate"
            + ("; address-only approximate geocode explicitly allowed" if args.allow_address_only else "")
        ),
    }
    (args.report_dir / "manual-candidates-publish-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.report_dir / "manual-candidates-published.json").write_text(json.dumps(approved, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(args.report_dir / "manual-candidates-publish-review.csv", report_rows)

    print("==========================================")
    print(" PUBLICACIÓN DE CANDIDATOS MANUALES")
    print("==========================================")
    print(f"Candidatos evaluados: {len(candidates)}")
    print(f"Elegibles por política: {summary['eligibleRows']}")
    print(f"Publicados: {summary['publishedRows']}")
    print(f"Actualizados: {summary['updatedRows']}")
    print(f"En revisión: {summary['heldRows']}")
    print(f"Salida: {args.catalog if not args.dry_run else 'dry-run'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
