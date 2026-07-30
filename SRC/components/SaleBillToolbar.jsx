import React from 'react';
import { GfasToolbar, GfasToolbarBtn } from './GfasToolbar';

/** Sale bill toolbar — single line (New/Edit/Delete/Save/List/Print/ChkList/Close). */
export default function SaleBillToolbar({
  busy,
  mode,
  sbPerms,
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
  onChecklist,
}) {
  const editActive = mode === 'edit';

  return (
    <GfasToolbar className="pb-entry-toolbar pb-entry-toolbar--single">
      <GfasToolbarBtn ref={newBtnRef} icon="add" label="New" onClick={onNew} disabled={busy || !sbPerms?.canAdd} />
      <GfasToolbarBtn
        icon="edit"
        label="Edit"
        variant={editActive ? 'primary' : 'secondary'}
        onClick={onEdit}
        disabled={busy || !sbPerms?.canEdit || !hasBill}
      />
      <GfasToolbarBtn icon="delete" label="Delete" variant="danger" onClick={onDelete} disabled={busy || !hasBill || !sbPerms?.canDelete} />
      <GfasToolbarBtn icon="save" label="Save" variant="primary" className="pb-entry-toolbar__save" onClick={onSave} disabled={busy || !editable} />
      <GfasToolbarBtn icon="close" label="Close" onClick={onClose} disabled={busy} />
      <GfasToolbarBtn icon="list" label="List" onClick={onList} disabled={busy} />
      <GfasToolbarBtn icon="print" label="Print" onClick={onPrint} disabled={busy || !hasBill} />
      <GfasToolbarBtn icon="checklist" label="Checklist" onClick={onChecklist} disabled={busy} />
    </GfasToolbar>
  );
}
