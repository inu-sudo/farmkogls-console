"""Compose the hosted (Artifact) build: PIN gate + the full console.

Differences from build.py:
  * no <!doctype>/<html>/<head>/<body> — the Artifact host supplies those
  * the console's markup lives in a <template>, injected after the PIN gate
  * the tool's CSS and JS sit in readable elements so the page can rebuild the
    standalone .html file at download time instead of carrying a second copy

Output: ../Farmkogls_Console_Hosted.html  (input to the Artifact tool)
"""
import hashlib
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(ROOT, "..", "Farmkogls_Console_Hosted.html"))

# Change PIN here and rebuild. It is stored as a salted hash so the number is
# not sitting in plain sight — but four digits is 10,000 guesses, so treat this
# as a light lock between people who have the link, never as real security.
PIN = "0821"
PIN_SALT = "farmkogls.console.gate.v1"

JS_ORDER = [
    "src/zip.js", "src/xlsx-read.js", "src/xlsx-write.js", "src/xlsx-edit.js",
    "src/normalize.js", "src/propagate.js", "src/parse.js", "src/merge.js",
    "src/aggregate.js", "src/export.js", "src/ui.js",
]
ALLOWED_CTL = {9, 10, 13}


def read(rel):
    with io.open(os.path.join(ROOT, rel), "r", encoding="utf-8") as fh:
        text = fh.read()
    bad = sorted({ord(c) for c in text if ord(c) < 32 and ord(c) not in ALLOWED_CTL})
    if bad:
        raise SystemExit("%s has literal control characters %s" % (rel, [hex(b) for b in bad]))
    return text


def app_shell():
    """The console's own markup, lifted out of index.html."""
    html = read("index.html")
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    if not m:
        raise SystemExit("index.html: <body> not found")
    body = m.group(1)
    body = re.sub(r'<script src="[^"]+"></script>\s*', "", body)
    return body.strip()


def main():
    tool_css = read("src/styles.css")
    tool_js = "\n".join(
        "/* ===== %s ===== */\n%s" % (p, read(p).replace("</script", "<\\/script"))
        for p in JS_ORDER
    )
    shell = app_shell()
    gate_css = read("hosted/gate.css")
    gate_html = read("hosted/gate.html")

    pin_hash = hashlib.sha256((PIN_SALT + ":" + PIN).encode("utf-8")).hexdigest()
    gate_js = read("hosted/gate.js")
    if "__PIN_HASH__" not in gate_js or "__PIN_SALT__" not in gate_js:
        raise SystemExit("hosted/gate.js: PIN placeholders missing")
    gate_js = gate_js.replace("__PIN_HASH__", pin_hash).replace("__PIN_SALT__", PIN_SALT)
    gate_js = gate_js.replace("</script", "<\\/script")
    if PIN in gate_js:
        raise SystemExit("the PIN leaked into the built page in plain text")

    page = f"""<title>Farmkogls Booking Console</title>

<style id="gate-css">
{gate_css}
</style>

<style id="tool-css">
{tool_css}
</style>

{gate_html}

<template id="app-shell">
{shell}
</template>

<div id="app" hidden></div>

<script id="tool-js">
{tool_js}
</script>

<script id="gate-js">
{gate_js}
</script>
"""

    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("built %s  (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
