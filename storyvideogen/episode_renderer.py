from __future__ import annotations

import json
import hashlib
import math
import subprocess
from pathlib import Path
from typing import Any

from .media import probe_duration
from .models import AudioAsset, ImageAsset, StoryChunk
from .render.ffmpeg_renderer import render_scene_video
from .render.srt_writer import split_subtitle_cues, write_srt
from .tts.providers import build_tts_provider


def render_episode(request: dict[str, Any]) -> dict[str, Any]:
    root = Path(str(request["storageRoot"])).resolve(); values = request["input"]; scenes = values.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Render request requires scenes.")
    story_id = str(request.get("storyId") or "unknown"); provider_name = str(values.get("ttsProvider") or "silent").strip().lower(); voice = str(values.get("voice") or "zh-CN-XiaoxiaoNeural").strip(); provider = build_tts_provider(provider_name); audio_extension = "mp3" if provider_name == "edge" else "wav"; audio_mime = "audio/mpeg" if provider_name == "edge" else "audio/wav"; cache_root = root.parent / "_audio_cache" / story_id; cache_root.mkdir(parents=True, exist_ok=True); chunks: list[StoryChunk] = []; images: list[ImageAsset] = []; audio_paths: list[Path] = []; durations: list[float] = []; cursor = 0.0
    for index, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict) or not isinstance(scene.get("id"), str) or not isinstance(scene.get("narrationText"), str) or not isinstance(scene.get("imagePath"), str):
            raise ValueError("Render scene is invalid.")
        duration_target = max(2, min(30, math.ceil(max(1, len(scene["narrationText"])) / 12)))
        cache_key = hashlib.sha256(json.dumps({"text": scene["narrationText"], "provider": provider_name, "voice": voice, "speed": 1}, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest(); scene_audio = cache_root / f"{cache_key}.{audio_extension}"
        if not scene_audio.is_file():
            generated = provider.synthesize(scene["narrationText"], root / "audio" / scene["id"], voice, duration_target)
            generated.local_path.replace(scene_audio)
        duration = probe_duration(scene_audio); audio_paths.append(scene_audio); durations.append(duration)
        chunks.append(StoryChunk(index=index, text=scene["narrationText"], subtitle_text=scene["narrationText"], start_seconds=cursor, end_seconds=cursor + duration)); cursor += duration
        image_path = Path(scene["imagePath"]).resolve()
        if not image_path.is_file(): raise ValueError("Selected scene image is missing.")
        images.append(ImageAsset(index=index, prompt="", local_path=image_path, source_url=str(scene.get("sourceUrl") or ""), creator=str(scene.get("attributionText") or ""), license_name=str(scene.get("licenseCode") or ""), license_url="", provider=str(scene.get("provider") or "unknown")))
    narration_path = root / f"narration.{audio_extension}"; _concat_audio(audio_paths, narration_path); audio = AudioAsset(local_path=narration_path, duration_seconds=probe_duration(narration_path), provider=provider_name, voice=voice)
    subtitle_path = root / "subtitles.zh-CN.srt"; write_srt(subtitle_path, split_subtitle_cues(chunks)); narration_text_path = root / "narration.zh-CN.txt"; narration_text_path.write_text("\n\n".join(chunk.text for chunk in chunks), encoding="utf-8")
    music_path = Path(values["musicPath"]).resolve() if isinstance(values.get("musicPath"), str) and values["musicPath"] else None
    video = render_scene_video(images, durations, audio, root, 1920, 1080, background_music=music_path, music_volume=float(values.get("musicVolume", 0.18)), subtitle_path=subtitle_path)
    credits_path = root / "credits.json"; credits_path.write_text(json.dumps({"images": [{"provider": image.provider, "sourceUrl": image.source_url, "creator": image.creator, "license": image.license_name} for image in images]}, ensure_ascii=False), encoding="utf-8")
    return {"contractVersion": 1, "durationMs": round(video.duration_seconds * 1000), "width": 1920, "height": 1080, "subtitlesBurnedIn": True, "outputs": [{"kind": "video", "file": "video.mp4", "mimeType": "video/mp4", "extension": "mp4", "width": 1920, "height": 1080, "durationMs": round(video.duration_seconds * 1000)}, {"kind": "audio", "file": narration_path.name, "mimeType": audio_mime, "extension": audio_extension, "durationMs": round(audio.duration_seconds * 1000)}, {"kind": "subtitle", "file": "subtitles.zh-CN.srt", "mimeType": "text/plain; charset=utf-8", "extension": "srt"}, {"kind": "manifest", "file": "credits.json", "mimeType": "application/json", "extension": "json"}, {"kind": "credits", "file": "narration.zh-CN.txt", "mimeType": "text/plain; charset=utf-8", "extension": "txt"}]}


def _concat_audio(paths: list[Path], output: Path) -> None:
    manifest = output.with_name("audio-concat.txt"); manifest.write_text("".join(f"file '{str(path.resolve()).replace(chr(92), '/')}'\n" for path in paths), encoding="utf-8")
    result = subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(manifest), "-c", "copy", str(output)], text=True, capture_output=True, check=False)
    if result.returncode != 0: raise RuntimeError("ffmpeg failed to concatenate scene narration.")
