from __future__ import annotations

import json
from pathlib import Path

from .models import AudioAsset, ImageAsset, Story, VideoAsset


def write_attribution_files(
    output_dir: Path,
    story: Story,
    images: list[ImageAsset],
    audio: AudioAsset,
    video: VideoAsset | None,
) -> None:
    credits = _build_credits(story, images)
    (output_dir / "credits.txt").write_text(credits, encoding="utf-8")

    manifest = {
        "story": {
            "title": story.title,
            "author": story.author,
            "source_url": story.source_url,
            "license_name": story.license_name,
        },
        "images": [image.to_json_dict() for image in images],
        "audio": audio.to_json_dict(),
        "video": video.to_json_dict() if video else None,
        "notes": [
            "If the source story is CC BY-SA, release the resulting video and description under the same license.",
            "Put story and image attribution in the Bilibili description when publishing.",
        ],
    }
    (output_dir / "license_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _build_credits(story: Story, images: list[ImageAsset]) -> str:
    lines = [
        f"Title: {story.title}",
        f"Story author: {story.author or 'not provided'}",
        f"Story source: {story.source_url or 'not provided'}",
        f"Story license: {story.license_name or 'not provided'}",
        "",
        "Images:",
    ]
    for image in images:
        title = image.title or f"Image {image.index}"
        lines.append(
            f"{image.index}. {title} by {image.creator}, {image.license_name}, "
            f"{image.license_url}, source: {image.source_url}"
        )
    lines.append("")
    lines.append("Generated with storyvideogen.")
    return "\n".join(lines) + "\n"

