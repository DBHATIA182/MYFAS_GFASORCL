import React, { useState } from 'react';

export default function Slide3({ onPrev, onNext, formData }) {
  const [reportType, setReportType] = useState('trial-balance');

  const handleNext = () => {
    onNext({ reportType });
  };

  return (
    <div className="slide slide-3">
      <h2>Step 3: Select Report Type</h2>
      
      <p className="company-info">
        {formData.comp_name} | {formData.comp_year}
      </p>

      <div className="report-options">
        <div 
          className={`report-option ${reportType === 'trial-balance' ? 'selected' : ''}`}
          onClick={() => setReportType('trial-balance')}
        >
          <input
            type="radio"
            name="reportType"
            value="trial-balance"
            checked={reportType === 'trial-balance'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Trial Balance Report</h3>
            <p>View account balances as of a specific date</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'ledger' ? 'selected' : ''}`}
          onClick={() => setReportType('ledger')}
        >
          <input
            type="radio"
            name="reportType"
            value="ledger"
            checked={reportType === 'ledger'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Ledger Report</h3>
            <p>View detailed transactions for a specific account</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'bill-ledger' ? 'selected' : ''}`}
          onClick={() => setReportType('bill-ledger')}
        >
          <input
            type="radio"
            name="reportType"
            value="bill-ledger"
            checked={reportType === 'bill-ledger'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Bill-wise ledger</h3>
            <p>Customer / supplier bills with running balance per bill</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'broker-os' ? 'selected' : ''}`}
          onClick={() => setReportType('broker-os')}
        >
          <input
            type="radio"
            name="reportType"
            value="broker-os"
            checked={reportType === 'broker-os'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>BrokerOs</h3>
            <p>Broker-wise outstanding (BK_CODE range, bills linked via SL / SE / PU)</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'sale-bill-printing' ? 'selected' : ''}`}
          onClick={() => setReportType('sale-bill-printing')}
        >
          <input
            type="radio"
            name="reportType"
            value="sale-bill-printing"
            checked={reportType === 'sale-bill-printing'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Sale Bill Printing</h3>
            <p>Find bills by TYPE/bill fields or party search, then click a row to open printable sale bill</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'sale-list' ? 'selected' : ''}`}
          onClick={() => setReportType('sale-list')}
        >
          <input
            type="radio"
            name="reportType"
            value="sale-list"
            checked={reportType === 'sale-list'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Sale list</h3>
            <p>SALE lines (SL, SE, CN) with party, broker, and item filters — click a bill to open it</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'stock-sum' ? 'selected' : ''}`}
          onClick={() => setReportType('stock-sum')}
        >
          <input
            type="radio"
            name="reportType"
            value="stock-sum"
            checked={reportType === 'stock-sum'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Stock sum</h3>
            <p>LOTSTOCK item-wise totals by ending date and godown — click an item for lot detail and running balance</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'stock-lot' ? 'selected' : ''}`}
          onClick={() => setReportType('stock-lot')}
        >
          <input
            type="radio"
            name="reportType"
            value="stock-lot"
            checked={reportType === 'stock-lot'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Stock lot</h3>
            <p>LOTSTOCK lot-wise position with filters (godown/item/supplier/bikri/lot/cost) and Complete/Outstanding view</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'ageing' ? 'selected' : ''}`}
          onClick={() => setReportType('ageing')}
        >
          <input
            type="radio"
            name="reportType"
            value="ageing"
            checked={reportType === 'ageing'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Ageing report</h3>
            <p>Schedule-wise outstanding grouped into configurable day ranges from Ledger or Bills</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'purchase-list' ? 'selected' : ''}`}
          onClick={() => setReportType('purchase-list')}
        >
          <input
            type="radio"
            name="reportType"
            value="purchase-list"
            checked={reportType === 'purchase-list'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Purchase list</h3>
            <p>PURCHASE lines (PU, DN) with supplier/item/purchase code/godown filters and DN values shown as negative</p>
          </label>
        </div>
      </div>

      <div className="button-group">
        <button onClick={onPrev} className="btn btn-secondary">
          ← Back
        </button>
        <button onClick={handleNext} className="btn btn-primary">
          Next →
        </button>
      </div>
    </div>
  );
}