# Secretos con Infisical

Fuente de verdad para variables sensibles (`.env`, tokens MQTT, `DEVICE_TOKEN`, etc.). Los `.env` locales siguen ignorados por git; se generan con el CLI.

## Estructura del proyecto

Un solo proyecto Infisical: **`alonso-home`**.

| Entorno | Uso |
| --- | --- |
| `dev` | Notebook + HA local (`deploy/homeassistant`) |
| `prod` | Raspberry Pi + panel en Vercel |

| Carpeta | Destino local | Contenido |
| --- | --- | --- |
| `/shared` | (se mergea en todos) | `DEVICE_TOKEN`, `MQTT_DEVICE_PASSWORD`, `MQTT_HA_PASSWORD` |
| `/web` | `apps/web/.env.local` | `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (+ refs a shared) |
| `/pi-agent` | `apps/pi-agent/.env` | `CLOUD_URL`, GPIO/MQTT/HA/cámaras (+ refs a shared) |
| `/homeassistant` | `deploy/homeassistant/.env` | puertos, usuarios MQTT (+ refs a shared) |
| `/cameras` | `deploy/cameras/.env` | RTSP + AWS (opcional) |

**No subir a Infisical:** certificados AWS IoT (`apps/pi-agent/certs/`). Quedan en disco en la Pi.

**Opcional:** `deploy/homeassistant/secrets/devices.json` (Tuya). Al principio puede seguir siendo un archivo local; más adelante un secret `DEVICES_JSON` + script que lo escriba.

## Setup (una vez)

1. Cuenta en [Infisical Cloud](https://app.infisical.com) (plan free alcanza).
2. Crear proyecto `alonso-home` con entornos `dev` y `prod`.
3. Crear carpetas: `shared`, `web`, `pi-agent`, `homeassistant`, `cameras`.
4. CLI (ya suele estar en Homebrew):

```bash
brew install infisical/get-cli/infisical
cd /ruta/al/alonso-home
infisical login
infisical init   # genera .infisical.json (sí se puede commitear)
```

5. Cargar secretos en la UI (copiá desde tus `.env` actuales) o con CLI:

```bash
infisical secrets set DEVICE_TOKEN=tu-token --env=dev --path=/shared
infisical secrets set MQTT_DEVICE_PASSWORD=... --env=dev --path=/shared
# etc.
```

En `/web` y `/pi-agent` podés duplicar `DEVICE_TOKEN` o usar **secret references** hacia `/shared` (el export hace `--expand`).

## Regenerar secretos de desarrollo

```bash
./scripts/secrets/seed-dev.sh
```

Genera tokens/claves nuevas, las sube a Infisical (`dev`) y exporta los `.env` locales. No imprime valores. No toca `devices.json` ni certificados IoT. Si la Pi o Vercel tenían el `DEVICE_TOKEN` viejo, hay que actualizarlos.

## Exportar a `.env` locales

```bash
./scripts/secrets/export-env.sh              # todos, env=dev
./scripts/secrets/export-env.sh prod         # todos, prod
./scripts/secrets/export-env.sh dev web      # solo panel
./scripts/secrets/export-env.sh prod pi-agent
```

El script mergea `/shared` + la carpeta del target (la carpeta gana si hay clave repetida) y deja el archivo en modo `600`. Si Infisical no devuelve secretos, **no escribe** el archivo (evita pisar `.env` con vacío).

## Correr sin escribir `.env`

```bash
cd apps/pi-agent
infisical run --env=dev --path=/shared --path=/pi-agent -- pnpm dev

cd apps/web
infisical run --env=dev --path=/shared --path=/web -- pnpm dev
```

## Home Assistant

```bash
./scripts/secrets/export-env.sh dev homeassistant
cd deploy/homeassistant && ./up.sh
```

`up.sh` solo genera contraseñas MQTT si están vacías; si Infisical ya las puso en `.env`, no las pisa.

## Inventario mínimo (dev)

### `/shared`

- `DEVICE_TOKEN`
- `MQTT_DEVICE_PASSWORD` (usuario broker `alonso`)
- `MQTT_HA_PASSWORD` (usuario broker `ha`)

### `/web`

- `DATABASE_URL` (puede quedar vacío → memoria)
- `ADMIN_PASSWORD`
- `SESSION_SECRET` (≥32 chars)
- `DEVICE_TOKEN` (mismo que shared)

### `/pi-agent`

- `CLOUD_URL=http://localhost:4074`
- `DEVICE_TOKEN`
- `GPIO_MOCK=1`
- `MQTT_*` / `HA_*` según pruebes
- `CAMERAS` (JSON) solo si hay cámaras

### `/homeassistant`

- `TZ`, `HA_PORT`, `MQTT_PORT`, `MQTT_MODE` (`local` en Mac, `host` en la Pi)
- `MQTT_HA_USER=ha`, `MQTT_HA_PASSWORD`
- `MQTT_DEVICE_USER=alonso`, `MQTT_DEVICE_PASSWORD`

## Checklist primera migración

1. [ ] Proyecto + carpetas en Infisical
2. [ ] `infisical login` + `infisical init` → `.infisical.json` en el repo
3. [ ] Secretos de `dev` cargados (desde `.env` actuales)
4. [ ] `./scripts/secrets/export-env.sh dev` y arrancar `pnpm dev:web` / `pnpm dev:pi`
5. [ ] Repetir valores `prod` cuando toque la Pi / Vercel
