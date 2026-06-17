*-------------------------------
* ORACLE FUNCTION EXECUTION PRG
*-------------------------------

CLOSE DATABASE ALL

DECLARE INTEGER ShellExecute IN shell32.dll ;
INTEGER hndWin, STRING cAction, STRING cFileName, ;
STRING cParams, STRING cDir, INTEGER nShowWin

cAction   = "open"
cFileName = "SQLPLUS"
cDir      = ""

*-------------------------------
* GET COMPANY UID
*-------------------------------

TNAME = G_MAIN_DATABASE + '.COMPDET'
MVAR  = "SELECT COMP_UID FROM " + TNAME + " GROUP BY COMP_UID"

IF SQLExec(GNCONNHANDLE,MVAR,'X0') <= 0
    =AERROR(laErr)
    MESSAGEBOX(MVAR + " " + laErr(2))
    RETURN
ENDIF

SELECT COMP_UID FROM X0 INTO CURSOR COMPX1

*========================================
* 1 RUN ORAFUN
*========================================

SELECT COMPX1
GO TOP

MDIRNO = "\" + DIRPATH + "\ORAFUN.TXT"

DO WHILE !EOF()

    MCID = ALLTRIM(COMP_UID)
    cParams = "-S " + MCID + "/" + MCID + "@XE @" + MDIRNO

    ShellExecute(0,cAction,cFileName,cParams,cDir,0)

    SKIP
ENDDO


*========================================
* 2 RUN TAKAJAFUN
*========================================

SELECT COMPX1
GO TOP

MDIRNO = "\" + DIRPATH + "\TAKAJAFUN.TXT"

DO WHILE !EOF()

    MCID = ALLTRIM(COMP_UID)
    cParams = "-S " + MCID + "/" + MCID + "@XE @" + MDIRNO

    ShellExecute(0,cAction,cFileName,cParams,cDir,0)

    SKIP
ENDDO


*========================================
* DROP VIEW
*========================================

MVAR='DROP VIEW TAKAJA'

IF SQLExec(GNCONNHANDLE,MVAR) <=0
    =AERROR(laErr)
ENDIF


*========================================
* CREATE VIEW
*========================================

MVAR = ;
"CREATE VIEW TAKAJA AS "+;
"SELECT A.COMP_CODE,A.BILL_DATE,A.BILL_NO,A.B_TYPE,A.CODE,"+;
"MAX(F.NAME) NAME,MAX(F.CITY) CITY,"+;
"SUM(NVL(QNTY,0)) QNTY,"+;
"SUM(NVL(WEIGHT,0)) WEIGHT,"+;
"SUM(NVL(DR_AMT,0)) DR_AMT,"+;
"SUM(NVL(CR_AMT,0)) CR_AMT,"+;
"SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) BILL_AMT,"+;
"MAX(A.BK_CODE) BK_CODE,"+;
"MAX(G.NAME) B_NAME,"+;
"MAX(A.VR_TYPE) VR_TYPE,"+;
"MAX((SELECT MAX(NVL(DAYS,0)) FROM BILLS B WHERE "+;
"A.COMP_CODE=B.COMP_CODE AND A.CODE=B.CODE AND "+;
"A.BILL_DATE=B.BILL_DATE AND A.BILL_NO=B.BILL_NO "+;
"AND A.B_TYPE=B.B_TYPE AND B.VR_TYPE='SL')) N_DAYS,"+;
"MAX((SELECT MAX(V_DATE) FROM BILLS C WHERE "+;
"A.COMP_CODE=C.COMP_CODE AND A.CODE=C.CODE AND "+;
"A.BILL_DATE=C.BILL_DATE AND A.BILL_NO=C.BILL_NO "+;
"AND A.B_TYPE=C.B_TYPE AND C.VR_TYPE='SL')) N_V_DATE,"+;
"MAX((SELECT MAX(DAMI) FROM BILLS D WHERE "+;
"A.COMP_CODE=D.COMP_CODE AND A.CODE=D.CODE AND "+;
"A.BILL_DATE=D.BILL_DATE AND A.BILL_NO=D.BILL_NO "+;
"AND A.B_TYPE=D.B_TYPE AND D.VR_TYPE='SL')) N_DAMI,"+;
"MAX((SELECT MAX(ITEM_CODE) FROM BILLS E WHERE "+;
"A.COMP_CODE=E.COMP_CODE AND A.CODE=E.CODE AND "+;
"A.BILL_DATE=E.BILL_DATE AND A.BILL_NO=E.BILL_NO "+;
"AND A.B_TYPE=E.B_TYPE AND E.VR_TYPE='SL')) N_ITEM_CODE "+;
"FROM BILLS A,MASTER F,MASTER G "+;
"WHERE SUBSTR(A.CODE,1,1)='C' "+;
"AND (A.COMP_CODE=F.COMP_CODE AND A.CODE=F.CODE) "+;
"AND (A.COMP_CODE=G.COMP_CODE(+) AND A.BK_CODE=G.CODE(+)) "+;
"GROUP BY A.COMP_CODE,A.BILL_DATE,A.BILL_NO,A.B_TYPE,A.CODE"

