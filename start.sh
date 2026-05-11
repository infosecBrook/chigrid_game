#!/bin/sh
set -eu

: "${PORT:=8080}"

echo "Starting ChiGrid on 0.0.0.0:${PORT}"
exec python -m gunicorn app:app \
  --workers 1 \
  --threads 8 \
  --timeout 120 \
  --bind "0.0.0.0:${PORT}"
