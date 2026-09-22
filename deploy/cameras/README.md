# Cámaras GeoTek GT-N3 → Frigate → S3

Prototipo aparte de la Pi de luces. Frigate tira del stream (RTSP / DVRIP) y un sidecar sube **solo clips de evento** a S3. Sin credenciales AWS escribe en `data/s3-dry/`.

No corre esto en la Raspberry Pi 3 ni por el 4G de la casa: video 24/7 la satura.

## Arranque (Mac)

```bash
cd deploy/cameras
./up.sh
```

UI: [http://127.0.0.1:8971](http://127.0.0.1:8971) — arranca con una cámara `laboratorio` (patrón de prueba).

## Enchufar una GT-N3

1. App iCSee, Wi‑Fi **2.4 GHz**, anotá la IP (router o Ajustes → Información).
2. Probá esa IP, sin barrer la red:

```bash
python3 scripts/probe.py 192.168.x.x --user admin --password 'la-de-icsee'
```

También podés dejar que el script pregunte por multicast ONVIF (`python3 scripts/probe.py`).

3. En `.env`:

```bash
FRIGATE_CAM1_HOST=192.168.x.x
FRIGATE_CAM1_NAME=entrada
FRIGATE_RTSP_PASSWORD=la-de-icsee
```

4. `./up.sh` de nuevo.

URLs que prueba go2rtc, en este orden: `/onvif1`, el path iCSee `user=_password=_channel=0_stream=0.sdp`, y `dvrip://…:34567`.

## S3 propio

El CLI de esta máquina todavía no tiene credenciales. El uploader queda en modo ensayo.

Cuando quieras el bucket real (`alonso-home-nvr` en `us-east-2`):

```bash
aws configure    # misma cuenta 589324424853
bash scripts/ensure-bucket.sh
docker compose restart uploader
```

Clave típica: `events/<camara>/<fecha>/<id>_<label>.mp4`. El bucket nace privado, con lifecycle de 90 días.

## VLAN (casa, más adelante)

Las iCSee llaman a la nube del fabricante. En el router de Alonso: VLAN solo-cámaras, DHCP propio, **sin WAN** (o solo NTP). Frigate vive en un mini PC de esa LAN; Tailscale/WireGuard para ver de afuera. La Pi de luces no entra a esa VLAN.

## Parar

```bash
docker compose down
```
