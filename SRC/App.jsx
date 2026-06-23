import React, { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react';
import axios from 'axios';
import LoginSlide from './slides/LoginSlide';
import Slide1 from './slides/Slide1';
import Slide2 from './slides/slide2';
import Slide3 from './slides/Slide3';
const Slide4 = lazy(() => import('./slides/Slide4'));
const Slide5 = lazy(() => import('./slides/Slide5'));
const Slide6 = lazy(() => import('./slides/Slide6'));
const Slide7 = lazy(() => import('./slides/Slide7'));
const Slide8 = lazy(() => import('./slides/Slide8'));
const Slide9 = lazy(() => import('./slides/Slide9'));
const Slide10 = lazy(() => import('./slides/Slide10'));
const Slide11 = lazy(() => import('./slides/Slide11'));
const Slide12 = lazy(() => import('./slides/Slide12'));
const Slide13 = lazy(() => import('./slides/Slide13'));
const Slide14 = lazy(() => import('./slides/Slide14'));
const Slide15 = lazy(() => import('./slides/Slide15'));
const Slide16 = lazy(() => import('./slides/Slide16'));
const Slide17TradingAc = lazy(() => import('./slides/Slide17TradingAc'));
const Slide18PlProfitLoss = lazy(() => import('./slides/Slide18PlProfitLoss'));
const Slide19BalanceSheet = lazy(() => import('./slides/Slide19BalanceSheet'));
const Slide33SaleGraph = lazy(() => import('./slides/Slide33SaleGraph'));
const Slide34OverdueCustomers = lazy(() => import('./slides/Slide34OverdueCustomers'));
const Slide21StateWiseSales = lazy(() => import('./slides/Slide21StateWiseSales'));
const Slide22StateWisePurchase = lazy(() => import('./slides/Slide22StateWisePurchase'));
const Slide80TrialBalanceSummary = lazy(() => import('./slides/Slide80TrialBalanceSummary'));
const Slide81TrialDateWise = lazy(() => import('./slides/Slide81TrialDateWise'));
import Slide26AccountMaster from './slides/Slide26AccountMaster';
import Slide27ItemMaster from './slides/Slide27ItemMaster';
import Slide28MasterPlaceholder from './slides/Slide28MasterPlaceholder';
import Slide29ScheduleMaster from './slides/Slide29ScheduleMaster';
import Slide30CatMastMaster from './slides/Slide30CatMastMaster';
import Slide31ItemGrpMaster from './slides/Slide31ItemGrpMaster';
import Slide32UserMaster from './slides/Slide32UserMaster';
import Slide33BikriExpMaster from './slides/Slide33BikriExpMaster';
import Slide35UserPassword from './slides/Slide35UserPassword';
import Slide37GodownRentMaster from './slides/Slide37GodownRentMaster';
import Slide38GodownMaster from './slides/Slide38GodownMaster';
import Slide39CostCentreMaster from './slides/Slide39CostCentreMaster';
import Slide40CustomerInterest from './slides/Slide40CustomerInterest';
import Slide41HolidayMaster from './slides/Slide41HolidayMaster';
import Slide42DaneMaster from './slides/Slide42DaneMaster';
import Slide43MarkaMaster from './slides/Slide43MarkaMaster';
import Slide44PurchaseExpMaster from './slides/Slide44PurchaseExpMaster';
import Slide45SaleBillCondition from './slides/Slide45SaleBillCondition';
import Slide46LocationBType from './slides/Slide46LocationBType';
import Slide47DetailMaster from './slides/Slide47DetailMaster';
import Slide48GstStateMaster from './slides/Slide48GstStateMaster';
import Slide49UtilitiesPlaceholder from './slides/Slide49UtilitiesPlaceholder';
import Slide50NewYearBooks from './slides/Slide50NewYearBooks';
import Slide51PrimaryKey from './slides/Slide51PrimaryKey';
import Slide52SetFunction from './slides/Slide52SetFunction';
import Slide53TakajaQuery from './slides/Slide53TakajaQuery';
import Slide54OpeningBillsDetail from './slides/Slide54OpeningBillsDetail';
import Slide55InterestTransfer from './slides/Slide55InterestTransfer';
import Slide56CompleteLedger from './slides/Slide56CompleteLedger';
import Slide57SquareUpAccounts from './slides/Slide57SquareUpAccounts';
import Slide58TrialDifference from './slides/Slide58TrialDifference';
import Slide59AccountMerge from './slides/Slide59AccountMerge';
import Slide60BikriNoMerge from './slides/Slide60BikriNoMerge';
import Slide61BikriLotMerge from './slides/Slide61BikriLotMerge';
import Slide62ShortageTransfer from './slides/Slide62ShortageTransfer';
import Slide63UnusedAccountList from './slides/Slide63UnusedAccountList';
import Slide64UnusedCostCentreCodes from './slides/Slide64UnusedCostCentreCodes';
import Slide65UnusedGodownCodes from './slides/Slide65UnusedGodownCodes';
import Slide66MissingCodes from './slides/Slide66MissingCodes';
import Slide67BrokFind from './slides/Slide67BrokFind';
import Slide68DaneFind from './slides/Slide68DaneFind';
import Slide69StockTransfer from './slides/Slide69StockTransfer';
import Slide70SaleTransfer from './slides/Slide70SaleTransfer';
import Slide71VoucherTransfer from './slides/Slide71VoucherTransfer';
import Slide72PurchaseTransfer from './slides/Slide72PurchaseTransfer';
import Slide73UpdateSaleInvNo from './slides/Slide73UpdateSaleInvNo';
import Slide74UpdatePanWithGstIn from './slides/Slide74UpdatePanWithGstIn';
import Slide75UserReport from './slides/Slide75UserReport';
import Slide76AuditTrailReport from './slides/Slide76AuditTrailReport';
import Slide77CompanyDetailEdit from './slides/Slide77CompanyDetailEdit';
import Slide78GstProfileSetting from './slides/Slide78GstProfileSetting';
import Slide79Updation from './slides/Slide79Updation';
import Slide82UpdationStock from './slides/Slide82UpdationStock';
import Slide83NewCompanyAddition from './slides/Slide83NewCompanyAddition';
import Slide84SetSaleExp from './slides/Slide84SetSaleExp';
import Slide85DefaultSetting from './slides/Slide85DefaultSetting';
import Slide86SetTaskScheduler from './slides/Slide86SetTaskScheduler';
import Slide89IncomeTaxReport from './slides/Slide89IncomeTaxReport';
import DesktopOnlyUtilityGate from './components/DesktopOnlyUtilityGate';
import MasterSlideErrorBoundary from './components/MasterSlideErrorBoundary';

function SlideRouteFallback() {
  return <p className="loading-msg">Loading screen…</p>;
}
import { resolveMasterSlideNo, MASTER_PLACEHOLDER_SLIDE } from './data/masterModuleConfig';
import {
  findUtilitiesModuleItem,
  isUtilityDesktopOnlyBlocked,
  resolveUtilitiesSlideNo,
  utilityDesktopOnlyMessage,
  UTILITIES_PLACEHOLDER_SLIDE,
} from './data/utilitiesModuleConfig';
import {
  findIncomeTaxModuleItem,
  resolveIncomeTaxSlideNo,
  INCOME_TAX_PLACEHOLDER_SLIDE,
  INCOME_TAX_REPORT_SLIDE,
} from './data/incomeTaxModuleConfig';

const MASTER_SLIDE_NOS = new Set([26, 27, 28, 29, 30, 31, 32, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, MASTER_PLACEHOLDER_SLIDE]);
import { AppSessionContext } from './components/AppSessionContext';
import { IconSettings, IconVoice } from './components/ToolbarIcons';
import { exitApp, performExitWindow } from './utils/exitApp';
import connectionConfig from '../connection.config.json';
import './App.css';
import './styles/fasFlowTheme.css';
import './styles/windalInitialFlow.css';
import './styles/windalDashboard.css';
import './styles/gfasToolbar.css';
import './styles/stateWiseSales.css';
import './styles/scheduleMasterScreen.css';
import './styles/ledgerMobile.css';
import './styles/trialBalanceMobile.css';
import './styles/trialBalanceDesktop.css';
import './styles/ledgerDesktop.css';
import './styles/ledgerFullBleed.css';
import './styles/saleBillPrinting.css';
import './styles/saleListForm.css';
import { getGfasDocumentTitle } from './utils/gfasBrand';
import {
  formatApiBaseForDisplay,
  getClientKeyFromHost,
  buildRemoteApiBase,
  isFasWebAppHost,
  isPrivateLanHost,
  resolveApiBase,
  apiUrl,
  saveApiBaseOverride,
  readApiBaseOverride,
} from './utils/resolveApiBase';

// Local: Vite dev uses '' so /api/* is proxied to port 5002 (see vite.config.js). Run `npm run server` in another terminal.
// Vite preview / static file open on localhost still calls :5002 directly.
function getSafeHostname() {
  try {
    return typeof window !== 'undefined' && window.location ? String(window.location.hostname || '') : '';
  } catch {
    return '';
  }
}

function safeStorageGet(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures on restricted mobile browsers */
  }
}

