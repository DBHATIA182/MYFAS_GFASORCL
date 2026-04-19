import React, { useState } from 'react';
import { exitApp } from '../utils/exitApp';

export default function Slide1({ companies, onNext, onExit }) {
  // Use a string to match the value from the dropdown
  const [selected, setSelected] = useState('');

  const handleNext = () => {
    if (!selected) {
      alert("Please select a company first");
      return;
    }
    // Pass COMP_CODE exactly as it appears in the Oracle data
    onNext({ COMP_CODE: selected });
  };

  return (
    <div className="slide">
      <h2>Step 1: Select Company</h2>
      <div className="form-group">
        <label>Select Company:</label>
        <select 
          className="form-select"
          value={selected} 
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">-- Select Company --</option>
          {companies.map((comp) => (
            <option key={comp.COMP_CODE} value={comp.COMP_CODE}>
              {comp.COMP_NAME} ({comp.COMP_CODE})
            </option>
          ))}
        </select>
      </div>
      <div className="button-group button-group--with-exit">
        <button
          type="button"
          className="btn btn-secondary btn-exit"
          onClick={() => (onExit ? onExit() : exitApp())}
          title="Closes the window when allowed; otherwise leaves a blank tab you can close."
        >
          Exit
        </button>
        <button type="button" className="btn btn-primary" onClick={handleNext}>
          Next →
        </button>
      </div>
    </div>
  );
}