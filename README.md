# storyvideogen

Node/React workspace for turning full-length stories into illustrated podcast videos, backed by SQLite and a private Python media worker.

MVP target:
- Simplified Chinese translated narration.
- Simplified Chinese subtitles burned into the MP4, with a separate downloadable `.srt` copy.
- `1920x1080` 16:9 video.
- Real web images from license-aware sources.
- Narration with optional background music.
- English title card at the beginning.
- Optional looping background music.
- Local UI for choosing one downloaded image candidate per story chunk.

Start the redesigned local application:

The media worker requires FFmpeg built with the `subtitles`/libass filter and a
font with Simplified Chinese glyphs. On Debian/Ubuntu, install `ffmpeg` and
`fonts-noto-cjk` before starting the worker.

```bash
npm install
python -m pip install -e ".[zai]"
npm run build
npm start
# In a second terminal:
npm run start:worker
```

Then open `http://127.0.0.1:3000`. Register or log in, save a named full-story draft, choose a target scene length from 15–120 seconds (30 seconds by default), plan its scenes, choose or upload one image per scene, optionally upload rights-attested music, and render the finished video with burned-in subtitles.

SQLite owns story/job metadata and opaque asset IDs. Generated and uploaded files are stored below `output/assets/`; filesystem paths are never accepted from the browser or returned by the API.

For ZAI-powered translation, prompt generation, Zhipu image generation, or Pexels
image search, open the left-panel Settings section after login and save the
corresponding provider key. The UI encrypts the key for the current user and only
shows whether each key is configured. Administrators can provide platform fallback
keys from Admin Provider Keys.

### Test semantic Pexels selection

Run the commands in this section from the redesigned application directory (the
directory containing `server/` and this README), not from the legacy Vite-only
parent checkout:

```powershell
Set-Location "D:/huirui_backup/storyvideogen/pexels-workspace"
```

Pexels now prepares its searches with the configured Zhipu text model. For every
scene it derives one to three concise English stock-photo queries, selects one or
two concrete visual subjects as required concepts, searches all query variants,
and rejects Pexels results whose title or alt metadata does not contain those
subjects. It then ranks the remaining downloadable results instead of accepting
the first result returned by the Pexels API.

To test this through the local application:

1. Build and restart both the API and worker after pulling the change:

   ```powershell
   npm run build
   # In separate terminals, after stopping old processes:
   npm start
   npm run start:worker
   ```

2. Sign in, open **Settings**, and save both a **Zhipu AI** key and a **Pexels**
   API key. The Zhipu key is used only to prepare the search query; the Pexels
   key performs the image search and download.

3. In **Create**, save a short draft and plan it. Use a scene with a distinct
   visible subject, for example: `A solitary lighthouse stands above a moonlit
   sea.` Select **Pexels** as the image source and generate one image candidate.

4. Confirm that the returned image is relevant to the scene's primary subject
   (a lighthouse in this example), rather than merely the first Pexels result.
   The candidate attribution should link to a Pexels photo page. Repeat with an
   unrelated subject or a Chinese scene; the query preparation is language- and
   subject-independent.

The deterministic test does not call external services or require keys:

```powershell
node scripts/run-python.mjs -m unittest tests.test_pexels_provider
```

It covers generic Chinese query preparation, constrained English query parsing,
metadata rejection, ranking, retries, and the fallback path. The live suite runs
full Zhipu planning followed by semantic Pexels selection, so it requires both
provider keys:

```powershell
$env:ZAI_API_KEY="your-zhipu-api-key"
$env:PEXELS_API_KEY="your-pexels-api-key"
npm run verify:live:pexels
```

Run browser end-to-end tests:

```bash
npm run test:e2e
```

Run the complete deterministic baseline verification:

```bash
npm run verify
```

The Node application initializes its SQLite metadata database before becoming
ready. The default file is `output/storyvideogen.sqlite3`. Migration, backup,
and restore procedures are documented in `docs/SQLITE_OPERATIONS.md`.
Deterministic release evidence and the remaining external launch gates are in
`docs/RELEASE_VALIDATION.md`.

The redesigned Node application stores personal provider keys with AES-256-GCM.
Set a stable external key before allowing users to save credentials:

```bash
STORYVIDEOGEN_SECRET_MASTER_KEY=<base64-encoded-32-byte-key>
STORYVIDEOGEN_SECRET_KEY_ID=v1
STORYVIDEOGEN_SECURE_COOKIES=true
```

Create a normal account in the browser, then promote that exact existing account
once with `npm run admin:bootstrap -- <username>`. Re-running the command for the
same account is safe. The command does not create an account or accept a password.

The Python launcher requires Python 3.12. It uses `STORYVIDEOGEN_PYTHON`, then
`PYTHON`, then the repository `.venv`, and finally the platform Python 3.12
launcher. Configured values must be executable paths rather than shell commands.

