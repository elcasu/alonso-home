#!/usr/bin/env python3
"""Parpadea un GPIO. Usar un LED o relé de 5/12 V — nunca 220 V en el banco."""
from __future__ import annotations

import argparse
import sys
import time

try:
    from gpiozero import LED
except ImportError:
    print("Instalá python3-gpiozero (sudo bash scripts/pi/bootstrap.sh)")
    sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Test GPIO Alonso Home")
    parser.add_argument("--pin", type=int, default=17, help="BCM pin")
    parser.add_argument("--cycles", type=int, default=3)
    parser.add_argument("--active-high", action="store_true")
    args = parser.parse_args()

    lamp = LED(args.pin, active_high=args.active_high)
    print(f"GPIO BCM {args.pin} — {args.cycles} ciclos (Ctrl+C para cortar)")
    try:
        for i in range(args.cycles):
            lamp.on()
            print(f"  [{i + 1}] ON")
            time.sleep(1)
            lamp.off()
            print(f"  [{i + 1}] OFF")
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        lamp.off()
        lamp.close()
        print("GPIO liberado, pin en OFF.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
