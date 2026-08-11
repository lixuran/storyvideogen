from __future__ import annotations

import json
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from storyvideogen.image_search.base import ImageProvider
from storyvideogen.models import ImageAsset, StoryChunk


def fetch_images(
    chunks: list[StoryChunk],
    provider: ImageProvider,
    output_dir: Path,
    max_workers: int = 4,
) -> list[ImageAsset]:
    image_dir = output_dir / "images"
    assets: list[ImageAsset] = []
    unique_prompts = _unique_prompts(chunks)
    fetched = _fetch_unique_prompts(unique_prompts, provider, image_dir, max_workers=max_workers)

    for chunk in chunks:
        prompt = chunk.image_prompt
        print(f"[images] {chunk.index}/{len(chunks)}: {prompt}")
        fetched_asset = fetched.get(prompt)
        if isinstance(fetched_asset, ImageAsset):
            provider_suffix = "cached" if unique_prompts[prompt] != chunk.index else None
            asset = _asset_for_chunk(fetched_asset, chunk.index, provider_suffix=provider_suffix)
        elif assets:
            previous = assets[-1]
            reused_path = image_dir / f"reused_{chunk.index:03}{previous.local_path.suffix}"
            shutil.copyfile(previous.local_path, reused_path)
            asset = _reuse_asset(previous, chunk.index, prompt, reused_path, provider.name)
        else:
            fallback = _first_success(fetched.values())
            if fallback:
                asset = _asset_for_chunk(fallback, chunk.index, provider_suffix="fallback")
            else:
                raise fetched_asset if isinstance(fetched_asset, Exception) else LookupError(f"No image for prompt: {prompt}")
        assets.append(asset)

    manifest = [asset.to_json_dict() for asset in assets]
    (output_dir / "image_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return assets


def _unique_prompts(chunks: list[StoryChunk]) -> dict[str, int]:
    unique: dict[str, int] = {}
    for chunk in chunks:
        unique.setdefault(chunk.image_prompt, chunk.index)
    return unique


def _fetch_unique_prompts(
    prompts: dict[str, int],
    provider: ImageProvider,
    image_dir: Path,
    max_workers: int,
) -> dict[str, ImageAsset | Exception]:
    if not prompts:
        return {}

    workers = max(1, min(max_workers, len(prompts)))
    if workers == 1:
        return {prompt: _fetch_one(provider, image_dir, prompt, index) for prompt, index in prompts.items()}

    results: dict[str, ImageAsset | Exception] = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_fetch_one, provider, image_dir, prompt, index): prompt
            for prompt, index in prompts.items()
        }
        for future in as_completed(futures):
            prompt = futures[future]
            try:
                results[prompt] = future.result()
            except Exception as exc:
                results[prompt] = exc
    return results


def _fetch_one(provider: ImageProvider, image_dir: Path, prompt: str, index: int) -> ImageAsset | Exception:
    try:
        return provider.fetch_image(prompt, image_dir, index)
    except Exception as exc:
        return exc


def _asset_for_chunk(asset: ImageAsset, index: int, provider_suffix: str | None = None) -> ImageAsset:
    provider = f"{asset.provider}:{provider_suffix}" if provider_suffix else asset.provider
    return ImageAsset(
        index=index,
        prompt=asset.prompt,
        local_path=asset.local_path,
        source_url=asset.source_url,
        creator=asset.creator,
        license_name=asset.license_name,
        license_url=asset.license_url,
        provider=provider,
        title=asset.title,
        width=asset.width,
        height=asset.height,
    )


def _reuse_asset(previous: ImageAsset, index: int, prompt: str, local_path: Path, provider_name: str) -> ImageAsset:
    return ImageAsset(
        index=index,
        prompt=prompt,
        local_path=local_path,
        source_url=previous.source_url,
        creator=previous.creator,
        license_name=previous.license_name,
        license_url=previous.license_url,
        provider=f"{provider_name}:reused",
        title=previous.title,
        width=previous.width,
        height=previous.height,
    )


def _first_success(results: object) -> ImageAsset | None:
    for result in results:
        if isinstance(result, ImageAsset):
            return result
    return None
