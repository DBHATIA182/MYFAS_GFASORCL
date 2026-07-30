# GFASORCL — Other Reports module (VFP9)

Top-level menu pad: **Other Reports** (`ALT+O`) — popup `otherreports`.

| Code | Menu label | VFP command (via `other_rpt.prg`) | Form | PRG / report |
|------|------------|-----------------------------------|------|--------------|
| A | Labour Report | `DO OTHER_RPT WITH 'A'` | LABRPT | `prg\labour.prg` → LABRPT |
| B | Brokerage Report Date Wise | `DO OTHER_RPT WITH 'B'` | BROKRPT(4) | `prg\broker.prg` |
| C | Brokerage Report Item Wise | `DO OTHER_RPT WITH 'C'` | BROKRPT(1) | `prg\broker.prg` |
| D | Insurance Report | `DO OTHER_RPT WITH 'D'` | INS_RPT(1) | — |
| E | Brokerage Report Item Cat Wise | `DO OTHER_RPT WITH 'E'` | BROKRPT(2) | `prg\broker.prg` |
| F | Brokerage Summary Item Cat Wise | `DO OTHER_RPT WITH 'F'` | BROKRPT(3) | `prg\broker.prg` |
| G | Broker Summary | `DO OTHER_RPT WITH 'G'` | BROKRPT(5) | `prg\broker.prg` |
| H | Trading Exp. | `DO OTHER_RPT WITH 'H'` | TDGEXP | — |
| I | Broker Ledger | `DO OTHER_RPT WITH 'I'` | BROKLEG | — |
| J | Broker Trial | `DO OTHER_RPT WITH 'J'` | BROKTRL | — |
| K | Paploo Report | `DO OTHER_RPT WITH 'K'` | PAPLOO | — |
| L | Brokerage Report Purchase | `DO OTHER_RPT WITH 'L'` | BROKRPT(6) | `prg\broker.prg` |
| M | Voucher List Adv.Payment Revd. | `DO OTHER_RPT WITH 'M'` | STD('H') | — |
| N | Chant Format 1 | `DO OTHER_RPT WITH 'N'` | CHANT(1) | — |
| O | Chant Format 2 | `DO OTHER_RPT WITH 'O'` | CHANT(2) | — |
| P | Chant Format 3 | `DO OTHER_RPT WITH 'P'` | CHANT(3) | — |
| Q | Chant Summary | `DO OTHER_RPT WITH 'Q'` | CHANT(4) | — |
| R | Broker Wise Scheme | `DO OTHER_RPT WITH 'R'` | BROKRPT1(1) | — |
| S | Broker Wise Dalali Less Freight | `DO OTHER_RPT WITH 'S'` | BROKRPT(7) | `prg\broker.prg` |
| T | Freight Party Ledger | `DO OTHER_RPT WITH 'T'` | CLEGER(11) | — |
| U | Indent Party Ledger | `DO OTHER_RPT WITH 'U'` | CLEGER(10) | — |
| V | Month wise Purchase/OutStanding | `DO OTHER_RPT WITH 'V'` | TOTOUT(3) | — |
| W | Month Wise Sale/OutStanding | `DO OTHER_RPT WITH 'W'` | TOTOUT(2) | — |
| X | Ledger Dr/Cr Date | `DO OTHER_RPT WITH 'X'` | MYLEGER(1) | — |
| Y | Bill Wise Dalali Report Excel | `DO OTHER_RPT WITH 'Y'` | BROKRPT(9) | `prg\broker.prg` |
| Z | Combind Report Sale/Purchase | `DO OTHER_RPT WITH 'Z'` | COMBIND_REPORT(1) | — |

## Files on disk

| Path | Purpose |
|------|---------|
| `e:\gfasorcl\menu\BW_MENU.MPR` | Live menu (pad + popup updated) |
| `e:\gfasorcl\menu\bw_menu.mnx` | Menu table — copy from `VFP-IMPORT`, edit in Menu Designer |
| `e:\gfasorcl\menu\bw_menu.mnt` | Menu memo — pair with `.mnx` |
| `e:\gfasorcl\prg\other_rpt.prg` | Central router for all 26 reports |
| `e:\gfasorcl\prg\rebuild_bw_menu.prg` | `GENMENU` → regenerate `.MPR` from `.mnx` |
| `e:\gfasorcl\prg\build_otherrpt_forms.prg` | One-time shell forms in `forms\` |
| `e:\gfasorcl\forms\` | Parameter forms (LABRPT, BROKRPT, … existing app forms) |
| `e:\gfasorcl\reports\` | FRX report layouts where used |

## Setup in VFP9

1. Copy `VFP-IMPORT\bw_menu.mnx` and `bw_menu.mnt` → `e:\gfasorcl\menu\` if not present.
2. Open `bw_menu.mnx` in **Menu Designer** → rename pad **Others** to **Other Reports** → save.
3. `DO e:\gfasorcl\prg\rebuild_bw_menu.prg` (or use the updated `BW_MENU.MPR` directly).
4. `DO e:\gfasorcl\prg\build_otherrpt_forms.prg` to create `otherrpt.scx` / `otherrpt_parms.scx`.
5. Ensure `SET PROCEDURE TO e:\gfasorcl\prg\other_rpt.prg ADDITIVE` in startup (or menu calls `DO other_rpt` with full path).

## Web app (APPTEST)

- Menu module id: `other-reports` in `SRC/data/reportMenuConfig.js`
- Config: `SRC/data/otherReportsModuleConfig.js` (26 items, VFP paths under `e:\gfasorcl`)
- Placeholder slide: **90** (`Slide90OtherReportsPlaceholder.jsx`)
- Help: `other-reports-module` in `SRC/data/reportHelpContent.js`

## Notes

- The pad label changed from **Others** to **Other Reports**; shortcut remains `ALT+O`.
- Existing report forms (`LABRPT`, `BROKRPT`, etc.) are unchanged; the router delegates to them.
- Labour and brokerage data logic lives in `prg\labour.prg` and `prg\broker.prg`.
