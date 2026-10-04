# PyInstaller spec. Collect Fava/Beancount data files so templates survive freeze.
# beanquery.sources is a namespace package; importlib loads beanquery.sources.<scheme>.

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []
for package in ("fava", "beancount", "beanquery", "flask", "jinja2", "werkzeug", "click"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden
hiddenimports += [
    "beanquery.sources",
    "beanquery.sources.beancount",
    "beanquery.sources.memory",
    "beanquery.sources.csv",
]
init = Path("packaging/beanquery.sources/__init__.py")
if init.is_file():
    datas.append((str(init.resolve()), "beanquery/sources"))

a = Analysis(
    ["beandesk_engine.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "test"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="beandesk-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Windows: a console program shows a window, and closing it kills Fava.
    console=sys.platform != "win32",
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="beandesk-engine",
)
