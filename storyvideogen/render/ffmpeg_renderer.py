from __future__ import annotations

import subprocess
import tempfile
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

    with tempfile.TemporaryDirectory(prefix="storyvideogen_segments_", dir=output_dir) as temp_name:
        temp_dir = Path(temp_name)
        segments = [
            _render_title_segment(title_file, temp_dir / "segment_000.mp4", title_duration, width, height, fps)
        ]
        for position, (image, duration) in enumerate(zip(images, image_durations), start=1):
            segments.append(
                _render_image_segment(
                    image.local_path,
                    temp_dir / f"segment_{position:03}.mp4",
                    duration,
                    width,
                    height,
                    fps,
                )
            )

        video_only_path = _concat_segments(segments, temp_dir / "video_only.mp4")
        _mux_audio(
            video_only_path,
            audio,
            video_path,
            background_music=background_music,
            music_volume=music_volume,
        )

    return VideoAsset(
        local_path=video_path,
        duration_seconds=probe_duration(video_path),
        width=width,
        height=height,
    )


def render_scene_video(images: list[ImageAsset], durations: list[float], audio: AudioAsset, output_dir: Path, width: int, height: int, background_music: Path | None = None, music_volume: float = 0.18, subtitle_path: Path | None = None) -> VideoAsset:
    if not images or len(images) != len(durations) or any(duration <= 0 for duration in durations):
        raise ValueError("Scene images and durations must be non-empty and aligned.")
    if subtitle_path is not None and not subtitle_path.is_file():
        raise FileNotFoundError(f"Subtitle file does not exist: {subtitle_path}")
    require_executable("ffmpeg"); output_dir = output_dir.resolve(); output_dir.mkdir(parents=True, exist_ok=True); video_path = output_dir / "video.mp4"; fps = 30
    with tempfile.TemporaryDirectory(prefix="storyvideogen_segments_", dir=output_dir) as temp_name:
        temp_dir = Path(temp_name); segments = [_render_image_segment(image.local_path, temp_dir / f"segment_{position:03}.mp4", duration, width, height, fps) for position, (image, duration) in enumerate(zip(images, durations), start=1)]; video_only = _concat_segments(segments, temp_dir / "video_only.mp4"); _mux_audio(video_only, audio, video_path, background_music=background_music, music_volume=music_volume, subtitle_path=subtitle_path)
    return VideoAsset(local_path=video_path, duration_seconds=probe_duration(video_path), width=width, height=height)


def _render_title_segment(
    title_file: Path,
    output_path: Path,
    duration: float,
    width: int,
    height: int,
    fps: int,
) -> Path:
    command = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-t",
        f"{duration:.3f}",
        "-i",
        f"color=c=0x101014:s={width}x{height}:r={fps}",
        "-vf",
        (
            "drawtext=textfile=title_card.txt:fontcolor=white:fontsize=72:"
            f"x=(w-text_w)/2:y=(h-text_h)/2,setsar=1,format=yuv420p"
        ),
        "-r",
        str(fps),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-an",
        str(output_path),
    ]
    _run_ffmpeg(command, "render title segment", cwd=title_file.parent)
    return output_path


def _render_image_segment(
    image_path: Path,
    output_path: Path,
    duration: float,
    width: int,
    height: int,
    fps: int,
) -> Path:
    frames = max(1, round(duration * fps))
    command = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(image_path.resolve()),
        "-vf",
        (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},zoompan=z='min(zoom+0.0007,1.08)':"
            f"d={frames}:s={width}x{height}:fps={fps},setpts=N/({fps}*TB),"
            f"setsar=1,format=yuv420p"
        ),
        "-frames:v",
        str(frames),
        "-r",
        str(fps),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-an",
        str(output_path),
    ]
    _run_ffmpeg(command, f"render image segment {image_path.name}")
    return output_path


def _concat_segments(segments: list[Path], output_path: Path) -> Path:
    concat_file = output_path.with_name("concat.txt")
    concat_file.write_text(
        "".join(f"file '{_concat_file_path(segment)}'\n" for segment in segments),
        encoding="utf-8",
    )
    command = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_file),
        "-c",
        "copy",
        str(output_path),
    ]
    _run_ffmpeg(command, "concatenate video segments")
    return output_path


def _mux_audio(
    video_only_path: Path,
    audio: AudioAsset,
    output_path: Path,
    background_music: Path | None,
    music_volume: float,
    subtitle_path: Path | None = None,
) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_only_path.resolve()),
        "-i",
        str(audio.local_path.resolve()),
    ]
    audio_map = "1:a"
    if background_music is not None:
        safe_volume = max(0.0, min(music_volume, 1.0))
        command.extend(["-stream_loop", "-1", "-i", str(background_music.resolve())])
        command.extend(
            [
                "-filter_complex",
                (
                    "[1:a]asetpts=PTS-STARTPTS[narration];"
                    f"[2:a]volume={safe_volume:.3f},"
                    f"atrim=0:{audio.duration_seconds:.3f},asetpts=PTS-STARTPTS[music];"
                    "[narration][music]amix=inputs=2:duration=first:dropout_transition=0[a]"
                ),
            ]
        )
        audio_map = "[a]"

    command.extend(["-map", "0:v", "-map", audio_map])
    if subtitle_path is None:
        command.extend(["-c:v", "copy"])
    else:
        command.extend([
            "-vf",
            "subtitles=subtitles.zh-CN.srt:force_style='FontName=Noto Sans CJK SC,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=24,Alignment=2'",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
        ])
    command.extend(["-c:a", "aac", "-shortest", str(output_path)])
    _run_ffmpeg(command, "mux narration, subtitles, and background music", cwd=subtitle_path.parent if subtitle_path is not None else None)


def _run_ffmpeg(command: list[str], stage: str, cwd: Path | None = None) -> None:
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed to {stage}: {result.stderr.strip()}")


def _concat_file_path(path: Path) -> str:
    return str(path.resolve()).replace("\\", "/").replace("'", "'\\''")


def _title_duration(audio_seconds: float) -> float:
    if audio_seconds <= 8:
        return 1.0
    return min(3.0, audio_seconds * 0.12)


def _image_durations(images: list[ImageAsset], total_seconds: float) -> list[float]:
    if not images:
        return []
    duration = total_seconds / len(images)
    return [duration for _image in images]
