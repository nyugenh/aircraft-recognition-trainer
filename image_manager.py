"""Aircraft image manager.

One local tool for curating the trainer's photos. It serves a review page where
you can delete, blur and undo images, and fetch replacements from Openverse.
Fetched candidates are detected and cropped with YOLO, compressed, and checked
against the folder's existing images for near-duplicates before being kept.

Run:  python image_manager.py
"""

from __future__ import annotations

import hashlib
import io
import json
import random
import re
import shutil
import threading
import time
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np
import requests
from flask import Flask, jsonify, request, send_file
from PIL import Image, ImageFilter, ImageOps

if TYPE_CHECKING:
    from ultralytics import YOLO

# ============================================================
# CONFIGURATION
# ============================================================

# --- Paths and web app ---------------------------------------

BASE_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = BASE_DIR / "manifest.json"
PAGE_PATH = BASE_DIR / "image_manager.html"
OPENVERSE_EXHAUSTED_PATH = BASE_DIR / ".openverse_exhausted.json"
OPENVERSE_PAGES_PATH = BASE_DIR / ".openverse_pages.json"
BLURRED_PATH = BASE_DIR / ".blurred_images.json"

# Deleted and pre-blur images are kept here so recent actions can be undone.
TRASH_DIR = BASE_DIR / ".deleted_images"
BLUR_BACKUP_DIR = BASE_DIR / ".blur_backups"

APP_HOST = "127.0.0.1"
APP_PORT = 5000
IMAGES_PER_BATCH = 4
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# --- Fetching ------------------------------------------------

IMAGES_PER_AIRCRAFT = 20
MODEL_NAME = "yolo11x.pt"
AIRPLANE_CLASS_ID = 4  # COCO class id for "airplane"

OPENVERSE_API_URL = "https://api.openverse.org/v1/images/"
OPENVERSE_PAGE_SIZE = 20
EXCLUDED_OPENVERSE_SOURCE = "wikimedia"
MAX_CANDIDATES_PER_AIRCRAFT = 1000

# Openverse is rate limited, so searches are spaced out and retried with backoff.
OPENVERSE_REQUEST_DELAY = 1.0
OPENVERSE_MAX_RETRIES = 5
OPENVERSE_BACKOFF_BASE = 5.0

# --- Detection and cropping ----------------------------------

CONFIDENCE = 0.50  # initial aircraft detection
PADDING = 0.05  # crop padding around the detected aircraft
FINAL_CONFIDENCE = 0.45  # re-detection on the cropped image

# Checked straight after the crop. The wanted view is a broad side-on profile,
# so reasonably landscape images are preferred.
MIN_IMAGE_ASPECT_RATIO = 1.80
MAX_IMAGE_ASPECT_RATIO = 4.50

# 800 px wide stays sharp at the largest size the trainer displays;
# 250 px tall allows very wide crops.
MIN_FINAL_IMAGE_WIDTH = 800
MIN_FINAL_IMAGE_HEIGHT = 250

# --- Compression ---------------------------------------------

MAX_DIMENSION = 1600
MAX_FILE_SIZE = 500 * 1024
START_QUALITY = 84
MIN_QUALITY = 60
RESIZE_FACTOR = 0.90

# --- Aircraft-only duplicate comparison ----------------------

AIRCRAFT_CANVAS_SIZE = 256
AIRCRAFT_INNER_MARGIN = 0.08

# Pixel similarity
AIRCRAFT_PIXEL_MAE_STRICT = 0.035
AIRCRAFT_PIXEL_CORRELATION_STRICT = 0.970
AIRCRAFT_PIXEL_MAE_VERY_STRICT = 0.022
AIRCRAFT_PIXEL_CORRELATION_VERY_STRICT = 0.985

# Perceptual hash distances
AIRCRAFT_PHASH_STRICT = 9
AIRCRAFT_PHASH_VERY_STRICT = 6
AIRCRAFT_DHASH_STRICT = 9
AIRCRAFT_DHASH_VERY_STRICT = 6
AIRCRAFT_AHASH_STRICT = 9

# Shape / silhouette
AIRCRAFT_EDGE_STRICT = 0.86
AIRCRAFT_EDGE_VERY_STRICT = 0.93
AIRCRAFT_SHAPE_STRICT = 0.88
AIRCRAFT_SHAPE_VERY_STRICT = 0.94

# Structural similarity
AIRCRAFT_STRUCTURE_STRICT = 0.90
AIRCRAFT_STRUCTURE_VERY_STRICT = 0.95
AIRCRAFT_STRUCTURE_EXTREME = 0.975

# Geometry
MAX_AIRCRAFT_ASPECT_RATIO_DIFFERENCE = 0.08
MAX_AIRCRAFT_AREA_RATIO_DIFFERENCE = 0.20
MAX_AIRCRAFT_CENTER_DISTANCE = 0.12

# Number of agreeing signals needed to reject an image as a duplicate
MULTI_SIGNAL_THRESHOLD = 3
EXTREME_MULTI_SIGNAL_THRESHOLD = 2

# ============================================================
# SHARED STATE
# ============================================================

app = Flask(__name__)

MANIFEST_LOCK = threading.Lock()
OPENVERSE_LOCK = threading.Lock()
OPENVERSE_MODEL: YOLO | None = None

# Undo stacks hold the most recent action last. They live in memory, so undo
# only covers the current session.
UNDO_STACK: list[dict[str, Any]] = []
BLUR_UNDO_STACK: list[dict[str, Any]] = []
AIRCRAFT_CACHE: dict[str, dict[str, Any]] = {}


def get_model() -> YOLO:
    """Load the YOLO model on first use (it is slow to import and load)."""

    global OPENVERSE_MODEL

    if OPENVERSE_MODEL is None:
        from ultralytics import YOLO

        OPENVERSE_MODEL = YOLO(MODEL_NAME)

    return OPENVERSE_MODEL


# ============================================================
# HTTP SESSION
# ============================================================

SESSION = requests.Session()
SESSION.headers.update(
    {"User-Agent": "AircraftRecognitionDataset/1.0 (open aircraft recognition dataset)"}
)


# ============================================================
# OPENVERSE STATE FILES
# ============================================================


def write_json_atomic(path: Path, data: Any, **dump_kwargs: Any) -> None:
    """Write JSON through a temp file so a crash cannot leave a partial file."""

    temp_path = path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, **dump_kwargs)
        f.write("\n")
    temp_path.replace(path)


def load_openverse_exhausted() -> set[str]:
    if not OPENVERSE_EXHAUSTED_PATH.exists():
        return set()

    try:
        with OPENVERSE_EXHAUSTED_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return set(data) if isinstance(data, list) else set()
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Warning: could not read Openverse exhausted list: {e}")
        return set()


def record_openverse_exhausted(folder_name: str) -> None:
    exhausted = load_openverse_exhausted()
    exhausted.add(folder_name)
    write_json_atomic(OPENVERSE_EXHAUSTED_PATH, sorted(exhausted))


def clear_openverse_exhausted(folder_name: str) -> None:
    exhausted = load_openverse_exhausted()
    exhausted.discard(folder_name)
    write_json_atomic(OPENVERSE_EXHAUSTED_PATH, sorted(exhausted))


def load_openverse_pages() -> dict[str, Any]:
    """Return the per-folder search cursor cache (empty if missing or invalid)."""

    if not OPENVERSE_PAGES_PATH.exists():
        return {}

    try:
        with OPENVERSE_PAGES_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"  Warning: could not read Openverse page cache: {e}")
        return {}

    if not isinstance(data, dict):
        print("  Warning: Openverse page cache must contain a JSON object.")
        return {}

    return data


