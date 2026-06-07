#!/usr/bin/env python3
"""Convert Garmin FIT files into GPX with optional waypoint simplification.

This script reads FIT record messages using garmin_fit_sdk and writes a valid
GPX file. It preserves timestamps, GPS track points, and altitude where present.
Optional Douglas-Peucker simplification can reduce waypoint count.
"""
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

from garmin_fit_sdk import Decoder, Stream
import json

EARTH_RADIUS_M = 6_371_000.0


@dataclass
class TrackPoint:
    timestamp: datetime
    latitude: float
    longitude: float
    elevation: float | None
    distance: float | None


def semicircles_to_degrees(value: float | int) -> float:
    return float(value) * 180.0 / (2**31)


def format_time(timestamp: datetime) -> str:
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def load_fit_messages(fit_path: Path) -> dict[str, list[dict[str, object]]]:
    stream = Stream.from_file(str(fit_path))
    decoder = Decoder(stream)
    messages, errors = decoder.read(
        apply_scale_and_offset=True,
        convert_datetimes_to_dates=True,
        convert_types_to_strings=True,
    )

    if errors:
        error_text = "; ".join(str(error) for error in errors)
        raise RuntimeError(f"Failed to decode FIT file {fit_path}: {error_text}")

    return messages


def parse_track_points(messages: dict[str, list[dict[str, object]]]) -> list[TrackPoint]:
    records = messages.get("record_mesgs", [])
    track_points: list[TrackPoint] = []

    for record in records:
        timestamp = record.get("timestamp")
        latitude = record.get("position_lat")
        longitude = record.get("position_long")

        if timestamp is None or latitude is None or longitude is None:
            continue

        if isinstance(latitude, int) and abs(latitude) > 1e6:
            latitude = semicircles_to_degrees(latitude)
        if isinstance(longitude, int) and abs(longitude) > 1e6:
            longitude = semicircles_to_degrees(longitude)

        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except (TypeError, ValueError):
            continue

        elevation = record.get("altitude")
        distance = record.get("distance")

        track_points.append(
            TrackPoint(
                timestamp=timestamp,
                latitude=latitude,
                longitude=longitude,
                elevation=float(elevation) if elevation is not None else None,
                distance=float(distance) if distance is not None else None,
            )
        )

    return track_points


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def point_to_segment_distance(point: TrackPoint, start: TrackPoint, end: TrackPoint) -> float:
    if start.latitude == end.latitude and start.longitude == end.longitude:
        return haversine_distance(point.latitude, point.longitude, start.latitude, start.longitude)

    mean_lat = math.radians((start.latitude + end.latitude) / 2.0)
    cos_lat = math.cos(mean_lat)

    x1 = math.radians(start.longitude) * EARTH_RADIUS_M * cos_lat
    y1 = math.radians(start.latitude) * EARTH_RADIUS_M
    x2 = math.radians(end.longitude) * EARTH_RADIUS_M * cos_lat
    y2 = math.radians(end.latitude) * EARTH_RADIUS_M
    x0 = math.radians(point.longitude) * EARTH_RADIUS_M * cos_lat
    y0 = math.radians(point.latitude) * EARTH_RADIUS_M

    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x0 - x1, y0 - y1)

    t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
    if t <= 0:
        return math.hypot(x0 - x1, y0 - y1)
    if t >= 1:
        return math.hypot(x0 - x2, y0 - y2)

    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return math.hypot(x0 - proj_x, y0 - proj_y)


def simplify_points(points: list[TrackPoint], tolerance_m: float) -> list[TrackPoint]:
    if len(points) <= 2 or tolerance_m <= 0:
        return points

    def recurse(segment: list[TrackPoint]) -> list[TrackPoint]:
        if len(segment) < 3:
            return segment

        max_distance = 0.0
        index = 0
        start = segment[0]
        end = segment[-1]

        for i in range(1, len(segment) - 1):
            distance = point_to_segment_distance(segment[i], start, end)
            if distance > max_distance:
                max_distance = distance
                index = i

        if max_distance > tolerance_m:
            left = recurse(segment[: index + 1])
            right = recurse(segment[index:])
            return left[:-1] + right

        return [start, end]

    return recurse(points)


def gpx_metadata(messages: dict[str, list[dict[str, object]]], input_path: Path) -> tuple[str | None, str | None]:
    file_id = messages.get("file_id_mesgs", [{}])[0]
    activity = messages.get("activity_mesgs", [{}])[0]
    session = messages.get("session_mesgs", [{}])[0]

    name = file_id.get("file_name") or activity.get("sport") or session.get("sport") or input_path.stem
    desc = file_id.get("product") or activity.get("event") or session.get("sport")
    return str(name), str(desc) if desc is not None else None


