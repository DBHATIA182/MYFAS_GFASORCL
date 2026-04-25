import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import LoginSlide from './slides/LoginSlide';
import Slide1 from './slides/Slide1';
import Slide2 from './slides/Slide2';
import Slide3 from './slides/Slide3';
import Slide4 from './slides/Slide4';
import Slide5 from './slides/Slide5';
import Slide6 from './slides/Slide6';
import Slide7 from './slides/Slide7';
import Slide8 from './slides/Slide8';
import Slide9 from './slides/Slide9';
import Slide10 from './slides/Slide10';
import Slide11 from './slides/Slide11';
import Slide12 from './slides/Slide12';
import Slide13 from './slides/Slide13';
import Slide14 from './slides/Slide14';
import Slide15 from './slides/Slide15';
import Slide16 from './slides/Slide16';
import { exitApp, performExitWindow } from './utils/exitApp';
import connectionConfig from '../connection.config.json';
import './App.css';

// Local: Vite dev uses '' so /api/* is proxied to port 5001 (see vite.config.js). Run `npm run server` in another terminal.
// Vite preview / static file open on localhost still calls :5001 directly.
const isLocalHost =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const rootDomain = connectionConfig.domain?.rootDomain || 'fasaccountingsoftware.in';
const apiSubdomainSuffix = connectionConfig.domain?.apiSubdomainSuffix || '-api';
const hostName = window.location.hostname;
const knownClients = connectionConfig.clients || {};
const configuredClientName = connectionConfig.clientName || connectionConfig.defaultClientKey || '';

function getClientKeyFromHost(host, domain) {
  if (!host || !domain) return null;
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return null;
  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain) return null;
  return subdomain.split('.')[0] || null;
}

function buildApiBase(clientKey) {
  if (!clientKey) return '';
  if (connectionConfig.apiBase) return connectionConfig.apiBase;
  const fromConfig = knownClients[clientKey]?.apiBase;
  if (fromConfig) return fromConfig;
  return `https://${clientKey}${apiSubdomainSuffix}.${rootDomain}`;
}

const hostClientKey = getClientKeyFromHost(hostName, rootDomain);
const remoteApiBase = buildApiBase(hostClientKey) || buildApiBase(configuredClientName);

/** Shown on sign-in loading screen (e.g. maruti.fasaccountingsoftware.in). */
function getConnectingClientLabel() {
  if (!isLocalHost && hostName && rootDomain && hostName.toLowerCase().endsWith(`.${rootDomain.toLowerCase()}`)) {
    return hostName;
  }
  const key = hostClientKey || configuredClientName;
  if (key && rootDomain) {
    return `${key}.${rootDomain}`;
  }
  return '';
}

const connectingClientDisplay = getConnectingClientLabel();

const API_BASE = import.meta.env.DEV
  ? ''
  : isLocalHost
    ? connectionConfig.local?.apiBase || 'http://localhost:5001'
    : remoteApiBase;
const TOTAL_STEPS = 16;
const VIEW_MODE_STORAGE_KEY = 'gfas_view_mode';

if (import.meta.env.DEV && API_BASE === '') {
  console.info('API → Vite proxy → http://localhost:5001 — start backend: npm run server');
}
if (!import.meta.env.DEV && !isLocalHost && !API_BASE) {
  console.warn('No remote API base resolved. Check connection.config.json clientName/domain.');
}
console.log('Current API Base:', API_BASE || '(same origin /api proxy)');

