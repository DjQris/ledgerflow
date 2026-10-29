#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS="$ROOT/artifacts/phase4"
PROJECT="ledgerflow-phase4-test"
cd "$ROOT"
mkdir -p "$ARTIFACTS"

ENV_FILE="$ARTIFACTS/compose.env"
if [ ! -f "$ENV_FILE" ]; then
  local_password="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  (umask 077 && printf 'PHASE4_POSTGRES_PASSWORD=%s\n' "$local_password" > "$ENV_FILE")
fi
if [ -L "$ENV_FILE" ]; then
  printf 'Refusing a symlink for the isolated Phase 4 credential file.\n' >&2
  exit 1
fi
chmod 600 "$ENV_FILE"
IFS='=' read -r env_key PHASE4_POSTGRES_PASSWORD < "$ENV_FILE"
if [ "$env_key" != 'PHASE4_POSTGRES_PASSWORD' ] || ! [[ "$PHASE4_POSTGRES_PASSWORD" =~ ^[a-f0-9]{64}$ ]]; then
  printf 'Invalid isolated Phase 4 credential file. Remove artifacts/phase4/compose.env and retry.\n' >&2
  exit 1
fi
# This generated credential file has mode 0600 and is git-ignored.
COMPOSE=(docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" -f compose.phase4.yaml)
DB_URL="postgresql://ledgerflow_phase4_test:${PHASE4_POSTGRES_PASSWORD}@127.0.0.1:55432/ledgerflow_phase1f_integration_phase4?schema=public"
REDIS_URL='redis://127.0.0.1:56379'
DB_NAME='ledgerflow_phase1f_integration_phase4'
DB_USER='ledgerflow_phase4_test'

record() {
  local name="$1" status="$2" code="$3" reason="${4:-}"
  printf '%s\t%s\t%s\t%s\n' "$name" "$status" "$code" "$reason" >> "$ARTIFACTS/status.tsv"
  printf '[%s] %s (exit %s)\n' "$status" "$name" "$code"
}

run_cmd() {
  local name="$1"; shift
  local output="$ARTIFACTS/$name.log"
  "$@" > "$output" 2>&1
  local code=$?
  cat "$output"
  if [ "$code" -eq 0 ]; then record "$name" passed 0
  else record "$name" failed "$code" "See artifacts/phase4/$name.log"
  fi
  return "$code"
}

skip_cmd() {
  record "$1" skipped 0 "$2"
}

test_env() {
  export NODE_ENV=test
  export LEDGERFLOW_PHASE4_TEST_RUN=1
  export DATABASE_URL="$DB_URL"
  export INTEGRATION_DATABASE_URL="$DB_URL"
  export REDIS_URL
  export INTEGRATION_REDIS_URL="$REDIS_URL"
  export AUTH_SIGNING_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))")"
  export AUTH_ALLOWED_ORIGIN='http://localhost:3000'
  export AUTH_COOKIE_SECURE=false
}

apply_migrations_and_seed() {
  test_env
  run_cmd prisma-generate npm run db:generate --workspace @ledgerflow/api || return 1
  run_cmd migrations npm run db:migrate:deploy --workspace @ledgerflow/api || return 1
  run_cmd synthetic-seed npm run db:seed --workspace @ledgerflow/api || return 1
}

services_ready() {
  local postgres_check redis_check
  postgres_check=$("${COMPOSE[@]}" exec -T -e "PGPASSWORD=$PHASE4_POSTGRES_PASSWORD" postgres \
    psql -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -Atqc 'SELECT 1' 2>/dev/null) || return 1
  [ "$postgres_check" = '1' ] || return 1
  redis_check=$("${COMPOSE[@]}" exec -T redis redis-cli ping 2>/dev/null) || return 1
  [ "$redis_check" = 'PONG' ]
}

run_browser_smoke() {
  local chromium="${CHROMIUM_PATH:-/usr/bin/chromium}"
  if [ ! -x "$chromium" ]; then
    skip_cmd playwright-shell 0 'Chromium is not installed at the configured executable path.'
    return
  fi

  local server_log="$ARTIFACTS/next-dev.log"
  (
    cd "$ROOT/apps/web"
    env -u DATABASE_URL -u INTEGRATION_DATABASE_URL -u INTEGRATION_REDIS_URL \
      -u REDIS_URL -u AUTH_SIGNING_KEY -u PHASE4_POSTGRES_PASSWORD \
      -u LEDGERFLOW_PHASE4_TEST_RUN -u NODE_ENV \
      API_BASE_URL='http://127.0.0.1:43000/api/v1' \
      node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 43101
  ) > "$server_log" 2>&1 &
  local server_pid=$!
  local ready=0
  for ((attempt = 0; attempt < 60; attempt += 1)); do
    if curl --silent --fail http://127.0.0.1:43101/login >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
    sleep 0.5
  done

  if [ "$ready" -eq 1 ]; then
    run_cmd playwright-shell env \
      -u DATABASE_URL -u INTEGRATION_DATABASE_URL -u INTEGRATION_REDIS_URL \
      -u REDIS_URL -u AUTH_SIGNING_KEY -u PHASE4_POSTGRES_PASSWORD \
      -u LEDGERFLOW_PHASE4_TEST_RUN -u NODE_ENV \
      CHROMIUM_PATH="$chromium" \
      WEB_BASE_URL='http://127.0.0.1:43101' \
      SCREENSHOT_DIR="$ARTIFACTS/screenshots" \
      npm run verify:ui --workspace @ledgerflow/web
  else
    cat "$server_log"
    record playwright-shell failed 1 'Next.js could not bind/read on isolated loopback port 43101.'
  fi
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}

