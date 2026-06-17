import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ScheduleMasterFormModal from '../components/ScheduleMasterFormModal';
import SessionInfoLine from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { useDebouncedMasterSearch } from '../utils/useDebouncedMasterSearch';
import { GfasToolbar, GfasToolbarBtn, GfasToolbarDivider } from '../components/GfasToolbar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function formatSchedNo(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '').trim();
  return (Math.round(n * 100) / 100).toFixed(2);
}

function formatMainNo(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '').trim();
  return String(Math.trunc(n));
}

function isMainSchedule(no) {
  const n = Number(no);
  return Number.isFinite(n) && Math.abs(n - Math.trunc(n)) < 1e-6;
}

function displayScheduleNo(no) {
  return isMainSchedule(no) ? formatMainNo(no) : formatSchedNo(no);
}

function mapScheduleRow(r) {
  const no = r.NO ?? r.no;
  const isMain = isMainSchedule(no);
  return {
    NO: no,
    NAME: r.NAME ?? r.name,
    RANGE: r.RANGE ?? r.range,
    NORM_BAL: r.NORM_BAL ?? r.norm_bal,
    CORR_NO: r.CORR_NO ?? r.corr_no,
    isMain,
  };
}

function rowToExport(r) {
  return {
    SCHEDULE_NO: displayScheduleNo(r.NO),
    TYPE: r.isMain ? 'Main' : 'Sub',
    NAME: r.NAME || '',
    RANGE: r.isMain ? '' : r.RANGE || '',
    NORM_BAL: r.isMain ? '' : r.NORM_BAL || '',
    CORR_NO: !r.isMain && Number(r.CORR_NO) ? formatSchedNo(r.CORR_NO) : '',
  };
}

