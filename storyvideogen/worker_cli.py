from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from .full_story_planner import plan_full_story
from .image_search.providers import build_image_provider
from .episode_renderer import render_episode

CONTRACT_VERSION = 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="storyvideogen-worker")
    parser.add_argument("operation", choices=("plan_story", "generate_images", "generate_audio", "render_video", "import_legacy"))
    parser.add_argument("--request", required=True)
    args = parser.parse_args(argv)
    request = load_request(Path(args.request), args.operation)
    fixture = str(request["input"].get("fixture", "success"))
    job_id = str(request["jobId"])
    if fixture == "invalid_json":
        print("this is not json", flush=True)
        return 0
    if fixture == "crash":
        print("api_key=synthetic-credential-must-be-redacted", file=sys.stderr, flush=True)
        return 2
    if fixture == "timeout":
        time.sleep(30)
        return 0
    sequence = 0

    def send(event_type: str, payload: dict[str, Any]) -> None:
        nonlocal sequence
        sequence += 1
        emit(job_id, sequence, event_type, payload)

    send("stage_started", {"operation": args.operation})
    if fixture == "malicious_path":
        send("asset_created", {"storageKey": "../../outside.txt"})
    source_text = request["input"].get("sourceText")
    if args.operation == "plan_story" and isinstance(source_text, str):
        send("progress", {"progress": 2500})
        plan = plan_full_story(source_text, provider=str(request["input"].get("provider", "fixture")), model=str(request["input"].get("model", "glm-5.2")), require_llm=bool(request["input"].get("requireLlm", False)), target_scene_seconds=request["input"].get("chunkSeconds", 30))
        result = {"contractVersion": 1, "storyId": request.get("storyId"), **plan}
        result_file = Path(str(request["storageRoot"])) / "plan.json"
        result_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        send("progress", {"progress": 9000})
        send("completed", {"operation": args.operation, "resultFile": "plan.json"})
    elif args.operation == "generate_images":
        send("progress", {"progress": 1000})
        candidate_ids = request["input"].get("candidateIds")
        prompt = request["input"].get("prompt")
        if not isinstance(candidate_ids, list) or not 1 <= len(candidate_ids) <= 4 or not all(isinstance(value, str) for value in candidate_ids) or not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("Image generation request is invalid.")
        provider = build_image_provider(
            str(request["input"].get("provider", "fixture")),
            model=str(request["input"].get("queryModel") or request["input"].get("model") or "cogview-3-flash"),
        )
        stop_after_first_success = bool(request["input"].get("stopAfterFirstSuccess", False))
        image_dir = Path(str(request["storageRoot"])) / "images"
        candidates: list[dict[str, object]] = []
        for index, candidate_id in enumerate(candidate_ids):
            if stop_after_first_success and any(candidate["status"] == "ready" for candidate in candidates):
                candidates.append({"candidateId": candidate_id, "status": "failed", "error": "Skipped after auto mode found a usable image."})
                send("progress", {"progress": 1000 + round(8000 * (index + 1) / len(candidate_ids))})
                continue
            if fixture == "slow_success":
                time.sleep(2)
            try:
                if fixture == "slow_success" and index == 0:
                    raise RuntimeError("Synthetic slow first-candidate failure.")
                asset = provider.fetch_image(prompt, image_dir, index)
                candidates.append({"candidateId": candidate_id, "status": "ready", "file": str(asset.local_path.relative_to(Path(str(request["storageRoot"])))), "sourceUrl": asset.source_url, "creator": asset.creator, "licenseName": asset.license_name, "licenseUrl": asset.license_url})
            except Exception as exc:
                candidates.append({"candidateId": candidate_id, "status": "failed", "error": provider_error_message(exc)})
            send("progress", {"progress": 1000 + round(8000 * (index + 1) / len(candidate_ids))})
        result_file = Path(str(request["storageRoot"])) / "images.json"
        result_file.write_text(json.dumps({"contractVersion": 1, "storyId": request.get("storyId"), "candidates": candidates}, ensure_ascii=False), encoding="utf-8")
        send("completed", {"operation": args.operation, "resultFile": "images.json"})
    elif args.operation == "render_video":
        send("progress", {"progress": 1000})
        result = render_episode(request)
        result_file = Path(str(request["storageRoot"])) / "render.json"
        result_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        send("progress", {"progress": 9000})
        send("completed", {"operation": args.operation, "resultFile": "render.json"})
    else:
        send("progress", {"progress": 5000})
        send("completed", {"operation": args.operation})
    if fixture == "duplicate_completion":
        send("completed", {"operation": args.operation})
    return 0


def provider_error_message(error: Exception) -> str:
    message = " ".join(str(error).split()) or type(error).__name__
    message = re.sub(r"(?i)(authorization|api[_ -]?key)\s*[=:]\s*\S+", r"\1=[redacted]", message)
    return f"Image provider failed: {message[:400]}"


def load_request(request_path: Path, operation: str) -> dict[str, Any]:
    value = json.loads(request_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("contractVersion") != CONTRACT_VERSION:
        raise ValueError("Unsupported worker contract version.")
    if value.get("operation") != operation or not isinstance(value.get("jobId"), str):
        raise ValueError("Worker request envelope is invalid.")
    if not isinstance(value.get("input"), dict) or not isinstance(value.get("settings"), dict):
        raise ValueError("Worker request input is invalid.")
    storage_root = Path(str(value.get("storageRoot", ""))).resolve()
    if request_path.resolve().parent != storage_root:
        raise ValueError("Worker request is outside its assigned storage root.")
    return value


def emit(job_id: str, sequence: int, event_type: str, payload: dict[str, Any]) -> None:
    print(json.dumps({"contractVersion": CONTRACT_VERSION, "jobId": job_id, "sequence": sequence, "type": event_type, "payload": payload}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
