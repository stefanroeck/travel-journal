# My itinerary

App to browse tracks and photos from my travels.

## Development

### Static web page

Start a local web server from the project root:

```sh
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/html/
```

Serve the page from the project root, not from `html/`, so the browser can load
`travels/travels.json`, GPX tracks, notes, and photos through the relative paths
used by the static page.

Stop the server with `Ctrl-C` in the terminal where it is running.

This project includes a small Python utility for keeping photo GPS metadata in
`travels/travels.json`.

### Python setup

Create and activate a virtual environment:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

This installs Pillow, which the metadata script uses to read photo EXIF data.

### Update photo metadata

Extract GPS coordinates and timestamps from PNG files in `photos/` and sync them
into `travels/travels.json`:

```sh
python scripts/update_photo_metadata.py
```

The script adds missing photo entries to the matching travel date range and keeps
existing manually edited metadata by default. To refresh existing values from the
photo files, run:

```sh
python scripts/update_photo_metadata.py --overwrite
```
