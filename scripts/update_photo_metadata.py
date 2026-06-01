#!/usr/bin/env python3
"""Extract photo EXIF metadata and sync it into travels/travels.json."""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from PIL import ExifTags, Image


ROOT = Path(__file__).resolve().parents[1]
TRAVELS_JSON = ROOT / "travels" / "travels.json"
PHOTOS_DIR = ROOT / "photos"
GPS = ExifTags.GPSTAGS
TAGS = ExifTags.TAGS
USER_AGENT = "my-itinerary/0.1 (reverse-geocoding via Nominatim)"
GEOCODE_CACHE: dict[tuple[float, float], str | None] = {}


def decimal_degrees(value: Any, ref: str | None) -> float | None:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    degrees, minutes, seconds = value
    result = float(degrees) + float(minutes) / 60 + float(seconds) / 3600
    return -result if ref in {"S", "W"} else result


def parse_timestamp(exif: Mapping[str, Any]) -> str | None:
    raw_datetime = next(
        (
            exif[tag]
            for tag in ("DateTimeOriginal", "DateTimeDigitized", "DateTime")
            if tag in exif
        ),
        None,
    )
    if not isinstance(raw_datetime, str):
        return None

    normalized = raw_datetime.replace(":", "-", 2)
    offset = next(
        (
            exif[tag]
            for tag in ("OffsetTimeOriginal", "OffsetTimeDigitized", "OffsetTime")
            if tag in exif
        ),
        None,
    )
    if isinstance(offset, str):
        normalized = f"{normalized}{offset}"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def reverse_geocode_city(latitude: float, longitude: float) -> str | None:
    cache_key = (round(latitude, 5), round(longitude, 5))
    if cache_key in GEOCODE_CACHE:
        return GEOCODE_CACHE[cache_key]

    params = urllib.parse.urlencode(
        {
            "format": "jsonv2",
            "lat": f"{latitude:.7f}",
            "lon": f"{longitude:.7f}",
            "zoom": 10,
            "addressdetails": 1,
        }
    )
    url = f"https://nominatim.openstreetmap.org/reverse?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    city: str | None = None
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        address = payload.get("address", {})
        if isinstance(address, dict):
            city = next(
                (
                    address[key]
                    for key in ("city", "town", "village", "hamlet", "municipality")
                    if isinstance(address.get(key), str) and address.get(key)
                ),
                None,
            )
    except Exception:
        city = None

    GEOCODE_CACHE[cache_key] = city
    return city


def extract_metadata(path: Path, *, lookup_location: bool) -> dict[str, Any]:
    with Image.open(path) as image:
        raw_exif = image.getexif()
        exif = {TAGS.get(tag, tag): value for tag, value in raw_exif.items()}
        gps_ifd = {
            GPS.get(tag, tag): value
            for tag, value in raw_exif.get_ifd(ExifTags.IFD.GPSInfo).items()
        }

    metadata: dict[str, Any] = {}
    latitude = decimal_degrees(gps_ifd.get("GPSLatitude"), gps_ifd.get("GPSLatitudeRef"))
    longitude = decimal_degrees(gps_ifd.get("GPSLongitude"), gps_ifd.get("GPSLongitudeRef"))
    timestamp = parse_timestamp(exif)

    if latitude is not None:
        metadata["latitude"] = round(latitude, 7)
    if longitude is not None:
        metadata["longitude"] = round(longitude, 7)
    if timestamp:
        metadata["timestamp"] = timestamp
    if lookup_location and latitude is not None and longitude is not None:
        city = reverse_geocode_city(latitude, longitude)
        metadata["location_looked_up"] = True
        if city:
            metadata["location_name"] = city

    return metadata


def date_in_range(date: str, travel: dict[str, Any]) -> bool:
    return travel.get("start_date", "") <= date <= travel.get("end_date", "")


def sync_metadata(overwrite: bool) -> tuple[int, int]:
    data = json.loads(TRAVELS_JSON.read_text())
    travels = data.get("travels", [])
    photos_by_path = {
        photo.get("path"): photo
        for travel in travels
        for photo in travel.get("photos", [])
        if isinstance(photo, dict)
    }

    updated = 0
    added = 0
    for photo_path in sorted(PHOTOS_DIR.glob("*.png")):
        relative_path = photo_path.relative_to(ROOT).as_posix()
        photo = photos_by_path.get(relative_path)
        needs_location_lookup = overwrite or not (
            isinstance(photo, dict)
            and photo.get("location_looked_up") is True
        )
        metadata = extract_metadata(photo_path, lookup_location=needs_location_lookup)
        if not metadata:
            continue

        if photo is None:
            photo = {"path": relative_path, "caption": ""}
            timestamp = metadata.get("timestamp", "")
            photo_date = timestamp[:10]
            destination = next(
                (travel for travel in travels if photo_date and date_in_range(photo_date, travel)),
                travels[0] if travels else None,
            )
            if destination is None:
                continue
            destination.setdefault("photos", []).append(photo)
            photos_by_path[relative_path] = photo
            added += 1

        changed = False
        for key, value in metadata.items():
            if overwrite or photo.get(key) in (None, ""):
                if photo.get(key) != value:
                    photo[key] = value
                    changed = True
        updated += int(changed)

    TRAVELS_JSON.write_text(json.dumps(data, indent=2) + "\n")
    return added, updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing latitude, longitude, timestamp, and location_name values.",
    )
    args = parser.parse_args()

    added, updated = sync_metadata(overwrite=args.overwrite)
    print(f"Added {added} photo entries; updated metadata on {updated} entries.")


if __name__ == "__main__":
    main()
