"""The PIN lives in pin.txt, which is never committed.

It used to be a literal in build_site.py and build_artifact.py, and those files
are published, so the PIN shipped to the public repository along with them.
A door code printed on the door is not a door code. Keeping it in one
untracked file makes it hard to leak by accident again.

Every build asserts the PIN does not appear in its own output.
"""
import base64
import hashlib
import hmac
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PIN_FILE = os.path.join(ROOT, "pin.txt")
ADMIN_PIN_FILE = os.path.join(ROOT, "pin_admin.txt")
PIN_SALT = "farmkogls.console.gate.v1"
DOCS_SALT = "farmkogls.docs.gate.v1"


def _read_pin(path, what):
    if not os.path.exists(path):
        raise SystemExit(
            "%s is missing.\n"
            "Create it containing just the %s digits, e.g.\n"
            '    python -c "open(r\'%s\',\'w\').write(\'1234\')"\n'
            "It is git-ignored on purpose - do not commit it." % (path, what, path))
    with io.open(path, "r", encoding="utf-8") as fh:
        pin = fh.read().strip()
    if not re.match(r"^\d{4}$", pin):
        raise SystemExit("%s must contain exactly 4 digits, found %r" % (path, pin))
    return pin


def load_pin():
    """Opens the console."""
    return _read_pin(PIN_FILE, "console")


def load_admin_pin():
    """Opens the documentation, which is encrypted with it - see build_docs.py."""
    return _read_pin(ADMIN_PIN_FILE, "admin")


def assert_absent(pin, text, where):
    """Refuse to ship any file that spells the PIN out."""
    if re.search(r"(?<!\d)%s(?!\d)" % re.escape(pin), text):
        raise SystemExit("the PIN appears in plain text in %s" % where)


ITERATIONS = 400000


def derive_key(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"),
                               salt.encode("utf-8"), ITERATIONS, 32)


def keystream(key, length):
    """SHA-256 in counter mode. No AES in the standard library, and adding a
    crypto package would break the tool's no-dependency rule for the sake of
    one build step."""
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(key + counter.to_bytes(8, "big")).digest()
        counter += 1
    return bytes(out[:length])


def encrypt(pin, salt, text):
    """-> (ciphertext base64, hmac tag hex). The tag doubles as the PIN check:
    a wrong PIN derives a different key and simply fails to verify."""
    key = derive_key(pin, salt)
    plain = text.encode("utf-8")
    cipher = bytes(a ^ b for a, b in zip(plain, keystream(key, len(plain))))
    tag = hmac.new(key, cipher, hashlib.sha256).hexdigest()
    return base64.b64encode(cipher).decode("ascii"), tag


if __name__ == "__main__":
    sys.stdout.write(load_pin() + "\n")
