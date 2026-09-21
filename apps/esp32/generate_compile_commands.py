#!/usr/bin/env python3
"""Genera compile_commands.json para clangd a partir de idedata de PlatformIO."""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    Import("env")  # type: ignore[name-defined]  # noqa: F821
    ROOT = Path(env["PROJECT_DIR"])  # type: ignore[name-defined]
except NameError:
    ROOT = Path(__file__).resolve().parent

IDE_DATA = ROOT / ".pio" / "build" / "esp32dev" / "idedata.json"
OUT = ROOT / "compile_commands.json"

DROP_FLAGS = {
    "-mlongcalls",
    "-fstrict-volatile-bitfields",
    "-fno-tree-switch-conversion",
    "-fno-jump-tables",
    "-freorder-blocks",
    "-MMD",
    "-ggdb",
    "-fstack-protector",
    "-ffunction-sections",
    "-fdata-sections",
    "-Wno-frame-address",
}


def generate() -> None:
    if not IDE_DATA.exists():
        print(f"No está {IDE_DATA}. Corré: pio project init --ide vscode", file=sys.stderr)
        return
    data = json.loads(IDE_DATA.read_text())
    includes = list(data.get("includes", {}).get("build", []))
    includes += list(data.get("includes", {}).get("toolchain", []))
    defines = [d for d in data.get("defines", []) if d]
    flags = [f for f in data.get("cxx_flags", []) if f and f not in DROP_FLAGS]
    project_roots = (str(ROOT / "include"), str(ROOT / "src"))
    args = [
        "clang++",
        "-c",
        "--target=i386-unknown-linux-gnu",
        "-ferror-limit=0",
        "-Wno-unknown-warning-option",
        "-Wno-unused-command-line-argument",
    ]
    args.extend(flags)
    for define in defines:
        args.append(f"-D{define}")
    for include in includes:
        if include.startswith(project_roots):
            args.append(f"-I{include}")
        else:
            args.append(f"-isystem{include}")
    sources = [ROOT / "src" / "main.cpp"]
    db = []
    for src in sources:
        db.append(
            {
                "directory": str(ROOT),
                "file": str(src),
                "arguments": args + [str(src)],
            }
        )
    OUT.write_text(json.dumps(db, indent=2) + "\n")
    print(f"Wrote {OUT}")


generate()
