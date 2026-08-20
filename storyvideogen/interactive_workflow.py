from __future__ import annotations

import json
import mimetypes
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .attribution import write_attribution_files
from .beat_splitter import retime_chunks, split_into_chunks
from .image_search.base import ImageProvider
from .image_search.providers import build_image_provider
from .models import GenerationPlan, ImageAsset, Story, StoryChunk
from .pipeline import _build_narration_text, _chunk_max_words
from .prompt_generator import build_prompt_provider, generate_prompt_candidates
from .provider_credentials import provider_credentials
from .render.ffmpeg_renderer import render_video
from .render.srt_writer import write_srt
from .story_loader import select_target_excerpt
from .subtitle_translator import build_translator, translate_chunks
from .tts.providers import build_tts_provider

ProgressCallback = Callable[[dict[str, object]], None]


@dataclass(frozen=True)
class InteractiveSettings:
    story_text: str
    title: str
    output_dir: Path
    target_seconds: int = 90
    width: int = 1920
    height: int = 1080
    words_per_minute: int = 145
    chunk_seconds: int = 30
    translator: str = "zai"
    translation_model: str = "glm-5.2"
    prompt_provider: str = "zai"
    prompt_model: str = "glm-5.2"
    image_provider: str = "zhipu"
    image_model: str = "glm-image"
    image_workers: int = 1
    candidates_per_chunk: int = 2
    tts_provider: str = "edge"
    voice: str = "zh-CN-XiaoxiaoNeural"
    source_url: str | None = None
    author: str | None = None
    story_license: str | None = None
    provider_credentials: dict[str, str] | None = None

    @property
    def target_words(self) -> int:
        return max(1, round(self.target_seconds * self.words_per_minute / 60))


def prepare_interactive_project(
    settings: InteractiveSettings,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]:
    story_text = settings.story_text.strip()
    title = settings.title.strip()
    if not story_text:
        raise ValueError("Story text is required.")
    if not title:
        raise ValueError("Title is required.")

    story = Story(
        title=title,
        text=story_text,
        source_url=settings.source_url,
        author=settings.author,
        license_name=settings.story_license,
    )
    excerpt = select_target_excerpt(story.text, settings.target_words)
    chunks = split_into_chunks(
        excerpt,
        settings.target_seconds,
        settings.words_per_minute,
        max_words=_chunk_max_words(settings.words_per_minute, settings.chunk_seconds),
    )
    with provider_credentials(settings.provider_credentials or {}):
        translated_chunks = translate_chunks(chunks, build_translator(settings.translator, settings.translation_model))
        prompt_groups = generate_prompt_candidates(
            translated_chunks,
            build_prompt_provider(settings.prompt_provider, settings.prompt_model),
            settings.candidates_per_chunk,
            story_context=excerpt,
        )

    settings.output_dir.mkdir(parents=True, exist_ok=True)
    (settings.output_dir / "story_input.txt").write_text(story.text + "\n", encoding="utf-8")
    (settings.output_dir / "selected_story.txt").write_text(excerpt + "\n", encoding="utf-8")
    (settings.output_dir / "narration.zh-CN.txt").write_text(_build_narration_text(translated_chunks) + "\n", encoding="utf-8")
    write_srt(settings.output_dir / "subtitles.zh-CN.srt", translated_chunks)

    pending_candidates = _pending_image_candidates(translated_chunks, prompt_groups)
    pending_project = _project_manifest(settings, story, excerpt, translated_chunks, prompt_groups, pending_candidates)
    if progress_callback:
        progress_callback({"type": "project", "project": pending_project})

    with provider_credentials(settings.provider_credentials or {}):
        candidates = _fetch_image_candidates(
            translated_chunks,
            prompt_groups,
            build_image_provider(settings.image_provider, settings.image_model),
            settings.output_dir,
            max_workers=settings.image_workers,
            progress_callback=progress_callback,
        )
    project = _project_manifest(settings, story, excerpt, translated_chunks, prompt_groups, candidates)
    _write_json(settings.output_dir / "interactive_project.json", project)
    _write_json(settings.output_dir / "image_candidates_manifest.json", candidates)
    _write_json(settings.output_dir / "prompts.json", project["chunks"])
    return project


