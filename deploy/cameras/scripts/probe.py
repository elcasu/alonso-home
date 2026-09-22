#!/usr/bin/env python3
"""Descubre GT-N3 / iCSee en la LAN (DVRIP + ONVIF). No barre la subred."""

from __future__ import annotations

import argparse
import json
import socket
import sys
import time
from urllib.parse import urlparse
from xml.etree import ElementTree

DVRIP_PROBE = bytes.fromhex("ff00000000000000000000000000fa0500000000")
DVRIP_PORT = 34569

WS_DISCOVERY = """<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>
    <a:MessageID>uuid:alonso-probe</a:MessageID>
    <a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>
"""

PORTS = (80, 554, 8000, 34567)


def check_port(host: str, port: int, timeout: float = 1.2) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def probe_host(host: str) -> dict[int, bool]:
    return {port: check_port(host, port) for port in PORTS}


def print_host(host: str, ports: dict[int, bool], user: str, password: str) -> None:
    open_ports = [str(port) for port, ok in ports.items() if ok]
    closed = [str(port) for port, ok in ports.items() if not ok]
    print(f"\n{host}")
    print(f"  abiertos: {', '.join(open_ports) or 'ninguno'}")
    if closed:
        print(f"  cerrados: {', '.join(closed)}")
    if ports.get(554):
        print("  RTSP a probar:")
        print(f"    rtsp://{user}:{password}@{host}:554/onvif1")
        print(
            f"    rtsp://{user}:{password}@{host}:554/"
            f"user={user}_password={password}_channel=0_stream=0.sdp?real_stream"
        )
    if ports.get(34567):
        print("  DVRIP (go2rtc):")
        print(f"    dvrip://{user}:{password}@{host}:34567?channel=0&subtype=1")
    if not ports.get(554) and not ports.get(34567):
        print("  no habla RTSP ni DVRIP en esta IP")


def discover_dvrip(seconds: float = 2.5) -> list[dict]:
    """Mismo broadcast UDP que iCSee / XMEye / go2rtc. Las cámaras contestan solas."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("", DVRIP_PORT))
    except OSError:
        sock.bind(("", 0))
    sock.settimeout(0.3)
    found: dict[str, dict] = {}
    deadline = time.time() + seconds
    sent = 0
    while time.time() < deadline:
        if sent < 3:
            sock.sendto(DVRIP_PROBE, ("255.255.255.255", DVRIP_PORT))
            sent += 1
        try:
            data, addr = sock.recvfrom(4096)
        except socket.timeout:
            continue
        host = addr[0]
        if host in found or data == DVRIP_PROBE:
            continue
        info: dict = {"host": host, "name": "", "mac": "", "sn": ""}
        if len(data) > 21:
            try:
                payload = data[20:]
                if payload.endswith(b"\x00"):
                    payload = payload[:-1]
                msg = json.loads(payload.decode("utf-8", errors="ignore"))
                net = msg.get("NetCommon") or msg
                info["name"] = str(net.get("HostName") or "")
                info["mac"] = str(net.get("MAC") or "")
                info["sn"] = str(net.get("SN") or "")
                parsed = parse_xm_ip(str(net.get("HostIP") or ""))
                if parsed:
                    info["host"] = parsed
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                pass
        found[info["host"]] = info
    sock.close()
    return list(found.values())


def parse_xm_ip(raw: str) -> str:
    hex_part = raw.lower().removeprefix("0x")
    if len(hex_part) != 8:
        return ""
    try:
        value = int(hex_part, 16)
    except ValueError:
        return ""
    octets = value.to_bytes(4, "little")
    return ".".join(str(b) for b in octets)


def discover_onvif(seconds: float = 3.0) -> list[str]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(0.4)
    sock.sendto(WS_DISCOVERY.encode("utf-8"), ("239.255.255.250", 3702))
    found: set[str] = set()
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            data, addr = sock.recvfrom(8192)
        except socket.timeout:
            continue
        host = addr[0]
        try:
            root = ElementTree.fromstring(data)
        except ElementTree.ParseError:
            found.add(host)
            continue
        for node in root.iter():
            if node.tag.endswith("XAddrs") and node.text:
                for url in node.text.split():
                    parsed = urlparse(url)
                    if parsed.hostname:
                        found.add(parsed.hostname)
        found.add(host)
    sock.close()
    return sorted(found)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Descubre ONVIF por multicast y prueba IPs concretas de las GT-N3."
    )
    parser.add_argument("hosts", nargs="*", help="IPs que ya viste en el router o en iCSee")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="admin")
    parser.add_argument("--no-discover", action="store_true")
    args = parser.parse_args()

    hosts = list(dict.fromkeys(args.hosts))
    if not args.no_discover:
        print("DVRIP / iCSee (UDP 34569)...")
        dvrip = discover_dvrip()
        for cam in dvrip:
            extra = " ".join(
                part for part in (cam.get("name"), cam.get("mac"), cam.get("sn")) if part
            )
            print(f"  {cam['host']}" + (f"  {extra}" if extra else ""))
            if cam["host"] not in hosts:
                hosts.append(cam["host"])
        if not dvrip:
            print("  nadie respondió por DVRIP")

        print("ONVIF multicast (239.255.255.250:3702)...")
        discovered = discover_onvif()
        if discovered:
            print("  respondieron: " + ", ".join(discovered))
            hosts.extend(h for h in discovered if h not in hosts)
        else:
            print("  nadie respondió por ONVIF")

    if not hosts:
        print("Sin IPs. En iCSee: Ajustes → Información del dispositivo.", file=sys.stderr)
        return 1

    for host in hosts:
        print_host(host, probe_host(host), args.user, args.password)
    print("\nSi alguna abre 554 o 34567, copiá la IP a FRIGATE_CAM1_HOST en .env y corré ./up.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