def is_count(value: Any, minimum: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def load_openverse_cursor(folder_name: str, query: str) -> tuple[int, int]:
    """Return the (page, result index) to resume the Openverse search from."""

    entry = load_openverse_pages().get(folder_name)

    if entry is None:
        return 1, 0

    if not isinstance(entry, dict):
        print(f"  Warning: invalid Openverse page cache entry for {folder_name}.")
        return 1, 0

    if entry.get("query") != query:
        return 1, 0

    page = entry.get("next_page")
    if not is_count(page, 1):
        print(f"  Warning: invalid Openverse next page for {folder_name}.")
        return 1, 0

    if "next_index" not in entry:
        if page > 1:
            print(
                f"  Rechecking Openverse pages from page 1 for {folder_name} "
                "to recover results skipped by the older page-only cursor."
            )
        return 1, 0

    next_index = entry["next_index"]
    if not is_count(next_index, 0):
        print(f"  Warning: invalid Openverse result index for {folder_name}.")
        return page, 0

    return page, next_index


def record_openverse_next_page(
    folder_name: str, query: str, next_page: int, next_index: int = 0
) -> None:
    pages = load_openverse_pages()
    pages[folder_name] = {
        "query": query,
        "next_page": next_page,
        "next_index": next_index,
    }
    write_json_atomic(OPENVERSE_PAGES_PATH, pages)


def load_blurred() -> dict[str, int]:
    """Return blur counts keyed by "aircraft_key/filename"."""

    try:
        with BLURRED_PATH.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {}

    if not isinstance(data, dict):
        return {}

    return {
        str(key): int(value)
        for key, value in data.items()
        if isinstance(value, int) and value > 0
    }


def adjust_blurred(aircraft_key: str, filename: str, delta: int) -> int:
    """Change a file's blur count (call while holding MANIFEST_LOCK)."""

    blurred = load_blurred()
    key = f"{aircraft_key}/{filename}"
    count = max(0, blurred.get(key, 0) + delta)

    if count:
        blurred[key] = count
    else:
        blurred.pop(key, None)

    write_json_atomic(BLURRED_PATH, blurred)
    return count


# ============================================================
# MANIFEST
# ============================================================


def load_manifest() -> dict[str, Any]:
    """Load and validate manifest.json."""

    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Could not find manifest.json here:\n{MANIFEST_PATH}")

    try:
        with MANIFEST_PATH.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except json.JSONDecodeError as exc:
        raise ValueError(f"manifest.json contains invalid JSON:\n{exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("manifest.json must contain a JSON object.")

    if not isinstance(data.get("aircraft"), list):
        raise ValueError('manifest.json must contain an "aircraft" array.')

    return data


def save_manifest(data: dict[str, Any]) -> None:
    """Atomically replace manifest.json."""

    write_json_atomic(MANIFEST_PATH, data, ensure_ascii=False)


# ============================================================
# AIRCRAFT LOOKUP AND PATH SAFETY
# ============================================================


def get_aircraft_by_key(
    data: dict[str, Any], aircraft_key: str
) -> dict[str, Any] | None:
    return next(
        (item for item in data["aircraft"] if item.get("key") == aircraft_key), None
    )


def get_aircraft_folder(item: dict[str, Any]) -> Path:
    folder = item.get("folder")

    if not folder:
        raise ValueError(f'Aircraft "{item.get("key", "?")}" has no folder.')

    folder_path = Path(str(folder))

    if folder_path.is_absolute():
        raise ValueError(f'Absolute folder path is not allowed: "{folder}".')

    root = BASE_DIR.resolve()
    resolved = (BASE_DIR / folder_path).resolve()

    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(
            f'Aircraft folder escapes application directory: "{folder}".'
        ) from exc

    return resolved


def get_image_path(item: dict[str, Any], filename: str) -> Path:
    folder = get_aircraft_folder(item)
    filename_path = Path(filename)

    if filename_path.is_absolute():
        raise ValueError(f'Invalid image filename: "{filename}".')

    image_path = (folder / filename_path).resolve()

    try:
        image_path.relative_to(folder)
    except ValueError as exc:
        raise ValueError(f'Invalid image filename: "{filename}".') from exc

    return image_path


def is_image_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS


# ============================================================
# BUILD AIRCRAFT GROUPS
# ============================================================


def describe_aircraft(item: dict[str, Any]) -> dict[str, Any]:
    """The aircraft fields the review page needs, shared by every API response."""

    return {
        "aircraft_key": item.get("key", ""),
        "label": item.get("label", item.get("folder", "")),
        "folder": item.get("folder", ""),
        "icao": item.get("icao", ""),
        "category": item.get("category", ""),
    }


def build_image_pool() -> list[dict[str, Any]]:
    """
    Return one group per aircraft folder.

    Images are grouped by aircraft and shuffled within each group.
    The frontend shuffles the order of the groups separately.
    """

    data = load_manifest()
    groups: list[dict[str, Any]] = []

    for item in data["aircraft"]:
        aircraft_key = item.get("key", "")

        if not aircraft_key:
            continue

        try:
            folder_path = get_aircraft_folder(item)

            if not folder_path.is_dir():
                continue

            image_files = sorted(
                (path for path in folder_path.iterdir() if is_image_file(path)),
                key=lambda path: (
                    0 if path.stem.isdigit() else 1,
                    int(path.stem) if path.stem.isdigit() else 0,
                    path.name.casefold(),
                ),
            )

        except (OSError, ValueError):
            continue

        if not image_files:
            continue

        summary = describe_aircraft(item)
        images = [{**summary, "filename": path.name} for path in image_files]
        groups.append({**summary, "image_count": len(image_files), "images": images})

    random.shuffle(groups)
    return groups


# ============================================================
# USED OPENVERSE IMAGES
# ============================================================


def used_images_path(output_dir: Path) -> Path:
    return output_dir / ".used_images.json"


def load_used_images(output_dir: Path) -> set[str]:
    path = used_images_path(output_dir)

    if not path.exists():
        return set()

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, list):
            return {str(x) for x in data}

        if isinstance(data, dict):
            return {str(x) for x in data.get("image_ids", [])}

    except Exception as e:
        print(f"  Warning: could not read {path.name}: {e}")

    return set()


def save_used_images(output_dir: Path, used_images: set[str]) -> None:
    write_json_atomic(
        used_images_path(output_dir), sorted(used_images), ensure_ascii=False
    )


# ============================================================
# SOURCE / LICENCE PROVENANCE
# ============================================================


def sources_path(output_dir: Path) -> Path:
    return output_dir / ".sources.json"


def load_sources(output_dir: Path) -> dict:
    path = sources_path(output_dir)

    if not path.exists():
        return {}

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, dict):
            return data

    except Exception as e:
        print(f"  Warning: could not read {path.name}: {e}")

    return {}


def save_sources(output_dir: Path, sources: dict) -> None:
    write_json_atomic(sources_path(output_dir), sources, ensure_ascii=False)


# ============================================================
# EXISTING IMAGES
# ============================================================


def get_existing_images(output_dir: Path) -> list[Path]:
    images = []

    if not output_dir.exists():
        return images

    for path in output_dir.glob("*.jpg"):
        if re.fullmatch(r"\d+\.jpg", path.name, re.IGNORECASE):
            images.append(path)

    return sorted(images, key=lambda p: int(p.stem))


