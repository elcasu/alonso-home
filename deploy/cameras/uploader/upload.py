#!/usr/bin/env python3
"""Sube clips y snapshots de Frigate a S3. Sin credenciales AWS escribe en /dry."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

import requests

FRIGATE_URL = os.environ.get("FRIGATE_URL", "http://frigate:5000").rstrip("/")
BUCKET = os.environ.get("S3_BUCKET", "alonso-home-nvr")
PREFIX = os.environ.get("S3_PREFIX", "events").strip("/")
REGION = os.environ.get("AWS_REGION", "us-east-2")
POLL_SECONDS = int(os.environ.get("UPLOAD_POLL_SECONDS", "20"))
STATE_PATH = Path(os.environ.get("UPLOAD_STATE", "/data/uploaded.json"))
DRY_ROOT = Path(os.environ.get("DRY_ROOT", "/dry"))
TZ_NAME = os.environ.get("TZ", "America/Argentina/Buenos_Aires")

session = requests.Session()
session.headers["User-Agent"] = "alonso-cameras-uploader/0.1"


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"ids": []}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"ids": []}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(STATE_PATH)


def s3_client():
    try:
        import boto3
    except ImportError:
        return None
    session = boto3.Session(region_name=REGION)
    creds = session.get_credentials()
    if creds is None:
        return None
    frozen = creds.get_frozen_credentials()
    if not frozen.access_key:
        return None
    return session.client("s3")


def object_key(event: dict[str, Any], filename: str) -> str:
    start = float(event.get("start_time") or time.time())
    when = datetime.fromtimestamp(start, tz=timezone.utc).astimezone(ZoneInfo(TZ_NAME))
    camera = event.get("camera") or "unknown"
    label = event.get("label") or "event"
    event_id = event.get("id") or "unknown"
    return f"{PREFIX}/{camera}/{when:%Y-%m-%d}/{event_id}_{label}{filename}"


def put_bytes(client, key: str, body: bytes, content_type: str) -> str:
    if client is None:
        dest = DRY_ROOT / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        return f"dry://{dest}"
    try:
        client.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType=content_type)
        return f"s3://{BUCKET}/{key}"
    except Exception as exc:
        dest = DRY_ROOT / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        print(f"  S3 falló ({exc.__class__.__name__}); guardé {dest}")
        return f"dry://{dest}"


def fetch_events() -> list[dict[str, Any]]:
    response = session.get(
        f"{FRIGATE_URL}/api/events",
        params={"has_clip": 1, "limit": 30},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        return payload.get("data") or payload.get("events") or []
    return payload


def fetch_media(event_id: str, kind: str) -> bytes | None:
    suffix = "clip.mp4" if kind == "clip" else "snapshot.jpg"
    url = f"{FRIGATE_URL}/api/events/{quote(event_id)}/{suffix}"
    last_error = None
    for attempt in range(5):
        try:
            response = session.get(url, timeout=60)
            if response.status_code == 404:
                time.sleep(2 * (attempt + 1))
                last_error = "404"
                continue
            response.raise_for_status()
            if len(response.content) < 32:
                last_error = "empty"
                time.sleep(2)
                continue
            return response.content
        except requests.RequestException as exc:
            last_error = str(exc)
            time.sleep(2 * (attempt + 1))
    print(f"  no pude bajar {suffix} de {event_id}: {last_error}")
    return None


def upload_event(client, event: dict[str, Any]) -> bool:
    event_id = event.get("id")
    if not event_id:
        return False
    print(f"evento {event_id} {event.get('camera')} {event.get('label')}")
    clip = fetch_media(event_id, "clip")
    if clip is None:
        return False
    clip_dest = put_bytes(client, object_key(event, ".mp4"), clip, "video/mp4")
    print(f"  clip -> {clip_dest}")
    snap = fetch_media(event_id, "snapshot")
    if snap:
        snap_dest = put_bytes(client, object_key(event, ".jpg"), snap, "image/jpeg")
        print(f"  snap -> {snap_dest}")
    return True


def healthcheck(client) -> None:
    stamp = datetime.now(timezone.utc).isoformat()
    body = f"alonso-cameras-uploader ok {stamp}\n".encode()
    dest = put_bytes(client, f"{PREFIX}/_health/uploader.txt", body, "text/plain")
    print(f"health -> {dest}")


def wait_for_frigate() -> None:
    for _ in range(60):
        try:
            response = session.get(f"{FRIGATE_URL}/api/version", timeout=5)
            if response.ok:
                print(f"Frigate listo: {response.text.strip()}")
                return
        except requests.RequestException:
            pass
        time.sleep(5)
    raise SystemExit(f"Frigate no respondió en {FRIGATE_URL}")


def main() -> None:
    wait_for_frigate()
    client = s3_client()
    mode = f"s3://{BUCKET}" if client else f"ensayo {DRY_ROOT}"
    print(f"uploader en {mode}")
    healthcheck(client)
    state = load_state()
    seen = set(state.get("ids") or [])
    while True:
        try:
            for event in fetch_events():
                event_id = event.get("id")
                if not event_id or event_id in seen:
                    continue
                if event.get("end_time") in (None, ""):
                    continue
                if upload_event(client, event):
                    seen.add(event_id)
                    state["ids"] = list(seen)[-500:]
                    save_state(state)
        except Exception as exc:
            print(f"ciclo falló: {exc.__class__.__name__}: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
