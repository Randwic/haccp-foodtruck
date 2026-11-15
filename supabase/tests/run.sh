#!/usr/bin/env bash
# =============================================================================
# Tests SQL du backend HACCP.
#  1. crée un cluster PostgreSQL 16 jetable (dossier temporaire, port libre) ;
#  2. installe les stubs Supabase (rôles, schéma auth) ;
#  3. applique supabase/migrations/*.sql dans l'ordre puis supabase/seed.sql ;
#  4. exécute chaque fichier supabase/tests/sql/*.sql dans une base neuve
#     (clonée du modèle) ;
#  5. détruit le cluster. Code de sortie ≠ 0 au premier échec.
# Usage : bash supabase/tests/run.sh
# =============================================================================
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPA="$(cd "$HERE/.." && pwd)"

TMP="$(mktemp -d -t haccp-pgtest-XXXXXX)"
DATA="$TMP/data"
LOG="$TMP/postgres.log"

# initdb refuse de tourner en root : on délègue à l'utilisateur système postgres.
AS=()
if [ "$(id -u)" = "0" ]; then
  AS=(runuser -u postgres --)
  chown postgres "$TMP"
fi

PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"

cleanup() {
  local code=$?
  if [ -f "$DATA/postmaster.pid" ]; then
    "${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  if [ $code -ne 0 ] && [ -f "$LOG" ]; then
    echo "---- fin du journal PostgreSQL ----" >&2
    tail -n 20 "$LOG" >&2 || true
  fi
  rm -rf "$TMP"
  exit $code
}
trap cleanup EXIT INT TERM

echo "==> Cluster temporaire : $DATA (port $PORT)"
"${AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" -w \
  -o "-p $PORT -k $TMP -c listen_addresses='' -c fsync=off" start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORT" -U postgres)

"${PSQL[@]}" -d postgres -c "create database haccp_template"

echo "==> Stubs Supabase"
"${PSQL[@]}" -d haccp_template -f "$HERE/supabase_stubs.sql"

echo "==> Migrations"
shopt -s nullglob
for f in "$SUPA"/migrations/*.sql; do
  echo "    $(basename "$f")"
  "${PSQL[@]}" -d haccp_template -f "$f"
done

echo "    (lot 3 rejoué : la migration doit être idempotente)"
"${PSQL[@]}" -d haccp_template -f "$SUPA/migrations/20261114001000_lot3_reception.sql"
echo "    (lot 4 rejoué : la migration doit être idempotente)"
"${PSQL[@]}" -d haccp_template -f "$SUPA/migrations/20261114001100_lot4_produits.sql"
echo "    (lot 5 rejoué : la migration doit être idempotente)"
"${PSQL[@]}" -d haccp_template -f "$SUPA/migrations/20261114001300_lot5_nettoyage.sql"
echo "    (lot 6 rejoué : la migration doit être idempotente)"
"${PSQL[@]}" -d haccp_template -f "$SUPA/migrations/20261114001400_lot6_alertes.sql"

echo "==> Seed"
"${PSQL[@]}" -d haccp_template -f "$SUPA/seed.sql"
echo "    (seed rejoué : doit être idempotent)"
"${PSQL[@]}" -d haccp_template -f "$SUPA/seed.sql"

echo "==> Aides et données de test"
"${PSQL[@]}" -d haccp_template -o /dev/null -f "$HERE/helpers.sql"

total=0
for f in "$HERE"/sql/*.sql; do
  name="$(basename "$f" .sql)"
  db="t_${name//[^a-zA-Z0-9]/_}"
  "${PSQL[@]}" -d postgres -c "create database $db template haccp_template"
  echo "==> $name"
  out="$("${PSQL[@]}" -d "$db" -o /dev/null -f "$f" 2>&1)" || { echo "$out"; echo "ÉCHEC dans $name" >&2; exit 1; }
  echo "$out" | grep -E '^(psql:.*)?(NOTICE|WARNING):' | sed -E 's/^psql:[^ ]+ NOTICE:  /    /; s/^NOTICE:  /    /'
  n="$(echo "$out" | grep -c 'ok - ' || true)"
  total=$((total + n))
done

# -----------------------------------------------------------------------------
# Concurrence : deux bootstrap_manager() simultanés, un seul réussit.
# A garde sa transaction ouverte (pg_sleep) ; B démarre pendant ce temps, attend le
# verrou consultatif puis doit voir le gérant de A et échouer (already_bootstrapped).
# -----------------------------------------------------------------------------
echo "==> concurrence bootstrap_manager"
"${PSQL[@]}" -d postgres -c "create database t_bootstrap_race template haccp_template"
U1=0000000c-0000-4000-8000-0000000000c1
U2=0000000c-0000-4000-8000-0000000000c2
SALT="$(python3 -c 'import base64; print(base64.b64encode(bytes(16)).decode())')"
HASH="$(python3 -c 'import base64; print(base64.b64encode(bytes(32)).decode())')"
"${PSQL[@]}" -d t_bootstrap_race -c "delete from public.managers; insert into auth.users (id, email) values ('$U1', 'a@example.test'), ('$U2', 'b@example.test');"
boot_sql() { echo "set role service_role; begin; select public.bootstrap_manager('$1', 'Gérant $1', '$SALT', '$HASH', 'Camion $1'); select pg_sleep($2); commit;"; }
"${PSQL[@]}" -d t_bootstrap_race -c "$(boot_sql "$U1" 1.5)" >"$TMP/race_a.out" 2>&1 &
PID_A=$!
sleep 0.4
set +e
"${PSQL[@]}" -d t_bootstrap_race -c "$(boot_sql "$U2" 0)" >"$TMP/race_b.out" 2>&1
CODE_B=$?
wait "$PID_A"
CODE_A=$?
set -e
[ "$CODE_A" = 0 ] || { cat "$TMP/race_a.out"; echo "ÉCHEC : le premier bootstrap devait réussir" >&2; exit 1; }
[ "$CODE_B" != 0 ] && grep -q 'HACCP: already_bootstrapped' "$TMP/race_b.out" \
  || { cat "$TMP/race_b.out"; echo "ÉCHEC : le bootstrap concurrent devait être refusé (already_bootstrapped)" >&2; exit 1; }
n="$("${PSQL[@]}" -d t_bootstrap_race -At -c "select count(*) || '|' || string_agg(user_id::text, ',') from public.managers")"
[ "$n" = "1|$U1" ] || { echo "ÉCHEC : un seul gérant attendu, obtenu $n" >&2; exit 1; }
echo "    ok - deux bootstrap simultanés : un seul gérant ($U1), le second refusé"
total=$((total + 1))

echo "==> TOUS LES TESTS SONT PASSÉS ($total assertions)"