IF SQLExec(GNCONNHANDLE,MVAR) <=0
    =AERROR(laErr)
    MESSAGEBOX(laErr(2))
ENDIF


*========================================
* DROP INDEX
*========================================

DIMENSION arrDrop[7]

arrDrop[1]='DROP INDEX IND_BILLS'
arrDrop[2]='DROP INDEX IND_BILLS1'
arrDrop[3]='DROP INDEX IND_AUDIT_LEDGER'
arrDrop[4]='DROP INDEX IND_AUDIT_LOTSTOCK'
arrDrop[5]='DROP INDEX IND_LEDGER'
arrDrop[6]='DROP INDEX IND_LEDGER1'
arrDrop[7]='DROP INDEX IND_LOTSTOCK'

FOR i=1 TO 7

    IF SQLExec(GNCONNHANDLE,arrDrop[i]) <=0
        =AERROR(laErr)
    ENDIF

ENDFOR


*========================================
* CREATE INDEX
*========================================

DIMENSION arrCreate[7]

arrCreate[1]='CREATE INDEX IND_BILLS ON BILLS(COMP_CODE,BK_CODE,CODE,BILL_DATE,BILL_NO,B_TYPE,V_DATE,CR_AMT)'
arrCreate[2]='CREATE INDEX IND_BILLS1 ON BILLS(COMP_CODE,CODE,BILL_DATE,BILL_NO,B_TYPE,V_DATE,CR_AMT)'
arrCreate[3]='CREATE INDEX IND_AUDIT_LEDGER ON AUDIT_LEDGER(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)'
arrCreate[4]='CREATE INDEX IND_AUDIT_LOTSTOCK ON AUDIT_LOTSTOCK(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)'
arrCreate[5]='CREATE INDEX IND_LEDGER ON LEDGER(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)'
arrCreate[6]='CREATE INDEX IND_LEDGER1 ON LEDGER(COMP_CODE,CODE,VR_DATE,VR_NO,VR_TYPE,TYPE)'
arrCreate[7]='CREATE INDEX IND_LOTSTOCK ON LOTSTOCK(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)'

FOR i=1 TO 7

    IF SQLExec(GNCONNHANDLE,arrCreate[i]) <=0
        =AERROR(laErr)
    ENDIF

ENDFOR


*========================================
* RUN SORAFUN
*========================================

SELECT COMPX1
GO TOP

MDIRNO = "\" + DIRPATH + "\SORAFUN.TXT"

DO WHILE !EOF()

    MCID = ALLTRIM(COMP_UID)
    cParams = "-S " + MCID + "/" + MCID + "@XE @" + MDIRNO

    ShellExecute(0,cAction,cFileName,cParams,cDir,0)

    SKIP
ENDDO

MESSAGEBOX("PROCESS COMPLETED")