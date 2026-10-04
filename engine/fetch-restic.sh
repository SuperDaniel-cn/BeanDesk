#!/usr/bin/env bash
# Fetch the pinned restic release for one Rust target triple and check it
# against hashes taken from the release's GPG-signed SHA256SUMS
# (key CF8F18F2844575973F79D4E191A6868BD3F7A907). Output:
# src-tauri/binaries/restic/{restic[.exe],LICENSE}
set -euo pipefail

VERSION=0.19.1
LICENSE_SHA=6f08a01a9fab5b24e139a09f15cc24a73087c7bc09e3bacf099fdf2d767bf897
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/src-tauri/binaries/restic"

TARGET="${1:-${TARGET:-}}"
if [ -z "$TARGET" ]; then
    case "$(uname -s)-$(uname -m)" in
        Darwin-arm64) TARGET=aarch64-apple-darwin ;;
        Darwin-x86_64) TARGET=x86_64-apple-darwin ;;
        Linux-x86_64) TARGET=x86_64-unknown-linux-gnu ;;
        Linux-aarch64 | Linux-arm64) TARGET=aarch64-unknown-linux-gnu ;;
        MINGW*-x86_64 | MSYS*-x86_64 | CYGWIN*-x86_64) TARGET=x86_64-pc-windows-msvc ;;
        *) echo "no restic build for $(uname -s) $(uname -m)" >&2; exit 1 ;;
    esac
fi

case "$TARGET" in
    aarch64-apple-darwin) ASSET=darwin_arm64.bz2; SHA=7be0a144ccc377880f294204aa271d76e4b79554b42a751151d425ce6ebac143 ;;
    x86_64-apple-darwin) ASSET=darwin_amd64.bz2; SHA=c38d579622cf602f665234c5a8c315030b6cf70656028fe6dc29a786b60e5f35 ;;
    x86_64-unknown-linux-gnu) ASSET=linux_amd64.bz2; SHA=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c ;;
    aarch64-unknown-linux-gnu) ASSET=linux_arm64.bz2; SHA=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465 ;;
    x86_64-pc-windows-msvc) ASSET=windows_amd64.zip; SHA=da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d ;;
    *) echo "no restic build for target $TARGET" >&2; exit 1 ;;
esac

PYTHON="$(command -v python3 || command -v python || true)"
if [ -z "$PYTHON" ]; then
    echo "python3 is needed to check and unpack restic" >&2
    exit 1
fi

NAME="restic_${VERSION}_${ASSET}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL --retry 3 -o "$WORK/$NAME" "https://github.com/restic/restic/releases/download/v${VERSION}/${NAME}"
curl -fsSL --retry 3 -o "$WORK/LICENSE" "https://raw.githubusercontent.com/restic/restic/v${VERSION}/LICENSE"

rm -rf "$DEST"
mkdir -p "$DEST"
"$PYTHON" - "$WORK/$NAME" "$SHA" "$WORK/LICENSE" "$LICENSE_SHA" "$DEST" <<'PY'
import bz2, hashlib, os, shutil, stat, sys, zipfile

archive, archive_sha, license_path, license_sha, dest = sys.argv[1:]

def check(path, expected):
    with open(path, "rb") as handle:
        actual = hashlib.sha256(handle.read()).hexdigest()
    if actual != expected:
        sys.exit(f"sha256 mismatch for {os.path.basename(path)}: {actual}")

check(archive, archive_sha)
check(license_path, license_sha)
if archive.endswith(".zip"):
    exe = os.path.join(dest, "restic.exe")
    with zipfile.ZipFile(archive) as bundle:
        members = [name for name in bundle.namelist() if name.endswith(".exe")]
        if len(members) != 1:
            sys.exit("expected one restic executable in the zip")
        with bundle.open(members[0]) as source, open(exe, "wb") as target:
            shutil.copyfileobj(source, target)
else:
    exe = os.path.join(dest, "restic")
    with bz2.open(archive, "rb") as source, open(exe, "wb") as target:
        shutil.copyfileobj(source, target)
    os.chmod(exe, os.stat(exe).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
shutil.copyfile(license_path, os.path.join(dest, "LICENSE"))
PY
echo "wrote $DEST ($NAME)"