function safeStorageRemove(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch {
    /* ignore storage failures on restricted mobile browsers */
  }
}

function safeSetDocumentLang(lang) {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.lang = lang;
  } catch {
    /* ignore document access failures */
  }
}

function safeSetBodyViewMode(mode) {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('force-mobile-view', 'force-desktop-view');
    if (mode === 'mobile') {
      document.body.classList.add('force-mobile-view');
    } else if (mode === 'desktop') {
      document.body.classList.add('force-desktop-view');
    }
  } catch {
    /* ignore body class failures */
  }
}

function safeClearBodyViewMode() {
  try {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.remove('force-mobile-view', 'force-desktop-view');
  } catch {
    /* ignore body class failures */
  }
}

function renderFatalStartupMessage(errorLike) {
  try {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (!root) return;
    const msg = String(errorLike?.message || errorLike || 'Unknown startup error');
    root.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 24px; color: #1f2937;">
        <h2 style="margin: 0 0 12px;">GRAINFAS Accounting</h2>
        <p style="margin: 0 0 10px; font-weight: 600;">App could not start on this browser.</p>
        <p style="margin: 0 0 8px;">Please refresh once. If it still fails, clear browser site data/cache.</p>
        <pre style="white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px;">${msg}</pre>
      </div>
    `;
  } catch {
    /* last-resort fallback only */
  }
}

const hostName = getSafeHostname();
const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1';

const rootDomain = connectionConfig.domain?.rootDomain || 'fasaccountingsoftware.in';
const apiSubdomainSuffix = connectionConfig.domain?.apiSubdomainSuffix || '-api';
const knownClients = connectionConfig.clients || {};
const configuredClientNameRaw = connectionConfig.clientName || connectionConfig.defaultClientKey || '';
const configuredClientName = (() => {
  const v = normalizeClientKey(configuredClientNameRaw);
  return v === 'auto' ? '' : v;
})();
const APP_DISPLAY_NAME = String(connectionConfig.product?.displayName || '').trim() || 'GRAINFAS Accounting';
const APP_DOCUMENT_TITLE = getGfasDocumentTitle(connectionConfig.product?.displayTitle);

function normalizeClientKey(value) {
  return String(value || '').trim().toLowerCase();
}

const hostClientKey = getClientKeyFromHost(hostName, rootDomain);
const remoteApiBase =
  buildRemoteApiBase(hostClientKey, connectionConfig) || buildRemoteApiBase(configuredClientName, connectionConfig);

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

const API_BASE = resolveApiBase({
  isDev: import.meta.env.DEV,
  hostname: hostName,
  remoteApiBase,
});
const TOTAL_STEPS = 20;
const VIEW_MODE_STORAGE_KEY = 'gfas_view_mode';
/** Per-browser-origin session (localhost vs demo.fasaccountingsoftware.in are separate). */
const AUTH_STORAGE_KEY = 'gfas_auth_state_v1';

const GFAS_DEV_STACK_MARK = 'GFASORCL-5002';
if (import.meta.env.DEV && API_BASE === '') {
  console.info(
    `[${GFAS_DEV_STACK_MARK}] API → Vite proxy → http://localhost:5002 — start backend: start-api.cmd or npm run server:win`,
  );
  console.info(
    `[${GFAS_DEV_STACK_MARK}] If the line above says port 5001, this tab has old JS — hard refresh (Ctrl+F5) or restart npm run dev.`,
  );
}
if (import.meta.env.DEV && API_BASE && isPrivateLanHost(hostName)) {
  console.info(`API → LAN direct ${API_BASE} (mobile/Wi‑Fi) — ensure node server listens on 0.0.0.0:${API_BASE.split(':').pop()}`);
}
if (isFasWebAppHost(hostName) && !import.meta.env.DEV && API_BASE) {
  console.info(`GFASORCL cloud: UI at ${hostName} → API ${API_BASE}`);
}
if (!import.meta.env.DEV && !isLocalHost && !isPrivateLanHost(hostName) && !API_BASE) {
  console.warn('No remote API base resolved. Check connection.config.json clientName/domain.');
}
console.log('GFASORCL API:', formatApiBaseForDisplay(API_BASE) === 'Same page (/api proxy)' ? API_BASE || '(proxy)' : API_BASE);

