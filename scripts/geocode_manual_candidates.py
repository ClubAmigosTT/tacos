#!/usr/bin/env python3
"""Geocode staged manual candidates with OSM Nominatim.

This is a deliberately conservative, resumable one-time enrichment step. It
only sends candidates with a street name and house number, stores responses in
a local cache, uses one request sequence, and never edits the app catalog.

The public Nominatim service must not be used as an unbounded recurring
geocoder. For periodic production jobs, use a self-hosted instance or a
provider whose terms and quota support the workload.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from import_manual_taco_candidates import address_compatibility, compact_name, normalized


DEFAULT_INPUT = Path("catalog/reports/manual-candidates/manual-candidates.json")
DEFAULT_OUTPUT_DIR = Path("catalog/reports/manual-candidates")
DEFAULT_ENDPOINT = "https://nominatim.openstreetmap.org/search"
DEFAULT_DELAY = 1.1

ADDRESS_PREFIXES = {
    "avenida", "av", "ave", "calle", "c", "boulevard", "blvd", "bulevar",
    "carretera", "autopista", "prolongacion", "prol", "calzada", "calz",
    "camino", "privada", "priv", "eje", "andador", "cerrada", "cerr",
    "esquina", "esq", "frente", "metro", "parque", "colonia", "col",
}

TARGET_BBOX = (18.9, -100.8, 20.5, -98.5)  # south, west, north, east


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\x00", "").strip())


def useful_address(value: str) -> bool:
    """Require a house number and at least one meaningful street token."""

    text = normalized(value)
    if not text or text in {"parque", "cdmx", "ciudad de mexico", "mexico"}:
        return False
    tokens = text.split()
    has_number = any(re.fullmatch(r"\d+[a-z]?", token) for token in tokens)
    meaningful = [
        token for token in tokens
        if token not in ADDRESS_PREFIXES and not token.isdigit() and len(token) >= 3
    ]
    return has_number and bool(meaningful)


def area_for_query(candidate: dict[str, Any]) -> str:
    area = clean(candidate.get("source_area"))
    if area and "por verificar" not in normalized(area):
        return area
    return "Ciudad de México"


def build_query(candidate: dict[str, Any]) -> str:
    # The CSV filename only gives an approximate search area.  It can conflict
    # with a precise street address, so keep the address as the primary signal
    # and use CDMX as the broad city context.
    parts = [candidate.get("name"), candidate.get("address"), "Ciudad de México", "México"]
    return ", ".join(clean(part) for part in parts if clean(part))


def build_address_query(candidate: dict[str, Any]) -> str:
    parts = [candidate.get("address"), "Ciudad de México", "México"]
    return ", ".join(clean(part) for part in parts if clean(part))


def canonical_cache_key(candidate: dict[str, Any]) -> str:
    return f"{normalized(candidate.get('name'))}|{normalized(candidate.get('address'))}"


def as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def within_target(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    south, west, north, east = TARGET_BBOX
    return south <= lat <= north and west <= lon <= east


def result_names(result: dict[str, Any]) -> list[str]:
    names = [clean(result.get("name"))]
    namedetails = result.get("namedetails")
    if isinstance(namedetails, dict):
        names.extend(clean(value) for value in namedetails.values())
    display = clean(result.get("display_name"))
    if display:
        names.append(display.split(",", 1)[0])
    return [name for name in names if name]


def name_score(candidate_name: str, result: dict[str, Any]) -> float:
    candidate_full = normalized(candidate_name)
    candidate_short = compact_name(candidate_name)
    scores = []
    for name in result_names(result):
        result_full = normalized(name)
        result_short = compact_name(name)
        if candidate_full and result_full:
            from difflib import SequenceMatcher
            scores.append(SequenceMatcher(None, candidate_full, result_full).ratio())
        if candidate_short and result_short:
            from difflib import SequenceMatcher
            scores.append(SequenceMatcher(None, candidate_short, result_short).ratio())
    return max(scores or [0.0])


def score_result(candidate: dict[str, Any], result: dict[str, Any]) -> tuple[float, float, float, str]:
    lat = as_float(result.get("lat"))
    lon = as_float(result.get("lon"))
    geo_score = 1.0 if within_target(lat, lon) else 0.0
    n_score = name_score(candidate.get("name", ""), result)
    a_score = address_compatibility(candidate.get("address", ""), result.get("display_name", ""))
    combined = n_score * 0.52 + a_score * 0.38 + geo_score * 0.10
    reason = f"name={n_score:.2f};address={a_score:.2f};target={geo_score:.2f}"
    return combined, n_score, a_score, reason


def score_address_result(candidate: dict[str, Any], result: dict[str, Any]) -> tuple[float, float, str]:
    lat = as_float(result.get("lat"))
    lon = as_float(result.get("lon"))
    geo_score = 1.0 if within_target(lat, lon) else 0.0
    a_score = address_compatibility(candidate.get("address", ""), result.get("display_name", ""))
    combined = a_score * 0.85 + geo_score * 0.15
    reason = f"address={a_score:.2f};target={geo_score:.2f}"
    return combined, a_score, reason


def geocode(query: str, endpoint: str, user_agent: str, timeout: int = 30) -> list[dict[str, Any]]:
    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": "1",
        "namedetails": "1",
        "limit": "5",
        "countrycodes": "mx",
        "accept-language": "es",
    }
    request = Request(
        f"{endpoint}?{urlencode(params)}",
        headers={"User-Agent": user_agent, "Accept": "application/json"},
        method="GET",
    )
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, list) else []


def load_json(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("candidates"), list):
        raise ValueError(f"Entrada inválida: {path}")
    return raw


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = [
        "candidate_id", "name", "address", "category", "source_area", "status",
        "relevance", "matched_catalog_id", "matched_catalog_name", "geocode_status",
        "latitude", "longitude", "geocode_score", "geocode_name_score",
        "geocode_address_score", "geocode_reason", "geocode_source", "geocode_osm_type",
        "geocode_osm_id", "geocode_display_name", "geocode_query", "geocoded_at",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--user-agent", default="TacosCatalog/1.0 (manual catalog review)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY)
    parser.add_argument("--max-requests", type=int, default=161)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--no-network", action="store_true", help="usar sólo resultados guardados en caché")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    payload = load_json(args.input)
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_path = output_dir / "nominatim-cache.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    if not isinstance(cache, dict):
        cache = {}

    rows = [dict(row) for row in payload["candidates"] if isinstance(row, dict)]
    eligible = [
        row for row in rows
        if row.get("status") == "missing_candidate" and useful_address(clean(row.get("address")))
    ]
    eligible.sort(key=lambda row: (-int(row.get("relevance_score") or 0), row.get("name", "").casefold()))
    # Reuse results from an interrupted earlier query shape when the name and
    # address identify the same staged candidate.  The result is still scored
    # against the candidate, so a weak/incorrect hit remains review-only.
    legacy_cache: dict[str, Any] = {}
    for cached_query, cached_results in cache.items():
        if not isinstance(cached_query, str) or not isinstance(cached_results, list):
            continue
        cached_normalized = normalized(cached_query)
        for row in eligible:
            if normalized(row.get("name")) in cached_normalized and normalized(row.get("address")) in cached_normalized:
                legacy_cache.setdefault(canonical_cache_key(row), cached_results)
    requests_used = 0
    cache_hits = 0
    geocoded = 0
    review = 0
    no_match = 0
    address_only = 0
    address_low_confidence = 0
    skipped = 0

    for index, row in enumerate(eligible):
        query = build_query(row)
        cache_key = query.casefold()
        canonical_key = canonical_cache_key(row)
        row["geocode_query"] = query
        row["geocode_source"] = "OpenStreetMap Nominatim"
        first_request = False
        if cache_key in cache:
            results = cache[cache_key]
            cache_hits += 1
        elif canonical_key in legacy_cache:
            results = legacy_cache[canonical_key]
            cache_hits += 1
        elif args.no_network or requests_used >= args.max_requests:
            row["geocode_status"] = "not_attempted"
            skipped += 1
            continue
        else:
            print(f"[{index + 1}/{len(eligible)}] {query}", flush=True)
            try:
                results = geocode(query, args.endpoint, args.user_agent, args.timeout)
            except Exception as error:  # keep the batch resumable
                results = {"error": f"{type(error).__name__}: {error}"}
            cache[cache_key] = results
            requests_used += 1
            first_request = True
            cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
            if index + 1 < len(eligible):
                time.sleep(max(1.0, args.delay))

        if isinstance(results, dict) and results.get("error"):
            row["geocode_status"] = "error"
            row["geocode_reason"] = results["error"]
            continue
        if not isinstance(results, list) or not results:
            # A business name is often absent from OSM even when the street
            # address exists. Try the address once as a second, lower-
            # confidence pass.
            address_query = build_address_query(row)
            address_cache_key = address_query.casefold()
            address_results = cache.get(address_cache_key)
            fallback_requested = False
            if address_results is None and not args.no_network and requests_used < args.max_requests:
                if first_request:
                    time.sleep(max(1.0, args.delay))
                try:
                    address_results = geocode(address_query, args.endpoint, args.user_agent, args.timeout)
                except Exception as error:
                    address_results = {"error": f"{type(error).__name__}: {error}"}
                cache[address_cache_key] = address_results
                requests_used += 1
                fallback_requested = True
                cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
            if isinstance(address_results, list) and address_results:
                address_scored = sorted((score_address_result(row, result) + (result,) for result in address_results), reverse=True, key=lambda item: item[0])
                combined, a_score, reason, best = address_scored[0]
                row["latitude"] = as_float(best.get("lat"))
                row["longitude"] = as_float(best.get("lon"))
                row["geocode_score"] = round(combined, 4)
                row["geocode_name_score"] = 0.0
                row["geocode_address_score"] = round(a_score, 4)
                row["geocode_reason"] = reason
                row["geocode_method"] = "address_only"
                row["geocode_osm_type"] = clean(best.get("osm_type"))
                row["geocode_osm_id"] = clean(best.get("osm_id"))
                row["geocode_display_name"] = clean(best.get("display_name"))
                row["geocoded_at"] = datetime.now(timezone.utc).isoformat()
                if combined >= 0.60 and within_target(row["latitude"], row["longitude"]):
                    row["geocode_status"] = "address_only_review"
                    address_only += 1
                elif within_target(row["latitude"], row["longitude"]):
                    row["geocode_status"] = "address_low_confidence"
                    address_low_confidence += 1
                else:
                    row["geocode_status"] = "no_match"
                    no_match += 1
            else:
                row["geocode_status"] = "no_match"
                no_match += 1
            if fallback_requested and index + 1 < len(eligible):
                time.sleep(max(1.0, args.delay))
            continue

        scored = sorted((score_result(row, result) + (result,) for result in results), reverse=True, key=lambda item: item[0])
        combined, n_score, a_score, reason, best = scored[0]
        row["latitude"] = as_float(best.get("lat"))
        row["longitude"] = as_float(best.get("lon"))
        row["geocode_score"] = round(combined, 4)
        row["geocode_name_score"] = round(n_score, 4)
        row["geocode_address_score"] = round(a_score, 4)
        row["geocode_reason"] = reason
        row["geocode_method"] = "name_and_address"
        row["geocode_osm_type"] = clean(best.get("osm_type"))
        row["geocode_osm_id"] = clean(best.get("osm_id"))
        row["geocode_display_name"] = clean(best.get("display_name"))
        row["geocoded_at"] = datetime.now(timezone.utc).isoformat()
        row["geocode_status"] = "geocoded" if combined >= 0.78 and n_score >= 0.70 and a_score >= 0.45 and within_target(row["latitude"], row["longitude"]) else "review"
        if row["geocode_status"] == "geocoded":
            geocoded += 1
        else:
            review += 1

    for row in rows:
        row.setdefault("geocode_status", "not_eligible")
        row.setdefault("geocode_source", "OpenStreetMap Nominatim")

    output_payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(args.input),
        "geocoder": "OpenStreetMap Nominatim",
        "requestsUsed": requests_used,
        "cachedResponses": len(cache),
        "requestsUsedTotalCached": len(cache),
        "cacheHits": cache_hits,
        "eligibleCandidates": len(eligible),
        "geocoded": geocoded,
        "review": review,
        "noMatch": no_match,
        "addressOnlyReview": address_only,
        "addressLowConfidence": address_low_confidence,
        "addressCoordinates": address_only + address_low_confidence,
        "notAttempted": skipped,
        "coordinatesAreCandidates": True,
        "catalogPublicationPerformed": False,
        "candidates": rows,
    }
    (output_dir / "manual-candidates-geocoded.json").write_text(json.dumps(output_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(output_dir / "manual-candidates-geocoded.csv", rows)
    write_csv(output_dir / "manual-candidates-geocoded-review.csv", [row for row in rows if row.get("geocode_status") in {"review", "address_only_review", "address_low_confidence", "no_match", "error"}])
    write_csv(output_dir / "manual-candidates-address-review.csv", [row for row in rows if row.get("geocode_status") in {"address_only_review", "address_low_confidence"}])
    write_csv(output_dir / "manual-candidates-geocoded-ready.csv", [row for row in rows if row.get("geocode_status") == "geocoded"])

    print("==========================================")
    print(" GEOCODIFICACIÓN OSM")
    print("==========================================")
    print(f"Candidatos aptos: {len(eligible)}")
    print(f"Solicitudes nuevas: {requests_used}")
    print(f"Resultados en caché: {cache_hits}")
    print(f"Coordenadas candidatas: {geocoded}")
    print(f"Revisión: {review}")
    print(f"Sin resultado: {no_match}")
    print(f"Dirección encontrada, revisión: {address_only}")
    print(f"Dirección encontrada, baja confianza: {address_low_confidence}")
    print(f"No intentados: {skipped}")
    print(f"Salida: {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
