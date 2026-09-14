#!/usr/bin/env python3
"""Build a taco catalog from the official DENUE bulk files.

The input is deliberately local.  The DENUE bulk downloader is run outside the
application, the raw ZIPs stay out of git, and this command produces the
auditable catalog feed that the API consumes. A combined export can be
generated for audits, migrations, and the active offline snapshot bundled by
the mobile app.

By default this selects SCIAN 722514 (restaurants with taco and torta
preparation) for CDMX (09) and Estado de México (15), plus named taco places
that DENUE classified under another 7225 restaurant activity.  With
--include-osm it also adds only the high-confidence OSM records that are not
already represented by DENUE.  This avoids publishing every OSM record tagged
merely as Mexican food while preserving OSM coverage for places that DENUE does
not list.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


TARGET_ACTIVITY = "722514"
RESTAURANT_ACTIVITY_PREFIX = "7225"
STATE_NAMES = {"09": "Ciudad de México", "15": "Estado de México"}
SOURCE_URL = "https://www.inegi.org.mx/app/mapa/denue/"
DOWNLOAD_URL = "https://www.inegi.org.mx/app/descarga/?t=11"
INEGI_LICENSE = "Términos de Libre Uso de la Información del INEGI"
OSM_URL = "https://www.openstreetmap.org"
OSM_LICENSE = "ODbL 1.0"
OSM_ATTRIBUTION = "© OpenStreetMap contributors"
ACTIVITY_LABEL = "Restaurantes con servicio de preparación de tacos y tortas"
NAME_SIGNAL_RE = re.compile(
    r"\b(?:tacos?|taquer[ií]a|barbacoa|carnitas?|pastor|birria|suadero|canasta)\b",
    re.IGNORECASE,
)
STYLE_PATTERNS = (
    ("Pastor", re.compile(r"\bpastor\b", re.IGNORECASE)),
    ("Birria", re.compile(r"\bbirria\b", re.IGNORECASE)),
    ("Carnitas", re.compile(r"\bcarnitas?\b", re.IGNORECASE)),
    ("Barbacoa", re.compile(r"\bbarbacoa\b", re.IGNORECASE)),
    ("Suadero", re.compile(r"\bsuadero\b", re.IGNORECASE)),
)
GENERIC_NAME_TOKENS = {
    "a", "al", "antojito", "antojitos", "bar", "carne", "comida",
    "con", "cocina", "de", "del", "el", "en", "fonda", "la", "las",
    "los", "mexicana", "mexicano", "mexicanos", "nombre", "pizzeria",
    "puesto", "restaurante", "restaurantes", "sin", "taco", "tacos",
    "taqueria", "tortas", "y",
}


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\ufeff", "").replace("\x00", "").strip()
    return re.sub(r"\s+", " ", text)


def normalized(value: Any) -> str:
    text = clean(value).lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(char for char in text if unicodedata.category(char) != "Mn")


def slug(value: Any) -> str:
    text = normalized(value)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:64]


def parse_coordinate(value: Any) -> float | None:
    try:
        result = float(clean(value))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(result):
        return None
    return result


def first_nonempty(*values: Any) -> str:
    for value in values:
        text = clean(value)
        if text:
            return text
    return ""


def unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = clean(value).lower()
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def style_for_name(name: str) -> str:
    for style, pattern in STYLE_PATTERNS:
        if pattern.search(name):
            return style
    return "Clásico callejero"


def has_name_signal(name: str) -> bool:
    return bool(NAME_SIGNAL_RE.search(name))


def business_type(name: str, primary_activity: bool) -> str:
    if has_name_signal(name):
        if re.search(r"\bcanasta\b", normalized(name)):
            return "tacos_de_canasta"
        return "taqueria"
    return "restaurant_with_tacos" if primary_activity else "candidate"


def build_address(row: dict[str, str]) -> str:
    vial_type = clean(row.get("tipo_vial"))
    vial_name = clean(row.get("nom_vial"))
    street = " ".join(part for part in (vial_type, vial_name) if part and "OTRO" not in part.upper())
    number = " ".join(
        part for part in (
            clean(row.get("numero_ext")),
            clean(row.get("letra_ext")),
        ) if part
    )
    interior = " ".join(
        part for part in (
            clean(row.get("numero_int")),
            clean(row.get("letra_int")),
        ) if part
    )
    asentamiento = " ".join(
        part for part in (
            clean(row.get("tipo_asent")),
            clean(row.get("nomb_asent")),
        ) if part
    )
    parts = [part for part in (
        " ".join(part for part in (street, number) if part),
        f"Interior {interior}" if interior else "",
        asentamiento,
        clean(row.get("municipio")),
        clean(row.get("entidad")),
        f"C.P. {clean(row.get('cod_postal'))}" if clean(row.get("cod_postal")) else "",
    ) if part]
    return ", ".join(unique(parts))


def source_updated_at(release: str) -> str:
    year = int(release[:4])
    month = int(release[4:6]) if len(release) >= 6 and release[4:6].isdigit() else 1
    return datetime(year, max(1, month), 1, tzinfo=timezone.utc).isoformat()


def data_csv_name(archive: zipfile.ZipFile) -> str:
    candidates = [
        name for name in archive.namelist()
        if "conjunto_de_datos" in name.lower() and name.lower().endswith(".csv")
    ]
    if not candidates:
        raise ValueError("El ZIP no contiene un CSV de conjunto_de_datos")
    return candidates[0]


def iter_denue_rows(input_dir: Path) -> Iterable[dict[str, str]]:
    archives = sorted(input_dir.glob("*.zip"))
    if not archives:
        raise FileNotFoundError(f"No hay ZIPs DENUE en {input_dir}")
    for archive_path in archives:
        with zipfile.ZipFile(archive_path) as archive:
            csv_name = data_csv_name(archive)
            with archive.open(csv_name) as raw:
                # The current bulk files use a Latin family encoding.  cp1252
                # preserves the Spanish characters while allowing a malformed
                # source byte to be counted and reported instead of aborting a
                # complete regional build.
                stream = io.TextIOWrapper(raw, encoding="cp1252", errors="replace", newline="")
                reader = csv.DictReader(stream)
                if not reader.fieldnames:
                    raise ValueError(f"CSV sin encabezado: {archive_path}")
                for row in reader:
                    yield {clean(key): clean(value) for key, value in row.items() if key is not None}


def denue_branch(row: dict[str, str], release: str) -> dict[str, Any] | None:
    entity_code = clean(row.get("cve_ent")).zfill(2)
    activity_code = clean(row.get("codigo_act"))
    if entity_code not in STATE_NAMES:
        return None

    name = clean(row.get("nom_estab"))
    latitude = parse_coordinate(row.get("latitud"))
    longitude = parse_coordinate(row.get("longitud"))
    if not name or latitude is None or longitude is None:
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None

    primary_activity = activity_code == TARGET_ACTIVITY
    named_restaurant_candidate = activity_code.startswith(RESTAURANT_ACTIVITY_PREFIX) and has_name_signal(name)
    if not primary_activity and not named_restaurant_candidate:
        return None

    coverage = "cdmx" if entity_code == "09" else "edomex"
    name_signal = has_name_signal(name)
    confidence = "high" if name_signal else "medium"
    place_type = business_type(name, primary_activity)
    tags = [
        "tacos",
        "denue",
        f"scian-{activity_code}",
        coverage,
        f"confidence-{confidence}",
        "taco-core" if name_signal else "taco-candidate",
    ]
    if primary_activity:
        tags.append("actividad-principal-tacos-y-tortas")
    else:
        tags.append("candidato-por-nombre")
    if name_signal:
        tags.append("nombre-con-señal-de-tacos")
    if re.search(r"\btortas?\b", normalized(name)):
        tags.append("tortas")
    style = style_for_name(name)
    if style != "Clásico callejero":
        tags.append(normalized(style))

    neighborhood = first_nonempty(row.get("nomb_asent"), row.get("municipio"), STATE_NAMES[entity_code])
    branch: dict[str, Any] = {
        "id": f"denue-{clean(row.get('id'))}",
        "taqueriaId": f"denue-{clean(row.get('id'))}",
        "taqueriaName": name,
        "name": name,
        "neighborhood": neighborhood,
        "municipality": clean(row.get("municipio")) or STATE_NAMES[entity_code],
        "state": STATE_NAMES[entity_code],
        "activityCode": activity_code,
        "businessType": place_type,
        "confidence": confidence,
        "matchReason": "name_signal" if name_signal else "primary_activity",
        "latitude": latitude,
        "longitude": longitude,
        "address": build_address(row),
        "openUntil": "23:00",
        "style": style,
        "description": clean(row.get("nombre_act")) or ACTIVITY_LABEL,
        "tags": unique(tags),
        "rating": 0,
        "sourceName": "denue-cdmx-edomex",
        "sourcePlaceId": clean(row.get("id")),
        "sourceUrl": SOURCE_URL,
        "sourceLicense": INEGI_LICENSE,
        "sourceAttribution": f"Fuente: INEGI, DENUE, edición {release[:4]}-{release[4:6]}",
        "sourceUpdatedAt": source_updated_at(release),
        "catalogQuality": "catalog",
        "catalogStatus": "active" if name_signal else "needs_review",
        "tacos": [],
        "photos": [],
    }
    phone = clean(row.get("telefono"))
    if phone:
        branch["phone"] = phone
    return branch


def dedupe_key(branch: dict[str, Any]) -> str:
    return f"{slug(branch['name'])}:{float(branch['latitude']):.4f}:{float(branch['longitude']):.4f}"


def richness(branch: dict[str, Any]) -> int:
    return sum(bool(clean(branch.get(key))) for key in ("address", "phone", "description"))


def dedupe_branches(branches: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    positions: dict[str, int] = {}
    result: list[dict[str, Any]] = []
    removed = 0
    for branch in branches:
        key = dedupe_key(branch)
        existing_position = positions.get(key)
        if existing_position is None:
            positions[key] = len(result)
            result.append(branch)
            continue
        removed += 1
        if richness(branch) > richness(result[existing_position]):
            result[existing_position] = branch
    return result, removed


def distance_km(left: dict[str, Any], right: dict[str, Any]) -> float:
    lat1 = math.radians(float(left["latitude"]))
    lat2 = math.radians(float(right["latitude"]))
    dlat = lat2 - lat1
    dlon = math.radians(float(right["longitude"]) - float(left["longitude"]))
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, value)))


def meaningful_tokens(name: str) -> set[str]:
    return {
        token for token in normalized(name).split()
        if len(token) >= 4 and token not in GENERIC_NAME_TOKENS
    }


def same_place(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if distance_km(left, right) > 0.18:
        return False
    left_name = normalized(left["name"]).replace(" ", "")
    right_name = normalized(right["name"]).replace(" ", "")
    if left_name == right_name:
        return True
    shorter, longer = sorted((left_name, right_name), key=len)
    if len(shorter) >= 8 and shorter in longer:
        return True
    overlap = meaningful_tokens(left["name"]) & meaningful_tokens(right["name"])
    return len(overlap) >= 2


def load_osm(path: Path, enriched_path: Path, include_candidates: bool = False) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows = raw if isinstance(raw, list) else raw.get("branches", [])
    high_ids: set[str] = set()
    if enriched_path.exists():
        enriched = json.loads(enriched_path.read_text(encoding="utf-8"))
        enriched_rows = enriched if isinstance(enriched, list) else enriched.get("places", [])
        high_ids = {
            clean(item.get("provider_id") or item.get("source_id"))
            for item in enriched_rows
            if clean(item.get("confidence")) == "high"
        }
        high_ids.discard("")

    result = []
    for row in rows:
        source_id = clean(row.get("sourcePlaceId"))
        if include_candidates:
            result.append(row)
            continue
        if high_ids and source_id not in high_ids:
            continue
        if not high_ids and not has_name_signal(clean(row.get("name"))):
            continue
        if not clean(row.get("name")):
            continue
        result.append(row)
    return result


def add_unmatched_osm(denue: list[dict[str, Any]], osm: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    buckets: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for branch in denue:
        buckets[(round(float(branch["latitude"]) * 100), round(float(branch["longitude"]) * 100))].append(branch)

    unmatched: list[dict[str, Any]] = []
    matched = 0
    for branch in osm:
        coordinates = branch.get("coordinates") or {
            "latitude": branch.get("latitude"),
            "longitude": branch.get("longitude"),
        }
        lat_bucket = round(float(coordinates["latitude"]) * 100)
        lon_bucket = round(float(coordinates["longitude"]) * 100)
        nearby: list[dict[str, Any]] = []
        for lat_delta in (-1, 0, 1):
            for lon_delta in (-1, 0, 1):
                nearby.extend(buckets.get((lat_bucket + lat_delta, lon_bucket + lon_delta), []))
        candidate = {
            "name": clean(branch.get("name")),
            "latitude": float(coordinates["latitude"]),
            "longitude": float(coordinates["longitude"]),
        }
        if any(same_place(candidate, existing) for existing in nearby):
            matched += 1
        else:
            unmatched.append(branch)
    return unmatched, matched


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("data/denue/latest"))
    parser.add_argument("--output", type=Path, default=Path("catalog/denue-cdmx-edomex.json"))
    parser.add_argument("--release", default="", help="Edición DENUE en formato YYYYMM; por defecto usa release.txt del input")
    parser.add_argument("--include-osm", action="store_true", help="Añadir OSM de alta confianza sin duplicar DENUE")
    parser.add_argument("--include-osm-candidates", action="store_true", help="Conservar también OSM candidatos o sin nombre como needs_review")
    parser.add_argument("--osm-file", type=Path, default=Path("catalog/osm-cdmx-edomex.json"))
    parser.add_argument("--osm-enriched-file", type=Path, default=Path("taquerias_enriquecidas.json"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not list(args.input_dir.glob("*.zip")):
        legacy_input = Path("data/denue/202605")
        if args.input_dir == Path("data/denue/latest") and list(legacy_input.glob("*.zip")):
            print(f"No hay ZIPs en {args.input_dir}; usando el snapshot existente {legacy_input}")
            args.input_dir = legacy_input
    if not args.release:
        release_file = args.input_dir / "release.txt"
        if release_file.exists():
            args.release = release_file.read_text(encoding="ascii").strip()
        else:
            args.release = "202605"
    if not re.fullmatch(r"\d{6}", args.release):
        raise SystemExit("--release debe tener formato YYYYMM")

    total_rows = 0
    skipped_no_name = 0
    skipped_no_coordinate = 0
    candidates: list[dict[str, Any]] = []
    for row in iter_denue_rows(args.input_dir):
        total_rows += 1
        if clean(row.get("cve_ent")).zfill(2) not in STATE_NAMES:
            continue
        activity_code = clean(row.get("codigo_act"))
        name = clean(row.get("nom_estab"))
        if activity_code != TARGET_ACTIVITY and not (
            activity_code.startswith(RESTAURANT_ACTIVITY_PREFIX) and has_name_signal(name)
        ):
            continue
        branch = denue_branch(row, args.release)
        if branch is None:
            if not name:
                skipped_no_name += 1
            else:
                skipped_no_coordinate += 1
            continue
        candidates.append(branch)

    denue_branches, duplicate_rows = dedupe_branches(candidates)
    osm_rows: list[dict[str, Any]] = []
    matched_osm = 0
    if args.include_osm:
        osm_rows = load_osm(args.osm_file, args.osm_enriched_file, args.include_osm_candidates)
        osm_rows, matched_osm = add_unmatched_osm(denue_branches, osm_rows)

    branches, combined_duplicate_rows = dedupe_branches(denue_branches + osm_rows)
    branches.sort(key=lambda row: (normalized(row.get("name")), row.get("id", "")))

    counts_by_coverage = Counter(
        "cdmx" if row.get("sourceName") == "denue-cdmx-edomex" and "cdmx" in row.get("tags", []) else
        "edomex" if row.get("sourceName") == "denue-cdmx-edomex" else "osm"
        for row in denue_branches
    )
    name_signal_count = sum(has_name_signal(row["name"]) for row in denue_branches)
    metadata = {
        "source": "INEGI DENUE 202605" + (" + OpenStreetMap" if args.include_osm else ""),
        "sourceUrl": DOWNLOAD_URL,
        "license": INEGI_LICENSE + (f"; {OSM_LICENSE}" if args.include_osm else ""),
        "attribution": "Fuente: INEGI, DENUE, edición mayo de 2026" + (f"; {OSM_ATTRIBUTION}" if args.include_osm else ""),
        # Keep the feed deterministic for the same DENUE edition. This lets
        # the scheduled refresh skip the commit when INEGI has not published
        # a new snapshot yet.
        "exportedAt": source_updated_at(args.release),
        "coverage": ["Ciudad de México", "Estado de México"],
        "selection": "SCIAN 722514 y nombres con señal explícita de tacos dentro de actividades 7225; registros con nombre y coordenadas válidas" + ("; OSM high sin duplicados" if args.include_osm and not args.include_osm_candidates else "; OSM high y candidates sin duplicados, candidates=needs_review" if args.include_osm else ""),
        "stats": {
            "rawRowsRead": total_rows,
            "denueCandidates": len(candidates),
            "denuePrimaryActivity": sum("actividad-principal-tacos-y-tortas" in row.get("tags", []) for row in candidates),
            "denueNamedRestaurantCandidates": sum("candidato-por-nombre" in row.get("tags", []) for row in candidates),
            "denueBranches": len(denue_branches),
            "denueDuplicatesRemoved": duplicate_rows,
            "denueNameSignal": name_signal_count,
            "denueSkippedNoName": skipped_no_name,
            "denueSkippedNoCoordinate": skipped_no_coordinate,
            "denueByCoverage": dict(counts_by_coverage),
            "osmHighInput": len(load_osm(args.osm_file, args.osm_enriched_file)) if args.include_osm else 0,
            "osmCandidateInput": len(load_osm(args.osm_file, args.osm_enriched_file, True)) if args.include_osm and args.include_osm_candidates else 0,
            "osmMatchedToDenue": matched_osm,
            "osmAdded": len(osm_rows),
            "combinedDuplicatesRemoved": combined_duplicate_rows,
            "branches": len(branches),
        },
        "branches": branches,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), **metadata["stats"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
