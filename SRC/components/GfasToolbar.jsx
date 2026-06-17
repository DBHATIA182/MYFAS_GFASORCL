import React from 'react';
import { ToolbarIconByName } from './ToolbarIcons';

export function GfasToolbarDivider() {
  return <span className="gfas-toolbar-divider" aria-hidden="true" />;
}

/**
 * Compact 28px toolbar button — icon + optional label.
 */
export const GfasToolbarBtn = React.forwardRef(function GfasToolbarBtn(
  {
    icon,
    label,
    iconOnly = false,
    variant = 'secondary',
    type = 'button',
    className = '',
    title,
    children,
    ...rest
  },
  ref
) {
  const showLabel = !iconOnly && (label || children);
  const variantClass =
    variant === 'primary'
      ? 'gfas-toolbar-btn--primary'
      : variant === 'danger'
        ? 'gfas-toolbar-btn--danger'
        : variant === 'export'
          ? 'gfas-toolbar-btn--export'
          : variant === 'excel'
            ? 'gfas-toolbar-btn--excel'
            : variant === 'whatsapp'
              ? 'gfas-toolbar-btn--whatsapp'
              : 'gfas-toolbar-btn--secondary';

  return (
    <button
      ref={ref}
      type={type}
      className={[
        'gfas-toolbar-btn',
        'btn',
        variantClass,
        iconOnly ? 'gfas-toolbar-btn--icon-only' : '',
        variant === 'primary' ? 'btn-primary' : '',
        variant === 'danger' ? 'btn-danger' : '',
        variant === 'export' ? 'btn-export' : '',
        variant === 'excel' ? 'btn-excel' : '',
        variant === 'whatsapp' ? 'btn-whatsapp' : '',
        variant === 'secondary' ? 'btn-secondary' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={title || (typeof label === 'string' ? label : undefined)}
      {...rest}
    >
      {icon ? <span className="gfas-toolbar-btn__icon">{ToolbarIconByName(icon)}</span> : null}
      {showLabel ? (
        <span className="gfas-toolbar-btn__label">{children ?? label}</span>
      ) : null}
    </button>
  );
});

export function GfasToolbar({ className = '', children }) {
  return (
    <div className={['gfas-toolbar', 'account-master-screen__toolbar', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/**
 * Standard master screen toolbar (navigation | export | CRUD).
 */
export function MasterScreenToolbar({
  onPrev,
  onReset,
  onRefresh,
  onList,
  listLabel = 'List',
  onExcel,
  onPdf,
  onWhatsApp,
  perms,
  onAdd,
  onEdit,
  onDelete,
  listLoading = false,
  hasRows = true,
  selectedRow = null,
  deleting = false,
  listDisabled = false,
  children = null,
}) {
  return (
    <GfasToolbar>
      <GfasToolbarBtn icon="back" label="Back" onClick={onPrev} />
      <GfasToolbarBtn icon="home" iconOnly title="Main menu" onClick={onReset} />
      <GfasToolbarBtn
        icon="refresh"
        iconOnly
        title={listLoading ? 'Loading…' : 'Refresh'}
        onClick={onRefresh}
        disabled={listLoading}
      />
      <GfasToolbarDivider />
      {onList ? (
        <GfasToolbarBtn icon="list" label={listLabel} onClick={onList} disabled={listDisabled || listLoading} />
      ) : null}
      {onExcel ? (
        <GfasToolbarBtn
          icon="excel"
          label="Excel"
          variant="excel"
          onClick={onExcel}
          disabled={!hasRows || listLoading}
        />
      ) : null}
      {onPdf ? (
        <GfasToolbarBtn icon="pdf" label="PDF" variant="export" onClick={onPdf} disabled={!hasRows || listLoading} />
      ) : null}
      {onWhatsApp ? (
        <GfasToolbarBtn
          icon="whatsapp"
          label="WhatsApp"
          variant="whatsapp"
          onClick={onWhatsApp}
          disabled={!hasRows || listLoading}
        />
      ) : null}
      {children}
      {(perms?.canAdd || perms?.canEdit || perms?.canDelete) && (onList || onExcel || onPdf || onWhatsApp || children) ? (
        <GfasToolbarDivider />
      ) : null}
      {perms?.canAdd && onAdd ? (
        <GfasToolbarBtn icon="add" label="Add" variant="primary" onClick={onAdd} />
      ) : null}
      {perms?.canEdit && onEdit ? (
        <GfasToolbarBtn icon="edit" label="Edit" variant="primary" disabled={!selectedRow} onClick={onEdit} />
      ) : null}
      {perms?.canDelete && onDelete ? (
        <GfasToolbarBtn
          icon="delete"
          label={deleting ? '…' : 'Delete'}
          variant="danger"
          disabled={!selectedRow || deleting}
          onClick={onDelete}
        />
      ) : null}
    </GfasToolbar>
  );
}