def compose_interactive_project(
    output_dir: Path,
    selections: dict[int, int],
    background_music: Path | None = None,
    music_volume: float = 0.18,
    tts_provider: str | None = None,
    voice: str | None = None,
    skip_video: bool = False,
) -> dict[str, object]:
    project_path = output_dir / "interactive_project.json"
    if not project_path.is_file():
        raise FileNotFoundError(f"Interactive project does not exist: {project_path}")

    project = json.loads(project_path.read_text(encoding="utf-8"))
    settings = project["settings"]
    story_data = project["story"]
    story = Story(
        title=story_data["title"],
        text=story_data["text"],
        source_url=story_data.get("source_url"),
        author=story_data.get("author"),
        license_name=story_data.get("license_name"),
    )
    chunks = [_chunk_from_json(chunk_data) for chunk_data in project["chunks"]]
    selected_images = _selected_images(project["chunks"], selections)
    _write_json(output_dir / "image_manifest.json", [image.to_json_dict() for image in selected_images])

    narration_text = _build_narration_text(chunks)
    audio_asset = build_tts_provider(tts_provider or settings["tts_provider"]).synthesize(
        narration_text,
        output_dir,
        voice or settings["voice"],
        int(settings["target_seconds"]),
    )
    _write_json(output_dir / "audio_manifest.json", audio_asset.to_json_dict())

    retimed_chunks = retime_chunks(chunks, audio_asset.duration_seconds)
    write_srt(output_dir / "subtitles.zh-CN.srt", retimed_chunks)

    video_asset = None
    if not skip_video:
        video_asset = render_video(
            story.title,
            selected_images,
            audio_asset,
            output_dir,
            int(settings["width"]),
            int(settings["height"]),
            background_music=background_music,
            music_volume=music_volume,
        )
        _write_json(output_dir / "video_manifest.json", video_asset.to_json_dict())

    write_attribution_files(output_dir, story, selected_images, audio_asset, video_asset)
    plan = GenerationPlan(
        title=story.title,
        source_story_path=output_dir / "story_input.txt",
        output_dir=output_dir,
        target_seconds=int(settings["target_seconds"]),
        target_words=int(settings["target_words"]),
        story_words=len(story.text.split()),
        selected_words=len(project["excerpt"].split()),
        chunk_count=len(chunks),
        image_count=len(selected_images),
        audio_seconds=audio_asset.duration_seconds,
        video_seconds=video_asset.duration_seconds if video_asset else 0.0,
        width=int(settings["width"]),
        height=int(settings["height"]),
        artifacts={
            "run_plan": "run_plan.json",
            "selected_story": "selected_story.txt",
            "narration_script": "narration.zh-CN.txt",
            "subtitles": "subtitles.zh-CN.srt",
            "prompts": "prompts.json",
            "image_candidates": "image_candidates_manifest.json",
            "image_manifest": "image_manifest.json",
            "audio_manifest": "audio_manifest.json",
            "video_manifest": "video_manifest.json" if video_asset else "",
            "credits": "credits.txt",
            "license_manifest": "license_manifest.json",
        },
    )
    _write_json(output_dir / "run_plan.json", plan.to_json_dict())
    return {
        "output_dir": str(output_dir),
        "video_path": str(video_asset.local_path) if video_asset else "",
        "run_plan": str(output_dir / "run_plan.json"),
    }


