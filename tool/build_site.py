"""Compose the public static site: PIN gate + full console, as a complete page.

Unlike the Artifact build there is no sandbox here, so the ordinary browser
download works and .xlsx comes straight out of the page — which is the whole
reason for hosting it ourselves.

Output: ./site/index.html  (plus .nojekyll and a README for the repo)
"""
import hashlib
import io
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "site")

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
    html = read("index.html")
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    if not m:
        raise SystemExit("index.html: <body> not found")
    return re.sub(r'<script src="[^"]+"></script>\s*', "", m.group(1)).strip()


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
    gate_js = gate_js.replace("__PIN_HASH__", pin_hash).replace("__PIN_SALT__", PIN_SALT)
    gate_js = gate_js.replace("</script", "<\\/script")
    if PIN in gate_js:
        raise SystemExit("the PIN leaked into the built page in plain text")

    page = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<meta name="description" content="Farmkogls Booking Console">
<title>Farmkogls Booking Console</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%9A%A2%3C/text%3E%3C/svg%3E">
<style id="gate-css">
{gate_css}
</style>
<style id="tool-css">
{tool_css}
</style>
</head>
<body>

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
</body>
</html>
"""

    if os.path.isdir(SITE):
        shutil.rmtree(SITE)
    os.makedirs(SITE)
    with io.open(os.path.join(SITE, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(page)
    # GitHub Pages otherwise runs Jekyll and drops files beginning with "_"
    with io.open(os.path.join(SITE, ".nojekyll"), "w", encoding="utf-8") as fh:
        fh.write("")

    kb = os.path.getsize(os.path.join(SITE, "index.html")) / 1024.0
    print("built %s  (%.0f KB)" % (os.path.join(SITE, "index.html"), kb))
    return 0


if __name__ == "__main__":
    sys.exit(main())
