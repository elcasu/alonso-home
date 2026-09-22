#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Creé .env desde .env.example. Editá FRIGATE_RTSP_PASSWORD si ya tenés las GT-N3."
fi

python3 scripts/render-config.py
mkdir -p data/s3-dry
docker compose up -d --build
echo
echo "Frigate:  http://127.0.0.1:${FRIGATE_UI_PORT:-8971}"
echo "Logs:     docker compose -f $(pwd)/docker-compose.yml logs -f"
echo "S3:       bash scripts/ensure-bucket.sh   (cuando AWS CLI tenga credenciales)"
