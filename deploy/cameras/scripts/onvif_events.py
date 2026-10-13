#!/usr/bin/env python3
"""Escucha eventos ONVIF (PullPoint) de una cámara GeoTek/Xiongmai. Solo lectura, sin dependencias.

Uso:
  python3 onvif_events.py 192.168.100.206 [--port 8899] [--seconds 120] [--user U --password P]

Imprime solo CAMBIOS de estado (Initialized / Changed). Cuando alguien se mueve frente a la
cámara deberían aparecer MotionAlarm / CellMotionDetector con State=true y luego false.

Notas del equipo (cámara GT-N3, firmware V5.01.C01):
- El servicio ONVIF vive en :8899 (no en :80).
- PullMessages ignora el Timeout y responde al instante: hay que dormir ~1 s entre pulls.
- La suscripción se crea con TTL corto; se renueva a mitad de camino.
"""
import argparse
import re
import time
import urllib.request

NS = (
    'xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
    'xmlns:tev="http://www.onvif.org/ver10/events/wsdl" '
    'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"'
)


def soap(url: str, body: str, action: str = "", timeout: float = 15.0) -> str:
    env = f'<?xml version="1.0" encoding="utf-8"?><s:Envelope {NS}><s:Body>{body}</s:Body></s:Envelope>'
    ctype = "application/soap+xml; charset=utf-8" + (f'; action="{action}"' if action else "")
    req = urllib.request.Request(url, env.encode(), {"Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse_notifications(xml: str):
    for m in re.finditer(r"<wsnt:NotificationMessage>(.*?)</wsnt:NotificationMessage>", xml, re.S):
        chunk = m.group(1)
        topic = re.search(r"<wsnt:Topic[^>]*>([^<]+)", chunk)
        msg = re.search(r'<tt:Message UtcTime="([^"]+)" PropertyOperation="([^"]+)"', chunk)
        items = dict(re.findall(r'<tt:SimpleItem Name="([^"]+)" Value="([^"]*)"', chunk))
        yield (
            topic.group(1) if topic else "?",
            msg.group(1) if msg else "",
            msg.group(2) if msg else "",
            items,
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("host")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--seconds", type=int, default=120)
    args = ap.parse_args()

    base = f"http://{args.host}:{args.port}"
    ttl = 60
    resp = soap(
        f"{base}/onvif/event_service",
        f"<tev:CreatePullPointSubscription><tev:InitialTerminationTime>PT{ttl}S</tev:InitialTerminationTime>"
        "</tev:CreatePullPointSubscription>",
    )
    addr = re.search(r"<wsa:Address>([^<]+)", resp)
    if not addr:
        raise SystemExit("No se pudo crear la suscripción:\n" + resp[-600:])
    sub_url = addr.group(1)
    print(f"Suscripción: {sub_url}  (escuchando {args.seconds}s; movete frente a la cámara)")

    last: dict[tuple[str, str], str] = {}
    t0 = time.time()
    renew_at = t0 + ttl / 2
    while time.time() - t0 < args.seconds:
        if time.time() >= renew_at:
            soap(sub_url, f"<wsnt:Renew><wsnt:TerminationTime>PT{ttl}S</wsnt:TerminationTime></wsnt:Renew>")
            renew_at = time.time() + ttl / 2
        xml = soap(
            sub_url,
            "<tev:PullMessages><tev:Timeout>PT1S</tev:Timeout><tev:MessageLimit>20</tev:MessageLimit></tev:PullMessages>",
        )
        for topic, utc, op, items in parse_notifications(xml):
            state = next((v for k, v in items.items() if k in ("State", "IsMotion", "IsTamper", "LogicalState")), "")
            key = (topic, items.get("Rule", items.get("Source", "")))
            if last.get(key) == state and op != "Changed":
                continue
            last[key] = state
            print(f"{time.strftime('%H:%M:%S')}  {op:<11} {topic:<48} {state:<6} {items}")
        time.sleep(1)

    try:
        soap(sub_url, "<wsnt:Unsubscribe/>")
    except Exception:
        pass


if __name__ == "__main__":
    main()