def add_manual_image_candidate(output_dir: Path, chunk_index: int, source_path: Path) -> dict[str, object]:
    project_path = output_dir / "interactive_project.json"
    if not project_path.is_file():
        raise FileNotFoundError(f"Interactive project does not exist: {project_path}")
    if not source_path.is_file():
        raise FileNotFoundError(f"Manual image file does not exist: {source_path}")
    if not _is_supported_image(source_path):
        raise ValueError(f"Manual image must be a supported image file: {source_path}")

    project = json.loads(project_path.read_text(encoding="utf-8"))
    chunk = _chunk_by_index(project["chunks"], chunk_index)
    manual_dir = output_dir / "manual_images"
    manual_dir.mkdir(parents=True, exist_ok=True)
    candidate_index = _next_candidate_index(chunk)
    target_path = manual_dir / f"chunk_{chunk_index:03}_manual_{candidate_index:03}{source_path.suffix.lower()}"
    shutil.copyfile(source_path, target_path)

    candidate = {
        "chunk_index": chunk_index,
        "candidate_index": candidate_index,
        "prompt": f"manual image: {source_path.name}",
        "asset": {
            "index": chunk_index,
            "prompt": f"manual image: {source_path.name}",
            "local_path": str(target_path),
            "source_url": str(source_path),
            "creator": "manual upload",
            "license_name": "user-provided",
            "license_url": "",
            "provider": "manual",
            "title": source_path.name,
            "width": None,
            "height": None,
        },
        "error": "",
    }
    chunk["image_candidates"].append(candidate)
    _write_json(project_path, project)
    _write_json(output_dir / "image_candidates_manifest.json", [chunk["image_candidates"] for chunk in project["chunks"]])
    _write_json(output_dir / "prompts.json", project["chunks"])
    return {"project": project, "candidate": candidate}


def _fetch_image_candidates(
    chunks: list[StoryChunk],
    prompt_groups: list[list[str]],
    provider: ImageProvider,
    output_dir: Path,
    max_workers: int,
    progress_callback: ProgressCallback | None = None,
) -> list[list[dict[str, object]]]:
    image_dir = output_dir / "image_candidates"
    tasks: dict[object, tuple[int, int, str]] = {}
    prompt_count = sum(len(prompts) for prompts in prompt_groups)
    workers = max(1, min(max_workers, prompt_count or 1))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for chunk, prompts in zip(chunks, prompt_groups):
            for candidate_index, prompt in enumerate(prompts, start=1):
                fetch_index = chunk.index * 100 + candidate_index
                future = executor.submit(provider.fetch_image, prompt, image_dir, fetch_index)
                tasks[future] = (chunk.index, candidate_index, prompt)

        results: dict[tuple[int, int], dict[str, object]] = {}
        for future in as_completed(tasks):
            chunk_index, candidate_index, prompt = tasks[future]
            try:
                asset = future.result()
                results[(chunk_index, candidate_index)] = {
                    "chunk_index": chunk_index,
                    "candidate_index": candidate_index,
                    "prompt": prompt,
                    "asset": asset.to_json_dict(),
                    "error": "",
                }
            except Exception as exc:
                results[(chunk_index, candidate_index)] = {
                    "chunk_index": chunk_index,
                    "candidate_index": candidate_index,
                    "prompt": prompt,
                    "asset": None,
                    "error": str(exc),
                }
            if progress_callback:
                progress_callback({"type": "candidate", "candidate": results[(chunk_index, candidate_index)]})

    grouped: list[list[dict[str, object]]] = []
    for chunk, prompts in zip(chunks, prompt_groups):
        grouped.append([results[(chunk.index, index)] for index in range(1, len(prompts) + 1)])
    return grouped


def _pending_image_candidates(
    chunks: list[StoryChunk],
    prompt_groups: list[list[str]],
) -> list[list[dict[str, object]]]:
    return [
        [
            {
                "chunk_index": chunk.index,
                "candidate_index": candidate_index,
                "prompt": prompt,
                "asset": None,
                "error": "pending",
            }
            for candidate_index, prompt in enumerate(prompts, start=1)
        ]
        for chunk, prompts in zip(chunks, prompt_groups)
    ]


