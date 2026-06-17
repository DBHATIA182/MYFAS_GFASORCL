mvar='update MASTER SET PAN=SUBSTR(GST_NO,3,10) WHERE '+;
     'COMP_CODE=?G_COMPCODE AND PAN IS NULL AND GST_NO IS NOT NULL'
If SQLExec(GNCONNHANDLE,Mvar) <=0
			                  =Aerror(laArr)
			                  Messagebox(MVAR+' '+laArr(2))
ENDIF
MESSAGEBOX('DONE')
     