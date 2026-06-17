MVAR='SELECT CODE,NAME,SCHEDULE FROM MASTER A WHERE A.COMP_CODE=?G_COMPCODE AND A.SCHEDULE NOT IN '+;
     '(SELECT NO FROM SCHEDULE B WHERE A.COMP_CODE=B.COMP_CODE AND '+;
     'A.SCHEDULE=B.NO) ORDER BY 1'
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT * FROM X0 INTO CURSOR X1     
BROWSE TITLE 'MISSING SCHEDULE'
*     *
MVAR='SELECT CODE FROM LEDGER A WHERE A.COMP_CODE=?G_COMPCODE AND A.CODE NOT IN '+;
     '(SELECT CODE FROM MASTER B WHERE A.COMP_CODE=B.COMP_CODE AND A.CODE=B.CODE) '+;
     'GROUP BY A.CODE ORDER BY A.CODE'
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT * FROM X0 INTO CURSOR X1     
BROWSE TITLE 'MISSING CODE IN MASTER'
GO TOP
IF _TALLY<>0
 MVAR='SELECT A.CODE,A.VR_TYPE,A.VR_DATE,A.VR_NO,A.TYPE,A.DR_AMT,A.CR_AMT FROM LEDGER A '+;
      'WHERE A.COMP_CODE=?G_COMPCODE AND A.CODE NOT IN (SELECT CODE FROM MASTER B '+;
      'WHERE A.COMP_CODE=B.COMP_CODE AND A.CODE=B.CODE) ORDER BY 1,2,3,4'
 If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
 ENDIF
 SELECT * FROM X0 INTO CURSOR X1
 BROW
ENDI
*******************************************************************************************************
*
MVAR='SELECT CODE FROM MASTER WHERE COMP_CODE=?G_COMPCODE GROUP BY CODE HAVING COUNT(*)>1 ORDER BY 1'
*
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT * FROM X0 INTO CURSOR X1     
BROWSE TITLE 'DOUBLE CODE IN MASTER'
*********************************************************************************************************
MOP='OP'
MVAR='SELECT VR_TYPE,SUM(NVL(DR_AMT,0)-NVL(CR_AMT,0)) OPDIF FROM LEDGER WHERE COMP_CODE=?G_COMPCODE '+;
     'AND VR_TYPE=?MOP GROUP BY VR_TYPE'
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT VR_TYPE,CAST(NVL(OPDIF,0) AS NUMERIC(13,2)) OPDIF FROM X0 INTO CURSOR X1     
IF OPDIF<>0
 BROWSE TITLE 'OPENING DIFF MASTER'
ENDIF
************************************************************************************************************
MV1='OP'
MV2='SV'
MVAR='SELECT VR_TYPE,VR_dATE,VR_NO,TYPE,SUM(NVL(DR_AMT,0)) DR_AMT,SUM(NVL(CR_AMT,0)) CR_AMT,'+;
     'SUM(NVL(DR_AMT,0)-NVL(CR_AMT,0)) CLBAL FROM LEDGER WHERE COMP_CODE=?G_COMPCODE '+;
     'AND VR_TYPE<>?MV1 AND VR_TYPE<>?MV2 GROUP BY VR_TYPE,VR_dATE,VR_NO,TYPE HAVING '+;
     'SUM(NVL(DR_AMT,0)-NVL(CR_AMT,0))<>0 ORDER BY 1,2,3'
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT VR_TYPE,CAST(VR_dATE AS DATE) VR_DATE,VR_NO,TYPE,CAST(NVL(DR_AMT,0) AS NUMERIC(13,2)) DR_AMT,;
CAST(NVL(CR_AMT,0) AS NUMERIC(13,2)) CR_AMT,CAST(NVL(CLBAL,0) AS NUMERIC(13,2)) CLBAL FROM ;
X0 ORDER BY 1,2,3 INTO CURSOR X1
BROWSE TITLE 'DIFF.IN VOUCHERS'
****************************************************************************************************************          
MV1='SV'
MVAR="SELECT B_NO,SUM(CASE WHEN VR_TYPE=?MV1 THEN NVL(DR_AMT,0)-NVL(CR_AMT,0) ELSE 00000000000.00  END) BIK_AMT,"+;
     "SUM(CASE WHEN VR_TYPE<>?MV1 AND NVL(BIKRI,'X')='Y' THEN NVL(DR_AMT,0)-NVL(CR_AMT,0) ELSE 0000000000.00 END) SALE_AMT,"+;
     "SUM(CASE WHEN VR_TYPE=?MV1 THEN (NVL(DR_AMT,0)-NVL(CR_AMT,0)) ELSE 0000000000 END - "+;
     "CASE WHEN VR_TYPE<>?MV1 AND NVL(BIKRI,'X')='Y' THEN NVL(DR_AMT,0)-NVL(CR_AMT,0) ELSE 0000000000.00 END) DIF_AMT "+;
     "FROM LEDGER WHERE COMP_CODE=?G_COMPCODE AND NVL(B_NO,0)<>0 GROUP BY B_NO"
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT B_NO,CAST(NVL(BIK_AMT,0) AS NUMERIC(13,2)),;
CAST(NVL(SALE_AMT,0) AS NUMERIC(13,2)) SALE_AMT,;
CAST(NVL(DIF_AMT,0) AS NUMERIC(13,2)) DIF_AMT;
FROM X0 WHERE NVL(DIF_AMT,0)<>0 ORDER BY 1 INTO CURSOR X1
BROW     
*************
MVAR="SELECT A.VR_TYPE,A.VR_DATE,A.VR_NO,a.TYPE,a.CODE,a.DR_AMT,a.CR_AMT,a.b_no,a.bikri "+;
     "from ledger a,master b where a.comp_code=?g_compcode and "+;
     "a.comp_code=b.comp_code and a.code=b.code and b.schedule=12.10 "+;
     "and NVL(a.bikri,'N')='Y'"
If SQLExec(GNCONNHANDLE,Mvar,'X0') <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
SELECT VR_TYPE,CAST(VR_DATE AS DATE) VR_DATE,VR_NO,TYPE,;
CODE,NVL(DR_AMT,0000000000.00) DR_AMT,NVL(CR_AMT,0000000000.00) CR_AMT,;
NVL(B_NO,000000) B_NO,BIKRI FROM X0 ORDER BY CODE,B_NO ;
INTO CURSOR X1
BROWSE TITLE 'TRADING BIKRI'     

MESSAGEBOX('DONE')