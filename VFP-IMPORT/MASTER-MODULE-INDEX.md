# GFASORCL Master Module — VFP reference index

Web app menu: **Master** module in `SRC/data/masterModuleConfig.js`.

| # | Web menu ID | Title | VFP command | Files in VFP-IMPORT |
|---|-------------|-------|-------------|---------------------|
| 1 | schedule-master | Schedule Master | DO FORM nschedule | nschedule.scx, nschedule.SCT — **Implemented** Slide 29 |
| 2 | account-master | A/c Master | (MASTER table) | **Implemented** — Slide 26 |
| 3 | item-category-master | Item Category Master | DO FORM CATMAST | catmast.scx, catmast.SCT · **Web slide 30** |
| 4 | item-group-master | Item Group Master | DO FORM CAT | cat.scx, cat.SCT — **Implemented** Slide 31 · copy in VFP-EXPORT |
| 5 | item-master | Item Master | DO FORM itemmast | ITEM-MASTER/itemmast.scx, itemmast.SCT — **Implemented** Slide 27 |
| 6 | user-master | User Master | DO FORM USER | user.SCX, user.SCT — **Implemented** Slide 32 |
| 7 | user-password | User Password | DO FORM PASSWORD | password.scx, password_sup.SCT — **Implemented** Slide 35 |
| 8 | bikri-exp | Bikri Exp | DO FORM BIKEXP | bikexp.scx, bikexp.SCT — **Implemented** Slide 36 |
| 9 | godown-rent-master | Godown Rent Master | DO GODRENT | godrent.prg — **Implemented** Slide 37 |
| 10 | godown-master | Godown Master | DO FORM GODOWN | godown.scx, godown.SCT, godown.prg — **Implemented** Slide 38 |
| 11 | cost-centre-master | Cost Centre Master | DO FORM COSTMAST | costmast.scx, costmast.SCT |
| 12 | customer-interest | Customer Interest | DO CUSTINT | custint.prg |
| 13 | holiday-master | Holiday Master | DO HOLIDAY | holiday.prg — **Implemented** Slide 41 |
| 14 | dane-master | Dane Master | DO DANE | dane.prg — **Implemented** Slide 42 |
| 15 | marka-master | Marka Master | DO FORM MARKA | marka.scx, marka.SCT — **web slide 43** |
| 16 | purchase-exp-master | Purchase Exp Master | DO FORM PUREXP | purexp.scx, purexp.SCT — **web slide 44** (PUREXP) |
| 17 | sale-bill-condition | Sale Bill Condition | DO SALECOND | salecond.prg — **web slide 45** (SALE_COND) |
| 18 | location-btype | Location Wise BType | DO LOC_B_TYPE | loc_b_type.prg — **web slide 46** (LOC_B_TYPE) |
| 19 | detail-master | Detail Master | DO FORM DETAIL | detail.scx, detail.SCT — **web slide 47** (DETAIL_MASTER) |
| 20 | gst-state-master | GST State Master | DO GST_STATE | gst_state.prg — **web slide 48** (GST_STATE) |

## Item Master field mapping (GFASORCL)

- **Category** → `ITEM_GRP` (`GRP_CODE` / `GRP_NAME`) — VFP CAT form is item group table in some installs; web uses ITEM_GRP for category picker.
- **Item Group** → `CATMAST` (`CAT_CODE` / `CAT_NAME`).

## Adding a new VFP master

1. Copy `.scx` / `.SCT` / `.prg` into `VFP-IMPORT`.
2. Add entry to `SRC/data/masterModuleConfig.js`.
3. Implement API + slide; set `implemented: true` and `slide: <n>`.