export default function Slide29ScheduleMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [allSchedules, setAllSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedNo, setSelectedNo] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState('main');
  const [editRow, setEditRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const onSearch = useCallback(
    async (q, { isStale }) => {
      if (!compCode || compUid == null) return;
      setListLoading(true);
      setErr('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid, view: 'all' };
        const trimmed = String(q ?? '').trim();
        if (trimmed) params.q = trimmed;
        const { data } = await axios.get(`${apiBase}/api/schedule-master-list`, { params, ...reqOpts });
        if (isStale()) return;
        const mapped = Array.isArray(data) ? data.map(mapScheduleRow) : [];
        setRows(mapped);
        setAllSchedules(mapped);
      } catch (e) {
        if (isStale()) return;
        setErr(e?.response?.data?.error || e.message || 'Load failed');
        setRows([]);
      } finally {
        if (!isStale()) setListLoading(false);
      }
    },
    [apiBase, compCode, compUid]
  );

  const { executeSearch, refreshList } = useDebouncedMasterSearch({
    enabled: !loading && !!perms?.canOpen,
    onSearch,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(`${apiBase}/api/schedule-master-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName]);

  const selectedRow = useMemo(
    () => rows.find((r) => formatSchedNo(r.NO) === formatSchedNo(selectedNo)) || null,
    [rows, selectedNo]
  );

  const parentForAddSub = useMemo(() => {
    if (!selectedRow?.isMain) return null;
    return { NO: selectedRow.NO, NAME: selectedRow.NAME };
  }, [selectedRow]);

  const openAddMain = () => {
    setAddKind('main');
    setAddOpen(true);
  };

  const openAddSub = () => {
    if (!parentForAddSub) {
      alert('Select a main schedule row (whole number) to add a sub-schedule under it.');
      return;
    }
    setAddKind('sub');
    setAddOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select a row from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const no = Number(selectedRow.NO);
    const label = `[${displayScheduleNo(no)}] ${selectedRow.NAME || ''}`;
    const msg = selectedRow.isMain
      ? `Delete main schedule ${label}?\n\nBlocked if accounts exist or sub-groups remain.`
      : `Delete sub-schedule ${label}?`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(`${apiBase}/api/schedule-master`, {
        data: { comp_code: compCode, comp_uid: compUid, user_name: userName, no },
        ...reqOpts,
      });
      setSelectedNo('');
      refreshList();
    } catch (e) {
      const errMsg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(errMsg);
      alert(errMsg);
    } finally {
      setDeleting(false);
    }
  };

  const buildPdfMeta = () => {
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const fy = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim() || '—';
    const q = String(searchQ).trim();
    return {
      companyName: compName,
      year: fy,
      reportTitle: 'Schedule Master',
      period: q ? `All schedules · Search: ${q}` : 'All schedules (main & sub, schedule order)',
      endDate: q ? `All schedules · Search: ${q}` : 'All schedules (main & sub, schedule order)',
      scheduleView: 'all',
    };
  };

  const buildPdfRows = () => rows.map(rowToExport);

  const handlePdf = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    generatePDF('schedule-master', buildPdfRows(), buildPdfMeta()).catch((e) => alert(String(e?.message || e)));
  };

  const handleWhatsApp = () => {
    if (!rows.length) {
      alert('No rows to share.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    const shareText = [compName, 'Schedule Master', `Rows: ${rows.length}`].join('\n');
    sharePdfWithWhatsApp('schedule-master', buildPdfRows(), buildPdfMeta(), shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  };

  const handleExcel = () => {
    if (!rows.length) {
      alert('No rows to export.');
      return;
    }
    const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
    downloadExcelRows(buildPdfRows(), 'Schedules', `${compName}_ScheduleMaster_All`);
  };

  if (loading) {
    return (
      <div className="slide slide-29-schedule-master slide-29-schedule-master--loading">
        <p>Loading Schedule Master…</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  if (!perms?.canOpen) {
    return (
      <div className="slide slide-29-schedule-master">
        <h2 className="sale-bill-page__title">Schedule Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F4).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-29-schedule-master account-master-screen schedule-master-screen">
      <div className="schedule-master-panel">
        <header className="schedule-master-panel__head">
          <h2 className="schedule-master-panel__title">Schedule master</h2>
          <SessionInfoLine
            formData={formData}
            userName={userName}
            helpReportId="schedule-master"
            className="schedule-master-panel__session"
          />
        </header>

        <div className="schedule-master-screen__toolbar-block">
          <GfasToolbar>
            <GfasToolbarBtn icon="back" label="Back" onClick={onPrev} />
            <GfasToolbarBtn icon="home" iconOnly title="Home" onClick={onReset} />
            <GfasToolbarBtn
              icon="refresh"
              iconOnly
              title={listLoading ? 'Loading…' : 'Refresh'}
              onClick={refreshList}
              disabled={listLoading}
            />
            <GfasToolbarDivider />
            <GfasToolbarBtn
              icon="excel"
              label="Excel"
              variant="secondary"
              onClick={handleExcel}
              disabled={!rows.length || listLoading}
            />
            <GfasToolbarBtn
              icon="pdf"
              label="PDF"
              variant="secondary"
              onClick={handlePdf}
              disabled={!rows.length || listLoading}
            />
            <GfasToolbarBtn
              icon="whatsapp"
              label="WhatsApp"
              variant="secondary"
              onClick={handleWhatsApp}
              disabled={!rows.length || listLoading}
            />
            {perms?.canAdd ? (
              <GfasToolbarBtn icon="add" label="Add main" variant="secondary" onClick={openAddMain} />
            ) : null}
          </GfasToolbar>
          {perms?.canAdd || perms?.canEdit || perms?.canDelete ? (
            <GfasToolbar>
              {perms?.canAdd ? (
                <GfasToolbarBtn
                  icon="add"
                  label="Add sub"
                  variant="secondary"
                  onClick={openAddSub}
                  disabled={!parentForAddSub}
                  title={
                    parentForAddSub
                      ? `Add sub under ${formatMainNo(parentForAddSub.NO)}`
                      : 'Select a main schedule row first'
                  }
                />
              ) : null}
              {perms?.canEdit ? (
                <GfasToolbarBtn
                  icon="edit"
                  label="Edit"
                  variant="secondary"
                  disabled={!selectedRow}
                  onClick={() => setEditRow(selectedRow)}
                />
              ) : null}
              {perms?.canDelete ? (
                <GfasToolbarBtn
                  icon="delete"
                  label={deleting ? '…' : 'Delete'}
                  variant="secondary"
                  disabled={!selectedRow || deleting}
                  onClick={() => void handleDelete()}
                />
              ) : null}
            </GfasToolbar>
          ) : null}
        </div>

        {err ? <p className="deploy-update-msg deploy-update-msg--err account-master-screen__err">{err}</p> : null}

        <div className="schedule-master-search">
          <input
            className="schedule-master-search__input"
            type="search"
            value={searchQ}
            placeholder="Schedule no. or name (e.g. 8 Trading)…"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search schedules"
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
          <button
            type="button"
            className="schedule-master-search__find"
            onClick={() => executeSearch(searchQ, { immediate: true })}
            disabled={listLoading}
          >
            <span aria-hidden="true">🔍</span> Find
          </button>
        </div>

        <div className="account-master-screen__list-wrap">
        <table className="account-master-table schedule-master-table schedule-master-table--all">
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Type</th>
              <th>Name</th>
              <th>Range</th>
              <th>Nor.Bal</th>
              <th>Corr.N</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No schedules found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const noKey = formatSchedNo(r.NO);
                const isSel = formatSchedNo(selectedNo) === noKey;
                const rowClass = [
                  'account-master-table__row',
                  r.isMain ? 'schedule-master-table__row--main' : 'schedule-master-table__row--sub',
                  isSel ? 'is-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr
                    key={noKey}
                    className={rowClass}
                    onClick={() => setSelectedNo(noKey)}
                    onDoubleClick={() => {
                      if (perms?.canEdit) setEditRow(r);
                    }}
                  >
                    <td className="schedule-master-table__no">{displayScheduleNo(r.NO)}</td>
                    <td>
                      <span
                        className={
                          r.isMain ? 'schedule-type-badge schedule-type-badge--main' : 'schedule-type-badge schedule-type-badge--sub'
                        }
                      >
                        {r.isMain ? 'Main' : 'Sub'}
                      </span>
                    </td>
                    <td className="schedule-master-table__name">{r.NAME}</td>
                    <td>{r.isMain ? '' : r.RANGE}</td>
                    <td>{r.isMain ? '' : r.NORM_BAL}</td>
                    <td>{!r.isMain && Number(r.CORR_NO) ? formatSchedNo(r.CORR_NO) : ''}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>

        <p className="schedule-master-screen__status">
          {rows.length} row{rows.length === 1 ? '' : 's'}
          {listLoading ? ' · loading…' : ''}
          {selectedRow
            ? ` · ${displayScheduleNo(selectedRow.NO)} ${selectedRow.isMain ? 'main' : 'sub'}`
            : ' · double-click a row to edit'}
        </p>
      </div>

      <ScheduleMasterFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        mode={addKind}
        parentGroup={addKind === 'sub' ? parentForAddSub : null}
        scheduleOptions={allSchedules}
        onCreated={() => {
          setAddOpen(false);
          refreshList();
        }}
      />

      <ScheduleMasterFormModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        editRow={editRow}
        mode={editRow?.isMain ? 'main' : 'sub'}
        parentGroup={
          editRow && !editRow.isMain
            ? {
                NO: Math.trunc(Number(editRow.NO)),
                NAME:
                  rows.find((x) => x.isMain && Math.trunc(Number(x.NO)) === Math.trunc(Number(editRow.NO)))?.NAME || '',
              }
            : null
        }
        scheduleOptions={allSchedules}
        onUpdated={() => {
          setEditRow(null);
          refreshList();
        }}
      />
    </div>
  );
}
