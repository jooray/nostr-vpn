#!/usr/bin/env python3
"""Exercise a compiled Wintun build script against isolated Cargo cache fixtures.

Usage: test-wintun-build-inputs.py BUILD_SCRIPT WINTUN_0_5_1_CRATE
The caller compiles build.rs with the repository's pinned sha2 dependency.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

binary, archive = map(lambda value: Path(value).resolve(), sys.argv[1:])
assert hashlib.sha256(archive.read_bytes()).hexdigest() == "da99be64b5aa3de869c16977994314d0759a698d9a73ab0a5b1d52e2282033ae"
with tempfile.TemporaryDirectory(prefix="nvpn-wintun-inputs-") as temporary:
    root = Path(temporary)
    registry = root / "cargo/registry/src/test-registry"
    output = root / "target/release/build/fixture/out"
    output.mkdir(parents=True)
    env = {**os.environ, "CARGO_HOME": str(root / "cargo"), "CARGO_CFG_TARGET_OS": "windows",
           "CARGO_CFG_TARGET_ARCH": "x86_64", "OUT_DIR": str(output), "PROFILE": "release"}

    def run(ok):
        result = subprocess.run([str(binary)], env=env, text=True, capture_output=True)
        assert (result.returncode == 0) == ok, result.stdout + result.stderr
        return result

    bogus = registry / "wintun-bindings-0.7.40/wintun/bin/amd64/wintun.dll"
    bogus.parent.mkdir(parents=True)
    bogus.write_bytes(b"unreviewed similarly named dependency")
    run(False)
    with tarfile.open(archive) as crate:
        for architecture, directory in [("x86_64", "amd64"), ("x86", "x86"), ("arm", "arm"), ("aarch64", "arm64")]:
            env["CARGO_CFG_TARGET_ARCH"] = architecture
            data = crate.extractfile(f"wintun-0.5.1/wintun/bin/{directory}/wintun.dll").read()
            source = registry / f"wintun-0.5.1/wintun/bin/{directory}/wintun.dll"
            source.parent.mkdir(parents=True)
            source.write_bytes(data)
            target = root / "target/release/wintun.dll"
            target.write_bytes(b"stale target")
            run(True)
            assert target.read_bytes() == data
            source.write_bytes(b"tampered cached DLL")
            assert "reviewed content hash" in run(False).stderr
            source.write_bytes(data)
            run(True)
    env["CARGO_CFG_TARGET_ARCH"] = "unsupported"
    run(False)
print("WINTUN_PINNED_INPUTS_OK: all four architectures; unrelated, stale, missing and tampered inputs")
