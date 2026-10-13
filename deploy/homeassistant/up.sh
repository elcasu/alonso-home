#!/usr/bin/env bash
# Levanta Home Assistant + Mosquitto de alonso-home y deja todo listo para el primer uso.
# Idempotente: se puede correr de nuevo sin romper nada.
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
set_if_empty MQTT_HA_PASSWORD "$(gen)"
set_if_empty MQTT_DEVICE_PASSWORD "$(gen)"
chmod 600 .env
# shellcheck disable=SC1091
set -a; source .env; set +a

# 2. Archivo de usuarios de Mosquitto (se regenera con las contraseñas del .env)
docker run --rm \
  -v "$(pwd)/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto:2 sh -c "
    mosquitto_passwd -b -c /mosquitto/config/passwords '${MQTT_HA_USER}' '${MQTT_HA_PASSWORD}' &&
    mosquitto_passwd -b /mosquitto/config/passwords '${MQTT_DEVICE_USER}' '${MQTT_DEVICE_PASSWORD}' &&
    chown 1883:1883 /mosquitto/config/passwords && chmod 0700 /mosquitto/config/passwords
  " >/dev/null

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
docker compose up -d

echo
echo "Home Assistant:  http://127.0.0.1:${HA_PORT:-8124}   (alta de usuario la primera vez)"
echo "Mosquitto:       mqtt://127.0.0.1:${MQTT_PORT:-1883}"
echo "  usuario HA:       ${MQTT_HA_USER}   (clave en .env)"
echo "  usuario ESP/agent: ${MQTT_DEVICE_USER}   (clave en .env)"
echo
echo "En HA: Ajustes > Dispositivos y servicios > Agregar integración > MQTT"
echo "       host: mosquitto   puerto: 1883   usuario/clave: los de HA del .env"
echo "Logs: docker compose -f $(pwd)/docker-compose.yml logs -f"
