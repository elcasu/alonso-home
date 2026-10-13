# Home Assistant de alonso-home

Stack: Home Assistant (`:8124`) + MQTT. Es independiente del PoC de voz (`alonso-ha-poc`, `:8123`).

## Arranque

```bash
cd deploy/homeassistant
./up.sh
```

`up.sh` genera las claves de MQTT en `.env`, prepara el broker, instala `tuya-local` y levanta los contenedores. Se puede volver a correr sin problema.

### Modo MQTT

| `MQTT_MODE` | Dónde | Broker |
| --- | --- | --- |
| `local` (default en Mac) | Dev | Contenedor Mosquitto del compose (`:1883`) |
| `host` (default en la Pi si `mosquitto.service` está activo) | Casita | Mosquitto del sistema — un solo broker para ESP, `pi-agent` y HA |

En la Pi no hace falta forzar nada si ya corriste `scripts/pi/setup-mosquitto.sh`: `up.sh` detecta el servicio y usa `host`.

Primera vez en HA (`http://127.0.0.1:8124`):

1. Crear el usuario.
2. *Ajustes > Dispositivos y servicios > Agregar integración > MQTT*:
   - **Mac (`local`)**: host `mosquitto`, puerto `1883`, usuario `ha`, clave `MQTT_HA_PASSWORD` del `.env`.
   - **Pi (`host`)**: host `host.docker.internal`, puerto `1883`, usuario `ha`, clave `MQTT_HA_PASSWORD` del `.env`.

Si en la Pi HA no conecta al broker, re-aplicá listeners (incl. docker0):

```bash
sudo bash scripts/pi/setup-mosquitto.sh
```

## Probar el `pi-agent` contra este HA

En `apps/pi-agent/.env`:

```bash
GPIO_MOCK=1
HA_ENABLED=1
HA_MQTT_URL=mqtt://127.0.0.1:1883
HA_MQTT_USER=alonso
HA_MQTT_PASSWORD=<MQTT_DEVICE_PASSWORD del .env de esta carpeta>
```

```bash
pnpm --filter @alonso/pi-agent dev
```

En HA aparece el dispositivo **Alonso Pi** con un interruptor por zona GPIO (`switch.alonso_pi_living`, etc.). Las zonas `esp32` no se anuncian: las anuncia el propio ESP (ver `HA_EXPOSE_ESP32`).

## Convención de topics

| Topic | Payload | Notas |
| --- | --- | --- |
| `alonso/<nodo>/status` | `online` / `offline` | retained, `offline` es el LWT |
| `alonso/<nodo>/zone/<zona>/state` | `ON` / `OFF` | retained |
| `alonso/<nodo>/zone/<zona>/set` | `ON` / `OFF` | comando desde HA |
| `homeassistant/switch/<nodo>/<zona>/config` | JSON de discovery | retained |
| `homeassistant/status` | `online` | HA avisa que arrancó; el agente re-publica todo |

El firmware de los ESP32 va a usar esta misma convención.

## Tecla Akai (Tuya Local)

Las claves y los datos del dispositivo están en `secrets/devices.json` (ignorado por git). En *Agregar integración > Tuya Local*: configuración manual con `id`, IP, versión de protocolo `3.4` y la `key` de ese archivo. Solo funciona desde la red de la casa (usa la LAN).

## Parar

```bash
docker compose down
```

En la Pi, eso no apaga el Mosquitto del sistema (`systemctl` lo sigue gestionando).
