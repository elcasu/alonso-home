#!/usr/bin/env bash
# Une wlan0 al Wi‑Fi del router de la casa sin tocar la salida a internet (4G)
# ni Tailscale. Pensado para correr por SSH remoto.
#
# Problema típico: el ZTE (eth1) ya usa 192.168.0.0/24 y el router de la casa
# también. Si unís el Wi‑Fi sin renumerar el modem, se rompe el 4G y el túnel.
#
# Uso (desde la Pi, por SSH):
#
#   export WIFI_SSID='NombreDeLaRed'
#   export WIFI_PASSWORD='clave'
#   # Si eth1 está en 192.168.0.0/24, hace falta renumerar el ZTE:
#   export RENUMBER_ZTE=1
#   export ZTE_PASSWORD='admin'          # clave del panel del modem (a menudo admin)
#   export ZTE_NEW_LAN_IP='192.168.8.1'  # opcional
#   sudo --preserve-env=WIFI_SSID,WIFI_PASSWORD,RENUMBER_ZTE,ZTE_PASSWORD,ZTE_NEW_LAN_IP \
#     bash scripts/pi/setup-house-wifi.sh
#
# El Wi‑Fi queda con never-default: solo LAN de la casa. Internet sigue por 4G.
# Hay un rollback a los 8 min si no se confirma el éxito (por si se corta el SSH).
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo (y --preserve-env=... para las variables)."
  exit 1
fi

WIFI_SSID="${WIFI_SSID:-}"
WIFI_PASSWORD="${WIFI_PASSWORD:-}"
WIFI_IFACE="${WIFI_IFACE:-wlan0}"
WIFI_CON="${WIFI_CON:-alonso-house-wifi}"
WIFI_METRIC="${WIFI_METRIC:-3000}"
MODEM_IFACE="${MODEM_IFACE:-eth1}"
MODEM_CON="${MODEM_CON:-alonso-4g-usb}"
RENUMBER_ZTE="${RENUMBER_ZTE:-0}"
ZTE_PASSWORD="${ZTE_PASSWORD:-admin}"
ZTE_NEW_LAN_IP="${ZTE_NEW_LAN_IP:-192.168.8.1}"
HOUSE_PING_HOST="${HOUSE_PING_HOST:-192.168.0.105}"
ROLLBACK_MINUTES="${ROLLBACK_MINUTES:-8}"
STAMP="/run/alonso-house-wifi.ok"
ROLLBACK_UNIT="alonso-house-wifi-rollback"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "falta el comando: $1"
}

cidr_of_iface() {
  local iface="$1"
  ip -4 -o addr show dev "${iface}" 2>/dev/null \
    | awk '{print $4}' | head -1
}

prefix24() {
  # 192.168.0.100/24 -> 192.168.0.0/24
  local cidr="$1"
  local ip="${cidr%/*}"
  local a b c
  IFS=. read -r a b c _ <<<"${ip}"
  echo "${a}.${b}.${c}.0/24"
}

gateway_of_iface() {
  local iface="$1"
  ip -4 route show dev "${iface}" 2>/dev/null | awk '/^default/ {print $3; exit}'
}

wait_for() {
  local label="$1" seconds="$2"
  shift 2
  local i
  for i in $(seq 1 "${seconds}"); do
    if "$@"; then
      return 0
    fi
    sleep 1
  done
  die "timeout esperando: ${label}"
}

internet_ok() {
  ping -c 1 -W 3 1.1.1.1 >/dev/null 2>&1 \
    || ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1
}

tailscale_ok() {
  command -v tailscale >/dev/null 2>&1 || return 1
  tailscale status >/dev/null 2>&1
}

