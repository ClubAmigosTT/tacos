#!/usr/bin/env python3
"""Import and reconcile manually collected taco-search CSV exports.

The input files are treated as a staging source only.  This command does not
publish their Google-derived content to the app and intentionally does not
export image URLs.  It produces a reviewable candidate list that can later be
verified with independent, reusable sources such as DENUE, OSM or a business
submission.

Usage:
    python scripts/import_manual_taco_candidates.py
    python scripts/import_manual_taco_candidates.py --input-dir "..."

Outputs (ignored local artifacts):
    manual-candidates-summary.json
    manual-candidates.json
    manual-candidates.csv
    manual-candidates-review.csv
    manual-candidates-new.csv
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable


DEFAULT_INPUT_DIR = Path.home() / "Downloads" / "BAses tacos"
DEFAULT_CATALOG = Path("catalog/cdmx-edomex.json")
DEFAULT_OUTPUT_DIR = Path("catalog/reports/manual-candidates")

FIELD_MAP = {
    "name": "OSrXXb",
    "category": "rllt__details",
    "rating": "yi40Hd",
    "review_count": "RDApEe",
    "price": "rllt__details 2",
    "address": "rllt__details 3",
    "description": "uDyWh",
    "query": "uDyWh 2",
    "image": "wA1Bge src",
    "hours_hint": "rllt__details 4",
    "open_status": "rllt__details 5",
}

GENERIC_NAME_WORDS = {
    "taco",
    "tacos",
    "taqueria",
    "taquerias",
    "restaurante",
    "restaurantes",
    "restaurant",
    "restaurants",
}

ADDRESS_STOP_WORDS = {
    "avenida",
    "av",
    "ave",
    "calle",
    "c",
    "boulevard",
    "blvd",
    "bulevar",
    "carretera",
    "autopista",
    "colonia",
    "col",
    "fraccionamiento",
    "fracc",
    "numero",
    "num",
    "no",
    "interior",
    "int",
    "exterior",
    "ext",
    "local",
    "piso",
    "cp",
    "codigo",
    "postal",
    "ciudad",
    "cdmx",
    "mexico",
}

TACO_SIGNAL_RE = re.compile(
    r"\b(?:taco|tacos|taqueria|birria|carnita|carnitas|barbacoa|suadero|"
    r"pastor|canasta|cabeza|trompo|quesabirria|guisado|guisados|antojito|"
    r"antojitos)\b",
    re.IGNORECASE,
)

KNOWN_AREA_HINTS = {
    "azcapo": "Azcapotzalco",
    "azcapotzalco": "Azcapotzalco",
    "benito": "Benito Juárez",
    "juares": "Benito Juárez",
    "coyoacan": "Coyoacán",
    "cuautemoch": "Cuauhtémoc",
    "cuauhtemoc": "Cuauhtémoc",
    "iztacalco": "Iztacalco",
    "miguel hidalgo": "Miguel Hidalgo",
    "alcaro": "Álvaro Obregón",
    "alvaro": "Álvaro Obregón",
    "centro": "Centro / por verificar",
}

OUT_OF_SCOPE_HINTS = {
    "monterrey",
    "guadalajara",
    "puebla",
    "queretaro",
    "merida",
    "tijuana",
    "cancun",
    "leon guanajuato",
    "san luis potosi",
    "veracruz",
}


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\x00", "").strip())


def normalized(value: Any) -> str:
    text = clean(value).lower().replace("&", " y ")
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def compact_name(value: Any) -> str:
    tokens = [token for token in normalized(value).split() if token not in GENERIC_NAME_WORDS]
    return " ".join(tokens)


def parse_number(value: Any) -> float | None:
    text = clean(value).replace(",", "")
    if not text:
        return None
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match:
        return None
    number = float(match.group(0))
    return number if math.isfinite(number) else None


def parse_review_count(value: Any) -> int | None:
    text = clean(value).lower().replace("\xa0", " ").replace(",", "")
    if not text or "no hay" in text:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*([km])?", text)
    if not match:
        return None
    number = float(match.group(1))
    suffix = match.group(2)
    if suffix == "k":
        number *= 1000
    elif suffix == "m":
        number *= 1_000_000
    return int(round(number))


def address_tokens(value: Any) -> set[str]:
    tokens = set(normalized(value).split())
    return {token for token in tokens if token not in ADDRESS_STOP_WORDS and len(token) > 1}


def address_compatibility(left: Any, right: Any) -> float:
    """Return a conservative address compatibility score in [0, 1]."""

    left_text = normalized(left)
    right_text = normalized(right)
    if not left_text or not right_text:
        return 0.0
    left_tokens = address_tokens(left_text)
    right_tokens = address_tokens(right_text)
    shared = left_tokens & right_tokens
    numbers_left = {token for token in left_tokens if token.isdigit()}
    numbers_right = {token for token in right_tokens if token.isdigit()}
    shared_numbers = numbers_left & numbers_right
    ratio = SequenceMatcher(None, left_text, right_text).ratio()

    if shared_numbers and len(shared) >= 2:
        return 0.98
    if shared_numbers:
        return 0.72
    if len(shared) >= 3:
        return 0.82
    if len(shared) == 2:
        return max(0.64, ratio)
    if len(shared) == 1:
        return max(0.36, ratio * 0.72)
    return ratio * 0.45


def area_hint_from_filename(filename: str) -> str:
    key = normalized(Path(filename).stem)
    for needle, label in KNOWN_AREA_HINTS.items():
        if normalized(needle) in key:
            return label
    if "cdmx" in key or "google" in key:
        return "CDMX / por verificar"
    return "Por verificar"


def taco_relevance(name: str, category: str, description: str, query: str) -> tuple[int, str]:
    name_signal = bool(TACO_SIGNAL_RE.search(normalized(name)))
    category_signal = "taco" in normalized(category) or "taqueria" in normalized(category)
    text_signal = bool(TACO_SIGNAL_RE.search(normalized(description)))
    query_signal = bool(TACO_SIGNAL_RE.search(normalized(query)))
    score = (3 if name_signal else 0) + (2 if category_signal else 0) + (1 if text_signal else 0) + (1 if query_signal else 0)
    if score >= 3:
        return score, "strong"
    if score >= 2:
        return score, "medium"
    if score >= 1:
        return score, "weak"
    return score, "none"


def out_of_scope_hint(address: str) -> str:
    text = normalized(address)
    for hint in OUT_OF_SCOPE_HINTS:
        if normalized(hint) in text:
            return hint
    return ""


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    raw = path.read_bytes()
    decoded = None
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            candidate = raw.decode(encoding)
            if "\ufffd" not in candidate:
                decoded = candidate
                break
        except UnicodeDecodeError:
            continue
    if decoded is None:
        decoded = raw.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(decoded)))


def row_value(row: dict[str, str], field: str) -> str:
    return clean(row.get(FIELD_MAP[field], ""))


def source_candidate(row: dict[str, str], filename: str, row_number: int) -> dict[str, Any]:
    name = row_value(row, "name")
    address = row_value(row, "address")
    category = row_value(row, "category").lstrip("· ").strip()
    description = row_value(row, "description").strip('"')
    query = row_value(row, "query")
    rating = parse_number(row_value(row, "rating"))
    if rating is not None and not 0 <= rating <= 5:
        rating = None
    review_count = parse_review_count(row_value(row, "review_count"))
    relevance_score, relevance = taco_relevance(name, category, description, query)
    return {
        "name": name,
        "address": address,
        "category": category,
        "rating": rating,
        "review_count": review_count,
        "price": row_value(row, "price"),
        "description": description,
        "query": query,
        "has_image": bool(row_value(row, "image")),
        "hours_hint": row_value(row, "hours_hint"),
        "open_status": row_value(row, "open_status"),
        "source_file": filename,
        "source_row": row_number,
        "source_area": area_hint_from_filename(filename),
        "relevance_score": relevance_score,
        "relevance": relevance,
    }


def candidate_key(candidate: dict[str, Any]) -> str:
    name = normalized(candidate["name"])
    address = normalized(candidate["address"])
    return f"{name}|{address}" if address else f"{name}|{normalized(candidate['category'])}"


def merge_candidates(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    merged: dict[str, dict[str, Any]] = {}
    duplicate_rows = 0
    for row in rows:
        if not row["name"]:
            continue
        key = candidate_key(row)
        existing = merged.get(key)
        if existing is None:
            item = dict(row)
            item["source_files"] = [row["source_file"]]
            item["source_rows"] = [row["source_row"]]
            item["occurrences"] = 1
            merged[key] = item
            continue
        duplicate_rows += 1
        existing["occurrences"] += 1
        if row["source_file"] not in existing["source_files"]:
            existing["source_files"].append(row["source_file"])
        existing["source_rows"].append(row["source_row"])
        # Keep the richest representation of a repeated result.
        existing_score = sum(bool(existing[field]) for field in ("address", "category", "description", "price"))
        row_score = sum(bool(row[field]) for field in ("address", "category", "description", "price"))
        if row_score > existing_score:
            for field in ("category", "rating", "review_count", "price", "description", "query", "hours_hint", "open_status", "source_area", "relevance_score", "relevance"):
                if row.get(field):
                    existing[field] = row[field]
        existing["has_image"] = existing["has_image"] or row["has_image"]
    return list(merged.values()), duplicate_rows


def load_catalog(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    branches = raw.get("branches") if isinstance(raw, dict) else raw
    if not isinstance(branches, list):
        raise ValueError(f"El catálogo no tiene una lista de branches: {path}")
    return [branch for branch in branches if isinstance(branch, dict)]


def catalog_search_indexes(branches: list[dict[str, Any]]) -> tuple[dict[str, list[int]], dict[str, list[int]], dict[str, list[int]]]:
    exact: dict[str, list[int]] = defaultdict(list)
    compact: dict[str, list[int]] = defaultdict(list)
    token_index: dict[str, list[int]] = defaultdict(list)
    for index, branch in enumerate(branches):
        names = {clean(branch.get("name")), clean(branch.get("taqueriaName"))}
        for name in names:
            full = normalized(name)
            short = compact_name(name)
            if full:
                exact[full].append(index)
            if short:
                compact[short].append(index)
                for token in set(short.split()):
                    if len(token) >= 3:
                        token_index[token].append(index)
    return exact, compact, token_index


def branch_zone(branch: dict[str, Any]) -> str:
    return normalized(branch.get("municipality") or branch.get("neighborhood") or branch.get("state"))


def score_match(candidate: dict[str, Any], branch: dict[str, Any]) -> tuple[float, str, float, float]:
    candidate_full = normalized(candidate["name"])
    candidate_short = compact_name(candidate["name"])
    branch_names = [clean(branch.get("name")), clean(branch.get("taqueriaName"))]
    name_score = max(
        [
            SequenceMatcher(None, candidate_full, normalized(name)).ratio()
            for name in branch_names
            if normalized(name)
        ]
        or [0.0]
    )
    short_score = max(
        [
            SequenceMatcher(None, candidate_short, compact_name(name)).ratio()
            for name in branch_names
            if compact_name(name) and candidate_short
        ]
        or [0.0]
    )
    name_score = max(name_score, short_score)
    address_score = address_compatibility(candidate["address"], branch.get("address"))
    area = normalized(candidate.get("source_area"))
    zone = branch_zone(branch)
    area_score = 0.08 if area and zone and any(token in zone for token in area.split() if len(token) > 3) else 0.0
    combined = min(1.0, name_score * 0.64 + address_score * 0.31 + area_score)
    reason = f"name={name_score:.2f};address={address_score:.2f};area={area_score:.2f}"
    return combined, reason, name_score, address_score


def find_matches(candidate: dict[str, Any], branches: list[dict[str, Any]], exact: dict[str, list[int]], compact: dict[str, list[int]], token_index: dict[str, list[int]]) -> list[tuple[float, str, int, float, float]]:
    full = normalized(candidate["name"])
    short = compact_name(candidate["name"])
    indexes = set(exact.get(full, [])) | set(compact.get(short, []))
    for token in set(short.split()):
        indexes.update(token_index.get(token, [])[:250])
    scored = []
    for index in indexes:
        combined, reason, name_score, address_score = score_match(candidate, branches[index])
        if name_score >= 0.74 or address_score >= 0.72:
            scored.append((combined, reason, index, name_score, address_score))
    scored.sort(reverse=True, key=lambda item: item[0])
    return scored[:8]


def classify_candidate(candidate: dict[str, Any], matches: list[tuple[float, str, int, float, float]], branches: list[dict[str, Any]]) -> dict[str, Any]:
    result = dict(candidate)
    result["matched_catalog_id"] = ""
    result["matched_catalog_name"] = ""
    result["matched_catalog_status"] = ""
    result["match_score"] = None
    result["match_reason"] = ""
    result["needs_verification"] = True

    outside_hint = out_of_scope_hint(candidate["address"])
    if outside_hint and not matches:
        result["status"] = "rejected"
        result["match_reason"] = f"la dirección contiene una ciudad fuera de CDMX/Edomex: {outside_hint}"
        return result

    if matches:
        best = matches[0]
        second = matches[1] if len(matches) > 1 else None
        score, reason, _, _, address_score = best
        # A shared or generic business name is not enough to merge a manual
        # row into a catalog branch. If the supplied address is materially
        # different, keep it as a missing candidate so it can be geocoded and
        # reviewed instead of disappearing behind a false match.
        if clean(candidate.get("address")) and address_score < 0.45:
            result["status"] = "missing_candidate"
            result["match_reason"] = f"{reason};name_only_match_not_sufficient"
            return result
        result["matched_catalog_id"] = clean(branches[best[2]].get("id"))
        result["matched_catalog_name"] = clean(branches[best[2]].get("name") or branches[best[2]].get("taqueriaName"))
        result["matched_catalog_status"] = clean(branches[best[2]].get("catalogStatus")) or ("active" if branches[best[2]].get("isActive", True) else "inactive")
        result["match_score"] = round(score, 4)
        result["match_reason"] = reason
        ambiguous = second is not None and (score - second[0] < 0.08)
        if score >= 0.86 and address_score >= 0.64 and not ambiguous:
            result["status"] = "matched"
            result["needs_verification"] = False
            return result
        result["status"] = "review"
        result["match_reason"] += ";ambiguous_or_weak"
        return result

    if candidate["relevance"] == "none":
        result["status"] = "rejected"
        result["match_reason"] = "sin señal suficiente de tacos"
        return result

    result["status"] = "missing_candidate"
    result["match_reason"] = "sin coincidencia confiable; requiere coordenadas y verificación"
    return result


def stable_id(candidate: dict[str, Any]) -> str:
    value = candidate_key(candidate).encode("utf-8")
    return f"manual-{hashlib.sha256(value).hexdigest()[:16]}"


def json_safe_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    result = dict(candidate)
    result["candidate_id"] = stable_id(candidate)
    # The original Google image URL is deliberately not exported.  It is not
    # a stable, reusable catalog asset and must not enter the mobile catalog.
    result.pop("description", None)
    result.pop("query", None)
    return result


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "candidate_id", "name", "address", "category", "rating", "review_count", "price",
        "source_area", "source_files", "source_rows", "occurrences", "has_image",
        "relevance", "relevance_score", "status", "matched_catalog_id",
        "matched_catalog_name", "matched_catalog_status", "match_score", "match_reason",
        "needs_verification",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            output = dict(row)
            output["source_files"] = " | ".join(output.get("source_files", []))
            output["source_rows"] = " | ".join(str(item) for item in output.get("source_rows", []))
            writer.writerow(output)


def build_summary(all_rows: list[dict[str, Any]], unique_rows: list[dict[str, Any]], classified: list[dict[str, Any]], branches: list[dict[str, Any]], duplicate_rows: int, input_files: list[Path], captured_at: str) -> dict[str, Any]:
    return {
        "capturedAt": captured_at,
        "inputDirectory": str(input_files[0].parent) if input_files else "",
        "inputFiles": [path.name for path in input_files],
        "catalogFile": str(DEFAULT_CATALOG),
        "grain": "un lugar por nombre normalizado + dirección normalizada; sin dirección se usa nombre + categoría",
        "rowsRead": len(all_rows),
        "rowsWithName": sum(bool(row["name"]) for row in all_rows),
        "rowsSkippedWithoutName": sum(not bool(row["name"]) for row in all_rows),
        "uniqueCandidates": len(unique_rows),
        "duplicateRowsRemoved": duplicate_rows,
        "duplicateRate": round(duplicate_rows / len(all_rows), 4) if all_rows else 0,
        "fields": {
            "withAddress": sum(bool(row["address"]) for row in unique_rows),
            "withRating": sum(row["rating"] is not None for row in unique_rows),
            "withReviewCount": sum(row["review_count"] is not None for row in unique_rows),
            "withImage": sum(bool(row["has_image"]) for row in unique_rows),
            "withPlaceId": 0,
            "withCoordinates": 0,
        },
        "catalogBranchesCompared": len(branches),
        "statusCounts": dict(sorted(Counter(row["status"] for row in classified).items())),
        "relevanceCounts": dict(sorted(Counter(row["relevance"] for row in classified).items())),
        "areaCounts": dict(sorted(Counter(row["source_area"] for row in classified).items())),
        "categoryCounts": dict(Counter(row["category"] or "<sin categoría>" for row in unique_rows).most_common(25)),
        "qualityChecks": {
            "placeIdsPresent": False,
            "coordinatesPresent": False,
            "googleImageUrlsExported": False,
            "catalogPublicationPerformed": False,
            "manualReviewRequired": True,
        },
        "interpretation": {
            "missingCandidateIsNotConfirmed": "missing_candidate requiere coordenadas y verificación independiente antes de entrar al catálogo.",
            "matchedDoesNotAddRows": "matched sólo identifica un registro ya existente; no modifica el catálogo.",
            "reviewReason": "review contiene coincidencias ambiguas, nombres genéricos o direcciones insuficientes.",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_dir = args.input_dir.expanduser()
    catalog_path = args.catalog
    output_dir = args.output_dir
    if not input_dir.is_dir():
        raise SystemExit(f"No existe el directorio de entrada: {input_dir}")
    if not catalog_path.is_file():
        raise SystemExit(f"No existe el catálogo: {catalog_path}")

    input_files = sorted(input_dir.glob("*.csv"), key=lambda path: path.name.lower())
    if not input_files:
        raise SystemExit(f"No hay archivos CSV en: {input_dir}")

    captured_at = datetime.now(timezone.utc).isoformat()
    raw_rows: list[dict[str, Any]] = []
    for path in input_files:
        for row_number, row in enumerate(read_csv_rows(path), start=2):
            raw_rows.append(source_candidate(row, path.name, row_number))

    unique_rows, duplicate_rows = merge_candidates(raw_rows)
    branches = load_catalog(catalog_path)
    exact, compact, token_index = catalog_search_indexes(branches)
    classified = []
    for candidate in unique_rows:
        matches = find_matches(candidate, branches, exact, compact, token_index)
        classified.append(classify_candidate(candidate, matches, branches))
    classified.sort(key=lambda row: (row["status"], -row["relevance_score"], row["name"].casefold()))

    output_dir.mkdir(parents=True, exist_ok=True)
    safe_rows = [json_safe_candidate(row) for row in classified]
    summary = build_summary(raw_rows, unique_rows, classified, branches, duplicate_rows, input_files, captured_at)
    summary["catalogFile"] = str(catalog_path)

    (output_dir / "manual-candidates-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "manual-candidates.json").write_text(json.dumps({"summary": summary, "candidates": safe_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(output_dir / "manual-candidates.csv", safe_rows)
    write_csv(output_dir / "manual-candidates-review.csv", [row for row in safe_rows if row["status"] in {"missing_candidate", "review"}])
    write_csv(output_dir / "manual-candidates-new.csv", [row for row in safe_rows if row["status"] == "missing_candidate"])
    write_csv(output_dir / "manual-candidates-matched.csv", [row for row in safe_rows if row["status"] == "matched"])

    print("==========================================")
    print(" IMPORTACIÓN DE CANDIDATOS MANUALES")
    print("==========================================")
    print(f"Archivos: {len(input_files)}")
    print(f"Filas leídas: {len(raw_rows)}")
    print(f"Candidatos únicos: {len(unique_rows)}")
    print(f"Duplicados eliminados: {duplicate_rows}")
    print(f"Ramas comparadas: {len(branches)}")
    for status, count in summary["statusCounts"].items():
        print(f"{status}: {count}")
    print(f"Salida: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
