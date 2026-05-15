#!/usr/bin/env bash
#
# One-shot production setup. Requires:
#   1. supabase login (token in your config dir)
#   2. vercel CLI authenticated
#
# Run from the repo root:
#   bash scripts/setup-production.sh
#
# What it does:
#   1. Creates a hosted Supabase project named "mashi"
#   2. Links this dir + pushes migrations 001-012
#   3. Reloads PostgREST schema cache
#   4. Pulls the new project's URL + keys
#   5. Pushes those into Vercel production env
#   6. Triggers a fresh Vercel production deploy

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────
PROJECT_NAME="mashi"
REGION="us-east-1"
# Pick the first org you belong to. Override with ORG_ID=... bash setup-...
ORG_ID="${ORG_ID:-}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-$(openssl rand -base64 24)}"

echo "==> Verifying CLIs"
command -v supabase >/dev/null || { echo "supabase CLI missing"; exit 1; }
command -v vercel >/dev/null   || { echo "vercel CLI missing";   exit 1; }
supabase projects list >/dev/null 2>&1 || {
  echo "supabase login first: run 'supabase login' and re-run this script"; exit 1
}

# ── 1. Pick org ────────────────────────────────────────────────────────
if [ -z "$ORG_ID" ]; then
  echo "==> Picking first available organization"
  ORG_ID=$(supabase orgs list --output json | python3 -c "
import sys, json
orgs = json.load(sys.stdin)
print(orgs[0]['id'] if orgs else '')
")
  if [ -z "$ORG_ID" ]; then
    echo "No Supabase organizations found. Create one at supabase.com first."
    exit 1
  fi
  echo "    Using org: $ORG_ID"
fi

# ── 2. Create the project ───────────────────────────────────────────────
echo "==> Creating Supabase project '$PROJECT_NAME' in $REGION"
echo "    DB password saved here so you can keep it; do NOT commit:"
echo "    $DB_PASSWORD"

CREATE_OUT=$(supabase projects create "$PROJECT_NAME" \
  --org-id "$ORG_ID" \
  --region "$REGION" \
  --db-password "$DB_PASSWORD" \
  --output json)

REF=$(echo "$CREATE_OUT" | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")
echo "    Project ref: $REF"
echo "    Waiting 30s for project to become reachable…"
sleep 30

# ── 3. Link + push migrations ───────────────────────────────────────────
echo "==> Linking + pushing migrations"
SUPABASE_DB_PASSWORD="$DB_PASSWORD" supabase link --project-ref "$REF"
SUPABASE_DB_PASSWORD="$DB_PASSWORD" supabase db push

# ── 4. Reload PostgREST schema cache ────────────────────────────────────
echo "==> Reloading PostgREST schema cache"
supabase db execute "NOTIFY pgrst, 'reload schema';"

# ── 5. Pull project URL + keys ──────────────────────────────────────────
echo "==> Fetching API URL + keys"
SUPA_URL="https://${REF}.supabase.co"
KEYS_JSON=$(supabase projects api-keys --project-ref "$REF" --output json)
ANON_KEY=$(echo "$KEYS_JSON" | python3 -c "
import sys, json
keys = json.load(sys.stdin)
print(next(k['api_key'] for k in keys if k['name'] == 'anon'))
")
SERVICE_KEY=$(echo "$KEYS_JSON" | python3 -c "
import sys, json
keys = json.load(sys.stdin)
print(next(k['api_key'] for k in keys if k['name'] == 'service_role'))
")

# ── 6. Push to Vercel production ────────────────────────────────────────
echo "==> Updating Vercel production env vars"
for triple in \
  "NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL" \
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY" \
  "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY"; do
  key="${triple%%=*}"
  value="${triple#*=}"
  vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" production --force >/dev/null 2>&1 \
    && echo "    ✓ $key" \
    || echo "    ✗ $key"
done

# ── 7. Redeploy ─────────────────────────────────────────────────────────
echo "==> Triggering fresh production deploy"
vercel deploy --prod

echo ""
echo "===================================================="
echo "Done. Supabase project: $SUPA_URL"
echo ""
echo "Manual steps remaining (CANNOT be CLI-driven):"
echo "  1. Supabase Dashboard → Auth → URL Configuration"
echo "     Site URL: https://mashi-beacon-sw.vercel.app"
echo "     Redirect URLs: https://mashi-beacon-sw.vercel.app/**"
echo ""
echo "  2. Supabase Dashboard → Auth → Providers → Google"
echo "     Enable, paste GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET"
echo ""
echo "  3. Google Cloud Console → OAuth client → Authorized redirect URIs"
echo "     Add: ${SUPA_URL}/auth/v1/callback"
echo "     Add: https://mashi-beacon-sw.vercel.app/auth/callback"
echo "     Add: https://mashi-beacon-sw.vercel.app/api/connect/gmail/callback"
echo "     Add: https://mashi-beacon-sw.vercel.app/api/connect/gcal/callback"
echo ""
echo "     Authorized JavaScript origins"
echo "     Add: https://mashi-beacon-sw.vercel.app"
echo ""
echo "  4. (If using Slack/Linear in production)"
echo "     Slack app → OAuth & Permissions"
echo "       Redirect: https://mashi-beacon-sw.vercel.app/api/connect/slack/callback"
echo "     Linear → Settings → API → OAuth Applications"
echo "       Redirect: https://mashi-beacon-sw.vercel.app/api/connect/linear/callback"
echo "===================================================="
