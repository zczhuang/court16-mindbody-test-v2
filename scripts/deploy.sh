#!/usr/bin/env bash
# One-command Vercel deploy.
#
# What this does:
#   1. Ensures you're logged in to Vercel (interactive, one-time — opens browser)
#   2. Links this directory to a Vercel project (creates a new one the first run)
#   3. Reads .env.local and pushes each var to Vercel's production environment
#      (idempotent — re-adds overwrite existing values)
#   4. Deploys to production
#
# Usage:
#   bash scripts/deploy.sh                  # deploy current state
#   bash scripts/deploy.sh --env-only       # only sync env vars, skip deploy
#   bash scripts/deploy.sh --skip-env       # only deploy, don't touch env vars
#
# Re-running this script is safe. Vercel env add prompts to overwrite if a
# key already exists; --force handles that non-interactively.

set -euo pipefail

cd "$(dirname "$0")/.."

MODE_ENV_ONLY=0
MODE_SKIP_ENV=0
for arg in "$@"; do
  case "$arg" in
    --env-only) MODE_ENV_ONLY=1 ;;
    --skip-env) MODE_SKIP_ENV=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

echo "▶ Court 16 MindBody Test — Vercel deploy"
echo

# ── 1. Login ──────────────────────────────────────────────────────────────────
if ! npx --yes vercel whoami >/dev/null 2>&1; then
  echo "→ Logging in to Vercel (this will open your browser)..."
  npx --yes vercel login
  echo
else
  echo "✓ Already logged in as $(npx --yes vercel whoami)"
  echo
fi

# ── 2. Link ───────────────────────────────────────────────────────────────────
if [ ! -f ".vercel/project.json" ]; then
  echo "→ Linking to a Vercel project (new project prompt)..."
  npx --yes vercel link
  echo
else
  PROJECT=$(grep -o '"projectId":"[^"]*"' .vercel/project.json | cut -d'"' -f4 || true)
  echo "✓ Already linked (project id: ${PROJECT:-unknown})"
  echo
fi

# ── 3. Sync env vars from .env.local ──────────────────────────────────────────
if [ "$MODE_SKIP_ENV" -eq 0 ]; then
  if [ ! -f ".env.local" ]; then
    echo "✗ .env.local not found. Copy .env.example to .env.local and fill it in first." >&2
    exit 1
  fi

  echo "→ Syncing env vars from .env.local to Vercel production environment"

  # Vars that MUST be present for the app to boot.
  REQUIRED_KEYS=(
    MINDBODY_API_KEY
    MINDBODY_SITE_ID
    MINDBODY_STAFF_USERNAME
    MINDBODY_STAFF_PASSWORD
  )
  # Optional vars — only pushed if set in .env.local.
  OPTIONAL_KEYS=(
    MINDBODY_BASE_URL
    MINDBODY_WRITE_MODE
    MINDBODY_USE_SANDBOX_FALLBACK
    TEST_API_TOKEN
    HAPPY_PATH_DEFAULT_EMAIL
    STAFF_CONFIRM_SIGNING_SECRET
    # APP_BASE_URL intentionally NOT synced — local is localhost, prod is
    # the Vercel deploy URL; set it once via `vercel env add` in prod and
    # leave it alone here so deploy.sh doesn't overwrite it.
    STAFF_NOTIFY_EMAIL
    SLACK_ALERT_WEBHOOK
    HUBSPOT_ACCESS_TOKEN
    HUBSPOT_PORTAL_ID
    HUBSPOT_TRIAL_FORM_GUID
    HUBSPOT_ENV
    HUBSPOT_REQUIRED
    HUBSPOT_CUSTOM_OBJECT_TYPE_ID
  )

  # Source .env.local to get values into shell. `set -a` auto-exports.
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a

  push_var() {
    local key="$1"
    local val="${!key:-}"
    local required="$2"

    if [ -z "$val" ]; then
      if [ "$required" = "required" ]; then
        echo "  ✗ $key is empty in .env.local — refusing to deploy" >&2
        exit 1
      fi
      echo "  · $key (skipped — not set)"
      return
    fi

    # Remove any existing value first (suppresses overwrite prompt), then add.
    # NB: use printf, not echo — echo appends a newline that gets stored as
    # part of the value and breaks string comparisons (e.g. "test\n" !== "test").
    npx --yes vercel env rm "$key" production --yes >/dev/null 2>&1 || true
    printf '%s' "$val" | npx --yes vercel env add "$key" production >/dev/null
    echo "  ✓ $key"
  }

  for k in "${REQUIRED_KEYS[@]}"; do push_var "$k" required; done
  for k in "${OPTIONAL_KEYS[@]}"; do push_var "$k" optional; done

  # Warn if MINDBODY_WRITE_MODE=live — this is the safety railing.
  if [ "${MINDBODY_WRITE_MODE:-test}" = "live" ]; then
    echo
    echo "  ⚠ MINDBODY_WRITE_MODE=live — deployed instance will make REAL MindBody writes."
    echo "    Make sure MINDBODY_SITE_ID is -99 (sandbox) unless you mean production."
  fi

  echo
fi

if [ "$MODE_ENV_ONLY" -eq 1 ]; then
  echo "✓ Env vars synced. Skipping deploy (--env-only)."
  exit 0
fi

# ── 4. Deploy ─────────────────────────────────────────────────────────────────
echo "→ Deploying to production..."
npx --yes vercel --prod

echo
echo "✓ Done."
echo
echo "Next: hit /api/health on the deployed URL to confirm env vars are loaded,"
echo "then /api/mindbody/happy-path with a curl POST as shown in README.md."
