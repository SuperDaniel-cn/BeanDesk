"""Ledger engine shipped next to BeanDesk. No ledger path is baked in."""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in {"-h", "--help"}:
        sys.stderr.write("beandesk-engine fava [args...]\nbeandesk-engine check [args...]\n")
        return 2
    command, rest = args[0], args[1:]
    if command == "fava":
        from fava.cli import main as fava_main

        sys.argv = ["fava", *rest]
        fava_main()
        return 0
    if command == "check":
        from beancount.scripts.check import main as check_main

        sys.argv = ["bean-check", *rest]
        check_main()
        return 0
    sys.stderr.write(f"unknown command: {command}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
