/** VFP DO FORM default + default2 — DEFVALUE per COMP_CODE (year schema). */

export const DEFAULT_SETTING_TABS = [
  {
    "id": "general",
    "label": "General & Codes"
  },
  {
    "id": "purchase",
    "label": "Purchase"
  },
  {
    "id": "sale",
    "label": "Sale & Bikri"
  },
  {
    "id": "printing",
    "label": "Printing"
  },
  {
    "id": "voucher",
    "label": "Voucher & Receipt"
  },
  {
    "id": "interest",
    "label": "Interest"
  },
  {
    "id": "gst",
    "label": "GST / TCS / TDS"
  },
  {
    "id": "export",
    "label": "Export"
  },
  {
    "id": "system",
    "label": "Folders & System"
  }
];

/** @type {Array<{ key: string, label: string, tab: string, type?: string, maxLen?: number, source?: string }>} */
export const DEFAULT_SETTING_FIELD_SPECS = [
  {
    "key": "DALALI_CODE",
    "label": "Dalali Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "ARHAT_TYPE",
    "label": "Arhat Type 1/2",
    "tab": "general",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BROK_CHK",
    "label": "Broker Check (Y/N)",
    "tab": "general",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "PUR_EXP_TYPE",
    "label": "Pur.Exp.Type 1/2",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "RECPT_PRINTER",
    "label": "Receipt Printing (I/D)",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "CASH_SALE_CODE",
    "label": "Cash Sale Code",
    "tab": "voucher",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "SELF_DALAL_CODE",
    "label": "Self Dalal Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "LOT_TYPE",
    "label": "Lot Type",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BIKRI_ROUND_OFF",
    "label": "Bikri Round Off (Y/N)",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "BIKRI_ROUND_OFF_CODE",
    "label": "Bikri Round Off Code",
    "tab": "sale",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "TRF_PRG",
    "label": "Transfer Program",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "FTP_DIR",
    "label": "ftp Update Dir",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "I_DAYS",
    "label": "Int.Days (alt)",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "FTP_DATADIR",
    "label": "ftp Upload data Dir",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "BILL_SLOGAN",
    "label": "Bill Slogan",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "WGT_K_Q",
    "label": "Weight In (Q/K/X)",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BACK_FOLDER",
    "label": "Backup Folder",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "PDOLLAR_RATE",
    "label": "Pur.$ Rate (Y/N)",
    "tab": "system",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "EXP_CAT",
    "label": "Exp Cat",
    "tab": "system",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "B_HEADER",
    "label": "Bill Header",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BILL_RPT",
    "label": "Sale Bill Printing Report",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "NEG_STOCK",
    "label": "Negative Stock (Y/N)",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "COMM_CODE",
    "label": "Commission Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "RPT_PRN",
    "label": "Receipt/Voucher Printing Option",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "LAB_CODE",
    "label": "Labour Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "FGT_CODE",
    "label": "Freight Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "PKG_FOLDER",
    "label": "Pkg.Folder",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "BROK_TRF",
    "label": "Broker Trf",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "VOU_DET",
    "label": "Repeat Detail In Voucher",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PUR_HLP",
    "label": "Purchase Help",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "RECEIPT_PROG",
    "label": "Receipt Printing Prog.",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "AMT_REPEAT",
    "label": "Repeat Amount In Voucher",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BIK_CHK",
    "label": "Bikri Check In Sale Y/N",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DEF_PIC",
    "label": "Default Picture For Company",
    "tab": "printing",
    "type": "gfasFile",
    "maxLen": 200,
    "browseStart": "LOGO",
    "source": "default"
  },
  {
    "key": "DANE_SCH_NO",
    "label": "Dane Schedule",
    "tab": "general",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "G_DAYS",
    "label": "Int.Days",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "G_EDAYS",
    "label": "Zero Dami Grace Days",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PUR_STK_TRF",
    "label": "Purchase Stock Transfer A/M",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_BILL_CHK",
    "label": "Sale Bill Previous Bill Check",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_ORDER_TYPE",
    "label": "Order (C)/(B)",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "ORDER_QW",
    "label": "Order (Q)/(W)",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "CODE_YN",
    "label": "Code Y/N",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "B_CODE_IN_VOU",
    "label": "Broker Code In Voucher",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "CHQ_PNT",
    "label": "Chq Pnt",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "GW_IN_PUR",
    "label": "Pur.$ Rate (Y/N)",
    "tab": "purchase",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALE_WGT",
    "label": "Sale (G)ross/(N)et Weight",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "RECEIPT_DEL_CHK",
    "label": "R D Check",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "PUR_IN_BIKRI",
    "label": "Purchase In Bikri (Y/N)",
    "tab": "purchase",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "CD_LESS",
    "label": "CD Less",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "BIKRI_POST",
    "label": "Bikri Posting Avg/Bik.Date A/B",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BOMBAY_DHARA",
    "label": "Bombay Dhara Days 360/365",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DCH_LINK",
    "label": "Disp.Chln Link In Sale",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DCH_CB",
    "label": "Disp.Chln CB",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PUR_ORDER_TYPE",
    "label": "Pur.Order (S)/(B)",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DIS_CAL",
    "label": "Calculate Dis.In Sale",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "DELV_CODE_YN",
    "label": "Delivery Code In Sale",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "PUR_CAL",
    "label": "Purchase Cal (G/N)",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BILL_ADJ_Y_M",
    "label": "Bill Adj Y/M",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_SMS",
    "label": "Sale SMS",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "PND_BILLS",
    "label": "Pending Bills",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "AVDT_CAL",
    "label": "Avdt Cal",
    "tab": "interest",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "CD_IN_VOU",
    "label": "Less Cd In Receipts",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "CD_CODE",
    "label": "CD Code",
    "tab": "voucher",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "PUR_EXP",
    "label": "Pur Exp",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PRINT_HEAD",
    "label": "Chq.Printing",
    "tab": "printing",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "VOU_INT_SHOW",
    "label": "Vou Int Show",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BIKRI_PNT",
    "label": "Bikri Printing Report",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PUR_WGT",
    "label": "PURCHASE Gross Wgt.Y/N",
    "tab": "purchase",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "CASH_SALE_TRF",
    "label": "Cash Sale Trf",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "GET_MRP",
    "label": "Get MRP",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALE_ROUND_OFF",
    "label": "Sale Round Off",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALE_STOCK_DATE_CHK",
    "label": "Sale Stock Date Chk",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "RECEIPT_COUNTER_NO",
    "label": "Receipt Counter No",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "VOU_EDIT_AFTER_BIKRI",
    "label": "Vou Edit After Bikri",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "LBACK_FOLDER",
    "label": "Lan Backup Folder",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "LPKG_FOLDER",
    "label": "Lan Pkg.Folder",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "R_D_C",
    "label": "R D C",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_WGT_TYPE",
    "label": "Sale Wgt Type",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SELF_SMS",
    "label": "Self SMS",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALE_BILL_MARKA_TOT",
    "label": "Sale Bill Marka Tot",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "OTH_CD1",
    "label": "Sale Oth.Cd1",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "OTH_CD2",
    "label": "Sale Oth.Cd2",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "OTH_CD3",
    "label": "Sale Oth.Cd3",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "OTH_CD4",
    "label": "Sale Oth.Cd4",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "OTH_CD5",
    "label": "Sale Oth.Cd5",
    "tab": "voucher",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BTYPE_LOCK",
    "label": "BType Lock",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALE_BILL_EMAIL_RPT",
    "label": "Sale Bill Email Rpt",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "CGST_CODE",
    "label": "CGST CODE",
    "tab": "gst",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "SGST_CODE",
    "label": "SGST CODE",
    "tab": "gst",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "IGST_CODE",
    "label": "IGST CODE",
    "tab": "gst",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "SALEPNT_GST",
    "label": "Sale Bill Gst Printing Name",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALEPNT_GST_BOS",
    "label": "Sale Bill Gst BOS",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "MRP_CAL_RATE",
    "label": "MRP Cal Rate",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "BARD_CODE",
    "label": "Bardana Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "KIRANA_EXP",
    "label": "Kirana Exp",
    "tab": "general",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "INS_CODE",
    "label": "Ins.Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "OTH_CODE",
    "label": "Oth.Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "SALE_BILL_EMAIL_BOS",
    "label": "Sale Bill Email BOS",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "BARD_STOCK",
    "label": "Bard Stock",
    "tab": "purchase",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "DANE_LESS_PAPLOO",
    "label": "Dane Less Paploo",
    "tab": "general",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "PO_MUST_YN",
    "label": "Po Must In Purchase",
    "tab": "purchase",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SO_MUST_YN",
    "label": "So Must YN",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "CUST_LEG_PL",
    "label": "Cust Leg Pl",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_LOGO",
    "label": "Sale Bill Logo (path)",
    "tab": "printing",
    "type": "gfasFile",
    "maxLen": 200,
    "browseStart": "LOGO",
    "source": "default"
  },
  {
    "key": "INDENT_YN",
    "label": "Indent YN",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "LOT_AUTO_MANUAL",
    "label": "Lot Auto Manual",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "INS_POLICY",
    "label": "Ins Policy",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "INS_POLICY_B_TYPE",
    "label": "Ins Policy B Type",
    "tab": "system",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PENDING_VOU_ZERO_YN",
    "label": "Pending Vou Zero YN",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "KANTA_FILE",
    "label": "Kanta File",
    "tab": "printing",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "STK_TDG_WGT_TYPE",
    "label": "Stock/Trading Gross/Net Weight",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "AUTO_INT_TRF",
    "label": "Auto Int Trf",
    "tab": "interest",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "INT_TRF_CODE",
    "label": "Int Trf Code",
    "tab": "interest",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "SALE_BILL_INIT",
    "label": "Sale Bill Initial",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_DIS_G_D",
    "label": "Sale Dis G/D",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DANE_TRF_TYPE",
    "label": "Dane Trf Type",
    "tab": "general",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DANE_CODE",
    "label": "Dane Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "L_DANE_CODE",
    "label": "Less Dane Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "L_QC_CODE",
    "label": "Less QC Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "L_CD_CODE",
    "label": "Less CD Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "L_CH_CODE",
    "label": "Less CH Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "LD_CODE",
    "label": "LD Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "PURCHASE_FORM",
    "label": "Purchase Form",
    "tab": "purchase",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "SALE_FORM",
    "label": "Sale Form",
    "tab": "sale",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "DUE_DATE_IN_BILL_PRINTING",
    "label": "Due Date In Sale Bill Printing",
    "tab": "printing",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DR_PAPLOO_IN_TDG_CODE",
    "label": "Dr Paploo In Tdg Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "DR_PAPLOO_CODE",
    "label": "Dr Paploo Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "TCS_CODE",
    "label": "TCS Code Pur.",
    "tab": "gst",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "SIGNATURE_FILE",
    "label": "Signature File (path)",
    "tab": "printing",
    "type": "gfasFile",
    "maxLen": 200,
    "browseStart": "LOGO",
    "source": "default"
  },
  {
    "key": "BIKRI_HEADER",
    "label": "Print Bikri Header",
    "tab": "printing",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "PBROK_TRF",
    "label": "P Brok Trf",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "TCS_PER",
    "label": "TCS %",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "TCS_PER2",
    "label": "TCS % 2",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "TCS_S_DATE",
    "label": "TCS Starting Date",
    "tab": "gst",
    "type": "date",
    "maxLen": 10,
    "source": "default"
  },
  {
    "key": "TCS_ON_AMT",
    "label": "TCS On Amount",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "TCS_BASIC_NET",
    "label": "TCS Basic Net",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "TCS_CODE_P",
    "label": "TCS Code Sale",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "SALE_TAXABLE_EXP",
    "label": "Sale Taxable Exp In Trading A/C",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PUR_EXP_MINUS_D_C",
    "label": "Pur.Exp. Minus (D/C)",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "AUDIT_TRAIL",
    "label": "Audit Trail (Y/N)",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "NTDS_PER",
    "label": "TDS % ON PURCHASE",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "NTDS_CODE",
    "label": "TDS CODE ON PURCHASE",
    "tab": "gst",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "NTDS_NATURE",
    "label": "TDS ON PURCHASE NATURE",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "IBL_YN",
    "label": "IBL TRANSATIONS",
    "tab": "system",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "TDS_CODE_SALE",
    "label": "TDS Code On Sale",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "TDS_PRINT_IN_SALE_BILL",
    "label": "Print Tds in Sale",
    "tab": "gst",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "TDS_ROUND_OFF_VALUE",
    "label": "TDS Round Off Value",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "EXPORT_STOCK_TYPE",
    "label": "Export Stock Type",
    "tab": "export",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "PRINT_MARKA",
    "label": "Print Marka In Sale",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "TDG_DANE_TRF",
    "label": "Tdg Dane Trf To Ledger",
    "tab": "general",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "GST_TAX_RATE_DATE",
    "label": "Gst Tax Date",
    "tab": "gst",
    "type": "date",
    "maxLen": 10,
    "source": "default"
  },
  {
    "key": "EXPORT_INV_HEAD",
    "label": "Export Inv.Head",
    "tab": "printing",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "HSN_CODE_GREATER_THEN",
    "label": "HSN Code Greater Then",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "HSN_CODE_LESS_THEN",
    "label": "HSN Code Less Then",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "HSN_RATE_GREATER_THEN",
    "label": "HSN Rate Greater Then",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "HSN_RATE_LESS_THEN",
    "label": "HSN Rate Less Then",
    "tab": "gst",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "DISP_CHALLAN_RATE_CHK",
    "label": "Disp.Challan Rate Chk",
    "tab": "voucher",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SO_RATE_CHK",
    "label": "S.Order Rate Check",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "GOD_PRINT_IN_SALE",
    "label": "God Print In Sale",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "PRINT_UPI_QR_CODE",
    "label": "Print Upi Id Or Code",
    "tab": "printing",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SALE_LOGO2",
    "label": "Sale Bill Logo 2 (path)",
    "tab": "printing",
    "type": "gfasFile",
    "maxLen": 200,
    "browseStart": "LOGO",
    "source": "default"
  },
  {
    "key": "GP_NO_YN",
    "label": "GP No YN",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "SELF_DALAL_DR_DALALI_CODE",
    "label": "Self Dalal Dr Dalali Code",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default"
  },
  {
    "key": "BACK2_FOLDER",
    "label": "Back2Fold",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default"
  },
  {
    "key": "E_D_IN_C_B",
    "label": "Extran Dalali Dr (C/B)",
    "tab": "export",
    "type": "text",
    "maxLen": 40,
    "source": "default"
  },
  {
    "key": "EINV_TAXABLE_BOTH",
    "label": "Einv T/B",
    "tab": "gst",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "NEG_STOCK_QW",
    "label": "Negative Stock Q/W",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default"
  },
  {
    "key": "ARH_CODE",
    "label": "Commission Code (default2)",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "DHARMADA_CODE",
    "label": "Bardana Code (default2)",
    "tab": "general",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "BANK_QR_LOGO",
    "label": "Bank Qr Logo",
    "tab": "printing",
    "type": "gfasFile",
    "maxLen": 200,
    "browseStart": "LOGO",
    "source": "default2"
  },
  {
    "key": "BROK_PAID_CODE",
    "label": "Purchase Brok Paid Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "MANDI_EXP_CODE",
    "label": "Purchase Mandi Exp Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "LABOUR_EXP_CODE",
    "label": "Purchase Labour Exp Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "BARDANA_EXP_CODE",
    "label": "Purchase Bardana Exp Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "FREIGHT_PAID_CODE",
    "label": "Purchase Freight Paid Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "CD_AMOUNT_CODE",
    "label": "Purchase CD Amount Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "DHARAM_KANTA_CODE",
    "label": "Purchase DharmKanta Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "PUR_DEBIT_NOTE_EXP_TYPE",
    "label": "Purchase Debit Note Exp type 1/2",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "TULWAI_CODE",
    "label": "Purchase Tulwai Code",
    "tab": "purchase",
    "type": "code",
    "maxLen": 6,
    "source": "default2"
  },
  {
    "key": "ROUND_OFF_CODE_PUR",
    "label": "Purchase Round off Code",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "BIKRI_PURCHASE_REMARK",
    "label": "Bikri Purchase Remark (Y/N)",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default2"
  },
  {
    "key": "SAUDA_VALUE",
    "label": "Sale Bill (S)auda/(V)alue Date",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "GOOGLE_DRIVE",
    "label": "Google Drive",
    "tab": "system",
    "type": "path",
    "maxLen": 200,
    "source": "default2"
  },
  {
    "key": "LEGBALINBILL",
    "label": "Ledger Bal In Sale Bill (Y/N)",
    "tab": "sale",
    "type": "yn",
    "maxLen": 1,
    "source": "default2"
  },
  {
    "key": "PORDER_Q_W",
    "label": "Purchase Order (Q/W)",
    "tab": "purchase",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "BIKRI_INT_DCB",
    "label": "Bikri Interest (D/C/B)",
    "tab": "sale",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "LEDGER_REPORT_FORMAT",
    "label": "Ledger Report Format 1/2/3",
    "tab": "system",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "CUSTOMER_INT_CAL",
    "label": "Customer Int Cal (A/M/B)",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  },
  {
    "key": "BOMBAY_DHARA_YN",
    "label": "Bombay Dhara Enabled/Disabled",
    "tab": "interest",
    "type": "text",
    "maxLen": 40,
    "source": "default2"
  }
];

export const DEFAULT_SETTING_EDITABLE_KEYS = DEFAULT_SETTING_FIELD_SPECS.map((f) => f.key);

export function defaultSettingFieldsForTab(tabId) {
  return DEFAULT_SETTING_FIELD_SPECS.filter((f) => f.tab === tabId);
}