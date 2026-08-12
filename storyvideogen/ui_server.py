from __future__ import annotations

import copy
import cgi
import json
import mimetypes
import shutil
import threading
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .interactive_workflow import (
    InteractiveSettings,
    add_manual_image_candidate,
    compose_interactive_project,
    prepare_interactive_project,
)

_PREPARE_JOBS: dict[str, dict[str, object]] = {}
_PREPARE_LOCK = threading.Lock()


def serve_ui(host: str = "127.0.0.1", port: int = 7860) -> None:
    server = ThreadingHTTPServer((host, port), StoryVideoUIHandler)
    print(f"storyvideogen UI running at http://{host}:{port}")
    server.serve_forever()


class StoryVideoUIHandler(BaseHTTPRequestHandler):
    server_version = "storyvideogen-ui/0.1"

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self._send_text(_HTML, "text/html; charset=utf-8")
            return
        if parsed.path == "/api/asset":
            self._serve_asset(parsed.query)
            return
        if parsed.path == "/api/job":
            self._serve_job(parsed.query)
            return
        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        try:
            if self.path == "/api/prepare":
                self._handle_prepare()
                return
            if self.path == "/api/compose":
                self._handle_compose()
                return
            if self.path == "/api/manual-image":
                self._handle_manual_image()
                return
            self.send_error(404, "Not found")
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=400)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[ui] {self.address_string()} {format % args}")

    def _handle_prepare(self) -> None:
        payload = self._read_json()
        settings = InteractiveSettings(
            story_text=str(payload.get("story_text") or ""),
            title=str(payload.get("title") or ""),
            output_dir=Path(str(payload.get("output_dir") or "")),
            target_seconds=_int(payload.get("target_seconds"), 90),
            width=_int(payload.get("width"), 1920),
            height=_int(payload.get("height"), 1080),
            chunk_seconds=_int(payload.get("chunk_seconds"), 30),
            translator=str(payload.get("translator") or "zai"),
            translation_model=str(payload.get("translation_model") or "glm-5.2"),
            prompt_provider=str(payload.get("prompt_provider") or "zai"),
            prompt_model=str(payload.get("prompt_model") or "glm-5.2"),
            image_provider=str(payload.get("image_provider") or "zhipu"),
            image_model=str(payload.get("image_model") or "glm-image"),
            image_workers=_int(payload.get("image_workers"), 1),
            candidates_per_chunk=_int(payload.get("candidates_per_chunk"), 2),
            tts_provider=str(payload.get("tts_provider") or "edge"),
            voice=str(payload.get("voice") or "zh-CN-XiaoxiaoNeural"),
            source_url=_optional_text(payload.get("source_url")),
            author=_optional_text(payload.get("author")),
            story_license=_optional_text(payload.get("story_license")),
        )
        job_id = _start_prepare_job(settings)
        self._send_json({"job_id": job_id})

    def _handle_compose(self) -> None:
        payload = self._read_json()
        selections = {
            int(chunk_index): int(candidate_index)
            for chunk_index, candidate_index in dict(payload.get("selections") or {}).items()
        }
        background_music = _optional_path(payload.get("background_music"))
        result = compose_interactive_project(
            output_dir=Path(str(payload.get("output_dir") or "")),
            selections=selections,
            background_music=background_music,
            music_volume=_float(payload.get("music_volume"), 0.18),
            tts_provider=str(payload.get("tts_provider") or "edge"),
            voice=str(payload.get("voice") or "zh-CN-XiaoxiaoNeural"),
        )
        self._send_json(result)

    def _handle_manual_image(self) -> None:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        output_dir = Path(str(form.getvalue("output_dir") or ""))
        chunk_index = int(str(form.getvalue("chunk_index") or "0"))
        file_item = form["image"] if "image" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            raise ValueError("Manual image upload requires an image file.")

        upload_dir = output_dir / "manual_uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        upload_path = upload_dir / Path(str(file_item.filename)).name
        with upload_path.open("wb") as target:
            shutil.copyfileobj(file_item.file, target)

        result = add_manual_image_candidate(output_dir, chunk_index, upload_path)
        self._send_json(result)

    def _serve_asset(self, query: str) -> None:
        params = urllib.parse.parse_qs(query)
        raw_path = params.get("path", [""])[0]
        path = Path(raw_path)
        if not path.is_file():
            self.send_error(404, "Asset not found")
            return

        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_job(self, query: str) -> None:
        params = urllib.parse.parse_qs(query)
        job_id = params.get("job_id", [""])[0]
        with _PREPARE_LOCK:
            job = _PREPARE_JOBS.get(job_id)
            payload = copy.deepcopy(job) if job else None
        if payload is None:
            self._send_json({"error": "Unknown prepare job."}, status=404)
            return
        self._send_json(payload)

    def _read_json(self) -> dict[str, object]:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if not body:
            return {}
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("JSON request body must be an object.")
        return payload

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text: str, content_type: str) -> None:
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _int(value: object, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _float(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _optional_path(value: object) -> Path | None:
    text = str(value or "").strip()
    return Path(text) if text else None


def _start_prepare_job(settings: InteractiveSettings) -> str:
    job_id = uuid.uuid4().hex
    with _PREPARE_LOCK:
        _PREPARE_JOBS[job_id] = {
            "job_id": job_id,
            "status": "running",
            "message": "Preparing story and prompts...",
            "project": None,
            "error": "",
        }
    thread = threading.Thread(target=_run_prepare_job, args=(job_id, settings), daemon=True)
    thread.start()
    return job_id


def _run_prepare_job(job_id: str, settings: InteractiveSettings) -> None:
    def progress(event: dict[str, object]) -> None:
        _apply_prepare_progress(job_id, event)

    try:
        project = prepare_interactive_project(settings, progress_callback=progress)
    except Exception as exc:
        with _PREPARE_LOCK:
            _PREPARE_JOBS[job_id].update({"status": "failed", "message": "Prepare failed.", "error": str(exc)})
        return

    with _PREPARE_LOCK:
        _PREPARE_JOBS[job_id].update(
            {
                "status": "complete",
                "message": "Image preparation complete.",
                "project": project,
                "error": "",
            }
        )


def _apply_prepare_progress(job_id: str, event: dict[str, object]) -> None:
    with _PREPARE_LOCK:
        job = _PREPARE_JOBS[job_id]
        if event.get("type") == "project":
            job["project"] = event["project"]
            job["message"] = "Generating image candidates..."
        elif event.get("type") == "candidate":
            project = job.get("project")
            candidate = event.get("candidate")
            if isinstance(project, dict) and isinstance(candidate, dict):
                _replace_candidate(project, candidate)
                job["message"] = f"Generated candidate {candidate['candidate_index']} for chunk {candidate['chunk_index']}."


def _replace_candidate(project: dict[str, object], candidate: dict[str, object]) -> None:
    chunk_index = int(candidate["chunk_index"])
    candidate_index = int(candidate["candidate_index"])
    for chunk in project.get("chunks", []):
        if not isinstance(chunk, dict) or int(chunk.get("index", 0)) != chunk_index:
            continue
        for position, existing in enumerate(chunk.get("image_candidates", [])):
            if isinstance(existing, dict) and int(existing.get("candidate_index", 0)) == candidate_index:
                chunk["image_candidates"][position] = candidate
                return


_HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>storyvideogen UI</title>
  <style>
    :root {
      --ink: #201813;
      --muted: #6d625a;
      --paper: #f2eadb;
      --panel: rgba(255, 250, 238, 0.92);
      --line: #d6c7af;
      --accent: #9c3d22;
      --accent-dark: #5e2316;
      --shadow: rgba(69, 42, 24, 0.18);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(183, 89, 42, 0.22), transparent 28rem),
        radial-gradient(circle at 86% 18%, rgba(47, 75, 68, 0.18), transparent 24rem),
        linear-gradient(135deg, #efe1c9 0%, #d7c4a7 45%, #f6efe2 100%);
      min-height: 100vh;
    }

    main {
      width: min(1320px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 56px;
    }

    .hero {
      display: grid;
      gap: 8px;
      margin-bottom: 18px;
    }

    h1 {
      margin: 0;
      font-size: clamp(36px, 6vw, 76px);
      letter-spacing: -0.06em;
      line-height: 0.92;
    }

    .lede {
      max-width: 760px;
      color: var(--muted);
      font-size: 18px;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(320px, 440px) 1fr;
      gap: 18px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: 0 20px 60px var(--shadow);
      padding: 18px;
      backdrop-filter: blur(6px);
    }

    .panel h2 {
      margin: 0 0 12px;
      font-size: 24px;
      letter-spacing: -0.03em;
    }

    label {
      display: grid;
      gap: 6px;
      margin: 10px 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .hint {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      margin-top: -4px;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #fffaf0;
      color: var(--ink);
      padding: 10px 12px;
      font: 16px/1.35 Georgia, "Times New Roman", serif;
      outline: none;
    }

    textarea {
      min-height: 280px;
      resize: vertical;
    }

    .row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    button {
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: #fff8ed;
      cursor: pointer;
      font: 700 16px/1 Georgia, "Times New Roman", serif;
      padding: 13px 18px;
      box-shadow: 0 10px 24px rgba(94, 35, 22, 0.25);
    }

    button.secondary {
      background: var(--ink);
    }

    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 16px;
    }

    .status {
      margin-top: 12px;
      color: var(--accent-dark);
      white-space: pre-wrap;
    }

    .chunk {
      border-top: 1px solid var(--line);
      padding: 18px 0;
    }

    .chunk:first-child { border-top: 0; padding-top: 0; }

    .chunk h3 {
      margin: 0 0 6px;
      font-size: 20px;
    }

    .chunk p {
      color: var(--muted);
      margin: 6px 0;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }

    .chunk-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .chunk-actions button {
      background: #35534b;
      box-shadow: 0 10px 24px rgba(35, 72, 62, 0.22);
      font-size: 14px;
      padding: 10px 14px;
    }

    .candidate {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fffaf0;
      overflow: hidden;
    }

    .candidate input {
      position: absolute;
      top: 10px;
      left: 10px;
      width: auto;
      transform: scale(1.25);
      accent-color: var(--accent);
    }

    .candidate img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      background: #342a24;
    }

    .candidate .meta {
      padding: 10px;
      font-size: 14px;
    }

    .error {
      padding: 18px;
      color: #8c1f16;
      min-height: 120px;
    }

    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>storyvideogen</h1>
      <div class="lede">Prepare story chunks, generate several image candidates for each chunk, choose the visuals, then compose the final Chinese-narrated video with optional looping background music.</div>
    </section>

    <section class="grid">
      <form id="settings" class="panel">
        <h2>Project</h2>
        <label>English title <input name="title" value="Story Title"></label>
        <label>Target output directory <input name="output_dir" value="output/ui_project"></label>
        <label>Story text <textarea name="story_text" placeholder="Paste the story here..."></textarea></label>

        <h2>Generation</h2>
        <div class="row">
          <label>Target seconds <input name="target_seconds" type="number" value="90"></label>
          <label>Seconds per image chunk <input name="chunk_seconds" type="number" min="5" max="120" value="30"></label>
        </div>
        <div class="hint">Higher chunk seconds means fewer, longer visual sections. Example: 120s video at 30s per chunk gives about 4 chunks.</div>
        <div class="row">
          <label>Candidates per chunk <input name="candidates_per_chunk" type="number" min="1" max="6" value="2"></label>
          <label>Image workers <input name="image_workers" type="number" min="1" max="16" value="1"></label>
        </div>
        <div class="hint">For Zhipu, keep image workers at 1 to avoid HTTP 429 rate limits. Increase only if your quota allows it.</div>
        <div class="row">
          <label>Width <input name="width" type="number" value="1920"></label>
          <label>Height <input name="height" type="number" value="1080"></label>
        </div>

        <div class="row">
          <label>Translator
            <select name="translator">
              <option value="zai" selected>zai</option>
              <option value="google">google</option>
              <option value="mock">mock</option>
              <option value="identity">identity</option>
            </select>
          </label>
          <label>Translation model <input name="translation_model" value="glm-5.2"></label>
        </div>

        <div class="row">
          <label>Prompt provider
            <select name="prompt_provider">
              <option value="zai" selected>zai</option>
              <option value="heuristic">heuristic</option>
            </select>
          </label>
          <label>Prompt model <input name="prompt_model" value="glm-5.2"></label>
        </div>

        <div class="row">
          <label>Image provider
            <select name="image_provider">
              <option value="zhipu" selected>zhipu</option>
              <option value="siliconflow">siliconflow</option>
              <option value="baidu">baidu</option>
              <option value="pixabay">pixabay</option>
              <option value="openverse">openverse</option>
              <option value="wikimedia">wikimedia</option>
              <option value="fixture">fixture</option>
            </select>
          </label>
          <label>Image model <input name="image_model" value="glm-image"></label>
        </div>

        <div class="row">
          <label>TTS provider
            <select name="tts_provider">
              <option value="edge" selected>edge</option>
              <option value="silent">silent</option>
            </select>
          </label>
          <label>Chinese voice <input name="voice" value="zh-CN-XiaoxiaoNeural"></label>
        </div>

        <h2>Background Music</h2>
        <label>Music file path <input name="background_music" placeholder="D:/music/ambient.mp3"></label>
        <label>Music volume <input name="music_volume" type="number" min="0" max="1" step="0.01" value="0.18"></label>

        <h2>Attribution</h2>
        <label>Author <input name="author"></label>
        <label>Source URL <input name="source_url"></label>
        <label>Story license <input name="story_license" value="CC BY-SA 3.0"></label>

        <div class="actions">
          <button type="button" id="prepare">Prepare Images</button>
          <button type="button" id="compose" class="secondary" disabled>Compose Video</button>
        </div>
        <div id="status" class="status"></div>
      </form>

      <section class="panel">
        <h2>Image Choices</h2>
        <div id="chunks">Prepare a project to see image candidates.</div>
      </section>
    </section>
  </main>

  <script>
    const form = document.querySelector("#settings");
    const statusEl = document.querySelector("#status");
    const chunksEl = document.querySelector("#chunks");
    const prepareButton = document.querySelector("#prepare");
    const composeButton = document.querySelector("#compose");
    window.manualSelections = {};
    window.canCompose = false;

    function formPayload() {
      const data = new FormData(form);
      return Object.fromEntries(data.entries());
    }

    function setBusy(isBusy, message) {
      prepareButton.disabled = isBusy;
      composeButton.disabled = isBusy || !window.currentProject;
      statusEl.textContent = message || "";
    }

    async function postJson(url, payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      return data;
    }

    async function getJson(url) {
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || `Request failed: ${response.status}`);
      }
      return data;
    }

    function renderProject(project, canCompose = false) {
      window.currentProject = project;
      window.canCompose = canCompose;
      chunksEl.innerHTML = "";
      for (const chunk of project.chunks) {
        const section = document.createElement("section");
        section.className = "chunk";

        const heading = document.createElement("h3");
        heading.textContent = `Chunk ${chunk.index}`;
        section.appendChild(heading);

        const source = document.createElement("p");
        source.textContent = chunk.text;
        section.appendChild(source);

        const subtitle = document.createElement("p");
        subtitle.textContent = chunk.subtitle_text;
        section.appendChild(subtitle);

        const chunkActions = document.createElement("div");
        chunkActions.className = "chunk-actions";
        const manualButton = document.createElement("button");
        manualButton.type = "button";
        manualButton.textContent = "Choose Local Image";
        manualButton.addEventListener("click", () => chooseLocalImage(chunk.index));
        chunkActions.appendChild(manualButton);
        section.appendChild(chunkActions);

        const cards = document.createElement("div");
        cards.className = "cards";
        const preferredSelection = String(window.manualSelections[chunk.index] || "");
        for (const candidate of chunk.image_candidates) {
          const card = document.createElement("label");
          card.className = "candidate";

          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = `chunk-${chunk.index}`;
          radio.value = candidate.candidate_index;
          radio.disabled = !candidate.asset;
          if (candidate.asset && preferredSelection && preferredSelection === String(candidate.candidate_index)) {
            radio.checked = true;
          } else if (candidate.asset && !preferredSelection && !cards.querySelector("input:checked")) {
            radio.checked = true;
          }
          card.appendChild(radio);

          if (candidate.asset) {
            const image = document.createElement("img");
            image.src = `/api/asset?path=${encodeURIComponent(candidate.asset.local_path)}`;
            image.alt = candidate.prompt;
            card.appendChild(image);
          } else {
            const error = document.createElement("div");
            error.className = "error";
            error.textContent = candidate.error === "pending" ? "Generating image..." : (candidate.error || "Image generation failed.");
            card.appendChild(error);
          }

          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = candidate.prompt;
          card.appendChild(meta);
          cards.appendChild(card);
        }
        section.appendChild(cards);
        chunksEl.appendChild(section);
      }
      composeButton.disabled = !canCompose;
    }

    async function chooseLocalImage(chunkIndex) {
      if (!window.currentProject) {
        statusEl.textContent = "Prepare a project before choosing local images.";
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.addEventListener("change", async () => {
        if (!input.files || !input.files[0]) {
          return;
        }
        try {
          statusEl.textContent = `Uploading local image for chunk ${chunkIndex}...`;
          const data = new FormData();
          data.append("output_dir", formPayload().output_dir);
          data.append("chunk_index", String(chunkIndex));
          data.append("image", input.files[0]);
          const response = await fetch("/api/manual-image", {
            method: "POST",
            body: data
          });
          const result = await response.json();
          if (!response.ok || result.error) {
            throw new Error(result.error || `Upload failed: ${response.status}`);
          }
          window.manualSelections[chunkIndex] = result.candidate.candidate_index;
          renderProject(result.project, window.canCompose);
          statusEl.textContent = `Local image selected for chunk ${chunkIndex}.`;
        } catch (error) {
          statusEl.textContent = error.message;
        }
      });
      input.click();
    }

    function selectedCandidates() {
      const selections = {};
      for (const chunk of window.currentProject.chunks) {
        const selected = document.querySelector(`input[name="chunk-${chunk.index}"]:checked`);
        if (selected) {
          selections[String(chunk.index)] = selected.value;
        }
      }
      return selections;
    }

    prepareButton.addEventListener("click", async () => {
      try {
        window.currentProject = null;
        composeButton.disabled = true;
        setBusy(true, "Preparing story, translating, generating detailed Chinese prompts, and starting image generation...");
        chunksEl.textContent = "Waiting for prompt plan...";
        const job = await postJson("/api/prepare", formPayload());
        await pollPrepareJob(job.job_id);
      } catch (error) {
        setBusy(false, error.message);
      }
    });

    async function pollPrepareJob(jobId) {
      while (true) {
        const job = await getJson(`/api/job?job_id=${encodeURIComponent(jobId)}`);
        if (job.project) {
          renderProject(job.project, job.status === "complete");
        }
        if (job.status === "complete") {
          setBusy(false, `Prepared ${job.project.chunks.length} chunks. Pick one image per chunk, then compose.`);
          return;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Prepare failed.");
        }
        statusEl.textContent = job.message || "Generating image candidates...";
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    composeButton.addEventListener("click", async () => {
      try {
        const payload = formPayload();
        payload.selections = selectedCandidates();
        setBusy(true, "Composing final video...");
        const result = await postJson("/api/compose", payload);
        setBusy(false, `Video complete:\n${result.video_path || result.run_plan}`);
      } catch (error) {
        setBusy(false, error.message);
      }
    });
  </script>
</body>
</html>
"""