schedule_rollback() {
  systemctl stop "${ROLLBACK_UNIT}.timer" 2>/dev/null || true
  systemctl reset-failed "${ROLLBACK_UNIT}.service" 2>/dev/null || true
  rm -f "${STAMP}"

  # Si en N minutos no existe el stamp de éxito, baja el Wi‑Fi de la casa.
  systemd-run --unit="${ROLLBACK_UNIT}" --on-active="${ROLLBACK_MINUTES}min" \
    --description="Rollback Wi‑Fi casa Alonso" \
    bash -c "[[ -f ${STAMP} ]] || nmcli connection down '${WIFI_CON}' || true; \
             [[ -f ${STAMP} ]] || nmcli radio wifi off; sleep 1; \
             [[ -f ${STAMP} ]] || nmcli radio wifi on; \
             echo rollback-house-wifi \$(date -Is) >> /var/log/alonso-house-wifi.log"
  info "Rollback programado en ${ROLLBACK_MINUTES} min si no hay éxito (${STAMP})."
}

cancel_rollback_mark_ok() {
  : >"${STAMP}"
  info "Éxito marcado; el rollback no tocará el Wi‑Fi."
}

stop_ap_if_any() {
  if systemctl is-active --quiet hostapd 2>/dev/null; then
    info "Apago hostapd (AP en ${WIFI_IFACE}) para usar el Wi‑Fi como cliente."
    systemctl stop hostapd || true
    systemctl disable hostapd || true
  fi
  if systemctl is-active --quiet dnsmasq 2>/dev/null; then
    # Solo si el AP de Alonso lo usa; no tocamos si hay otro dueño claro.
    if [[ -f /etc/dnsmasq.d/alonso.conf ]]; then
      info "Apago dnsmasq del AP Alonso."
      systemctl stop dnsmasq || true
    fi
  fi
  nmcli dev set "${WIFI_IFACE}" managed yes 2>/dev/null || true
}

probe_zte() {
  local gw="$1"
  curl -fsS -m 5 -H "Referer: http://${gw}/index.html" \
    "http://${gw}/goform/goform_get_cmd_process?isTest=false&cmd=lan_ipaddr&multi_data=1" 2>/dev/null \
    || curl -fsS -m 5 "http://${gw}/" >/dev/null
}

# Mejor esfuerzo: varios firmwares ZTE aceptan AUTH + DHCP_SETTING / SET_ROUTER.
# Si falla, el script para con instrucciones manuales (http://GW/#router_setting).
renumber_zte() {
  local gw="$1"
  local new_ip="$2"
  local pass_b64
  pass_b64="$(printf '%s' "${ZTE_PASSWORD}" | base64 | tr -d '\n')"

  info "Intentando renumerar LAN del ZTE ${gw} -> ${new_ip} (panel del modem)."

  # Login (algunos piden password en base64, otros en claro).
  curl -fsS -m 8 -H "Referer: http://${gw}/index.html" \
    -d "isTest=false&goformId=LOGIN&password=${pass_b64}" \
    "http://${gw}/goform/goform_set_cmd_process" >/tmp/alonso-zte-login.json 2>/dev/null \
    || curl -fsS -m 8 -H "Referer: http://${gw}/index.html" \
      -d "isTest=false&goformId=LOGIN&password=${ZTE_PASSWORD}" \
      "http://${gw}/goform/goform_set_cmd_process" >/tmp/alonso-zte-login.json 2>/dev/null \
    || true

  local a b c
  IFS=. read -r a b c _ <<<"${new_ip}"
  local start_ip="${a}.${b}.${c}.100"
  local end_ip="${a}.${b}.${c}.200"

  # Variantes vistas en MF82x / MF833 / similares.
  local ok=0
  local payload
  for payload in \
    "isTest=false&goformId=DHCP_SETTING&lanIp=${new_ip}&lanNetmask=255.255.255.0&dhcpEnabled=1&dhcpStart=${start_ip}&dhcpEnd=${end_ip}&dhcpLease=24&dhcp_lease_unit=hour" \
    "isTest=false&goformId=DHCP_SETTING&ipAddress=${new_ip}&subNetMask=255.255.255.0&dhcpServerEn=1&startIp=${start_ip}&endIp=${end_ip}&leaseTime=24" \
    "isTest=false&goformId=ROUTER_SETTING&lanIp=${new_ip}&lanNetmask=255.255.255.0&dhcpEnabled=1&dhcpStart=${start_ip}&dhcpEnd=${end_ip}&dhcpLease=86400"
  do
    if curl -fsS -m 8 -H "Referer: http://${gw}/index.html" \
      -d "${payload}" \
      "http://${gw}/goform/goform_set_cmd_process" >/tmp/alonso-zte-set.json 2>/dev/null; then
      if grep -qiE 'success|sucess|"result":"0"' /tmp/alonso-zte-set.json 2>/dev/null; then
        ok=1
        break
      fi
      # Algunos contestan success con otra forma; si hubo HTTP 200 lo intentamos igual.
      ok=1
      break
    fi
  done

  if [[ "${ok}" -ne 1 ]]; then
    cat >&2 <<EOF
No pude renumerar el ZTE por API.

Hacelo a mano (sigue con esta sesión SSH abierta):
  1) En la Pi: curl -s http://${gw}/ | head
  2) Desde un browser con proxy SOCKS por SSH, o con lynx:
       http://${gw}/index.html#router_setting
  3) Cambiá la IP LAN del modem a ${new_ip} (máscara 255.255.255.0), guardá.
  4) Esperá a que eth1 tome DHCP de nuevo (nmcli connection up ${MODEM_CON}).
  5) Comprobá: ping -c 2 1.1.1.1 && tailscale status
  6) Volvé a correr este script con RENUMBER_ZTE=0

