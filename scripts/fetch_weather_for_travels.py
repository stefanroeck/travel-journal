#!/usr/bin/env python3
"""Fetch daily weather for each track date in travels/travels.json.

Uses Open-Meteo (no API key) and the fixed location Maó, Menorca.
Stores results under each track as a `weather` object with
`min_temp_c`, `max_temp_c`, `condition`, and `weathercode`.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict

from urllib import parse, request


TRAVELS_PATH = Path(__file__).resolve().parents[1] / "travels" / "travels.json"

# Maó (Mahón), Menorca
LATITUDE = 39.8889
LONGITUDE = 4.2653
TIMEZONE = "Europe/Madrid"


WEATHER_CODE_MAP: Dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


def fetch_daily_weather(date: str) -> dict | None:
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": date,
        "end_date": date,
        "daily": ",".join(["temperature_2m_max", "temperature_2m_min", "weathercode"]),
        "timezone": TIMEZONE,
    }
    url = "https://api.open-meteo.com/v1/forecast?" + parse.urlencode(params)

    try:
        with request.urlopen(url, timeout=20) as r:
            if r.status != 200:
                print(f"Failed to fetch {date}: HTTP {r.status}")
                return None
            data = json.load(r)
    except Exception as e:
        print(f"Error fetching weather for {date}: {e}")
        return None

    daily = data.get("daily", {})
    temps_min = daily.get("temperature_2m_min", [])
    temps_max = daily.get("temperature_2m_max", [])
    codes = daily.get("weathercode", [])

    if not temps_min or not temps_max or not codes:
        print(f"Weather data missing for {date}")
        return None

    code = int(codes[0])
    return {
        "min_temp_c": round(float(temps_min[0]), 1),
        "max_temp_c": round(float(temps_max[0]), 1),
        "weathercode": code,
        "condition": WEATHER_CODE_MAP.get(code, "Unknown"),
    }


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]

    if not TRAVELS_PATH.exists():
        print(f"travels.json not found at {TRAVELS_PATH}")
        return 2

    with TRAVELS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # cache per date to avoid repeated requests
    cache: Dict[str, dict] = {}
    updated = False

    for travel in data.get("travels", []):
        for track in travel.get("tracks", []):
            date = track.get("date")
            if not date:
                continue

            # reuse cached result if available
            if date in cache:
                track["weather"] = cache[date]
                continue

            print(f"Fetching weather for {date}...")
            res = fetch_daily_weather(date)
            if res is None:
                print(f"  -> no data for {date}")
                continue

            track["weather"] = res
            cache[date] = res
            updated = True

    if updated:
        # overwrite travels.json
        with TRAVELS_PATH.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Updated {TRAVELS_PATH}")
    else:
        print("No updates made.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
