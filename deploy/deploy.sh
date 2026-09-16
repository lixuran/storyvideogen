#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${STORYVIDEOGEN_ENV_FILE:-$root_dir/deploy/docker/storyvideogen.env}"
compose=(docker compose --env-file "$env_file" -f "$root_dir/compose.yaml")

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and Docker Compose v2 are required." >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "Configuration not found: $env_file" >&2
  echo "Create it from deploy/docker/storyvideogen.env.example and set the domain, email, and master key." >&2
  exit 1
fi

master_key="$(awk -F= '$1 == "STORYVIDEOGEN_SECRET_MASTER_KEY" {print substr($0, index($0, "=") + 1); exit}' "$env_file")"
if [[ -z "$master_key" || "$master_key" == "replace-with-base64-encoded-32-byte-key" ]]; then
  echo "STORYVIDEOGEN_SECRET_MASTER_KEY must be set to a generated secret." >&2
  exit 1
fi

mkdir -p "$root_dir/output"
export STORYVIDEOGEN_ENV_FILE="$env_file"

"${compose[@]}" config --quiet
"${compose[@]}" up --build --detach --remove-orphans --wait --wait-timeout 180
"${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:3000/health/ready').then(async response => { if (!response.ok) throw new Error(await response.text()); console.log('API ready'); }).catch(error => { console.error(error.message); process.exit(1); })"
"${compose[@]}" ps
