#!/usr/bin/env python3
"""Download the latest official DENUE bulk files for CDMX and Edomex.

The public bulk files do not require a Google account or a Places API key.
The downloader keeps the ZIPs in an ignored working directory and prints the
DENUE edition found in the official metadata so the catalog build is
reproducible.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path


BASE_URL = "https://www.inegi.org.mx/contenidos/masiva/denue"
ARCHIVES = (
    "denue_09_csv.zip",
    "denue_15_1_csv.zip",
    "denue_15_2_csv.zip",
)
USER_AGENT = "TacosCatalog/1.0 (DENUE public bulk refresh)"


def release_from_metadata(data: bytes) -> str:
    text = data.decode("cp1252", errors="replace")
    match = re.search(r"DENUE\s+(\d{2})_(\d{4})", text, re.IGNORECASE)
    if not match:
        match = re.search(r"Temporal:\s*(\d{4})-(\d{2})", text, re.IGNORECASE)
        if match:
            return f"{match.group(1)}{match.group(2)}"
        raise ValueError("No se pudo determinar la edición DENUE en los metadatos")
    return f"{match.group(2)}{match.group(1)}"


def metadata_bytes(archive: zipfile.ZipFile) -> bytes:
    candidates = [
        name for name in archive.namelist()
        if name.lower().startswith("metadatos/") and name.lower().endswith(".txt")
    ]
    if not candidates:
        raise ValueError("El ZIP DENUE no contiene metadatos")
    return archive.read(candidates[0])


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path("data/denue/latest"))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    release: str | None = None
    sizes: dict[str, int] = {}
    for archive_name in ARCHIVES:
        url = f"{BASE_URL}/{archive_name}"
        payload = download(url)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if archive.testzip() is not None:
                raise ValueError(f"ZIP corrupto: {archive_name}")
            detected = release_from_metadata(metadata_bytes(archive))
            release = release or detected
            if detected != release:
                raise ValueError(f"Las ediciones DENUE no coinciden: {release} y {detected}")
        target = args.output_dir / archive_name
        target.write_bytes(payload)
        sizes[archive_name] = len(payload)

    release_file = args.output_dir / "release.txt"
    release_file.write_text(f"{release}\n", encoding="ascii")
    print(json.dumps({"release": release, "outputDir": str(args.output_dir), "archives": sizes}, ensure_ascii=False))


if __name__ == "__main__":
    main()