## Public test deployment

The UI is designed to run behind an HTTPS reverse proxy on a VPS. Generated images,
uploaded images, subtitles, and videos stay on the server under:

```text
output/assets/<opaque-storage-key>
```

Users select local laptop images through the browser, but the file is uploaded,
validated, and stored on the server. Completed videos and subtitles are downloaded
through authenticated download links in the UI.

Recommended VPS shape:

- Caddy handles public HTTPS and reverse proxies only to `127.0.0.1:3000`.
- `storyvideogen.service` runs the Node API; one or more private workers claim independent jobs from the durable SQLite queue.
- SQLite stores identity, stories, durable jobs, billing, secrets, and audit metadata.
- Story assets stay on the VPS disk in `output/`.

Deployment files:

- `deploy/Caddyfile`
- `deploy/storyvideogen.service`
- `deploy/storyvideogen-worker.service`
- `deploy/storyvideogen-worker@.service`
- `deploy/storyvideogen.env.example`
- `deploy/storyvideogen-healthcheck.sh`

### Docker Compose deployment

Use Docker Compose on hosts that do not package Python 3.12 or an FFmpeg build
with libass, including the standard Alibaba Cloud Linux 3 image. The production
image pins Node 24 and Python 3.12, verifies the FFmpeg `subtitles` filter and
Noto CJK font during the build, and runs the API and one worker as an unprivileged
UID 10001. Caddy is the only public container; the API is also bound to host
loopback for health checks and SSH-tunnel testing.

For a public VPS with Docker already installed, the shortest deployment path is:

```bash
git clone --branch codex/podcast-platform-redesign https://github.com/lixuran/storyvideogen.git /opt/storyvideogen
cd /opt/storyvideogen
cp deploy/docker/storyvideogen.env.example deploy/docker/storyvideogen.env
chmod 600 deploy/docker/storyvideogen.env
openssl rand -base64 32
# Edit deploy/docker/storyvideogen.env: domain, ACME email, and generated master key.
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

`deploy/deploy.sh` validates the configuration, builds the application image,
starts Caddy, the API, and one worker, waits for the API health check, and prints
service status. It never creates or prints provider keys. Configure Zhipu and
Pexels from authenticated **Settings** after the first login.

```bash
git clone --branch codex/podcast-platform-redesign https://github.com/lixuran/storyvideogen.git /opt/storyvideogen
cd /opt/storyvideogen
cp deploy/docker/storyvideogen.env.example deploy/docker/storyvideogen.env
chmod 600 deploy/docker/storyvideogen.env
mkdir -p output
sudo chown 10001:10001 output
```

Generate the secret master key with `openssl rand -base64 32`, then edit
`deploy/docker/storyvideogen.env`. Keep payment mode disabled until the real
WeChat adapter and merchant configuration are accepted. The environment file is
ignored by both Git and the Docker build context.

Build and inspect the bundled runtimes before starting:

```bash
docker compose --env-file deploy/docker/storyvideogen.env build
docker compose --env-file deploy/docker/storyvideogen.env run --rm api python --version
docker compose --env-file deploy/docker/storyvideogen.env run --rm api ffmpeg -hide_banner -filters
docker compose --env-file deploy/docker/storyvideogen.env up -d api worker
curl --fail http://127.0.0.1:3000/health/ready
```

Until DNS and ICP filing are ready, leave Caddy stopped and reach the loopback
API through an SSH tunnel. Set secure cookies to `false` only for that temporary
HTTP test. For the public launch, set the real domain and email, restore secure
cookies to `true`, point DNS to the VPS, open only ports 80/443, and start Caddy:

```bash
docker compose --env-file deploy/docker/storyvideogen.env up -d caddy
docker compose --env-file deploy/docker/storyvideogen.env ps
docker compose --env-file deploy/docker/storyvideogen.env logs --tail=100 api worker caddy
```

Bootstrap an administrator after registering that username in the browser:

```bash
docker compose --env-file deploy/docker/storyvideogen.env run --rm api npm run admin:bootstrap -- your-username
```

The bind-mounted `output/` directory contains the SQLite database and all media;
back up that directory as one coordinated unit. Keep only one worker on a
two-vCPU, two-GB host and add swap before the first render.

Important public-test environment variables:

```bash
STORYVIDEOGEN_SECURE_COOKIES=true
STORYVIDEOGEN_NODE_HOST=127.0.0.1
STORYVIDEOGEN_NODE_PORT=3000
STORYVIDEOGEN_DATABASE_PATH=/opt/storyvideogen/output/storyvideogen.sqlite3
STORYVIDEOGEN_STORAGE_ROOT=/opt/storyvideogen/output/assets
STORYVIDEOGEN_WORKER_ROOT=/opt/storyvideogen/output/worker
STORYVIDEOGEN_SECRET_MASTER_KEY=<base64-encoded-32-byte-key>
STORYVIDEOGEN_PAYMENT_MODE=disabled
STORYVIDEOGEN_MAX_UPLOAD_BYTES=10485760
```

Public-test protections included:

- HTTPS-ready secure cookies when `STORYVIDEOGEN_SECURE_COOKIES=true`.
- Login/register/generation rate limits.
- Per-user plan quotas and server-side admin roles.
- CSRF token checks for authenticated POST requests.
- Server-side upload size/type validation for manual image uploads.
- Durable SQLite jobs processed by a separate Node worker through a versioned Python contract.

Auto mode plans the full story, queues one image job per scene, selects the first
successful candidate in each job, and queues the final render. A second candidate
is attempted only when the first fails, which avoids an unnecessary long Zhipu
request on the normal path. Slow image calls may take up to ten minutes, with
streamed progress keeping the durable job lease active. It is safe to leave
the Create page while this runs. One worker is sufficient; a small same-host pool
allows different scenes and stories to progress concurrently:

```bash
sudo systemctl enable --now storyvideogen-worker@1 storyvideogen-worker@2
```

Keep the pool small because SQLite and local disk define the version-one scale
boundary. All instances must use the same database, storage root, and worker root.

The inherited Python UI remains available only for rollback during migration:

```bash
node scripts/run-python.mjs -m storyvideogen ui --host 127.0.0.1 --port 7860
```

Dry-run and execute the legacy import with:

```bash
npm run import:legacy -- --auth-db output/ui_auth.sqlite3 --user-root output/ui_users --dry-run true
npm run import:legacy -- --auth-db output/ui_auth.sqlite3 --user-root output/ui_users --dry-run false
```

Initial dry run:

```bash
node scripts/run-python.mjs -m storyvideogen generate --story "samples/short_story.txt" --title "Test Story" --out "output/demo" --translator mock --dry-run
```

Install optional ZAI dependency for prompt planning and meaning-based Chinese translation:

```bash
node scripts/run-python.mjs -m pip install zai-sdk
```

Zhipu `cogview-3-flash` is the default generated-image provider. It uses the
fast `standard` quality setting and a `1344x768` near-16:9 canvas. Use
`glm-image` only when its slower HD quality or stronger Chinese text rendering
is required:

```bash
$env:ZHIPU_IMAGE_API_KEY="your-zhipu-or-bigmodel-api-key"
```

Offline full render test:

```bash
node scripts/run-python.mjs -m storyvideogen generate --story "samples/short_story.txt" --title "The Amber Hallway" --out "output/demo" --target-seconds 5 --translator mock --image-provider fixture --tts-provider silent
```

Live MVP path:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
node scripts/run-python.mjs -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --chunk-seconds 30 --translator zai --translation-model glm-5.2 --image-provider zhipu --image-model cogview-3-flash --tts-provider edge --author "Author Name" --source-url "https://example.com/story" --story-license "CC BY-SA 3.0"
```

