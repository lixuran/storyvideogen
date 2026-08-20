#!/bin/sh
set -eu

base_url="${STORYVIDEOGEN_HEALTH_URL:-http://127.0.0.1:3000}"
data_root="${STORYVIDEOGEN_DATA_ROOT:-/opt/storyvideogen/output}"
minimum_free_kib="${STORYVIDEOGEN_MIN_FREE_KIB:-5242880}"

curl --fail --silent --show-error "${base_url}/health/ready" >/dev/null
free_kib="$(df -Pk "${data_root}" | awk 'NR == 2 {print $4}')"
if [ "${free_kib}" -lt "${minimum_free_kib}" ]; then
  echo "StoryVideoGen disk alert: ${free_kib} KiB free; ${minimum_free_kib} KiB required." >&2
  exit 1
fi
