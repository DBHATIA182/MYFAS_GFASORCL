import React from 'react';
import { USER_RIGHTS_MODULES } from '../data/userMasterModules';
import { rightsBitsFromString } from '../utils/userRightsBits';

function RightsRow({ modKey, label, bits, disabled, readOnly, onChange }) {
  const set = (field, checked) => {
    onChange?.(modKey, { ...bits, [field]: checked });
  };
  const cells = [
    ['access', 'Access'],
    ['add', 'Add'],
    ['edit', 'Edit'],
    ['delete', 'Delete'],
  ];
  return (
    <tr className="user-rights-table__row">
      <th scope="row" className="user-rights-table__module" title={label}>
        {label}
      </th>
      {cells.map(([field, title]) => (
        <td key={field} className="user-rights-table__bit">
          <label className="user-rights-check user-rights-check--compact">
            <input
              type="checkbox"
              checked={!!bits[field]}
              disabled={disabled || readOnly}
              readOnly={readOnly}
              aria-label={`${label} ${title}`}
              onChange={readOnly ? undefined : (e) => set(field, e.target.checked)}
            />
          </label>
        </td>
      ))}
    </tr>
  );
}

/** All F1–F13 modules in one compact table (VFP user.scx layout). */
export default function UserModuleAccessMatrix({ modules, disabled = false, readOnly = false, onChange }) {
  return (
    <div className="user-master-module-access" aria-label="Module access rights">
      <table className="user-rights-table user-rights-table--compact">
        <thead>
          <tr>
            <th scope="col" className="user-rights-table__module-col">
              Module
            </th>
            <th scope="col" className="user-rights-table__bit-col">
              Access
            </th>
            <th scope="col" className="user-rights-table__bit-col">
              Add
            </th>
            <th scope="col" className="user-rights-table__bit-col">
              Edit
            </th>
            <th scope="col" className="user-rights-table__bit-col">
              Del
            </th>
          </tr>
        </thead>
        <tbody>
          {USER_RIGHTS_MODULES.map((mod) => (
            <RightsRow
              key={mod.key}
              modKey={mod.key}
              label={mod.label}
              bits={modules[mod.key] || rightsBitsFromString('')}
              disabled={disabled}
              readOnly={readOnly}
              onChange={onChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function modulesStateFromUserRow(row) {
  const m = {};
  for (const mod of USER_RIGHTS_MODULES) {
    const raw = row?.[mod.key] ?? row?.[mod.key.toLowerCase()] ?? '';
    m[mod.key] = rightsBitsFromString(String(raw));
  }
  return m;
}
