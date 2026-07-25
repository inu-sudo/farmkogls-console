# Farmkogls Booking Console

A single HTML file that takes the Excel workbooks you already exchange by email,
merges them into one running booking register, shows what it means, and writes a
consolidated Excel file back out.

**To use it: double-click `Farmkogls_Booking_Console.html`.** Nothing to install,
no server, no login. Every workbook you drop in is parsed inside the browser —
no file or figure ever leaves the machine.

---

## Two jobs, deliberately separate

**1. Update the register in place** (the main job — the `파일 갱신` tab)

```
  학습.xlsx  +  FES AGENCY workbook
       │              │
       └──▶ map ──▶ edit that workbook in place ──▶ updated copy out
                    · existing B/L  -> update the row
                    · new B/L       -> insert a row, push CANCEL LIST down
                    · formulas, formats, drawings, comments all preserved
```

The target workbook is **not rebuilt**. Only the cells that must change are
changed, so every formula, number format, fill, merged cell, conditional format,
picture, comment and print setting survives — and other sheets are untouched.
New rows inherit the style and formulas of the row above.

**2. Consolidate and analyse** (the dashboards + a fresh 14-sheet report)

```
   agency forecast ─┐
   BK sheet (마감)  ─┤
   FES BK FCST      ├──▶  normalise ──▶ merge into ──▶  dashboards  ──▶  consolidated
   Schedule         │      + dedupe     the register     + checks         .xlsx out
   BSA              │
   DF calculator   ─┘
```

1. **Reads** any mix of the workbooks below, in one drop or over many weeks.
2. **Normalises** ports, vessels, voyages, services and parties to one vocabulary
   (`MYPKG(N)`, `MYPKN`, `NPKL` all become `MYPKN`; `MELBOURNE BRDIGE` becomes
   `MELBOURNE BRIDGE`; `팜코` and `FARMKO` are the same house).
3. **Merges** each row into a running register keyed on B/L + voyage + POD, so
   re-sending the same file changes nothing and a corrected file updates only the
   fields it actually carries. The result does not depend on the order you drop
   files in.
4. **Rebuilds the ROB load plan** for every voyage by walking the service rotation —
   loading each booking at its POL, discharging it at its POD — and compares the
   peak on-board load against the BSA.
5. **Exports** a 14-sheet workbook in your own column layouts.

## Recognised inputs

| Sheet looks like | Recognised as | What is taken from it |
|---|---|---|
| `FES CSC/NWX/CCS/SKS BK FCST` | agency forecast | bookings, service from the `SVC NAME` cell |
| `FES BK FCST` | consolidated register | bookings incl. 2nd leg / T/S, plus the `** CANCEL LIST` block |
| `... 마감` per voyage | BK sheet | bookings, SVC, vessel/voyage, BSA (TEU and tons), DF rate, closings, Win-Sabis code, the `Cancel 정리` block |
| `Schedule` / `SCHEDULE` | schedule | port rotation and ETD per call, per service |
| `<SVC> BSA` | BSA | TEU and weight allocation per voyage, incl. `A => B` substitutions |
| `GFS_/BTL_/XPR_...` | DF contract | rate per TEU, committed volume and weight, surcharges |
| per-vessel ROB | ROB | the BSA cap (the load plan itself is recomputed) |
| `.json` | saved project | restores a whole register |

Anything it cannot place is listed under **Changes → Last upload** rather than
being silently dropped.

## Output workbook

| Sheet | Contents |
|---|---|
| `MASTER BK FCST` | every active booking, in the `FES BK FCST` column order, plus status and source columns |
| `FES <SVC> BK FCST` | one sheet per service in the agency column order, with weekly subtotals |
| `VOYAGE SUMMARY` | booked vs peak vs BSA TEU and tons, utilisation, DF cost, selling, margin |
| `ROB LOAD PLAN` | per voyage per port call: load / discharge / on-board / remaining, split 20′-40′ and NDG-DG-OOG |
| `WEEK SUMMARY` | week × service TEU matrix |
| `LANE SUMMARY` | POL → final POD |
| `PARTY SUMMARY` | booking party and customer |
| `CANCEL LIST` | cancelled rows, same layout as the master |
| `CHANGE LOG` | every merge batch and every field that changed, with old and new values |
| `DF CONTRACTS` | parsed dead-freight contracts |
| `DATA QUALITY` | totals, container mix, every check that fired, and a **source disagreements** table naming the file and sheet on each side |

## Weekly routine

1. Open the console. Last week's register is still there.
2. Drop in the new files. The toast reports `new / updated / unchanged`.
3. Read **Changes** to see exactly what moved since last week.
4. Check **Voyages vs BSA** for anything red — that is excess slot cost.
5. Click **Export Excel** and send the result on.
6. Click **Save project file** occasionally, and before changing machines.

## The rules it applies

- **TEU** = 20′DV + 20′MT + 20′FR + Void + 2 × (40′HC + 40′MT + 40′FR) — the same
  formula as the source sheets.