def _project_manifest(
    settings: InteractiveSettings,
    story: Story,
    excerpt: str,
    chunks: list[StoryChunk],
    prompt_groups: list[list[str]],
    candidates: list[list[dict[str, object]]],
) -> dict[str, object]:
    return {
        "story": {
            "title": story.title,
            "text": story.text,
            "source_url": story.source_url,
            "author": story.author,
            "license_name": story.license_name,
        },
        "excerpt": excerpt,
        "settings": {
            "target_seconds": settings.target_seconds,
            "target_words": settings.target_words,
            "width": settings.width,
            "height": settings.height,
            "words_per_minute": settings.words_per_minute,
            "chunk_seconds": settings.chunk_seconds,
            "translator": settings.translator,
            "translation_model": settings.translation_model,
            "prompt_provider": settings.prompt_provider,
            "prompt_model": settings.prompt_model,
            "image_provider": settings.image_provider,
            "image_model": settings.image_model,
            "image_workers": settings.image_workers,
            "candidates_per_chunk": settings.candidates_per_chunk,
            "tts_provider": settings.tts_provider,
            "voice": settings.voice,
        },
        "chunks": [
            {
                "index": chunk.index,
                "text": chunk.text,
                "subtitle_text": chunk.subtitle_text,
                "start_seconds": chunk.start_seconds,
                "end_seconds": chunk.end_seconds,
                "prompt_candidates": prompts,
                "image_candidates": candidate_group,
            }
            for chunk, prompts, candidate_group in zip(chunks, prompt_groups, candidates)
        ],
    }


def _chunk_from_json(data: dict[str, object]) -> StoryChunk:
    return StoryChunk(
        index=int(data["index"]),
        text=str(data["text"]),
        subtitle_text=str(data.get("subtitle_text") or ""),
        start_seconds=float(data["start_seconds"]),
        end_seconds=float(data["end_seconds"]),
        image_prompt=str((data.get("prompt_candidates") or [""])[0]),
    )


def _selected_images(chunk_data: list[dict[str, object]], selections: dict[int, int]) -> list[ImageAsset]:
    selected = []
    for chunk in chunk_data:
        chunk_index = int(chunk["index"])
        candidate_index = selections.get(chunk_index) or _first_available_candidate(chunk)
        candidate = _candidate_by_index(chunk, candidate_index)
        asset_data = candidate.get("asset")
        if not isinstance(asset_data, dict):
            raise LookupError(f"No downloaded image for chunk {chunk_index}, candidate {candidate_index}.")
        selected.append(_image_asset_from_json(asset_data, chunk_index))
    return selected


def _first_available_candidate(chunk: dict[str, object]) -> int:
    for candidate in chunk.get("image_candidates", []):
        if isinstance(candidate, dict) and isinstance(candidate.get("asset"), dict):
            return int(candidate["candidate_index"])
    raise LookupError(f"No downloaded image candidates for chunk {chunk['index']}.")


def _candidate_by_index(chunk: dict[str, object], candidate_index: int) -> dict[str, object]:
    for candidate in chunk.get("image_candidates", []):
        if isinstance(candidate, dict) and int(candidate["candidate_index"]) == candidate_index:
            return candidate
    raise LookupError(f"Unknown image candidate {candidate_index} for chunk {chunk['index']}.")


def _chunk_by_index(chunks: list[dict[str, object]], chunk_index: int) -> dict[str, object]:
    for chunk in chunks:
        if int(chunk["index"]) == chunk_index:
            return chunk
    raise LookupError(f"Unknown chunk index: {chunk_index}")


def _next_candidate_index(chunk: dict[str, object]) -> int:
    indexes = [
        int(candidate["candidate_index"])
        for candidate in chunk.get("image_candidates", [])
        if isinstance(candidate, dict) and "candidate_index" in candidate
    ]
    return max(indexes, default=0) + 1


def _is_supported_image(path: Path) -> bool:
    content_type = mimetypes.guess_type(path.name)[0] or ""
    return content_type.startswith("image/")


def _image_asset_from_json(data: dict[str, object], index: int) -> ImageAsset:
    return ImageAsset(
        index=index,
        prompt=str(data["prompt"]),
        local_path=Path(str(data["local_path"])),
        source_url=str(data.get("source_url") or ""),
        creator=str(data.get("creator") or "unknown"),
        license_name=str(data.get("license_name") or "unknown"),
        license_url=str(data.get("license_url") or ""),
        provider=str(data.get("provider") or "unknown"),
        title=str(data.get("title") or "") or None,
        width=int(data["width"]) if data.get("width") is not None else None,
        height=int(data["height"]) if data.get("height") is not None else None,
    )


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
