import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyCreateModal from '../components/MasterPartyCreateModal';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { MasterScreenToolbar } from '../components/GfasToolbar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function scheduleNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function schedLabel(row) {
  const no = row.NO ?? row.no ?? '';
  const nm = row.NAME ?? row.name ?? '';
  const noNum = Number(no);
  const noDisp = no === '' || no == null ? String(no) : Number.isFinite(noNum) ? noNum.toFixed(2) : String(no);
  return nm ? `${nm} (${noDisp})` : noDisp;
}

function mapAccountRow(r) {
  return {
    CODE: r.CODE ?? r.code,
    NAME: r.NAME ?? r.name,
    SCHEDULE: r.SCHEDULE ?? r.schedule ?? r.SCH_NO ?? r.sch_no,
    SCH_NAME: r.SCH_NAME ?? r.sch_name ?? '',
    ADD1: r.ADD1 ?? r.add1,
    ADD2: r.ADD2 ?? r.add2,
    ADD3: r.ADD3 ?? r.add3,
    CITY: r.CITY ?? r.city,
    GST_NO: r.GST_NO ?? r.gst_no,
    STATE_CODE: r.STATE_CODE ?? r.state_code,
    STATE: r.STATE ?? r.state,
    PAN: r.PAN ?? r.pan,
    TEL_NO_O: r.TEL_NO_O ?? r.tel_no_o,
    L_C: r.L_C ?? r.l_c,
  };
}

