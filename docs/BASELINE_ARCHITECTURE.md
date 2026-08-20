# Inherited Baseline Architecture

Date captured: 2026-08-16

Purpose: record the pre-redesign persistence and runtime boundaries that M2 and M12 must migrate. This is descriptive, not the target architecture.

## Runtime and ownership

- Python 3.12 owns the CLI, HTTP UI, authentication, provider calls, in-memory jobs, media generation, and FFmpeg orchestration.
- Vite builds the vanilla JavaScript client from `web/src/`; the Python UI serves the built assets.
- Caddy proxies to the Python HTTP server.
- SQLite owns accounts, sessions, daily usage counters, and user API keys.
- Per-story directories and JSON manifests own drafts, generation state, provider metadata, and media paths.
- Prepare jobs use daemon threads. Compose jobs use an in-memory queue and worker threads. Polling state does not survive a process restart.

## SQLite baseline

Default path: `output/ui_auth.sqlite3`, configurable with `STORYVIDEOGEN_AUTH_DB`.

| Table | Primary key | Important fields | Migration note |
|---|---|---|---|
| `users` | integer `id` | `username`, PBKDF2 `password_hash`, `created_at` | Preserve password-hash compatibility; add persisted role/status in the target schema. |
| `sessions` | `token_hash` | `user_id`, `csrf_token`, `created_at`, integer `expires_at` | Existing sessions are invalidated during cutover. |
| `usage_counters` | (`user_id`, `action`, `day`) | integer `count` | Import only if the cutover policy requires historical daily limits; the target usage ledger is immutable. |
| `user_api_keys` | (`user_id`, `name`) | plaintext `value`, `updated_at` | Encrypt during real import; never print values during dry run or reports. |

The inherited store creates tables at runtime and adds `sessions.csrf_token` opportunistically. It has no schema-version table or ordered migration files.

## Story directory baseline

Default historical workspace: `output/ui_stories/`. Authenticated deployments normally use `output/ui_users/<username>/stories/<story-tag>/`.

Story identity is the normalized directory tag. APIs currently exchange an `output_dir`; the target design replaces it with owner-scoped opaque IDs.

### Primary state files

| File | Shape and purpose | Migration target |
|---|---|---|
| `story_session.json` | Draft/status overlay: tag, title, full story text, output path, status, message, error, transient job ID, video path, settings, timestamps. | `stories`, latest job summary, and timestamps. |
| `interactive_project.json` | Story metadata, selected excerpt, generation settings, ordered chunks, prompt candidates, and image candidates/assets. | `stories`, `scenes`, `prompts`, `image_candidates`, and `assets`. |
| `run_plan.json` | Effective run configuration, counts/durations, and artifact filename map. | Story/job settings snapshots and job outputs. |
| `prompts.json` | Chunk prompt data. | Scene prompts. |
| `image_candidates_manifest.json` | Candidate groups per chunk, including partial failures and downloaded asset metadata. | Image candidates/assets and generation events. |
| `image_manifest.json` | Selected image asset per chunk. | Scene selected-image relation and assets. |
| `audio_manifest.json` | Whole-story narration asset and provider/voice/duration metadata. | Per-scene audio assets plus render inputs. |
| `video_manifest.json` | Final video path, duration, dimensions, and render metadata. | Episode/render asset. |
| `license_manifest.json` | Story, selected-image, audio, and video attribution/license metadata. | Asset/source metadata and downloadable credits manifest. |

### Text and media files

- `story_input.txt`, `selected_story.txt`, and `narration.zh-CN.txt` contain source or derived text.
- `subtitles.zh-CN.srt`, `credits.txt`, and generated image/audio/video files are referenced by paths in manifests.
- Temporary FFmpeg concat/title files may exist inside a story directory.

## Import invariants

M12 must preserve these facts while moving authority to SQLite:

1. Import is dry-run capable and idempotent by legacy source identity.
2. User ownership is derived from the authenticated user workspace, never solely from a manifest path.
3. Full source text comes from the best available story record; excerpt fields are not treated as the complete story.
4. Ordered chunk indexes and selected-image relationships remain stable.
5. Referenced files are confined to the expected user/story root, checksummed, and recorded as missing/corrupt rather than trusted blindly.
6. Existing provider keys are encrypted before insertion into the target database.
7. Existing sessions and in-memory job identifiers are not migrated.
8. A repeated import creates no duplicate user, story, scene, or asset records.
