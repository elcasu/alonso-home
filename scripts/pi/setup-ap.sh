#!/usr/bin/env bash
# Access Point wlan0 (192.168.4.1) para los ESP32. El 4G queda como WAN.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSID="${SSID:-alonso-home}"
PSK="${PSK:-alonso-home-wifi}"
WLAN_IF="${WLAN_IF:-wlan0}"
WAN_IF="${WAN_IF:-}"  # vacío = detectar (ppp0, wwan0, usb0, eth0)

install -d /etc/hostapd
sed -e "s/__SSID__/${SSID}/g" -e "s/__PSK__/${PSK}/g" -e "s/__WLAN__/${WLAN_IF}/g" \
  "${ROOT}/deploy/hostapd/hostapd.conf" > /etc/hostapd/hostapd.conf

install -d /etc/dnsmasq.d
cp "${ROOT}/deploy/dnsmasq/dnsmasq-alonso.conf" /etc/dnsmasq.d/alonso.conf

# IP estática del AP
cat >/etc/network/interfaces.d/alonso-ap <<EOF
auto ${WLAN_IF}
iface ${WLAN_IF} inet static
  address 192.168.4.1
  netmask 255.255.255.0
EOF

if command -v nmcli >/dev/null 2>&1; then
  nmcli dev set "${WLAN_IF}" managed no || true
fi

ip addr add 192.168.4.1/24 dev "${WLAN_IF}" 2>/dev/null || true
ip link set "${WLAN_IF}" up

# NAT hacia WAN
if [[ -z "${WAN_IF}" ]]; then
  for cand in wwan0 ppp0 usb0 eth0 enx*; do
    if ip -br link show "${cand}" >/dev/null 2>&1; then
      WAN_IF="${cand}"
      break
    fi
  done
fi

sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-alonso-ipforward.conf

if [[ -n "${WAN_IF}" ]]; then
  iptables -t nat -C POSTROUTING -o "${WAN_IF}" -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -o "${WAN_IF}" -j MASQUERADE
  iptables -C FORWARD -i "${WLAN_IF}" -o "${WAN_IF}" -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -i "${WLAN_IF}" -o "${WAN_IF}" -j ACCEPT
  echo "NAT ${WLAN_IF} -> ${WAN_IF}"
else
  echo "No detecté WAN. Cuando el 4G esté arriba: WAN_IF=wwan0 sudo bash $0"
fi

systemctl enable hostapd dnsmasq
systemctl restart hostapd dnsmasq
echo "AP ${SSID} en 192.168.4.1 — password: ${PSK}"
