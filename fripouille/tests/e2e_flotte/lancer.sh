#!/usr/bin/env bash
# Banc de bout en bout des Flottes Royales : vraie API Fripouille (Discord simulé) + vrai
# dashboard (next build + next start) + Chromium piloté par Playwright.
#
#   fripouille/tests/e2e_flotte/lancer.sh            # build + tous les scénarios
#   fripouille/tests/e2e_flotte/lancer.sh --sans-build deux_navigateurs
#   BANC_METEO=tempete fripouille/tests/e2e_flotte/lancer.sh --sans-build meteo
#
# Prérequis : PYTHON = un python avec les dépendances du bot (aiohttp, discord.py,
# python-dotenv), npm ci fait dans dashboard/, Playwright (global, ou PW=…) et son Chromium
# (ou CHROMIUM=/chemin/vers/chrome). Ports : 8091 (API) et 3077 (dashboard).
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../../.." && pwd)"
PYTHON="${PYTHON:-python3}"
export BANC_SORTIE="${BANC_SORTIE:-$ICI/captures}"
mkdir -p "$BANC_SORTIE"
SECRET="secret-banc-0123456789abcdef0123456789"
PIDS=()
arreter() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap arreter EXIT

BUILD=1
if [ "${1:-}" = "--sans-build" ]; then BUILD=0; shift; fi
if [ $# -gt 0 ]; then SCENARIOS=("$@"); else SCENARIOS=(non_regression deux_navigateurs fin_de_partie); fi

if [ $BUILD = 1 ]; then
  echo "▸ next build"
  (cd "$RACINE/dashboard" && AUTH_SECRET="$SECRET" npx next build > "$BANC_SORTIE/build.log" 2>&1) || { tail -30 "$BANC_SORTIE/build.log"; exit 1; }
fi
echo "▸ API Fripouille du banc (port 8091${BANC_METEO:+, météo $BANC_METEO})"
(cd "$RACINE" && exec "$PYTHON" "$ICI/api_banc.py" > "$BANC_SORTIE/api.log" 2>&1) & PIDS+=($!)
echo "▸ dashboard (port 3077)"
(cd "$RACINE/dashboard" && AUTH_SECRET="$SECRET" AUTH_URL=http://localhost:3077 AUTH_TRUST_HOST=true \
  FRIPOUILLE_API_BASE_URL=http://127.0.0.1:8091 FRIPOUILLE_API_TOKEN=jeton-banc \
  ALLOWED_DISCORD_IDS=100000000000000007 DISCORD_CLIENT_ID=banc DISCORD_CLIENT_SECRET=banc \
  exec node node_modules/next/dist/bin/next start -p 3077 > "$BANC_SORTIE/next.log" 2>&1) & PIDS+=($!)
for _ in $(seq 1 40); do
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3077/login 2>/dev/null | grep -q 200 && break; sleep 1
done
ECHECS=0
for s in "${SCENARIOS[@]}"; do
  echo "▸ $s"
  node "$ICI/$s.mjs" || { echo "  ✗ $s"; ECHECS=$((ECHECS + 1)); }
done
echo "Captures et journaux : $BANC_SORTIE"
exit $ECHECS
