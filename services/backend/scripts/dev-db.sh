#!/usr/bin/env bash
# Run a command with DATABASE_URL pointed at the Railway dev Postgres, over an SSH tunnel.
#
#   ./scripts/dev-db.sh node scripts/load-policy-drafts.mjs
#   ./scripts/dev-db.sh node scripts/promote-policy-drafts.mjs --version v0.1-draft ...
#
# The tunnel is opened and closed by this script. The connection string is assembled
# in-shell from the platform's own variables and is never echoed. The database
# password printed by `railway connect` is filtered out of this script's output.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PORT="${KG_DEV_DB_PORT:-55433}"
TUNNEL_LOG="$(mktemp -t kg-tunnel.XXXXXX)"
TUNNEL_PID=""

cleanup() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  # `railway connect` spawns an `ssh` child that outlives the parent and keeps the
  # forwarded port listening. Kill whatever still holds the port.
  local holders
  holders="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -n "$holders" ] && kill $holders 2>/dev/null || true
  sleep 1
  rm -f "$TUNNEL_LOG"
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
    echo "warning: port $PORT still listening after cleanup" >&2
  fi
}
trap cleanup EXIT

# A registered key is not enough; the agent must actually hold it.
if ! ssh-add -l >/dev/null 2>&1; then
  eval "$(ssh-agent -s)" >/dev/null
  ssh-add "$HOME/.ssh/id_ed25519" >/dev/null 2>&1 || {
    echo "error: SSH key ~/.ssh/id_ed25519 not available. Run: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ''" >&2
    exit 1
  }
fi

cd "$ROOT"
railway connect Postgres --tunnel-only -P "$PORT" >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

for _ in $(seq 1 30); do
  if nc -z 127.0.0.1 "$PORT" 2>/dev/null; then break; fi
  sleep 1
done
if ! nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
  echo "error: tunnel did not open on port $PORT" >&2
  exit 1
fi

# Pull the credentials into shell variables without printing them.
RAILWAY_VARS="$(railway variables --service Postgres --json 2>/dev/null)"
DATABASE_URL="$(RAILWAY_VARS="$RAILWAY_VARS" DB_PORT="$PORT" python3 -c '
import json, os, urllib.parse
d = json.loads(os.environ["RAILWAY_VARS"])
user = urllib.parse.quote(d["PGUSER"], safe="")
pw = urllib.parse.quote(d["PGPASSWORD"], safe="")
db = urllib.parse.quote(d["PGDATABASE"], safe="")
port = os.environ["DB_PORT"]
print("postgres://" + user + ":" + pw + "@127.0.0.1:" + port + "/" + db)
')"
export DATABASE_URL

"$@"
