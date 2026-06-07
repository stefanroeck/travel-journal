#!/usr/bin/env python3
"""Generate photo thumbnails for faster preview loading.

Creates a thumbnail (max 300px width) for each photo and stores it
in photos/thumbnails/. Updates travels.json with thumbnail paths.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
TRAVELS_JSON = ROOT / "travels" / "travels.json"
PHOTOS_DIR = ROOT / "photos"
THUMBNAILS_DIR = PHOTOS_DIR / "thumbnails"

# Thumbnail size and JPEG quality
THUMB_MAX_WIDTH = 500
THUMB_QUALITY = 80


def generate_thumbnails(photo_path: Path, thumb_dir: Path) -> dict[str, str | None]:
    """Generate a thumbnail for a photo.
    
    Args:
        photo_path: Path to the original photo
        thumb_dir: Directory to store thumbnails
        
    Returns:
        Dict with 'thumbnail' key containing the relative path or None on error
    """
    if not photo_path.exists():
        print(f"  ⚠️  File not found: {photo_path}")
        return {"thumbnail": None}
    
    try:
        with Image.open(photo_path) as img:
            # Convert images to RGB for JPEG output
            if img.mode != "RGB":
                img = img.convert("RGB")
            
            stem = photo_path.stem
            
            thumb_img = img.copy()
            thumb_img.thumbnail((THUMB_MAX_WIDTH, THUMB_MAX_WIDTH), Image.Resampling.LANCZOS)
            thumb_path = thumb_dir / f"{stem}.jpg"
            thumb_img.save(
                thumb_path,
                "JPEG",
                quality=THUMB_QUALITY,
                optimize=True,
                progressive=True,
            )
            thumb_relative = f"photos/thumbnails/{thumb_path.name}"
            
            original_size = photo_path.stat().st_size / (1024 * 1024)
            thumb_size = thumb_path.stat().st_size / 1024
            
            print(f"  ✓ {photo_path.name}")
            print(f"    Original: {original_size:.1f} MB → Thumb: {thumb_size:.0f} KB")
            
            return {"thumbnail": thumb_relative}
    except Exception as e:
        print(f"  ✗ Error processing {photo_path.name}: {e}")
        return {"thumbnail": None}


def sync_thumbnails() -> None:
    """Generate thumbnails for all photos and update travels.json."""
    # Create thumbnails directory
    THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load travels data
    data = json.loads(TRAVELS_JSON.read_text())
    travels = data.get("travels", [])
    
    total_photos = sum(len(travel.get("photos", [])) for travel in travels)
    print(f"Processing {total_photos} photos...")
    
    updated = 0
    for travel in travels:
        for photo in travel.get("photos", []):
            if not isinstance(photo, dict) or "path" not in photo:
                continue
            
            photo_path = ROOT / photo["path"]
            thumbs = generate_thumbnails(photo_path, THUMBNAILS_DIR)
            
            if thumbs["thumbnail"]:
                photo["thumbnail"] = thumbs["thumbnail"]
                updated += 1
    
    # Save updated travels.json with UTF-8 encoding
    TRAVELS_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n✓ Generated thumbnails for {updated} photos")
    print(f"✓ Updated {TRAVELS_JSON.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate photo thumbnails for faster preview loading."
    )
    parser.parse_args()
    sync_thumbnails()


if __name__ == "__main__":
    main()