Faster image path with Pixabay:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
$env:PIXABAY_API_KEY="your-api-key"
node scripts/run-python.mjs -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --translator zai --translation-model glm-5.2 --prompt-provider zai --prompt-model glm-5.2 --image-provider pixabay --image-workers 6 --tts-provider edge
```

Pexels photo-search path:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
$env:PEXELS_API_KEY="your-pexels-api-key"
node scripts/run-python.mjs -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --translator zai --translation-model glm-5.2 --prompt-provider zai --prompt-model glm-5.2 --image-provider pexels --image-workers 4 --tts-provider edge
```

Pexels results retain the photographer, photo-page URL, and Pexels License in the
image manifest and rendered credits. Obtain a key from the Pexels API dashboard.
Run the explicit live browser verification with `PEXELS_API_KEY` set:

```bash
npm run verify:live:pexels
```

China-oriented fast image path without an API key:

```bash
$env:ZAI_API_KEY="your-zai-api-key"
node scripts/run-python.mjs -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --target-seconds 90 --translator zai --translation-model glm-5.2 --image-provider baidu --image-workers 6 --tts-provider edge
```

Outputs:
- `video.mp4`
- `subtitles.zh-CN.srt`
- `narration.zh-CN.txt`
- `credits.txt`
- `license_manifest.json`
- `run_plan.json`
- `image_manifest.json`
- `audio_manifest.json`

Use `--skip-video` to generate text, image, audio, and attribution artifacts without rendering the MP4.

Optional background music for CLI generation:

```bash
node scripts/run-python.mjs -m storyvideogen generate --story "input/story.txt" --title "Story Title" --out "output/story_title" --background-music "D:/music/ambient.mp3" --music-volume 0.18
```
