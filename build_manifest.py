from __future__ import annotations

import json
import re
from pathlib import Path

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

MANIFEST_PATH = BASE_DIR / "manifest.json"

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
}


# ============================================================
# HELPERS
# ============================================================


def natural_sort_key(filename: str):
    """
    Sort filenames naturally.

    Examples:
        1.jpg
        2.jpg
        10.jpg
    """

    return [
        int(part) if part.isdigit() else part.lower()
        for part in re.split(r"(\d+)", filename)
    ]


def get_image_filenames(folder: Path) -> list[str]:
    """Return all supported image filenames directly inside a folder."""

    if not folder.exists() or not folder.is_dir():
        return []

    images = [
        file.name
        for file in folder.iterdir()
        if file.is_file() and file.suffix.lower() in IMAGE_EXTENSIONS
    ]

    images.sort(key=natural_sort_key)

    return images


# ============================================================
# MAIN
# ============================================================


def main() -> None:

    # --------------------------------------------------------
    # Validate manifest
    # --------------------------------------------------------

    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Manifest not found:\n{MANIFEST_PATH}")

    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        manifest = json.load(f)

    aircraft = manifest.get("aircraft")

    if not isinstance(aircraft, list):
        raise ValueError('Manifest does not contain a valid "aircraft" array.')

    # --------------------------------------------------------
    # Get folders referenced by the manifest
    # --------------------------------------------------------

    manifest_folders = {
        item["folder"].strip()
        for item in aircraft
        if isinstance(item, dict)
        and isinstance(item.get("folder"), str)
        and item["folder"].strip()
    }

    # --------------------------------------------------------
    # Process every manifest aircraft
    # --------------------------------------------------------

    updated = 0
    missing = 0
    empty = 0
    total_images = 0

    print("=" * 70)
    print("UPDATING MANIFEST IMAGE LISTS")
    print("=" * 70)
    print()

    for item in aircraft:

        if not isinstance(item, dict):
            continue

        name = item.get("name", "Unknown aircraft")
        folder_name = item.get("folder")

        if not isinstance(folder_name, str) or not folder_name.strip():
            print(f"[MISSING FOLDER] {name}")
            item["images"] = []
            missing += 1
            continue

        folder_name = folder_name.strip()

        # Folder is directly beside the script.
        folder = BASE_DIR / folder_name

        images = get_image_filenames(folder)

        # Always store the image list.
        item["images"] = images

        if not folder.exists():
            print(f"[NOT FOUND]      {folder_name}")
            missing += 1
            continue

        if not folder.is_dir():
            print(f"[NOT A FOLDER]   {folder_name}")
            missing += 1
            continue

        if not images:
            print(f"[EMPTY]          {folder_name}")
            empty += 1
            continue

        total_images += len(images)
        updated += 1

        print(f"[OK]             " f"{folder_name:<35} " f"{len(images):>3} images")

    # --------------------------------------------------------
    # Find folders not referenced by the manifest
    # --------------------------------------------------------

    unlisted_folders = sorted(
        [
            folder
            for folder in BASE_DIR.iterdir()
            if folder.is_dir()
            and folder.name not in manifest_folders
            and folder.name != ".git"
        ],
        key=lambda folder: natural_sort_key(folder.name),
    )

    # --------------------------------------------------------
    # Write manifest
    # --------------------------------------------------------

    with MANIFEST_PATH.open("w", encoding="utf-8") as f:
        json.dump(
            manifest,
            f,
            indent=2,
            ensure_ascii=False,
        )
        f.write("\n")

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("MANIFEST UPDATED")
    print("=" * 70)
    print(f"Aircraft entries : {len(aircraft)}")
    print(f"Updated          : {updated}")
    print(f"Missing folders  : {missing}")
    print(f"Empty folders    : {empty}")
    print(f"Total images     : {total_images}")
    print(f"Manifest         : {MANIFEST_PATH}")

    # --------------------------------------------------------
    # Report unlisted folders
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("FOLDERS NOT IN MANIFEST")
    print("=" * 70)

    if not unlisted_folders:
        print("None found.")
    else:
        total_unlisted_images = 0

        for folder in unlisted_folders:
            images = get_image_filenames(folder)
            image_count = len(images)
            total_unlisted_images += image_count

            print(f"[UNLISTED]       " f"{folder.name:<35} " f"{image_count:>3} images")

        print("-" * 70)
        print(f"Unlisted folders : {len(unlisted_folders)}")
        print(f"Images in them   : {total_unlisted_images}")

    print("=" * 70)


if __name__ == "__main__":
    main()
