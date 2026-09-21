#!/usr/bin/env bash
# Instala el agente en /opt/alonso-home y habilita systemd + watchdog.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${DEST:-/opt/alonso-home}"
RUN_USER="${RUN_USER:-${SUDO_USER:-pi}}"

mkdir -p "${DEST}"
rsync -a --delete --exclude node_modules --exclude .next --exclude data --exclude .git \
  "${ROOT}/" "${DEST}/"

cd "${DEST}"
sudo -u "${RUN_USER}" bash -lc 'corepack enable && pnpm install && pnpm --filter @alonso/shared build && pnpm --filter @alonso/pi-agent build'

install -d "${DEST}/apps/pi-agent/data"
chown -R "${RUN_USER}:${RUN_USER}" "${DEST}"

if [[ ! -f "${DEST}/apps/pi-agent/.env" ]]; then
  cat >"${DEST}/apps/pi-agent/.env" <<EOF
CLOUD_URL=${CLOUD_URL:-https://TU-APP.vercel.app}
DEVICE_TOKEN=${DEVICE_TOKEN:-cambiá-este-token}
GPIO_MOCK=0
MQTT_ENABLED=1
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USER=alonso
MQTT_PASSWORD=alonso
TZ=America/Argentina/Buenos_Aires
DATA_DIR=./data
LOCAL_API_PORT=3001
EOF
  chown "${RUN_USER}:${RUN_USER}" "${DEST}/apps/pi-agent/.env"
  echo "Editá ${DEST}/apps/pi-agent/.env (CLOUD_URL y DEVICE_TOKEN)."
fi

sed -e "s|/opt/alonso-home/apps/pi-agent|${DEST}/apps/pi-agent|g" \
    -e "s|User=pi|User=${RUN_USER}|g" \
    "${ROOT}/deploy/systemd/alonso-pi-agent.service" \
  > /etc/systemd/system/alonso-pi-agent.service

# El usuario necesita GPIO
usermod -aG gpio,dialout "${RUN_USER}" || true

systemctl daemon-reload
systemctl enable alonso-pi-agent
systemctl restart alonso-pi-agent
systemctl --no-pager --full status alonso-pi-agent || true
echo "Watchdog systemd: WatchdogSec=30. Logs: journalctl -u alonso-pi-agent -f"