run_baseline() {
  : > "$ARTIFACTS/status.tsv"
  for stale_report in \
    api-unit-jest.json web-vitest.json api-integration-core-jest.json \
    api-integration-phase2f-jest.json api-integration-phase2g-jest.json \
    api-concurrency-jest.json; do
    rm -f "$ARTIFACTS/$stale_report"
  done
  export LEDGERFLOW_BASELINE_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local jest="$ROOT/node_modules/jest/bin/jest.js"
  local api="$ROOT/apps/api"

  run_cmd api-unit env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u LEDGERFLOW_PHASE4_TEST_RUN NODE_ENV=test \
    npm run test --workspace @ledgerflow/api -- \
    --json "--outputFile=$ARTIFACTS/api-unit-jest.json" \
    '--testPathIgnorePatterns=\.integration-spec\.ts$'
  run_cmd api-typecheck env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u AUTH_SIGNING_KEY -u LEDGERFLOW_PHASE4_TEST_RUN \
    npm run typecheck --workspace @ledgerflow/api
  run_cmd api-lint env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u AUTH_SIGNING_KEY -u LEDGERFLOW_PHASE4_TEST_RUN \
    npm run lint --workspace @ledgerflow/api
  run_cmd web-unit env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u AUTH_SIGNING_KEY -u LEDGERFLOW_PHASE4_TEST_RUN \
    npm run test:auth --workspace @ledgerflow/web -- \
    --reporter=json "--outputFile=$ARTIFACTS/web-vitest.json"
  run_cmd web-money env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u AUTH_SIGNING_KEY -u LEDGERFLOW_PHASE4_TEST_RUN \
    node --experimental-strip-types --test --test-reporter=tap \
    apps/web/scripts/money.test.mjs
  run_cmd web-typecheck env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u AUTH_SIGNING_KEY -u LEDGERFLOW_PHASE4_TEST_RUN \
    npm run typecheck --workspace @ledgerflow/web
  run_cmd web-lint env -u DATABASE_URL -u INTEGRATION_DATABASE_URL \
    -u INTEGRATION_REDIS_URL -u REDIS_URL -u PHASE4_POSTGRES_PASSWORD \
    -u AUTH_SIGNING_KEY -u LEDGERFLOW_PHASE4_TEST_RUN \
    npm run lint --workspace @ledgerflow/web
  run_browser_smoke

  local up_code=0
  run_cmd services-up "${COMPOSE[@]}" up -d --wait || up_code=$?
  local setup_ready=0
  local skip_reason='Phase 4 database and Redis services failed to start cleanly.'
  if [ "$up_code" -eq 0 ]; then
    if services_ready; then
      record service-connectivity passed 0
      if apply_migrations_and_seed; then
        setup_ready=1
      else
        skip_reason='Prisma generation, migrations, or synthetic seed failed; see its command report and log.'
      fi
    else
      record service-connectivity failed 1 'Phase 4 database credential check or isolated Redis ping failed.'
      skip_reason='Phase 4 PostgreSQL authentication or Redis connectivity check failed.'
    fi
  fi
  if [ "$setup_ready" -eq 1 ]; then
    (
      cd "$api"
      node --experimental-vm-modules "$jest" --runInBand --json \
        "--outputFile=$ARTIFACTS/api-integration-core-jest.json" \
        '--testRegex=.*\.integration-spec\.ts$' \
        '--testPathIgnorePatterns=phase2[fg]\.integration-spec\.ts$'
    ) > "$ARTIFACTS/api-integration-core.log" 2>&1
    local code=$?; cat "$ARTIFACTS/api-integration-core.log"
    if [ "$code" -eq 0 ]; then record api-integration-core passed 0
    else record api-integration-core failed "$code" "See artifacts/phase4/api-integration-core.log"; fi

    for phase in 2f 2g; do
      (
        cd "$api"
        node --experimental-vm-modules "$jest" --runInBand --json \
          "--outputFile=$ARTIFACTS/api-integration-phase$phase-jest.json" \
          '--testRegex=.*\.integration-spec\.ts$' --runTestsByPath \
          "src/background/phase$phase.integration-spec.ts"
      ) > "$ARTIFACTS/api-integration-phase$phase.log" 2>&1
      code=$?; cat "$ARTIFACTS/api-integration-phase$phase.log"
      if [ "$code" -eq 0 ]; then record "api-integration-phase$phase" passed 0
      else record "api-integration-phase$phase" failed "$code" "See artifacts/phase4/api-integration-phase$phase.log"; fi
    done

    (
      cd "$api"
      CONCURRENCY_ROUNDS=10 node --experimental-vm-modules "$jest" --runInBand --json \
        "--outputFile=$ARTIFACTS/api-concurrency-jest.json" \
        '--testRegex=transfers\.http\.integration-spec\.ts$' \
        '--testNamePattern=coordinates simultaneous|concurrent debits'
    ) > "$ARTIFACTS/api-concurrency.log" 2>&1
    code=$?; cat "$ARTIFACTS/api-concurrency.log"
    if [ "$code" -eq 0 ]; then record api-concurrency passed 0
    else record api-concurrency failed "$code" 'See artifacts/phase4/api-concurrency.log'; fi

    run_cmd ledger-integrity npm run ledger:verify --workspace @ledgerflow/api
    local count_sql="SELECT json_build_object('users', (SELECT count(*) FROM users), 'wallets', (SELECT count(*) FROM wallets), 'ledgerTransactions', (SELECT count(*) FROM ledger_transactions), 'ledgerEntries', (SELECT count(*) FROM ledger_entries), 'transfers', (SELECT count(*) FROM transfers), 'outboxEvents', (SELECT count(*) FROM outbox_events), 'auditEvents', (SELECT count(*) FROM audit_events))::text"
    run_cmd data-size "${COMPOSE[@]}" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -Atc "$count_sql"
  else
    skip_cmd api-integration-core "$skip_reason"
    skip_cmd api-integration-phase2f "$skip_reason"
    skip_cmd api-integration-phase2g "$skip_reason"
    skip_cmd api-concurrency "$skip_reason"
    skip_cmd ledger-integrity "$skip_reason"
  fi

  unset DATABASE_URL INTEGRATION_DATABASE_URL INTEGRATION_REDIS_URL REDIS_URL
  unset PHASE4_POSTGRES_PASSWORD AUTH_SIGNING_KEY LEDGERFLOW_PHASE4_TEST_RUN
  run_cmd safe-teardown "${COMPOSE[@]}" down --remove-orphans
  export LEDGERFLOW_NPM_VERSION="$(npm --version 2>/dev/null || true)"
  export LEDGERFLOW_DOCKER_VERSION="$(docker --version 2>/dev/null || true)"
  export LEDGERFLOW_COMPOSE_VERSION="$(docker compose version --short 2>/dev/null || true)"
  node scripts/phase4/report.mjs
}