function App() {
  const [viewMode, setViewMode] = useState(() => {
    const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return saved === 'desktop' || saved === 'mobile' ? saved : null;
  }); // 'desktop' | 'mobile'
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [companies, setCompanies] = useState([]);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    comp_code: null,
    comp_uid: null,
    comp_name: '',
    comp_year: '',
    comp_s_dt: '',
    comp_e_dt: '',
    reportType: 'trial-balance',
  });
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [loginUserName, setLoginUserName] = useState('');

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(typeof SR === 'function');
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'en-GB';
  }, []);

  const [deployUpdateEnabled, setDeployUpdateEnabled] = useState(false);
  const [deployUpdateRequiresKey, setDeployUpdateRequiresKey] = useState(true);
  const [deployUpdateServerBusy, setDeployUpdateServerBusy] = useState(false);
  const [showDeployUpdateModal, setShowDeployUpdateModal] = useState(false);
  const [deployKeyInput, setDeployKeyInput] = useState('');
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployMessage, setDeployMessage] = useState('');
  const [deployMessageIsError, setDeployMessageIsError] = useState(false);
  const [deployProgressPct, setDeployProgressPct] = useState(0);
  const [deployProgressLabel, setDeployProgressLabel] = useState('');
  const [deployRecentLines, setDeployRecentLines] = useState([]);
  const [deployFinished, setDeployFinished] = useState(false);
  const [deployFailed, setDeployFailed] = useState(false);

  const syncDeployStatus = async () => {
    try {
      const base = API_BASE || '';
      const r = await axios.get(`${base}/api/deploy-update/status`);
      if (!r.data?.enabled) return;
      setDeployUpdateEnabled(true);
      setDeployUpdateRequiresKey(r.data?.requiresDeployKey !== false);
      setDeployUpdateServerBusy(r.data?.busy === true);
      setDeployProgressPct(Number(r.data?.progressPercent ?? 0) || 0);
      setDeployProgressLabel(String(r.data?.statusLabel ?? '').trim());
      setDeployRecentLines(Array.isArray(r.data?.recentLogLines) ? r.data.recentLogLines : []);
      setDeployFinished(r.data?.isFinished === true);
      setDeployFailed(r.data?.isError === true);
    } catch {
      /* feature off or API unreachable */
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = API_BASE || '';
        const r = await axios.get(`${base}/api/deploy-update/status`);
        if (!cancelled && r.data?.enabled) {
          setDeployUpdateEnabled(true);
          setDeployUpdateRequiresKey(r.data?.requiresDeployKey !== false);
          setDeployUpdateServerBusy(r.data?.busy === true);
          setDeployProgressPct(Number(r.data?.progressPercent ?? 0) || 0);
          setDeployProgressLabel(String(r.data?.statusLabel ?? '').trim());
          setDeployRecentLines(Array.isArray(r.data?.recentLogLines) ? r.data.recentLogLines : []);
          setDeployFinished(r.data?.isFinished === true);
          setDeployFailed(r.data?.isError === true);
        }
      } catch {
        /* feature off or API unreachable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showDeployUpdateModal) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await syncDeployStatus();
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [showDeployUpdateModal]);

  const handleDeployUpdateSubmit = async (e) => {
    e.preventDefault();
    setDeployMessage('');
    setDeployBusy(true);
    try {
      const base = API_BASE || '';
      const payload = deployUpdateRequiresKey ? { deployKey: deployKeyInput.trim() } : {};
      const r = await axios.post(`${base}/api/deploy-update`, payload);
      setDeployMessageIsError(false);
      setDeployMessage(r.data?.message || 'Started.');
      setDeployUpdateServerBusy(true);
      setDeployProgressPct(6);
      setDeployProgressLabel('Starting update...');
      setDeployFinished(false);
      setDeployFailed(false);
      setDeployRecentLines((prev) =>
        prev.length > 0 ? prev : ['Update started in background. Waiting for first log line...']
      );
      setDeployKeyInput('');
      await syncDeployStatus();
    } catch (err) {
      setDeployMessageIsError(true);
      const msg = err.response?.data?.error || err.message || 'Request failed';
      setDeployMessage(msg);
      if (err.response?.status === 429) setDeployUpdateServerBusy(true);
    } finally {
      setDeployBusy(false);
    }
  };

  const applyViewMode = (mode) => {
    if (mode !== 'desktop' && mode !== 'mobile') return;
    setViewMode(mode);
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    setShowViewSettings(false);
  };

  useEffect(() => {
    document.body.classList.remove('force-mobile-view', 'force-desktop-view');
    if (viewMode === 'mobile') {
      document.body.classList.add('force-mobile-view');
    } else if (viewMode === 'desktop') {
      document.body.classList.add('force-desktop-view');
    }

    return () => {
      document.body.classList.remove('force-mobile-view', 'force-desktop-view');
    };
  }, [viewMode]);

  useEffect(() => {
    if (viewMode) return;
    const handleViewModeShortcut = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (key === 'd') {
        event.preventDefault();
        applyViewMode('desktop');
      } else if (key === 'm') {
        event.preventDefault();
        applyViewMode('mobile');
      }
    };
    window.addEventListener('keydown', handleViewModeShortcut);
    return () => window.removeEventListener('keydown', handleViewModeShortcut);
  }, [viewMode]);

  useEffect(() => {
    if (!authenticated) return;
    const fetchCompanies = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE}/api/companies`, {
          params: loginUserName ? { user_name: loginUserName } : undefined,
        });
        console.log('Company list received:', response.data);
        setCompanies(response.data || []);
      } catch (error) {
        console.error('Error fetching companies:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCompanies();
  }, [authenticated, loginUserName]);

  const handleLoginSuccess = (payload) => {
    const u = String(payload?.userName ?? payload?.user_name ?? '').trim().toUpperCase();
    setLoginUserName(u);
    setAuthenticated(true);
  };

  const handleSlide1Next = async (data) => {
    const selectedCode = data.COMP_CODE || data.comp_code;
    const selectedComp = companies.find(c => String(c.COMP_CODE) === String(selectedCode));

    if (selectedComp) {
      setFormData(prev => ({ 
        ...prev, 
        comp_code: selectedCode,
        comp_name: selectedComp.COMP_NAME 
      }));

      try {
        setLoading(true);
        const response = await axios.get(`${API_BASE}/api/years`, {
          params: { comp_code: selectedCode }
        });
        setYears(response.data || []);
        setCurrentSlide(2);
      } catch (error) {
        alert("Error loading financial years. Is server running on port 5001?");
      } finally {
        setLoading(false);
      }
    } else {
      alert("Match failed. Selected: " + selectedCode);
    }
  };

  const handleSlide2Next = (data) => {
  // compdet row: accept UPPER or lower case keys from API / Oracle driver
  setFormData(prev => ({ 
    ...prev, 
    comp_uid: data.COMP_UID ?? data.comp_uid,
    comp_year: data.COMP_YEAR ?? data.comp_year,
    comp_s_dt: data.COMP_S_DT ?? data.comp_s_dt,
    comp_e_dt: data.COMP_E_DT ?? data.comp_e_dt,
    comp_name: prev.comp_name
  }));
  
  console.log("Saving Form Data:", data); // Watch this in your console!
  setCurrentSlide(3);
};

  const handleSlide3Next = (data) => {
    setFormData(prev => ({ ...prev, ...data }));
    const reportType = String(data?.reportType ?? '').trim().toLowerCase();
    if (reportType === 'ledger' || reportType === 'ledger-interest') setCurrentSlide(5);
    else if (reportType === 'bill-ledger' || reportType === 'customer-ledger' || reportType === 'supplier-ledger') setCurrentSlide(6);
    else if (reportType === 'broker-os') setCurrentSlide(7);
    else if (reportType === 'sale-list') setCurrentSlide(8);
    else if (reportType === 'stock-sum') setCurrentSlide(9);
    else if (reportType === 'stock-lot') setCurrentSlide(10);
    else if (reportType === 'purchase-list') setCurrentSlide(11);
    else if (reportType === 'ageing') setCurrentSlide(12);
    else if (reportType === 'sale-bill-printing') setCurrentSlide(13);
    else if (reportType === 'voucher-list') setCurrentSlide(14);
    else if (reportType === 'gstr1') setCurrentSlide(15);
    else if (reportType === 'hsn-sales') setCurrentSlide(16);
    else setCurrentSlide(4);
  };

  const handlePrev = () => setCurrentSlide(prev => prev - 1);

  const handleExitApp = () => {
    if (!window.confirm('Exit the application?')) return;
    setAuthenticated(false);
    setLoginUserName('');
    setCompanies([]);
    setYears([]);
    setCurrentSlide(1);
    performExitWindow();
  };

  const handleReset = () => {
    setCurrentSlide(1);
    setYears([]);
  };

  const handleVoiceCommand = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (typeof SR !== 'function') {
      alert('Voice command is not supported on this device/browser.');
      return;
    }
    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceListening(true);
    recognition.onend = () => setVoiceListening(false);
    recognition.onerror = () => {
      setVoiceListening(false);
      alert('Voice recognition failed. Please try again.');
    };
    recognition.onresult = (event) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || '').toLowerCase().trim();
      if (
        transcript.includes('open sale bill printing') ||
        transcript.includes('sale bill printing') ||
        transcript.includes('open sale bill')
      ) {
        if (!authenticated || !formData.comp_uid) {
          alert('Please select company and financial year before opening sale bill printing.');
          return;
        }
        setFormData((prev) => ({ ...prev, reportType: 'sale-list' }));
        setCurrentSlide(8);
        return;
      }
      alert(`Voice command not recognized: ${transcript || 'no speech detected'}`);
    };
    recognition.start();
  };

  const renderViewSettings = () => (
    <div className="view-settings">
      <button
        type="button"
        className="view-settings-btn"
        onClick={() => setShowViewSettings((prev) => !prev)}
      >
        Settings
      </button>
      {showViewSettings ? (
        <div className="view-settings-menu">
          <button
            type="button"
            className={`view-settings-option${viewMode === 'desktop' ? ' is-active' : ''}`}
            onClick={() => applyViewMode('desktop')}
          >
            Desktop View
          </button>
          <button
            type="button"
            className={`view-settings-option${viewMode === 'mobile' ? ' is-active' : ''}`}
            onClick={() => applyViewMode('mobile')}
          >
            Mobile View
          </button>
          {/* Update button removed from Settings. */}
        </div>
      ) : null}
    </div>
  );

  const renderDeployUpdateModal = () =>
    showDeployUpdateModal ? (
      <div
        className="deploy-update-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deploy-update-title"
        onClick={(ev) => {
          if (deployBusy) return;
          if (ev.target === ev.currentTarget) setShowDeployUpdateModal(false);
        }}
      >
        <div className="deploy-update-dialog" onClick={(e) => e.stopPropagation()}>
          <h2 id="deploy-update-title">Update to latest version</h2>
          <p className="deploy-update-hint">
            Pulls the latest code from Git, reinstalls dependencies, rebuilds the site, then restarts the app
            windows on this server.
            {deployUpdateRequiresKey
              ? ' Enter the same deploy key as in deploy-update-secret.txt (first line) on the server PC.'
              : ' This server is configured to start the update without a deploy key.'}
          </p>
          {deployUpdateServerBusy ? (
            <p className="deploy-update-msg deploy-update-msg--err">
              An update is already running on this server. Wait for it to finish, then open this dialog again, or check
              logs/deploy-update.log under the app folder. If nothing is running, restart the API once to clear a stuck lock.
            </p>
          ) : null}
          <form onSubmit={handleDeployUpdateSubmit}>
            {deployUpdateRequiresKey ? (
              <>
                <label className="deploy-update-label" htmlFor="deploy-key-input">
                  Deploy key
                </label>
                <input
                  id="deploy-key-input"
                  type="password"
                  className="deploy-update-input"
                  autoComplete="off"
                  value={deployKeyInput}
                  onChange={(e) => setDeployKeyInput(e.target.value)}
                  placeholder="Enter deploy key"
                  disabled={deployBusy || deployUpdateServerBusy}
                />
              </>
            ) : null}
            {deployMessage ? (
              <p className={`deploy-update-msg${deployMessageIsError ? ' deploy-update-msg--err' : ''}`}>{deployMessage}</p>
            ) : null}
            {(deployUpdateServerBusy || deployProgressPct > 0) ? (
              <div className="deploy-update-progress-wrap" aria-live="polite">
                <div className="deploy-update-progress-label">
                  {deployProgressLabel || (deployUpdateServerBusy ? 'Update is running...' : 'Update status')}
                  <span>{Math.max(0, Math.min(100, Math.round(deployProgressPct)))}%</span>
                </div>
                <div className="deploy-update-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(deployProgressPct)))}>
                  <div className="deploy-update-progress-fill" style={{ width: `${Math.max(0, Math.min(100, deployProgressPct))}%` }} />
                </div>
                {deployRecentLines.length > 0 ? (
                  <div className="deploy-update-log">
                    {deployRecentLines.map((line, idx) => (
                      <div key={`${idx}-${line}`} className="deploy-update-log-line">
                        {line}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {deployFinished && !deployFailed ? (
              <p className="deploy-update-msg">
                Finished update. Restart browser now, then refresh this page.
              </p>
            ) : null}
            <div className="deploy-update-actions">
              <button type="button" className="btn btn-secondary" disabled={deployBusy} onClick={() => setShowDeployUpdateModal(false)}>
                {deployFinished ? 'Close' : 'Cancel'}
              </button>
              {!deployFinished ? (
                <button type="submit" className="btn btn-primary" disabled={deployBusy || deployUpdateServerBusy}>
                  {deployBusy ? 'Starting…' : deployUpdateServerBusy ? 'Update running…' : 'Update & restart'}
                </button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    ) : null;

  if (!viewMode) {
    return (
      <>
      <div className="app app--selector">
        <main className="app-main">
          <section className="slide startup-mode-card">
            <h2>Choose View Mode</h2>
            <p className="startup-mode-subtitle">
              Select how you want to use GRAINFAS in this session.
            </p>
            <p className="startup-mode-shortcut-hint">Keyboard shortcut: press D for Desktop or M for Mobile.</p>
            <div className="startup-mode-actions">
              <button type="button" className="btn btn-primary" onClick={() => applyViewMode('desktop')}>
                (D) Desktop View
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => applyViewMode('mobile')}>
                (M) Mobile View
              </button>
            </div>
          </section>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  const appClassName = `app ${viewMode === 'desktop' ? 'app--desktop' : 'app--mobile'}`;

  if (!authenticated) {
    return (
      <>
      <div className={appClassName}>
        <header className="app-header">
          <h1>GRAINFAS Accounting</h1>
          <div className="app-header-actions">
            {renderViewSettings()}
            <div className="status-badge">Sign in</div>
          </div>
        </header>
        <main className="app-main">
          <LoginSlide apiBase={API_BASE} onSuccess={handleLoginSuccess} onExit={exitApp} />
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  if (loading && currentSlide === 1) {
    return (
      <>
      <div className={appClassName}>
        <header className="app-header">
          <h1>GRAINFAS Accounting</h1>
          <div className="app-header-actions">
            {renderViewSettings()}
            <div className="status-badge">Step 1 / {TOTAL_STEPS}</div>
          </div>
        </header>
        <main className="app-main">
          <div className="app-loading">
            <h2>Connecting to client</h2>
            {connectingClientDisplay ? (
              <p className="app-loading-client-host">{connectingClientDisplay}</p>
            ) : null}
          </div>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  return (
    <>
    <div className={appClassName}>
      <header className="app-header">
        <h1>GRAINFAS Accounting</h1>
        <div className="app-header-actions">
          {renderViewSettings()}
          {voiceSupported ? (
            <button
              type="button"
              className={`voice-command-btn${voiceListening ? ' voice-command-btn--listening' : ''}`}
              onClick={handleVoiceCommand}
            >
              {voiceListening ? 'Listening...' : 'Voice'}
            </button>
          ) : null}
          <div className="status-badge">Step {currentSlide} / {TOTAL_STEPS}</div>
        </div>
      </header>

      <main className="app-main">
        {currentSlide === 1 && (
          <Slide1 companies={companies} onNext={handleSlide1Next} onExit={handleExitApp} />
        )}
        {currentSlide === 2 && <Slide2 years={years} formData={formData} onPrev={handlePrev} onNext={handleSlide2Next} />}
        {currentSlide === 3 && <Slide3 formData={formData} onPrev={handlePrev} onNext={handleSlide3Next} />}
        {currentSlide === 4 && <Slide4 apiBase={API_BASE} formData={formData} onPrev={handlePrev} onReset={handleReset} />}
        {currentSlide === 5 && <Slide5 apiBase={API_BASE} formData={formData} onPrev={handlePrev} onReset={handleReset} />}
        {currentSlide === 6 && (
          <Slide6 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 7 && (
          <Slide7 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 8 && (
          <Slide8 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 9 && (
          <Slide9 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 10 && (
          <Slide10 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 11 && (
          <Slide11 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 12 && (
          <Slide12 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 13 && (
          <Slide13 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 14 && (
          <Slide14 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 15 && (
          <Slide15 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 16 && (
          <Slide16 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
      </main>
    </div>
    {renderDeployUpdateModal()}
    </>
  );
}

// --- CRITICAL: VITE MOUNTING LOGIC ---
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(<React.StrictMode><App /></React.StrictMode>);
}

export default App;