def format_duration(seconds: float | int | None) -> str | None:
    if seconds is None:
        return None
    total_seconds = int(round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m {secs}s"
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def format_distance(value: float | int | None) -> str | None:
    if value is None:
        return None
    meters = float(value)
    if abs(meters) >= 1000:
        return f"{meters / 1000:.2f} km"
    return f"{meters:.1f} m"


def format_value(value: float | int | None, unit: str, precision: int = 0) -> str | None:
    if value is None:
        return None
    return f"{float(value):.{precision}f} {unit}"


def read_session_metadata(messages: dict[str, list[dict[str, object]]]) -> dict[str, str]:
    session = messages.get("session_mesgs", [{}])[0]
    if not session:
        return {}

    metadata: dict[str, str | None] = {
        "Elapsed time": format_duration(session.get("total_elapsed_time")),
        "Timer time": format_duration(session.get("total_timer_time")),
        "Calories": format_value(session.get("total_calories"), "kcal"),
        "Distance": format_distance(session.get("total_distance")),
        "Ascent": format_value(session.get("total_ascent"), "m"),
        "Descent": format_value(session.get("total_descent"), "m"),
        "Strides": str(int(session["total_strides"])) if session.get("total_strides") is not None else None,
        "Cycles": str(int(session["total_cycles"])) if session.get("total_cycles") is not None else None,
    }
    return {label: value for label, value in metadata.items() if value is not None}


def extract_track_metadata(messages: dict[str, list[dict[str, object]]], track_points: list[TrackPoint]) -> dict[str, object]:
    session = messages.get("session_mesgs", [{}])[0]
    activity = messages.get("activity_mesgs", [{}])[0]

    def maybe_float(value: float | int | None) -> float | None:
        return float(value) if value is not None else None

    def maybe_int(value: float | int | None) -> int | None:
        return int(round(value)) if value is not None else None

    total_distance = maybe_float(session.get("total_distance"))
    if total_distance is None:
        last_distance = next((pt.distance for pt in reversed(track_points) if pt.distance is not None), None)
        total_distance = maybe_float(last_distance)

    elapsed_seconds = maybe_float(session.get("total_elapsed_time"))
    timer_seconds = maybe_float(session.get("total_timer_time"))
    duration_seconds = timer_seconds if timer_seconds is not None else elapsed_seconds
    if duration_seconds is None:
        duration_seconds = (track_points[-1].timestamp - track_points[0].timestamp).total_seconds()

    total_ascent = maybe_float(session.get("total_ascent"))
    total_descent = maybe_float(session.get("total_descent"))
    calories = maybe_int(session.get("total_calories"))
    max_speed = maybe_float(session.get("max_speed"))

    metadata: dict[str, object] = {
        "date": track_points[0].timestamp.date().isoformat(),
        "start_time": format_time(track_points[0].timestamp),
        "end_time": format_time(track_points[-1].timestamp),
    }

    if total_distance is not None:
        metadata["distance_m"] = total_distance
        metadata["distance"] = format_distance(total_distance)
    if duration_seconds is not None:
        metadata["duration_s"] = maybe_int(duration_seconds)
        metadata["duration"] = format_duration(duration_seconds)
    if elapsed_seconds is not None:
        metadata["elapsed_s"] = maybe_int(elapsed_seconds)
    if total_ascent is not None:
        metadata["total_ascent_m"] = total_ascent
    if total_descent is not None:
        metadata["total_descent_m"] = total_descent
    if calories is not None:
        metadata["calories"] = calories
    if max_speed is not None:
        metadata["max_speed_m_s"] = max_speed

    return metadata


def build_gpx(track_points: list[TrackPoint], name: str | None, desc: str | None) -> ET.Element:
    gpx_attrib = {
        "version": "1.1",
        "creator": "my-itinerary convert_fit_to_gpx",
        "xmlns": "http://www.topografix.com/GPX/1/1",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xsi:schemaLocation": "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd",
    }
    root = ET.Element("gpx", gpx_attrib)

    metadata = ET.SubElement(root, "metadata")
    if name:
        ET.SubElement(metadata, "name").text = name
    if desc:
        ET.SubElement(metadata, "desc").text = desc
    if track_points:
        ET.SubElement(metadata, "time").text = format_time(track_points[0].timestamp)

    trk = ET.SubElement(root, "trk")
    if name:
        ET.SubElement(trk, "name").text = name
    trkseg = ET.SubElement(trk, "trkseg")

    for point in track_points:
        attrs = {"lat": f"{point.latitude:.8f}", "lon": f"{point.longitude:.8f}"}
        trkpt = ET.SubElement(trkseg, "trkpt", attrs)
        if point.elevation is not None:
            ET.SubElement(trkpt, "ele").text = f"{point.elevation:.1f}"
        ET.SubElement(trkpt, "time").text = format_time(point.timestamp)

    return root


def write_gpx(root: ET.Element, output_path: Path) -> None:
    ET.indent(root, space="  ")
    tree = ET.ElementTree(root)
    tree.write(output_path, encoding="utf-8", xml_declaration=True)


def collect_fit_files(input_path: Path) -> list[Path]:
    if input_path.is_dir():
        return sorted(p for p in input_path.iterdir() if p.suffix.lower() == ".fit")
    return [input_path]


def resolve_output_path(fit_path: Path, output_path: Path | None, multiple: bool) -> Path:
    if output_path is None:
        return fit_path.with_suffix(".gpx")

    if output_path.exists() and output_path.is_dir():
        return output_path / fit_path.with_suffix(".gpx").name

    if multiple:
        if output_path.suffix.lower() == ".gpx":
            raise ValueError("Cannot write multiple GPX files to a single output file")
        output_path.mkdir(parents=True, exist_ok=True)
        return output_path / fit_path.with_suffix(".gpx").name

    if output_path.suffix.lower() != ".gpx":
        output_path.mkdir(parents=True, exist_ok=True)
        return output_path / fit_path.with_suffix(".gpx").name

    return output_path


def update_travel_tracks(json_path: Path, entries: list[dict[str, object]], travel_slug: str | None = None) -> None:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "travels" not in data:
        raise RuntimeError(f"Invalid travels JSON file: {json_path}")

    travels = data["travels"]
    if not isinstance(travels, list) or not travels:
        raise RuntimeError(f"Invalid travels JSON file: {json_path}")

    if travel_slug is None:
        travel = travels[0]
    else:
        travel = next((item for item in travels if item.get("slug") == travel_slug), None)
        if travel is None:
            raise RuntimeError(f"Travel with slug '{travel_slug}' not found in {json_path}")

    travel["tracks"] = entries
    json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Garmin FIT files to GPX with optional waypoint simplification."
    )
    parser.add_argument(
        "fit_path",
        nargs="?",
        type=Path,
        default=Path("tracks"),
        help="Input .fit file or directory containing FIT files (default: tracks)",
    )
    parser.add_argument("-o", "--output", type=Path, help="Output GPX file path or directory")
    parser.add_argument(
        "--output-json",
        type=Path,
        default=Path("travels/travels.json"),
        help="Travel JSON file to update with track entries",
    )
    parser.add_argument(
        "--travel-slug",
        type=str,
        help="Slug of the travel entry to update in the JSON file",
    )
    parser.add_argument(
        "--simplify",
        action="store_true",
        help="Reduce track point count with Douglas-Peucker simplification",
    )
    parser.add_argument(
        "--tolerance",
        type=float,
        default=10.0,
        help="Simplification tolerance in meters (default: 10.0)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing output file",
    )
    parser.add_argument("--verbose", action="store_true", help="Print progress messages")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    fit_path = args.fit_path

    if not fit_path.exists():
        print(f"Error: input path not found: {fit_path}")
        return 2

    fit_files = collect_fit_files(fit_path)
    if not fit_files:
        print(f"Error: no .fit files found in {fit_path}")
        return 3

    output_tracks: list[dict[str, object]] = []
    multiple_outputs = len(fit_files) > 1

    if args.verbose:
        print(f"Found {len(fit_files)} FIT file(s) in {fit_path}")

    for file_index, current_fit in enumerate(fit_files, start=1):
        if args.verbose:
            print(f"Processing ({file_index}/{len(fit_files)}): {current_fit}")

        if current_fit.suffix.lower() != ".fit":
            if args.verbose:
                print(f"Skipping non-FIT file: {current_fit}")
            continue

        output_path = resolve_output_path(current_fit, args.output, multiple_outputs)
        if output_path.exists() and not args.overwrite:
            print(f"Error: output file already exists: {output_path}")
            print("Use --overwrite to replace it.")
            return 4

        messages = load_fit_messages(current_fit)
        track_points = parse_track_points(messages)
        if not track_points:
            print(f"Warning: no valid GPS track points found in {current_fit}, skipping")
            continue

        if args.simplify:
            if args.verbose:
                print(f"Simplifying {len(track_points)} points with tolerance {args.tolerance} m")
            track_points = simplify_points(track_points, args.tolerance)
            if args.verbose:
                print(f"Simplified to {len(track_points)} points")

        name, desc = gpx_metadata(messages, current_fit)
        root = build_gpx(track_points, name, desc)
        write_gpx(root, output_path)

        relative_path = output_path
        try:
            relative_path = output_path.relative_to(Path.cwd())
        except ValueError:
            pass

        entry_metadata = extract_track_metadata(messages, track_points)
        entry_metadata["path"] = relative_path.as_posix()
        output_tracks.append(entry_metadata)

        if args.verbose:
            print(f"Wrote GPX file: {output_path}")
        else:
            print(f"Converted {current_fit.name} → {output_path.name}")

    if not output_tracks:
        print("Error: no tracks were converted")
        return 5

    output_tracks.sort(key=lambda item: (item["date"], item["path"]))
    update_travel_tracks(args.output_json, output_tracks, travel_slug=args.travel_slug)

    if args.verbose:
        print(f"Updated travel tracks in {args.output_json}")
    else:
        print(f"Updated {args.output_json} with {len(output_tracks)} track entries")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
