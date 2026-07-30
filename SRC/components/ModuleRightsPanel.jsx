import React from 'react';
import { ToolbarIconByName } from './ToolbarIcons';

const RIGHTS_ROWS = [
  { key: 'canOpen', label: 'Access', icon: 'access' },
  { key: 'canAdd', label: 'Add', icon: 'add' },
  { key: 'canEdit', label: 'Edit', icon: 'edit' },
  { key: 'canDelete', label: 'Delete', icon: 'delete' },
];

/** Compact read-only module rights — VFP USERS.Fn (e.g. F9 = PORDER). */
export default function ModuleRightsPanel({
  title = 'User rights',
  fieldLabel = 'F9',
  raw = '',
  perms = null,
  userName = '',
  source = '',
  className = '',
  variant = 'full',
}) {
  if (variant === 'iconsOnly') {
    return (
      <ul className={['module-rights-panel module-rights-panel--icons', className].filter(Boolean).join(' ')} aria-label="User rights">
        {RIGHTS_ROWS.map((row) => {
          const on = Boolean(perms?.[row.key]);
          return (
            <li
              key={row.key}
              className={`module-rights-panel__icon${on ? ' is-on' : ' is-off'}`}
              title={`${row.label}: ${on ? 'Allowed' : 'Denied'}`}
            >
              <span className="module-rights-panel__icon-glyph" aria-hidden="true">
                {ToolbarIconByName(row.icon)}
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  const displayRaw = String(raw ?? '').trim() || '0000';

  return (
    <aside className={['module-rights-panel', className].filter(Boolean).join(' ')} aria-label={title}>
      <div className="module-rights-panel__title">{title}</div>
      {userName ? <div className="module-rights-panel__user">{userName}</div> : null}
      <div className="module-rights-panel__field">
        {fieldLabel}: <strong>{displayRaw}</strong>
      </div>
      {source ? <div className="module-rights-panel__source">{source}</div> : null}
      <ul className="module-rights-panel__bits">
        {RIGHTS_ROWS.map((row) => {
          const on = Boolean(perms?.[row.key]);
          return (
            <li key={row.key} className={`module-rights-panel__bit${on ? ' is-on' : ' is-off'}`}>
              <span className="module-rights-panel__bit-mark" aria-hidden="true">
                {on ? '✓' : '×'}
              </span>
              <span>{row.label}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