- **WK** = Excel `WEEKNUM(ETD)` with the default Sunday start, so week numbers
  match your files exactly.
- **Tare** 2.3 t for 20 ft, 3.7 t for 40 ft.
- **Cargo class** OOG when any FR or Void is present, otherwise DG when the
  special/remark/item text names dangerous goods, otherwise NDG.
- **Peak TEU** is the highest on-board load at any point in the rotation — not the
  sum of bookings. A box loaded at Busan and discharged at Chennai frees its slot
  for the rest of the loop.
- **Cancellation is sticky.** If any source reports a row cancelled it stays
  cancelled, so a cancel list is never lost by a later upload.
- **BSA precedence.** Voyage numbers recycle year to year, so a BSA from a
  per-voyage booking sheet beats one from a schedule, which beats one from a
  historical ROB sheet.

### When two files describe the same booking

Every copy of a booking is gathered, then the group is resolved as a whole. Each
field takes its value from the best-ranked copy that actually has one, in this
order:

1. **Layout** — a per-voyage booking sheet (마감) outranks the consolidated
   register and the agency forecast, which outrank anything unclassified.
2. **File modification time** — between equals, the more recently saved file wins.
3. **File then sheet then row name** — a deterministic last resort, so the answer
   never depends on the order you dropped the files in.

Anything overridden along the way is listed in **Changes → Source disagreements**
and in the `DATA QUALITY` sheet, naming both sides. Nothing is resolved silently.

### Service is taken from the schedule, not the header

A vessel cannot be on two loops in one voyage. Where a sheet's `SVC Name` header
contradicts the port rotation in the schedule for that same voyage, the schedule
wins and the override is reported. Your current files contain five such mistyped
headers covering 80 bookings. The raw header value is preserved — only the
service used for grouping changes, and flagged rows show a ⚑ in the bookings
table.

## Known limits

- **Voyage numbers repeat across years.** A voyage is identified by vessel +
  voyage number only. If you load 2025 and 2026 files covering the same voyage
  number, their bookings merge. Keep a register per year, or clear before a new
  season.
- **A booking with no B/L** (`MT`, `FULL`, `T.B.N`, empty repositioning) has no
  document number to match on, so it is identified by voyage, lane, party, box mix
  and remark text, plus its position among identical-looking rows on the same
  sheet. Two consequences: editing the remark on such a row makes it look like a
  new row, and inserting one above others of the same shape shifts their identity.
- **DF economics are partial.** Margin is shown only where a voyage's DF base cost
  was found on its booking sheet. Excess-slot rates and surcharges are read into
  `DF CONTRACTS` for reference but are not applied to per-voyage margin.
- **Requires a current browser.** Reading `.xlsx` uses `DecompressionStream`
  (Edge/Chrome 80+, Firefox 113+). The page says so plainly if it is missing.
- **`.xls` (old format) is not supported** — only `.xlsx`.
- The register lives in browser local storage, roughly a 5 MB ceiling (about
  4,000–5,000 bookings). The page warns before you get there. Project files have
  no such limit.

---

## Working on the source

```
farmkogls-console/
  index.html          dev shell, loads src/* separately
  src/
    zip.js            ZIP read (native DecompressionStream) / write (stored)
    xlsx-read.js      .xlsx -> cell grids, incl. shared strings, dates, merges
    xlsx-write.js     styled multi-sheet .xlsx writer (builds new workbooks)
    xlsx-edit.js      surgical in-place editing (preserves someone else's file)
    normalize.js      ports, vessels, services, parties, TEU, WEEKNUM
    propagate.js      학습.xlsx -> FES BK FCST mapping and orchestration
    parse.js          layout recognisers -> canonical booking records
    merge.js          the register: keys, field-level merge, change log
    aggregate.js      rollups and the ROB projection
    export.js         the output workbook
    ui.js             application shell
    styles.css
  test.html           analysis pipeline, end to end over testdata/
  test-prop.html      in-place update, incl. idempotence on a second pass
  test-ui.html        real .click() interaction sweep — catches dead handlers
  testdata/           the sample workbooks used to build this
  server.py           dev server (static + a POST /save sink)
  build.py            inlines everything -> ../Farmkogls_Booking_Console.html
  docs/               Korean documentation (start at docs/00_읽는_순서.md)
```

`xlsx-write.js` and `xlsx-edit.js` are not redundant: the first builds a new
workbook from nothing, the second changes an existing one without rebuilding it.
Use the second whenever the deliverable is "their file, updated".

Rebuild the single file after any edit:

```bash
python farmkogls-console/build.py
```

Run the harness:

```bash
python farmkogls-console/server.py
```

then open <http://localhost:8777/test.html>.

`build.py` refuses to bundle a source file containing literal control
characters — they survive a direct `<script src>` load but not the text
round-trip, which once silently dropped a whole module.