function App() {
  const renderMinimalHeaderActions = () => (
    <header className="app-header app-header--minimal">
      <div className="app-header-actions">{renderViewSettings()}</div>
    </header>
  );

  const [detectedClientKey, setDetectedClientKey] = useState('');
  const [clientGuardChecked, setClientGuardChecked] = useState(false);
  const [clientGuardMismatch, setClientGuardMismatch] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    const saved = safeStorageGet(VIEW_MODE_STORAGE_KEY);
    return saved === 'desktop' || saved === 'mobile' ? saved : null;
  }); // 'desktop' | 'mobile'
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [apiOverrideDraft, setApiOverrideDraft] = useState(() => readApiBaseOverride());
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
  const [companiesRevision, setCompaniesRevision] = useState(0);

  /* Always open on login (do not skip to company from saved session). */
  useEffect(() => {
    safeStorageRemove(AUTH_STORAGE_KEY);
    setAuthenticated(false);
    setLoginUserName('');
    setCompanies([]);
    setYears([]);
    setCurrentSlide(1);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined' && APP_DOCUMENT_TITLE) {
      document.title = APP_DOCUMENT_TITLE;
    }
  }, []);

  const connectingClientDisplay = detectedClientKey && rootDomain
    ? `${detectedClientKey}.${rootDomain}`
    : getConnectingClientLabel();

  useEffect(() => {
    let cancelled = false;
    const expectedClient = normalizeClientKey(hostClientKey);
    if (import.meta.env.DEV || isLocalHost || !expectedClient) {
      setClientGuardChecked(true);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const base = API_BASE || '';
        const response = await axios.get(`${base}/api/client-identity`, { timeout: 4000 });
        const actualClient = normalizeClientKey(response?.data?.clientKey);
        const detected = normalizeClientKey(response?.data?.clientKey);
        if (!cancelled && detected) setDetectedClientKey(detected);
        if (!cancelled && actualClient && actualClient !== expectedClient) {
          setAuthenticated(false);
          setLoginUserName('');
          setCompanies([]);
          setYears([]);
          setCurrentSlide(1);
          safeStorageRemove(AUTH_STORAGE_KEY);
          setClientGuardMismatch({ expectedClient, actualClient });
        }
      } catch {
        /* If identity endpoint is unreachable, do not block startup. */
      } finally {
        if (!cancelled) setClientGuardChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(typeof SR === 'function');
  }, []);

  useEffect(() => {
    safeSetDocumentLang('en-GB');
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

  const fetchDeployStatus = () => {
    const base = API_BASE || '';
    return axios.get(`${base}/api/deploy-update/status`, { validateStatus: () => true });
  };

  const syncDeployStatus = async () => {
    try {
      const r = await fetchDeployStatus();
      if (r.status >= 400) return;
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

  /* Defer deploy-update check until after login (faster login screen on demo/tunnel). */
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchDeployStatus();
        if (!cancelled && r.status < 400 && r.data?.enabled) {
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
  }, [authenticated]);

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
    safeStorageSet(VIEW_MODE_STORAGE_KEY, mode);
    setShowViewSettings(false);
  };

  useEffect(() => {
    safeSetBodyViewMode(viewMode);

    return () => {
      safeClearBodyViewMode();
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
        const response = await axios.get(apiUrl(API_BASE, '/api/companies'), {
          params: loginUserName ? { user_name: loginUserName } : undefined,
          withCredentials: true,
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

  /** GRAINFAS.COMPANY — refresh when opening Change Company / Change Year (utilities). */
  const refreshCompanies = useCallback(async () => {
    if (!authenticated) return;
    try {
      const response = await axios.get(apiUrl(API_BASE, '/api/companies'), {
        params: {
          ...(loginUserName ? { user_name: loginUserName } : {}),
          _: Date.now(),
        },
        withCredentials: true,
      });
      setCompanies(response.data || []);
    } catch (error) {
      console.error('Error refreshing companies:', error);
    }
  }, [authenticated, loginUserName]);

  const bumpCompaniesCatalog = useCallback(() => {
    setCompaniesRevision((v) => v + 1);
    refreshCompanies();
  }, [refreshCompanies]);

  const handleCompaniesLoaded = useCallback((list) => {
    setCompanies(Array.isArray(list) ? list : []);
  }, []);

  const handleYearsLoaded = useCallback((list) => {
    setYears(Array.isArray(list) ? list : []);
  }, []);

  const refreshYearsForCompany = useCallback(
    async (compCode) => {
      const code = String(compCode ?? '').trim();
      if (!authenticated || !code) return;
      try {
        const response = await axios.get(apiUrl(API_BASE, '/api/years'), {
          params: { comp_code: code },
          withCredentials: true,
        });
        setYears(response.data || []);
      } catch (error) {
        console.error('Error refreshing years:', error);
      }
    },
    [authenticated]
  );

  useEffect(() => {
    if (!authenticated || currentSlide !== 1) return;
    refreshCompanies();
  }, [authenticated, currentSlide, refreshCompanies]);

  useEffect(() => {
    if (!authenticated || currentSlide !== 2) return;
    refreshCompanies();
    const code = formData.comp_code ?? formData.COMP_CODE;
    if (code) refreshYearsForCompany(code);
  }, [authenticated, currentSlide, formData.comp_code, formData.COMP_CODE, refreshCompanies, refreshYearsForCompany]);

  const handleLoginSuccess = (payload) => {
    const u = String(payload?.userName ?? payload?.user_name ?? '').trim().toUpperCase();
    setLoginUserName(u);
    setAuthenticated(true);
    setCurrentSlide(1);
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
        const response = await axios.get(apiUrl(API_BASE, '/api/years'), {
          params: { comp_code: selectedCode },
          withCredentials: true,
        });
        setYears(response.data || []);
        setCurrentSlide(2);
      } catch (error) {
        alert("Error loading financial years. Is server running on port 5002?");
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

  /** Master screen to render. Placeholder (28) uses reportType; explicit slides keep their number. */
  const activeMasterSlide = useMemo(() => {
    if (!MASTER_SLIDE_NOS.has(currentSlide)) return null;
    if (currentSlide !== MASTER_PLACEHOLDER_SLIDE) return currentSlide;
    const fromReport = resolveMasterSlideNo(String(formData?.reportType ?? '').trim().toLowerCase());
    return fromReport ?? currentSlide;
  }, [currentSlide, formData?.reportType]);

  useEffect(() => {
    if (currentSlide !== MASTER_PLACEHOLDER_SLIDE) return;
    const target = resolveMasterSlideNo(String(formData?.reportType ?? '').trim().toLowerCase());
    if (target != null && target !== MASTER_PLACEHOLDER_SLIDE && target !== currentSlide) {
      setCurrentSlide(target);
    }
  }, [currentSlide, formData?.reportType]);

  useEffect(() => {
    if (currentSlide !== UTILITIES_PLACEHOLDER_SLIDE) return;
    const target = resolveUtilitiesSlideNo(String(formData?.reportType ?? '').trim().toLowerCase());
    if (target != null && target !== UTILITIES_PLACEHOLDER_SLIDE && target !== currentSlide) {
      setCurrentSlide(target);
    }
  }, [currentSlide, formData?.reportType]);

  useEffect(() => {
    if (currentSlide !== INCOME_TAX_PLACEHOLDER_SLIDE) return;
    const target = resolveIncomeTaxSlideNo(String(formData?.reportType ?? '').trim().toLowerCase());
    if (target != null && target !== INCOME_TAX_PLACEHOLDER_SLIDE && target !== currentSlide) {
      setCurrentSlide(target);
    }
  }, [currentSlide, formData?.reportType]);
  const handleNewYearCreated = async (yearRow) => {
    const code = formData.comp_code ?? formData.COMP_CODE;
    try {
      const response = await axios.get(apiUrl(API_BASE, '/api/years'), {
        params: { comp_code: code },
        withCredentials: true,
      });
      setYears(response.data || []);
    } catch (_) {
      /* years list refresh is best-effort */
    }
    const uid = yearRow?.COMP_UID ?? yearRow?.comp_uid;
    const yr = yearRow?.COMP_YEAR ?? yearRow?.comp_year;
    const sDt = yearRow?.COMP_S_DT ?? yearRow?.comp_s_dt;
    const eDt = yearRow?.COMP_E_DT ?? yearRow?.comp_e_dt;
    if (
      window.confirm(
        `New year ${yr} prepared (comp_uid ${uid}).\n\nSwitch to this financial year now?`
      )
    ) {
      setFormData((prev) => ({
        ...prev,
        comp_uid: uid,
        comp_year: yr,
        comp_s_dt: sDt,
        comp_e_dt: eDt,
      }));
    } else {
      alert('New year books prepared. Use Change Year in Utilities to open the new financial year.');
    }
    setCurrentSlide(3);
  };

  const handleSlide3Next = (data) => {
    const reportType = String(data?.reportType ?? '').trim().toLowerCase();
    if (reportType === 'ledger' || reportType === 'ledger-interest') {
      setFormData((prev) => {
        const { ledgerDrilldown, ...rest } = prev;
        return { ...rest, ...data, ledgerReturnSlide: 3 };
      });
      setCurrentSlide(5);
      return;
    }
    setFormData((prev) => ({ ...prev, ...data }));
    if (reportType === 'complete-ledger') setCurrentSlide(56);
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
    else if (reportType === 'hsn-purchase') setCurrentSlide(17);
    else if (reportType === 'state-wise-sales') setCurrentSlide(21);
    else if (reportType === 'state-wise-purchase') setCurrentSlide(22);
    else if (reportType === 'trading-ac') setCurrentSlide(18);
    else if (reportType === 'pl-profit-loss') setCurrentSlide(19);
    else if (reportType === 'balance-sheet') setCurrentSlide(20);
    else if (reportType === 'sale-chart' || reportType === 'sale-graph') setCurrentSlide(33);
    else if (reportType === 'overdue-customers') setCurrentSlide(34);
    else if (reportType === 'trial-balance-summary') setCurrentSlide(80);
    else if (reportType === 'trial-date-wise') setCurrentSlide(81);
    else if (reportType === 'user-master') setCurrentSlide(32);
    else {
      const utilItem = findUtilitiesModuleItem(reportType);
      if (utilItem) {
        if (utilItem.logout) {
          setAuthenticated(false);
          setLoginUserName('');
          setCompanies([]);
          setYears([]);
          safeStorageRemove(AUTH_STORAGE_KEY);
          setCurrentSlide(utilItem.navSlide || 1);
          return;
        }
        if (utilItem.navSlide) {
          if (utilItem.id === 'change-company' || utilItem.id === 'change-year') {
            bumpCompaniesCatalog();
          }
          setCurrentSlide(utilItem.navSlide);
          return;
        }
        if (utilItem.slide) {
          if (isUtilityDesktopOnlyBlocked(utilItem)) {
            alert(utilityDesktopOnlyMessage(utilItem));
            return;
          }
          setCurrentSlide(utilItem.slide);
          return;
        }
        setCurrentSlide(UTILITIES_PLACEHOLDER_SLIDE);
        return;
      }
      const incomeTaxItem = findIncomeTaxModuleItem(reportType);
      if (incomeTaxItem) {
        setCurrentSlide(INCOME_TAX_REPORT_SLIDE);
        return;
      }
      const masterSlide = resolveMasterSlideNo(reportType);
      if (masterSlide != null) setCurrentSlide(masterSlide);
      else setCurrentSlide(4);
    }
  };

  const openCustomerLedgerFromOverdue = (payload) => {
    setFormData((prev) => ({
      ...prev,
      reportType: 'customer-ledger',
      customerLedgerDrilldown: {
        code: payload.code,
        name: payload.name || '',
        city: payload.city || '',
        asOfDate: payload.asOfDate,
        returnReport: 'overdue-customers',
        returnSlide: 34,
        autoRun: true,
        at: Date.now(),
      },
    }));
    setCurrentSlide(6);
  };

  const backFromCustomerLedger = () => {
    if (formData.customerLedgerDrilldown?.returnReport === 'overdue-customers') {
      setFormData((prev) => {
        const { customerLedgerDrilldown, ...rest } = prev;
        return { ...rest, reportType: 'overdue-customers' };
      });
      setCurrentSlide(34);
      return;
    }
    setCurrentSlide(3);
  };

  const openAccountMasterFromTrialDiff = (payload) => {
    setFormData((prev) => ({
      ...prev,
      reportType: 'account-master',
      accountMasterDrilldown: {
        code: String(payload?.code ?? '').trim(),
        autoEdit: payload?.autoEdit !== false,
        returnSlide: 58,
        returnTab: String(payload?.tab ?? 'missing_schedule'),
        at: Date.now(),
      },
    }));
    setCurrentSlide(26);
  };

  const backFromAccountMaster = () => {
    const d = formData.accountMasterDrilldown;
    if (d?.returnSlide === 58) {
      setFormData((prev) => {
        const { accountMasterDrilldown, ...rest } = prev;
        return {
          ...rest,
          reportType: 'trial-difference',
          trialDifferenceReturnTab: accountMasterDrilldown?.returnTab || 'missing_schedule',
        };
      });
      setCurrentSlide(58);
      return;
    }
    setCurrentSlide(3);
  };

  const openLedgerFromTrialDiff = (payload) => {
    setFormData((prev) => {
      const { ledgerReturnSlide, ...rest } = prev;
      return {
        ...rest,
        reportType: 'ledger',
        ledgerDrilldown: {
          code: String(payload?.code ?? '').trim(),
          autoRun: true,
          returnSlide: 58,
          returnTab: String(payload?.tab ?? 'missing_code_in_master'),
          at: Date.now(),
        },
      };
    });
    setCurrentSlide(5);
  };

  const openLedgerFromIncomeTax = (payload) => {
    setFormData((prev) => {
      const { ledgerReturnSlide, ...rest } = prev;
      return {
        ...rest,
        reportType: 'ledger',
        ledgerDrilldown: {
          code: String(payload?.code ?? '').trim(),
          autoRun: true,
          returnSlide: INCOME_TAX_REPORT_SLIDE,
          incomeTaxReportType: String(payload?.reportType ?? rest.reportType ?? '').trim(),
          startDate: payload?.sdt,
          endDate: payload?.edt,
          at: Date.now(),
        },
      };
    });
    setCurrentSlide(5);
  };

  const backFromLedger = () => {
    const d = formData.ledgerDrilldown;
    const returnSlide = d?.returnSlide ?? formData.ledgerReturnSlide ?? 3;
    if (returnSlide === INCOME_TAX_REPORT_SLIDE) {
      setFormData((prev) => {
        const { ledgerDrilldown, ledgerReturnSlide, ...rest } = prev;
        const rt = ledgerDrilldown?.incomeTaxReportType || rest.reportType;
        return { ...rest, reportType: rt };
      });
      setCurrentSlide(INCOME_TAX_REPORT_SLIDE);
      return;
    }
    if (returnSlide === 58) {
      setFormData((prev) => {
        const { ledgerDrilldown, ledgerReturnSlide, ...rest } = prev;
        return {
          ...rest,
          reportType: 'trial-difference',
          trialDifferenceReturnTab: ledgerDrilldown?.returnTab || 'missing_code_in_master',
        };
      });
      setCurrentSlide(58);
      return;
    }
    setFormData((prev) => {
      const { ledgerDrilldown, ledgerReturnSlide, ...rest } = prev;
      if (returnSlide === 4) {
        return { ...rest, reportType: 'trial-balance' };
      }
      return rest;
    });
    setCurrentSlide(returnSlide);
  };

  const openSaleListFromChart = (payload) => {
    setFormData((prev) => ({
      ...prev,
      reportType: 'sale-list',
      saleChartDrilldown: {
        startDate: payload.startDate,
        endDate: payload.endDate,
        itemCode: payload.itemCode || '',
        itemName: payload.itemName || '',
        monthLabel: payload.monthLabel || '',
        autoRun: true,
        at: Date.now(),
      },
    }));
    setCurrentSlide(8);
  };

  const handlePrev = () => setCurrentSlide(prev => prev - 1);

  const handleExitApp = () => {
    if (!window.confirm('Exit the application?')) return;
    setAuthenticated(false);
    setLoginUserName('');
    setCompanies([]);
    setYears([]);
    setCurrentSlide(1);
    safeStorageRemove(AUTH_STORAGE_KEY);
    performExitWindow();
  };

  const handleReset = () => {
    bumpCompaniesCatalog();
    setCurrentSlide(1);
    setYears([]);
  };

  /** Master screens: Home = reports menu (not company/year). */
  const handleResetToMenu = () => setCurrentSlide(3);

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
      const normalized = transcript
        .replace(/[&]/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const openReportByVoice = (reportType, slideNo, title) => {
        if (!authenticated || !formData.comp_uid) {
          alert(`Please select company and financial year before opening ${title}.`);
          return true;
        }
        const utilItem = findUtilitiesModuleItem(reportType);
        if (utilItem?.logout) {
          setAuthenticated(false);
          setLoginUserName('');
          setCompanies([]);
          setYears([]);
          safeStorageRemove(AUTH_STORAGE_KEY);
          setFormData((prev) => ({ ...prev, reportType }));
          setCurrentSlide(utilItem.navSlide || 1);
          return true;
        }
        if (isUtilityDesktopOnlyBlocked(utilItem)) {
          alert(utilityDesktopOnlyMessage(utilItem));
          return true;
        }
        const utilitySlide = resolveUtilitiesSlideNo(reportType);
        const masterSlide = resolveMasterSlideNo(reportType);
        const targetSlide = utilitySlide ?? masterSlide ?? slideNo;
        setFormData((prev) => {
          const { ledgerDrilldown, ...rest } = prev;
          const next = { ...rest, reportType };
          if (reportType === 'ledger' || reportType === 'ledger-interest') {
            next.ledgerReturnSlide = currentSlide;
          }
          return next;
        });
        setCurrentSlide(targetSlide);
        return true;
      };

      const voiceCommands = [
        { phrases: ['open trial balance', 'trial balance'], reportType: 'trial-balance', slideNo: 4, title: 'Trial Balance' },
        { phrases: ['open ledger with interest', 'ledger with interest'], reportType: 'ledger-interest', slideNo: 5, title: 'Ledger With Interest' },
        { phrases: ['open complete ledger', 'complete ledger'], reportType: 'complete-ledger', slideNo: 56, title: 'Complete Ledger' },
        { phrases: ['open ledger', 'ledger'], reportType: 'ledger', slideNo: 5, title: 'Ledger' },
        { phrases: ['open customer ledger', 'customer ledger'], reportType: 'customer-ledger', slideNo: 6, title: 'Customer Ledger' },
        { phrases: ['open supplier ledger', 'supplier ledger'], reportType: 'supplier-ledger', slideNo: 6, title: 'Supplier Ledger' },
        { phrases: ['open broker wise outstanding', 'broker wise outstanding', 'open broker outstanding', 'broker outstanding'], reportType: 'broker-os', slideNo: 7, title: 'Broker Wise Outstanding' },
        { phrases: ['open sale bill printing', 'sale bill printing', 'open sale bill'], reportType: 'sale-bill-printing', slideNo: 13, title: 'Sale Bill Printing' },
        { phrases: ['open stock summary', 'stock summary', 'open stock sum', 'stock sum'], reportType: 'stock-sum', slideNo: 9, title: 'Stock Summary' },
        { phrases: ['open stock lot wise', 'stock lot wise', 'open stock lot', 'stock lot'], reportType: 'stock-lot', slideNo: 10, title: 'Stock Lot Wise' },
        { phrases: ['open ageing report', 'ageing report', 'aging report', 'open aging report'], reportType: 'ageing', slideNo: 12, title: 'Ageing Report' },
        { phrases: ['open purchase list', 'purchase list'], reportType: 'purchase-list', slideNo: 11, title: 'Purchase List' },
        { phrases: ['open voucher list', 'voucher list'], reportType: 'voucher-list', slideNo: 14, title: 'Voucher List' },
        { phrases: ['open gstr1', 'gstr1', 'open gstr 1', 'gstr 1'], reportType: 'gstr1', slideNo: 15, title: 'GSTR1' },
        { phrases: ['open hsn sales', 'hsn sales', 'open hsn sale', 'hsn sale'], reportType: 'hsn-sales', slideNo: 16, title: 'HSN Sales' },
        { phrases: ['open hsn purchase', 'hsn purchase', 'open hsn purchases', 'hsn purchases'], reportType: 'hsn-purchase', slideNo: 17, title: 'HSN Purchase' },
        { phrases: ['open state wise sales', 'state wise sales', 'state sales', 'open state sales'], reportType: 'state-wise-sales', slideNo: 21, title: 'State Wise Sales' },
        { phrases: ['open state wise purchase', 'state wise purchase', 'state purchase', 'open state purchase'], reportType: 'state-wise-purchase', slideNo: 22, title: 'State Wise Purchase' },
        { phrases: ['open trading account', 'trading account', 'open trading a c', 'trading a c'], reportType: 'trading-ac', slideNo: 18, title: 'Trading Account' },
        { phrases: ['open p and l', 'p and l', 'open profit and loss', 'profit and loss', 'open p l', 'p l'], reportType: 'pl-profit-loss', slideNo: 19, title: 'P&L' },
        { phrases: ['open balance sheet', 'balance sheet'], reportType: 'balance-sheet', slideNo: 20, title: 'Balance Sheet' },
        { phrases: ['open sale chart', 'sale chart', 'open sale graph', 'sale graph'], reportType: 'sale-chart', slideNo: 33, title: 'Sale Chart' },
        { phrases: ['open overdue customers', 'overdue customers', 'overdue customer'], reportType: 'overdue-customers', slideNo: 34, title: 'Overdue Customers' },
        { phrases: ['open account master', 'account master', 'open a c master', 'a c master', 'ac master'], reportType: 'account-master', slideNo: 26, title: 'A/c Master' },
        { phrases: ['open item master', 'item master'], reportType: 'item-master', slideNo: 27, title: 'Item Master' },
        { phrases: ['open schedule master', 'schedule master'], reportType: 'schedule-master', slideNo: 29, title: 'Schedule Master' },
        { phrases: ['open item category master', 'item category master', 'category master', 'cat mast', 'catmast'], reportType: 'item-category-master', slideNo: 30, title: 'Item Category Master' },
        { phrases: ['open item group master', 'item group master', 'item group', 'do form cat'], reportType: 'item-group-master', slideNo: 31, title: 'Item Group Master' },
        { phrases: ['open user master', 'user master', 'do form user'], reportType: 'user-master', slideNo: 32, title: 'User Master' },
        { phrases: ['open user password', 'user password', 'change password', 'do form password'], reportType: 'user-password', slideNo: 35, title: 'User Password' },
        { phrases: ['open godown master', 'godown master'], reportType: 'godown-master', slideNo: 28, title: 'Godown Master' },
        { phrases: ['open master module', 'master module'], reportType: 'account-master', slideNo: 3, title: 'Master' },
        { phrases: ['open utilities', 'utilities module', 'open utilities module'], reportType: 'change-year', slideNo: 3, title: 'Utilities' },
        { phrases: ['change year', 'open change year'], reportType: 'change-year', slideNo: 2, title: 'Change Year' },
        { phrases: ['change company', 'open change company'], reportType: 'change-company', slideNo: 1, title: 'Change Company' },
        { phrases: ['change user', 'open change user'], reportType: 'change-user', slideNo: 1, title: 'Change User' },
        { phrases: ['new year books', 'open new year books', 'prepare new year', 'prepare new year books'], reportType: 'new-year-books', slideNo: 50, title: 'New Year Books' },
      ];

      for (const cmd of voiceCommands) {
        if (cmd.phrases.some((phrase) => normalized.includes(phrase))) {
          openReportByVoice(cmd.reportType, cmd.slideNo, cmd.title);
          return;
        }
      }
      alert(`Voice command not recognized: ${transcript || 'no speech detected'}`);
    };
    recognition.start();
  };

  const applyApiOverride = () => {
    saveApiBaseOverride(apiOverrideDraft);
    setShowViewSettings(false);
    window.location.reload();
  };

  const clearApiOverride = () => {
    saveApiBaseOverride('');
    setApiOverrideDraft('');
    setShowViewSettings(false);
    window.location.reload();
  };

  const renderViewSettings = () => (
    <div className="view-settings">
      <button
        type="button"
        className="toolbar-icon-btn toolbar-icon-btn--settings view-settings-btn"
        onClick={() => {
          setShowViewSettings((prev) => !prev);
          if (!showViewSettings) setApiOverrideDraft(readApiBaseOverride());
        }}
        title="Settings"
        aria-label="Settings"
      >
        <IconSettings />
      </button>
      {showViewSettings ? (
        <div className="view-settings-menu">
          <p className="view-settings-menu__hint">
            API: {formatApiBaseForDisplay(API_BASE)}
          </p>
          <label className="view-settings-menu__label" htmlFor="gfas-api-override">
            API server (optional)
          </label>
          <input
            id="gfas-api-override"
            type="url"
            className="view-settings-menu__input"
            placeholder="http://192.168.1.10:5002"
            value={apiOverrideDraft}
            onChange={(e) => setApiOverrideDraft(e.target.value)}
          />
          <button type="button" className="view-settings-option view-settings-menu__apply" onClick={applyApiOverride}>
            Save API &amp; reload
          </button>
          {readApiBaseOverride() ? (
            <button type="button" className="view-settings-option" onClick={clearApiOverride}>
              Clear API override
            </button>
          ) : null}
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

  const flowHeaderActions = (
    <>
      {renderViewSettings()}
      {voiceSupported ? (
        <button
          type="button"
          className={`toolbar-icon-btn toolbar-icon-btn--voice voice-command-btn${
            voiceListening ? ' voice-command-btn--listening toolbar-icon-btn--listening' : ''
          }`}
          onClick={handleVoiceCommand}
          title={voiceListening ? 'Listening…' : 'Voice command'}
          aria-label={voiceListening ? 'Listening for voice command' : 'Voice command'}
        >
          <IconVoice />
        </button>
      ) : null}
    </>
  );

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

  const hideAppHeaderChrome = authenticated && currentSlide >= 1;
  const useWindalInitial =
    !authenticated || (authenticated && currentSlide >= 1 && currentSlide <= 2);
  const useWindalDashboard = authenticated && currentSlide === 3;
  /** All report screens after the menu (not login/company/year/dashboard). */
  const useFasFlowFullScreen = authenticated && currentSlide > 3;
  const useLedgerFullBleed = authenticated && (currentSlide === 4 || currentSlide === 5);
  const appClassName = `app ${viewMode === 'desktop' ? 'app--desktop' : 'app--mobile'}${hideAppHeaderChrome ? ' app--no-header' : ''}${useWindalInitial ? ' app--windal-initial' : ''}${useWindalDashboard ? ' app--windal-dashboard' : ''}${useFasFlowFullScreen ? ' app--fas-flow' : ''}${useLedgerFullBleed ? ' app--ledger-full-bleed' : ''}`;

  if (!clientGuardChecked) {
    return (
      <>
      <div className={appClassName}>
        <main className="app-main">
          <div className="app-loading">
            <h2>Verifying client route...</h2>
          </div>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  if (clientGuardMismatch) {
    return (
      <>
      <div className={appClassName}>
        <main className="app-main">
          <section className="slide startup-mode-card">
            <h2>Client Route Mismatch</h2>
            <p className="startup-mode-subtitle">
              This host is mapped to a different backend client. Access is blocked to avoid cross-client data mix.
            </p>
            <p><strong>Host client:</strong> {clientGuardMismatch.expectedClient}</p>
            <p><strong>Connected backend:</strong> {clientGuardMismatch.actualClient}</p>
            <p>Please fix Cloudflare/Tunnel hostname mapping for this domain.</p>
          </section>
        </main>
      </div>
      {renderDeployUpdateModal()}
      </>
    );
  }

  if (!authenticated) {
    return (
      <>
      <div className={appClassName}>
        <main className="app-main">
          <LoginSlide
            apiBase={API_BASE}
            onSuccess={handleLoginSuccess}
            onExit={exitApp}
            settingsSlot={renderViewSettings()}
          />
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
        {renderMinimalHeaderActions()}
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
      {!hideAppHeaderChrome ? (
      <header className="app-header app-header--minimal">
        <div className="app-header-actions">{flowHeaderActions}</div>
      </header>
      ) : null}

      <AppSessionContext.Provider value={{ formData, userName: loginUserName, headerActions: flowHeaderActions }}>
      <main className={`app-main${useLedgerFullBleed ? ' app-main--ledger-full-bleed' : ''}`}>
        {MASTER_SLIDE_NOS.has(currentSlide) ? (
          <MasterSlideErrorBoundary
            onMenu={handleResetToMenu}
            key={`master-${activeMasterSlide}-${formData?.reportType ?? ''}`}
          >
            {activeMasterSlide === 26 && (
              <Slide26AccountMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={backFromAccountMaster}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 27 && (
              <Slide27ItemMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 28 && (
              <Slide28MasterPlaceholder
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 29 && (
              <Slide29ScheduleMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 30 && (
              <Slide30CatMastMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 31 && (
              <Slide31ItemGrpMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 32 && (
              <Slide32UserMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 36 && (
              <Slide33BikriExpMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 35 && (
              <Slide35UserPassword
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 37 && (
              <Slide37GodownRentMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 38 && (
              <Slide38GodownMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 39 && (
              <Slide39CostCentreMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 40 && (
              <Slide40CustomerInterest
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 41 && (
              <Slide41HolidayMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 42 && (
              <Slide42DaneMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 43 && (
              <Slide43MarkaMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 44 && (
              <Slide44PurchaseExpMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 45 && (
              <Slide45SaleBillCondition
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 46 && (
              <Slide46LocationBType
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 47 && (
              <Slide47DetailMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
            {activeMasterSlide === 48 && (
              <Slide48GstStateMaster
                apiBase={API_BASE}
                formData={formData}
                userName={loginUserName}
                onPrev={() => setCurrentSlide(3)}
                onReset={handleResetToMenu}
              />
            )}
          </MasterSlideErrorBoundary>
        ) : (
        <Suspense fallback={<SlideRouteFallback />}>
        {currentSlide === 1 && (
          <Slide1
            apiBase={API_BASE}
            companies={companies}
            refreshKey={companiesRevision}
            onNext={handleSlide1Next}
            onExit={handleExitApp}
            userName={loginUserName}
            onCompaniesLoaded={handleCompaniesLoaded}
            flowHeaderActions={flowHeaderActions}
          />
        )}
        {currentSlide === 2 && (
          <Slide2
            apiBase={API_BASE}
            years={years}
            refreshKey={companiesRevision}
            formData={formData}
            onPrev={handlePrev}
            onNext={handleSlide2Next}
            onYearsLoaded={handleYearsLoaded}
            flowHeaderActions={flowHeaderActions}
          />
        )}
        {currentSlide === 3 && (
          <Slide3 formData={formData} onPrev={handlePrev} onNext={handleSlide3Next} onExit={handleExitApp} />
        )}
        {currentSlide === 4 && (
          <Slide4 apiBase={API_BASE} formData={formData} viewMode={viewMode} onPrev={handlePrev} onReset={handleReset} />
        )}
        {currentSlide === 5 && (
          <Slide5 apiBase={API_BASE} formData={formData} viewMode={viewMode} onPrev={backFromLedger} onReset={handleReset} />
        )}
        {currentSlide === 6 && (
          <Slide6 apiBase={API_BASE} formData={formData} onPrev={backFromCustomerLedger} onReset={handleReset} />
        )}
        {currentSlide === 7 && (
          <Slide7 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 8 && (
          <Slide8 apiBase={API_BASE} formData={formData} viewMode={viewMode} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
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
          <Slide13 apiBase={API_BASE} formData={formData} viewMode={viewMode} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 14 && (
          <Slide14 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 15 && (
          <Slide15 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 16 && (
          <Slide16 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} reportMode="sales" />
        )}
        {currentSlide === 17 && (
          <Slide16 apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} reportMode="purchase" />
        )}
        {currentSlide === 21 && (
          <Slide21StateWiseSales
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 22 && (
          <Slide22StateWisePurchase
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 18 && (
          <Slide17TradingAc apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 19 && (
          <Slide18PlProfitLoss apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 20 && (
          <Slide19BalanceSheet apiBase={API_BASE} formData={formData} onPrev={() => setCurrentSlide(3)} onReset={handleReset} />
        )}
        {currentSlide === 33 && (
          <Slide33SaleGraph
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
            onOpenSaleList={openSaleListFromChart}
          />
        )}
        {currentSlide === 34 && (
          <Slide34OverdueCustomers
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
            onOpenCustomerLedger={openCustomerLedgerFromOverdue}
          />
        )}
        {currentSlide === UTILITIES_PLACEHOLDER_SLIDE && (
          <Slide49UtilitiesPlaceholder
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleResetToMenu}
            onNavigateSlide={setCurrentSlide}
          />
        )}
        {currentSlide === 50 && (
          <Slide50NewYearBooks
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleResetToMenu}
            onYearCreated={handleNewYearCreated}
          />
        )}
        {currentSlide === 51 && (
          <Slide51PrimaryKey
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleResetToMenu}
          />
        )}
        {currentSlide === 52 && (
          <Slide52SetFunction
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleResetToMenu}
          />
        )}
        {currentSlide === 53 && (
          <Slide53TakajaQuery
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleResetToMenu}
          />
        )}
        {currentSlide === 54 && (
          <DesktopOnlyUtilityGate
            utilityId="opening-bills-detail"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide54OpeningBillsDetail
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onReset={handleResetToMenu}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 55 && (
          <DesktopOnlyUtilityGate
            utilityId="interest-transfer"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide55InterestTransfer
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onReset={handleResetToMenu}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 56 && (
          <Slide56CompleteLedger
            apiBase={API_BASE}
            formData={formData}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleResetToMenu}
          />
        )}
        {currentSlide === 57 && (
          <DesktopOnlyUtilityGate
            utilityId="square-up-accounts"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide57SquareUpAccounts
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 58 && (
          <Slide58TrialDifference
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onOpenAccountMaster={(code, tab) => openAccountMasterFromTrialDiff({ code, tab })}
            onOpenLedger={(code, tab) => openLedgerFromTrialDiff({ code, tab })}
          />
        )}
        {currentSlide === 59 && (
          <DesktopOnlyUtilityGate
            utilityId="merging-of-accounts"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide59AccountMerge
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 60 && (
          <DesktopOnlyUtilityGate
            utilityId="bikri-no-merging"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide60BikriNoMerge
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 61 && (
          <DesktopOnlyUtilityGate
            utilityId="bikri-no-trf-to-lot"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide61BikriLotMerge
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 62 && (
          <DesktopOnlyUtilityGate
            utilityId="shortage-transfer"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide62ShortageTransfer
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 63 && (
          <DesktopOnlyUtilityGate
            utilityId="unused-account-list"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide63UnusedAccountList
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 64 && (
          <DesktopOnlyUtilityGate
            utilityId="unused-cost-centre-codes"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide64UnusedCostCentreCodes
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 65 && (
          <DesktopOnlyUtilityGate
            utilityId="unused-godown-codes"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide65UnusedGodownCodes
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 66 && (
          <DesktopOnlyUtilityGate
            utilityId="missing-codes"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide66MissingCodes
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 67 && (
          <DesktopOnlyUtilityGate
            utilityId="brok-find"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide67BrokFind
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 68 && (
          <DesktopOnlyUtilityGate
            utilityId="dane-find"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide68DaneFind
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 69 && (
          <DesktopOnlyUtilityGate
            utilityId="stock-transfer"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide69StockTransfer
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 70 && (
          <DesktopOnlyUtilityGate
            utilityId="sale-transfer"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide70SaleTransfer
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 71 && (
          <DesktopOnlyUtilityGate
            utilityId="voucher-transfer"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide71VoucherTransfer
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 72 && (
          <DesktopOnlyUtilityGate
            utilityId="purchase-transfer"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide72PurchaseTransfer
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 73 && (
          <DesktopOnlyUtilityGate
            utilityId="update-sale-inv-no"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide73UpdateSaleInvNo
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 74 && (
          <DesktopOnlyUtilityGate
            utilityId="update-pan-with-gstin"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide74UpdatePanWithGstIn
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 75 && (
          <Slide75UserReport
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          />
        )}
        {currentSlide === 76 && (
          <Slide76AuditTrailReport
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          />
        )}
        {currentSlide === 77 && (
          <Slide77CompanyDetailEdit
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          />
        )}
        {currentSlide === 78 && (
          <Slide78GstProfileSetting
            apiBase={API_BASE}
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          />
        )}
        {currentSlide === 79 && (
          <DesktopOnlyUtilityGate
            utilityId="updation"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide79Updation
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 82 && (
          <DesktopOnlyUtilityGate
            utilityId="updation-stock"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide82UpdationStock
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 83 && (
          <DesktopOnlyUtilityGate
            utilityId="new-company-addition"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide83NewCompanyAddition
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onCompaniesChanged={bumpCompaniesCatalog}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 84 && (
          <DesktopOnlyUtilityGate
            utilityId="set-sale-exp"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide84SetSaleExp
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onReset={handleResetToMenu}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 85 && (
          <DesktopOnlyUtilityGate
            utilityId="default-setting"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide85DefaultSetting
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onReset={handleResetToMenu}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === 86 && (
          <DesktopOnlyUtilityGate
            utilityId="set-task-scheduler"
            formData={formData}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
          >
            <Slide86SetTaskScheduler
              apiBase={API_BASE}
              formData={formData}
              userName={loginUserName}
              onPrev={() => setCurrentSlide(3)}
              onReset={handleResetToMenu}
            />
          </DesktopOnlyUtilityGate>
        )}
        {currentSlide === INCOME_TAX_REPORT_SLIDE && (
          <Slide89IncomeTaxReport
            apiBase={API_BASE}
            formData={formData}
            viewMode={viewMode}
            userName={loginUserName}
            onPrev={() => setCurrentSlide(3)}
            onOpenLedger={openLedgerFromIncomeTax}
          />
        )}
        {currentSlide === 80 && (
          <Slide80TrialBalanceSummary
            apiBase={API_BASE}
            formData={formData}
            viewMode={viewMode}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        {currentSlide === 81 && (
          <Slide81TrialDateWise
            apiBase={API_BASE}
            formData={formData}
            viewMode={viewMode}
            onPrev={() => setCurrentSlide(3)}
            onReset={handleReset}
          />
        )}
        </Suspense>
        )}
      </main>
      </AppSessionContext.Provider>
    </div>
    {renderDeployUpdateModal()}
    </>
  );
}

export default App;