#!/usr/bin/env python3
"""Genera deploy/cameras/config/config.yml a partir del .env. Sin secretos en git."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
OUT_PATH = ROOT / "config" / "config.yml"

DEFAULTS = {
    "FRIGATE_LAB": "1",
    "FRIGATE_RTSP_USER": "admin",
    "FRIGATE_CAM1_NAME": "entrada",
    "FRIGATE_CAM2_NAME": "patio",
    "FRIGATE_CAM3_NAME": "cochera",
}


def load_env(path: Path) -> dict[str, str]:
    values = dict(DEFAULTS)
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def camera_block(name: str, host: str) -> str:
    return f"""
  {name}:
    enabled: true
    ffmpeg:
      output_args:
        record: preset-record-generic-audio-aac
      inputs:
        - path: rtsp://127.0.0.1:8554/{name}
          input_args: preset-rtsp-restream
          roles:
            - record
        - path: rtsp://127.0.0.1:8554/{name}_sub
          input_args: preset-rtsp-restream
          roles:
            - detect
    detect:
      enabled: true
      width: 800
      height: 448
      fps: 5
    live:
      streams:
        Principal: {name}
        Sub: {name}_sub
"""


def go2rtc_block(name: str, host: str) -> str:
    return f"""    {name}:
      - rtsp://{{FRIGATE_RTSP_USER}}:{{FRIGATE_RTSP_PASSWORD}}@{host}:554/onvif1
      - rtsp://{{FRIGATE_RTSP_USER}}:{{FRIGATE_RTSP_PASSWORD}}@{host}:554/user={{FRIGATE_RTSP_USER}}_password={{FRIGATE_RTSP_PASSWORD}}_channel=0_stream=0.sdp?real_stream
    {name}_sub:
      - rtsp://{{FRIGATE_RTSP_USER}}:{{FRIGATE_RTSP_PASSWORD}}@{host}:554/user={{FRIGATE_RTSP_USER}}_password={{FRIGATE_RTSP_PASSWORD}}_channel=0_stream=1.sdp?real_stream
      - dvrip://{{FRIGATE_RTSP_USER}}:{{FRIGATE_RTSP_PASSWORD}}@{host}:34567?channel=0&subtype=1
"""


def lab_camera() -> str:
    return """
  laboratorio:
    enabled: true
    ffmpeg:
      inputs:
        - path: rtsp://127.0.0.1:8554/laboratorio
          input_args: preset-rtsp-restream
          roles:
            - detect
            - record
    detect:
      enabled: true
      width: 640
      height: 360
      fps: 5
    live:
      streams:
        Laboratorio: laboratorio
"""


def lab_go2rtc() -> str:
    return """    laboratorio:
      - exec:ffmpeg -hide_banner -re -f lavfi -i testsrc=size=1280x720:rate=5 -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -f rtsp {{output}}
"""


def render(env: dict[str, str]) -> str:
    cameras = ""
    go2rtc = ""
    if truthy(env.get("FRIGATE_LAB")):
        cameras += lab_camera()
        go2rtc += lab_go2rtc()

    for index in (1, 2, 3):
        host = (env.get(f"FRIGATE_CAM{index}_HOST") or "").strip()
        name = (env.get(f"FRIGATE_CAM{index}_NAME") or f"camara_{index}").strip()
        if not host:
            continue
        cameras += camera_block(name, host)
        go2rtc += go2rtc_block(name, host)

    if not cameras.strip():
        raise SystemExit(
            "Nada que renderizar. Poné FRIGATE_LAB=1 o al menos una FRIGATE_CAMn_HOST en .env"
        )

    return f"""# Generado por scripts/render-config.py. No editar a mano.
mqtt:
  enabled: false

auth:
  enabled: false

tls:
  enabled: false

detectors:
  cpu:
    type: cpu
    num_threads: 2

record:
  enabled: true
  retain:
    days: 0
    mode: all
  alerts:
    retain:
      days: 3
  detections:
    retain:
      days: 3

snapshots:
  enabled: true
  retain:
    default: 3

objects:
  track:
    - person
    - car
    - dog
    - cat

go2rtc:
  streams:
{go2rtc}
cameras:
{cameras}
version: 0.16-0
"""


def main() -> None:
    env = load_env(ENV_PATH)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(render(env), encoding="utf-8")
    print(f"Escribí {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
