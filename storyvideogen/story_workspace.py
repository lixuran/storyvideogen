from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_WORKSPACE = Path("output/ui_stories")
PROJECT_FILE = "interactive_project.json"
SESSION_FILE = "story_session.json"


def normalize_tag(value: object, fallback: str = "story") -> str:
    text = str(value or "").strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "-", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    text = text.strip(" .-")
    if not text:
        text = fallback
    return text[:80]


def story_output_dir(workspace: Path, tag: object) -> Path:
    return workspace / normalize_tag(tag)


def create_story_session(workspace: Path, tag: object, title: object = "", story_text: object = "") -> dict[str, object]:
    normalized_tag = normalize_tag(tag)
    output_dir = story_output_dir(workspace, normalized_tag)
    session_path = output_dir / SESSION_FILE
    if session_path.exists() or (output_dir.exists() and any(output_dir.iterdir())):
        raise FileExistsError(f"Story tag already exists: {normalized_tag}")
    return write_story_session(
        output_dir,
        tag=normalized_tag,
        title=str(title or normalized_tag),
        story_text=str(story_text or ""),
        status="draft",
        message="Story draft created.",
    )


def write_story_session(
    output_dir: Path,
    *,
    tag: object | None = None,
    title: object | None = None,
    story_text: object | None = None,
    status: object | None = None,
    message: object | None = None,
    job_id: object | None = None,
    error: object | None = None,
    video_path: object | None = None,
    settings: dict[str, object] | None = None,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    session = _read_session(output_dir) or _new_session(output_dir)
    updates = {
        "tag": normalize_tag(tag, fallback=str(session.get("tag") or output_dir.name)) if tag is not None else None,
        "title": str(title) if title is not None else None,
        "story_text": str(story_text) if story_text is not None else None,
        "status": str(status) if status is not None else None,
        "message": str(message) if message is not None else None,
        "job_id": str(job_id) if job_id is not None else None,
        "error": str(error) if error is not None else None,
        "video_path": str(video_path) if video_path is not None else None,
        "settings": settings,
    }
    for key, value in updates.items():
        if value is not None:
            session[key] = value
    session["output_dir"] = str(output_dir)
    session["updated_at"] = _now()
    _write_json(output_dir / SESSION_FILE, session)
    return story_summary(output_dir)


def list_stories(workspace: Path, active_jobs: list[dict[str, object]] | None = None) -> list[dict[str, object]]:
    workspace.mkdir(parents=True, exist_ok=True)
    active_by_output = {
        str(Path(str(job.get("output_dir") or ""))): job
        for job in active_jobs or []
        if job.get("output_dir")
    }
    output_dirs = {
        path
        for path in workspace.iterdir()
        if path.is_dir() and ((path / SESSION_FILE).exists() or (path / PROJECT_FILE).exists())
    }
    output_dirs.update(Path(output_dir) for output_dir in active_by_output)
    stories = [story_summary(path, active_by_output.get(str(path))) for path in output_dirs]
    return sorted(stories, key=lambda story: str(story.get("updated_at") or ""), reverse=True)


def load_story_payload(output_dir: Path, active_job: dict[str, object] | None = None) -> dict[str, object]:
    project = active_job.get("project") if active_job and active_job.get("status") == "running" else None
    if not isinstance(project, dict):
        project = _read_json(output_dir / PROJECT_FILE)
    return {
        "story": story_summary(output_dir, active_job),
        "project": project,
    }


def story_summary(output_dir: Path, active_job: dict[str, object] | None = None) -> dict[str, object]:
    session = _read_session(output_dir) or _new_session(output_dir)
    project = _read_json(output_dir / PROJECT_FILE)
    if isinstance(project, dict):
        story = project.get("story")
        settings = project.get("settings")
        if isinstance(story, dict):
            session["title"] = str(story.get("title") or session.get("title") or output_dir.name)
            session["story_text"] = str(story.get("text") or session.get("story_text") or "")
        if isinstance(settings, dict):
            session["settings"] = settings
        if str(session.get("status") or "") in {"draft", "preparing"}:
            session["status"] = "prepared"
            session["message"] = "Image candidates prepared."

    video_manifest = _read_json(output_dir / "video_manifest.json")
    if isinstance(video_manifest, dict):
        session["status"] = "composed"
        session["video_path"] = str(video_manifest.get("local_path") or session.get("video_path") or "")
        session["message"] = "Video composed."

    if active_job:
        session["job_id"] = str(active_job.get("job_id") or session.get("job_id") or "")
        session["message"] = str(active_job.get("message") or session.get("message") or "")
        session["error"] = str(active_job.get("error") or "")
        job_status = str(active_job.get("status") or "")
        if job_status == "queued":
            session["status"] = "queued"
        elif job_status == "running":
            message = str(active_job.get("message") or "")
            session["status"] = "composing" if "Composing" in message or "compose" in message.lower() else "preparing"
        elif job_status == "failed":
            session["status"] = "failed"
        elif job_status == "complete" and session.get("status") != "composed":
            session["status"] = "prepared"

    session["output_dir"] = str(output_dir)
    session["tag"] = normalize_tag(session.get("tag") or output_dir.name)
    session.setdefault("title", session["tag"])
    session.setdefault("story_text", "")
    session.setdefault("status", "draft")
    session.setdefault("message", "")
    session.setdefault("error", "")
    session.setdefault("job_id", "")
    session.setdefault("video_path", "")
    session.setdefault("created_at", _now())
    session.setdefault("updated_at", session["created_at"])
    return session


def _new_session(output_dir: Path) -> dict[str, object]:
    now = _now()
    tag = normalize_tag(output_dir.name)
    return {
        "tag": tag,
        "title": tag,
        "story_text": "",
        "output_dir": str(output_dir),
        "status": "draft",
        "message": "",
        "error": "",
        "job_id": "",
        "video_path": "",
        "created_at": now,
        "updated_at": now,
    }


def _read_session(output_dir: Path) -> dict[str, object] | None:
    data = _read_json(output_dir / SESSION_FILE)
    return data if isinstance(data, dict) else None


def _read_json(path: Path) -> object | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
