"""Bundle index.html + src/* into one self-contained HTML file.

Output: ../Farmkogls_Booking_Console.html — no external requests, no install,
openable by double-click.
"""
import os
import re
import sys
import io

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(ROOT, "..", "Farmkogls_Booking_Console.html"))


ALLOWED_CTL = {9, 10, 13}


def read(rel):
    path = os.path.join(ROOT, rel)
    with io.open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    # A literal control byte in a source file survives a direct <script src>
    # load but not a text round-trip through this bundler. Fail loudly instead.
    bad = sorted({ord(c) for c in text if ord(c) < 32 and ord(c) not in ALLOWED_CTL})
    if bad:
        raise SystemExit(
            "%s contains literal control characters %s — write them as escape "
            "sequences or filter by code point instead." % (rel, [hex(b) for b in bad])
        )
    return text


def guard_js(js):
    """A literal </script> inside JS would terminate the host <script> tag."""
    return js.replace("</script", "<\\/script")


def main():
    html = read("index.html")

    # inline the stylesheet
    def css_sub(m):
        href = m.group(1)
        return "<style>\n/* %s */\n%s\n</style>" % (href, read(href))

    html, n_css = re.subn(
        r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>', css_sub, html
    )

    # inline each script
    def js_sub(m):
        src = m.group(1)
        return "<script>\n/* ===== %s ===== */\n%s\n</script>" % (src, guard_js(read(src)))

    html, n_js = re.subn(r'<script src="([^"]+)"></script>', js_sub, html)

    if not n_css or not n_js:
        print("!! nothing inlined (css=%d js=%d) — check index.html markup" % (n_css, n_js))
        return 1

    banner = (
        "<!--\n"
        "  Farmkogls Booking Console — single-file build\n"
        "  Open this file in Microsoft Edge or Google Chrome. Nothing is installed,\n"
        "  nothing is uploaded: every workbook you drop in is parsed in the browser.\n"
        "  Rebuild with:  python farmkogls-console/build.py\n"
        "-->\n"
    )
    html = html.replace("<!doctype html>", "<!doctype html>\n" + banner, 1)

    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write(html)

    kb = os.path.getsize(OUT) / 1024.0
    print("built %s  (%d stylesheet, %d scripts, %.0f KB)" % (OUT, n_css, n_js, kb))
    return 0


if __name__ == "__main__":
    sys.exit(main())
