"""The PIN lives in pin.txt, which is never committed.

It used to be a literal in build_site.py and build_artifact.py, and those files
are published, so the PIN shipped to the public repository along with them.
A door code printed on the door is not a door code. Keeping it in one
untracked file makes it hard to leak by accident again.

Every build asserts the PIN does not appear in its own output.
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PIN_FILE = os.path.join(ROOT, "pin.txt")
PIN_SALT = "farmkogls.console.gate.v1"


def load_pin():
    if not os.path.exists(PIN_FILE):
        raise SystemExit(
            "pin.txt is missing.\n"
            "Create %s containing just the 4 digits, e.g.\n"
            '    python -c "open(r\'%s\',\'w\').write(\'1234\')"\n'
            "It is git-ignored on purpose - do not commit it." % (PIN_FILE, PIN_FILE))
    with io.open(PIN_FILE, "r", encoding="utf-8") as fh:
        pin = fh.read().strip()
    if not re.match(r"^\d{4}$", pin):
        raise SystemExit("pin.txt must contain exactly 4 digits, found %r" % pin)
    return pin


def assert_absent(pin, text, where):
    """Refuse to ship any file that spells the PIN out."""
    if re.search(r"(?<!\d)%s(?!\d)" % re.escape(pin), text):
        raise SystemExit("the PIN appears in plain text in %s" % where)


if __name__ == "__main__":
    sys.stdout.write(load_pin() + "\n")
