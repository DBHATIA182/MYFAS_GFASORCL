import React from 'react';
import { GfasToolbar, GfasToolbarBtn } from './GfasToolbar';

/** Purchase bill toolbar — single line (no search / nav / refresh). */
export default function PurchaseBillToolbar({
  busy,
  mode,
  pbPerms,
  hasBill,
  editable,
  newBtnRef,
  onNew,
  onEdit,
  onDelete,
  onSave,
  onClose,
  onList,
  onPrint,
  onEinv,
  onEinvPrn,
  onPosting,
  onChecklist,
  onOpenBill,
}) {
  const editActive = mode === 'edit';
  const showEinv = typeof onEinv === 'function' || typeof onEinvPrn === 'function';

  return (
    <GfasToolbar className="pb-entry-toolbar pb-entry-toolbar--single">
      <GfasToolbarBtn ref={newBtnRef} icon="add" label="New" onClick={onNew} disabled={busy || !pbPerms?.canAdd} />
      <GfasToolbarBtn
        icon="edit"
        label="Edit"
        variant={editActive ? 'primary' : 'secondary'}
        onClick={onEdit}
        disabled={busy || !pbPerms?.canEdit || !hasBill}
      />
      <GfasToolbarBtn icon="delete" label="Delete" variant="danger" onClick={onDelete} disabled={busy || !hasBill || !pbPerms?.canDelete} />
      <GfasToolbarBtn icon="save" label="Save" variant="primary" className="pb-entry-toolbar__save" onClick={onSave} disabled={busy || !editable} />
      <GfasToolbarBtn icon="close" label="Close" onClick={onClose} disabled={busy} />
      <GfasToolbarBtn icon="list" label="List" onClick={onList} disabled={busy} />
      <GfasToolbarBtn icon="print" label="Print" onClick={onPrint} disabled={busy || !hasBill} />
      {showEinv ? (
        <>
          <GfasToolbarBtn icon="access" label="E.Inv." onClick={onEinv} disabled={busy || !hasBill} />
          <GfasToolbarBtn icon="print" label="EinvPnt" onClick={onEinvPrn} disabled={busy || !hasBill} />
        </>
      ) : null}
      <GfasToolbarBtn icon="voucher" label="Posting" onClick={onPosting} disabled={busy || !hasBill} />
      <GfasToolbarBtn icon="checklist" label="Checklist" onClick={onChecklist} disabled={busy} />
      <GfasToolbarBtn icon="folder" label="Open Bill" onClick={onOpenBill} disabled={busy} />
    </GfasToolbar>
  );
}
