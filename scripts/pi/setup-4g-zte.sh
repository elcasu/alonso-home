#!/usr/bin/env bash
# ZTE D9250 / 19d2:1557: aparece como eth1 (cdc_ether), no como módem GSM.
# DHCP + default con metric alta: eth0 (Huawei) gana; ping -I eth1 usa el 4G.
# No uses never-default: sin esa ruta, ping -I eth1 a 1.1.1.1 falla.
set -euo pipefail

IFACE="${IFACE:-eth1}"
CON_NAME="${CON_NAME:-alonso-4g-usb}"
METRIC="${METRIC:-2000}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

echo "Esperando ${IFACE} (modeswitch 1225→1557, ~20 s)..."
for _ in $(seq 1 30); do
  if ip -br link show "${IFACE}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! ip -br link show "${IFACE}" >/dev/null 2>&1; then
  echo "No apareció ${IFACE}. lsusb / dmesg | grep -i cdc_ether"
  lsusb | grep -i 19d2 || true
  exit 1
fi

ip link set "${IFACE}" up || true

if nmcli -t connection show | grep -q "^${CON_NAME}:"; then
  nmcli connection delete "${CON_NAME}" || true
fi

nmcli connection add type ethernet ifname "${IFACE}" con-name "${CON_NAME}" \
  ipv4.method auto \
  ipv4.route-metric "${METRIC}" \
  ipv4.never-default no \
  ipv4.ignore-auto-dns yes \
  ipv4.dns "1.1.1.1,8.8.8.8" \
  ipv6.method ignore \
  connection.autoconnect yes \
  connection.autoconnect-retries 0

nmcli connection up "${CON_NAME}"

echo
echo "Rutas:"
ip route
echo
echo "Prueba 4G (no toca SSH por eth0):"
ping -c 3 -W 3 -I "${IFACE}" 1.1.1.1 || true
curl -sS -m 15 --interface "${IFACE}" https://ifconfig.me && echo
echo
echo "Persistido: ${CON_NAME} en NetworkManager (metric ${METRIC}, sin DNS del palo)."