def count_existing_images(output_dir: Path) -> int:
    if not output_dir.is_dir():
        return 0

    return sum(
        1
        for path in output_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def get_next_filename_number(output_dir: Path) -> int:
    images = get_existing_images(output_dir)

    existing_numbers = [int(path.stem) for path in images]
    existing_numbers.extend(
        int(Path(filename).stem)
        for filename in load_sources(output_dir)
        if re.fullmatch(r"\d+\.jpg", filename, re.IGNORECASE)
    )

    return max(existing_numbers, default=-1) + 1


# ============================================================
# OPENVERSE SEARCH
# ============================================================


def search_openverse(
    query: str, page: int, page_size: int, folder_name: str
) -> list[dict] | None:
    params = {
        "q": query,
        "page": page,
        "page_size": page_size,
        "excluded_source": EXCLUDED_OPENVERSE_SOURCE,
    }

    for attempt in range(OPENVERSE_MAX_RETRIES):
        try:
            if OPENVERSE_REQUEST_DELAY > 0:
                time.sleep(OPENVERSE_REQUEST_DELAY)

            response = SESSION.get(OPENVERSE_API_URL, params=params, timeout=(10, 90))

            if response.status_code == 401:
                record_openverse_exhausted(folder_name)
                print(
                    f"  Openverse returned HTTP 401. Recorded {folder_name} in "
                    f"{OPENVERSE_EXHAUSTED_PATH.name}."
                )
                print("  Skipping this aircraft and moving to the next aircraft...")
                return None

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")

                if retry_after:
                    try:
                        wait = float(retry_after)
                    except ValueError:
                        wait = OPENVERSE_BACKOFF_BASE * (2**attempt)
                else:
                    wait = OPENVERSE_BACKOFF_BASE * (2**attempt)

                print(f"  Openverse rate limit reached. Waiting {wait:.1f}s...")
                time.sleep(wait)
                continue

            response.raise_for_status()
            data = response.json()

            results = []
            for result in data.get("results", []):
                image_id = result.get("id")
                if not image_id:
                    continue

                results.append(
                    {
                        "index": len(results),
                        "id": str(image_id),
                        "title": result.get("title") or "Untitled",
                        "url": result.get("url"),
                        "thumbnail": result.get("thumbnail"),
                        "foreign_landing_url": result.get("foreign_landing_url"),
                        "creator": result.get("creator"),
                        "creator_url": result.get("creator_url"),
                        "license": result.get("license"),
                        "license_version": result.get("license_version"),
                        "license_url": result.get("license_url"),
                        "source": result.get("source"),
                        "provider": result.get("provider"),
                        "width": result.get("width"),
                        "height": result.get("height"),
                        "attribution": result.get("attribution"),
                    }
                )

            return results

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            wait = OPENVERSE_BACKOFF_BASE * (2**attempt)
            print(
                f"  Openverse request failed ({attempt + 1}/"
                f"{OPENVERSE_MAX_RETRIES}): {e}"
            )
            if attempt + 1 < OPENVERSE_MAX_RETRIES:
                print(f"  Retrying in {wait:.1f}s...")
                time.sleep(wait)
                continue
            print("  Skipping this aircraft and moving to the next aircraft...")
            return None

        except Exception as e:
            print(f"  Openverse request failed: {e}")
            print("  Skipping this aircraft and moving to the next aircraft...")
            return None

    return []


# ============================================================
# DOWNLOAD
# ============================================================


def download_image(url: str, output_path: Path) -> bool:
    try:
        response = SESSION.get(
            url,
            headers={
                "Accept": (
                    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
                )
            },
            timeout=45,
            stream=True,
        )

        response.raise_for_status()

        content = response.content

        if not content:
            raise ValueError("Empty response")

        image = Image.open(io.BytesIO(content))

        image = ImageOps.exif_transpose(image)

        image = image.convert("RGB")

        image.save(output_path, "JPEG", quality=95)

        return True

    except Exception as e:
        print(f"    Download failed: {e}")

        output_path.unlink(missing_ok=True)

        return False


# ============================================================
# YOLO AIRCRAFT BOX
# ============================================================


def detect_aircraft(image_path: Path, model: YOLO, confidence: float) -> list[dict]:
    results = model.predict(source=str(image_path), conf=confidence, verbose=False)

    image = Image.open(image_path)

    image = ImageOps.exif_transpose(image).convert("RGB")

    width, height = image.size

    detections = []

    for result in results:
        if result.boxes is None:
            continue

        for box in result.boxes:
            class_id = int(box.cls[0].item())

            if class_id != AIRPLANE_CLASS_ID:
                continue

            conf = float(box.conf[0].item())

            if conf < confidence:
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()

            x1 = max(0, min(width, x1))

            y1 = max(0, min(height, y1))

            x2 = max(0, min(width, x2))

            y2 = max(0, min(height, y2))

            box_width = x2 - x1

            box_height = y2 - y1

            if box_width <= 0 or box_height <= 0:
                continue

            area_ratio = box_width * box_height / (width * height)

            detections.append(
                {
                    "box": (x1, y1, x2, y2),
                    "confidence": conf,
                    "area_ratio": area_ratio,
                    "width": width,
                    "height": height,
                }
            )

    return detections


# ============================================================
# INITIAL CROP
# ============================================================


def crop_aircraft(image_path: Path, model: YOLO) -> bool:
    try:
        image = Image.open(image_path)

        image = ImageOps.exif_transpose(image).convert("RGB")

        width, height = image.size

        detections = detect_aircraft(image_path, model, CONFIDENCE)

        if not detections:
            print("    Rejected: no aircraft detected")

            return False

        best = max(detections, key=lambda d: d["area_ratio"])

        x1, y1, x2, y2 = best["box"]

        box_width = x2 - x1

        box_height = y2 - y1

        padding_x = box_width * PADDING

        padding_y = box_height * PADDING

        x1 = max(0, int(x1 - padding_x))

        y1 = max(0, int(y1 - padding_y))

        x2 = min(width, int(x2 + padding_x))

        y2 = min(height, int(y2 + padding_y))

        cropped = image.crop((x1, y1, x2, y2))

        temp_path = image_path.with_suffix(".crop.tmp.jpg")

        cropped.save(temp_path, "JPEG", quality=95)

        temp_path.replace(image_path)

        print(
            f"    Aircraft cropped: {best['confidence']:.2f} "
            f"confidence, {best['area_ratio']:.1%} "
            "area"
        )

        return True

    except Exception as e:
        print(f"    Aircraft crop failed: {e}")

        image_path.unlink(missing_ok=True)

        return False


# ============================================================
# FINAL IMAGE ASPECT RATIO VALIDATION
# ============================================================


def validate_final_image_aspect_ratio(image_path: Path) -> tuple[bool, dict]:
    try:
        image = Image.open(image_path)

        image = ImageOps.exif_transpose(image)

        width, height = image.size

        if width <= 0 or height <= 0:
            return (False, {"reason": ("invalid_image_dimensions")})

        if width < MIN_FINAL_IMAGE_WIDTH or height < MIN_FINAL_IMAGE_HEIGHT:
            return (
                False,
                {
                    "reason": ("final_image_resolution_too_low"),
                    "width": width,
                    "height": height,
                },
            )

        aspect_ratio = width / height

        if aspect_ratio < MIN_IMAGE_ASPECT_RATIO:
            return (
                False,
                {
                    "reason": ("final_image_too_tall"),
                    "aspect_ratio": (aspect_ratio),
                    "width": width,
                    "height": height,
                },
            )

        if aspect_ratio > MAX_IMAGE_ASPECT_RATIO:
            return (
                False,
                {
                    "reason": ("final_image_too_wide"),
                    "aspect_ratio": (aspect_ratio),
                    "width": width,
                    "height": height,
                },
            )

        return (
            True,
            {
                "reason": ("acceptable_final_image_aspect_ratio"),
                "aspect_ratio": (aspect_ratio),
                "width": width,
                "height": height,
            },
        )

    except Exception as e:
        return (False, {"reason": ("final_aspect_ratio_check_failed"), "error": str(e)})


# ============================================================
# AIRCRAFT IN-FRAME CHECK
# ============================================================


def validate_aircraft_in_frame(image_path: Path, model: YOLO) -> bool:
    """Reject only when the detected aircraft appears cut off by an image edge."""

    try:
        detections = detect_aircraft(image_path, model, FINAL_CONFIDENCE)

        if not detections:
            print("    Rejected: aircraft could not be detected for frame check")

            return False

        # Check the largest detected aircraft, which is the one the crop targets.
        detection = max(detections, key=lambda d: d["area_ratio"])

        x1, y1, x2, y2 = detection["box"]
        width = detection["width"]
        height = detection["height"]

        # Only treat boxes essentially touching the frame as potentially cut off.
        edge_x = width * 0.005
        edge_y = height * 0.005

        if (
            x1 <= edge_x
            or y1 <= edge_y
            or x2 >= width - edge_x
            or y2 >= height - edge_y
        ):
            print("    Rejected: aircraft may be cut off by image edge")
            return False

        print("    Aircraft appears fully in frame")
        return True

    except Exception as e:
        print(f"    Aircraft frame check failed: {e}")
        return False


# ============================================================
# LOAD IMAGE
# ============================================================


def load_image(image_path: Path) -> np.ndarray:
    image = Image.open(image_path)

    image = ImageOps.exif_transpose(image).convert("RGB")

    return np.asarray(image)


# ============================================================
# AIRCRAFT NORMALISATION
# ============================================================


def normalise_aircraft(
    image: np.ndarray, box: tuple[float, float, float, float]
) -> tuple[np.ndarray, np.ndarray, dict]:

    height, width = image.shape[:2]

    x1, y1, x2, y2 = box

    x1 = max(0, min(width - 1, int(round(x1))))

    y1 = max(0, min(height - 1, int(round(y1))))

    x2 = max(x1 + 1, min(width, int(round(x2))))

    y2 = max(y1 + 1, min(height, int(round(y2))))

    aircraft = image[y1:y2, x1:x2]

    aircraft_height, aircraft_width = aircraft.shape[:2]

    aspect_ratio = aircraft_width / aircraft_height

    area_ratio = aircraft_width * aircraft_height / (width * height)

    usable_size = int(AIRCRAFT_CANVAS_SIZE * (1 - 2 * AIRCRAFT_INNER_MARGIN))

    scale = min(usable_size / aircraft_width, usable_size / aircraft_height)

    new_width = max(1, int(round(aircraft_width * scale)))

    new_height = max(1, int(round(aircraft_height * scale)))

    resized = cv2.resize(
        aircraft, (new_width, new_height), interpolation=cv2.INTER_AREA
    )

    canvas = np.zeros((AIRCRAFT_CANVAS_SIZE, AIRCRAFT_CANVAS_SIZE, 3), dtype=np.uint8)

    gray_aircraft = cv2.cvtColor(resized, cv2.COLOR_RGB2GRAY)

    background_value = int(np.median(gray_aircraft))

    canvas[:] = (background_value, background_value, background_value)

    offset_x = (AIRCRAFT_CANVAS_SIZE - new_width) // 2

    offset_y = (AIRCRAFT_CANVAS_SIZE - new_height) // 2

    canvas[offset_y : offset_y + new_height, offset_x : offset_x + new_width] = resized

    gray = cv2.cvtColor(canvas, cv2.COLOR_RGB2GRAY)

    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    edges = cv2.Canny(blur, 35, 120)

    kernel = np.ones((3, 3), np.uint8)

    shape = cv2.dilate(edges, kernel, iterations=1)

    metadata = {
        "aspect_ratio": aspect_ratio,
        "area_ratio": area_ratio,
        "center_x": ((x1 + x2) / 2 / width),
        "center_y": ((y1 + y2) / 2 / height),
        "box_width_ratio": ((x2 - x1) / width),
        "box_height_ratio": ((y2 - y1) / height),
    }

    return (canvas, shape, metadata)


# ============================================================
# AIRCRAFT DETECTION + NORMALISATION
# ============================================================


def build_aircraft_representation(image_path: Path, model: YOLO) -> dict:
    image = load_image(image_path)

    detections = detect_aircraft(image_path, model, FINAL_CONFIDENCE)

    if len(detections) != 1:
        raise ValueError("Expected exactly one aircraft")

    detection = detections[0]

    aircraft_rgb, shape, geometry = normalise_aircraft(image, detection["box"])

    return {
        "aircraft_rgb": aircraft_rgb,
        "aircraft_gray": cv2.cvtColor(aircraft_rgb, cv2.COLOR_RGB2GRAY),
        "aircraft_shape": shape,
        "geometry": geometry,
    }


# ============================================================
# HASHES
# ============================================================


def phash(image: np.ndarray) -> str:
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    image = cv2.resize(image, (32, 32), interpolation=cv2.INTER_AREA)

    dct = cv2.dct(np.float32(image))

    low = dct[:8, :8]

    median = np.median(low.flatten()[1:])

    bits = low > median

    return "".join("1" if bit else "0" for bit in bits.flatten())


def dhash(image: np.ndarray) -> str:
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    image = cv2.resize(image, (9, 8), interpolation=cv2.INTER_AREA)

    differences = image[:, 1:] > image[:, :-1]

    return "".join("1" if bit else "0" for bit in differences.flatten())


def ahash(image: np.ndarray) -> str:
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    image = cv2.resize(image, (8, 8), interpolation=cv2.INTER_AREA)

    average = image.mean()

    return "".join("1" if value > average else "0" for value in image.flatten())


def hamming(a: str, b: str) -> int:
    return sum(x != y for x, y in zip(a, b))


# ============================================================
# PIXEL COMPARISON
# ============================================================


def normalise_pixels(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    gray = cv2.resize(
        gray, (AIRCRAFT_CANVAS_SIZE, AIRCRAFT_CANVAS_SIZE), interpolation=cv2.INTER_AREA
    )

    gray = gray.astype(np.float32) / 255.0

    return gray


def compare_pixels(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    a = normalise_pixels(a)

    b = normalise_pixels(b)

    mae = float(np.mean(np.abs(a - b)))

    a_flat = a.flatten()

    b_flat = b.flatten()

    if np.std(a_flat) < 1e-8 or np.std(b_flat) < 1e-8:
        correlation = 0.0

    else:
        correlation = float(np.corrcoef(a_flat, b_flat)[0, 1])

    return (mae, correlation)


# ============================================================
# EDGE / SHAPE SIMILARITY
# ============================================================


def make_shape_map(image: np.ndarray) -> np.ndarray:
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    image = cv2.resize(
        image,
        (AIRCRAFT_CANVAS_SIZE, AIRCRAFT_CANVAS_SIZE),
        interpolation=cv2.INTER_AREA,
    )

    image = cv2.GaussianBlur(image, (5, 5), 0)

    edges = cv2.Canny(image, 35, 120)

    kernel = np.ones((3, 3), np.uint8)

    return cv2.dilate(edges, kernel, iterations=1)


def shape_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a = make_shape_map(a)

    b = make_shape_map(b)

    a = a > 0

    b = b > 0

    intersection = np.logical_and(a, b).sum()

    total = a.sum() + b.sum()

    if total == 0:
        return 1.0

    return float(2.0 * intersection / total)


# ============================================================
# STRUCTURAL SIMILARITY
# ============================================================


def structural_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.ndim == 3:
        a = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)

    if b.ndim == 3:
        b = cv2.cvtColor(b, cv2.COLOR_RGB2GRAY)

    a = cv2.resize(a, (64, 64), interpolation=cv2.INTER_AREA)

    b = cv2.resize(b, (64, 64), interpolation=cv2.INTER_AREA)

    a = a.astype(np.float32) / 255.0

    b = b.astype(np.float32) / 255.0

    mu_a = cv2.GaussianBlur(a, (7, 7), 1.5)

    mu_b = cv2.GaussianBlur(b, (7, 7), 1.5)

    mu_a_sq = mu_a * mu_a

    mu_b_sq = mu_b * mu_b

    mu_ab = mu_a * mu_b

    sigma_a_sq = cv2.GaussianBlur(a * a, (7, 7), 1.5) - mu_a_sq

    sigma_b_sq = cv2.GaussianBlur(b * b, (7, 7), 1.5) - mu_b_sq

    sigma_ab = cv2.GaussianBlur(a * b, (7, 7), 1.5) - mu_ab

    c1 = 0.01**2

    c2 = 0.03**2

    numerator = (2 * mu_ab + c1) * (2 * sigma_ab + c2)

    denominator = (mu_a_sq + mu_b_sq + c1) * (sigma_a_sq + sigma_b_sq + c2)

    score = numerator / (denominator + 1e-12)

    return float(np.mean(score))


# ============================================================
# AIRCRAFT GEOMETRY
# ============================================================


def geometry_difference(a: dict, b: dict) -> dict:
    aspect_a = a["aspect_ratio"]

    aspect_b = b["aspect_ratio"]

    aspect_difference = abs(aspect_a - aspect_b) / max(aspect_a, aspect_b, 1e-6)

    area_difference = abs(a["area_ratio"] - b["area_ratio"]) / max(
        a["area_ratio"], b["area_ratio"], 1e-6
    )

    center_distance = np.sqrt(
        (a["center_x"] - b["center_x"]) ** 2 + (a["center_y"] - b["center_y"]) ** 2
    )

    box_width_difference = abs(a["box_width_ratio"] - b["box_width_ratio"])

    box_height_difference = abs(a["box_height_ratio"] - b["box_height_ratio"])

    return {
        "aspect_difference": (aspect_difference),
        "area_difference": (area_difference),
        "center_distance": (center_distance),
        "box_width_difference": (box_width_difference),
        "box_height_difference": (box_height_difference),
    }


# ============================================================
# SHA-256
# ============================================================


def file_sha256(path: Path) -> str:
    sha = hashlib.sha256()

    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)

            if not chunk:
                break

            sha.update(chunk)

    return sha.hexdigest()


def pixel_sha256(image: np.ndarray) -> str:
    image = np.ascontiguousarray(image, dtype=np.uint8)

    return hashlib.sha256(image.tobytes()).hexdigest()


# ============================================================
# COMPLETE AIRCRAFT SIGNATURE
# ============================================================


def build_signature(image_path: Path, model: YOLO) -> dict:
    image = load_image(image_path)

    representation = build_aircraft_representation(image_path, model)

    aircraft_rgb = representation["aircraft_rgb"]

    aircraft_gray = representation["aircraft_gray"]

    aircraft_shape = representation["aircraft_shape"]

    return {
        "file_sha256": file_sha256(image_path),
        "pixel_sha256": pixel_sha256(image),
        "aircraft_pixel_sha256": (pixel_sha256(aircraft_rgb)),
        "aircraft_rgb": (aircraft_rgb),
        "aircraft_gray": (aircraft_gray),
        "aircraft_shape": (aircraft_shape),
        "aircraft_phash": phash(aircraft_gray),
        "aircraft_dhash": dhash(aircraft_gray),
        "aircraft_ahash": ahash(aircraft_gray),
        "geometry": (representation["geometry"]),
    }


# ============================================================
# AIRCRAFT-ONLY DUPLICATE COMPARISON
# ============================================================


def compare_aircraft(candidate: dict, existing: dict) -> tuple[bool, dict]:
    if candidate["file_sha256"] == existing["file_sha256"]:
        return (True, {"reason": ("EXACT FILE DUPLICATE")})

    if candidate["pixel_sha256"] == existing["pixel_sha256"]:
        return (True, {"reason": ("EXACT PIXEL DUPLICATE")})

    if candidate["aircraft_pixel_sha256"] == existing["aircraft_pixel_sha256"]:
        return (True, {"reason": ("EXACT AIRCRAFT DUPLICATE")})

    pixel_mae, pixel_corr = compare_pixels(
        candidate["aircraft_rgb"], existing["aircraft_rgb"]
    )

    if (
        pixel_mae <= AIRCRAFT_PIXEL_MAE_VERY_STRICT
        and pixel_corr >= AIRCRAFT_PIXEL_CORRELATION_VERY_STRICT
    ):

        return (
            True,
            {
                "reason": ("NEAR-IDENTICAL AIRCRAFT PIXELS"),
                "pixel_mae": pixel_mae,
                "pixel_corr": pixel_corr,
            },
        )

    if (
        pixel_mae <= AIRCRAFT_PIXEL_MAE_STRICT
        and pixel_corr >= AIRCRAFT_PIXEL_CORRELATION_STRICT
    ):

        return (
            True,
            {
                "reason": ("VERY SIMILAR AIRCRAFT PIXELS"),
                "pixel_mae": pixel_mae,
                "pixel_corr": pixel_corr,
            },
        )

    phash_distance = hamming(candidate["aircraft_phash"], existing["aircraft_phash"])

    dhash_distance = hamming(candidate["aircraft_dhash"], existing["aircraft_dhash"])

    ahash_distance = hamming(candidate["aircraft_ahash"], existing["aircraft_ahash"])

    if (
        phash_distance <= AIRCRAFT_PHASH_VERY_STRICT
        and dhash_distance <= AIRCRAFT_DHASH_VERY_STRICT
    ):

        return (
            True,
            {
                "reason": ("EXTREMELY CLOSE AIRCRAFT HASHES"),
                "phash": phash_distance,
                "dhash": dhash_distance,
                "ahash": ahash_distance,
            },
        )

    shape_score = shape_similarity(candidate["aircraft_rgb"], existing["aircraft_rgb"])

    structure_score = structural_similarity(
        candidate["aircraft_gray"], existing["aircraft_gray"]
    )

    geometry = geometry_difference(candidate["geometry"], existing["geometry"])

    aspect_close = geometry["aspect_difference"] <= MAX_AIRCRAFT_ASPECT_RATIO_DIFFERENCE

    area_close = geometry["area_difference"] <= MAX_AIRCRAFT_AREA_RATIO_DIFFERENCE

    if (
        shape_score >= AIRCRAFT_SHAPE_VERY_STRICT
        and structure_score >= AIRCRAFT_STRUCTURE_VERY_STRICT
    ):

        return (
            True,
            {
                "reason": ("EXTREMELY SIMILAR AIRCRAFT SHAPE AND STRUCTURE"),
                "shape": shape_score,
                "structure": structure_score,
                "phash": phash_distance,
                "dhash": dhash_distance,
            },
        )

    strong_signals = 0

    if phash_distance <= AIRCRAFT_PHASH_STRICT:
        strong_signals += 1

    if dhash_distance <= AIRCRAFT_DHASH_STRICT:
        strong_signals += 1

    if ahash_distance <= AIRCRAFT_AHASH_STRICT:
        strong_signals += 1

    if shape_score >= AIRCRAFT_SHAPE_STRICT:
        strong_signals += 1

    if structure_score >= AIRCRAFT_STRUCTURE_STRICT:
        strong_signals += 1

    if aspect_close:
        strong_signals += 1

    if area_close:
        strong_signals += 1

    if strong_signals >= MULTI_SIGNAL_THRESHOLD:
        return (
            True,
            {
                "reason": ("MULTIPLE STRONG AIRCRAFT MATCH SIGNALS"),
                "signals": strong_signals,
                "phash": phash_distance,
                "dhash": dhash_distance,
                "ahash": ahash_distance,
                "shape": shape_score,
                "structure": structure_score,
                "aspect_difference": (geometry["aspect_difference"]),
            },
        )

    same_viewpoint_signals = 0

    if shape_score >= AIRCRAFT_SHAPE_STRICT:
        same_viewpoint_signals += 1

    if structure_score >= AIRCRAFT_STRUCTURE_STRICT:
        same_viewpoint_signals += 1

    if phash_distance <= AIRCRAFT_PHASH_STRICT:
        same_viewpoint_signals += 1

    if dhash_distance <= AIRCRAFT_DHASH_STRICT:
        same_viewpoint_signals += 1

    if aspect_close:
        same_viewpoint_signals += 1

    if same_viewpoint_signals >= 4:
        return (
            True,
            {
                "reason": ("SAME AIRCRAFT AND ESSENTIALLY SAME VIEWPOINT"),
                "signals": (same_viewpoint_signals),
                "shape": shape_score,
                "structure": structure_score,
                "phash": phash_distance,
                "dhash": dhash_distance,
                "aspect_difference": (geometry["aspect_difference"]),
            },
        )

    if (
        shape_score >= AIRCRAFT_SHAPE_VERY_STRICT
        and structure_score >= AIRCRAFT_STRUCTURE_STRICT
        and aspect_close
    ):

        return (
            True,
            {
                "reason": ("SAME AIRCRAFT SHAPE AND VIEWPOINT"),
                "shape": shape_score,
                "structure": structure_score,
                "aspect_difference": (geometry["aspect_difference"]),
            },
        )

    if phash_distance <= AIRCRAFT_PHASH_STRICT and shape_score >= AIRCRAFT_SHAPE_STRICT:
        return (
            True,
            {
                "reason": ("AIRCRAFT HASH + SHAPE MATCH"),
                "phash": phash_distance,
                "shape": shape_score,
            },
        )

    if (
        phash_distance <= AIRCRAFT_PHASH_STRICT
        and structure_score >= AIRCRAFT_STRUCTURE_STRICT
    ):

        return (
            True,
            {
                "reason": ("AIRCRAFT HASH + STRUCTURE MATCH"),
                "phash": phash_distance,
                "structure": structure_score,
            },
        )

    if pixel_mae <= AIRCRAFT_PIXEL_MAE_STRICT and shape_score >= AIRCRAFT_SHAPE_STRICT:
        return (
            True,
            {
                "reason": ("AIRCRAFT PIXEL + SHAPE MATCH"),
                "pixel_mae": pixel_mae,
                "pixel_corr": pixel_corr,
                "shape": shape_score,
            },
        )

    return (
        False,
        {
            "reason": ("AIRCRAFT IS DIFFERENT ENOUGH"),
            "phash": phash_distance,
            "dhash": dhash_distance,
            "ahash": ahash_distance,
            "pixel_mae": pixel_mae,
            "pixel_corr": pixel_corr,
            "shape": shape_score,
            "structure": structure_score,
            "aspect_difference": (geometry["aspect_difference"]),
            "area_difference": (geometry["area_difference"]),
        },
    )


# ============================================================
# COMPARE AGAINST ENTIRE DATASET
# ============================================================


def compare_against_all(
    candidate: dict, existing_signatures: dict[str, dict]
) -> tuple[str | None, dict | None]:

    for filename, existing in existing_signatures.items():
        duplicate, diagnostics = compare_aircraft(candidate, existing)

        if duplicate:
            return (filename, diagnostics)

    return (None, None)


# ============================================================
# LOAD EXISTING DATABASE
# ============================================================


# Reused across calls so a long-running process does not re-analyse
# unchanged images every time it tops a folder up.
SIGNATURE_CACHE: dict[tuple[str, int, int], dict] = {}


def load_existing_signatures(output_dir: Path, model: YOLO) -> dict[str, dict]:
    signatures = {}

    images = get_existing_images(output_dir)

    print(
        f"  Analysing {len(images)} " "existing images for aircraft-only duplicates..."
    )

    for image_path in images:
        try:
            stat = image_path.stat()
            cache_key = (str(image_path), stat.st_mtime_ns, stat.st_size)

            if cache_key not in SIGNATURE_CACHE:
                SIGNATURE_CACHE[cache_key] = build_signature(image_path, model)

            signatures[image_path.name] = SIGNATURE_CACHE[cache_key]

        except Exception as e:
            print(f"  Warning: could not analyse {image_path.name}: " f"{e}")

    return signatures


# ============================================================
# COMPRESSION
# ============================================================


def compress_image(image_path: Path) -> bool:
    try:
        image = Image.open(image_path)

        image = ImageOps.exif_transpose(image).convert("RGB")

        width, height = image.size

        longest_side = max(width, height)

        if longest_side > MAX_DIMENSION:
            scale = MAX_DIMENSION / longest_side

            image = image.resize(
                (max(1, int(width * scale)), max(1, int(height * scale))),
                Image.Resampling.LANCZOS,
            )

        while True:
            quality = START_QUALITY

            while quality >= MIN_QUALITY:
                buffer = io.BytesIO()

                image.save(
                    buffer,
                    "JPEG",
                    quality=quality,
                    optimize=True,
                    progressive=True,
                    subsampling=2,
                )

                data = buffer.getvalue()

                if len(data) <= MAX_FILE_SIZE:
                    temp_path = image_path.with_suffix(".tmp.jpg")

                    with temp_path.open("wb") as f:
                        f.write(data)

                    temp_path.replace(image_path)

                    return True

                quality -= 4

            width, height = image.size

            new_width = int(width * RESIZE_FACTOR)

            new_height = int(height * RESIZE_FACTOR)

            if new_width < 640 or new_height < 480:
                buffer = io.BytesIO()

                image.save(
                    buffer,
                    "JPEG",
                    quality=MIN_QUALITY,
                    optimize=True,
                    progressive=True,
                    subsampling=2,
                )

                temp_path = image_path.with_suffix(".tmp.jpg")

                with temp_path.open("wb") as f:
                    f.write(buffer.getvalue())

                temp_path.replace(image_path)

                return True

            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)

    except Exception as e:
        print(f"    Compression failed: {e}")

        image_path.unlink(missing_ok=True)

        return False


