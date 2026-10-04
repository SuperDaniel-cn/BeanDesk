#!/usr/bin/env bash
# Freeze beandesk-engine as an onedir tree. Output:
# src-tauri/binaries/engine/{beandesk-engine[.exe],_internal/}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VENV="$ROOT/.engine-venv"
if [ ! -x "$VENV/bin/python" ] && [ ! -x "$VENV/Scripts/python.exe" ]; then
    python3 -m venv "$VENV"
fi
if [ -x "$VENV/bin/python" ]; then
    PYTHON="$VENV/bin/python"
else
    PYTHON="$VENV/Scripts/python.exe"
fi

"$PYTHON" -m pip install -q -r "$ROOT/engine/requirements.txt"
mkdir -p "$ROOT/src-tauri/binaries"
(
    cd "$ROOT/engine"
    "$PYTHON" -m PyInstaller --noconfirm --clean beandesk_engine.spec
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
if [ "$(uname -s)" = Darwin ] && [ -n "${ENGINE_ARCH:-}" ]; then
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
