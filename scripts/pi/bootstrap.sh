#!/usr/bin/env bash
# Banco de pruebas Raspberry Pi 3 — Alonso Home (sin 220 V).
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates curl git build-essential python3 python3-gpiozero \
  usb-modeswitch usb-modeswitch-data ppp network-manager \
  mosquitto mosquitto-clients hostapd dnsmasq iptables iw wireless-tools \
  sqlite3

# Node 20
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

corepack enable
corepack prepare pnpm@9.15.0 --activate

# hostapd no debe quedar enmascarado en Raspberry Pi OS
systemctl unmask hostapd || true
systemctl disable hostapd dnsmasq || true

# GPIO: el usuario del servicio debe estar en el grupo gpio
usermod -aG gpio,dialout "${SUDO_USER:-pi}" || true

echo
echo "Listo. Siguiente:"
echo "  1) Probar un relé/LED:  sudo -u ${SUDO_USER:-pi} python3 scripts/pi/gpio-test.py --pin 17"
echo "  2) Modem 4G:            sudo bash scripts/pi/setup-4g.sh"
echo "  3) AP + MQTT:           sudo bash scripts/pi/setup-ap.sh && sudo bash scripts/pi/setup-mosquitto.sh"
echo "  4) Agente:              pnpm --filter @alonso/pi-agent build && sudo cp deploy/systemd/alonso-pi-agent.service /etc/systemd/system/"
