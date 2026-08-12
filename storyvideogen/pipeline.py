from __future__ import annotations

import json
from pathlib import Path
from dataclasses import replace

from .attribution import write_attribution_files
from .beat_splitter import retime_chunks, split_into_chunks
from .config import GenerationSettings
from .image_search.pipeline import fetch_images
from .image_search.providers import build_image_provider
from .models import GenerationPlan, StoryChunk
from .prompt_generator import add_image_prompts, build_prompt_provider, generate_prompt_candidates
from .render.ffmpeg_renderer import render_video
from .render.srt_writer import write_srt
from .story_loader import load_story, select_target_excerpt
from .subtitle_translator import build_translator, translate_chunks
from .tts.providers import build_tts_provider


def generate(settings: GenerationSettings) -> GenerationPlan:
    story = load_story(
        settings.story_path,
        settings.title,
        source_url=settings.source_url,
        author=settings.author,
        license_name=settings.story_license,
    )
    excerpt = select_target_excerpt(story.text, settings.target_words)
    selected_words = len(excerpt.split())
    chunks = split_into_chunks(
        excerpt,
        settings.target_seconds,
        settings.words_per_minute,
        max_words=_chunk_max_words(settings.words_per_minute, settings.chunk_seconds),
    )
    print(f"[plan] selected {selected_words} words across {len(chunks)} chunks")
    translated_chunks = translate_chunks(chunks, build_translator(settings.translator, settings.translation_model))
    prompt_provider = build_prompt_provider(settings.prompt_provider, settings.prompt_model)
    if _uses_generation_prompts(settings.image_provider):
        prompt_groups = generate_prompt_candidates(
            translated_chunks,
            prompt_provider,
            candidates_per_chunk=1,
            story_context=excerpt,
        )
        prompted_chunks = [
            replace(chunk, image_prompt=prompts[0])
            for chunk, prompts in zip(translated_chunks, prompt_groups)
        ]
    else:
        prompted_chunks = add_image_prompts(translated_chunks, prompt_provider)
    narration_text = _build_narration_text(prompted_chunks)

    settings.output_dir.mkdir(parents=True, exist_ok=True)
    (settings.output_dir / "selected_story.txt").write_text(excerpt + "\n", encoding="utf-8")
    (settings.output_dir / "narration.zh-CN.txt").write_text(narration_text + "\n", encoding="utf-8")
    write_srt(settings.output_dir / "subtitles.zh-CN.srt", prompted_chunks)
    _write_json(
        settings.output_dir / "prompts.json",
        [
            {
                "index": chunk.index,
                "text": chunk.text,
                "subtitle_text": chunk.subtitle_text,
                "image_prompt": chunk.image_prompt,
            }
            for chunk in prompted_chunks
        ],
    )

    image_count = 0
    audio_seconds = 0.0
    video_seconds = 0.0
    if not settings.dry_run:
        print("[stage] fetching images")
        image_assets = fetch_images(
            prompted_chunks,
            build_image_provider(settings.image_provider, settings.image_model),
            settings.output_dir,
            max_workers=settings.image_workers,
        )
        image_count = len(image_assets)
        print("[stage] generating narration")
        audio_asset = build_tts_provider(settings.tts_provider).synthesize(
            narration_text,
            settings.output_dir,
            settings.voice,
            settings.target_seconds,
        )
        audio_seconds = audio_asset.duration_seconds
        _write_json(settings.output_dir / "audio_manifest.json", audio_asset.to_json_dict())
        prompted_chunks = retime_chunks(prompted_chunks, audio_seconds)
        write_srt(settings.output_dir / "subtitles.zh-CN.srt", prompted_chunks)

        video_asset = None
        if not settings.skip_video:
            print("[stage] rendering video")
            video_asset = render_video(
                story.title,
                image_assets,
                audio_asset,
                settings.output_dir,
                settings.width,
                settings.height,
                background_music=settings.background_music,
                music_volume=settings.music_volume,
            )
            video_seconds = video_asset.duration_seconds
            _write_json(settings.output_dir / "video_manifest.json", video_asset.to_json_dict())
        write_attribution_files(settings.output_dir, story, image_assets, audio_asset, video_asset)

    plan = GenerationPlan(
        title=story.title,
        source_story_path=settings.story_path,
        output_dir=settings.output_dir,
        target_seconds=settings.target_seconds,
        target_words=settings.target_words,
        story_words=story.word_count,
        selected_words=selected_words,
        chunk_count=len(prompted_chunks),
        image_count=image_count,
        audio_seconds=audio_seconds,
        video_seconds=video_seconds,
        width=settings.width,
        height=settings.height,
        artifacts={
            "run_plan": "run_plan.json",
            "selected_story": "selected_story.txt",
            "narration_script": "narration.zh-CN.txt",
            "subtitles": "subtitles.zh-CN.srt",
            "prompts": "prompts.json",
            "image_manifest": "image_manifest.json" if image_count else "",
            "audio_manifest": "audio_manifest.json" if audio_seconds else "",
            "video_manifest": "video_manifest.json" if video_seconds else "",
            "credits": "credits.txt" if audio_seconds else "",
            "license_manifest": "license_manifest.json" if audio_seconds else "",
        },
    )
    _write_json(settings.output_dir / "run_plan.json", plan.to_json_dict())
    return plan


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _build_narration_text(chunks: list[StoryChunk]) -> str:
    lines = []
    for chunk in chunks:
        lines.append((chunk.subtitle_text or chunk.text).strip())
    return "\n\n".join(line for line in lines if line)


def _chunk_max_words(words_per_minute: int, chunk_seconds: int) -> int:
    return max(8, round(words_per_minute * max(1, chunk_seconds) / 60))


def _uses_generation_prompts(image_provider: str) -> bool:
    return image_provider.strip().lower() in {"siliconflow", "zhipu"}