# ============================================================
# DIAGNOSTICS
# ============================================================


def print_diagnostics(diagnostics: dict) -> None:
    print(f"      Reason: {diagnostics.get('reason')}")

    fields = [
        ("signals", "Signals", None),
        ("phash", "Aircraft pHash distance", None),
        ("dhash", "Aircraft dHash distance", None),
        ("ahash", "Aircraft aHash distance", None),
        ("pixel_mae", "Aircraft pixel MAE", 4),
        ("pixel_corr", "Aircraft pixel correlation", 4),
        ("shape", "Aircraft shape similarity", 3),
        ("structure", "Aircraft structure similarity", 3),
        ("aspect_difference", "Aircraft aspect difference", 3),
        ("area_difference", "Aircraft area difference", 3),
    ]

    for key, label, decimals in fields:
        if key not in diagnostics:
            continue

        value = diagnostics[key]

        if decimals is None:
            print(f"      {label}: " f"{value}")

        else:
            print(f"      {label}: " f"{value:.{decimals}f}")


# ============================================================
# PROCESS AIRCRAFT
# ============================================================


def process_aircraft(
    entry: dict, model: YOLO, max_new_images: int | None = None
) -> list[str]:
    aircraft_name = str(entry.get("label", entry.get("folder", ""))).strip()
    folder_name = str(entry.get("folder", "")).strip()

    if not folder_name:
        print("  SKIPPED: no folder specified.")
        return []

    output_dir = BASE_DIR / folder_name

    exhausted = load_openverse_exhausted()

    # If this is a new folder, allow Openverse searches again.
    if folder_name in exhausted and not output_dir.exists():
        clear_openverse_exhausted(folder_name)
        print(f"  Cleared {folder_name} from {OPENVERSE_EXHAUSTED_PATH.name}.")

    elif folder_name in exhausted:
        print(
            f"  SKIPPED {folder_name}: previously recorded "
            "as exhausted on Openverse."
        )
        return []

    icao = str(entry.get("icao", "")).strip()
    query = str(entry.get("query", "")).strip()

    if not query:
        print(f"  SKIPPED {aircraft_name}: no Openverse query.")
        return []

    existing_count = count_existing_images(output_dir)

    if existing_count >= IMAGES_PER_AIRCRAFT:
        print(f"  Already complete: {existing_count}/{IMAGES_PER_AIRCRAFT}")
        return []

    if output_dir.exists():
        used_images = load_used_images(output_dir)
        sources = load_sources(output_dir)
    else:
        used_images = set()
        sources = {}

    existing_signatures = {}
    if output_dir.exists():
        existing_signatures = load_existing_signatures(output_dir, model)

    remaining = IMAGES_PER_AIRCRAFT - existing_count
    requested_count = (
        remaining if max_new_images is None else min(remaining, max_new_images)
    )
    next_number = get_next_filename_number(output_dir) if output_dir.exists() else 0
    added_filenames: list[str] = []

    print()
    print("=" * 72)
    print(aircraft_name)

    if icao:
        print(f"ICAO: {icao}")

    print(f"Folder: {folder_name}")
    print(f"Openverse query: {query}")
    print(f"Existing: {existing_count}/{IMAGES_PER_AIRCRAFT}")
    print(f"Need: {remaining}")
    print("=" * 72)

    page, page_offset = load_openverse_cursor(folder_name, query)
    if page > 1:
        print(f"Resuming Openverse search at page {page}.")
    candidates_processed = 0
    saved = 0
    skipped = 0
    max_candidates = MAX_CANDIDATES_PER_AIRCRAFT

    while saved < requested_count and candidates_processed < max_candidates:
        still_needed = (
            IMAGES_PER_AIRCRAFT - count_existing_images(output_dir)
            if output_dir.exists()
            else IMAGES_PER_AIRCRAFT
        )

        if still_needed <= 0:
            break

        page_size = min(OPENVERSE_PAGE_SIZE, max_candidates - candidates_processed)

        if page_size <= 0:
            break

        print(f"\n  Searching Openverse (page {page})...")

        try:
            results = search_openverse(query, page, page_size, folder_name)
        except Exception as e:
            print(f"  Search failed: {e}")
            break

        if results is None:
            print("  Moving to next aircraft...")
            break

        if not results:
            print("  No more Openverse results.")
            record_openverse_exhausted(folder_name)
            print(f"  Recorded {folder_name} in " f"{OPENVERSE_EXHAUSTED_PATH.name}.")
            break

        page_complete = True
        for result_index, result in enumerate(results):
            if result_index < page_offset:
                continue

            if saved >= requested_count:
                record_openverse_next_page(folder_name, query, page, result_index)
                page_complete = False
                break

            if (
                output_dir.exists()
                and count_existing_images(output_dir) >= IMAGES_PER_AIRCRAFT
            ):
                record_openverse_next_page(folder_name, query, page, result_index)
                page_complete = False
                break

            candidates_processed += 1
            image_id = result["id"]
            title = result["title"]
            url = result["url"]

            if image_id in used_images:
                skipped += 1
                continue

            # Mark Openverse result as seen.
            used_images.add(image_id)
            output_dir.mkdir(parents=True, exist_ok=True)
            save_used_images(output_dir, used_images)

            print()
            print(f"  Candidate {candidates_processed}: {title}")
            print(f"    Source: {result.get('source')}")
            print(f"    Licence: {result.get('license')}")

            if not url:
                print("    Rejected: no image URL")
                skipped += 1
                continue

            filename = f"{next_number:03d}.jpg"
            output_path = output_dir / filename

            print("    Downloading...")
            if not download_image(url, output_path):
                skipped += 1
                continue

            print("    Detecting and cropping aircraft...")
            if not crop_aircraft(output_path, model):
                output_path.unlink(missing_ok=True)
                skipped += 1
                continue

            # ------------------------------------------------
            # FINAL IMAGE ASPECT RATIO (after aircraft crop)
            # ------------------------------------------------
            print("    Checking final image aspect ratio...")

            aspect_ok, aspect_diagnostics = validate_final_image_aspect_ratio(
                output_path
            )

            if not aspect_ok:
                print(
                    f"    Rejected: {aspect_diagnostics['reason']} "
                    f"({aspect_diagnostics.get('aspect_ratio', 0):.2f}:1)"
                )
                output_path.unlink(missing_ok=True)
                skipped += 1
                continue

            print(
                f"    Final image aspect ratio: {aspect_diagnostics['aspect_ratio']:.2f}:1"
            )

            # ------------------------------------------------
            # CHECK AIRCRAFT IS FULLY IN FRAME
            # ------------------------------------------------
            print("    Checking whether aircraft is fully in frame...")

            if not validate_aircraft_in_frame(output_path, model):
                output_path.unlink(missing_ok=True)
                skipped += 1
                continue

            # ------------------------------------------------
            # COMPRESS (after crop, aspect ratio and frame checks)
            # ------------------------------------------------
            print("    Compressing...")

            if not compress_image(output_path):
                output_path.unlink(missing_ok=True)
                skipped += 1
                continue

            # ------------------------------------------------
            # BUILD SIGNATURE AND CHECK FOR DUPLICATES
            # ------------------------------------------------
            print("    Extracting aircraft-only representation...")

            candidate_signature = None

            try:
                candidate_signature = build_signature(output_path, model)
            except Exception as e:
                if "Expected exactly one aircraft" in str(e):
                    print(
                        "    Aircraft signature unavailable: expected exactly one aircraft."
                    )
                    print("    Keeping image and skipping duplicate comparison.")
                else:
                    print(f"    Rejected: could not build aircraft signature: {e}")
                    output_path.unlink(missing_ok=True)
                    skipped += 1
                    continue

            if candidate_signature is not None:
                print(
                    f"    Comparing aircraft against {len(existing_signatures)} existing images..."
                )

                duplicate_filename, diagnostics = compare_against_all(
                    candidate_signature, existing_signatures
                )

                if duplicate_filename:
                    print(f"    REJECTED: aircraft too similar to {duplicate_filename}")

                    if diagnostics:
                        print_diagnostics(diagnostics)

                    output_path.unlink(missing_ok=True)
                    skipped += 1
                    continue

                # Register this signature for subsequent comparisons.
                existing_signatures[filename] = candidate_signature

            else:
                print("    Duplicate check skipped.")

            # ------------------------------------------------
            # ACCEPT IMAGE
            # ------------------------------------------------
            sources[filename] = {
                "openverse_id": image_id,
                "title": title,
                "url": url,
                "thumbnail": result.get("thumbnail"),
                "foreign_landing_url": result.get("foreign_landing_url"),
                "creator": result.get("creator"),
                "creator_url": result.get("creator_url"),
                "license": result.get("license"),
                "license_version": result.get("license_version"),
                "license_url": result.get("license_url"),
                "source": result.get("source"),
                "provider": result.get("provider"),
                "width": result.get("width"),
                "height": result.get("height"),
                "attribution": result.get("attribution"),
            }

            save_sources(output_dir, sources)

            saved += 1
            next_number += 1
            added_filenames.append(filename)

            file_size_kb = output_path.stat().st_size / 1024

            print("    AIRCRAFT DIVERSITY CHECK PASSED")
            print(f"    SAVED: {filename} ({file_size_kb:.0f} KB)")

        if page_complete:
            page += 1
            page_offset = 0
            record_openverse_next_page(folder_name, query, page)

        if (
            output_dir.exists()
            and count_existing_images(output_dir) >= IMAGES_PER_AIRCRAFT
        ):
            break

        if candidates_processed >= max_candidates:
            break

    # ========================================================
    # FINAL STATUS
    # ========================================================
    final_count = count_existing_images(output_dir) if output_dir.exists() else 0

    print()
    print(f"{aircraft_name}: {final_count}/{IMAGES_PER_AIRCRAFT}")
    print(f"  Added: {saved}")
    print(f"  Rejected/skipped: {skipped}")
    print(f"  Candidates processed: {candidates_processed}/{max_candidates}")

    if final_count == 0:
        if output_dir.exists():
            try:
                used_file = output_dir / ".used_images.json"
                source_file = output_dir / ".sources.json"

                used_file.unlink(missing_ok=True)
                source_file.unlink(missing_ok=True)

                try:
                    output_dir.rmdir()
                except OSError:
                    pass

            except Exception as e:
                print(f"  Warning: could not clean empty folder: {e}")

        print("  RESULT: NO IMAGES ACCEPTED")
        print("  Folder was not retained.")
        return []

    if final_count < IMAGES_PER_AIRCRAFT:
        print("  WARNING: fewer than 20 images accepted.")
        print(
            "  This can happen because the aircraft-only similarity filter is intentionally strict."
        )
    else:
        print("  RESULT: COMPLETE")

    return added_filenames


