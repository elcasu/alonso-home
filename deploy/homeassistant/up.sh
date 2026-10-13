#!/usr/bin/env bash
# Levanta Home Assistant (+ Mosquitto local opcional) y deja todo listo para el primer uso.
# Idempotente: se puede correr de nuevo sin romper nada.
#
# MQTT_MODE=local  → Mosquitto en Docker (Mac/dev). Default si no hay mosquitto.service.
# MQTT_MODE=host   → Solo HA; usa el Mosquitto del sistema (Pi). Default si mosquitto está activo.
set -euo pipefail
cd "$(dirname "$0")"

TUYA_LOCAL_VERSION="${TUYA_LOCAL_VERSION:-2026.9.2-rel}"

gen() { openssl rand -hex 12; }

# 1. .env con contraseñas generadas
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
set_if_empty() {
  local key="$1" value="$2" current
  current="$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)"
  if [[ -z "$current" ]]; then
    local tmp
    tmp="$(mktemp)"
    sed "s|^${key}=.*|${key}=${value}|" .env >"$tmp"
    mv "$tmp" .env
  fi
}
ensure_key() {
  local key="$1" value="$2"
  if ! grep -qE "^${key}=" .env; then
    printf '%s=%s\n' "$key" "$value" >> .env
  else
    set_if_empty "$key" "$value"
  fi
}
set_if_empty MQTT_HA_PASSWORD "$(gen)"
set_if_empty MQTT_DEVICE_PASSWORD "$(gen)"
ensure_key MQTT_MODE ""
chmod 600 .env
# shellcheck disable=SC1091
set -a; source .env; set +a

detect_mqtt_mode() {
  if [[ -n "${MQTT_MODE:-}" ]]; then
    echo "$MQTT_MODE"
    return
  fi
  # En la Pi el broker canónico es el del sistema (setup-mosquitto.sh).
  if [[ -d /etc/mosquitto ]] \
    || (command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet mosquitto 2>/dev/null); then
    echo host
  else
    echo local
  fi
}

MQTT_MODE="$(detect_mqtt_mode)"
# Persistir el modo detectado si estaba vacío
if ! grep -qE '^MQTT_MODE=.+' .env; then
  tmp="$(mktemp)"
  if grep -qE '^MQTT_MODE=' .env; then
    sed "s|^MQTT_MODE=.*|MQTT_MODE=${MQTT_MODE}|" .env >"$tmp"
  else
    cat .env >"$tmp"
    printf 'MQTT_MODE=%s\n' "$MQTT_MODE" >>"$tmp"
  fi
  mv "$tmp" .env
fi

sync_host_mosquitto_users() {
  local passwd_file=/etc/mosquitto/passwords/alonso
  local run=()
  if [[ -w "$passwd_file" ]] || [[ "${EUID}" -eq 0 ]]; then
    run=()
  elif command -v sudo >/dev/null 2>&1; then
    run=(sudo)
  else
    echo "Aviso: no pude escribir ${passwd_file}. En HA usá el usuario del Mosquitto del host."
    return 0
  fi

  if [[ ! -f "$passwd_file" ]]; then
    echo "Aviso: no hay ${passwd_file}. Corré: sudo bash scripts/pi/setup-mosquitto.sh"
    return 0
  fi

  "${run[@]}" mosquitto_passwd -b "$passwd_file" "${MQTT_HA_USER}" "${MQTT_HA_PASSWORD}"
  "${run[@]}" mosquitto_passwd -b "$passwd_file" "${MQTT_DEVICE_USER}" "${MQTT_DEVICE_PASSWORD}"
  if command -v systemctl >/dev/null 2>&1; then
    "${run[@]}" systemctl reload mosquitto 2>/dev/null \
      || "${run[@]}" systemctl restart mosquitto
  fi
  echo "Usuarios MQTT sincronizados en el Mosquitto del host (${MQTT_HA_USER}, ${MQTT_DEVICE_USER})."
}

# 2. Usuarios del broker
if [[ "$MQTT_MODE" == "host" ]]; then
  sync_host_mosquitto_users
else
  docker run --rm \
    -v "$(pwd)/mosquitto/config:/mosquitto/config" \
    eclipse-mosquitto:2 sh -c "
      mosquitto_passwd -b -c /mosquitto/config/passwords '${MQTT_HA_USER}' '${MQTT_HA_PASSWORD}' &&
      mosquitto_passwd -b /mosquitto/config/passwords '${MQTT_DEVICE_USER}' '${MQTT_DEVICE_PASSWORD}' &&
      chown 1883:1883 /mosquitto/config/passwords && chmod 0700 /mosquitto/config/passwords
    " >/dev/null
fi

# 3. tuya-local (integración local de Tuya) sin HACS
target="ha-config/custom_components/tuya_local"
if [[ ! -f "$target/manifest.json" ]] || ! grep -q "\"${TUYA_LOCAL_VERSION%-rel}\"" "$target/manifest.json"; then
  echo "Instalando tuya-local ${TUYA_LOCAL_VERSION}..."
  tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/make-all/tuya-local/archive/refs/tags/${TUYA_LOCAL_VERSION}.tar.gz" -o "$tmp/tl.tar.gz"
  tar -xzf "$tmp/tl.tar.gz" -C "$tmp"
  mkdir -p ha-config/custom_components
  rm -rf "$target"
  cp -R "$tmp"/tuya-local-*/custom_components/tuya_local "$target"
  rm -rf "$tmp"
fi

# 4. Stack
compose=(docker compose)
if [[ "$MQTT_MODE" == "local" ]]; then
  compose+=(--profile local-mqtt)
fi
"${compose[@]}" up -d --remove-orphans

echo
echo "Home Assistant:  http://127.0.0.1:${HA_PORT:-8124}   (alta de usuario la primera vez)"
echo "MQTT_MODE:       ${MQTT_MODE}"
if [[ "$MQTT_MODE" == "host" ]]; then
  echo "Mosquitto:       broker del host (sistema) en :1883"
  echo "  usuario HA:       ${MQTT_HA_USER}   (clave en .env)"
  echo "  usuario ESP/agent: ${MQTT_DEVICE_USER}   (clave en .env)"
  echo
  echo "En HA: Ajustes > Dispositivos y servicios > Agregar integración > MQTT"
  echo "       host: host.docker.internal   puerto: 1883"
  echo "       usuario/clave: los de HA del .env"
  echo "Si falla la conexión, re-corré: sudo bash scripts/pi/setup-mosquitto.sh"
else
  echo "Mosquitto:       mqtt://127.0.0.1:${MQTT_PORT:-1883}  (contenedor)"
  echo "  usuario HA:       ${MQTT_HA_USER}   (clave en .env)"
  echo "  usuario ESP/agent: ${MQTT_DEVICE_USER}   (clave en .env)"
  echo
  echo "En HA: Ajustes > Dispositivos y servicios > Agregar integración > MQTT"
  echo "       host: mosquitto   puerto: 1883   usuario/clave: los de HA del .env"
fi
echo "Logs: docker compose -f $(pwd)/docker-compose.yml logs -f"