case "${1:-help}" in
  up)
    run_cmd services-up "${COMPOSE[@]}" up -d --wait
    ;;
  down)
    run_cmd services-down "${COMPOSE[@]}" down --remove-orphans
    ;;
  reset)
    run_cmd reset-down "${COMPOSE[@]}" down --volumes --remove-orphans || exit $?
    if ! run_cmd services-up "${COMPOSE[@]}" up -d --wait; then
      run_cmd reset-failed-teardown "${COMPOSE[@]}" down --remove-orphans
      exit 1
    fi
    if ! services_ready; then
      printf 'Phase 4 database authentication or Redis connectivity failed.\n' >&2
      run_cmd reset-failed-teardown "${COMPOSE[@]}" down --remove-orphans
      exit 1
    fi
    if ! apply_migrations_and_seed; then
      run_cmd reset-failed-teardown "${COMPOSE[@]}" down --remove-orphans
      exit 1
    fi
    ;;
  migrate)
    services_ready || { printf 'Phase 4 services are not healthy. Start with npm run phase4:up.\n' >&2; exit 1; }
    test_env
    run_cmd prisma-generate npm run db:generate --workspace @ledgerflow/api || exit $?
    run_cmd migrations npm run db:migrate:deploy --workspace @ledgerflow/api
    ;;
  seed)
    services_ready || { printf 'Phase 4 services are not healthy. Start with npm run phase4:up.\n' >&2; exit 1; }
    test_env
    run_cmd synthetic-seed npm run db:seed --workspace @ledgerflow/api
    ;;
  baseline)
    run_baseline
    ;;
  *)
    printf 'Usage: bash scripts/phase4/run.sh <up|down|reset|migrate|seed|baseline>\n'
    ;;
esac
