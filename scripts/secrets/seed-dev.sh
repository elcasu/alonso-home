#!/usr/bin/env bash
# Regenera secretos de desarrollo, los sube a Infisical (env=dev) y exporta .env locales.
# No imprime valores. Uso: ./scripts/secrets/seed-dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

if ! command -v infisical >/dev/null 2>&1; then
  echo "Falta el CLI de Infisical." >&2
  exit 1
fi
if [[ ! -f "${ROOT}/.infisical.json" ]]; then
  echo "Falta .infisical.json (infisical init)." >&2
  exit 1
fi

gen() {
  # ~40 chars URL-safe
  openssl rand -base64 48 | tr -d '/+=\n' | head -c 40
}

DEVICE_TOKEN="$(gen)"
SESSION_SECRET="$(gen)$(gen)"
ADMIN_PASSWORD="$(gen)"
MQTT_DEVICE_PASSWORD="$(gen)"
MQTT_HA_PASSWORD="$(gen)"

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

# --- /shared ---
cat >"${tmpdir}/shared.env" <<EOF
DEVICE_TOKEN=${DEVICE_TOKEN}
MQTT_DEVICE_PASSWORD=${MQTT_DEVICE_PASSWORD}
MQTT_HA_PASSWORD=${MQTT_HA_PASSWORD}
EOF

# --- /web ---
# DATABASE_URL vacío = store en memoria (README). Con Postgres local:
#   docker compose up -d
#   y seteá DATABASE_URL=postgres://alonso:alonso@localhost:5432/alonso
cat >"${tmpdir}/web.env" <<EOF
DATABASE_URL=
ADMIN_PASSWORD=${ADMIN_PASSWORD}
SESSION_SECRET=${SESSION_SECRET}
DEVICE_TOKEN=${DEVICE_TOKEN}
EOF

# --- /pi-agent (dev: mock GPIO, MQTT off por defecto) ---
cat >"${tmpdir}/pi-agent.env" <<EOF
CLOUD_URL=http://localhost:4074
DEVICE_TOKEN=${DEVICE_TOKEN}
GPIO_MOCK=1
GPIO_ACTIVE_LOW=1
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USER=alonso
MQTT_PASSWORD=${MQTT_DEVICE_PASSWORD}
MQTT_ENABLED=0
HA_ENABLED=0
HA_MQTT_URL=mqtt://127.0.0.1:1883
HA_MQTT_USER=alonso
HA_MQTT_PASSWORD=${MQTT_DEVICE_PASSWORD}
TZ=America/Argentina/Buenos_Aires
LOCAL_API_PORT=3001
DATA_DIR=./data
CAMERA_SINK=auto
IOT_CLIENT_ID=alonso-pi
IOT_CERTS_DIR=./certs
EOF

# --- /homeassistant ---
cat >"${tmpdir}/homeassistant.env" <<EOF
TZ=America/Argentina/Buenos_Aires
HA_PORT=8124
MQTT_PORT=1883
MQTT_MODE=local
MQTT_HA_USER=ha
MQTT_HA_PASSWORD=${MQTT_HA_PASSWORD}
MQTT_DEVICE_USER=alonso
MQTT_DEVICE_PASSWORD=${MQTT_DEVICE_PASSWORD}
EOF

# --- /cameras (mínimo; sin claves AWS) ---
cat >"${tmpdir}/cameras.env" <<EOF
FRIGATE_LAB=1
FRIGATE_RTSP_USER=admin
FRIGATE_RTSP_PASSWORD=${MQTT_DEVICE_PASSWORD}
AWS_REGION=us-east-2
S3_BUCKET=alonso-home-nvr
S3_PREFIX=events
TZ=America/Argentina/Buenos_Aires
FRIGATE_UI_PORT=8971
EOF

set_path() {
  local path="$1"
  local file="$2"
  echo "Subiendo ${path} ..."
  infisical secrets set --env=dev --path="${path}" --file="${file}" --silent
}

set_path /shared "${tmpdir}/shared.env"
set_path /web "${tmpdir}/web.env"
set_path /pi-agent "${tmpdir}/pi-agent.env"
set_path /homeassistant "${tmpdir}/homeassistant.env"
set_path /cameras "${tmpdir}/cameras.env"

echo "Exportando .env locales ..."
"${ROOT}/scripts/secrets/export-env.sh" dev

echo
echo "Listo (env=dev). Valores solo en Infisical y en los .env locales (modo 600)."
echo "Si usás Vercel/Pi con el DEVICE_TOKEN viejo, actualizalo al nuevo (export o UI)."
echo "devices.json (Tuya) no se tocó."