EOF
    return 1
  fi

  info "Pedido enviado al ZTE. Renovando DHCP en ${MODEM_IFACE}..."
  sleep 3
  nmcli connection down "${MODEM_CON}" 2>/dev/null || true
  sleep 2
  nmcli connection up "${MODEM_CON}" || true

  wait_for "DHCP nuevo en ${MODEM_IFACE}" 45 bash -c \
    "ip -4 -o addr show dev ${MODEM_IFACE} | grep -q ."

  local new_cidr
  new_cidr="$(cidr_of_iface "${MODEM_IFACE}")"
  info "Modem ahora: ${MODEM_IFACE} ${new_cidr:-sin-ip}"

  info "Esperando internet y Tailscale tras el cambio..."
  wait_for "internet" 60 internet_ok
  wait_for "tailscale" 90 tailscale_ok
  info "4G + Tailscale OK después de renumerar."
}

connect_wifi() {
  info "Conectando ${WIFI_IFACE} a SSID '${WIFI_SSID}' (never-default, metric ${WIFI_METRIC})."

  nmcli radio wifi on || true
  ip link set "${WIFI_IFACE}" up || true

  if nmcli -t connection show | grep -q "^${WIFI_CON}:"; then
    nmcli connection delete "${WIFI_CON}" || true
  fi

  # Rescan (a veces la Pi no ve la red a la primera).
  nmcli device wifi rescan ifname "${WIFI_IFACE}" 2>/dev/null || true
  sleep 3

  nmcli connection add type wifi ifname "${WIFI_IFACE}" con-name "${WIFI_CON}" \
    ssid "${WIFI_SSID}" \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "${WIFI_PASSWORD}" \
    ipv4.method auto \
    ipv4.never-default yes \
    ipv4.route-metric "${WIFI_METRIC}" \
    ipv6.method ignore \
    connection.autoconnect yes

  nmcli connection up "${WIFI_CON}" ifname "${WIFI_IFACE}"
}

