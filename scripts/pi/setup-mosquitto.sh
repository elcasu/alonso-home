#!/usr/bin/env bash
# Instala/actualiza Mosquitto del sistema en la Pi (broker único para ESP, pi-agent y HA).
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MQTT_USER="${MQTT_USER:-alonso}"
MQTT_PASSWORD="${MQTT_PASSWORD:-alonso}"
MQTT_HA_USER="${MQTT_HA_USER:-ha}"
MQTT_HA_PASSWORD="${MQTT_HA_PASSWORD:-}"

# Si hay deploy/homeassistant/.env, reutilizar esas claves (mismo broker que up.sh).
ha_env="${ROOT}/deploy/homeassistant/.env"
if [[ -f "$ha_env" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ha_env"; set +a
  MQTT_USER="${MQTT_DEVICE_USER:-$MQTT_USER}"
  MQTT_PASSWORD="${MQTT_DEVICE_PASSWORD:-$MQTT_PASSWORD}"
  MQTT_HA_USER="${MQTT_HA_USER:-ha}"
  MQTT_HA_PASSWORD="${MQTT_HA_PASSWORD:-}"
fi

install -d /etc/mosquitto/conf.d /etc/mosquitto/passwords

# Listeners: localhost, AP, docker0 (HA en bridge) y demás IPv4 globales no-WAN.
write_conf() {
  local conf=/etc/mosquitto/conf.d/alonso.conf
  local -a ips=()
  local ip iface

  add_ip() {
    local candidate="$1"
    [[ -z "$candidate" ]] && return
    local seen
    for seen in "${ips[@]+"${ips[@]}"}"; do
      [[ "$seen" == "$candidate" ]] && return
    done
    ips+=("$candidate")
  }

  add_ip "127.0.0.1"
  add_ip "192.168.4.1"

  if [[ -d /sys/class/net/docker0 ]]; then
    ip="$(ip -4 -o addr show dev docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
    add_ip "$ip"
  fi

  while read -r iface ip; do
    [[ -z "$iface" || -z "$ip" ]] && continue
    # Evitar módems USB / WWAN típicos
    case "$iface" in
      docker*|br-*|veth*|lo|wwan*|usb*|ppp*|tun*|tap*) continue ;;
    esac
    case "$ip" in
      127.*|169.254.*) continue ;;
    esac
    add_ip "$ip"
  done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{gsub(/\/.*/,"",$4); print $2, $4}')

  {
    echo "# Generado por scripts/pi/setup-mosquitto.sh — no editar a mano."
    echo "bind_interfaces"
    for ip in "${ips[@]}"; do
      echo "listener 1883 ${ip}"
    done
    echo "allow_anonymous false"
    echo "password_file /etc/mosquitto/passwords/alonso"
    echo "persistence true"
    echo "persistence_location /var/lib/mosquitto/"
    echo "log_type error"
    echo "log_type warning"
  } >"$conf"

  echo "Listeners MQTT:"
  printf '  %s\n' "${ips[@]}"
}

write_conf

passwd_file=/etc/mosquitto/passwords/alonso
if [[ ! -f "$passwd_file" ]]; then
  mosquitto_passwd -b -c "$passwd_file" "${MQTT_USER}" "${MQTT_PASSWORD}"
else
  mosquitto_passwd -b "$passwd_file" "${MQTT_USER}" "${MQTT_PASSWORD}"
fi
if [[ -n "${MQTT_HA_PASSWORD}" ]]; then
  mosquitto_passwd -b "$passwd_file" "${MQTT_HA_USER}" "${MQTT_HA_PASSWORD}"
fi
chown mosquitto:mosquitto "$passwd_file"
chmod 640 "$passwd_file"

systemctl enable mosquitto
systemctl restart mosquitto
echo "Mosquitto en 1883 (localhost/LAN/AP/docker). users=${MQTT_USER}${MQTT_HA_PASSWORD:+, ${MQTT_HA_USER}}"
