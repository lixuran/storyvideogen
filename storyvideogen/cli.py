from __future__ import annotations

import argparse
from pathlib import Path

from .config import GenerationSettings
from .pipeline import generate
from .ui_server import serve_ui


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="storyvideogen")
    subparsers = parser.add_subparsers(dest="command", required=True)

    ui_parser = subparsers.add_parser("ui", help="Start the local browser UI.")
    ui_parser.add_argument("--host", default="127.0.0.1", help="UI bind host.")
    ui_parser.add_argument("--port", type=int, default=7860, help="UI bind port.")

    generate_parser = subparsers.add_parser("generate", help="Generate a story video project.")
    generate_parser.add_argument("--story", required=True, type=Path, help="Path to the story text file.")
    generate_parser.add_argument("--title", required=True, help="English title shown on the title card.")
    generate_parser.add_argument("--out", required=True, type=Path, help="Output directory.")
    generate_parser.add_argument("--target-seconds", type=int, default=90, help="Target video duration.")
    generate_parser.add_argument("--chunk-seconds", type=int, default=30, help="Approximate duration per visual chunk.")
    generate_parser.add_argument(
        "--translator",
        choices=["google", "identity", "mock", "zai"],
        default="zai",
        help="Simplified Chinese subtitle translation provider.",
    )
    generate_parser.add_argument(
        "--translation-model",
        default="glm-5.2",
        help="ZAI model for --translator zai.",
    )
    generate_parser.add_argument(
        "--prompt-provider",
        choices=["heuristic", "llm", "zai"],
        default="zai",
        help="Image prompt generator. Use zai for model-based prompt planning.",
    )
    generate_parser.add_argument(
        "--prompt-model",
        default="glm-5.2",
        help="ZAI model for --prompt-provider zai.",
    )
    generate_parser.add_argument(
        "--image-provider",
        choices=["baidu", "fixture", "openverse", "pexels", "pixabay", "siliconflow", "wikimedia", "zhipu"],
        default="zhipu",
        help="Image source provider. Use fixture for deterministic offline testing.",
    )
    generate_parser.add_argument(
        "--image-model",
        default="cogview-3-flash",
        help="Image generation model for providers that support model selection.",
    )
    generate_parser.add_argument(
        "--image-workers",
        type=int,
        default=4,
        help="Maximum parallel workers for fetching unique image prompts.",
    )
    generate_parser.add_argument(
        "--tts-provider",
        choices=["edge", "silent"],
        default="edge",
        help="Narration provider. Use silent for deterministic offline testing.",
    )
    generate_parser.add_argument(
        "--voice",
        default="zh-CN-XiaoxiaoNeural",
        help="Voice identifier for the selected TTS provider.",
    )
    generate_parser.add_argument("--source-url", help="Story source URL for attribution.")
    generate_parser.add_argument("--author", help="Story author for attribution.")
    generate_parser.add_argument("--story-license", help="Story license for attribution.")
    generate_parser.add_argument("--background-music", type=Path, help="Optional background music file to loop under narration.")
    generate_parser.add_argument("--music-volume", type=float, default=0.18, help="Background music volume from 0.0 to 1.0.")
    generate_parser.add_argument("--skip-video", action="store_true", help="Generate non-video artifacts only.")
    generate_parser.add_argument("--dry-run", action="store_true", help="Write planning artifacts only.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "generate":
        settings = GenerationSettings(
            story_path=args.story,
            title=args.title,
            output_dir=args.out,
            target_seconds=args.target_seconds,
            chunk_seconds=args.chunk_seconds,
            translator=args.translator,
            translation_model=args.translation_model,
            prompt_provider=args.prompt_provider,
            prompt_model=args.prompt_model,
            image_provider=args.image_provider,
            image_model=args.image_model,
            image_workers=args.image_workers,
            tts_provider=args.tts_provider,
            voice=args.voice,
            source_url=args.source_url,
            author=args.author,
            story_license=args.story_license,
            background_music=args.background_music,
            music_volume=args.music_volume,
            skip_video=args.skip_video,
            dry_run=args.dry_run,
        )
        try:
            plan = generate(settings)
        except (FileNotFoundError, LookupError, RuntimeError, ValueError) as exc:
            print(f"Error: {exc}")
            return 1
        print(f"Wrote generation plan to {plan.output_dir / 'run_plan.json'}")
        return 0

    if args.command == "ui":
        serve_ui(args.host, args.port)
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2
