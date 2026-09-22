# Alonso Home — simulación de ocupación

Casa prefabricada vacía: las luces se encienden y apagan solas para que desde afuera se vea movimiento. **La Raspberry Pi 3 es el cerebro** y corre la agenda aunque no haya internet. El panel en Vercel solo muestra estado y encola comandos. El modem USB 4G es un canal de salida (CGNAT): la Pi llama a la nube, la nube no abre puertos hacia la casa.

## Qué hay en este repo

| Ruta | Rol |
| --- | --- |
| [`packages/shared`](packages/shared) | Tipos, zonas y reglas por defecto, jitter |
| [`apps/pi-agent`](apps/pi-agent) | Servicio Node: GPIO, MQTT, SQLite, agenda, sync |
| [`apps/web`](apps/web) | Next.js: luces, agenda, salud (Vercel) |
| [`apps/esp32`](apps/esp32) | Firmware MQTT para relés lejanos |
| [`scripts/pi`](scripts/pi) | Bootstrap OS, GPIO de prueba, 4G, AP WiFi, MQTT, install |
| [`deploy`](deploy) | systemd (watchdog), hostapd, dnsmasq, Mosquitto, SQL |
| [`deploy/cameras`](deploy/cameras) | Frigate + clips a S3 (aparte de la Pi de luces) |

Agenda de ejemplo (hora Argentina, con jitter):

- 18:00 living ON
- 20:30 bathroom pulse 10 min
- 21:00 hallway ON · 21:15 bedroom ON
- 23:10 bathroom pulse 10 min
- 23:30 living OFF · 23:45 hallway OFF · 00:20 bedroom OFF

## Desarrollo en la notebook

Node 20 + pnpm 9.

```bash
pnpm install
cp apps/pi-agent/.env.example apps/pi-agent/.env
cp apps/web/.env.example apps/web/.env.local
pnpm test
pnpm dev:pi      # agente con GPIO mock, API http://127.0.0.1:3001/status
pnpm dev:web     # panel http://localhost:4074  contraseña: cambiame
```

Sin `DATABASE_URL` el panel usa memoria (se pierde al reiniciar). Para Postgres local: `docker compose up -d` y en `.env.local` `DATABASE_URL=postgres://alonso:alonso@localhost:5432/alonso`.

## Fase 0 — banco de pruebas (sin 220 V)

En la Pi, Raspberry Pi OS Lite 64-bit, Node 20.

1. Cableá un **LED** o un relé de 5/12 V. GPIO BCM 17 → IN del relé (módulos optocoplados 3.3 V; si el módulo es 5 V usá ULN2803). GND común. Bobina a 5 V. **Nada de 220 V todavía.**
2. `sudo bash scripts/pi/bootstrap.sh`
3. `python3 scripts/pi/gpio-test.py --pin 17` (o `pnpm --filter @alonso/pi-agent gpio-test 17` con `GPIO_MOCK=0`)
4. Modem USB: `sudo bash scripts/pi/setup-4g.sh internet` (APN según operador). `ping 1.1.1.1`

Relés típicos son **active-low**: el agente asume `activeLow: true`.

## Fase 1 — agente local

```bash
sudo bash scripts/pi/install-agent.sh
journalctl -u alonso-pi-agent -f
curl http://127.0.0.1:3001/status
```

SQLite en `apps/pi-agent/data/alonso.db`. Si no hay 4G, la agenda corre igual. systemd `Type=notify` + `WatchdogSec=30` reinicia el proceso si deja de avisar. Al arrancar no recorre todas las reglas del día: deja cada zona en el estado que le correspondería a esa hora (y programa el apagado si un pulse sigue activo).

Comando local:

```bash
curl -X POST http://127.0.0.1:3001/zones/living -d '{"on":true}' -H 'content-type: application/json'
```

## Fase 2 — panel en Vercel

1. Neon o Vercel Postgres → `DATABASE_URL`
2. Proyecto Vercel, **Root Directory `apps/web`**, framework Next.js
3. Env: `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `DEVICE_TOKEN` (el mismo token que en la Pi)
4. En la Pi: `CLOUD_URL=https://tu-app.vercel.app` y el mismo `DEVICE_TOKEN`

La Pi hace POST `/api/device/sync` cada ~8 s. Un On/Off del celular se aplica en ese intervalo. Heartbeat viejo (> 60 s) = banner **Pi offline**.

## Fase 3 — ESP32 y AP de la Pi

```bash
sudo bash scripts/pi/setup-ap.sh          # SSID alonso-home / 192.168.4.1
sudo bash scripts/pi/setup-mosquitto.sh
```

En [`apps/esp32`](apps/esp32): PlatformIO, `include/config.h`, flash. Si el editor marca `Arduino.h` como faltante, no es un error del firmware: clangd no ve el framework hasta generar IntelliSense:

```bash
~/.platformio/penv/bin/pio pkg install --project-dir apps/esp32
~/.platformio/penv/bin/pio project init --ide vscode --project-dir apps/esp32
python3 apps/esp32/generate_compile_commands.py
```

Después recargá la ventana de Cursor. Compilar: `pio run --project-dir apps/esp32`. Topics:

- `home/{deviceId}/set` → `{"channel":1,"on":true}`
- `home/{deviceId}/state` → eco

Zona `bathroom` viene de fábrica como `esp32` / `esp-bathroom` / canal 1. En la Pi `.env`: `MQTT_ENABLED=1`.

## Fase 4 — 220 V en la casa

Solo con térmica abajo y lámpara identificada. Cada relé corta **solo la fase** de esa lámpara; el neutro no pasa por el relé. Caja cerrada, cable de 1.5 mm², nada de 220 V en protoboard.

```
Fase (térmica) ── COM del relé
NO del relé ── lámpara ── Neutro
GPIO Pi/ESP32 ── IN del relé (óptica)
GND común de control ≠ tierra de potencia mal atada: unificá GND de 5 V y Pi.
```

Arranque: todas las luces OFF. Watchdog de systemd ya está en la unidad. En `/salud` del panel, si la Pi no reporta aparece la alerta. Ajustá jitter y horarios reales en **Agenda**.

## Seguridad

- La Pi no publica puertos a internet.
- Mosquitto solo en `127.0.0.1` y `192.168.4.1`.
- Comandos idempotentes (`on` / `off` / `pulse`), TTL 2 min.
- Un usuario: cookie httpOnly + `ADMIN_PASSWORD`.

## Criterio de listo

1. Sin internet, el living se enciende a la hora configurada.
2. El bathroom hace pulse de 10 min (con jitter).
3. Desde el celular, un Off se aplica en menos de ~10 s si hay 4G.
4. Un ESP32 en otra habitación sigue la misma agenda.