export default function Slide26AccountMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const accountDrillRanRef = useRef('');

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const sch = scheduleNum(scheduleFilter);
        if (sch) params.schedule = sch;
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(`${apiBase}/api/master-accounts`, { params, ...reqOpts });
        if (isStale()) return;
        setRows(Array.isArray(data) ? data.map(mapAccountRow) : []);
      } catch (e) {
        if (isStale()) return;
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setRows([]);
      } finally {
        if (!isStale()) setListLoading(false);
      }
    },
    [apiBase, compCode, compUid, scheduleFilter]
  );

  const { executeSearch, refreshList } = useDebouncedMasterSearch({
    enabled: !loading && !!perms?.canOpen,
    onSearch,
  });

  useEffect(() => {
    if (loading || !perms?.canOpen) return;
    executeSearch(searchQ, { immediate: true });
  }, [scheduleFilter, loading, perms?.canOpen, searchQ, executeSearch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [pRes, sRes] = await Promise.all([
          axios.get(`${apiBase}/api/master-party-user-permissions`, {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios
            .get(`${apiBase}/api/master-party-schedules`, {
              params: { comp_code: compCode, comp_uid: compUid },
              ...reqOpts,
            })
            .catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setPerms(pRes.data);
        setSchedules(sRes.data || []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    const d = formData.accountMasterDrilldown;
    if (!d?.code || loading || !perms?.canOpen) return;
    const runKey = String(d.at ?? d.code);
    if (accountDrillRanRef.current === runKey) return;

    const code = String(d.code).trim().toUpperCase();
    if (!code) return;
    accountDrillRanRef.current = runKey;

    setSearchQ(code);
    let cancelled = false;
    (async () => {
      setListLoading(true);
      try {
        const { data } = await axios.get(`${apiBase}/api/master-accounts`, {
          params: { comp_code: compCode, comp_uid: compUid, q: code },
          ...reqOpts,
        });
        if (cancelled) return;
        const mapped = Array.isArray(data) ? data.map(mapAccountRow) : [];
        setRows(mapped);
        const hit = mapped.find((r) => String(r.CODE).trim().toUpperCase() === code);
        if (hit) {
          setSelectedCode(String(hit.CODE));
          if (d.autoEdit !== false && perms?.canEdit) setEditRow(hit);
        } else {
          alert(`Account [${code}] not found in master list.`);
        }
      } catch (e) {
        if (!cancelled) alert(e?.response?.data?.error || e.message || 'Could not load account');
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formData.accountMasterDrilldown, loading, perms?.canOpen, perms?.canEdit, apiBase, compCode, compUid]);

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const scheduleLabelMap = useMemo(() => {
    const m = new Map();
    for (const s of schedules) {
      const no = String(s.NO ?? s.no ?? '');
      if (no) m.set(no, schedLabel(s));
    }
    return m;
  }, [schedules]);

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select an account from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.CODE;
    const label = `[${code}] ${selectedRow.NAME || ''}`;
    if (!window.confirm(`Delete account ${label} from MASTER?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(`${apiBase}/api/master-party`, {
        data: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          code,
        },
        ...reqOpts,
      });
      setSelectedCode('');
      refreshList();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = () => refreshList();

  const handleListBySchedule = async () => {
    const typed = window.prompt(
      'Enter specific schedule (decimal only), e.g. 1.10, 8.10, 9.10.\nLeave blank for complete list.',
      String(scheduleFilter || '')
    );
    if (typed == null) return;
    const trimmed = String(typed || '').trim();
    const sch = trimmed ? scheduleNum(trimmed) : 0;
    if (trimmed && (!sch || Math.abs(sch - Math.trunc(sch)) < 1e-9)) {
      alert('Select valid schedule like 1.10, 8.10, 9.10');
      return;
    }
    setScheduleFilter(trimmed ? String(sch) : '');
    setListLoading(true);
    setErr('');
    setSelectedCode('');
    try {
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        if (trimmed) params.schedule = sch;
        const { data } = await axios.get(`${apiBase}/api/master-accounts-list`, { params, ...reqOpts });
        setRows(Array.isArray(data) ? data.map(mapAccountRow) : []);
      } catch (e) {
        // Backward-compatible fallback while API server is not restarted yet.
        if (e?.response?.status === 404) {
          const params = { comp_code: compCode, comp_uid: compUid };
          if (trimmed) params.schedule = sch;
          const { data } = await axios.get(`${apiBase}/api/master-accounts`, { params, ...reqOpts });
          setRows(Array.isArray(data) ? data.map(mapAccountRow) : []);
        } else {
          throw e;
        }
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'List failed';
      setErr(msg);
      setRows([]);
      alert(msg);
    } finally {
      setListLoading(false);
    }
  };

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const exportRows = rows.map((r) => ({
      SCH_NO: Number(scheduleNum(r.SCHEDULE)).toFixed(2),
      SCH_NAME: r.SCH_NAME || '',
      CODE: r.CODE || '',
      NAME: r.NAME || '',
      ADD1: r.ADD1 || '',
      ADD2: r.ADD2 || '',
      ADD3: r.ADD3 || '',
      CITY: r.CITY || '',
      GST_NO: r.GST_NO || '',
      PAN: r.PAN || '',
      L_C: r.L_C || '',
    }));
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const schTag = scheduleFilter ? `Sch_${Number(scheduleNum(scheduleFilter)).toFixed(2)}` : 'AllSchedules';
    downloadExcelRows(exportRows, 'AcMaster', `${compName}_AcMaster_${schTag}`);
  };

  const buildPdfMeta = () => {
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const fy = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—';
    const schLabel = scheduleFilter ? Number(scheduleNum(scheduleFilter)).toFixed(2) : 'All schedules';
    return {
      companyName: compName,
      year: fy,
      reportTitle: 'A/c Master List',
      period: `Schedule: ${schLabel}`,
      endDate: `Schedule: ${schLabel}`,
    };
  };

  const buildExportRowsWithScheduleName = () =>
    rows.map((r) => {
      const schNum = Number(scheduleNum(r.SCHEDULE));
      const schKey = Number.isFinite(schNum) ? String(schNum) : '';
      const fromMap = schKey ? scheduleLabelMap.get(schKey) || '' : '';
      const guessedName = fromMap ? String(fromMap).replace(/\s*\([^)]*\)\s*$/, '').trim() : '';
      return {
        ...r,
        SCH_NO: Number.isFinite(schNum) ? schNum : r.SCHEDULE,
        SCH_NAME: String(r.SCH_NAME || guessedName || '').trim(),
      };
    });

  const handlePdf = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    generatePDF('account-master', buildExportRowsWithScheduleName(), buildPdfMeta()).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('No rows to share.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const schText = scheduleFilter ? `Schedule ${Number(scheduleNum(scheduleFilter)).toFixed(2)}` : 'All schedules';
    const shareText = [compName, 'A/c Master List', schText, `Rows: ${rows.length}`].join('\n');
    sharePdfWithWhatsApp('account-master', buildExportRowsWithScheduleName(), buildPdfMeta(), shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  const defaultScheduleForAdd = scheduleNum(scheduleFilter) || undefined;

  if (loading) {
    return (
      <div className="slide slide-26-account-master slide-26-account-master--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">A/c Master</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!perms?.canOpen) {
    return (
      <div className="slide slide-26-account-master">
        <h2 className="sale-bill-page__title">A/c Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F4).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-26-account-master account-master-screen">
      <div className="account-master-screen__chrome">
      <div className="account-master-screen__head">
        <div className="account-master-screen__title-row">
          <h2 className="sale-bill-page__title">A/c Master</h2>
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="account-master" />
        <MasterScreenToolbar
          onPrev={onPrev}
          onReset={onReset}
          onRefresh={handleRefresh}
          onList={() => void handleListBySchedule()}
          onExcel={handleExcel}
          onPdf={handlePdf}
          onWhatsApp={handleWhatsApp}
          perms={perms}
          onAdd={() => setAddOpen(true)}
          onEdit={() => setEditRow(selectedRow)}
          onDelete={() => void handleDelete()}
          listLoading={listLoading}
          hasRows={rows.length > 0}
          selectedRow={selectedRow}
          deleting={deleting}
          listDisabled={listLoading}
        />
      </div>

      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

      <div className="account-master-screen__filters">
        <label className="sale-bill-field account-master-filter">
          <span className="sale-bill-field__label">Schedule (decimal only)</span>
          <MasterPartyPickList
            options={[{ NO: '', no: '', NAME: 'All schedules', name: 'All schedules' }, ...schedules]}
            value={scheduleFilter}
            disabled={listLoading}
            title="Schedule filter"
            placeholder="All schedules (decimal)"
            filterPlaceholder="Search decimal schedule…"
            getValue={(s) => String(s.NO ?? s.no ?? '')}
            getLabel={(s) => {
              const no = s.NO ?? s.no ?? '';
              if (no === '' || no == null) return 'All schedules';
              return schedLabel(s);
            }}
            onChange={(val) => setScheduleFilter(val)}
          />
        </label>
        <label className="sale-bill-field account-master-filter account-master-filter--search">
          <span className="sale-bill-field__label">Search</span>
          <input
            className="form-input account-master-search-input"
            type="search"
            value={searchQ}
            placeholder="Code, name, or city (e.g. DAL ARHAR)…"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              const v = String(e.target.value ?? '').toUpperCase();
              setSearchQ(v);
              executeSearch(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                executeSearch(searchQ, { immediate: true });
              }
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary account-master-filter-btn"
          onClick={() => executeSearch(searchQ, { immediate: true })}
        >
          Find
        </button>
      </div>

      <div className="account-master-screen__list-wrap">
        <table className="account-master-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Sched</th>
              <th>City</th>
              <th>GST No.</th>
              <th>PAN</th>
              <th>L/C</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No accounts found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const code = String(r.CODE);
                const schKey = String(scheduleNum(r.SCHEDULE));
                const schLbl = r.SCH_NAME ? `${r.SCH_NAME} (${schKey})` : scheduleLabelMap.get(schKey) || schKey;
                const isSel = selectedCode === code;
                return (
                  <tr
                    key={code}
                    className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                    onClick={() => setSelectedCode(code)}
                    onDoubleClick={() => {
                      if (perms?.canEdit) setEditRow(r);
                    }}
                  >
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td title={schLbl}>{schKey}</td>
                    <td>{r.CITY}</td>
                    <td>{r.GST_NO}</td>
                    <td>{r.PAN}</td>
                    <td>{r.L_C}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="account-master-screen__hint">
        {rows.length} account{rows.length === 1 ? '' : 's'}
        {selectedRow ? ` · selected [${selectedRow.CODE}] ${selectedRow.NAME || ''}` : ''}
        {perms?.canEdit ? ' · double-click row to edit' : ''}
      </p>

      <MasterPartyCreateModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={defaultScheduleForAdd}
        lockSchedule={Boolean(defaultScheduleForAdd)}
        onCreated={() => {
          setAddOpen(false);
          refreshList();
        }}
      />

      <MasterPartyCreateModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        editRow={editRow}
        onUpdated={() => {
          setEditRow(null);
          refreshList();
        }}
      />
    </div>
  );
}
