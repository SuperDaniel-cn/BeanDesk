#!/usr/bin/env bash
# Freeze beandesk-engine as an onedir tree. Output:
# src-tauri/binaries/engine/{beandesk-engine[.exe],_internal/}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Actions passes python-path. On Apple Silicon that path can still be a
# universal2 interpreter that runs as arm64 unless Rosetta forces x86_64.
if [ -n "${PYTHON:-}" ]; then
    HOST_PYTHON="$PYTHON"
elif command -v python3 >/dev/null 2>&1; then
    HOST_PYTHON="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    HOST_PYTHON="$(command -v python)"
else
    echo "python is needed to freeze the engine" >&2
    exit 1
fi

CHECK_ARCH=
if [ "$(uname -s)" = Darwin ] && [ -n "${ENGINE_ARCH:-}" ]; then
    CHECK_ARCH=1
fi

py() {
    if [ "$(uname -s)" = Darwin ] && [ "${ENGINE_ARCH:-}" = x86_64 ]; then
        arch -x86_64 "$@"
    else
        "$@"
    fi
}

if [ "$(uname -s)" = Darwin ] && [ "${ENGINE_ARCH:-}" = x86_64 ]; then
    if ! arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
        echo "Rosetta is required to freeze an x86_64 engine" >&2
        exit 1
    fi
fi

require_arch() {
    local arch
    arch="$(py "$1" -c 'import platform; print(platform.machine())')"
    if [ "$arch" != "$ENGINE_ARCH" ]; then
        echo "interpreter $1 is $arch, expected ${ENGINE_ARCH}" >&2
        exit 1
    fi
}

if [ -n "$CHECK_ARCH" ] && [ -n "${PYTHON:-}" ]; then
    require_arch "$HOST_PYTHON"
fi

VENV="$ROOT/.engine-venv"
if [ -n "${PYTHON:-}" ]; then
    rm -rf "$VENV"
fi
if [ ! -x "$VENV/bin/python" ] && [ ! -x "$VENV/Scripts/python.exe" ]; then
    py "$HOST_PYTHON" -m venv "$VENV"
fi
if [ -x "$VENV/bin/python" ]; then
    VENV_PYTHON="$VENV/bin/python"
else
    VENV_PYTHON="$VENV/Scripts/python.exe"
fi

if [ -n "$CHECK_ARCH" ] && [ -z "${PYTHON:-}" ]; then
    require_arch "$VENV_PYTHON"
fi

py "$VENV_PYTHON" -m pip install -q -r "$ROOT/engine/requirements.txt"
mkdir -p "$ROOT/src-tauri/binaries"
(
    cd "$ROOT/engine"
    py "$VENV_PYTHON" -m PyInstaller --noconfirm --clean beandesk_engine.spec
)
SRC="$ROOT/engine/dist/beandesk-engine"
DEST="$ROOT/src-tauri/binaries/engine"
if [ ! -d "$SRC" ]; then
    echo "freeze produced no directory at $SRC" >&2
    exit 1
fi
rm -rf "$DEST"
mv "$SRC" "$DEST"
if [ -f "$DEST/beandesk-engine.exe" ]; then
    EXE="$DEST/beandesk-engine.exe"
else
    EXE="$DEST/beandesk-engine"
fi
if [ ! -f "$EXE" ] || [ ! -d "$DEST/_internal" ]; then
    echo "onedir freeze missing $EXE or $DEST/_internal" >&2
    exit 1
fi
chmod +x "$EXE" 2>/dev/null || true
if [ -n "$CHECK_ARCH" ]; then
    arches="$(lipo -archs "$EXE" 2>/dev/null || true)"
    case " $arches " in
        *" ${ENGINE_ARCH} "*) ;;
        *)
            echo "bundled engine is [$arches], expected ${ENGINE_ARCH}" >&2
            exit 1
            ;;
    esac
fi
echo "wrote $DEST"
