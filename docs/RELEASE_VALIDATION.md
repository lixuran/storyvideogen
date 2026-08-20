# Release validation record

Date: 2026-08-18

## Deterministic release candidate

The final review run used `npm run verify` and passed:

- strict TypeScript and JavaScript syntax validation;
- 29 Node/launcher unit and integration tests;
- 96 Python unit, contract, provider, and render tests;
- the Vite production build;
- 29/29 Playwright browser journeys across the inherited rollback UI and the redesigned Node/React application, including background auto mode, a compressed slow-provider SCP-173 render, and actionable quota-failure reporting.

Playwright uses one worker because its Node scenarios intentionally share one
SQLite queue and one fixture-worker boundary. This prevents a worker helper from
claiming another test file's job while retaining production lease/recovery tests.

## Validated operating boundary

- The browser/API accepts exactly 30,000 fixture words and rejects 30,001.
- A local deterministic planning probe split 30,000 words into 215 scenes in
  0.186 seconds with 3.85 MiB peak Python allocation as measured by
  `tracemalloc`. This measures the local fallback planner only, not live-provider
  latency or total process RSS.
- The deterministic two-scene, six-second 1920×1080 render browser journey
  completed in 5.8 seconds during the final cumulative run on the development
  host.
- The authorized live SCP-173 journey completed real Zhipu planning, two
  first-success image jobs, Edge TTS narration, subtitle burn-in, artifact
  persistence, and MP4 download validation in 4.8 minutes. The initial attempt
  exposed that the Node media boundary accepted WAV but not Edge TTS's valid
  MP3 output; the preserved 579,116-byte MP3 reproduced the failure, a focused
  regression now covers both MP3 signatures, and the uninterrupted rerun passed.
- Trial and Creator plans both grant 1,000 successful image assets. Plan seeding
  refreshes this quota for existing databases without rewriting unchanged rows.
- Planning accepts a 15–120 second target scene duration and defaults to roughly
  30 seconds at 150 source words per minute. Rendered MP4 files include burned-in
  short subtitle cues and retain the matching downloadable SRT.
- Initial production topology remains one Node API process and a small same-host
  worker pool. The supplied systemd template supports multiple workers, while
  SQLite transactions, leased claims, idempotent stage handoffs, and startup
  reconciliation protect concurrent auto-mode progress. Increase the pool only
  after measuring SQLite contention, provider limits, render CPU, and disk growth
  on the target VPS.

## External launch gates

The repository is deterministically verified but is not certified for public
paid launch until all of the following are completed in the target environment:

1. Provision WeChat merchant identifiers, certificates, API v3 key, callback
   domain, and merchant sandbox/test access; implement and accept the real
   Native Pay adapter. Until then `STORYVIDEOGEN_PAYMENT_MODE=disabled` is the
   required production setting.
2. Exercise Caddy cutover/rollback and a coordinated SQLite/media restore on the
   actual non-root VPS services.
3. Measure queue latency, SQLite contention, provider throughput, render time,
   and disk growth with representative long episodes; lower the public limit if
   the host cannot meet the desired service level.
4. Publish the final privacy, retention, refund, invoice, and support policies.
