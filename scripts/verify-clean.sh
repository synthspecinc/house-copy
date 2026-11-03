#!/usr/bin/env bash
set -euo pipefail
# Retain the clean source directory and named volume as review evidence.
source_root=$(git rev-parse --show-toplevel)
clean_root=$(mktemp -d /tmp/house-copy-clean-XXXXXX)
project="house-copy-verify-$(date -u +%Y%m%d%H%M%S)-$$"
port="${HOUSE_COPY_VERIFY_PORT:-13211}"
cd "$source_root"
git ls-files --cached --others --exclude-standard -z | tar --null -T - -cf - | tar -xf - -C "$clean_root"
printf 'Clean source: %s\nCompose project: %s\nHost port: %s\n' "$clean_root" "$project" "$port"
cd "$clean_root"
export HOUSE_COPY_PORT="$port"
stop_owned_service() { docker compose -p "$project" down; }
trap stop_owned_service EXIT
npm ci --ignore-scripts
npm test
docker compose -p "$project" up --build -d --wait
HOUSE_COPY_TEST_URL="http://localhost:$port" npm run test:e2e
HOUSE_COPY_TEST_URL="http://localhost:$port" node scripts/persistence-check.js before
docker compose -p "$project" restart house-copy
docker compose -p "$project" up -d --wait
HOUSE_COPY_TEST_URL="http://localhost:$port" node scripts/persistence-check.js after
docker compose -p "$project" exec -T house-copy sh -c 'test "$(id -u)" = 1000 && test -z "$AWS_ACCESS_KEY_ID$AWS_SECRET_ACCESS_KEY$AWS_SESSION_TOKEN"'
printf 'PASS: clean install, unit/integration tests, container workflow, persistence and unprivileged runtime.\nRetained source: %s\nRetained volume: %s_house-copy-data\n' "$clean_root" "$project"
