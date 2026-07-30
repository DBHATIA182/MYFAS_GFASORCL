import React from 'react';
import SaleBillHeaderPanel from './SaleBillHeaderPanel';
import SaleBillGridPanel from './SaleBillGridPanel';
import SaleBillExpensesPanel from './SaleBillExpensesPanel';
import SaleBillOthExpensesPanel from './SaleBillOthExpensesPanel';
import SaleBillBillExpensesPanel from './SaleBillBillExpensesPanel';

/** Header + Grid 1 + Other Exp (1–10) + Expenses Summary + Bill logistics. */
export const SB_TAB = {
  HEADER: 'header',
  GRID1: 'grid1',
  OTH_EXP: 'oth_exp',
  EXPENSES: 'expenses',
  BILL_EXP: 'bill_exp',
};

export function getSbTabList() {
  return [
    { id: SB_TAB.HEADER, label: 'Header' },
    { id: SB_TAB.GRID1, label: 'Grid 1' },
    { id: SB_TAB.OTH_EXP, label: 'Other Expenses' },
    { id: SB_TAB.EXPENSES, label: 'Expenses Summary' },
    { id: SB_TAB.BILL_EXP, label: 'Bill Expenses' },
  ];
}

/** @deprecated use getSbTabList() */
export const SB_TAB_LIST = getSbTabList();

export function SaleBillTabBar({ activeTab, onChange, tabs }) {
  const list = tabs || getSbTabList();
  return (
    <nav className="pb-tabs" role="tablist" aria-label="Sale bill sections">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={activeTab === t.id}
          className={`pb-tabs__btn${activeTab === t.id ? ' pb-tabs__btn--active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export default function SaleBillTabContent(props) {
  const { activeTab } = props;
  switch (activeTab) {
    case SB_TAB.HEADER:
      return <SaleBillHeaderPanel {...props} />;
    case SB_TAB.GRID1:
      return <SaleBillGridPanel {...props} />;
    case SB_TAB.OTH_EXP:
      return <SaleBillOthExpensesPanel {...props} />;
    case SB_TAB.EXPENSES:
      return <SaleBillExpensesPanel {...props} />;
    case SB_TAB.BILL_EXP:
      return <SaleBillBillExpensesPanel {...props} />;
    default:
      return <SaleBillHeaderPanel {...props} />;
  }
}
