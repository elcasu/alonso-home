#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MQTT_USER="${MQTT_USER:-alonso}"
MQTT_PASSWORD="${MQTT_PASSWORD:-alonso}"

install -d /etc/mosquitto/conf.d /etc/mosquitto/passwords
cp "${ROOT}/deploy/mosquitto/alonso.conf" /etc/mosquitto/conf.d/alonso.conf
mosquitto_passwd -b -c /etc/mosquitto/passwords/alonso "${MQTT_USER}" "${MQTT_PASSWORD}"
chown mosquitto:mosquitto /etc/mosquitto/passwords/alonso
chmod 640 /etc/mosquitto/passwords/alonso

systemctl enable mosquitto
systemctl restart mosquitto
echo "Mosquitto en 1883, solo LAN. user=${MQTT_USER}"