# ============================================================
# ROUTES
# ============================================================


@app.route("/")
def index():
    return send_file(PAGE_PATH, max_age=0)


@app.route("/api/pool")
def api_pool():
    try:
        manifest = load_manifest()
        groups = build_image_pool()
        images_by_aircraft = {
            group["aircraft_key"]: group["images"] for group in groups
        }
        openverse_aircraft = []

        for item in manifest["aircraft"]:
            if not isinstance(item, dict) or not item.get("key"):
                continue

            try:
                folder = get_aircraft_folder(item)
                image_count = (
                    sum(1 for path in folder.iterdir() if is_image_file(path))
                    if folder.is_dir()
                    else 0
                )
            except (OSError, ValueError):
                image_count = 0

            openverse_aircraft.append(
                {
                    **describe_aircraft(item),
                    "query": item.get("query", ""),
                    "image_count": image_count,
                    "images": images_by_aircraft.get(item["key"], []),
                }
            )

        return jsonify(
            {
                "success": True,
                "count": sum(len(group["images"]) for group in groups),
                "aircraft_count": len(groups),
                "undo_available": len(UNDO_STACK),
                "images": groups,
                "openverse_aircraft": openverse_aircraft,
                "blurred": sorted(load_blurred()),
            }
        )

    except Exception as exc:
        app.logger.exception("Could not build image pool")

        return (jsonify({"success": False, "error": str(exc)}), 500)


