#!/usr/bin/env python3
"""Puts the libraries the app links from Homebrew (FFmpeg and what it needs) inside Umi.app,
so it runs on Macs without Homebrew, then signs everything again.

Run after `tauri build` (see `pnpm build:mac`). Signing uses the identity and entitlements in
src-tauri/tauri.conf.json.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
APP = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "target/release/bundle/macos/Umi.app")
EXE = os.path.join(APP, "Contents/MacOS/umi-desktop")
FRAMEWORKS = os.path.join(APP, "Contents/Frameworks")
CONF = json.load(open(os.path.join(HERE, "..", "src-tauri", "tauri.conf.json")))
MAC = CONF["bundle"].get("macOS", {})
IDENTITY = MAC.get("signingIdentity") or "-"
ENTITLEMENTS = os.path.join(HERE, "..", "src-tauri", MAC.get("entitlements", "Entitlements.plist"))


def run(*args):
    subprocess.run(args, check=True, capture_output=True)


def linked(path):
    """Libraries `path` loads from outside the system (Homebrew)."""
    lines = subprocess.run(["otool", "-L", path], capture_output=True, text=True, check=True).stdout.splitlines()[1:]
    refs = [line.strip().split(" (")[0] for line in lines]
    return [r for r in refs if r.startswith(("/opt/homebrew", "/usr/local"))]


def main():
    os.makedirs(FRAMEWORKS, exist_ok=True)
    # Every outside library, by the name it's loaded as (e.g. libavutil.61.dylib).
    todo, names = [EXE], {}
    while todo:
        for ref in linked(todo.pop()):
            name = os.path.basename(ref)
            if name in names:
                continue
            names[name] = os.path.realpath(ref)
            todo.append(names[name])
    for name, real in names.items():
        dest = os.path.join(FRAMEWORKS, name)
        shutil.copyfile(real, dest)
        os.chmod(dest, 0o755)
        run("install_name_tool", "-id", f"@rpath/{name}", dest)
    # Point every reference at the copies.
    for path in [EXE] + [os.path.join(FRAMEWORKS, n) for n in names]:
        for ref in linked(path):
            run("install_name_tool", "-change", ref, f"@rpath/{os.path.basename(ref)}", path)
    rpaths = subprocess.run(["otool", "-l", EXE], capture_output=True, text=True).stdout
    if "@executable_path/../Frameworks" not in rpaths:
        run("install_name_tool", "-add_rpath", "@executable_path/../Frameworks", EXE)
    for path in [EXE] + [os.path.join(FRAMEWORKS, n) for n in names]:
        if linked(path):
            sys.exit(f"still linked outside the app: {path}")
    # Sign the libraries, then the app (hardened runtime, with its entitlements).
    for name in names:
        run("codesign", "--force", "--timestamp=none", "--sign", IDENTITY, os.path.join(FRAMEWORKS, name))
    run("codesign", "--force", "--timestamp=none", "--options", "runtime", "--entitlements", ENTITLEMENTS, "--sign", IDENTITY, APP)
    run("codesign", "--verify", "--deep", "--strict", APP)
    size = sum(os.path.getsize(os.path.join(FRAMEWORKS, n)) for n in names)
    print(f"Bundled {len(names)} libraries ({size / 1e6:.0f} MB) into {os.path.relpath(APP, ROOT)} and signed it.")


main()
