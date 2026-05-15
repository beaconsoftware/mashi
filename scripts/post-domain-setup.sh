#!/usr/bin/env bash
#
# Run after mashi.beaconsoftware.com DNS has propagated and Vercel issued
# the SSL cert. Wires up the new domain everywhere it needs to be.
#
# Requires:
#   - SUPABASE_ACCESS_TOKEN env var (paste a token if revoked the old one)
#   - vercel CLI authenticated
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_... bash scripts/post-domain-setup.sh

set -euo pipefail

DOMAIN="${DOMAIN:-mashi.beaconsoftware.com}"
SUPABASE_REF="${SUPABASE_REF:-akpbzaivscqvaoapkdwd}"
APP_URL="https://$DOMAIN"

echo "==> Verifying domain is reachable"
if ! curl -sI "$APP_URL" -o /dev/null -w "%{http_code}\n" --max-time 10 | grep -qE "^(2|3|4)"; then
  echo "    Domain not reachable yet. DNS hasn't propagated or Vercel hasn't"
  echo "    issued the cert. Wait 5-15 min and re-run."
  exit 1
fi
echo "    OK"

echo "==> Updating Vercel NEXT_PUBLIC_APP_URL"
vercel env rm NEXT_PUBLIC_APP_URL production --yes </dev/null >/dev/null 2>&1 || true
printf '%s' "$APP_URL" | vercel env add NEXT_PUBLIC_APP_URL production --force </dev/null >/dev/null
echo "    ✓ Set to $APP_URL"

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "==> Updating Supabase Auth Site URL + redirect allowlist"
  ALLOWLIST="$APP_URL/**,http://localhost:3456/**"
  curl -sS -X PATCH \
    "https://api.supabase.com/v1/projects/$SUPABASE_REF/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"site_url\":\"$APP_URL\",\"uri_allow_list\":\"$ALLOWLIST\"}" \
    >/dev/null
  echo "    ✓ Supabase Site URL = $APP_URL"
  echo "    ✓ Supabase redirect allowlist updated"
else
  echo "==> Skipping Supabase update (SUPABASE_ACCESS_TOKEN not set)"
  echo "    Set it manually in Dashboard:"
  echo "    Site URL: $APP_URL"
  echo "    Additional Redirect URLs: $APP_URL/**, http://localhost:3456/**"
fi

echo "==> Triggering fresh production deploy"
vercel deploy --prod 2>&1 | grep -E "url|readyState" | tail -3

echo ""
echo "===================================================="
echo "Done. Live on $APP_URL"
echo ""
echo "Manual: add these to Google OAuth client redirect URIs"
echo "(Google Cloud Console → Credentials → your OAuth client)"
echo ""
echo "  $APP_URL/auth/callback"
echo "  $APP_URL/api/connect/gmail/callback"
echo "  $APP_URL/api/connect/gcal/callback"
echo ""
echo "And under Authorized JavaScript origins:"
echo "  $APP_URL"
echo ""
echo "Also: Vercel Dashboard → Settings → Deployment Protection"
echo "  Deployment Protection Exceptions → Add Domain → $DOMAIN"
echo "===================================================="
