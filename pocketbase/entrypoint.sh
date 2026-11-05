#!/bin/sh
set -e
ARGS="--dir=/pb/pb_data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"
pocketbase migrate up $ARGS
pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" $ARGS
exec pocketbase serve --http=0.0.0.0:8090 --hooksWatch=false --automigrate=false $ARGS