main() {
  need_cmd nmcli
  need_cmd curl
  need_cmd ip
  need_cmd systemd-run

  [[ -n "${WIFI_SSID}" ]] || die "Definí WIFI_SSID"
  [[ -n "${WIFI_PASSWORD}" ]] || die "Definí WIFI_PASSWORD"

  info "Estado actual:"
  ip -br addr
  echo
  ip route | head -n 20
  echo

  internet_ok || die "Sin internet por 4G ahora. No sigo (evitarías recuperar Tailscale)."
  tailscale_ok || die "Tailscale no responde. Arreglá el túnel antes de tocar la red."

  schedule_rollback
  stop_ap_if_any

  local modem_cidr="" modem_prefix="" modem_gw=""
  if ip -br link show "${MODEM_IFACE}" >/dev/null 2>&1; then
    modem_cidr="$(cidr_of_iface "${MODEM_IFACE}" || true)"
    if [[ -n "${modem_cidr}" ]]; then
      modem_prefix="$(prefix24 "${modem_cidr}")"
      modem_gw="$(gateway_of_iface "${MODEM_IFACE}" || true)"
      [[ -n "${modem_gw}" ]] || modem_gw="$(echo "${modem_cidr}" | awk -F'[./]' '{print $1"."$2"."$3".1"}')"
      info "Modem ${MODEM_IFACE}: ${modem_cidr} (prefijo ${modem_prefix}, gw ${modem_gw})"
    fi
  fi

  # Si el modem está en 192.168.0.0/24, chocará con el router de la casa.
  if [[ "${modem_prefix}" == "192.168.0.0/24" ]]; then
    info "Choque probable con la LAN de la casa (también 192.168.0.0/24)."
    if [[ "${RENUMBER_ZTE}" != "1" ]]; then
      cat >&2 <<EOF
Aborto: hay que renumerar el ZTE antes de unir el Wi‑Fi, o te quedás sin 4G/VPN.

Re-ejecutá con:
  export RENUMBER_ZTE=1
  export ZTE_PASSWORD='admin'   # o la clave del panel del modem
  sudo --preserve-env=WIFI_SSID,WIFI_PASSWORD,RENUMBER_ZTE,ZTE_PASSWORD,ZTE_NEW_LAN_IP \\
    bash scripts/pi/setup-house-wifi.sh

EOF
      exit 2
    fi
    probe_zte "${modem_gw}" || die "No alcanzo el panel del ZTE en http://${modem_gw}/"
    renumber_zte "${modem_gw}" "${ZTE_NEW_LAN_IP}" || exit 3

    modem_cidr="$(cidr_of_iface "${MODEM_IFACE}" || true)"
    modem_prefix="$(prefix24 "${modem_cidr}")"
    if [[ "${modem_prefix}" == "192.168.0.0/24" ]]; then
      die "El modem sigue en 192.168.0.0/24. Renumerá a mano y reintentá con RENUMBER_ZTE=0."
    fi
  fi

  connect_wifi

  wait_for "IP en ${WIFI_IFACE}" 30 bash -c \
    "ip -4 -o addr show dev ${WIFI_IFACE} | grep -q ."

  info "Wi‑Fi:"
  ip -4 -o addr show dev "${WIFI_IFACE}"
  echo
  info "Comprobando que internet sigue por 4G..."
  internet_ok || die "Se cortó internet tras el Wi‑Fi. Esperá el rollback (${ROLLBACK_MINUTES} min) o: nmcli connection down ${WIFI_CON}"
  tailscale_ok || die "Tailscale cayó. Esperá el rollback o: nmcli connection down ${WIFI_CON}"

  if ping -c 2 -W 2 "${HOUSE_PING_HOST}" >/dev/null 2>&1; then
    info "Ping OK a ${HOUSE_PING_HOST} (tecla / LAN casa)."
  else
    info "Wi‑Fi OK, pero ${HOUSE_PING_HOST} no responde (apagada, otra IP, o VLAN)."
    info "Seguí con: ip neigh; nmcli -f SSID,SIGNAL,BARS,SECURITY device wifi list"
  fi

  cancel_rollback_mark_ok

  cat <<EOF

Listo.
  Wi‑Fi casa:  ${WIFI_CON} en ${WIFI_IFACE} (sin default route)
  Internet:    sigue por ${MODEM_IFACE} / 4G
  Tailscale:   $(tailscale ip -4 2>/dev/null || echo '?')

Desde afuera: ssh alonso-pi   (o el hostname que tengas)
En la Pi:     ping -c 2 ${HOUSE_PING_HOST}
              curl -fsS http://127.0.0.1:3001/status

EOF
}

main "$@"