@app.route("/api/openverse/next", methods=["POST"])
def api_openverse_next():
    payload = request.get_json(silent=True)
    aircraft_key = payload.get("aircraft_key") if isinstance(payload, dict) else None
    limit = payload.get("limit", 1) if isinstance(payload, dict) else 1

    if not isinstance(aircraft_key, str) or not aircraft_key:
        return jsonify({"success": False, "error": "Missing aircraft key."}), 400

    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 4:
        return (
            jsonify(
                {"success": False, "error": "Image limit must be between 1 and 4."}
            ),
            400,
        )

    try:
        with OPENVERSE_LOCK:
            with MANIFEST_LOCK:
                manifest = load_manifest()
                item = get_aircraft_by_key(manifest, aircraft_key)

            if item is None:
                return jsonify({"success": False, "error": "Aircraft not found."}), 404

            query = str(item.get("query", "")).strip()
            folder_name = str(item.get("folder", "")).strip()
            if not query or not folder_name:
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "This aircraft has no Openverse query or folder.",
                        }
                    ),
                    400,
                )

            output_dir = get_aircraft_folder(item)
            existing_count = count_existing_images(output_dir)

            if existing_count >= IMAGES_PER_AIRCRAFT:
                return jsonify(
                    {
                        "success": True,
                        "status": "complete",
                        "image_count": existing_count,
                    }
                )

            if folder_name in load_openverse_exhausted():
                return jsonify(
                    {
                        "success": True,
                        "status": "exhausted",
                        "image_count": existing_count,
                    }
                )

            filenames = process_aircraft(item, get_model(), max_new_images=limit)
            image_count = count_existing_images(output_dir)

            if filenames:
                with MANIFEST_LOCK:
                    manifest = load_manifest()
                    item = get_aircraft_by_key(manifest, aircraft_key)
                    if item is None:
                        raise ValueError("Aircraft was removed from the manifest.")

                    folder = get_aircraft_folder(item)
                    item["images"] = sorted(
                        path.name for path in folder.iterdir() if is_image_file(path)
                    )
                    save_manifest(manifest)

                summary = describe_aircraft(item)
                return jsonify(
                    {
                        "success": True,
                        "status": "images",
                        "image_count": image_count,
                        "images": [
                            {**summary, "filename": filename} for filename in filenames
                        ],
                    }
                )

            if image_count >= IMAGES_PER_AIRCRAFT:
                return jsonify(
                    {"success": True, "status": "complete", "image_count": image_count}
                )

            if folder_name in load_openverse_exhausted():
                return jsonify(
                    {"success": True, "status": "exhausted", "image_count": image_count}
                )

            return (
                jsonify(
                    {
                        "success": False,
                        "error": "Could not find a usable image. Try fetching again.",
                    }
                ),
                502,
            )

    except Exception as exc:
        app.logger.exception("Could not fetch the next Openverse image")
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route("/image/<aircraft_key>/<path:filename>")
def serve_image(aircraft_key: str, filename: str):
    try:
        item = None

        # manifest.json can be mid-rewrite; retry briefly, then use the last good copy.
        for attempt in range(4):
            try:
                data = load_manifest()
                item = get_aircraft_by_key(data, aircraft_key)
                if item is not None:
                    AIRCRAFT_CACHE[aircraft_key] = dict(item)
                break
            except (OSError, ValueError):
                time.sleep(0.1 * (attempt + 1))

        if item is None:
            item = AIRCRAFT_CACHE.get(aircraft_key)

        if item is None:
            return "Aircraft not found.", 404

        image_path = get_image_path(item, filename)

        if not image_path.exists():
            return "Image not found.", 404

        if not is_image_file(image_path):
            return "Not an image.", 400

        return send_file(image_path)

    except ValueError as exc:
        return str(exc), 400

    except Exception:
        app.logger.exception("Could not serve image")
        return "Could not serve image.", 500


