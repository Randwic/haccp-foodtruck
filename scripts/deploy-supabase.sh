#!/usr/bin/env bash
# Déploie la base (migrations + seed) et les Edge Functions via l'API de gestion Supabase.
# Prérequis : un jeton d'accès Supabase (sbp_…) injecté dans les requêtes vers api.supabase.com
# (dans une session Claude Code : secret réseau ; sinon : export SUPABASE_ACCESS_TOKEN=…).
# Usage : scripts/deploy-supabase.sh <project_ref> [db|functions|all]
# Secrets des fonctions (une fois, hors script) : ALLOWED_ORIGIN, PURGE_PHOTOS_SECRET (≥ 32 caractères),
# lot 6 : ALERTS_EVALUATE_SECRET (≥ 32), VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
# (scripts/generate-vapid.mjs), facultatifs : RESEND_API_KEY, ALERT_EMAIL_TO, ALERT_EMAIL_FROM.
set -euo pipefail
REF=${1:?project_ref requis}; WHAT=${2:-all}
API="https://api.supabase.com/v1/projects/$REF"
AUTH=(); [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN")
cd "$(dirname "$0")/.."

sql() { python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
  | curl -sf "${AUTH[@]}" -X POST "$API/database/query" -H 'Content-Type: application/json' --data @- >/dev/null; }

if [ "$WHAT" = db ] || [ "$WHAT" = all ]; then
  echo 'create extension if not exists pg_cron; create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);' | sql
  applied=$(echo '{"query":"select coalesce(json_agg(version),'"'"'[]'"'"') v from supabase_migrations.schema_migrations"}' \
    | curl -sf "${AUTH[@]}" -X POST "$API/database/query" -H 'Content-Type: application/json' --data @-)
  for f in supabase/migrations/*.sql; do
    b=$(basename "$f" .sql); v=${b%%_*}; n=${b#*_}
    if echo "$applied" | grep -q "\"$v\""; then echo "= $b (déjà appliquée)"; continue; fi
    echo "+ $b"; sql < "$f"
    echo "insert into supabase_migrations.schema_migrations(version,name) values ('$v','$n');" | sql
  done
  echo "+ seed.sql (idempotent)"; sql < supabase/seed.sql
fi

if [ "$WHAT" = functions ] || [ "$WHAT" = all ]; then
  for spec in sync-push:false sync-pull:false health:false device-enroll:true bootstrap-status:false bootstrap-manager:false photo-upload:false purge-photos:false \
              sensor-ingest:false alerts-evaluate:false push-subscribe:false push-config:false; do
    slug=${spec%%:*}; vj=${spec#*:}; args=()
    for f in "supabase/functions/$slug/index.ts" supabase/functions/_adapters/*.ts supabase/functions/_shared/*.ts shared/*.ts; do
      case "$f" in *.test.ts|*memory_repo.ts|*test_helpers.ts) continue;; esac
      args+=(-F "file=@$f;filename=$f;type=application/typescript")
    done
    echo "+ fonction $slug"
    curl -sf -o /dev/null "${AUTH[@]}" -X POST "$API/functions/deploy?slug=$slug" \
      -F "metadata={\"name\":\"$slug\",\"entrypoint_path\":\"supabase/functions/$slug/index.ts\",\"verify_jwt\":$vj};type=application/json" "${args[@]}"
  done
fi
echo "Terminé."
