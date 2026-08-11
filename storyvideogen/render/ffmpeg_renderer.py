from __future__ import annotations

import subprocess
from pathlib import Path

from storyvideogen.media import probe_duration, require_executable
from storyvideogen.models import AudioAsset, ImageAsset, VideoAsset


def render_video(
    title: str,
    images: list[ImageAsset],
    audio: AudioAsset,
    output_dir: Path,
    width: int,
    height: int,
    background_music: Path | None = None,
    music_volume: float = 0.18,
) -> VideoAsset:
    if not images:
        raise ValueError("At least one image is required to render video.")
    if background_music is not None and not background_music.is_file():
        raise FileNotFoundError(f"Background music file does not exist: {background_music}")

    require_executable("ffmpeg")
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    title_file = output_dir / "title_card.txt"
    title_file.write_text(title, encoding="utf-8")
    video_path = output_dir / "video.mp4"

    fps = 30
    title_duration = _title_duration(audio.duration_seconds)
    image_total_duration = max(1.0, audio.duration_seconds - title_duration)
    image_durations = _image_durations(images, image_total_duration)

    command = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-t",
        f"{title_duration:.3f}",
        "-i",
        f"color=c=0x101014:s={width}x{height}:r={fps}",
    ]
    for image in images:
        command.extend(["-i", str(image.local_path.resolve())])
    command.extend(["-i", str(audio.local_path.resolve())])
    if background_music is not None:
        command.extend(["-stream_loop", "-1", "-i", str(background_music.resolve())])

    filter_parts = [
        (
            f"[0:v]drawtext=textfile=title_card.txt:fontcolor=white:fontsize=72:"
            f"x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p[v0]"
        )
    ]
    concat_inputs = ["[v0]"]
    for position, duration in enumerate(image_durations, start=1):
        frames = max(1, round(duration * fps))
        filter_parts.append(
            (
                f"[{position}:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
                f"crop={width}:{height},zoompan=z='min(zoom+0.0007,1.08)':"
                f"d={frames}:s={width}x{height}:fps={fps},setpts=PTS-STARTPTS,"
                f"setsar=1,format=yuv420p[v{position}]"
            )
        )
        concat_inputs.append(f"[v{position}]")

    filter_parts.append(f"{''.join(concat_inputs)}concat=n={len(concat_inputs)}:v=1:a=0[v]")
    audio_index = len(images) + 1
    audio_map = f"{audio_index}:a"
    if background_music is not None:
        music_index = audio_index + 1
        safe_volume = max(0.0, min(music_volume, 1.0))
        filter_parts.extend(
            [
                f"[{audio_index}:a]asetpts=PTS-STARTPTS[narration]",
                (
                    f"[{music_index}:a]volume={safe_volume:.3f},"
                    f"atrim=0:{audio.duration_seconds:.3f},asetpts=PTS-STARTPTS[music]"
                ),
                "[narration][music]amix=inputs=2:duration=first:dropout_transition=0[a]",
            ]
        )
        audio_map = "[a]"

    command.extend(
        [
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            "[v]",
            "-map",
            audio_map,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(video_path),
        ]
    )

    result = subprocess.run(
        command,
        cwd=output_dir,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to render video: {result.stderr.strip()}")

    return VideoAsset(
        local_path=video_path,
        duration_seconds=probe_duration(video_path),
        width=width,
        height=height,
    )


def _title_duration(audio_seconds: float) -> float:
    if audio_seconds <= 8:
        return 1.0
    return min(3.0, audio_seconds * 0.12)


def _image_durations(images: list[ImageAsset], total_seconds: float) -> list[float]:
    if not images:
        return []
    duration = total_seconds / len(images)
    return [duration for _image in images]