@app.route("/api/blur", methods=["POST"])
def api_blur():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid request."}), 400

    try:
        x = float(payload["x"])
        y = float(payload["y"])
        w = float(payload["w"])
        h = float(payload["h"])

        with MANIFEST_LOCK:
            data = load_manifest()
            item = get_aircraft_by_key(data, str(payload.get("aircraft_key", "")))

            if item is None:
                return jsonify({"error": "Aircraft not found."}), 404

            image_path = get_image_path(item, str(payload.get("filename", "")))

            if not image_path.exists() or not is_image_file(image_path):
                return jsonify({"error": "Image not found."}), 404

            with Image.open(image_path) as opened:
                image = opened.copy()
                image_format = opened.format

            width, height = image.size
            left = max(0, int(x * width))
            top = max(0, int(y * height))
            right = min(width, int((x + w) * width) + 1)
            bottom = min(height, int((y + h) * height) + 1)

            if right - left < 2 or bottom - top < 2:
                return jsonify({"error": "Selection is too small."}), 400

            BLUR_BACKUP_DIR.mkdir(exist_ok=True)
            backup_path = BLUR_BACKUP_DIR / (f"{time.time_ns()}_{image_path.name}")
            shutil.copy2(image_path, backup_path)

            region = image.crop((left, top, right, bottom))
            radius = max(8, min(region.width, region.height) * 0.2)
            # Pixelate first so text cannot be recovered from a light blur.
            small = region.resize(
                (max(1, region.width // 8), max(1, region.height // 8)), Image.BILINEAR
            )
            region = small.resize(region.size, Image.BILINEAR).filter(
                ImageFilter.GaussianBlur(radius)
            )
            image.paste(region, (left, top))

            if image_format == "JPEG" and image.mode != "RGB":
                image = image.convert("RGB")

            save_kwargs = {"quality": 92} if image_format == "JPEG" else {}
            image.save(image_path, format=image_format, **save_kwargs)

            BLUR_UNDO_STACK.append({"path": image_path, "backup": backup_path})
            adjust_blurred(str(payload["aircraft_key"]), image_path.name, 1)

        return jsonify({"success": True, "blurred": True})

    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Invalid selection."}), 400

    except Exception:
        app.logger.exception("Could not blur image")
        return jsonify({"error": "Could not blur image."}), 500


@app.route("/api/blur/undo", methods=["POST"])
def api_blur_undo():
    payload = request.get_json(silent=True) or {}

    with MANIFEST_LOCK:
        try:
            data = load_manifest()
            item = get_aircraft_by_key(data, str(payload.get("aircraft_key", "")))
            target = (
                get_image_path(item, str(payload.get("filename", "")))
                if item is not None
                else None
            )
        except ValueError:
            target = None

        for index in range(len(BLUR_UNDO_STACK) - 1, -1, -1):
            entry = BLUR_UNDO_STACK[index]

            if target is not None and entry["path"] == target:
                BLUR_UNDO_STACK.pop(index)
                shutil.move(str(entry["backup"]), str(entry["path"]))
                remaining = adjust_blurred(
                    str(payload.get("aircraft_key", "")), target.name, -1
                )
                return jsonify({"success": True, "blurred": remaining > 0})

    return jsonify({"error": "Nothing to undo for this image."}), 404


@app.route("/api/delete", methods=["POST"])
def api_delete():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return jsonify({"success": False, "error": "Invalid request."}), 400

    aircraft_key = payload.get("aircraft_key")
    filename = payload.get("filename")

    if not isinstance(aircraft_key, str) or not aircraft_key:
        return jsonify({"success": False, "error": "Missing aircraft key."}), 400

    if not isinstance(filename, str) or not filename:
        return jsonify({"success": False, "error": "Missing filename."}), 400

    try:
        with MANIFEST_LOCK:
            data = load_manifest()
            item = get_aircraft_by_key(data, aircraft_key)

            if item is None:
                return jsonify({"success": False, "error": "Aircraft not found."}), 404

            image_path = get_image_path(item, filename)

            if not image_path.exists():
                return (
                    jsonify({"success": False, "error": "Image no longer exists."}),
                    404,
                )

            if not is_image_file(image_path):
                return jsonify({"success": False, "error": "Not an image file."}), 400

            manifest_images = item.get("images", [])

            if not isinstance(manifest_images, list):
                manifest_images = []

            manifest_index = (
                manifest_images.index(filename) if filename in manifest_images else None
            )

            item["images"] = [
                existing for existing in manifest_images if existing != filename
            ]

            trash_path = (
                TRASH_DIR / aircraft_key / f"{time.time_ns()}_{image_path.name}"
            )
            trash_path.parent.mkdir(parents=True, exist_ok=True)

            # Save the manifest before moving the file, so a failed
            # manifest write does not leave an unrecorded deletion.
            save_manifest(data)

            try:
                shutil.move(str(image_path), str(trash_path))
            except Exception:
                item["images"] = manifest_images
                save_manifest(data)
                raise

            UNDO_STACK.append(
                {
                    "aircraft_key": aircraft_key,
                    "filename": filename,
                    "trash_path": trash_path,
                    "manifest_index": manifest_index,
                }
            )

        return jsonify(
            {
                "success": True,
                "deleted": filename,
                "aircraft_key": aircraft_key,
                "undo_available": len(UNDO_STACK),
            }
        )

    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    except Exception:
        app.logger.exception("Could not delete image")
        return jsonify({"success": False, "error": "Could not delete image."}), 500


@app.route("/api/undo", methods=["POST"])
def api_undo():
    try:
        with MANIFEST_LOCK:
            if not UNDO_STACK:
                return jsonify({"success": False, "error": "Nothing to undo."}), 404

            record = UNDO_STACK[-1]
            data = load_manifest()
            item = get_aircraft_by_key(data, record["aircraft_key"])

            if item is None:
                UNDO_STACK.pop()
                return jsonify({"success": False, "error": "Aircraft not found."}), 404

            trash_path: Path = record["trash_path"]

            if not trash_path.exists():
                UNDO_STACK.pop()
                return (
                    jsonify({"success": False, "error": "Deleted file is missing."}),
                    404,
                )

            image_path = get_image_path(item, record["filename"])

            if image_path.exists():
                return (
                    jsonify(
                        {
                            "success": False,
                            "error": "A file with that name already exists.",
                        }
                    ),
                    409,
                )

            shutil.move(str(trash_path), str(image_path))

            manifest_images = item.get("images", [])

            if not isinstance(manifest_images, list):
                manifest_images = []

            if record["filename"] not in manifest_images:
                index = record["manifest_index"]
                if index is None:
                    manifest_images.append(record["filename"])
                else:
                    manifest_images.insert(
                        min(index, len(manifest_images)), record["filename"]
                    )

            item["images"] = manifest_images
            save_manifest(data)
            UNDO_STACK.pop()

            return jsonify(
                {
                    "success": True,
                    "undo_available": len(UNDO_STACK),
                    "image": {
                        **describe_aircraft(item),
                        "filename": record["filename"],
                    },
                }
            )

    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400

    except Exception:
        app.logger.exception("Could not undo deletion")
        return jsonify({"success": False, "error": "Could not undo deletion."}), 500


# ============================================================
# MAIN
# ============================================================


def open_browser() -> None:
    time.sleep(0.8)
    webbrowser.open(f"http://{APP_HOST}:{APP_PORT}")


def print_startup_summary() -> None:
    manifest = load_manifest()
    groups = build_image_pool()

    print(f"Aircraft entries: {len(manifest['aircraft'])}")
    print(f"Folders with images: {len(groups)}")
    print(f"Images found: {sum(len(group['images']) for group in groups)}")
    print("\nImages per folder:")
    for group in sorted(groups, key=lambda item: item["folder"].casefold()):
        print(f"  {group['folder']}: {group['image_count']}")


def main() -> None:
    print()
    print("=" * 70)
    print("Aircraft Image Manager")
    print("=" * 70)
    print()
    print(f"Manifest:\n  {MANIFEST_PATH}\n")

    try:
        print_startup_summary()
    except Exception as exc:
        print(f"ERROR: {exc}\n")
        input("Press Enter to exit...")
        raise SystemExit(1)

    print()
    print(f"URL:\n  http://{APP_HOST}:{APP_PORT}")
    print()
    print(f"Showing up to {IMAGES_PER_BATCH} images at a time.")
    print("Only one aircraft folder is shown in each batch.")
    print(
        "Delete moves the image to .deleted_images and removes it from "
        "manifest.json (undo with U)."
    )
    print()
    print("Keyboard shortcuts:")
    print("  1-4 = delete image 1-4")
    print("  D   = delete focused image")
    print("  P / Left arrow   = previous 4")
    print("  N / Right arrow  = next 4")
    print("  R   = reshuffle aircraft order")
    print("  U / Ctrl+Z = undo last delete")
    print("  Esc = focus first Delete button")
    print()
    print("Press Ctrl+C to stop.")
    print("=" * 70)
    print()

    threading.Thread(target=open_browser, daemon=True).start()
    app.run(host=APP_HOST, port=APP_PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
