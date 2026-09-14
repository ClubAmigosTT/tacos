#!/usr/bin/env python3
"""Audit the regional taco catalog before a source refresh.

The audit is intentionally read-only.  It reports coverage by state and
municipality/alcaldia, source mix, confidence signals, missing fields and
nearby duplicate candidates.  It accepts the generated catalog shape used by
the import pipeline: either a list of branches or ``{"branches": [...]}``.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable


STATE_NAMES = {
    "cdmx": "Ciudad de México",
    "edomex": "Estado de México",
}

STATE_ALIASES = {
    "ciudad de mexico": "cdmx",
    "cdmx": "cdmx",
    "distrito federal": "cdmx",
    "estado de mexico": "edomex",
    "edomex": "edomex",
}

CDMX_ALCALDIAS = {
    "alvaro obregon": "Álvaro Obregón",
    "azcapotzalco": "Azcapotzalco",
    "benito juarez": "Benito Juárez",
    "coyoacan": "Coyoacán",
    "cuajimalpa de morelos": "Cuajimalpa de Morelos",
    "cuajimalpa": "Cuajimalpa de Morelos",
    "cuauhtemoc": "Cuauhtémoc",
    "gustavo a madero": "Gustavo A. Madero",
    "iztacalco": "Iztacalco",
    "iztapalapa": "Iztapalapa",
    "la magdalena contreras": "La Magdalena Contreras",
    "magdalena contreras": "La Magdalena Contreras",
    "miguel hidalgo": "Miguel Hidalgo",
    "milpa alta": "Milpa Alta",
    "san pedro atocpan": "Milpa Alta",
    "tlahuac": "Tláhuac",
    "tlalpan": "Tlalpan",
    "venustiano carranza": "Venustiano Carranza",
    "xochimilco": "Xochimilco",
}

TACO_SIGNAL_RE = re.compile(
    r"\b(?:tacos?|taqueria|birria|carnitas?|barbacoa|suadero|"
    r"pastor|canasta|cabeza|trompo|quesabirria|guisad[oa]s?)\b",
    re.IGNORECASE,
)


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\x00", "").strip())


def normalized(value: Any) -> str:
    text = clean(value).lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalized(value)).strip("-")


def number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def tags_for(branch: dict[str, Any]) -> set[str]:
    return {normalized(tag).replace(" ", "-") for tag in branch.get("tags", []) if clean(tag)}


def source_for(branch: dict[str, Any]) -> str:
    source = clean(branch.get("sourceName"))
    if source:
        return source
    return "unknown"


def coverage_for(branch: dict[str, Any]) -> str:
    tags = tags_for(branch)
    if "cdmx" in tags:
        return "cdmx"
    if "edomex" in tags:
        return "edomex"

    text = normalized(
        " ".join(
            [
                clean(branch.get("state")),
                clean(branch.get("entity")),
                clean(branch.get("address")),
            ]
        )
    )
    if "estado de mexico" in text or "edomex" in text:
        return "edomex"
    if "ciudad de mexico" in text or "cdmx" in text or "distrito federal" in text:
        return "cdmx"
    return "unknown"


def municipality_for(branch: dict[str, Any], coverage: str) -> str:
    direct = clean(
        branch.get("municipality")
        or branch.get("municipio")
        or branch.get("alcaldia")
        or branch.get("alcaldía")
    )
    if direct:
        direct_key = normalized(direct)
        if coverage == "cdmx":
            for alias, label in CDMX_ALCALDIAS.items():
                if direct_key == alias or direct_key.startswith(f"{alias} ") or f" {alias} " in f" {direct_key} ":
                    return label
            if (
                direct_key in {
                    "ciudad de mexico",
                    "cdmx",
                    "distrito federal",
                    "mexico d f",
                    "mexico df",
                    "mexico city",
                    "mexico",
                }
                or "ciudad de mexico" in direct_key
                or "distrito federal" in direct_key
            ):
                return "Sin alcaldía (OSM)"
        if coverage == "edomex" and (
            direct_key in {"estado de mexico", "edomex", "mexico", "mexico city"}
            or "estado de mexico" in direct_key
        ):
            return "Sin municipio (OSM)"
        return direct

    address_parts = [clean(part) for part in clean(branch.get("address")).split(",")]
    address_parts = [part for part in address_parts if part]
    if address_parts:
        aliases = set(STATE_ALIASES)
        for index, part in enumerate(address_parts):
            if normalized(part) in aliases and index > 0:
                candidate = address_parts[index - 1]
                if normalized(candidate).startswith("c p") or candidate.isdigit():
                    continue
                candidate_key = normalized(candidate)
                if coverage == "cdmx" and candidate_key in CDMX_ALCALDIAS:
                    return CDMX_ALCALDIAS[candidate_key]
                if coverage == "edomex" and candidate_key in {"estado de mexico", "edomex"}:
                    return "Sin municipio (OSM)"
                return candidate

    neighborhood = clean(branch.get("neighborhood"))
    if coverage == "cdmx" and normalized(neighborhood) in {"ciudad de mexico", "cdmx", "distrito federal", "mexico", "mexico city"}:
        return "Sin alcaldía (OSM)"
    if coverage == "edomex" and normalized(neighborhood) in {"estado de mexico", "edomex", "mexico", "mexico city"}:
        return "Sin municipio (OSM)"
    return neighborhood if neighborhood else f"Sin municipio ({coverage})"


def business_type(branch: dict[str, Any]) -> str:
    source = source_for(branch)
    tags = tags_for(branch)
    text = normalized(
        " ".join(
            [
                clean(branch.get("name")),
                clean(branch.get("description")),
                " ".join(clean(tag) for tag in branch.get("tags", [])),
            ]
        )
    )
    if "food truck" in text or "camion" in text:
        return "food_truck"
    if "puesto" in text or "street vendor" in text:
        return "street_taco_stand"
    if "canasta" in text:
        return "tacos_de_canasta"
    # The DENUE builder adds a generic ``tacos`` tag to every selected row.
    # Do not use that tag as proof that a generic restaurant is a taqueria.
    if "taqueria" in text or TACO_SIGNAL_RE.search(normalized(branch.get("name"))) or "candidato-por-nombre" in tags or "nombre-con-senal-de-tacos" in tags:
        return "taqueria"
    if source == "osm" and ("taco" in tags or "tacos" in tags) and ("restaurant" in tags or "fast-food" in tags):
        return "candidate"
    return "restaurant_with_tacos"


def confidence(branch: dict[str, Any]) -> str:
    tags = tags_for(branch)
    name = clean(branch.get("name"))
    if "confidence-high" in tags or "high" in tags:
        return "high"
    if "nombre-con-senal-de-tacos" in tags or "candidato-por-nombre" in tags:
        return "high"
    if TACO_SIGNAL_RE.search(normalized(name)):
        return "high"
    if "actividad-principal-tacos-y-tortas" in tags:
        return "medium"
    return "candidate"


def valid_coordinate(branch: dict[str, Any]) -> bool:
    latitude = number(branch.get("latitude"))
    longitude = number(branch.get("longitude"))
    return (
        latitude is not None
        and longitude is not None
        and -90 <= latitude <= 90
        and -180 <= longitude <= 180
    )


def distance_m(left: dict[str, Any], right: dict[str, Any]) -> float | None:
    lat1 = number(left.get("latitude"))
    lon1 = number(left.get("longitude"))
    lat2 = number(right.get("latitude"))
    lon2 = number(right.get("longitude"))
    if None in (lat1, lon1, lat2, lon2):
        return None
    earth_radius = 6_371_000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return earth_radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def iter_catalog(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(document, list):
        return {}, [row for row in document if isinstance(row, dict)]
    if not isinstance(document, dict) or not isinstance(document.get("branches"), list):
        raise ValueError("El catálogo debe ser una lista o contener { branches: [] }")
    return document, [row for row in document["branches"] if isinstance(row, dict)]


def write_csv(path: Path, rows: Iterable[dict[str, Any]], columns: list[str]) -> None:
    rows = list(rows)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def audit(document: dict[str, Any], branches: list[dict[str, Any]]) -> dict[str, Any]:
    catalog_metadata = {
        key: value for key, value in document.items() if key != "branches"
    }
    coverage_counts = Counter()
    source_counts = Counter()
    confidence_counts = Counter()
    type_counts = Counter()
    status_counts = Counter()
    municipality_counts: Counter[tuple[str, str]] = Counter()
    municipality_sources: defaultdict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    municipality_confidence: defaultdict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    missing_counts = Counter()
    source_ids = Counter()
    normalized_records: list[dict[str, Any]] = []

    for branch in branches:
        coverage = coverage_for(branch)
        municipality = municipality_for(branch, coverage)
        source = source_for(branch)
        level = confidence(branch)
        place_type = business_type(branch)
        status = clean(branch.get("catalogStatus")) or "unknown"
        coverage_counts[coverage] += 1
        source_counts[source] += 1
        confidence_counts[level] += 1
        type_counts[place_type] += 1
        status_counts[status] += 1
        municipality_counts[(coverage, municipality)] += 1
        municipality_sources[(coverage, municipality)][source] += 1
        municipality_confidence[(coverage, municipality)][level] += 1

        if not clean(branch.get("name")):
            missing_counts["name"] += 1
        if not clean(branch.get("address")):
            missing_counts["address"] += 1
        if not clean(branch.get("phone")):
            missing_counts["phone"] += 1
        if not branch.get("photos") and not clean(branch.get("imageUrl")):
            missing_counts["photo"] += 1
        if not branch.get("weeklyHours"):
            missing_counts["hours"] += 1
        if not valid_coordinate(branch):
            missing_counts["invalid_coordinate"] += 1

        source_place_id = clean(branch.get("sourcePlaceId"))
        if source_place_id:
            source_ids[(source, source_place_id)] += 1

        normalized_records.append(
            {
                "branch": branch,
                "coverage": coverage,
                "municipality": municipality,
                "source": source,
                "confidence": level,
                "type": place_type,
                "name_key": slug(branch.get("name")),
            }
        )

    duplicate_source_ids = [
        {"source": source, "sourcePlaceId": place_id, "count": count}
        for (source, place_id), count in source_ids.items()
        if count > 1
    ]

    # Candidate duplicates use geographic buckets so the audit remains fast
    # on the full regional catalog.  They are suggestions for review, not
    # automatic merges.
    buckets: defaultdict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for record in normalized_records:
        branch = record["branch"]
        latitude = number(branch.get("latitude"))
        longitude = number(branch.get("longitude"))
        if latitude is None or longitude is None:
            continue
        buckets[(round(latitude * 100), round(longitude * 100))].append(record)

    duplicate_candidates: list[dict[str, Any]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for (bucket_lat, bucket_lon), records in buckets.items():
        neighbors = [
            candidate
            for d_lat in (-1, 0, 1)
            for d_lon in (-1, 0, 1)
            for candidate in buckets.get((bucket_lat + d_lat, bucket_lon + d_lon), [])
        ]
        for left in records:
            for right in neighbors:
                left_id = clean(left["branch"].get("id"))
                right_id = clean(right["branch"].get("id"))
                if not left_id or not right_id or left_id >= right_id:
                    continue
                pair = (left_id, right_id)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                if left["source"] == right["source"] and clean(left["branch"].get("sourcePlaceId")) == clean(right["branch"].get("sourcePlaceId")):
                    continue
                distance = distance_m(left["branch"], right["branch"])
                if distance is None or distance > 150:
                    continue
                name_similarity = SequenceMatcher(None, left["name_key"], right["name_key"]).ratio()
                same_name = left["name_key"] and left["name_key"] == right["name_key"]
                same_phone = clean(left["branch"].get("phone")) and clean(left["branch"].get("phone")) == clean(right["branch"].get("phone"))
                if not same_name and not same_phone and name_similarity < 0.86:
                    continue
                duplicate_candidates.append(
                    {
                        "leftId": left_id,
                        "rightId": right_id,
                        "leftName": clean(left["branch"].get("name")),
                        "rightName": clean(right["branch"].get("name")),
                        "leftSource": left["source"],
                        "rightSource": right["source"],
                        "distanceMeters": round(distance, 1),
                        "nameSimilarity": round(name_similarity, 3),
                        "samePhone": bool(same_phone),
                        "suggestedAction": "auto_merge" if same_phone or (same_name and distance <= 60) else "review",
                    }
                )

    duplicate_candidates.sort(key=lambda row: (row["suggestedAction"] != "auto_merge", row["distanceMeters"], row["leftName"]))

    coverage_rows = []
    for (coverage, municipality), count in sorted(municipality_counts.items()):
        sources = municipality_sources[(coverage, municipality)]
        levels = municipality_confidence[(coverage, municipality)]
        coverage_rows.append(
            {
                "coverage": coverage,
                "municipality": municipality,
                "total": count,
                "denue": sources.get("denue-cdmx-edomex", 0),
                "osm": sources.get("osm-cdmx-edomex", 0),
                "otherSources": sum(value for key, value in sources.items() if key not in {"denue-cdmx-edomex", "osm-cdmx-edomex"}),
                "high": levels.get("high", 0),
                "medium": levels.get("medium", 0),
                "candidate": levels.get("candidate", 0),
            }
        )

    return {
        "catalogMetadata": catalog_metadata,
        "summary": {
            "branches": len(branches),
            "coverage": dict(sorted(coverage_counts.items())),
            "sources": dict(sorted(source_counts.items())),
            "confidence": dict(sorted(confidence_counts.items())),
            "businessTypes": dict(sorted(type_counts.items())),
            "statuses": dict(sorted(status_counts.items())),
            "missing": dict(sorted(missing_counts.items())),
            "duplicateSourceIds": len(duplicate_source_ids),
            "duplicateCandidates": len(duplicate_candidates),
            "autoMergeCandidates": sum(row["suggestedAction"] == "auto_merge" for row in duplicate_candidates),
        },
        "coverage": coverage_rows,
        "duplicateSourceIds": duplicate_source_ids,
        "duplicateCandidates": duplicate_candidates,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("catalog/cdmx-edomex.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("catalog/reports"))
    args = parser.parse_args()

    document, branches = iter_catalog(args.input)
    result = audit(document, branches)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "coverage-audit.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_csv(
        args.output_dir / "coverage-by-municipality.csv",
        result["coverage"],
        ["coverage", "municipality", "total", "denue", "osm", "otherSources", "high", "medium", "candidate"],
    )
    write_csv(
        args.output_dir / "duplicate-candidates.csv",
        result["duplicateCandidates"],
        ["leftId", "rightId", "leftName", "rightName", "leftSource", "rightSource", "distanceMeters", "nameSimilarity", "samePhone", "suggestedAction"],
    )
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
    print(f"Reportes escritos en: {args.output_dir}")


if __name__ == "__main__":
    main()
