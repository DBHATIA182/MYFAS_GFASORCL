const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');
const connectionConfig = require('./connection.config.json');
const app = express();

/** Default 5002 (matches vite proxy). Override: `$env:PORT=5001; node server.cjs` */
const PORT = Number(process.env.PORT) || Number(connectionConfig.local?.apiPort) || 5002;

// Oracle paths: no drive letter — same parent folder as this app (\gfasorcl\apptest → ..\oracle_bridge, TNS in \gfasorcl)
const GFASORCL_ROOT = path.join(__dirname, '..');
const CLIENT_PATH = path.join(GFASORCL_ROOT, 'oracle_bridge', 'instantclient_23_0');
const TNS_PATH = GFASORCL_ROOT;

try {
    oracledb.initOracleClient({ libDir: CLIENT_PATH, configDir: TNS_PATH });
    console.log('✅ Oracle Bridge (instant client + TNS):', CLIENT_PATH, '|', TNS_PATH);
} catch (err) {
    if (!err.message.includes('already initialized')) {
        console.error("Oracle Init Error:", err.message);
    }
}

const rootDomain = connectionConfig.domain?.rootDomain || 'fasaccountingsoftware.in';
const localOrigin = connectionConfig.local?.webOrigin;
const apiSubdomainSuffix = connectionConfig.domain?.apiSubdomainSuffix || '-api';

function normalizeClientKey(v) {
  return String(v || '').trim().toLowerCase();
}

function readClientKeyFromTunnelConfig() {
  try {
    const cfgPath = path.join(__dirname, 'config.yml');
    const txt = fs.readFileSync(cfgPath, 'utf8');
    const lines = txt.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*-\s*hostname:\s*([^\s#]+)\s*$/i);
      if (!m) continue;
      const host = String(m[1] || '').trim().toLowerCase();
      if (!host || !host.endsWith(`.${rootDomain}`)) continue;
      const sub = host.slice(0, -(`.${rootDomain}`).length);
      if (!sub) continue;
      const base = sub.split('.')[0];
      if (!base) continue;
      if (base.endsWith(apiSubdomainSuffix)) {
        return base.slice(0, -apiSubdomainSuffix.length);
      }
      return base;
    }
  } catch (_) {
    /* optional: config.yml may not exist in some deployments */
  }
  return '';
}

function resolveClientKey() {
  const explicit = normalizeClientKey(connectionConfig.clientName || connectionConfig.defaultClientKey || '');
  if (explicit && explicit !== 'auto') return explicit;
  const fromTunnel = normalizeClientKey(readClientKeyFromTunnelConfig());
  if (fromTunnel) return fromTunnel;
  return '';
}

const configuredClientName = resolveClientKey();
const autoWebOrigin = configuredClientName ? `https://${configuredClientName}.${rootDomain}` : null;
const configuredClientOrigins = Object.values(connectionConfig.clients || {})
  .map((client) => client.webOrigin)
  .filter(Boolean);
const allowedOrigins = Array.from(
  new Set([localOrigin, autoWebOrigin, ...configuredClientOrigins].filter(Boolean))
);

function isPrivateLanHostname(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h || h === 'localhost' || h === '127.0.0.1') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.hostname === rootDomain || parsed.hostname.endsWith(`.${rootDomain}`)) return true;
    // Phone/tablet on Wi‑Fi: UI at http://192.168.x.x:5173 → API at :5002
    if (isPrivateLanHostname(parsed.hostname)) return true;
    return false;
  } catch (_) {
    return false;
  }
}

// --- 2. UPDATED CORS ---
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, origin || true);
    console.warn('CORS denied:', origin || 'unknown');
    return callback(null, false);
  },
  credentials: true,
}));

app.use(express.json());

app.get('/api/client-identity', (req, res) => {
  res.json({
    ok: true,
    clientKey: String(configuredClientName || '').trim().toLowerCase(),
    rootDomain,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, port: PORT });
});

/** Merge file overrides without letting JSON null / empty wipe credentials (spread alone can set password: null). */
function mergeOracleConn(defaults, fileOverride) {
  const o = fileOverride && typeof fileOverride === 'object' ? fileOverride : {};
  const pick = (key, def) => {
    const v = o[key];
    if (v === undefined || v === null) return def;
    const s = String(v).trim();
    if (key === 'password' && s === '') return def;
    if ((key === 'user' || key === 'connectString') && s === '') return def;
    return s;
  };
  return {
    user: pick('user', defaults.user),
    password: pick('password', defaults.password),
    connectString: pick('connectString', defaults.connectString),
  };
}

function envTrim(name) {
  const v = process.env[name];
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s;
}

/** True for 1, true, yes, on (case-insensitive). */
function envTruthy(name) {
  const v = envTrim(name);
  if (!v) return false;
  return /^(1|true|yes|on)$/i.test(v);
}

/** First non-empty non-comment line from a secret file. */
function readFirstSecretLine(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return (
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#')) || ''
  );
}

/**
 * In-app "Update to latest": env GFAS_DEPLOY_UPDATE_KEY or first line of a secret file (min 8 chars).
 * Tries deploy-update-secret.txt, then deploy-update-secret.txt.txt (Notepad "double .txt" mistake).
 */
function getDeployUpdateSecret() {
  const fromEnv = envTrim('GFAS_DEPLOY_UPDATE_KEY');
  if (fromEnv) return fromEnv;
  const candidates = ['deploy-update-secret.txt', 'deploy-update-secret.txt.txt'];
  for (const name of candidates) {
    try {
      const p = path.join(__dirname, name);
      if (fs.existsSync(p)) {
        return readFirstSecretLine(p);
      }
    } catch (_) {}
  }
  return '';
}

const DEPLOY_UPDATE_SECRET = getDeployUpdateSecret();

/**
 * Skip deploy key if GFAS_DEPLOY_UPDATE_SKIP_KEY=1/true/yes/on, or if a marker file exists next to
 * server.cjs (may be empty). Checks on each request so you can add the file without restarting Node.
 * Filenames: deploy-update-no-key.txt, deploy-update-no-key.txt.txt (Notepad), or deploy-update-no-key.
 * Use only on trusted LAN / VPN.
 */
let loggedDeploySkipKey = false;
function deployUpdateSkipKeyNow() {
  if (envTruthy('GFAS_DEPLOY_UPDATE_SKIP_KEY')) {
    if (!loggedDeploySkipKey) {
      console.log('Deploy update: key check disabled (GFAS_DEPLOY_UPDATE_SKIP_KEY).');
      loggedDeploySkipKey = true;
    }
    return true;
  }
  const markerNames = ['deploy-update-no-key.txt', 'deploy-update-no-key.txt.txt', 'deploy-update-no-key'];
  for (const name of markerNames) {
    try {
      if (fs.existsSync(path.join(__dirname, name))) {
        if (!loggedDeploySkipKey) {
          console.log(`Deploy update: key check disabled (marker file ${name}).`);
          loggedDeploySkipKey = true;
        }
        return true;
      }
    } catch (_) {}
  }
  loggedDeploySkipKey = false;
  return false;
}

function deployUpdateConfigured() {
  return deployUpdateSkipKeyNow() || (DEPLOY_UPDATE_SECRET && DEPLOY_UPDATE_SECRET.length >= 8);
}

function deployKeyMatches(provided) {
  if (!DEPLOY_UPDATE_SECRET || DEPLOY_UPDATE_SECRET.length < 8) return false;
  const a = String(provided ?? '').trim();
  if (!a) return false;
  return (
    crypto.createHash('sha256').update(DEPLOY_UPDATE_SECRET, 'utf8').digest('hex') ===
    crypto.createHash('sha256').update(a, 'utf8').digest('hex')
  );
}

let deployUpdateJobLock = false;
let deployUpdateSafetyTimer = null;
const DEPLOY_LOG_PATH = path.join(__dirname, 'logs', 'deploy-update.log');

function appendDeployLogLine(msg) {
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${String(msg || '').trim()}\n`;
    fs.appendFileSync(DEPLOY_LOG_PATH, line, 'utf8');
  } catch (_) {}
}

function readDeployUpdateLogLines(maxLines = 12) {
  try {
    if (!fs.existsSync(DEPLOY_LOG_PATH)) return [];
    const raw = fs.readFileSync(DEPLOY_LOG_PATH, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if (lines.length <= maxLines) return lines;
    return lines.slice(lines.length - maxLines);
  } catch (_) {
    return [];
  }
}

function inferDeployProgress(busy, lines) {
  const text = lines.join('\n');
  const has = (needle) => text.includes(needle);
  let statusLabel = busy ? 'Update is running...' : 'Idle';
  let pct = busy ? 5 : 0;
  let isFinished = false;
  let isError = false;

  if (has('ERROR')) {
    statusLabel = 'Update failed. Check deploy-update.log.';
    pct = 100;
    isError = true;
  } else if (has('--- deploy update finished ---')) {
    statusLabel = 'Update finished. Restart sequence done.';
    pct = 100;
    isFinished = true;
  } else if (has('Starting run-autostart-stack.cmd') || has('Launcher started.')) {
    statusLabel = 'Restarting services...';
    pct = busy ? 92 : 100;
  } else if (has('Stopping Node processes for this app')) {
    statusLabel = 'Stopping old processes...';
    pct = 80;
  } else if (has('update-from-git.ps1 finished OK')) {
    statusLabel = 'Update downloaded and built.';
    pct = 65;
  } else if (has('Running update-from-git.ps1')) {
    statusLabel = 'Pulling latest code and building...';
    pct = 35;
  } else if (has('--- deploy update started ---')) {
    statusLabel = 'Update started...';
    pct = 12;
  }

  if (busy && pct >= 100) pct = 95;
  return { progressPercent: pct, statusLabel, isFinished, isError };
}

function clearDeployUpdateSafetyTimer() {
  if (deployUpdateSafetyTimer) {
    clearTimeout(deployUpdateSafetyTimer);
    deployUpdateSafetyTimer = null;
  }
}

function releaseDeployUpdateJobLock(reason) {
  clearDeployUpdateSafetyTimer();
  deployUpdateJobLock = false;
  if (reason) console.log(`deploy-update: lock released (${reason}).`);
}

function spawnDeployUpdateJob() {
  const ps1 = path.join(__dirname, 'run-deploy-update.ps1');
  const cmdWrapper = path.join(__dirname, 'run-deploy-update.cmd');
  if (!fs.existsSync(ps1)) {
    throw new Error('run-deploy-update.ps1 is missing in the application folder.');
  }
  if (!fs.existsSync(cmdWrapper)) {
    throw new Error('run-deploy-update.cmd is missing in the application folder.');
  }
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const launcherCandidates = [
    { exe: cmdWrapper, args: [], label: 'cmd-wrapper-direct', useShell: true },
    { exe: 'cmd.exe', args: ['/d', '/c', cmdWrapper], label: 'cmd-wrapper-via-cmd' },
    {
      exe: process.env.WINDIR
        ? path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      label: 'powershell-direct',
    },
  ];
  let child = null;
  let lastSpawnErr = null;
  for (const c of launcherCandidates) {
    try {
      appendDeployLogLine(
        `Deploy spawn attempt using: ${c.label} -> ${c.exe} ${Array.isArray(c.args) ? c.args.join(' ') : ''}`
      );
      const spawnOpts = {
        cwd: __dirname,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: c.useShell === true,
      };
      child = spawn(c.exe, c.args, spawnOpts);
      lastSpawnErr = null;
      break;
    } catch (err) {
      lastSpawnErr = err;
      appendDeployLogLine(`Deploy spawn failed for ${c.label}: ${err.message}`);
    }
  }
  if (!child) {
    const msg = `Could not start PowerShell for deploy update: ${lastSpawnErr?.message || 'unknown error'}`;
    appendDeployLogLine(msg);
    throw new Error(msg);
  }
  let finished = false;
  function finish(detail) {
    if (finished) return;
    finished = true;
    child.removeListener('exit', onExit);
    child.removeListener('error', onSpawnErr);
    releaseDeployUpdateJobLock(detail);
  }
  function onExit(code, signal) {
    appendDeployLogLine(`deploy-update child exited: code=${code} signal=${signal || ''}`);
    finish(`script exit code ${code}${signal ? ` signal ${signal}` : ''}`);
  }
  function onSpawnErr(err) {
    console.error('deploy-update spawn error:', err.message);
    appendDeployLogLine(`deploy-update spawn error: ${err.message}`);
    finish('spawn error');
  }
  child.once('exit', onExit);
  child.once('error', onSpawnErr);
  // If 'exit' never fires (abnormal), allow retry after 15 minutes.
  clearDeployUpdateSafetyTimer();
  deployUpdateSafetyTimer = setTimeout(() => {
    deployUpdateSafetyTimer = null;
    if (!deployUpdateJobLock) return;
    console.warn('deploy-update: safety timeout cleared job lock (check logs\\deploy-update.log).');
    releaseDeployUpdateJobLock();
  }, 900000);
  child.unref();
}

// --- 3. DATABASE CONFIG (Using "XE" alias from TNS) ---
const DB_PRIMARY = mergeOracleConn(
  { user: 'GRAINFAS', password: 'GRAINFAS', connectString: 'XE' },
  connectionConfig.oracle?.primary
);
/** Hub user for USERS / compdet when GRAIN/GRAIN@XE is valid (after GRAINFAS bootstrap). */
const DB_GRAIN = mergeOracleConn(
  { user: 'GRAIN', password: 'GRAIN', connectString: 'XE' },
  connectionConfig.oracle?.grain
);
// Optional: GFAS_ORACLE_GRAIN_USER, GFAS_ORACLE_GRAIN_PASSWORD, GFAS_ORACLE_GRAIN_CONNECT (override JSON for GRAIN only)
if (envTrim('GFAS_ORACLE_GRAIN_USER')) DB_GRAIN.user = envTrim('GFAS_ORACLE_GRAIN_USER');
if (process.env.GFAS_ORACLE_GRAIN_PASSWORD !== undefined) DB_GRAIN.password = String(process.env.GFAS_ORACLE_GRAIN_PASSWORD);
if (envTrim('GFAS_ORACLE_GRAIN_CONNECT')) DB_GRAIN.connectString = envTrim('GFAS_ORACLE_GRAIN_CONNECT');

/** If true, GRAIN hub login must succeed when DBA_USERS shows GRAIN exists; never forces GRAIN when that user is absent. */
const REQUIRE_GRAIN_HUB = Boolean(connectionConfig.oracle?.requireGrainHub);

/**
 * If false: this database has no GRAIN Oracle user — skip DBA_USERS GRAIN check and any GRAIN/GRAIN@XE connection (GRAINFAS-only, like VFP G_MAIN_DATABASE=GRAINFAS).
 * If omitted: same as true (VFP-style auto: use DBA_USERS, then GRAIN when present).
 */
const GRAIN_ORACLE_HUB_ENABLED = connectionConfig.oracle?.grainHubEnabled !== false;

let activeDbConfig = DB_PRIMARY;

function maskOracleLog(conn) {
  if (!conn || typeof conn !== 'object') return '(no config)';
  const u = conn.user != null ? String(conn.user) : '';
  const cs = conn.connectString != null ? String(conn.connectString) : '';
  return `${u}/***@${cs}`;
}

function formatOracleConnectErr(err) {
  if (!err) return '';
  const n = err.errorNum != null ? ` ORA-${err.errorNum}` : '';
  return `${err.message || err}${n}`;
}

function isEffectiveCompUid(schema) {
  if (schema == null) return false;
  const s = String(schema).trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (low === 'null' || low === 'undefined') return false;
  return true;
}

function isDbaUsersProbeSkipped(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-01031') ||
    /table or view does not exist/i.test(msg) ||
    /insufficient privileges/i.test(msg)
  );
}

/**
 * VFP9-style bootstrap (database_check.prg): connect GRAINFAS, then
 *   SELECT USERNAME FROM DBA_USERS WHERE USERNAME = 'GRAIN'
 * If _TALLY = 0 → G_MAIN_DATABASE = GRAINFAS (hub stays GRAINFAS; do not open GRAIN).
 * If row exists → G_MAIN_DATABASE = GRAIN (open GRAIN/GRAIN@XE for hub).
 * If DBA_USERS is not visible to GRAINFAS, probe is skipped (unknown) and GRAIN is still attempted.
 * Set oracle.grainHubEnabled=false for databases that only have GRAINFAS (no GRAIN Oracle user).
 */
async function resolveActiveDbConfig() {
  let primaryConn;
  /** @type {boolean|null} null = could not read DBA_USERS */
  let grainInDba = null;

  try {
    primaryConn = await oracledb.getConnection(DB_PRIMARY);
    console.log(`📌 Hub Oracle bootstrap (VFP9): GRAINFAS as ${maskOracleLog(DB_PRIMARY)}`);

    if (!GRAIN_ORACLE_HUB_ENABLED) {
      try {
        await primaryConn.close();
      } catch (closeErr) {
        console.warn('⚠️ Closing GRAINFAS session:', closeErr.message);
      }
      primaryConn = null;
      console.log('📌 oracle.grainHubEnabled: false — GRAINFAS-only hub (no GRAIN Oracle user / no GRAIN@XE attempt).');
      return DB_PRIMARY;
    }

    try {
      const dba = await primaryConn.execute(
        `SELECT USERNAME FROM DBA_USERS WHERE USERNAME = 'GRAIN'`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      grainInDba = Array.isArray(dba.rows) && dba.rows.length > 0;
      console.log(
        grainInDba
          ? '📌 DBA_USERS: Oracle user GRAIN exists → hub = GRAIN (same as G_MAIN_DATABASE in VFP9).'
          : '📌 DBA_USERS: Oracle user GRAIN missing → hub = GRAINFAS (same as G_MAIN_DATABASE in VFP9).'
      );
    } catch (err) {
      if (isDbaUsersProbeSkipped(err)) {
        grainInDba = null;
        console.warn('⚠️ DBA_USERS not available to GRAINFAS; VFP-style GRAIN check skipped:', err.message);
        console.warn('   Will attempt GRAIN/GRAIN@XE anyway (if it fails, hub stays GRAINFAS).');
      } else {
        throw err;
      }
    }

    try {
      await primaryConn.close();
    } catch (closeErr) {
      console.warn('⚠️ Closing GRAINFAS session after DBA_USERS probe:', closeErr.message);
    }
    primaryConn = null;
  } catch (err) {
    if (primaryConn) {
      try {
        await primaryConn.close();
      } catch (_) {}
      primaryConn = null;
    }
    throw new Error(`GRAINFAS hub login failed: ${formatOracleConnectErr(err)}`);
  }

  if (grainInDba === false) {
    console.log('📌 Hub Oracle user: GRAINFAS only (no GRAIN account on this database per DBA_USERS).');
    return DB_PRIMARY;
  }

  let grainConn;
  try {
    grainConn = await oracledb.getConnection(DB_GRAIN);
    console.log(
      `📌 Hub Oracle user: GRAIN as ${maskOracleLog(DB_GRAIN)} — companies, years, login (USERS) until comp_uid is selected.`
    );
    return DB_GRAIN;
  } catch (err) {
    const detail = formatOracleConnectErr(err);
    console.error('❌ GRAIN/GRAIN@XE hub login failed:', detail);
    console.error(`   Attempted GRAIN as ${maskOracleLog(DB_GRAIN)}`);
    console.error('   Fix: oracle.grain, GFAS_ORACLE_GRAIN_*, E:\\GFASORCL\\sqlnet.ora (SQLNET.ALLOWED_LOGON_VERSION_CLIENT=8 for Oracle 10g).');
    const mustUseGrain = REQUIRE_GRAIN_HUB && grainInDba === true;
    if (mustUseGrain) {
      throw new Error(
        `oracle.requireGrainHub: DBA_USERS shows GRAIN exists but GRAIN login failed: ${detail}`
      );
    }
    if (REQUIRE_GRAIN_HUB && grainInDba === null) {
      console.warn(
        '   oracle.requireGrainHub is true but DBA_USERS was not readable; allowing GRAINFAS hub fallback. Set GRAINFAS DBA or fix GRAIN login.'
      );
    }
    console.warn('   Falling back to GRAINFAS hub.');
    return DB_PRIMARY;
  } finally {
    if (grainConn) {
      try {
        await grainConn.close();
      } catch (_) {}
    }
  }
}

// --- 4. runQuery: hub user (no 3rd arg) vs company year user comp_uid/comp_uid@XE (3rd arg) ---

async function runQuery(sql, binds = {}, schema = null, executeExtra = {}) {
  let conn;
  const extra = executeExtra && typeof executeExtra === 'object' ? executeExtra : {};
  const { suppressDbErrorLog = false, hubOverride = null, ...oracleExecuteExtra } = extra;
  const hubCfg =
    hubOverride && typeof hubOverride === 'object' && hubOverride.user != null ? hubOverride : activeDbConfig;
  try {
    const compUid = isEffectiveCompUid(schema) ? String(schema).trim() : null;
    const connCfg = compUid
      ? {
          user: compUid,
          password: compUid,
          connectString: activeDbConfig.connectString,
        }
      : hubCfg;

    conn = await oracledb.getConnection(connCfg);

    const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT, ...oracleExecuteExtra };
    const result = await conn.execute(sql, binds, opts);
    return result.rows;
  } catch (err) {
    if (!suppressDbErrorLog) {
      console.error("❌ DB EXECUTION ERROR:", err.message);
    }
    throw err;
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error(e); }
    }
  }
}

function isGrainfasHubUser(connCfg) {
  return String((connCfg || activeDbConfig).user || '').toUpperCase() === 'GRAINFAS';
}

function isUnknownUsersColumnError(err) {
  const msg = String(err?.message || '');
  return msg.includes('ORA-00904') || /invalid identifier/i.test(msg);
}

function isLoginOptionalTableError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-00904') ||
    /table or view does not exist/i.test(msg) ||
    /invalid identifier/i.test(msg)
  );
}

function isOracleMissingObjectError(err) {
  return isLoginOptionalTableError(err);
}

function rightsPermissionsFromString(s, legacyFlag, flagName) {
  const str = String(s || '');
  const ch = (i) => (str.length > i ? str.charAt(i) : '');
  const bit = (i) => ch(i) === '1';
  if (!str) {
    return { canOpen: true, canAdd: true, canEdit: true, canDelete: true, flags: legacyFlag };
  }
  return {
    canOpen: bit(0),
    canAdd: bit(1),
    canEdit: bit(2),
    canDelete: bit(3),
    flags: flagName,
  };
}

function masterPartyScheduleBind(schedule) {
  const sch = Number(schedule);
  return Number.isFinite(sch) ? Math.round(sch * 100) / 100 : 0;
}

/** VFP: SCH_NO must be non-zero and not a whole number (e.g. 8.10 ok, 8 not). */
function isValidMasterScheduleNoServer(schedule) {
  const n = Number(schedule);
  if (!Number.isFinite(n) || n === 0) return false;
  return Math.abs(n - Math.trunc(n)) > 1e-9;
}

function normalizeMasterPartyCodeKey(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
}

function isValidMasterPartyCodeFormat(code) {
  const c = normalizeMasterPartyCodeKey(code);
  return /^[A-Z][0-9]{5}$/.test(c);
}

function nextMasterCodeFromLastVfp(lastCode, rangePrefix) {
  const prefix = String(rangePrefix ?? '')
    .trim()
    .toUpperCase()
    .charAt(0);
  if (!prefix) return '';
  const mcode = normalizeMasterPartyCodeKey(lastCode);
  if (!mcode) return `${prefix}00001`;
  const suffix = mcode.length >= 6 ? mcode.slice(1, 6) : mcode.slice(1);
  const num = (parseInt(suffix.replace(/\D/g, ''), 10) || 0) + 1;
  if (num > 99999) {
    const err = new Error('Maximum account code reached for this range.');
    err.status = 400;
    throw err;
  }
  return `${prefix}${String(num).padStart(5, '0')}`;
}

function scheduleMasterNumBind(no) {
  return masterPartyScheduleBind(no);
}

/** VFP: main group list shows whole-number schedules only (1, 2, 8, 12…). */
function isIntegerScheduleNo(no) {
  const x = Number(no);
  if (!Number.isFinite(x) || x === 0) return false;
  return Math.abs(x - Math.trunc(x)) < 1e-6;
}

function buildScheduleMasterSavedJson(binds) {
  const no = scheduleMasterNumBind(binds.no);
  return {
    ok: true,
    NO: no,
    no,
    NAME: binds.name,
    name: binds.name,
    RANGE: binds.range,
    range: binds.range,
    NORM_BAL: binds.norm_bal,
    norm_bal: binds.norm_bal,
    CORR_NO: binds.corr_no,
    corr_no: binds.corr_no,
  };
}

function buildScheduleMasterBinds(body, { comp_code, comp_year, parent_no }) {
  const no = scheduleMasterNumBind(body.no ?? body.NO);
  if (!no) {
    const err = new Error('Schedule number is required.');
    err.status = 400;
    throw err;
  }
  const parent = parent_no != null && String(parent_no).trim() !== '' ? scheduleMasterNumBind(parent_no) : 0;
  if (parent) {
    if (no <= parent || no >= parent + 1) {
      const err = new Error(
        `Sub-schedule must be greater than ${parent.toFixed(2)} and less than ${(parent + 1).toFixed(2)} (e.g. 8.10, 8.50).`
      );
      err.status = 400;
      throw err;
    }
  } else if (!isIntegerScheduleNo(no)) {
    const err = new Error('Main schedule number must be a whole number (e.g. 8, 12).');
    err.status = 400;
    throw err;
  }
  const name = String(body.name ?? body.NAME ?? '').trim();
  if (!name) {
    const err = new Error('Schedule name is required.');
    err.status = 400;
    throw err;
  }
  const range = String(body.range ?? body.RANGE ?? '').trim().toUpperCase();
  const normBal = String(body.norm_bal ?? body.NORM_BAL ?? '').trim().toUpperCase();
  if (normBal && normBal !== 'D' && normBal !== 'C') {
    const err = new Error('Norm balance must be D (Debit) or C (Credit).');
    err.status = 400;
    throw err;
  }
  const corrRaw = body.corr_no ?? body.CORR_NO ?? 0;
  const corr_no = corrRaw === '' || corrRaw == null ? 0 : scheduleMasterNumBind(corrRaw);
  return {
    comp_code,
    comp_year: Number(comp_year) || 0,
    no,
    name,
    range,
    norm_bal: normBal,
    corr_no,
  };
}

async function countMasterAccountsOnSchedule(comp_code, schedNo, comp_uid) {
  const sched = scheduleMasterNumBind(schedNo);
  const rows = await runQuery(
    `SELECT COUNT(*) AS CNT FROM MASTER M
     WHERE M.COMP_CODE = :comp_code AND ROUND(NVL(M.SCHEDULE, 0), 2) = :sched`,
    { comp_code, sched },
    comp_uid
  );
  return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
}

/** Each word in q must match at least one field (AND across words) — e.g. DAL + ARHAR finds "DAL ARHAR". */
function appendMasterListTokenSearch(sql, binds, qTrim, fieldExprs, bindPrefix = 'mq') {
  const tokens = String(qTrim || '')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (!tokens.length) return sql;
  const parts = [];
  for (let i = 0; i < tokens.length; i++) {
    const key = `${bindPrefix}${i}`;
    binds[key] = `%${tokens[i]}%`;
    const ors = fieldExprs.map((expr) => `${expr} LIKE :${key}`).join(' OR ');
    parts.push(`(${ors})`);
  }
  return `${sql} AND (${parts.join(' AND ')})`;
}

/** Optional MASTER code prefix: single letter (B) or CS = C+S parties, ST = S+T suppliers. */
function appendMasterCodePrefixFilter(sql, codePrefix) {
  const p = String(codePrefix ?? '').trim().toUpperCase();
  if (!p) return sql;
  if (p === 'CS' || p === 'C,S' || p === 'C|S') {
    return `${sql} AND (UPPER(SUBSTR(TRIM(M.CODE), 1, 1)) = 'C' OR UPPER(SUBSTR(TRIM(M.CODE), 1, 1)) = 'S')`;
  }
  if (p === 'ST' || p === 'S,T' || p === 'S|T') {
    return `${sql} AND (UPPER(SUBSTR(TRIM(M.CODE), 1, 1)) = 'S' OR UPPER(SUBSTR(TRIM(M.CODE), 1, 1)) = 'T')`;
  }
  if (p.length === 1) {
    return `${sql} AND UPPER(SUBSTR(TRIM(M.CODE), 1, 1)) = '${p.replace(/'/g, "''")}'`;
  }
  return sql;
}

async function fetchScheduleMasterList(comp_code, comp_uid, q, options = {}) {
  const view = String(options.view || 'all').trim().toLowerCase();
  const parentRaw = options.parent_no;
  const binds = { comp_code };
  let sql = `
    SELECT NVL(S.NO, 0) AS NO,
           NVL(S.NAME, '') AS NAME,
           NVL(S.RANGE, '') AS RANGE,
           NVL(S.NORM_BAL, '') AS NORM_BAL,
           NVL(S.CORR_NO, 0) AS CORR_NO
    FROM SCHEDULE S
    WHERE S.COMP_CODE = :comp_code`;
  if (view === 'main') {
    sql += ` AND ABS(S.NO - TRUNC(S.NO)) < 0.0001`;
  } else if (view === 'sub') {
    const parent = scheduleMasterNumBind(parentRaw);
    if (!parent) {
      const err = new Error('parent_no is required for sub-schedule list.');
      err.status = 400;
      throw err;
    }
    binds.parent = parent;
    binds.parent_hi = parent + 1;
    sql += ` AND S.NO > :parent AND S.NO < :parent_hi`;
  }
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      ['UPPER(S.NAME)', 'UPPER(TO_CHAR(S.NO))'],
      'schq'
    );
  }
  sql += ` ORDER BY S.NO, S.NAME`;
  return runQuery(sql, binds, comp_uid);
}

async function countSubSchedulesUnderMain(comp_code, parentNo, comp_uid) {
  const parent = scheduleMasterNumBind(parentNo);
  if (!parent) return 0;
  const rows = await runQuery(
    `SELECT COUNT(*) AS CNT FROM SCHEDULE S
     WHERE S.COMP_CODE = :comp_code AND S.NO > :parent AND S.NO < :parent_hi`,
    { comp_code, parent, parent_hi: parent + 1 },
    comp_uid
  );
  return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
}

async function fetchNextScheduleMasterNo(comp_code, comp_uid, parent_no) {
  const parent =
    parent_no != null && String(parent_no).trim() !== '' ? scheduleMasterNumBind(parent_no) : 0;
  if (parent) {
    const rows = await runQuery(
      `SELECT NVL(MAX(S.NO), :parent) AS MAX_NO FROM SCHEDULE S
       WHERE S.COMP_CODE = :comp_code AND S.NO > :parent AND S.NO < :parent_hi`,
      { comp_code, parent, parent_hi: parent + 1 },
      comp_uid
    );
    const maxNo = Number(rows?.[0]?.MAX_NO ?? rows?.[0]?.max_no ?? parent) || parent;
    let next = Math.round((maxNo + 0.1) * 100) / 100;
    if (next >= parent + 1) {
      next = Math.round((maxNo + 0.01) * 100) / 100;
    }
    if (next >= parent + 1) {
      next = Math.round((parent + 0.1) * 100) / 100;
    }
    return {
      next_no: next,
      NEXT_NO: next,
      parent_no: parent,
      PARENT_NO: parent,
      max_no: maxNo,
      MAX_NO: maxNo,
    };
  }
  const rows = await runQuery(
    `SELECT NVL(MAX(S.NO), 0) AS MAX_NO FROM SCHEDULE S
     WHERE S.COMP_CODE = :comp_code AND ABS(S.NO - TRUNC(S.NO)) < 0.0001`,
    { comp_code },
    comp_uid
  );
  const maxNo = Math.trunc(Number(rows?.[0]?.MAX_NO ?? rows?.[0]?.max_no ?? 0) || 0);
  const next = maxNo + 1;
  return { next_no: next, NEXT_NO: next, max_no: maxNo, MAX_NO: maxNo };
}

async function insertScheduleMasterRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      INSERT INTO SCHEDULE (COMP_CODE, COMP_YEAR, NO, NAME, RANGE, NORM_BAL, CORR_NO)
      VALUES (:comp_code, :comp_year, :no, :name, :range, :norm_bal, :corr_no)`,
      binds,
    },
    {
      sql: `
      INSERT INTO SCHEDULE (COMP_CODE, NO, NAME, RANGE, NORM_BAL, CORR_NO)
      VALUES (:comp_code, :no, :name, :range, :norm_bal, :corr_no)`,
      binds: (({ comp_year, ...rest }) => rest)(binds),
    },
    {
      sql: `
      INSERT INTO SCHEDULE (COMP_CODE, NO, NAME)
      VALUES (:comp_code, :no, :name)`,
      binds: { comp_code: binds.comp_code, no: binds.no, name: binds.name },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('SCHEDULE insert failed');
}

async function updateScheduleMasterRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      UPDATE SCHEDULE SET NAME = :name, RANGE = :range, NORM_BAL = :norm_bal, CORR_NO = :corr_no
      WHERE COMP_CODE = :comp_code AND ROUND(NVL(NO, 0), 2) = :no`,
      binds,
    },
    {
      sql: `
      UPDATE SCHEDULE SET NAME = :name
      WHERE COMP_CODE = :comp_code AND ROUND(NVL(NO, 0), 2) = :no`,
      binds: { comp_code: binds.comp_code, no: binds.no, name: binds.name },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      const verify = await runQuery(
        `SELECT COUNT(*) AS CNT FROM SCHEDULE
         WHERE COMP_CODE = :comp_code AND ROUND(NVL(NO, 0), 2) = :no AND ROWNUM = 1`,
        { comp_code: binds.comp_code, no: binds.no },
        comp_uid
      );
      const cnt = Number(verify?.[0]?.CNT ?? verify?.[0]?.cnt ?? 0);
      if (cnt < 1) {
        const err = new Error('Schedule not found.');
        err.status = 404;
        throw err;
      }
      return;
    } catch (err) {
      if (err.status === 404) throw err;
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('SCHEDULE update failed');
}

async function deleteScheduleMasterByNo(comp_code, schedNo, comp_uid) {
  const no = scheduleMasterNumBind(schedNo);
  await runQuery(
    `DELETE FROM SCHEDULE WHERE COMP_CODE = :comp_code AND ROUND(NVL(NO, 0), 2) = :no`,
    { comp_code, no },
    comp_uid,
    { autoCommit: true }
  );
}

async function fetchMasterPartyScheduleRows(comp_code, comp_uid) {
  const sqlSched = `
      SELECT NVL(S.NO, 0) AS NO, NVL(S.NAME, '') AS NAME, NVL(S.RANGE, '') AS RANGE
      FROM SCHEDULE S
      WHERE S.COMP_CODE = :comp_code
      ORDER BY S.NAME, S.NO`;
  try {
    const rows = await runQuery(sqlSched, { comp_code }, comp_uid);
    if (Array.isArray(rows) && rows.length > 0) {
      // VFP9 parity: schedules must be non-integer decimals (e.g. 8.10, not 8).
      return rows.filter((r) => isValidMasterScheduleNoServer(r.NO ?? r.no));
    }
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
  }
  const sqlMaster = `
      SELECT DISTINCT ROUND(NVL(M.SCHEDULE, 0), 2) AS NO,
             TO_CHAR(ROUND(NVL(M.SCHEDULE, 0), 2)) AS NAME,
             '' AS RANGE
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code
        AND NVL(M.SCHEDULE, 0) <> 0
      ORDER BY 1`;
  const rows = await runQuery(sqlMaster, { comp_code }, comp_uid);
  return (rows || []).filter((r) => isValidMasterScheduleNoServer(r.NO ?? r.no));
}

async function fetchMasterPartyStateRows(comp_uid, comp_code) {
  const tableSqls = [
    `SELECT TRIM(STATE) AS STATE, TRIM(STATE_CODE) AS STATE_CODE FROM GST_STATE WHERE TRIM(NVL(STATE_CODE, '')) IS NOT NULL ORDER BY STATE`,
    `SELECT TRIM(STATE) AS STATE, TRIM(STATE_CODE) AS STATE_CODE FROM STATE WHERE TRIM(NVL(STATE_CODE, '')) IS NOT NULL ORDER BY STATE`,
    `SELECT TRIM(STATE) AS STATE, TRIM(STATE_CODE) AS STATE_CODE FROM STATES WHERE TRIM(NVL(STATE_CODE, '')) IS NOT NULL ORDER BY STATE`,
  ];
  for (const sql of tableSqls) {
    try {
      const rows = await runQuery(sql, {}, comp_uid, { suppressDbErrorLog: true });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isOracleMissingObjectError(err)) throw err;
    }
  }
  if (comp_code) {
    const sqlMaster = `
        SELECT DISTINCT TRIM(M.STATE) AS STATE, TRIM(M.STATE_CODE) AS STATE_CODE
        FROM MASTER M
        WHERE M.COMP_CODE = :comp_code
          AND TRIM(NVL(M.STATE_CODE, '')) IS NOT NULL
        ORDER BY M.STATE`;
    try {
      const rows = await runQuery(sqlMaster, { comp_code }, comp_uid, { suppressDbErrorLog: true });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isOracleMissingObjectError(err)) throw err;
    }
  }
  return [];
}

async function fetchScheduleRowForMaster(comp_code, schedNo, comp_uid) {
  const sched = masterPartyScheduleBind(schedNo);
  const sql = `
    SELECT NVL(S.NAME, '') AS NAME, NVL(S.RANGE, '') AS RANGE, NVL(S.NO, 0) AS NO
    FROM SCHEDULE S
    WHERE S.COMP_CODE = :comp_code
      AND (ROUND(NVL(S.NO, 0), 2) = :sched OR NVL(S.NO, 0) = :sched_raw)
      AND ROWNUM = 1`;
  try {
    const rows = await runQuery(sql, { comp_code, sched, sched_raw: schedNo }, comp_uid);
    if (rows?.[0]) return rows[0];
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
  }
  return null;
}

/** VFP: RANGE prefix + MAX(CODE) by first character → next VARCHAR2(6) code. */
async function computeVfpMasterPartyNextCode(comp_code, comp_uid, schedNo) {
  if (!isValidMasterScheduleNoServer(schedNo)) {
    const err = new Error('Select Valid Schedule');
    err.status = 400;
    throw err;
  }
  const schedRow = await fetchScheduleRowForMaster(comp_code, schedNo, comp_uid);
  if (!schedRow) {
    const err = new Error('!!! Invalid Schedule !!!');
    err.status = 400;
    throw err;
  }
  const scheduleName = String(schedRow.NAME ?? schedRow.name ?? '').trim();
  const mrange = String(schedRow.RANGE ?? schedRow.range ?? '')
    .trim()
    .toUpperCase()
    .charAt(0);
  if (!mrange) {
    const err = new Error('Schedule has no RANGE prefix.');
    err.status = 400;
    throw err;
  }
  const maxRows = await runQuery(
    `SELECT MAX(TRIM(M.CODE)) AS CODE
     FROM MASTER M
     WHERE M.COMP_CODE = :comp_code
       AND UPPER(SUBSTR(TRIM(M.CODE), 1, 1)) = :mrange`,
    { comp_code, mrange },
    comp_uid
  );
  const lastCode = String(maxRows?.[0]?.CODE ?? maxRows?.[0]?.code ?? '').trim();
  const next_code = nextMasterCodeFromLastVfp(lastCode, mrange);
  const schedule = masterPartyScheduleBind(schedNo);
  return {
    next_code,
    NEXT_CODE: next_code,
    last_code: lastCode,
    LAST_CODE: lastCode,
    schedule_name: scheduleName,
    SCHEDULE_NAME: scheduleName,
    range_prefix: mrange,
    schedule,
  };
}

async function insertMasterPartyRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      INSERT INTO MASTER (
        COMP_CODE, COMP_YEAR, SCHEDULE, CODE, NAME, ADD1, ADD2, ADD3, CITY,
        GST_NO, STATE_CODE, STATE, PAN, TEL_NO_O, L_C, USER_NAME, ENT_DATE
      ) VALUES (
        :comp_code, :comp_year, :schedule, :code, :name, :add1, :add2, :add3, :city,
        :gst_no, :state_code, :state, :pan, :tel_no_o, :l_c, :user_name, SYSDATE
      )`,
      binds,
    },
    {
      sql: `
      INSERT INTO MASTER (
        COMP_CODE, COMP_YEAR, SCHEDULE, CODE, NAME, ADD1, ADD2, ADD3, CITY,
        GST_NO, STATE_CODE, STATE, PAN, TEL_NO_O, L_C, USER_NAME
      ) VALUES (
        :comp_code, :comp_year, :schedule, :code, :name, :add1, :add2, :add3, :city,
        :gst_no, :state_code, :state, :pan, :tel_no_o, :l_c, :user_name
      )`,
      binds,
    },
    {
      sql: `
      INSERT INTO MASTER (
        COMP_CODE, COMP_YEAR, SCHEDULE, CODE, NAME, ADD1, ADD2, ADD3, CITY,
        GST_NO, STATE_CODE, STATE, PAN, TEL_NO_O, L_C
      ) VALUES (
        :comp_code, :comp_year, :schedule, :code, :name, :add1, :add2, :add3, :city,
        :gst_no, :state_code, :state, :pan, :tel_no_o, :l_c
      )`,
      binds: (({ user_name, ...rest }) => rest)(binds),
    },
    {
      sql: `
      INSERT INTO MASTER (
        COMP_CODE, COMP_YEAR, SCHEDULE, CODE, NAME, ADD1, ADD2, ADD3, CITY,
        GST_NO, STATE_CODE, STATE, PAN, TEL_NO_O
      ) VALUES (
        :comp_code, :comp_year, :schedule, :code, :name, :add1, :add2, :add3, :city,
        :gst_no, :state_code, :state, :pan, :tel_no_o
      )`,
      binds: (({ user_name, l_c, ...rest }) => rest)(binds),
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true, suppressDbErrorLog: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('MASTER insert failed');
}

async function deleteMasterPartyByCode(comp_code, code, comp_uid) {
  const codeKey = normalizeMasterPartyCodeKey(code);
  await runQuery(
    `DELETE FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code`,
    { comp_code, code: codeKey },
    comp_uid,
    { autoCommit: true }
  );
}

function trimMasterPartyField(v, maxLen) {
  const s = String(v ?? '').trim();
  if (!maxLen || s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

function normalizeMasterPartyLc(v) {
  const x = String(v ?? 'L')
    .trim()
    .toUpperCase();
  if (x === 'C' || x === 'CENTRAL') return 'C';
  if (x === 'I' || x === 'IMPORT') return 'I';
  return 'L';
}

function buildMasterPartyInsertBinds(body, { comp_code, comp_year, user_name, schedule, codeKey }) {
  const name = trimMasterPartyField(body.name, 50).toUpperCase();
  if (!name) {
    const err = new Error('Name is required');
    err.status = 400;
    throw err;
  }
  const lcRaw = String(body.l_c ?? body.L_C ?? '').trim();
  if (!lcRaw) {
    const err = new Error('L_C (Local/Central/Import) is required. Use L, C, or I.');
    err.status = 400;
    throw err;
  }
  const code = normalizeMasterPartyCodeKey(codeKey);
  if (!isValidMasterPartyCodeFormat(code)) {
    const err = new Error('Account code must be 6 characters: 1 letter (schedule range) + 5 digits.');
    err.status = 400;
    throw err;
  }
  return {
    comp_code,
    comp_year,
    schedule,
    code,
    name,
    add1: trimMasterPartyField(body.add1, 40),
    add2: trimMasterPartyField(body.add2, 40),
    add3: trimMasterPartyField(body.add3, 40),
    city: trimMasterPartyField(body.city, 20),
    gst_no: trimMasterPartyField(body.gst_no, 15),
    state_code: trimMasterPartyField(body.state_code, 2),
    state: trimMasterPartyField(body.state, 30).toUpperCase(),
    pan: trimMasterPartyField(body.pan, 10).toUpperCase(),
    tel_no_o: trimMasterPartyField(body.tel_no_o ?? body.tel_no, 30),
    l_c: normalizeMasterPartyLc(lcRaw),
    user_name,
  };
}

function masterPartySavedJson(binds, schedule) {
  return {
    ok: true,
    CODE: binds.code,
    code: binds.code,
    NAME: binds.name,
    name: binds.name,
    CITY: binds.city,
    city: binds.city,
    GST_NO: binds.gst_no,
    gst_no: binds.gst_no,
    PAN: binds.pan,
    pan: binds.pan,
    L_C: binds.l_c,
    l_c: binds.l_c,
    SCHEDULE: schedule,
    schedule,
    ADD1: binds.add1,
    add1: binds.add1,
    ADD2: binds.add2,
    add2: binds.add2,
    ADD3: binds.add3,
    add3: binds.add3,
    STATE_CODE: binds.state_code,
    state_code: binds.state_code,
    STATE: binds.state,
    state: binds.state,
    TEL_NO_O: binds.tel_no_o,
    tel_no_o: binds.tel_no_o,
  };
}

function trimItemMasterField(v, maxLen) {
  const s = String(v ?? '').trim();
  return maxLen > 0 && s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeMasterCodeField(v) {
  const s = trimItemMasterField(v, 20).toUpperCase();
  return s === '0' ? '' : s;
}

function normalizeItemMasterRf(v) {
  const x = String(v ?? '').trim().toUpperCase();
  if (!x) return '';
  if (x === 'R' || x === 'F') return x;
  return '';
}

function normalizeItemMasterAmtCal(v) {
  const x = String(v ?? 'W').trim().toUpperCase();
  if (x !== 'Q' && x !== 'W' && x !== 'K') {
    const err = new Error('Amt basis must be Q, W, or K.');
    err.status = 400;
    throw err;
  }
  return x;
}

function normalizeItemMasterBrokCal(v) {
  const x = String(v ?? 'Q').trim().toUpperCase();
  if (x !== 'Q' && x !== 'W' && x !== 'A') {
    const err = new Error('Brok Cal must be Q, W, or A.');
    err.status = 400;
    throw err;
  }
  return x;
}

function normalizeItemMasterTdgQW(v) {
  const x = String(v ?? 'W').trim().toUpperCase();
  if (x !== 'Q' && x !== 'W') {
    const err = new Error('TDG Qty/Wgt must be Q or W.');
    err.status = 400;
    throw err;
  }
  return x;
}

function normalizeItemMasterUnitType(v) {
  const x = String(v ?? 'Q').trim().toUpperCase();
  if (x !== 'Q' && x !== 'K' && x !== 'P') {
    const err = new Error('Unit Type must be Q, K, or P.');
    err.status = 400;
    throw err;
  }
  return x;
}

function buildItemMasterInsertBinds(body, { comp_code, comp_year, user_name, itemCode }) {
  const item_code = trimItemMasterField(itemCode ?? body.item_code ?? body.ITEM_CODE, 13);
  if (!item_code) {
    const err = new Error('Item code is required.');
    err.status = 400;
    throw err;
  }
  const item_name = trimItemMasterField(body.item_name ?? body.ITEM_NAME, 50).toUpperCase();
  if (!item_name) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  const r_f = normalizeItemMasterRf(body.r_f ?? body.R_F ?? '');
  const amt_cal = normalizeItemMasterAmtCal(body.amt_cal ?? body.AMT_CAL ?? 'W');
  const tax_per = Number(body.tax_per ?? body.TAX_PER ?? 0);
  const s_code = normalizeMasterCodeField(body.s_code ?? body.S_CODE);
  const p_code = normalizeMasterCodeField(body.p_code ?? body.P_CODE);
  const bard_item_code = Math.floor(Number(body.bard_item_code ?? body.BARD_ITEM_CODE ?? 0)) || 0;
  const bard_op_stock = Number(body.bard_op_stock ?? body.BARD_OP_STOCK ?? 0) || 0;
  const bard_op_rate = Number(body.bard_op_rate ?? body.BARD_OP_RATE ?? 0) || 0;
  const bard_op_value = Number(body.bard_op_value ?? body.BARD_OP_VALUE ?? 0) || 0;
  const brok_cal = normalizeItemMasterBrokCal(body.brok_cal ?? body.BROK_CAL ?? 'Q');
  const tdg_q_w = normalizeItemMasterTdgQW(body.tdg_q_w ?? body.TDG_Q_W ?? 'W');
  const unit_type = normalizeItemMasterUnitType(body.unit_type ?? body.UNIT_TYPE ?? 'Q');
  return {
    comp_code,
    comp_year,
    item_code,
    item_name,
    cat: trimItemMasterField(body.cat ?? body.CAT, 1).toUpperCase(),
    cat_code: trimItemMasterField(body.cat_code ?? body.CAT_CODE, 6).toUpperCase(),
    grp_code: trimItemMasterField(body.grp_code ?? body.GRP_CODE ?? body.mcat ?? body.MCAT ?? body.cat_code ?? body.CAT_CODE, 6).toUpperCase(),
    r_f,
    hsn_code: trimItemMasterField(body.hsn_code ?? body.HSN_CODE, 8).toUpperCase(),
    hsn_unit: trimItemMasterField(body.hsn_unit ?? body.HSN_UNIT, 6).toUpperCase(),
    hsn_name: trimItemMasterField(body.hsn_name ?? body.HSN_NAME, 60).toUpperCase(),
    tax_per: Number.isFinite(tax_per) ? tax_per : 0,
    s_code,
    p_code,
    amt_cal,
    item_head: trimItemMasterField(body.item_head ?? body.ITEM_HEAD, 8).toUpperCase(),
    sap_code_r1: trimItemMasterField(body.sap_code_r1 ?? body.SAP_CODE_R1, 20).toUpperCase(),
    sap_code_r2: trimItemMasterField(body.sap_code_r2 ?? body.SAP_CODE_R2, 20).toUpperCase(),
    u_item_code: trimItemMasterField(body.u_item_code ?? body.U_ITEM_CODE, 20).toUpperCase(),
    bard_item_code,
    bard_op_stock,
    bard_op_rate,
    bard_op_value,
    tdg_q_w,
    unit_type,
    brok_cal,
    e_d: trimItemMasterField(body.e_d ?? body.E_D, 1).toUpperCase(),
    user_name,
  };
}

function itemMasterSavedJson(binds) {
  return {
    ok: true,
    ITEM_CODE: binds.item_code,
    item_code: binds.item_code,
    ITEM_NAME: binds.item_name,
    item_name: binds.item_name,
    CAT: binds.cat,
    cat: binds.cat,
    CAT_CODE: binds.cat_code,
    cat_code: binds.cat_code,
    R_F: binds.r_f,
    r_f: binds.r_f,
    HSN_CODE: binds.hsn_code,
    hsn_code: binds.hsn_code,
    TAX_PER: binds.tax_per,
    tax_per: binds.tax_per,
    S_CODE: binds.s_code,
    s_code: binds.s_code,
    P_CODE: binds.p_code,
    p_code: binds.p_code,
    AMT_CAL: binds.amt_cal,
    amt_cal: binds.amt_cal,
  };
}

async function deleteItemMasterByCode(comp_code, item_code, comp_uid) {
  await runQuery(
    `DELETE FROM ITEMMAST WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code`,
    { comp_code, item_code: trimItemMasterField(item_code, 13) },
    comp_uid,
    { autoCommit: true }
  );
}

async function countItemStockEntries(comp_code, item_code, comp_uid) {
  const code = trimItemMasterField(item_code, 13);
  const checks = [
    `SELECT COUNT(*) AS CNT FROM LOTSTOCK
     WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code`,
    `SELECT COUNT(*) AS CNT FROM STOCK
     WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND NVL(TYPE, ' ') <> 'OP'`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, item_code: code }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return cnt;
    } catch (err) {
      if (!isOracleMissingObjectError(err)) throw err;
    }
  }
  return 0;
}

async function fetchItemMasterCatRows(comp_code, comp_uid) {
  const attempts = [
    { sql: `SELECT CAT_NAME, CAT_CODE FROM CATMAST WHERE COMP_CODE = :comp_code ORDER BY CAT_NAME`, binds: { comp_code } },
    { sql: `SELECT CAT_NAME, CAT_CODE FROM CATMAST ORDER BY CAT_NAME`, binds: {} },
    { sql: `SELECT CAT_NAME, CAT_CODE, NVL(MAIN_CAT, CAT) AS CAT FROM CAT WHERE COMP_CODE = :comp_code ORDER BY CAT_NAME`, binds: { comp_code } },
    { sql: `SELECT CAT_NAME, CAT_CODE, NVL(MAIN_CAT, CAT) AS CAT FROM CAT ORDER BY CAT_NAME`, binds: {} },
    { sql: `SELECT CAT_NAME, CAT_CODE FROM CAT WHERE COMP_CODE = :comp_code ORDER BY CAT_NAME`, binds: { comp_code } },
    {
      sql: `SELECT DISTINCT NVL(CAT_CODE, '') AS CAT_CODE, NVL(CAT_CODE, '') AS CAT_NAME
            FROM ITEMMAST WHERE COMP_CODE = :comp_code AND NVL(CAT_CODE, '') <> ''
            ORDER BY CAT_CODE`,
      binds: { comp_code },
    },
  ];
  for (const { sql, binds } of attempts) {
    try {
      const rows = await runQuery(sql, binds, comp_uid);
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return [];
}

const itemMastColCache = new Map();

async function getItemMastColumns(comp_uid) {
  const key = String(comp_uid || '_').trim() || '_';
  if (itemMastColCache.has(key)) return itemMastColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'ITEMMAST' ORDER BY COLUMN_ID`,
    {},
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase())
  );
  itemMastColCache.set(key, cols);
  return cols;
}

async function fetchItemMasterList(comp_code, comp_uid, q) {
  const cols = await getItemMastColumns(comp_uid);
  const has = (c) => cols.has(String(c).toUpperCase());
  const selectExpr = (col, exprIfPresent, fallbackExpr) => (has(col) ? exprIfPresent : fallbackExpr);
  const itemNameExpr = has('ITEM_NAME') ? 'NVL(I.ITEM_NAME, \'\')' : '\'\'';
  const itemCodeExpr = has('ITEM_CODE') ? 'I.ITEM_CODE' : '0';
  const hsnExpr = selectExpr('HSN_CODE', 'NVL(I.HSN_CODE, \'\')', '\'\'');

  let sql = `
      SELECT ${itemCodeExpr} AS ITEM_CODE,
             ${itemNameExpr} AS ITEM_NAME,
             ${selectExpr('CAT', 'NVL(I.CAT, \'\')', '\'\'')} AS CAT,
             ${selectExpr('CAT_CODE', 'NVL(I.CAT_CODE, \'\')', '\'\'')} AS CAT_CODE,
             ${selectExpr('GRP_CODE', 'NVL(I.GRP_CODE, \'\')', '\'\'')} AS GRP_CODE,
             CAST('' AS VARCHAR2(50)) AS CAT_NAME,
             'F' AS R_F,
             ${hsnExpr} AS HSN_CODE,
             ${selectExpr('HSN_NAME', 'NVL(I.HSN_NAME, \'\')', '\'\'')} AS HSN_NAME,
             ${selectExpr('HSN_UNIT', 'NVL(I.HSN_UNIT, \'\')', '\'\'')} AS HSN_UNIT,
             ${selectExpr('TAX_PER', 'NVL(I.TAX_PER, 0)', '0')} AS TAX_PER,
             ${selectExpr('S_CODE', 'NVL(TO_CHAR(I.S_CODE), \'\')', '\'\'')} AS S_CODE,
             ${selectExpr('P_CODE', 'NVL(TO_CHAR(I.P_CODE), \'\')', '\'\'')} AS P_CODE,
             ${selectExpr('SAP_CODE_R1', 'NVL(I.SAP_CODE_R1, \'\')', '\'\'')} AS SAP_CODE_R1,
             ${selectExpr('SAP_CODE_R2', 'NVL(I.SAP_CODE_R2, \'\')', '\'\'')} AS SAP_CODE_R2,
             ${selectExpr('BARD_ITEM_CODE', 'NVL(I.BARD_ITEM_CODE, 0)', '0')} AS BARD_ITEM_CODE,
             ${selectExpr('BARD_OP_STOCK', 'NVL(I.BARD_OP_STOCK, 0)', '0')} AS BARD_OP_STOCK,
             ${selectExpr('BARD_OP_RATE', 'NVL(I.BARD_OP_RATE, 0)', '0')} AS BARD_OP_RATE,
             ${selectExpr('BARD_OP_VALUE', 'NVL(I.BARD_OP_VALUE, 0)', '0')} AS BARD_OP_VALUE,
             ${selectExpr('U_ITEM_CODE', 'NVL(I.U_ITEM_CODE, \'\')', '\'\'')} AS U_ITEM_CODE,
             ${selectExpr('TDG_Q_W', 'NVL(I.TDG_Q_W, \'\')', '\'\'')} AS TDG_Q_W,
             ${selectExpr('UNIT_TYPE', 'NVL(I.UNIT_TYPE, \'\')', '\'\'')} AS UNIT_TYPE,
             ${selectExpr('ITEM_HEAD', 'NVL(I.ITEM_HEAD, \'\')', '\'\'')} AS ITEM_HEAD,
             ${selectExpr('COMMISSION', 'NVL(I.COMMISSION, 0)', '0')} AS COMMISSION,
             ${selectExpr('BROKERAGE', 'NVL(I.BROKERAGE, 0)', '0')} AS BROKERAGE,
             ${selectExpr('BROK_CAL', 'NVL(I.BROK_CAL, \'\')', '\'\'')} AS BROK_CAL,
             ${selectExpr('SALE_RATE', 'NVL(I.S_RATE, 0)', '0')} AS SALE_RATE,
             ${selectExpr('PACKING', 'NVL(I.PACKING, 0)', '0')} AS PACKING,
             ${selectExpr('UNIT', 'NVL(I.UNIT, \'\')', '\'\'')} AS UNIT,
             ${selectExpr('AMT_CAL', 'NVL(I.AMT_CAL, \'W\')', '\'W\'')} AS AMT_CAL
      FROM ITEMMAST I
      WHERE I.COMP_CODE = :comp_code`;
  const binds = { comp_code };
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    const searchFields = [];
    if (has('ITEM_NAME')) searchFields.push('UPPER(NVL(I.ITEM_NAME, \'\'))');
    if (has('ITEM_CODE')) searchFields.push('UPPER(TO_CHAR(I.ITEM_CODE))');
    if (has('HSN_CODE')) searchFields.push('UPPER(NVL(I.HSN_CODE, \'\'))');
    if (searchFields.length) {
      sql = appendMasterListTokenSearch(sql, binds, qTrim, searchFields, 'itq');
    }
  }
  sql += ` ORDER BY ${itemNameExpr}, TO_CHAR(${itemCodeExpr})`;
  return runQuery(sql, binds, comp_uid);
}

function insertAttemptHasColumns(required, cols) {
  return required.every((c) => cols.has(c));
}

async function validateItemMasterSaveFields(comp_code, comp_uid, binds) {
  const tasks = [];
  if (binds.s_code) {
    tasks.push(validateMasterCodeIfPresent(comp_code, comp_uid, binds.s_code, 'Trading A/c'));
  }
  if (binds.p_code) {
    tasks.push(validateMasterCodeIfPresent(comp_code, comp_uid, binds.p_code, 'Purchase Code A/c'));
  }
  if (binds.grp_code) {
    tasks.push(validateItemGroupIfPresent(comp_code, comp_uid, binds.grp_code));
  }
  if (binds.cat_code) {
    tasks.push(validateCatCodeIfPresent(comp_code, comp_uid, binds.cat_code));
  }
  if (tasks.length) await Promise.all(tasks);
}

async function fetchItemMasterItemGrpRows(comp_code, comp_uid) {
  const attempts = [
    { sql: `SELECT GRP_NAME, GRP_CODE FROM ITEM_GRP WHERE COMP_CODE = :comp_code ORDER BY GRP_NAME`, binds: { comp_code } },
    { sql: `SELECT GRP_NAME, GRP_CODE FROM ITEM_GRP ORDER BY GRP_NAME`, binds: {} },
    { sql: `SELECT CAT_NAME AS GRP_NAME, CAT_CODE AS GRP_CODE FROM CATMAST WHERE COMP_CODE = :comp_code ORDER BY CAT_NAME`, binds: { comp_code } },
    {
      sql: `SELECT DISTINCT NVL(GRP_CODE, '') AS GRP_CODE, NVL(GRP_CODE, '') AS GRP_NAME
            FROM ITEMMAST WHERE COMP_CODE = :comp_code AND NVL(GRP_CODE, '') <> ''
            ORDER BY GRP_CODE`,
      binds: { comp_code },
    },
  ];
  for (const { sql, binds } of attempts) {
    try {
      const rows = await runQuery(sql, binds, comp_uid);
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return [];
}

/** INSERT ITEMMAST — one SQL chosen from cached USER_TAB_COLUMNS (avoids slow trial inserts). */
async function insertItemMasterRow(binds, comp_uid) {
  const cols = await getItemMastColumns(comp_uid);
  const attempts = [
    {
      sql: `
      INSERT INTO ITEMMAST (
        COMP_CODE, COMP_YEAR, ITEM_CODE, ITEM_NAME, CAT, CAT_CODE, R_F, HSN_CODE,
        TAX_PER, S_CODE, P_CODE, AMT_CAL, USER_NAME, ENT_DATE
      ) VALUES (
        :comp_code, :comp_year, TRIM(:item_code), TRIM(:item_name), TRIM(:cat), TRIM(:cat_code),
        TRIM(:r_f), RTRIM(:hsn_code), :tax_per, :s_code, :p_code, RTRIM(:amt_cal),
        :user_name, SYSDATE
      )`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        item_code: binds.item_code,
        item_name: binds.item_name,
        cat: binds.cat,
        cat_code: binds.cat_code,
        r_f: binds.r_f || 'F',
        hsn_code: binds.hsn_code,
        tax_per: binds.tax_per,
        s_code: binds.s_code,
        p_code: binds.p_code,
        amt_cal: binds.amt_cal || 'W',
        user_name: binds.user_name,
      },
    },
    {
      sql: `
      INSERT INTO ITEMMAST (
        COMP_CODE, COMP_YEAR, ITEM_CODE, ITEM_NAME, CAT, CAT_CODE, R_F, HSN_CODE,
        TAX_PER, S_CODE, P_CODE, AMT_CAL, USER_NAME
      ) VALUES (
        :comp_code, :comp_year, TRIM(:item_code), TRIM(:item_name), TRIM(:cat), TRIM(:cat_code),
        TRIM(:r_f), RTRIM(:hsn_code), :tax_per, :s_code, :p_code, RTRIM(:amt_cal), :user_name
      )`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        item_code: binds.item_code,
        item_name: binds.item_name,
        cat: binds.cat,
        cat_code: binds.cat_code,
        r_f: binds.r_f || 'F',
        hsn_code: binds.hsn_code,
        tax_per: binds.tax_per,
        s_code: binds.s_code,
        p_code: binds.p_code,
        amt_cal: binds.amt_cal || 'W',
        user_name: binds.user_name,
      },
    },
    {
      sql: `
      INSERT INTO ITEMMAST (
        COMP_CODE, COMP_YEAR, ITEM_CODE, ITEM_NAME, S_CODE, CAT_CODE, GRP_CODE, USER_NAME, ENT_DATE,
        P_CODE, ITEM_HEAD, SAP_CODE_R1, SAP_CODE_R2, TAX_PER, HSN_CODE, HSN_UNIT, BARD_ITEM_CODE,
        BARD_OP_STOCK, BARD_OP_RATE, BARD_OP_VALUE, TDG_Q_W, U_ITEM_CODE, BROK_CAL, AMT_CAL, HSN_NAME, UNIT_TYPE, E_D
      ) VALUES (
        :comp_code, :comp_year, TRIM(:item_code), TRIM(:item_name), :s_code, TRIM(:cat_code), TRIM(:grp_code), :user_name, SYSDATE,
        :p_code, TRIM(:item_head), TRIM(:sap_code_r1), TRIM(:sap_code_r2), :tax_per, TRIM(:hsn_code), TRIM(:hsn_unit), :bard_item_code,
        :bard_op_stock, :bard_op_rate, :bard_op_value, TRIM(:tdg_q_w), TRIM(:u_item_code), TRIM(:brok_cal), TRIM(:amt_cal), TRIM(:hsn_name), TRIM(:unit_type), TRIM(:e_d)
      )`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        item_code: binds.item_code,
        item_name: binds.item_name,
        s_code: binds.s_code,
        cat_code: binds.cat_code,
        grp_code: binds.grp_code,
        user_name: binds.user_name,
        p_code: binds.p_code,
        item_head: binds.item_head,
        sap_code_r1: binds.sap_code_r1,
        sap_code_r2: binds.sap_code_r2,
        tax_per: binds.tax_per,
        hsn_code: binds.hsn_code,
        hsn_unit: binds.hsn_unit,
        bard_item_code: binds.bard_item_code,
        bard_op_stock: binds.bard_op_stock,
        bard_op_rate: binds.bard_op_rate,
        bard_op_value: binds.bard_op_value,
        tdg_q_w: binds.tdg_q_w || 'Q',
        u_item_code: binds.u_item_code,
        brok_cal: binds.brok_cal || 'Q',
        amt_cal: binds.amt_cal || 'W',
        hsn_name: binds.hsn_name,
        unit_type: binds.unit_type,
        e_d: binds.e_d,
      },
    },
    {
      sql: `
      INSERT INTO ITEMMAST (
        COMP_CODE, COMP_YEAR, ITEM_CODE, ITEM_NAME, CAT, CAT_CODE, R_F, HSN_CODE,
        TAX_PER, S_CODE, P_CODE, AMT_CAL
      ) VALUES (
        :comp_code, :comp_year, TRIM(:item_code), TRIM(:item_name), TRIM(:cat), TRIM(:cat_code),
        TRIM(:r_f), RTRIM(:hsn_code), :tax_per, :s_code, :p_code, RTRIM(:amt_cal)
      )`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        item_code: binds.item_code,
        item_name: binds.item_name,
        cat: binds.cat,
        cat_code: binds.cat_code,
        r_f: binds.r_f || 'F',
        hsn_code: binds.hsn_code,
        tax_per: binds.tax_per,
        s_code: binds.s_code,
        p_code: binds.p_code,
        amt_cal: binds.amt_cal || 'W',
      },
    },
    {
      sql: `
      INSERT INTO ITEMMAST (
        COMP_CODE, COMP_YEAR, ITEM_CODE, ITEM_NAME, S_CODE, CAT_CODE, GRP_CODE, P_CODE, TAX_PER, HSN_CODE
      ) VALUES (
        :comp_code, :comp_year, TRIM(:item_code), TRIM(:item_name), :s_code, TRIM(:cat_code), TRIM(:grp_code), :p_code, :tax_per, TRIM(:hsn_code)
      )`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        item_code: binds.item_code,
        item_name: binds.item_name,
        s_code: binds.s_code,
        cat_code: binds.cat_code,
        grp_code: binds.grp_code,
        p_code: binds.p_code,
        tax_per: binds.tax_per,
        hsn_code: binds.hsn_code,
      },
    },
  ];
  const attemptMeta = [
    { required: ['COMP_CODE', 'COMP_YEAR', 'ITEM_CODE', 'ITEM_NAME', 'CAT', 'CAT_CODE', 'R_F', 'HSN_CODE', 'TAX_PER', 'S_CODE', 'P_CODE', 'AMT_CAL', 'USER_NAME', 'ENT_DATE'], omitUser: false, avoidsRf: false },
    { required: ['COMP_CODE', 'COMP_YEAR', 'ITEM_CODE', 'ITEM_NAME', 'CAT', 'CAT_CODE', 'R_F', 'HSN_CODE', 'TAX_PER', 'S_CODE', 'P_CODE', 'AMT_CAL', 'USER_NAME'], omitUser: false, avoidsRf: false },
    { required: ['COMP_CODE', 'COMP_YEAR', 'ITEM_CODE', 'ITEM_NAME', 'S_CODE', 'CAT_CODE', 'GRP_CODE', 'USER_NAME', 'ENT_DATE', 'P_CODE', 'ITEM_HEAD', 'SAP_CODE_R1', 'SAP_CODE_R2', 'TAX_PER', 'HSN_CODE', 'HSN_UNIT', 'BARD_ITEM_CODE', 'BARD_OP_STOCK', 'BARD_OP_RATE', 'BARD_OP_VALUE', 'TDG_Q_W', 'U_ITEM_CODE', 'BROK_CAL', 'AMT_CAL', 'HSN_NAME', 'UNIT_TYPE', 'E_D'], omitUser: false, avoidsRf: true },
    { required: ['COMP_CODE', 'COMP_YEAR', 'ITEM_CODE', 'ITEM_NAME', 'CAT', 'CAT_CODE', 'R_F', 'HSN_CODE', 'TAX_PER', 'S_CODE', 'P_CODE', 'AMT_CAL'], omitUser: true, avoidsRf: false },
    { required: ['COMP_CODE', 'COMP_YEAR', 'ITEM_CODE', 'ITEM_NAME', 'S_CODE', 'CAT_CODE', 'GRP_CODE', 'P_CODE', 'TAX_PER', 'HSN_CODE'], omitUser: true, avoidsRf: true },
  ];
  const allAttempts = attemptMeta.map((meta, i) => ({ ...meta, ...attempts[i] }));
  const viable = allAttempts.filter((a) => insertAttemptHasColumns(a.required, cols));
  const tryList = (viable.length ? viable : allAttempts).sort((a, b) => Number(b.avoidsRf) - Number(a.avoidsRf));

  let lastErr;
  for (const { sql, binds: b, omitUser } of tryList) {
    try {
      const b2 = omitUser ? (({ user_name, ...rest }) => rest)(b) : b;
      await runQuery(sql, b2, comp_uid, { autoCommit: true, suppressDbErrorLog: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('ITEMMAST insert failed');
}

async function fetchMasterPartyUserF4String(user_name, comp_uid) {
  const u = String(user_name || '').trim().toUpperCase();
  if (!u) return { f4: '', source: 'empty_user' };
  const schemas = isEffectiveCompUid(comp_uid) ? [String(comp_uid).trim(), null] : [null];
  const tables = ['DAL.USERS', 'USERS'];
  for (const sch of schemas) {
    for (const t of tables) {
      const sql = `SELECT F4 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`;
      try {
        const rows = await runQuery(sql, { u }, sch, { suppressDbErrorLog: true });
        const raw = rows?.[0]?.F4 ?? rows?.[0]?.f4;
        if (raw != null && String(raw).trim() !== '') {
          return { f4: String(raw).trim(), source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) {
          /* ignore */
        }
      }
    }
  }
  return { f4: '', source: 'none' };
}

function masterPartyPermissionsFromF4(f4) {
  return rightsPermissionsFromString(f4, 'legacy_no_f4', 'f4');
}

/** Item master: DAL.USERS / USERS F5 — pos 1–4 = open, add, edit, delete. */
async function fetchItemMasterUserF5String(user_name, comp_uid) {
  const u = String(user_name || '').trim().toUpperCase();
  if (!u) return { f5: '', source: 'empty_user' };
  const schemas = isEffectiveCompUid(comp_uid) ? [String(comp_uid).trim(), null] : [null];
  const tables = ['DAL.USERS', 'USERS'];
  for (const sch of schemas) {
    for (const t of tables) {
      const sql = `SELECT F5 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`;
      try {
        const rows = await runQuery(sql, { u }, sch, { suppressDbErrorLog: true });
        const raw = rows?.[0]?.F5 ?? rows?.[0]?.f5;
        if (raw != null && String(raw).trim() !== '') {
          return { f5: String(raw).trim(), source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) {
          /* ignore */
        }
      }
    }
  }
  return { f5: '', source: 'none' };
}

function itemMasterPermissionsFromF5(f5) {
  return rightsPermissionsFromString(f5, 'legacy_no_f5', 'f5');
}

async function fetchNextItemMasterCode(comp_code, comp_uid) {
  const rows = await runQuery(
    `SELECT MAX(NVL(TO_NUMBER(TRIM(ITEM_CODE)), 0)) AS ICODE FROM ITEMMAST WHERE COMP_CODE = :comp_code`,
    { comp_code },
    comp_uid
  );
  const maxCode = Number(rows?.[0]?.ICODE ?? rows?.[0]?.icode ?? 0) || 0;
  const nextCode = String(maxCode + 1);
  return { next_code: nextCode, NEXT_CODE: nextCode, max_code: maxCode, MAX_CODE: maxCode };
}

async function validateMasterCodeIfPresent(comp_code, comp_uid, code, label) {
  const c = normalizeMasterCodeField(code);
  if (!c) return;
  const rows = await runQuery(
    `SELECT COUNT(*) AS CNT FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code`,
    { comp_code, code: c },
    comp_uid
  );
  const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
  if (cnt < 1) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
}

async function validateItemGroupIfPresent(comp_code, comp_uid, grpCode) {
  const g = trimItemMasterField(grpCode, 6);
  if (!g) return;
  const rows = await runQuery(
    `SELECT COUNT(*) AS CNT FROM ITEM_GRP WHERE COMP_CODE = :comp_code AND GRP_CODE = :grp_code`,
    { comp_code, grp_code: g },
    comp_uid
  ).catch(async (err) => {
    if (!isOracleMissingObjectError(err)) throw err;
    return [{ CNT: 1 }];
  });
  const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
  if (cnt < 1) {
    const err = new Error('Invalid Category');
    err.status = 400;
    throw err;
  }
}

async function validateCatCodeIfPresent(comp_code, comp_uid, catCode) {
  const c = trimItemMasterField(catCode, 6);
  if (!c) return;
  const checks = [
    `SELECT COUNT(*) AS CNT FROM CATMAST WHERE COMP_CODE = :comp_code AND CAT_CODE = :cat_code`,
    `SELECT COUNT(*) AS CNT FROM CAT WHERE COMP_CODE = :comp_code AND CAT_CODE = :cat_code`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, cat_code: c }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return;
    } catch (err) {
      if (!isOracleMissingObjectError(err)) throw err;
    }
  }
  const err = new Error('Invalid Item Group Category');
  err.status = 400;
  throw err;
}

/**
 * App login: USERS / GRAIN.USERS (matches SQL*Plus GRAIN.USERS while connected as GRAINFAS if grants allow),
 * then USERNAME column variant for older tables.
 */
async function lookupAppLoginRows(connCfg, user_name, pw) {
  const binds = { u: user_name, p: pw };
  const tables = ['DAL.USERS', 'USERS', 'GRAIN.USERS'];
  const variants = [
    { nameCol: 'USER_NAME', pwCol: 'PW' },
    { nameCol: 'USERNAME', pwCol: 'PW' },
    { nameCol: 'USER_NAME', pwCol: 'PASSWORD' },
    { nameCol: 'USERNAME', pwCol: 'PASSWORD' },
  ];

  for (const t of tables) {
    for (const { nameCol, pwCol } of variants) {
      const nameSelect = nameCol === 'USERNAME' ? 'USERNAME AS USER_NAME' : 'USER_NAME';
      const sql = `SELECT ${nameSelect}, ${pwCol} AS PW FROM ${t}
        WHERE UPPER(TRIM(${nameCol})) = UPPER(TRIM(:u)) AND UPPER(TRIM(${pwCol})) = UPPER(TRIM(:p))`;
      try {
        const rows = await runQuery(sql, binds, null, { hubOverride: connCfg, suppressDbErrorLog: true });
        if (Array.isArray(rows) && rows.length > 0) return rows;
      } catch (err) {
        if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) throw err;
      }
    }
  }

  return [];
}

/** USERS.COMP_CODE lookup (USER_NAME / USERNAME variants; USERS / GRAIN.USERS). */
async function lookupAuthorizedCompanyCode(connCfg, user_name) {
  const u = String(user_name || '').trim().toUpperCase();
  if (!u) return '';
  const binds = { u };
  const predStd = `UPPER(TRIM(USER_NAME)) = UPPER(TRIM(:u))`;
  const predAlt = `UPPER(TRIM(USERNAME)) = UPPER(TRIM(:u))`;
  const tables = ['DAL.USERS', 'USERS', 'GRAIN.USERS'];

  for (const t of tables) {
    try {
      const rows = await runQuery(`SELECT COMP_CODE FROM ${t} WHERE ${predStd}`, binds, null, {
        hubOverride: connCfg,
        suppressDbErrorLog: true,
      });
      const cc = rows?.[0]?.COMP_CODE ?? rows?.[0]?.comp_code ?? '';
      const s = String(cc || '').trim();
      if (s) return s;
      if (Array.isArray(rows) && rows.length > 0) return '';
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  for (const t of tables) {
    try {
      const rows = await runQuery(`SELECT COMP_CODE FROM ${t} WHERE ${predAlt}`, binds, null, {
        hubOverride: connCfg,
        suppressDbErrorLog: true,
      });
      const cc = rows?.[0]?.COMP_CODE ?? rows?.[0]?.comp_code ?? '';
      const s = String(cc || '').trim();
      if (s) return s;
      if (Array.isArray(rows) && rows.length > 0) return '';
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  return '';
}

async function fetchCompanyListRows(compCode = '') {
  const code = String(compCode || '').trim();
  if (code) {
    const sqlCandidates = [
      `SELECT COMP_NAME, COMP_CODE FROM COMPANY WHERE COMP_CODE = :comp_code`,
      `SELECT COMP_NAME, COMP_CODE FROM COMPDET WHERE COMP_CODE = :comp_code GROUP BY COMP_NAME, COMP_CODE`,
    ];
    let lastErr = null;
    for (const sql of sqlCandidates) {
      try {
        return await runQuery(sql, { comp_code: code }, null, { suppressDbErrorLog: true });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Company query failed');
  }

  const sqlCandidates = [
    `SELECT COMP_NAME, COMP_CODE FROM COMPANY ORDER BY COMP_CODE`,
    `SELECT COMP_CODE, COMP_NAME FROM COMPDET GROUP BY COMP_CODE, COMP_NAME ORDER BY COMP_CODE`,
  ];
  let lastErr = null;
  for (const sql of sqlCandidates) {
    try {
      return await runQuery(sql, {}, null, { suppressDbErrorLog: true });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Company list query failed');
}

const USER_MASTER_ADMIN_DEFAULT_PW = 'VJTSIGNAL';
const USER_MASTER_ADMIN_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const userMasterAdminTokens = new Map();

function resolveUserMasterCompCode(req) {
  return String(
    req.headers['x-comp-code'] ||
      req.query?.comp_code ||
      req.body?.comp_code ||
      '1'
  ).trim();
}

function issueUserMasterAdminToken(comp_code) {
  const token = crypto.randomBytes(24).toString('hex');
  userMasterAdminTokens.set(token, {
    comp_code: String(comp_code ?? '1').trim(),
    expires: Date.now() + USER_MASTER_ADMIN_TOKEN_TTL_MS,
  });
  return token;
}

function isUserMasterAdminTokenValid(token, comp_code) {
  if (!token) return false;
  const key = String(token);
  const row = userMasterAdminTokens.get(key);
  if (!row || row.expires < Date.now()) {
    userMasterAdminTokens.delete(key);
    return false;
  }
  return row.comp_code === String(comp_code ?? '1').trim();
}

/** VFP user.scx: NVL(COMP_P_D,'VJTSIGNAL') from G_MAIN_DATABASE.COMPANY (hub = GRAINFAS). */
async function fetchCompanyAdminPassword(comp_code) {
  const code = String(comp_code ?? '1').trim();
  const defaultPw = USER_MASTER_ADMIN_DEFAULT_PW;
  const sqlCandidates = [
    `SELECT NVL(COMP_P_D, :default_pw) AS COMP_P_D FROM COMPANY WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
    `SELECT NVL(COMP_P_D, :default_pw) AS COMP_P_D FROM COMPANY WHERE TRIM(TO_CHAR(COMP_CODE)) = :comp_code AND ROWNUM = 1`,
  ];
  for (const sql of sqlCandidates) {
    try {
      const rows = await runQuery(
        sql,
        { comp_code: code, default_pw: defaultPw },
        null,
        { suppressDbErrorLog: true }
      );
      if (rows?.[0]) {
        const raw = rowValueCI(rows[0], 'comp_p_d');
        return String(raw ?? defaultPw).trim().toUpperCase();
      }
    } catch (_) {
      /* try next SQL */
    }
  }
  return defaultPw.toUpperCase();
}

async function verifyCompanyAdminPassword(entered, comp_code) {
  const expected = await fetchCompanyAdminPassword(comp_code);
  return String(entered ?? '').trim().toUpperCase() === expected;
}

async function assertUserMasterAdminAccess(req) {
  const comp_code = resolveUserMasterCompCode(req);
  const token = req.headers['x-user-master-admin-token'];
  if (isUserMasterAdminTokenValid(token, comp_code)) return comp_code;
  const err = new Error('Administrator password required');
  err.status = 403;
  throw err;
}

/** Buffers (e.g. BLOB) → base64 strings so res.json() is safe and the client can show QR. */
function normalizeRowBuffers(row) {
  if (!row || typeof row !== 'object') return;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (Buffer.isBuffer(v)) {
      row[k] = v.toString('base64');
    } else if (v instanceof Uint8Array && !(v instanceof Buffer)) {
      row[k] = Buffer.from(v).toString('base64');
    }
  }
}

/** Merge QR payload from alternate column names (quoted identifiers / driver casing). */
function normalizeSignedQrColumn(row) {
  if (!row || typeof row !== 'object') return;
  let pick = row.SIGNED_QR_CODE;
  if (pick != null && typeof pick === 'object' && typeof pick.getData === 'function') pick = null;
  for (const [k, val] of Object.entries(row)) {
    if (val == null || val === '') continue;
    if (typeof val === 'object' && typeof val.getData === 'function') continue;
    const kl = k.toLowerCase();
    const compact = kl.replace(/_/g, '');
    if (
      kl === 'signed_qr_code' ||
      k === 'signed_Qr_code' ||
      compact === 'signedqrcode' ||
      (kl.includes('signed') && kl.includes('qr')) ||
      (compact.includes('signed') && compact.includes('qr')) ||
      (kl.includes('einvoice') && kl.includes('qr'))
    ) {
      if (pick == null || pick === '') pick = val;
    }
  }
  if (pick != null && pick !== '') row.SIGNED_QR_CODE = pick;
}

function rowValueCI(row, logicalName) {
  if (!row || logicalName == null) return null;
  const want = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase() === want) return row[k];
  }
  return null;
}

function isOptionalPrintSqlError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-00904') ||
    /table or view does not exist/i.test(msg) ||
    /invalid identifier/i.test(msg)
  );
}

async function runOptionalSingleRow(sql, binds, schemaAttempts = []) {
  const attempts = Array.isArray(schemaAttempts) ? schemaAttempts : [schemaAttempts];
  let lastErr = null;
  for (const schema of attempts) {
    try {
      const rows = await runQuery(sql, binds, schema, { suppressDbErrorLog: true });
      return rows[0] ?? null;
    } catch (err) {
      lastErr = err;
      if (!isOptionalPrintSqlError(err)) throw err;
    }
  }
  if (lastErr) {
    console.warn('⚠️ Optional print metadata query skipped:', lastErr.message);
  }
  return null;
}

async function runCompdetHeaderRow(comp_code, comp_uid) {
  const cu = String(comp_uid ?? '').trim();
  const sqlExact = `
    SELECT
      *
    FROM compdet
    WHERE comp_code = :comp_code
      AND TRIM(TO_CHAR(comp_uid)) = :comp_uid`;
  const sqlLatest = `
    SELECT * FROM (
      SELECT
        *
      FROM compdet
      WHERE comp_code = :comp_code
      ORDER BY comp_year DESC NULLS LAST
    ) WHERE ROWNUM = 1`;

  const schemaAttempts = [comp_uid, null];
  for (const schema of schemaAttempts) {
    try {
      const rows = await runQuery(sqlExact, { comp_code, comp_uid: cu }, schema);
      if (rows && rows[0]) return rows[0];
    } catch (err) {
      if (!isOptionalPrintSqlError(err)) throw err;
    }
    try {
      const rows = await runQuery(sqlLatest, { comp_code }, schema);
      if (rows && rows[0]) return rows[0];
    } catch (err) {
      if (!isOptionalPrintSqlError(err)) throw err;
    }
  }
  return null;
}

/** Sale / tax invoice print images: always from defvalue, never from compdet or SALE row blobs */
const SALE_PRINT_IMAGE_FIELD_LC = new Set(['sale_logo', 'sale_logo2', 'signature_file']);

function stripSalePrintImageFields(row) {
  if (!row || typeof row !== 'object') return;
  for (const k of Object.keys(row)) {
    if (SALE_PRINT_IMAGE_FIELD_LC.has(String(k).toLowerCase())) {
      delete row[k];
    }
  }
}

const DEFVALUE_SALE_PRINT_IMAGES_SQL = `
  SELECT sale_logo, sale_logo2, signature_file
  FROM defvalue
  WHERE comp_code = :comp_code
    AND ROWNUM = 1`;

/** Read logo/signature BLOBs from defvalue (company-wide) and assign onto targetRow */
async function mergeDefvalueSalePrintImageBlobs(comp_code, targetRow, schemaAttempts) {
  if (!targetRow || !comp_code) return;
  const row = await runOptionalSingleRow(DEFVALUE_SALE_PRINT_IMAGES_SQL, { comp_code }, schemaAttempts);
  if (!row) return;
  await drainOracleLobsInRows([row]);
  normalizeRowBuffers(row);
  Object.assign(targetRow, row);
}

function numVal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDateOnly(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }
  const s = String(raw).trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  // ISO datetime — use local calendar day (do not take YYYY-MM-DD prefix from UTC string)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    return null;
  }
  const ymdOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymdOnly) return new Date(Number(ymdOnly[1]), Number(ymdOnly[2]) - 1, Number(ymdOnly[3]));
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function diffDays(endDate, startDate) {
  const e = parseDateOnly(endDate);
  const s = parseDateOnly(startDate);
  if (!e || !s) return 0;
  return Math.max(0, Math.floor((e.getTime() - s.getTime()) / 86400000));
}

function approxSchedule(value, target) {
  return Math.abs(numVal(value) - numVal(target)) < 0.0001;
}

function makeAgeingRanges(input) {
  const src = Array.isArray(input) ? input : [];
  return src.map((pair, idx) => {
    const from = numVal(pair?.from);
    const toRaw = pair?.to;
    const to = toRaw == null || toRaw === '' ? from : numVal(toRaw);
    return {
      idx,
      from: Math.max(0, Math.floor(from)),
      to: Math.max(Math.floor(to), Math.max(0, Math.floor(from))),
    };
  });
}

/** Normalise comp_uid from compdet / Oracle row for comparison */
function normCompUidFromRow(r) {
  const u = r?.comp_uid ?? r?.COMP_UID;
  if (u == null) return '';
  return String(u).trim();
}

/** Ordered ascending by financial year so the row before the selected comp_uid is the previous year */
async function fetchCompdetYearsOrderedAsc(comp_code, schemaHint) {
  const sql = `
    SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt
    FROM compdet
    WHERE comp_code = :comp_code
    ORDER BY NVL(comp_year, 0) ASC, comp_s_dt ASC NULLS LAST`;
  const attempts = [];
  for (const s of [schemaHint, null]) {
    if (!attempts.includes(s)) attempts.push(s);
  }
  for (const schema of attempts) {
    try {
      const rows = await runQuery(
        sql,
        { comp_code },
        isEffectiveCompUid(schema) ? schema : null,
        { suppressDbErrorLog: true }
      );
      if (rows && rows.length) return rows;
    } catch (_) {
      /* try next schema */
    }
  }
  return [];
}

/** Previous year's Oracle schema (comp_uid) for the same company, or null */
async function resolvePreviousCompUid(comp_code, comp_uid) {
  const target = String(comp_uid ?? '').trim();
  if (!comp_code || !target) return null;
  const rows = await fetchCompdetYearsOrderedAsc(comp_code, comp_uid);
  const idx = rows.findIndex((r) => normCompUidFromRow(r) === target);
  if (idx <= 0) return null;
  const prev = rows[idx - 1];
  const pu = normCompUidFromRow(prev);
  return pu && pu !== target ? pu : null;
}

const AGEING_LEDGER_OP_EXCLUDE = `AND NVL(UPPER(TRIM(A.VR_TYPE)), ' ') <> 'OP'`;

/** Merge prior-year + current-year ledger lines for ageing (FIFO order); OP excluded only on current schema */
async function fetchAgeingLedgerRawRowsMerged({ comp_code, comp_uid, e_date, scheduleNum, codeFilter }) {
  const prevUid = await resolvePreviousCompUid(comp_code, comp_uid);
  const binds = { comp_code, e_date, schedule: scheduleNum };
  const codeClause =
    codeFilter != null && String(codeFilter).trim() !== ''
      ? `AND A.CODE = :code`
      : '';
  if (codeClause) binds.code = String(codeFilter).trim();

  const baseSelect = `
        SELECT
          A.CODE,
          B.NAME,
          B.CITY,
          A.VR_TYPE,
          A.VR_DATE,
          A.VR_NO,
          NVL(A.DR_AMT,0) DR_AMT,
          NVL(A.CR_AMT,0) CR_AMT`;

  const detailCol = codeClause
    ? `,
          A.DETAIL`
    : '';

  const fromWhere = `
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
          ${codeClause}
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
          AND ROUND(NVL(B.SCHEDULE,0), 2) = :schedule`;

  const orderSummary = `ORDER BY B.NAME, A.CODE, A.VR_DATE, A.VR_NO, A.VR_TYPE`;
  const orderDetail = `ORDER BY A.VR_DATE, A.VR_NO, A.VR_TYPE`;

  const sqlCur = `${baseSelect}${detailCol}
        ${fromWhere}
          ${AGEING_LEDGER_OP_EXCLUDE}
        ${codeClause ? orderDetail : orderSummary}`;

  const sqlPrev = `${baseSelect}${detailCol}
        ${fromWhere}
        ${codeClause ? orderDetail : orderSummary}`;

  const curRows = (await runQuery(sqlCur, binds, comp_uid)) || [];
  let prevRows = [];
  if (prevUid) {
    prevRows = (await runQuery(sqlPrev, binds, prevUid)) || [];
  }

  const merged = [...prevRows, ...curRows];
  const sortFn = codeClause ? cmpLedgerAgeingDetailMerge : cmpLedgerAgeingSummaryMerge;
  merged.sort(sortFn);
  return merged;
}

function cmpLedgerAgeingSummaryMerge(a, b) {
  const nameA = String(a.NAME ?? a.name ?? '');
  const nameB = String(b.NAME ?? b.name ?? '');
  const cn = nameA.localeCompare(nameB);
  if (cn !== 0) return cn;
  const codeA = String(a.CODE ?? a.code ?? '');
  const codeB = String(b.CODE ?? b.code ?? '');
  const cc = codeA.localeCompare(codeB);
  if (cc !== 0) return cc;
  const da = parseDateOnly(a.VR_DATE ?? a.vr_date);
  const db = parseDateOnly(b.VR_DATE ?? b.vr_date);
  const ta = da ? da.getTime() : 0;
  const tb = db ? db.getTime() : 0;
  if (ta !== tb) return ta - tb;
  const na = numVal(a.VR_NO ?? a.vr_no);
  const nb = numVal(b.VR_NO ?? b.vr_no);
  if (na !== nb) return na - nb;
  return String(a.VR_TYPE ?? a.vr_type ?? '').localeCompare(String(b.VR_TYPE ?? b.vr_type ?? ''));
}

function cmpLedgerAgeingDetailMerge(a, b) {
  const da = parseDateOnly(a.VR_DATE ?? a.vr_date);
  const db = parseDateOnly(b.VR_DATE ?? b.vr_date);
  const ta = da ? da.getTime() : 0;
  const tb = db ? db.getTime() : 0;
  if (ta !== tb) return ta - tb;
  const na = numVal(a.VR_NO ?? a.vr_no);
  const nb = numVal(b.VR_NO ?? b.vr_no);
  if (na !== nb) return na - nb;
  return String(a.VR_TYPE ?? a.vr_type ?? '').localeCompare(String(b.VR_TYPE ?? b.vr_type ?? ''));
}

function ageingBucketIndex(days, ranges) {
  const d = Math.max(0, Math.floor(numVal(days)));
  for (let i = 0; i < ranges.length; i += 1) {
    if (d >= ranges[i].from && d <= ranges[i].to) return i;
  }
  return ranges.length - 1;
}

function emptyAgeingBucketObject(ranges) {
  const out = {};
  ranges.forEach((_, idx) => {
    out[`RANGE_${idx + 1}`] = 0;
  });
  return out;
}

function buildAgeingLedgerResiduals(rows, explicitCreditMode = null) {
  const totalDr = (rows || []).reduce((sum, row) => sum + numVal(row.DR_AMT ?? row.dr_amt), 0);
  const totalCr = (rows || []).reduce((sum, row) => sum + numVal(row.CR_AMT ?? row.cr_amt), 0);
  const isCreditMode =
    explicitCreditMode == null ? totalCr > totalDr : Boolean(explicitCreditMode);
  let offsetPool = isCreditMode ? totalDr : totalCr;
  const residuals = [];
  for (const row of rows || []) {
    const targetAmt = isCreditMode ? numVal(row.CR_AMT ?? row.cr_amt) : numVal(row.DR_AMT ?? row.dr_amt);
    if (targetAmt <= 0) continue;
    if (offsetPool >= targetAmt) {
      offsetPool -= targetAmt;
      continue;
    }
    const pendingBal = targetAmt - offsetPool;
    offsetPool = 0;
    residuals.push({
      ...row,
      PENDING_BAL: pendingBal,
    });
  }
  return residuals;
}

/**
 * Ledger ageing visibility by schedule (natural balance sign from net DR−CR on included lines):
 * - Schedule 8.10: hide accounts with net balance &lt; 0 (credit / wrong side for debtors).
 * - Other schedules: hide accounts with net balance &gt; 0 (debit / wrong side for creditors).
 */
function shouldShowAgeingLedgerSummaryRow(scheduleNum, netDrMinusCr) {
  const bal = numVal(netDrMinusCr);
  const is810 = Math.round(numVal(scheduleNum) * 100) / 100 === 8.1;
  if (is810) return bal >= -1e-4;
  return bal <= 1e-4;
}

function netDrMinusCrFromLedgerLines(sourceRows) {
  return (sourceRows || []).reduce(
    (s, r) => s + numVal(r.DR_AMT ?? r.dr_amt) - numVal(r.CR_AMT ?? r.cr_amt),
    0
  );
}

function buildAgeingLedgerRows(rows, endDate, ranges, isCreditMode, scheduleNum = null) {
  const grouped = new Map();
  for (const row of rows || []) {
    const code = String(row.CODE ?? row.code ?? '').trim();
    if (!code) continue;
    if (!grouped.has(code)) {
      grouped.set(code, {
        CODE: code,
        NAME: row.NAME ?? row.name ?? '',
        CITY: row.CITY ?? row.city ?? '',
        sourceRows: [],
      });
    }
    const grp = grouped.get(code);
    grp.sourceRows.push(row);
  }

  return Array.from(grouped.values())
    .map((grp) => {
      const netDrMinusCr = netDrMinusCrFromLedgerLines(grp.sourceRows);
      const buckets = emptyAgeingBucketObject(ranges);
      let curBal = 0;
      const residuals = buildAgeingLedgerResiduals(grp.sourceRows, isCreditMode);
      residuals.forEach((item) => {
        const amt = numVal(item.PENDING_BAL);
        if (amt <= 0.0001) return;
        curBal += amt;
        const bIdx = ageingBucketIndex(diffDays(endDate, item.VR_DATE ?? item.vr_date), ranges);
        buckets[`RANGE_${bIdx + 1}`] += amt;
      });
      const row = { CODE: grp.CODE, NAME: grp.NAME, CITY: grp.CITY, CUR_BAL: curBal, ...buckets };
      if (scheduleNum == null) {
        return curBal > 0.0001 ? row : null;
      }
      if (!shouldShowAgeingLedgerSummaryRow(scheduleNum, netDrMinusCr)) return null;
      return curBal > 0.0001 ? row : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.NAME).localeCompare(String(b.NAME)) || String(a.CODE).localeCompare(String(b.CODE)));
}

function buildAgeingLedgerDetailRows(rows, isCreditMode) {
  return buildAgeingLedgerResiduals(rows, isCreditMode);
}

function buildAgeingBillRows(rows, endDate, ranges) {
  const grouped = new Map();
  (rows || []).forEach((row) => {
    const code = String(row.CODE ?? row.code ?? '').trim();
    if (!code) return;
    if (!grouped.has(code)) {
      grouped.set(code, {
        CODE: code,
        NAME: row.NAME ?? row.name ?? '',
        CITY: row.CITY ?? row.city ?? '',
        CUR_BAL: 0,
        ...emptyAgeingBucketObject(ranges),
      });
    }
    const out = grouped.get(code);
      const curBal = numVal(row.CUR_BAL ?? row.cur_bal ?? (numVal(row.DR_AMT ?? row.dr_amt) - numVal(row.CR_AMT ?? row.cr_amt)));
    if (curBal <= 0.0001) return;
    out.CUR_BAL += curBal;
    const bIdx = ageingBucketIndex(diffDays(endDate, row.BILL_DATE ?? row.bill_date ?? row.VR_DATE ?? row.vr_date), ranges);
    out[`RANGE_${bIdx + 1}`] += curBal;
  });
  return Array.from(grouped.values())
    .filter((row) => row.CUR_BAL > 0.0001)
    .sort((a, b) => String(a.NAME).localeCompare(String(b.NAME)) || String(a.CODE).localeCompare(String(b.CODE)));
}

function guessImageMimeFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function likelyBase64Image(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(s) || s.length < 32) return false;
  try {
    const compact = s.replace(/\s+/g, '');
    const buf = Buffer.from(compact, 'base64');
    if (!buf || buf.length < 4) return false;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true; // GIF
    if (
      buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) return true; // WEBP
    const textHead = buf.subarray(0, Math.min(buf.length, 64)).toString('utf8').trimStart();
    if (textHead.startsWith('<svg')) return true; // SVG
    return false;
  } catch (_) {
    return false;
  }
}

function buildImageCandidatePaths(rawPath) {
  const s = String(rawPath || '').trim();
  if (!s) return [];
  const normalized = s.replace(/\//g, path.sep).replace(/\\/g, path.sep);
  const fileName = path.basename(normalized);
  const workspaceRoot = __dirname;
  const appRoot = GFASORCL_ROOT;
  const commonFolders = [
    workspaceRoot,
    appRoot,
    path.join(workspaceRoot, 'public'),
    path.join(appRoot, 'public'),
    path.join(appRoot, 'images'),
    path.join(appRoot, 'image'),
    path.join(appRoot, 'img'),
    path.join(appRoot, 'logo'),
    path.join(appRoot, 'logos'),
    path.join(workspaceRoot, 'images'),
    path.join(workspaceRoot, 'image'),
    path.join(workspaceRoot, 'img'),
    path.join(workspaceRoot, 'logo'),
    path.join(workspaceRoot, 'logos'),
  ];
  const candidates = [];
  candidates.push(normalized);
  candidates.push(path.resolve(workspaceRoot, normalized));
  candidates.push(path.resolve(appRoot, normalized));
  for (const folder of commonFolders) {
    candidates.push(path.join(folder, normalized));
    candidates.push(path.join(folder, fileName));
  }
  return Array.from(new Set(candidates));
}

function resolveExistingImagePath(rawPath) {
  const candidates = buildImageCandidatePaths(rawPath);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {
      // keep trying
    }
  }
  return null;
}

function getRowCiFieldName(row, logicalName) {
  if (!row || !logicalName) return null;
  const want = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase() === want) return k;
  }
  return null;
}

async function hydrateImageFieldInRows(rows, logicalName) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows) {
    const fieldName = getRowCiFieldName(row, logicalName);
    if (!fieldName) continue;
    const raw = row[fieldName];
    if (raw == null || raw === '') continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s) || /^blob:/i.test(s)) continue;
    if (likelyBase64Image(s)) {
      row[fieldName] = `data:image/png;base64,${s.replace(/\s+/g, '')}`;
      continue;
    }
    const candidates = buildImageCandidatePaths(s);
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const buf = await fs.promises.readFile(p);
        row[fieldName] = `data:${guessImageMimeFromPath(p)};base64,${buf.toString('base64')}`;
        break;
      } catch (_) {
        // Try next candidate path.
      }
    }
    if (row[fieldName] === raw && /[./\\:]/.test(s)) {
      console.warn(`⚠️ Could not resolve ${logicalName} file path: ${s}`);
    }
  }
}

app.get('/api/print-image', async (req, res) => {
  try {
    const rawPath = String(req.query.path || '').trim();
    if (!rawPath) return res.status(400).json({ error: 'path is required' });
    const resolved = resolveExistingImagePath(rawPath);
    if (!resolved) return res.status(404).json({ error: 'image file not found' });
    return res.sendFile(resolved);
  } catch (err) {
    console.error('❌ Print image error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/** dis/oth: 'both' | 'othQuoted' (only quoted round-off col) | 'none' */
function buildSaleBillPrintSql(qrSelectFragment, disOthMode) {
  let disOthLines = '';
  if (disOthMode === 'both') {
    disOthLines = `A.DIS_AMT,
        A.OTH_CD1,
        A.OTH_CD2,
        A.OTH_CD3,
        A.OTH_CD4,
        A.OTH_EXP1,
        A.OTH_EXP2,
        A.OTH_EXP3,
        A.OTH_EXP4,
        A.OTH_EXP5,
        W.NAME AS OTH_EXP_NAME1,
        X.NAME AS OTH_EXP_NAME2,
        Y.NAME AS OTH_EXP_NAME3,
        Z.NAME AS OTH_EXP_NAME4,
        `;
  } else if (disOthMode === 'othQuoted') {
    disOthLines = `A."oth_Exp5" AS OTH_EXP5,
        `;
  }
  return `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.GOD_CODE,
        A.CODE,
        B.NAME,
        B.ADD1,
        B.ADD2,
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.DELV_CODE,
        E.NAME AS DELV_NAME,
        E.ADD1 AS DELV_ADD1,
        E.ADD2 AS DELV_ADD2,
        E.CITY AS DELV_CITY,
        E.GST_NO AS DELV_GST_NO,
        E.PAN AS DELV_PAN,
        A.BK_CODE,
        C.NAME AS BK_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        D.ITEM_NAME,
        D.HSN_CODE,
        A.PACKING,
        A.QNTY,
        A.G_WEIGHT,
        A.D_WEIGHT,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.TAXABLE,
        A.CGST_PER,
        A.CGST_AMT,
        A.SGST_PER,
        A.SGST_AMT,
        A.IGST_PER,
        A.IGST_AMT,
        A.FREIGHT,
        A.BILL_AMT,
        A.SALE_INV_NO,
        A.SB_NO,
        A.SB_TYPE,
        A.SB_DATE,
        A.IRN_NO,
        A.ACK_NO,
        A.EWAY_NO,
        A.TRUCK_NO,
        A.TPT,
        A.GR_NO,
        ${disOthLines}${qrSelectFragment}
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.BK_CODE = C.CODE
      JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.DELV_CODE = E.CODE
      LEFT JOIN MASTER W ON A.COMP_CODE = W.COMP_CODE AND A.OTH_CD1 = W.CODE
      LEFT JOIN MASTER X ON A.COMP_CODE = X.COMP_CODE AND A.OTH_CD2 = X.CODE
      LEFT JOIN MASTER Y ON A.COMP_CODE = Y.COMP_CODE AND A.OTH_CD3 = Y.CODE
      LEFT JOIN MASTER Z ON A.COMP_CODE = Z.COMP_CODE AND A.OTH_CD4 = Z.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.TYPE = :type
        AND A.BILL_NO = :bill_no
        AND NVL(TRIM(A.B_TYPE), ' ') = NVL(TRIM(:b_type), ' ')
        AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
}

async function runSaleBillPrintRows(binds, comp_uid) {
  const typ = String(binds.type || '').trim().toUpperCase();
  /** Only SL/SE may carry e-invoice QR; CN etc. must not reference missing columns. QR only when line has GST. */
  const taxNonZero = '(NVL(A.CGST_AMT,0)+NVL(A.SGST_AMT,0)+NVL(A.IGST_AMT,0)) <> 0';
  const signedColAttempts = [
    'A."signed_Qr_code"',
    'A."signed_QR_code"',
    'A."signed_qr_code"',
    'A."SIGNED_QR_CODE"',
    'A.SIGNED_QR_CODE',
  ];
  const qrFragments =
    typ === 'SL' || typ === 'SE'
      ? signedColAttempts.map(
          (col) => `CASE WHEN ${taxNonZero} THEN ${col} ELSE CAST(NULL AS VARCHAR2(4000)) END AS SIGNED_QR_CODE`
        )
      : ['CAST(NULL AS VARCHAR2(4000)) AS SIGNED_QR_CODE'];
  const disOthModes = ['both', 'othQuoted', 'none'];
  let lastErr;
  for (const dom of disOthModes) {
    for (const frag of qrFragments) {
      try {
        const sql = buildSaleBillPrintSql(frag, dom);
        return await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || '');
        if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw e;
      }
    }
  }
  throw lastErr;
}

/** oracledb 6 may return BLOB/CLOB as Lob; read to string/base64 before JSON. Thin mode may not pass instanceof Lob. */
async function drainOracleLobsInRows(rows) {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (v == null || Buffer.isBuffer(v) || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        continue;
      if (v instanceof Date) continue;
      const hasGetData = typeof v.getData === 'function';
      const isLobClass = oracledb.Lob && v instanceof oracledb.Lob;
      if (!hasGetData && !isLobClass) continue;
      try {
        const data = await v.getData();
        if (data == null) continue;
        if (Buffer.isBuffer(data)) row[k] = data.toString('base64');
        else if (data instanceof Uint8Array) row[k] = Buffer.from(data).toString('base64');
        else row[k] = String(data);
      } catch (e) {
        console.error(`LOB read failed for column ${k}:`, e.message);
        row[k] = null;
      }
    }
  }
}

// --- ENDPOINTS ---

/** In-app update: enabled when deploy secret is set, or skip-key (env or deploy-update-no-key.txt). */
app.get('/api/deploy-update/status', (req, res) => {
  try {
    const skipKey = deployUpdateSkipKeyNow();
    const enabled = skipKey || (DEPLOY_UPDATE_SECRET && DEPLOY_UPDATE_SECRET.length >= 8);
    const requiresDeployKey = enabled && !skipKey;
    const recentLogLines = readDeployUpdateLogLines(10);
    const p = inferDeployProgress(deployUpdateJobLock, recentLogLines);
    res.json({
      enabled,
      requiresDeployKey,
      busy: deployUpdateJobLock,
      progressPercent: p.progressPercent,
      statusLabel: p.statusLabel,
      isFinished: p.isFinished,
      isError: p.isError,
      recentLogLines,
    });
  } catch (err) {
    console.error('deploy-update/status:', err.message);
    res.status(200).json({
      enabled: false,
      requiresDeployKey: true,
      busy: false,
      progressPercent: 0,
      statusLabel: '',
      isFinished: false,
      isError: false,
      recentLogLines: [],
    });
  }
});

/**
 * Pull latest from Git, npm ci, npm run build, restart Node stack (run-autostart-stack.cmd).
 * Body: { "deployKey": "<secret>" } unless skip-key mode (GFAS_DEPLOY_UPDATE_SKIP_KEY or deploy-update-no-key.txt).
 * Requires Node process user to be allowed to run PowerShell + git.
 */
app.post('/api/deploy-update', (req, res) => {
  try {
    if (!deployUpdateConfigured()) {
      return res.status(503).json({
        error:
          'In-app update is not configured. For no deploy key: set GFAS_DEPLOY_UPDATE_SKIP_KEY=1 or create an empty marker file next to server.cjs: deploy-update-no-key.txt (or deploy-update-no-key if extensions are hidden). Trusted networks only. Otherwise set GFAS_DEPLOY_UPDATE_KEY or deploy-update-secret.txt (first line, 8+ chars).',
      });
    }
    if (deployUpdateJobLock) {
      return res.status(429).json({
        error:
          'An update is already running. Wait for it to finish, check logs\\deploy-update.log, or restart the API if this message persists after the script has exited.',
      });
    }
    if (!deployUpdateSkipKeyNow()) {
      const key = String(req.body?.deployKey ?? req.body?.key ?? '').trim();
      if (!deployKeyMatches(key)) {
        return res.status(401).json({ error: 'Invalid deploy key.' });
      }
    }
    appendDeployLogLine('API request accepted: /api/deploy-update');
    deployUpdateJobLock = true;
    spawnDeployUpdateJob();
    res.json({
      ok: true,
      message:
        'Update and restart have been started in the background. Wait about 2–6 minutes, then refresh this page. If the site does not come back, check logs\\deploy-update.log on the server PC.',
    });
  } catch (err) {
    releaseDeployUpdateJobLock();
    console.error('deploy-update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** App login: USERS.USER_NAME (or USERNAME), USERS.PW — hub is usually GRAIN; if startup stayed GRAINFAS, try GRAIN here and then adopt GRAIN as hub for companies/years. */
app.post('/api/login', async (req, res) => {
  try {
    const user_name = String(req.body.user_name ?? req.body.USER_NAME ?? '')
      .trim()
      .toUpperCase();
    const pw = String(req.body.pw ?? req.body.PW ?? req.body.password ?? '')
      .trim()
      .toUpperCase();
    if (!user_name || !pw) {
      return res.status(400).json({ error: 'User name and password are required.' });
    }
    let rows = await lookupAppLoginRows(activeDbConfig, user_name, pw);
    if (
      GRAIN_ORACLE_HUB_ENABLED &&
      (!rows || rows.length === 0) &&
      isGrainfasHubUser(activeDbConfig)
    ) {
      try {
        const grainRows = await lookupAppLoginRows(DB_GRAIN, user_name, pw);
        if (grainRows && grainRows.length > 0) {
          rows = grainRows;
          activeDbConfig = DB_GRAIN;
          console.log(
            '📌 Hub switched to GRAIN after login (USERS was not found as GRAINFAS; using GRAIN for this process).'
          );
        }
      } catch (grainErr) {
        console.warn('⚠️ Login retry as Oracle user GRAIN failed:', formatOracleConnectErr(grainErr));
      }
    }
    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: 'Invalid user name or password.' });
    }
    const row = rows[0];
    const name = row.USER_NAME ?? row.user_name ?? user_name;
    res.json({ ok: true, user_name: String(name).trim().toUpperCase() });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 1. Get Company List
app.get('/api/companies', async (req, res) => {
  try {
    const userName = String(req.query.user_name ?? req.query.USER_NAME ?? '').trim().toUpperCase();
    let authorizedCompCode = '';
    if (userName) {
      authorizedCompCode = await lookupAuthorizedCompanyCode(activeDbConfig, userName);
    }
    const rows = await fetchCompanyListRows(authorizedCompCode);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Years for Company
app.get('/api/years', async (req, res) => {
  try {
    const rows = await runQuery(
      "SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt FROM compdet WHERE comp_code = :code ORDER BY comp_year DESC",
      { code: req.query.comp_code }
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function isOracleLobValue(v) {
  if (!v || typeof v !== 'object') return false;
  const n = v.constructor?.name || '';
  return n === 'Lob' || Buffer.isBuffer(v);
}

function newYearDirectoryPrefix() {
  const cfg = connectionConfig.oracle?.newYearDirectoryPrefix;
  if (cfg != null && String(cfg).trim()) return String(cfg).trim().toUpperCase();
  return 'GRAIN';
}

/** VFP: XYEAR = YEAR(E_DATE); DNAME = prefix + XYEAR */
function deriveYearFromEndingDateDmy(endDateDmy, prefix) {
  const end = parseDateOnly(endDateDmy);
  if (!end) return { newYear: 0, directoryName: '', compUid: '' };
  const xYear = String(end.getFullYear());
  const p = String(prefix || newYearDirectoryPrefix()).trim().toUpperCase();
  const directoryName = `${p}${xYear}`;
  return { newYear: Number(xYear), directoryName, compUid: directoryName };
}

function suggestNextFinancialYearFromCompdet(row) {
  const endRaw = rowValueCI(row, 'comp_e_dt');
  const end = parseDateOnly(endRaw);
  if (!end) return { startDateDmy: '', endDateDmy: '', newYear: 0, directoryName: '', compUid: '' };
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const endNew = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  const endDateDmy = formatDateDmyFromRaw(endNew);
  const derived = deriveYearFromEndingDateDmy(endDateDmy, newYearDirectoryPrefix());
  return {
    startDateDmy: formatDateDmyFromRaw(start),
    endDateDmy,
    newYear: derived.newYear,
    directoryName: derived.directoryName,
    compUid: derived.compUid,
  };
}

function assertOracleSchemaName(name) {
  const n = String(name || '').trim().toUpperCase();
  if (!n) throw new Error('Directory Name Should Not Be Empty');
  if (!/^[A-Z][A-Z0-9_$#]{0,29}$/.test(n)) {
    throw new Error(`Invalid directory name "${n}" for Oracle user`);
  }
  return n;
}

const NEW_YEAR_TX_TABLES = [
  'VOUCHER', 'LEDGER', 'SALE', 'PURCHASE', 'BILLS', 'LOTSTOCK', 'PRODUCT', 'CPUR',
  'AUDIT_LEDGER', 'AUDIT_LOTSTOCK', 'DBIKRI', 'JOBWORK', 'OPDET', 'PORDER', 'SORDER',
  'PUREXP_DET', 'COLDST', 'HI_RECEIPT', 'TDS', 'BANKSTMT', 'FREIGHT', 'INWARD', 'INDENT',
  'BIKRI', 'LEDGER_BIKRI', 'HI_PUR', 'HI_VOU', 'HI_TDS', 'SALE_PI', 'TDSDEPO', 'HI_BACKUP',
  'HI_BROKLEG', 'HI_INDENT', 'HI_JOBWORK', 'HI_MASTER', 'HI_PRODUCT', 'HI_SALE',
];

const NEW_YEAR_PRIMARY_KEYS = [
  ['MASTER', 'COMP_CODE,CODE'],
  ['ITEMMAST', 'COMP_CODE,ITEM_CODE'],
  ['SCHEDULE', 'COMP_CODE,NO'],
  ['VOUCHER', 'COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE,TRN_NO'],
  ['SALE', 'COMP_CODE,TYPE,BILL_NO,B_TYPE,TRN_NO'],
  ['PURCHASE', 'COMP_CODE,TYPE,R_DATE,R_NO,TRN_NO'],
  ['CATMAST', 'COMP_CODE,CAT_CODE'],
  ['COLDST', 'COMP_CODE,TYPE,R_DATE,R_NO,TRN_NO'],
  ['CPUR', 'COMP_CODE,TYPE,R_DATE,R_NO'],
  ['DANE', 'COMP_CODE,DANE'],
  ['DBIKRI', 'COMP_CODE,SV_NO,TRN_NO'],
  ['GODOWN', 'COMP_CODE,GOD_CODE'],
  ['ITEM_GRP', 'COMP_CODE,GRP_CODE'],
  ['JOBWORK', 'COMP_CODE,TYPE,R_NO,TRN_NO'],
  ['MARKA', 'COMP_CODE,MARKA'],
  ['NATURE', 'COMP_CODE,NATURE'],
  ['OPDET', 'COMP_CODE,OP_NO,TRN_NO'],
  ['PORDER', 'COMP_CODE,TYPE,SO_NO,TRN_NO'],
  ['PRODUCT', 'COMP_CODE,TYPE,R_DATE,R_NO,TRN_NO'],
  ['PUREXP_DET', 'COMP_CODE,TYPE,R_DATE,R_NO,TRN_NO'],
  ['SALE_PI', 'COMP_CODE,TYPE,BILL_NO,B_TYPE,TRN_NO'],
  ['SORDER', 'COMP_CODE,TYPE,SO_NO,TRN_NO'],
  ['HI_RECEIPT', 'COMP_CODE,VR_NO'],
];

const NEW_YEAR_TAKAJA_VIEW_SQL = `
CREATE OR REPLACE VIEW TAKAJA AS
SELECT A.COMP_CODE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE,
       MAX(F.NAME) NAME, MAX(F.CITY) CITY,
       SUM(NVL(QNTY,0)) QNTY, SUM(NVL(WEIGHT,0)) WEIGHT,
       SUM(NVL(DR_AMT,0)) DR_AMT, SUM(NVL(CR_AMT,0)) CR_AMT,
       SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) BILL_AMT,
       MAX(A.BK_CODE) BK_CODE, MAX(G.NAME) B_NAME, MAX(A.VR_TYPE) VR_TYPE,
       MAX((SELECT MAX(NVL(DAYS,0)) FROM BILLS B
            WHERE A.COMP_CODE=B.COMP_CODE AND A.CODE=B.CODE AND A.BILL_DATE=B.BILL_DATE
              AND A.BILL_NO=B.BILL_NO AND A.B_TYPE=B.B_TYPE AND B.VR_TYPE='SL')) N_DAYS
FROM BILLS A, MASTER F, MASTER G
WHERE SUBSTR(A.CODE,1,1)='C'
  AND (A.COMP_CODE=F.COMP_CODE AND A.CODE=F.CODE)
  AND (A.COMP_CODE=G.COMP_CODE(+) AND A.BK_CODE=G.CODE(+))
GROUP BY A.COMP_CODE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE`;

/** VFP DO setFUNC — full TAKAJA view (includes N_V_DATE, N_DAMI, N_ITEM_CODE). */
const SETFUNC_TAKAJA_VIEW_SQL = `
CREATE OR REPLACE VIEW TAKAJA AS
SELECT A.COMP_CODE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE,
       MAX(F.NAME) NAME, MAX(F.CITY) CITY,
       SUM(NVL(QNTY,0)) QNTY, SUM(NVL(WEIGHT,0)) WEIGHT,
       SUM(NVL(DR_AMT,0)) DR_AMT, SUM(NVL(CR_AMT,0)) CR_AMT,
       SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) BILL_AMT,
       MAX(A.BK_CODE) BK_CODE, MAX(G.NAME) B_NAME, MAX(A.VR_TYPE) VR_TYPE,
       MAX((SELECT MAX(NVL(DAYS,0)) FROM BILLS B
            WHERE A.COMP_CODE=B.COMP_CODE AND A.CODE=B.CODE AND A.BILL_DATE=B.BILL_DATE
              AND A.BILL_NO=B.BILL_NO AND A.B_TYPE=B.B_TYPE AND B.VR_TYPE='SL')) N_DAYS,
       MAX((SELECT MAX(V_DATE) FROM BILLS C
            WHERE A.COMP_CODE=C.COMP_CODE AND A.CODE=C.CODE AND A.BILL_DATE=C.BILL_DATE
              AND A.BILL_NO=C.BILL_NO AND A.B_TYPE=C.B_TYPE AND C.VR_TYPE='SL')) N_V_DATE,
       MAX((SELECT MAX(DAMI) FROM BILLS D
            WHERE A.COMP_CODE=D.COMP_CODE AND A.CODE=D.CODE AND A.BILL_DATE=D.BILL_DATE
              AND A.BILL_NO=D.BILL_NO AND A.B_TYPE=D.B_TYPE AND D.VR_TYPE='SL')) N_DAMI,
       MAX((SELECT MAX(ITEM_CODE) FROM BILLS E
            WHERE A.COMP_CODE=E.COMP_CODE AND A.CODE=E.CODE AND A.BILL_DATE=E.BILL_DATE
              AND A.BILL_NO=E.BILL_NO AND A.B_TYPE=E.B_TYPE AND E.VR_TYPE='SL')) N_ITEM_CODE
FROM BILLS A, MASTER F, MASTER G
WHERE SUBSTR(A.CODE,1,1)='C'
  AND (A.COMP_CODE=F.COMP_CODE AND A.CODE=F.CODE)
  AND (A.COMP_CODE=G.COMP_CODE(+) AND A.BK_CODE=G.CODE(+))
GROUP BY A.COMP_CODE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE`;

const SETFUNC_DROP_INDEX_SQL = [
  'DROP INDEX IND_BILLS',
  'DROP INDEX IND_BILLS1',
  'DROP INDEX IND_AUDIT_LEDGER',
  'DROP INDEX IND_AUDIT_LOTSTOCK',
  'DROP INDEX IND_LEDGER',
  'DROP INDEX IND_LEDGER1',
  'DROP INDEX IND_LOTSTOCK',
];

const SETFUNC_CREATE_INDEX_SQL = [
  'CREATE INDEX IND_BILLS ON BILLS(COMP_CODE,BK_CODE,CODE,BILL_DATE,BILL_NO,B_TYPE,V_DATE,CR_AMT)',
  'CREATE INDEX IND_BILLS1 ON BILLS(COMP_CODE,CODE,BILL_DATE,BILL_NO,B_TYPE,V_DATE,CR_AMT)',
  'CREATE INDEX IND_AUDIT_LEDGER ON AUDIT_LEDGER(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)',
  'CREATE INDEX IND_AUDIT_LOTSTOCK ON AUDIT_LOTSTOCK(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)',
  'CREATE INDEX IND_LEDGER ON LEDGER(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)',
  'CREATE INDEX IND_LEDGER1 ON LEDGER(COMP_CODE,CODE,VR_DATE,VR_NO,VR_TYPE,TYPE)',
  'CREATE INDEX IND_LOTSTOCK ON LOTSTOCK(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)',
];

function findNewYearSqlScript(fileName) {
  const dirs = [
    path.join(__dirname, 'oracle_scripts'),
    path.join(GFASORCL_ROOT, 'VFP-SCRIPTS'),
    path.join(__dirname, 'VFP-IMPORT'),
    GFASORCL_ROOT,
    __dirname,
  ];
  for (const dir of dirs) {
    const p = path.join(dir, fileName);
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {
      /* skip */
    }
  }
  return null;
}

function runOptionalSqlPlusScript(mpath, scriptPath) {
  return new Promise((resolve) => {
    const cmd = `sqlplus -S ${mpath}/${mpath}@XE @"${scriptPath}"`;
    const child = spawn(cmd, {
      windowsHide: true,
      stdio: 'ignore',
      shell: true,
    });
    child.on('error', () => resolve(false));
    child.on('exit', () => resolve(true));
    setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        /* ignore */
      }
      resolve(false);
    }, 120000);
  });
}

async function oracleSchemaUserExists(schemaName) {
  try {
    const rows = await runQuery(
      `SELECT 1 AS X FROM DBA_USERS WHERE UPPER(USERNAME) = :u AND ROWNUM = 1`,
      { u: schemaName }
    );
    return Boolean(rows?.length);
  } catch (_) {
    return false;
  }
}

async function fetchSourceOwnerTables(sourceOwner) {
  try {
    return await runQuery(
      `SELECT TABLE_NAME FROM DBA_TABLES WHERE OWNER = :owner ORDER BY 1`,
      { owner: sourceOwner }
    );
  } catch (_) {
    return [];
  }
}

function resolveNewYearSourceOwner(comp_uid, sourceRow) {
  const fromCompdet = String(rowValueCI(sourceRow, 'comp_uid') ?? '').trim().toUpperCase();
  const sessionUid = String(comp_uid ?? '').trim().toUpperCase();
  const hubUser = String(activeDbConfig.user || '').trim().toUpperCase();
  if (fromCompdet && fromCompdet !== hubUser) return fromCompdet;
  if (sessionUid && sessionUid !== hubUser) return sessionUid;
  return fromCompdet || sessionUid || hubUser;
}

async function executePrepareNewYearBooks({
  comp_code,
  comp_uid,
  start_date_dmy,
  end_date_dmy,
  new_year,
  directory_name,
}) {
  const MPATH = assertOracleSchemaName(directory_name);
  const yr = Number(new_year);
  const t0 = Date.now();
  const logStep = (msg) => console.log(`new-year-books [${Math.round((Date.now() - t0) / 1000)}s]: ${msg}`);
  if (!Number.isFinite(yr) || yr <= 0) throw new Error('new_year must be a positive number');

  const yearRows = await runQuery(
    `SELECT 1 AS X FROM compdet WHERE NVL(comp_year, 0) = :new_year AND ROWNUM = 1`,
    { new_year: yr }
  );
  if (yearRows?.length) throw new Error('Books Of This Year Already Entered');

  const uidDup = await compdetYearOrUidExists(comp_code, { new_comp_uid: MPATH, new_year: yr });
  if (uidDup) throw new Error(uidDup);

  const source = await runCompdetHeaderRow(comp_code, comp_uid);
  if (!source) throw new Error('Current compdet row not found');
  stripSalePrintImageFields(source);
  const sourceOwner = resolveNewYearSourceOwner(comp_uid, source);
  logStep(`start → ${MPATH} from source schema ${sourceOwner}`);

  logStep('insert compdet row');
  await insertCompdetCloneForNewYear(source, {
    new_comp_uid: MPATH,
    new_year: yr,
    start_date_dmy,
    end_date_dmy,
  });

  logStep(`create/grant Oracle user ${MPATH}`);
  const userExists = await oracleSchemaUserExists(MPATH);
  if (!userExists) {
    await runQuery(`CREATE USER ${MPATH} IDENTIFIED BY ${MPATH}`, {}, null, { autoCommit: true });
  }
  await runQuery(`GRANT CONNECT, DBA, RESOURCE TO ${MPATH}`, {}, null, { autoCommit: true });

  const tableRows = await fetchSourceOwnerTables(sourceOwner);
  const totalTables = tableRows?.length || 0;
  logStep(`cloning ${totalTables} tables from ${sourceOwner} → ${MPATH} (may take several minutes)`);
  let cloned = 0;
  for (let i = 0; i < (tableRows || []).length; i++) {
    const row = tableRows[i];
    const tn = String(row.TABLE_NAME ?? row.table_name ?? '').trim();
    if (!tn) continue;
    if (i === 0 || (i + 1) % 5 === 0 || i + 1 === totalTables) {
      logStep(`clone table ${i + 1}/${totalTables}: ${tn}`);
    }
    try {
      await runQuery(
        `CREATE TABLE ${MPATH}.${tn} AS SELECT * FROM ${sourceOwner}.${tn}`,
        {},
        null,
        { autoCommit: true, suppressDbErrorLog: true, callTimeout: 300000 }
      );
      cloned += 1;
    } catch (cloneErr) {
      console.warn(`new-year-books: skip clone ${tn}:`, cloneErr.message);
    }
  }
  logStep(`cloned ${cloned}/${totalTables} tables`);

  logStep('clear transactional tables');
  for (const tbl of NEW_YEAR_TX_TABLES) {
    try {
      await runQuery(`DELETE FROM ${tbl}`, {}, MPATH, { autoCommit: true, suppressDbErrorLog: true });
    } catch (_) {
      /* table may not exist in this schema */
    }
  }

  logStep('rebuild primary keys');
  await rebuildPrimaryKeys(MPATH);

  for (const scriptName of ['ORAFUN.TXT', 'TAKAJAFUN.TXT']) {
    const scriptPath = findNewYearSqlScript(scriptName);
    if (scriptPath) {
      console.log(`new-year-books: running ${scriptName}`);
      await runOptionalSqlPlusScript(MPATH, scriptPath);
    }
  }

  try {
    await runQuery(`DROP VIEW TAKAJA`, {}, MPATH, { autoCommit: true, suppressDbErrorLog: true });
  } catch (_) {
    /* view may not exist */
  }
  try {
    await runQuery(NEW_YEAR_TAKAJA_VIEW_SQL, {}, MPATH, { autoCommit: true, suppressDbErrorLog: true });
  } catch (viewErr) {
    console.warn('new-year-books: TAKAJA view:', viewErr.message);
  }

  for (const idxSql of [
    'CREATE INDEX IND_BILLS ON BILLS(COMP_CODE,BK_CODE,CODE,BILL_DATE,BILL_NO,B_TYPE,V_DATE,CR_AMT)',
    'CREATE INDEX IND_LEDGER ON LEDGER(COMP_CODE,VR_TYPE,VR_DATE,VR_NO,TYPE)',
  ]) {
    try {
      await runQuery(idxSql, {}, MPATH, { autoCommit: true, suppressDbErrorLog: true });
    } catch (_) {
      /* index may already exist */
    }
  }

  const soraPath = findNewYearSqlScript('SORAFUN.TXT');
  if (soraPath) {
    logStep('running SORAFUN.TXT');
    await runOptionalSqlPlusScript(MPATH, soraPath);
  }

  logStep(`finished OK (${Math.round((Date.now() - t0) / 1000)}s total)`);
  return { MPATH, new_year: yr, tablesCloned: cloned, sourceOwner };
}

function primaryKeyDefinitions() {
  return NEW_YEAR_PRIMARY_KEYS.map(([table, columns]) => ({
    table,
    columns,
    constraint: `PK_${table}`,
  }));
}

function findPrimaryKeyDefinition(tableName) {
  const tbl = String(tableName || '').trim().toUpperCase();
  const row = NEW_YEAR_PRIMARY_KEYS.find(([name]) => String(name).toUpperCase() === tbl);
  if (!row) return null;
  return { table: row[0], columns: row[1], constraint: `PK_${row[0]}` };
}

async function rebuildPrimaryKeyForTable(schemaUid, tbl, cols) {
  const entry = { table: tbl, columns: cols, constraint: `PK_${tbl}`, status: 'ok', message: '' };
  try {
    await runQuery(`ALTER TABLE ${tbl} DROP CONSTRAINT PK_${tbl}`, {}, schemaUid, {
      autoCommit: true,
      suppressDbErrorLog: true,
    });
  } catch (_) {
    /* no existing PK */
  }
  try {
    await runQuery(
      `ALTER TABLE ${tbl} ADD CONSTRAINT PK_${tbl} PRIMARY KEY (${cols})`,
      {},
      schemaUid,
      { autoCommit: true, suppressDbErrorLog: true }
    );
  } catch (pkErr) {
    entry.status = 'skipped';
    entry.message = pkErr.message;
    console.warn(`primary-key: PK skip ${tbl}:`, pkErr.message);
  }
  return entry;
}

async function rebuildPrimaryKeys(schemaUid) {
  const results = [];
  for (const [tbl, cols] of NEW_YEAR_PRIMARY_KEYS) {
    results.push(await rebuildPrimaryKeyForTable(schemaUid, tbl, cols));
  }
  return results;
}

function isDesktopOnlyUtilityMobileClient(req) {
  const hdr = String(req.headers['x-client-view'] || '').trim().toLowerCase();
  if (hdr === 'mobile') return true;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (String(body.client_view || '').trim().toLowerCase() === 'mobile') return true;
  return false;
}

/** Mobile-only utilities (VFP DO FORM update) — reject desktop / Desktop View clients. */
function isMobileOnlyUtilityDesktopClient(req) {
  return !isDesktopOnlyUtilityMobileClient(req);
}

function assertMobileOnlyUtilityClient(req, utilityTitle = 'This utility') {
  if (isMobileOnlyUtilityDesktopClient(req)) {
    const err = new Error(
      `${utilityTitle} is available on mobile only. Open on a phone/tablet, or switch to Mobile View in Settings.`
    );
    err.status = 403;
    throw err;
  }
}

/** VFP DO primary_key — rebuild primary keys on current company schema */
app.get('/api/primary-key/context', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Primary Key rebuild cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const comp_uid = String(req.query.comp_uid || '').trim();
    const user_name = String(req.query.user_name || '').trim();
    if (!comp_uid) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    const permissions = await fetchNewYearBooksPerms(user_name);
    res.json({
      permissions,
      context: {
        schema: comp_uid,
        tables: primaryKeyDefinitions(),
      },
    });
  } catch (err) {
    console.error('❌ primary-key context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/primary-key/table', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Primary Key rebuild cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const comp_uid = String(body.comp_uid || '').trim();
    const user_name = String(body.user_name || '').trim();
    const table = String(body.table || '').trim();
    const index = Number(body.index);
    if (!comp_uid) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    const permissions = await fetchNewYearBooksPerms(user_name);
    if (!permissions.canProceed) {
      return res.status(403).json({ error: 'Supervisor access required to rebuild primary keys' });
    }

    let def = findPrimaryKeyDefinition(table);
    if (!def && Number.isFinite(index) && index >= 0 && index < NEW_YEAR_PRIMARY_KEYS.length) {
      const [tbl, cols] = NEW_YEAR_PRIMARY_KEYS[index];
      def = { table: tbl, columns: cols, constraint: `PK_${tbl}` };
    }
    if (!def) {
      return res.status(400).json({ error: 'Unknown primary key table' });
    }

    const total = NEW_YEAR_PRIMARY_KEYS.length;
    const current = Number.isFinite(index) && index >= 0
      ? index + 1
      : NEW_YEAR_PRIMARY_KEYS.findIndex(([name]) => name === def.table) + 1;
    const result = await rebuildPrimaryKeyForTable(comp_uid, def.table, def.columns);
    res.json({
      ok: true,
      schema: comp_uid,
      progress: {
        current,
        total,
        remaining: Math.max(0, total - current),
        table: def.table,
        constraint: def.constraint,
      },
      result,
    });
  } catch (err) {
    console.error('❌ primary-key table error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/primary-key', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Primary Key rebuild cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const comp_uid = String(body.comp_uid || '').trim();
    const user_name = String(body.user_name || '').trim();
    if (!comp_uid) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    const permissions = await fetchNewYearBooksPerms(user_name);
    if (!permissions.canProceed) {
      return res.status(403).json({ error: 'Supervisor access required to rebuild primary keys' });
    }
    const results = await rebuildPrimaryKeys(comp_uid);
    const okCount = results.filter((r) => r.status === 'ok').length;
    const skipCount = results.filter((r) => r.status === 'skipped').length;
    res.json({
      ok: true,
      message: 'DONE',
      schema: comp_uid,
      okCount,
      skipCount,
      results,
    });
  } catch (err) {
    console.error('❌ primary-key POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function fetchSetFunctionSchemas() {
  const rows = await runQuery(
    `SELECT TRIM(TO_CHAR(COMP_UID)) AS COMP_UID FROM compdet GROUP BY TRIM(TO_CHAR(COMP_UID)) ORDER BY 1`
  );
  return (rows || [])
    .map((r) => String(r.COMP_UID ?? r.comp_uid ?? '').trim())
    .filter(Boolean);
}

function buildSetFunctionSteps(schemas) {
  const list = Array.isArray(schemas) ? schemas : [];
  const steps = [];
  const scriptPhases = [
    { phase: 'ORAFUN', script: 'ORAFUN.TXT' },
    { phase: 'TAKAJAFUN', script: 'TAKAJAFUN.TXT' },
  ];
  for (const { phase, script } of scriptPhases) {
    for (const schema of list) {
      steps.push({
        phase,
        schema,
        script,
        label: `${script} on ${schema}`,
      });
    }
  }
  steps.push({ phase: 'VIEW_DROP', schema: null, label: 'Drop view TAKAJA' });
  steps.push({ phase: 'VIEW_CREATE', schema: null, label: 'Create view TAKAJA' });
  for (const sql of SETFUNC_DROP_INDEX_SQL) {
    steps.push({ phase: 'INDEX_DROP', schema: null, sql, label: sql });
  }
  for (const sql of SETFUNC_CREATE_INDEX_SQL) {
    steps.push({ phase: 'INDEX_CREATE', schema: null, sql, label: sql });
  }
  for (const schema of list) {
    steps.push({
      phase: 'SORAFUN',
      schema,
      script: 'SORAFUN.TXT',
      label: `SORAFUN.TXT on ${schema}`,
    });
  }
  return steps.map((step, index) => ({ ...step, index }));
}

async function executeSetFunctionStep(step) {
  const entry = {
    index: step.index,
    phase: step.phase,
    schema: step.schema,
    label: step.label,
    status: 'ok',
    message: '',
  };
  try {
    if (step.phase === 'ORAFUN' || step.phase === 'TAKAJAFUN' || step.phase === 'SORAFUN') {
      const scriptName = step.script;
      const scriptPath = findNewYearSqlScript(scriptName);
      if (!scriptPath) {
        entry.status = 'skipped';
        entry.message = `${scriptName} not found`;
        return entry;
      }
      await runOptionalSqlPlusScript(step.schema, scriptPath);
      entry.message = `${scriptName} executed`;
      return entry;
    }
    if (step.phase === 'VIEW_DROP') {
      try {
        await runQuery('DROP VIEW TAKAJA', {}, null, { autoCommit: true, suppressDbErrorLog: true });
      } catch (_) {
        /* view may not exist */
      }
      entry.message = 'TAKAJA dropped';
      return entry;
    }
    if (step.phase === 'VIEW_CREATE') {
      await runQuery(SETFUNC_TAKAJA_VIEW_SQL, {}, null, { autoCommit: true, suppressDbErrorLog: true });
      entry.message = 'TAKAJA created';
      return entry;
    }
    if (step.phase === 'INDEX_DROP' || step.phase === 'INDEX_CREATE') {
      try {
        await runQuery(step.sql, {}, null, { autoCommit: true, suppressDbErrorLog: true });
      } catch (idxErr) {
        entry.status = 'skipped';
        entry.message = idxErr.message;
        return entry;
      }
      entry.message = 'Done';
      return entry;
    }
    entry.status = 'skipped';
    entry.message = 'Unknown step';
  } catch (err) {
    entry.status = 'skipped';
    entry.message = err.message;
    console.warn(`set-function: skip ${step.label}:`, err.message);
  }
  return entry;
}

/** VFP DO setFUNC — ORAFUN / TAKAJAFUN / TAKAJA view / indexes / SORAFUN */
app.get('/api/set-function/context', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Set Function cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const user_name = String(req.query.user_name || '').trim();
    const permissions = await fetchNewYearBooksPerms(user_name);
    const schemas = await fetchSetFunctionSchemas();
    const steps = buildSetFunctionSteps(schemas);
    res.json({
      permissions,
      context: {
        schemas,
        steps,
        totalSteps: steps.length,
      },
    });
  } catch (err) {
    console.error('❌ set-function context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/set-function/step', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Set Function cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const user_name = String(body.user_name || '').trim();
    const index = Number(body.index);
    if (!Number.isFinite(index) || index < 0) {
      return res.status(400).json({ error: 'index is required' });
    }
    const permissions = await fetchNewYearBooksPerms(user_name);
    if (!permissions.canProceed) {
      return res.status(403).json({ error: 'Supervisor access required to run Set Function' });
    }
    const schemas = await fetchSetFunctionSchemas();
    const steps = buildSetFunctionSteps(schemas);
    const step = steps[index];
    if (!step) {
      return res.status(400).json({ error: 'Invalid step index' });
    }
    const result = await executeSetFunctionStep(step);
    res.json({
      ok: true,
      progress: {
        current: index + 1,
        total: steps.length,
        remaining: Math.max(0, steps.length - index - 1),
        label: step.label,
        phase: step.phase,
        schema: step.schema,
      },
      result,
    });
  } catch (err) {
    console.error('❌ set-function step error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function buildTakajaQuerySteps(comp_uid) {
  const schema = String(comp_uid || '').trim();
  return [
    { index: 0, phase: 'VIEW_DROP', schema: null, label: 'Drop view TAKAJA' },
    { index: 1, phase: 'VIEW_CREATE', schema: null, label: 'Create view TAKAJA' },
    {
      index: 2,
      phase: 'TAKAJAFUN',
      schema,
      script: 'TAKAJAFUN.TXT',
      label: schema ? `TAKAJAFUN.TXT on ${schema}` : 'TAKAJAFUN.TXT',
    },
  ];
}

async function executeTakajaQueryStep(step) {
  const entry = {
    index: step.index,
    phase: step.phase,
    schema: step.schema,
    label: step.label,
    status: 'ok',
    message: '',
  };
  try {
    if (step.phase === 'VIEW_DROP') {
      try {
        await runQuery('DROP VIEW TAKAJA', {}, null, { autoCommit: true, suppressDbErrorLog: true });
      } catch (_) {
        /* view may not exist */
      }
      entry.message = 'TAKAJA dropped';
      return entry;
    }
    if (step.phase === 'VIEW_CREATE') {
      await runQuery(SETFUNC_TAKAJA_VIEW_SQL, {}, null, { autoCommit: true, suppressDbErrorLog: true });
      entry.message = 'TAKAJA created';
      return entry;
    }
    if (step.phase === 'TAKAJAFUN') {
      if (!step.schema) {
        entry.status = 'skipped';
        entry.message = 'comp_uid is required for TAKAJAFUN.TXT';
        return entry;
      }
      const scriptPath = findNewYearSqlScript('TAKAJAFUN.TXT');
      if (!scriptPath) {
        entry.status = 'skipped';
        entry.message = 'TAKAJAFUN.TXT not found';
        return entry;
      }
      await runOptionalSqlPlusScript(step.schema, scriptPath);
      entry.message = 'TAKAJAFUN.TXT executed';
      return entry;
    }
    entry.status = 'skipped';
    entry.message = 'Unknown step';
  } catch (err) {
    entry.status = 'skipped';
    entry.message = err.message;
    console.warn(`takaja-query: skip ${step.label}:`, err.message);
  }
  return entry;
}

/** VFP DO TAKAJA_QUERY — drop/create TAKAJA view + TAKAJAFUN.TXT on current schema */
app.get('/api/takaja-query/context', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Takaja Query cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const comp_uid = String(req.query.comp_uid || '').trim();
    const user_name = String(req.query.user_name || '').trim();
    if (!comp_uid) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    const permissions = await fetchNewYearBooksPerms(user_name);
    const steps = buildTakajaQuerySteps(comp_uid);
    res.json({
      permissions,
      context: {
        schema: comp_uid,
        steps,
        totalSteps: steps.length,
      },
    });
  } catch (err) {
    console.error('❌ takaja-query context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/takaja-query/step', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Takaja Query cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const comp_uid = String(body.comp_uid || '').trim();
    const user_name = String(body.user_name || '').trim();
    const index = Number(body.index);
    if (!comp_uid) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    if (!Number.isFinite(index) || index < 0) {
      return res.status(400).json({ error: 'index is required' });
    }
    const permissions = await fetchNewYearBooksPerms(user_name);
    if (!permissions.canProceed) {
      return res.status(403).json({ error: 'Supervisor access required to run Takaja Query' });
    }
    const steps = buildTakajaQuerySteps(comp_uid);
    const step = steps[index];
    if (!step) {
      return res.status(400).json({ error: 'Invalid step index' });
    }
    const result = await executeTakajaQueryStep(step);
    res.json({
      ok: true,
      progress: {
        current: index + 1,
        total: steps.length,
        remaining: Math.max(0, steps.length - index - 1),
        label: step.label,
        phase: step.phase,
        schema: step.schema,
      },
      result,
    });
  } catch (err) {
    console.error('❌ takaja-query step error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function fetchNewYearBooksPerms(user_name) {
  const perms = await fetchUserMasterAdminPerms(String(user_name || ''), null);
  return {
    isSupervisor: perms.isSupervisor,
    canProceed: perms.isSupervisor,
  };
}

async function compdetYearOrUidExists(comp_code, { new_year, new_comp_uid }) {
  if (new_comp_uid != null && String(new_comp_uid).trim() !== '') {
    const rows = await runQuery(
      `SELECT 1 AS X FROM compdet
       WHERE comp_code = :comp_code AND TRIM(TO_CHAR(comp_uid)) = :new_uid AND ROWNUM = 1`,
      { comp_code, new_uid: String(new_comp_uid).trim() }
    );
    if (rows?.length) return `comp_uid ${new_comp_uid} already exists for this company`;
  }
  const yr = Number(new_year);
  if (Number.isFinite(yr) && yr > 0) {
    const rows = await runQuery(
      `SELECT 1 AS X FROM compdet
       WHERE comp_code = :comp_code AND NVL(comp_year, 0) = :new_year AND ROWNUM = 1`,
      { comp_code, new_year: yr }
    );
    if (rows?.length) return `Financial year ${yr} already exists for this company`;
  }
  return null;
}

async function insertCompdetCloneForNewYear(sourceRow, { new_comp_uid, new_year, start_date_dmy, end_date_dmy }) {
  const skipCols = new Set(['rowid']);
  const override = {
    comp_uid: String(new_comp_uid).trim(),
    comp_year: Number(new_year),
    comp_s_dt: start_date_dmy,
    comp_e_dt: end_date_dmy,
  };
  const cols = [];
  const valExprs = [];
  const binds = {};
  let bindIdx = 0;

  for (const key of Object.keys(sourceRow)) {
    const col = String(key).toLowerCase();
    if (skipCols.has(col)) continue;
    const raw = sourceRow[key];
    if (isOracleLobValue(raw)) continue;

    const bindKey = `b${bindIdx++}`;
    cols.push(col);
    if (col === 'comp_s_dt' || col === 'comp_e_dt') {
      valExprs.push(`TO_DATE(:${bindKey}, 'DD-MM-YYYY')`);
      binds[bindKey] = override[col] ?? formatDateDmyFromRaw(raw);
    } else if (Object.prototype.hasOwnProperty.call(override, col)) {
      valExprs.push(`:${bindKey}`);
      binds[bindKey] = override[col];
    } else {
      valExprs.push(`:${bindKey}`);
      binds[bindKey] = raw;
    }
  }

  if (!cols.length) throw new Error('Unable to read compdet columns for clone');

  await runQuery(
    `INSERT INTO compdet (${cols.join(', ')}) VALUES (${valExprs.join(', ')})`,
    binds,
    null,
    { autoCommit: true }
  );
}

/** VFP DO FORM prepare — context for Prepare New Year Books */
app.get('/api/new-year-books/context', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code || '').trim();
    const comp_uid = String(req.query.comp_uid || '').trim();
    const user_name = String(req.query.user_name || '').trim();
    if (!comp_code || !comp_uid) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }

    const permissions = await fetchNewYearBooksPerms(user_name);
    const source = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!source) {
      return res.status(404).json({ error: 'Current compdet row not found', permissions });
    }

    const prefix = newYearDirectoryPrefix();
    const fy = suggestNextFinancialYearFromCompdet(source);
    const currentYear = rowValueCI(source, 'comp_year');
    const currentEndDate = rowValueCI(source, 'comp_e_dt');
    const compName = rowValueCI(source, 'comp_name') || '';
    const yearExists = Boolean(
      await compdetYearOrUidExists(comp_code, {
        new_year: fy.newYear,
        new_comp_uid: fy.compUid,
      })
    );

    res.json({
      permissions,
      context: {
        currentYear,
        currentEndDate,
        directoryPrefix: prefix,
        suggestedStartDate: fy.startDateDmy,
        suggestedEndDate: fy.endDateDmy,
        suggestedNewYear: fy.newYear,
        suggestedCompUid: fy.compUid,
        suggestedDirectoryName: fy.directoryName,
        yearExists,
        compName,
      },
    });
  } catch (err) {
    console.error('❌ new-year-books context error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function isNewYearBooksMobileClient(req) {
  return isDesktopOnlyUtilityMobileClient(req);
}

/** VFP DO FORM prepare — insert cloned compdet row for new financial year */
app.post('/api/new-year-books', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (isNewYearBooksMobileClient(req)) {
      return res.status(403).json({
        error: 'New Year Books cannot be created from mobile. Use desktop view on a computer.',
      });
    }
    const comp_code = String(body.comp_code || '').trim();
    const comp_uid = String(body.comp_uid || '').trim();
    const user_name = String(body.user_name || '').trim();
    const directory_name = String(body.directory_name || body.new_comp_uid || '').trim();
    const start_date = String(body.start_date || '').trim();
    const end_date = String(body.end_date || '').trim();
    const new_year = Number(body.new_year);

    if (!comp_code || !comp_uid) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (!directory_name) {
      return res.status(400).json({ error: 'Directory Name Should Not Be Empty' });
    }
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required (DD-MM-YYYY)' });
    }
    if (!Number.isFinite(new_year) || new_year <= 0) {
      return res.status(400).json({ error: 'new_year must be a positive number' });
    }

    const permissions = await fetchNewYearBooksPerms(user_name);
    if (!permissions.canProceed) {
      return res.status(403).json({ error: 'Supervisor access required to prepare new year books' });
    }

    let MPATH;
    try {
      MPATH = assertOracleSchemaName(directory_name);
    } catch (nameErr) {
      return res.status(400).json({ error: nameErr.message });
    }

    const result = await executePrepareNewYearBooks({
      comp_code,
      comp_uid,
      start_date_dmy: start_date,
      end_date_dmy: end_date,
      new_year,
      directory_name: MPATH,
    });

    const yearRow = {
      COMP_CODE: comp_code,
      COMP_UID: result.MPATH,
      COMP_YEAR: result.new_year,
      COMP_S_DT: start_date,
      COMP_E_DT: end_date,
    };

    res.json({
      ok: true,
      message: 'New Year Books Prepared Successfully.',
      yearRow,
      directory_name: MPATH,
    });
  } catch (err) {
    console.error('❌ new-year-books save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function formatDateDmyFromRaw(raw) {
  const d = parseDateOnly(raw);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function buildMonthSlotsBetween(sDateDmy, eDateDmy) {
  const start = parseDateOnly(sDateDmy);
  const end = parseDateOnly(eDateDmy);
  if (!start || !end) return [];
  const slots = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur.getTime() <= endMonth.getTime()) {
    const y = cur.getFullYear();
    const m = cur.getMonth() + 1;
    slots.push({
      monthKey: `${y}-${String(m).padStart(2, '0')}`,
      label: cur.toLocaleString('en-IN', { month: 'short' }),
      calYear: y,
      calMonth: m,
    });
    cur = new Date(y, cur.getMonth() + 1, 1);
  }
  return slots;
}

/** GFASORCL: SALE.TYPE is SL/SE/CN; ITEM_CODE is NUMBER (join ITEMMAST on A.ITEM_CODE = C.ITEM_CODE). */
const SALE_GRAPH_TYPE_SQL = "UPPER(TRIM(A.TYPE)) IN ('SL', 'SE', 'CN')";
const SALE_GRAPH_WT_EXPR =
  "CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) END";
const SALE_GRAPH_AMT_EXPR =
  "CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.BILL_AMT, 0) ELSE NVL(A.BILL_AMT, 0) END";

function parseItemCodeForSql(raw) {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function saleGraphItemFilterSql(item_code) {
  const code = parseItemCodeForSql(item_code);
  if (code === undefined) return { sql: '', binds: {} };
  return {
    sql: ' AND A.ITEM_CODE = :item_code ',
    binds: { item_code: code },
  };
}

async function fetchSaleMonthlyAggregate(comp_code, comp_uid, s_date, e_date, item_code = '') {
  const itemFilter = saleGraphItemFilterSql(item_code);
  const sql = `
    SELECT
      TO_CHAR(TRUNC(A.BILL_DATE, 'MM'), 'YYYY-MM') AS MONTH_KEY,
      TRIM(TO_CHAR(A.BILL_DATE, 'MON', 'NLS_DATE_LANGUAGE=ENGLISH')) AS MONTH_NAME,
      SUM(${SALE_GRAPH_WT_EXPR}) AS TOTAL_WEIGHT,
      SUM(${SALE_GRAPH_AMT_EXPR}) AS TOTAL_AMOUNT,
      COUNT(*) AS LINE_COUNT
    FROM SALE A
    WHERE A.COMP_CODE = :comp_code
      AND ${SALE_GRAPH_TYPE_SQL}
      AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY'))
                                  AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
      ${itemFilter.sql}
    GROUP BY TRUNC(A.BILL_DATE, 'MM'),
             TO_CHAR(A.BILL_DATE, 'MON', 'NLS_DATE_LANGUAGE=ENGLISH')
    ORDER BY MONTH_KEY`;
  return runQuery(sql, { comp_code, s_date, e_date, ...itemFilter.binds }, comp_uid);
}

/** All items × month in one query (for item-wise charts). */
async function fetchSaleMonthlyByItemRows(comp_code, comp_uid, s_date, e_date) {
  const sql = `
    SELECT
      A.ITEM_CODE,
      NVL(MAX(C.ITEM_NAME), TO_CHAR(A.ITEM_CODE)) AS ITEM_NAME,
      TO_CHAR(TRUNC(A.BILL_DATE, 'MM'), 'YYYY-MM') AS MONTH_KEY,
      SUM(${SALE_GRAPH_WT_EXPR}) AS TOTAL_WEIGHT,
      SUM(${SALE_GRAPH_AMT_EXPR}) AS TOTAL_AMOUNT,
      COUNT(*) AS LINE_COUNT
    FROM SALE A
    LEFT JOIN ITEMMAST C
      ON A.COMP_CODE = C.COMP_CODE
     AND A.ITEM_CODE = C.ITEM_CODE
    WHERE A.COMP_CODE = :comp_code
      AND ${SALE_GRAPH_TYPE_SQL}
      AND A.ITEM_CODE IS NOT NULL
      AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY'))
                                  AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
    GROUP BY A.ITEM_CODE,
             TRUNC(A.BILL_DATE, 'MM'),
             TO_CHAR(A.BILL_DATE, 'MON', 'NLS_DATE_LANGUAGE=ENGLISH')
    ORDER BY A.ITEM_CODE, MONTH_KEY`;
  return runQuery(sql, { comp_code, s_date, e_date }, comp_uid);
}

function mapSaleMonthlyByItem(rows) {
  const byItem = new Map();
  for (const row of rows || []) {
    const itemCode = String(row.ITEM_CODE ?? row.item_code ?? '').trim();
    if (!itemCode) continue;
    const monthKey = String(row.MONTH_KEY ?? row.month_key ?? '').trim();
    if (!monthKey) continue;
    if (!byItem.has(itemCode)) {
      byItem.set(itemCode, {
        itemCode,
        itemName: String(row.ITEM_NAME ?? row.item_name ?? itemCode).trim(),
        months: new Map(),
      });
    }
    const entry = byItem.get(itemCode);
    if (row.ITEM_NAME ?? row.item_name) {
      entry.itemName = String(row.ITEM_NAME ?? row.item_name).trim();
    }
    entry.months.set(monthKey, {
      weight: Number(row.TOTAL_WEIGHT ?? row.total_weight ?? 0) || 0,
      amount: Number(row.TOTAL_AMOUNT ?? row.total_amount ?? 0) || 0,
      lineCount: Number(row.LINE_COUNT ?? row.line_count ?? 0) || 0,
    });
  }
  return byItem;
}

function buildItemMonthSeries(slots, prevSlots, curItemMonths, prevItemMonths, hasPrevious) {
  const curMap = curItemMonths instanceof Map ? curItemMonths : mapSaleMonthlyRows([]);
  const prevMap = prevItemMonths instanceof Map ? prevItemMonths : new Map();
  return buildSaleGraphPayload({
    slots,
    prevSlots,
    currentMap: curMap,
    previousMap: prevMap,
    currentYearLabel: '',
    previousYearLabel: '',
    hasPrevious,
  });
}

async function resolveSaleGraphPreviousYear(comp_code, comp_uid, slots) {
  let previousMap = new Map();
  let prevSlots = [];
  let previousYearLabel = '';
  let hasPrevious = false;
  let prevUid = null;
  let ps = '';
  let pe = '';

  const yearRows = await runQuery(
    'SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt FROM compdet WHERE comp_code = :code ORDER BY comp_year DESC',
    { code: comp_code }
  );
  const uidNorm = String(comp_uid).trim();
  const idx = (yearRows || []).findIndex((r) => String(r.COMP_UID ?? r.comp_uid ?? '').trim() === uidNorm);
  const prevRow = idx >= 0 && idx + 1 < yearRows.length ? yearRows[idx + 1] : null;

  if (prevRow) {
    prevUid = prevRow.COMP_UID ?? prevRow.comp_uid;
    ps = formatDateDmyFromRaw(prevRow.COMP_S_DT ?? prevRow.comp_s_dt);
    pe = formatDateDmyFromRaw(prevRow.COMP_E_DT ?? prevRow.comp_e_dt);
    if (prevUid != null && String(prevUid).trim() !== '' && ps && pe) {
      previousYearLabel = String(prevRow.COMP_YEAR ?? prevRow.comp_year ?? '').trim();
      hasPrevious = true;
      prevSlots = buildMonthSlotsBetween(ps, pe);
      while (prevSlots.length < slots.length) {
        const i = prevSlots.length;
        prevSlots.push({
          monthKey: `__prev_pad_${i}`,
          label: slots[i]?.label || '',
          calYear: 0,
          calMonth: 0,
        });
      }
    }
  }

  return { previousMap, prevSlots, previousYearLabel, hasPrevious, prevUid, ps, pe };
}

function mapSaleMonthlyRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.MONTH_KEY ?? row.month_key ?? '').trim();
    if (!key) continue;
    map.set(key, {
      weight: Number(row.TOTAL_WEIGHT ?? row.total_weight ?? 0) || 0,
      amount: Number(row.TOTAL_AMOUNT ?? row.total_amount ?? 0) || 0,
      lineCount: Number(row.LINE_COUNT ?? row.line_count ?? 0) || 0,
    });
  }
  return map;
}

function buildSaleGraphPayload({
  slots,
  prevSlots,
  currentMap,
  previousMap,
  currentYearLabel,
  previousYearLabel,
  hasPrevious,
}) {
  const months = slots.map((slot, index) => {
    const cur = currentMap.get(slot.monthKey) || { weight: 0, amount: 0, lineCount: 0 };
    let previous = null;
    if (hasPrevious && prevSlots && prevSlots[index]) {
      const prevSlot = prevSlots[index];
      const pv = previousMap.get(prevSlot.monthKey) || { weight: 0, amount: 0, lineCount: 0 };
      previous = { weight: pv.weight, amount: pv.amount, lineCount: pv.lineCount };
    }
    return {
      monthKey: slot.monthKey,
      label: slot.label,
      fyIndex: index,
      current: { weight: cur.weight, amount: cur.amount, lineCount: cur.lineCount },
      previous,
    };
  });

  const sumSeries = (key) =>
    months.reduce(
      (acc, m) => {
        const part = m[key];
        if (!part) return acc;
        acc.weight += part.weight || 0;
        acc.amount += part.amount || 0;
        return acc;
      },
      { weight: 0, amount: 0 }
    );

  return {
    currentYearLabel: currentYearLabel || '',
    previousYearLabel: previousYearLabel || '',
    hasPrevious: Boolean(hasPrevious),
    months,
    totals: {
      current: sumSeries('current'),
      previous: hasPrevious ? sumSeries('previous') : null,
    },
  };
}

/** Month-wise sale weight & amount (current FY + previous FY; optional item_code filter). */
app.get('/api/sale-graph-monthly', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, comp_year, item_code, include_items } = req.query;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date (DD-MM-YYYY) are required' });
    }

    const itemCode = item_code != null ? String(item_code).trim() : '';
    const wantItems = String(include_items || '').trim() === '1' || String(include_items || '').toLowerCase() === 'true';

    const slots = buildMonthSlotsBetween(s_date, e_date);
    const prevCtx = await resolveSaleGraphPreviousYear(comp_code, comp_uid, slots);
    const { prevSlots, previousYearLabel, hasPrevious, prevUid, ps, pe } = prevCtx;

    const currentRows = await fetchSaleMonthlyAggregate(comp_code, comp_uid, s_date, e_date, itemCode);
    const currentMap = mapSaleMonthlyRows(currentRows);

    let previousMap = prevCtx.previousMap;
    if (hasPrevious && prevUid && ps && pe) {
      const prevRows = await fetchSaleMonthlyAggregate(comp_code, prevUid, ps, pe, itemCode);
      previousMap = mapSaleMonthlyRows(prevRows);
    }

    const summary = buildSaleGraphPayload({
      slots,
      prevSlots,
      currentMap,
      previousMap,
      currentYearLabel: String(comp_year || '').trim(),
      previousYearLabel,
      hasPrevious,
    });
    summary.view = itemCode ? 'item' : 'all';
    summary.itemCode = itemCode;
    if (itemCode) {
      const curItemRows = await fetchSaleMonthlyByItemRows(comp_code, comp_uid, s_date, e_date);
      const curByItem = mapSaleMonthlyByItem(curItemRows);
      const hit = curByItem.get(itemCode);
      if (hit) {
        summary.itemName = hit.itemName;
      }
    }

    if (!wantItems || itemCode) {
      return res.json(summary);
    }

    const curItemRows = await fetchSaleMonthlyByItemRows(comp_code, comp_uid, s_date, e_date);
    const curByItem = mapSaleMonthlyByItem(curItemRows);
    let prevByItem = new Map();
    if (hasPrevious && prevUid && ps && pe) {
      const prevItemRows = await fetchSaleMonthlyByItemRows(comp_code, prevUid, ps, pe);
      prevByItem = mapSaleMonthlyByItem(prevItemRows);
    }

    const itemList = [];
    for (const [code, entry] of curByItem.entries()) {
      const prevEntry = prevByItem.get(code);
      const series = buildItemMonthSeries(
        slots,
        prevSlots,
        entry.months,
        prevEntry?.months || new Map(),
        hasPrevious
      );
      itemList.push({
        itemCode: code,
        itemName: entry.itemName,
        totals: series.totals,
      });
    }
    itemList.sort(
      (a, b) => (b.totals?.current?.amount || 0) - (a.totals?.current?.amount || 0)
    );

    const topLimit = 12;
    const topItems = itemList.slice(0, topLimit).map((it) => {
      const curEntry = curByItem.get(it.itemCode);
      const prevEntry = prevByItem.get(it.itemCode);
      const chart = buildItemMonthSeries(
        slots,
        prevSlots,
        curEntry?.months || new Map(),
        prevEntry?.months || new Map(),
        hasPrevious
      );
      chart.currentYearLabel = summary.currentYearLabel;
      chart.previousYearLabel = summary.previousYearLabel;
      chart.hasPrevious = hasPrevious;
      chart.itemCode = it.itemCode;
      chart.itemName = it.itemName;
      return chart;
    });

    summary.items = itemList.map((it) => ({
      itemCode: it.itemCode,
      itemName: it.itemName,
      totals: it.totals,
    }));
    summary.topItems = topItems;
    res.json(summary);
  } catch (err) {
    console.error('❌ sale-graph-monthly error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// 3. Trial Balance (The Main Report)
// 3. Trial Balance (The Main Report with Totals)
app.get('/api/trial-balance', async (req, res) => {
  try {
    const { comp_code, e_date, schedule, comp_uid } = req.query;
    const schedVal = parseFloat(schedule) || 0;

    // We use ROLLUP on (schedule, code) to get subtotals
    // We use CASE to give names to the 'null' rows generated by ROLLUP
    let sql = `SELECT 
                 b.schedule, 
                 MAX(c.name) as sch_name, 
                 a.code, 
                 CASE 
                   WHEN a.code IS NULL AND b.schedule IS NOT NULL THEN 'TOTAL ' || NVL(MAX(c.name), 'SCHEDULE') || ' ' || TO_CHAR(b.schedule)
                   WHEN a.code IS NULL AND b.schedule IS NULL THEN '*** GRAND TOTAL ***'
                   ELSE MAX(b.name) 
                 END AS name,
                 MAX(b.city) as city, 
                 SUM(NVL(a.dr_amt,0)) dr_amt, 
                 SUM(NVL(a.cr_amt,0)) cr_amt,
                 CASE WHEN SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0)) > 0 THEN SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0)) ELSE 0 END AS closing_dr,
                 CASE WHEN SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0)) < 0 THEN ABS(SUM(NVL(a.dr_amt,0) - NVL(a.cr_amt,0))) ELSE 0 END AS closing_cr
               FROM ledger a, master b, schedule c 
               WHERE a.comp_code = :comp_code 
               AND a.vr_date <= TO_DATE(:e_date, 'DD-MM-YYYY')
               AND a.comp_code = b.comp_code AND a.code = b.code
               AND b.comp_code = c.comp_code AND b.schedule = c.no`;

    const bindParams = { comp_code, e_date };
    if (schedVal !== 0) {
      sql += ` AND b.schedule = :schedule`;
      bindParams.schedule = schedVal;
    }

    // ROLLUP creates the sub-aggregates automatically
    sql += ` GROUP BY ROLLUP(b.schedule, a.code) 
             ORDER BY b.schedule NULLS LAST, a.code NULLS LAST`;

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error("❌ Trial Balance SQL Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Ledger Account Report
app.get('/api/ledger', async (req, res) => {
  try {
    const { comp_code, code, s_date, e_date, comp_uid, voucher_wise_total } = req.query;
    const voucherWiseTotal = String(voucher_wise_total || 'N').trim().toUpperCase() === 'Y';

    const txnSelect = voucherWiseTotal
      ? `
        SELECT
               A.CODE,
               MAX(B.NAME) AS NAME,
               MAX(B.CITY) AS CITY,
               MAX(B.GST_NO) AS GST_NO,
               MAX(B.PAN) AS PAN,
               MAX(B.ADD1) AS ADD1,
               MAX(B.ADD2) AS ADD2,
               MAX(B.TEL_NO_O) AS TEL_NO_O,
               A.VR_DATE,
               A.V_DATE,
               A.VR_NO,
               A.VR_TYPE,
               A.TYPE,
               0 AS TRN_NO,
               A.DETAIL,
               SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
               SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
               NULL AS DC_CODE,
               NULL AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
        GROUP BY A.CODE, A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.CHQ_NO, A.DETAIL, A.V_DATE
      `
      : `
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT, A.DC_CODE, NULL AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
      `;

    const sql = `
      WITH OP AS (
        SELECT SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OP_BAL
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      ),
      DATA AS (
        SELECT :code AS CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               TO_DATE(:s_date,'DD-MM-YYYY') AS VR_DATE,
               CAST(NULL AS DATE) AS V_DATE,
               0 AS VR_NO, 'OP' AS VR_TYPE, NULL AS TYPE, 0 AS TRN_NO, 'OPENING BALANCE' AS DETAIL,
               CASE WHEN OP.OP_BAL > 0 THEN OP.OP_BAL ELSE 0 END AS DR_AMT,
               CASE WHEN OP.OP_BAL < 0 THEN ABS(OP.OP_BAL) ELSE 0 END AS CR_AMT,
               NULL AS DC_CODE, NULL AS DC_NAME
        FROM OP
        LEFT JOIN MASTER B ON B.COMP_CODE = :comp_code AND B.CODE = :code
        UNION ALL
        ${txnSelect}
      )
      SELECT DATA.*,
             SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OVER (
               ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS RUN_BAL
      FROM DATA
      ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO`;

    const bindParams = { 
      comp_code: comp_code, 
      code: code, 
      s_date: s_date, 
      e_date: e_date 
    };

    // Use our helper to switch to the correct year schema (comp_uid)
    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error("❌ Ledger Query Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/** MASTER.CODE / LEDGER.CODE — VARCHAR2 (e.g. 1, C00001, Z99999). */
function normalizeLedgerAccountCode(raw) {
  if (raw == null) return undefined;
  const s = String(raw).trim().toUpperCase();
  if (!s) return undefined;
  return s.slice(0, 6);
}

async function fetchLedgerAccountRows(comp_code, comp_uid, code, s_date, e_date, voucher_wise_total) {
  const codeKey = normalizeLedgerAccountCode(code);
  if (!codeKey) {
    const err = new Error('Invalid account code');
    err.statusCode = 400;
    throw err;
  }
  const voucherWiseTotal = String(voucher_wise_total || 'N').trim().toUpperCase() === 'Y';

  const txnSelect = voucherWiseTotal
    ? `
        SELECT
               A.CODE,
               MAX(B.NAME) AS NAME,
               MAX(B.CITY) AS CITY,
               MAX(B.GST_NO) AS GST_NO,
               MAX(B.PAN) AS PAN,
               MAX(B.ADD1) AS ADD1,
               MAX(B.ADD2) AS ADD2,
               MAX(B.TEL_NO_O) AS TEL_NO_O,
               A.VR_DATE,
               A.V_DATE,
               A.VR_NO,
               A.VR_TYPE,
               A.TYPE,
               0 AS TRN_NO,
               A.DETAIL,
               SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
               SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
               NULL AS DC_CODE,
               NULL AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
        GROUP BY A.CODE, A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.CHQ_NO, A.DETAIL, A.V_DATE
      `
    : `
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT, A.DC_CODE, NULL AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
      `;

  const sql = `
      WITH OP AS (
        SELECT SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OP_BAL
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      ),
      DATA AS (
        SELECT :code AS CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               TO_DATE(:s_date,'DD-MM-YYYY') AS VR_DATE,
               CAST(NULL AS DATE) AS V_DATE,
               0 AS VR_NO, 'OP' AS VR_TYPE, NULL AS TYPE, 0 AS TRN_NO, 'OPENING BALANCE' AS DETAIL,
               CASE WHEN OP.OP_BAL > 0 THEN OP.OP_BAL ELSE 0 END AS DR_AMT,
               CASE WHEN OP.OP_BAL < 0 THEN ABS(OP.OP_BAL) ELSE 0 END AS CR_AMT,
               NULL AS DC_CODE, NULL AS DC_NAME
        FROM OP
        LEFT JOIN MASTER B ON B.COMP_CODE = :comp_code AND B.CODE = :code
        UNION ALL
        ${txnSelect}
      )
      SELECT DATA.*,
             SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OVER (
               ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS RUN_BAL
      FROM DATA
      ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO`;

  return runQuery(sql, { comp_code, code: codeKey, s_date, e_date }, comp_uid);
}

function ledgerRowsHavePeriodTransactions(rows) {
  return (rows || []).some((row) => {
    const vr = String(row.VR_TYPE ?? row.vr_type ?? '').trim().toUpperCase();
    if (vr === 'OP') return false;
    const dr = Number(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = Number(row.CR_AMT ?? row.cr_amt) || 0;
    return dr !== 0 || cr !== 0;
  });
}

/** Include opening balance (OP) or any period line with Dr/Cr. */
function ledgerRowsHaveReportableActivity(rows) {
  return (rows || []).some((row) => {
    const dr = Number(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = Number(row.CR_AMT ?? row.cr_amt) || 0;
    return dr !== 0 || cr !== 0;
  });
}

async function fetchCompleteLedgerMasterAccounts(comp_code, comp_uid, scheduleRaw, s_code, e_code, s_date, e_date) {
  const sCodeKey = normalizeLedgerAccountCode(s_code);
  const eCodeKey = normalizeLedgerAccountCode(e_code);
  if (!sCodeKey || !eCodeKey) {
    const err = new Error('s_code and e_code are required');
    err.statusCode = 400;
    throw err;
  }
  if (sCodeKey > eCodeKey) {
    const err = new Error('Starting code cannot be greater than ending code');
    err.statusCode = 400;
    throw err;
  }
  if (!s_date || !e_date) {
    const err = new Error('s_date and e_date are required');
    err.statusCode = 400;
    throw err;
  }
  let scheduleClause = '';
  const binds = { comp_code, s_code: sCodeKey, e_code: eCodeKey, s_date, e_date };
  if (scheduleRaw != null && String(scheduleRaw).trim() !== '') {
    const schedN = masterPartyScheduleBind(scheduleRaw);
    if (!schedN) {
      const err = new Error('schedule is invalid');
      err.statusCode = 400;
      throw err;
    }
    scheduleClause = ' AND ROUND(NVL(M.SCHEDULE, 0), 2) = :schedule';
    binds.schedule = schedN;
  }
  const sql = `
      SELECT M.CODE, M.NAME, M.CITY, M.GST_NO, M.PAN, M.ADD1, M.ADD2, M.TEL_NO_O
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code
        AND TRIM(M.CODE) BETWEEN :s_code AND :e_code
        ${scheduleClause}
        AND (
          EXISTS (
            SELECT 1
            FROM LEDGER L
            WHERE L.COMP_CODE = M.COMP_CODE
              AND L.CODE = M.CODE
              AND L.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
              AND (NVL(L.DR_AMT, 0) <> 0 OR NVL(L.CR_AMT, 0) <> 0)
          )
          OR NVL((
            SELECT SUM(NVL(L.DR_AMT, 0) - NVL(L.CR_AMT, 0))
            FROM LEDGER L
            WHERE L.COMP_CODE = M.COMP_CODE
              AND L.CODE = M.CODE
              AND L.VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
          ), 0) <> 0
        )
      ORDER BY TRIM(M.CODE)`;
  return runQuery(sql, binds, comp_uid);
}

async function mapCompleteLedgerAccountSection(comp_code, comp_uid, acc, s_date, e_date, voucher_wise_total) {
  const code = acc.CODE ?? acc.code;
  const rows = await fetchLedgerAccountRows(comp_code, comp_uid, code, s_date, e_date, voucher_wise_total);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!ledgerRowsHaveReportableActivity(rows)) return null;
  return {
    code,
    name: acc.NAME ?? acc.name ?? '',
    city: acc.CITY ?? acc.city ?? '',
    add1: acc.ADD1 ?? acc.add1 ?? '',
    add2: acc.ADD2 ?? acc.add2 ?? '',
    gst_no: acc.GST_NO ?? acc.gst_no ?? '',
    pan: acc.PAN ?? acc.pan ?? '',
    tel_no_o: acc.TEL_NO_O ?? acc.tel_no_o ?? '',
    rows,
  };
}

async function buildCompleteLedgerReport({
  comp_code,
  comp_uid,
  s_date,
  e_date,
  schedule,
  s_code,
  e_code,
  voucher_wise_total,
}) {
  const accounts = await fetchCompleteLedgerMasterAccounts(
    comp_code,
    comp_uid,
    schedule,
    s_code,
    e_code,
    s_date,
    e_date
  );
  const list = Array.isArray(accounts) ? accounts : [];
  const sections = [];
  const batchSize = 12;
  for (let i = 0; i < list.length; i += batchSize) {
    const chunk = list.slice(i, i + batchSize);
    const chunkSections = await Promise.all(
      chunk.map((acc) =>
        mapCompleteLedgerAccountSection(comp_code, comp_uid, acc, s_date, e_date, voucher_wise_total)
      )
    );
    for (const sec of chunkSections) {
      if (sec) sections.push(sec);
    }
  }
  sections.sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')));
  return {
    sections,
    account_count: sections.length,
    filters: {
      s_date,
      e_date,
      schedule: schedule != null ? String(schedule).trim() : '',
      s_code: normalizeLedgerAccountCode(s_code),
      e_code: normalizeLedgerAccountCode(e_code),
    },
  };
}

app.get('/api/complete-ledger-report', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, schedule, s_code, e_code, voucher_wise_total } = req.query;
    if (!comp_code || !s_date || !e_date || s_code == null || String(s_code).trim() === '' || e_code == null || String(e_code).trim() === '') {
      return res.status(400).json({ error: 'comp_code, s_date, e_date, s_code, and e_code are required' });
    }
    const payload = await buildCompleteLedgerReport({
      comp_code,
      comp_uid,
      s_date,
      e_date,
      schedule,
      s_code,
      e_code,
      voucher_wise_total,
    });
    res.json(payload);
  } catch (err) {
    console.error('❌ Complete Ledger Report Error:', err.message);
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// 4A. Ledger with Interest Report
app.get('/api/ledger-interest', async (req, res) => {
  try {
    const { comp_code, code, s_date, e_date, int_date, int_rate, grace_dr_days, grace_cr_days, comp_uid } = req.query;
    if (!comp_code || !code || !s_date || !e_date || !int_date) {
      return res.status(400).json({
        error: 'comp_code, code, s_date, e_date, and int_date are required',
      });
    }

    const rateNum = Number(int_rate);
    const graceDrNum = Number(grace_dr_days);
    const graceCrNum = Number(grace_cr_days);
    const safeRate = Number.isFinite(rateNum) ? rateNum : 0;
    const safeGraceDr = Number.isFinite(graceDrNum) ? graceDrNum : 0;
    const safeGraceCr = Number.isFinite(graceCrNum) ? graceCrNum : 0;

    const sql = `
      WITH OP AS (
        SELECT SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OP_BAL
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      ),
      DATA AS (
        SELECT :code AS CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               TO_DATE(:s_date,'DD-MM-YYYY') AS VR_DATE,
               CAST(NULL AS DATE) AS V_DATE,
               0 AS VR_NO, 'OP' AS VR_TYPE, NULL AS TYPE, 0 AS TRN_NO, 'OPENING BALANCE' AS DETAIL,
               CASE WHEN OP.OP_BAL > 0 THEN OP.OP_BAL ELSE 0 END AS DR_AMT,
               CASE WHEN OP.OP_BAL < 0 THEN ABS(OP.OP_BAL) ELSE 0 END AS CR_AMT,
               0 AS DR_DAYS, 0 AS CR_DAYS,
               0 AS DR_INTEREST, 0 AS CR_INTEREST,
               NULL AS DC_CODE, NULL AS DC_NAME
        FROM OP
        LEFT JOIN MASTER B ON B.COMP_CODE = :comp_code AND B.CODE = :code
        UNION ALL
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT,
               CASE
                 WHEN NVL(A.DR_AMT,0) > 0 THEN
                   GREATEST(
                     TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_dr_days),
                     0
                   )
                 ELSE 0
               END AS DR_DAYS,
               CASE
                 WHEN NVL(A.CR_AMT,0) > 0 THEN
                   GREATEST(
                     TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_cr_days),
                     0
                   )
                 ELSE 0
               END AS CR_DAYS,
               ROUND(
                 (
                   (NVL(A.DR_AMT,0) * :int_rate / 100) / 365
                 ) * GREATEST(
                   TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_dr_days),
                   0
                 ),
                 2
               ) AS DR_INTEREST,
               ROUND(
                 (
                   (NVL(A.CR_AMT,0) * :int_rate / 100) / 365
                 ) * GREATEST(
                   TRUNC(TO_DATE(:int_date,'DD-MM-YYYY')) - (TRUNC(NVL(A.V_DATE, A.VR_DATE)) + :grace_cr_days),
                   0
                 ),
                 2
               ) AS CR_INTEREST,
               A.DC_CODE, NULL AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
      )
      SELECT DATA.*,
             SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OVER (
               ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS RUN_BAL
      FROM DATA
      ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO`;

    const bindParams = {
      comp_code,
      code,
      s_date,
      e_date,
      int_date,
      int_rate: safeRate,
      grace_dr_days: safeGraceDr,
      grace_cr_days: safeGraceCr,
    };

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Ledger interest query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** All LEDGER lines for one voucher (comp_code + vr_date + vr_type + vr_no). */
app.get('/api/ledger-voucher', async (req, res) => {
  try {
    const { comp_code, vr_type, vr_date, vr_no, comp_uid } = req.query;
    if (!comp_code || !vr_type || !vr_date || vr_no == null || vr_no === '') {
      return res.status(400).json({ error: 'comp_code, vr_type, vr_date, and vr_no are required' });
    }
    const vrNoNum = Number(vr_no);
    if (!Number.isFinite(vrNoNum)) {
      return res.status(400).json({ error: 'vr_no must be a number' });
    }

    const sql = `
      SELECT
        A.VR_DATE,
        A.VR_NO,
        A.VR_TYPE,
        A.TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        A.DR_AMT,
        A.CR_AMT,
        A.DETAIL,
        A.DC_CODE,
        (
          SELECT MAX(M.NAME)
          FROM MASTER M
          WHERE M.COMP_CODE = A.COMP_CODE
            AND M.CODE = A.DC_CODE
        ) AS DC_NAME
      FROM LEDGER A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_TYPE = :vr_type
        AND A.VR_DATE = TO_DATE(:vr_date, 'DD-MM-YYYY')
        AND A.VR_NO = :vr_no
      ORDER BY A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO`;

    const bindParams = {
      comp_code,
      vr_type: String(vr_type),
      vr_date: String(vr_date),
      vr_no: vrNoNum,
    };

    const rows = await runQuery(sql, bindParams, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Ledger voucher query error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5 LEDGER HELP
// 5. Get Account Master List for Dropdown
app.get('/api/accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    
    // Your exact query optimized for the helper
    const sql = `
      SELECT MAX(A.NAME) AS NAME,
             MAX(A.CITY) AS CITY,
             A.CODE,
             MAX(A.ADD1) AS ADD1,
             MAX(A.ADD2) AS ADD2,
             MAX(A.GST_NO) AS GST_NO,
             MAX(A.PAN) AS PAN,
             MAX(A.TEL_NO_O) AS TEL_NO_O,
             SUM(NVL(B.DR_AMT,0) - NVL(B.CR_AMT,0)) AS CUR_BAL
      FROM MASTER A, LEDGER B
      WHERE A.COMP_CODE = :comp_code
      AND A.COMP_CODE = B.COMP_CODE (+)
      AND A.CODE = B.CODE (+)
      GROUP BY A.CODE
      ORDER BY MAX(A.NAME), MAX(A.CITY)`;

    const rows = await runQuery(sql, { comp_code: comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ageing', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      schedule,
      e_date,
      mlb,
      range1,
      range2,
      range3,
      range4,
      range5,
      range6,
      range7,
      range8,
      range9,
      range10,
    } = req.query;

    if (!comp_code || !comp_uid || !schedule || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, schedule, and e_date are required' });
    }

    const scheduleNum = Math.round(numVal(schedule) * 100) / 100;
    const mode = String(mlb || 'L').trim().toUpperCase() === 'B' ? 'B' : 'L';
    const ranges = makeAgeingRanges([
      { from: range1, to: range2 },
      { from: range3, to: range4 },
      { from: range5, to: range6 },
      { from: range7, to: range8 },
      { from: range9, to: range10 },
    ]);
    let rawRows = [];
    if (mode === 'L') {
      rawRows = await fetchAgeingLedgerRawRowsMerged({
        comp_code,
        comp_uid,
        e_date,
        scheduleNum,
        codeFilter: null,
      });
    } else {
      const sql = `
        SELECT
          A.CODE,
          B.NAME,
          B.CITY,
          A.BILL_DATE AS BILL_DATE,
          A.BILL_DATE AS VR_DATE,
          A.BILL_NO AS VR_NO,
          A.B_TYPE,
          SUM(NVL(A.DR_AMT,0)) DR_AMT,
          SUM(NVL(A.CR_AMT,0)) CR_AMT,
          SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) CUR_BAL
        FROM BILLS A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
          AND ROUND(NVL(B.SCHEDULE,0), 2) = :schedule
        GROUP BY A.CODE, B.NAME, B.CITY, A.BILL_DATE, A.BILL_NO, A.B_TYPE
        HAVING SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) > 0
        ORDER BY B.NAME, A.CODE, A.BILL_DATE, A.BILL_NO`;
      rawRows = await runQuery(sql, { comp_code, e_date, schedule: scheduleNum }, comp_uid);
    }

    const rows =
      mode === 'L'
        ? buildAgeingLedgerRows(rawRows, e_date, ranges, null, scheduleNum)
        : buildAgeingBillRows(rawRows, e_date, ranges);

    res.json(rows);
  } catch (err) {
    console.error('❌ Ageing report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Customers with bill-wise pending balance older than min_days (default 30). CODE is VARCHAR2 in GFASORCL. */
app.get('/api/overdue-customers', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, min_days, min_amount } = req.query;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (!e_date) {
      return res.status(400).json({ error: 'e_date (DD-MM-YYYY) is required' });
    }
    const minDays = Math.max(1, parseInt(String(min_days ?? '30').trim(), 10) || 30);
    const minAmount = Math.max(0, Number(String(min_amount ?? '0').trim().replace(/,/g, '')) || 0);

    const sql = `
      WITH bill_pending AS (
        SELECT
          TRIM(A.CODE) AS CODE,
          B.NAME,
          B.CITY,
          B.TEL_NO_O,
          A.BILL_DATE,
          A.BILL_NO,
          A.B_TYPE,
          SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS BAL
        FROM BILLS A
        INNER JOIN MASTER B
          ON A.COMP_CODE = B.COMP_CODE
         AND TRIM(A.CODE) = TRIM(B.CODE)
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
          AND ROUND(NVL(B.SCHEDULE, 0), 2) >= 8
          AND ROUND(NVL(B.SCHEDULE, 0), 2) < 9
        GROUP BY TRIM(A.CODE), B.NAME, B.CITY, B.TEL_NO_O, A.BILL_DATE, A.BILL_NO, A.B_TYPE
        HAVING SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) > 0.0001
      )
      SELECT
        CODE,
        NAME,
        CITY,
        TEL_NO_O,
        SUM(BAL) AS OVERDUE_BAL,
        COUNT(*) AS BILL_COUNT,
        MAX(TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) - TRUNC(BILL_DATE)) AS MAX_DAYS,
        MIN(BILL_DATE) AS OLDEST_BILL_DATE
      FROM bill_pending
      WHERE TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY')) - TRUNC(BILL_DATE) > :min_days
      GROUP BY CODE, NAME, CITY, TEL_NO_O
      HAVING SUM(BAL) > :min_amount
      ORDER BY UPPER(TRIM(NAME)), UPPER(TRIM(CODE))`;

    const rows = await runQuery(
      sql,
      { comp_code, e_date, min_days: minDays, min_amount: minAmount },
      comp_uid
    );
    res.json({
      rows: rows || [],
      e_date,
      min_days: minDays,
      min_amount: minAmount,
    });
  } catch (err) {
    console.error('❌ overdue-customers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ageing-bills-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, schedule, e_date } = req.query;
    if (!comp_code || !comp_uid || !code || !schedule || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, code, schedule, and e_date are required' });
    }

    const scheduleNum = Math.round(numVal(schedule) * 100) / 100;
    const sql = `
      SELECT
        A.CODE,
        B.NAME,
        B.CITY,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        SUM(NVL(A.DR_AMT,0)) DR_AMT,
        SUM(NVL(A.CR_AMT,0)) CR_AMT,
        SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) CUR_BAL
      FROM BILLS A, MASTER B
      WHERE A.COMP_CODE = :comp_code
        AND A.CODE = :code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND A.COMP_CODE = B.COMP_CODE
        AND A.CODE = B.CODE
        AND ROUND(NVL(B.SCHEDULE,0), 2) = :schedule
      GROUP BY A.CODE, B.NAME, B.CITY, A.BILL_DATE, A.BILL_NO, A.B_TYPE
      HAVING SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) > 0
      ORDER BY A.BILL_DATE, A.BILL_NO`;
    const rows = await runQuery(sql, { comp_code, code, e_date, schedule: scheduleNum }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Ageing bills detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ageing-ledger-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, schedule, e_date } = req.query;
    if (!comp_code || !comp_uid || !code || !schedule || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, code, schedule, and e_date are required' });
    }

    const scheduleNum = Math.round(numVal(schedule) * 100) / 100;
    const rawRows = await fetchAgeingLedgerRawRowsMerged({
      comp_code,
      comp_uid,
      e_date,
      scheduleNum,
      codeFilter: code,
    });
    const detailRows = buildAgeingLedgerDetailRows(rawRows, null);
    const netDrMinusCr = netDrMinusCrFromLedgerLines(rawRows);
    const rows = shouldShowAgeingLedgerSummaryRow(scheduleNum, netDrMinusCr) ? detailRows : [];
    res.json(rows);
  } catch (err) {
    console.error('❌ Ageing ledger detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Customer / supplier parties for bill-wise ledger (schedules per legacy SQL*Plus) */
app.get('/api/bill-ledger-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const ledgerKind = String(req.query.ledger_kind || 'customer').trim().toLowerCase() === 'supplier' ? 'supplier' : 'customer';
    const scheduleFilter =
      ledgerKind === 'supplier'
        ? '(SCHEDULE = 11.10 OR ROUND(SCHEDULE, 2) = 11.1)'
        : '(SCHEDULE >= 8 AND SCHEDULE < 9)';
    const balExpr = ledgerKind === 'supplier' ? 'NVL(L.CR_AMT,0)-NVL(L.DR_AMT,0)' : 'NVL(L.DR_AMT,0)-NVL(L.CR_AMT,0)';
    const sql = `
      SELECT
        M.NAME,
        M.CITY,
        M.CODE,
        M.TEL_NO_O,
        NVL(SUM(${balExpr}), 0) AS CUR_BAL
      FROM MASTER M
      LEFT JOIN LEDGER L
        ON M.COMP_CODE = L.COMP_CODE
       AND M.CODE = L.CODE
      WHERE M.COMP_CODE = :comp_code
        AND ${scheduleFilter.replace(/SCHEDULE/g, 'M.SCHEDULE')}
      GROUP BY M.NAME, M.CITY, M.CODE, M.TEL_NO_O
      ORDER BY M.NAME, M.CITY, M.CODE`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Bill ledger parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Bill-ledger interest defaults from DEFVALUE table: g_days, g_edays */
app.get('/api/bill-ledger-defaults', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code) {
      return res.status(400).json({ error: 'comp_code is required' });
    }
    const binds = { comp_code };
    const sqlCandidates = [
      `SELECT G_DAYS, G_EDAYS FROM DEFVALUE WHERE COMP_CODE = :comp_code`,
      `SELECT G_DAYS, G_EDAYS FROM DEFAULT WHERE COMP_CODE = :comp_code`,
      `SELECT G_DAYS, G_EDAYS FROM "DEFAULT" WHERE COMP_CODE = :comp_code`,
    ];
    let rows = [];
    let lastErr = null;
    for (const sql of sqlCandidates) {
      try {
        rows = await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    const pick = (up, low) => row?.[up] ?? row?.[low] ?? null;
    res.json({
      g_days: pick('G_DAYS', 'g_days'),
      g_edays: pick('G_EDAYS', 'g_edays'),
    });
  } catch (err) {
    console.error('❌ bill-ledger-defaults error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GETINT return format: LPAD(days,5,'0') || 'I' || TO_CHAR(amount) — legacy Oracle function (orafun). */
function parseOraGetintReturn(raw) {
  if (raw == null) return { interestDays: null, interestAmt: null };
  const s = String(raw).trim();
  if (!s) return { interestDays: null, interestAmt: null };
  const i = s.indexOf('I');
  if (i < 1) return { interestDays: null, interestAmt: null };
  const dayStr = s.slice(0, i).trim();
  const amtStr = s.slice(i + 1).trim().replace(/,/g, '');
  const interestDays = parseInt(dayStr, 10);
  const interestAmt = parseFloat(amtStr);
  return {
    interestDays: Number.isFinite(interestDays) ? interestDays : null,
    interestAmt: Number.isFinite(interestAmt) ? interestAmt : null,
  };
}

/**
 * Bill-wise ledger from BILLS; optional interest from GETINT (customer) or GETINT_SUP (supplier).
 * Query:
 * - ledger_kind=customer|supplier (default customer)
 * - include_interest=Y, int_indt (DD-MM-YYYY), gs_days, ged_days, group_cd, bombay_dhara
 */
app.get('/api/bill-ledger', async (req, res) => {
  try {
    const { comp_code, code, s_date, e_date, p_edt, mco, comp_uid } = req.query;
    const mode = String(mco || 'A').toUpperCase() === 'O' ? 'O' : 'A';
    const ledgerKind = String(req.query.ledger_kind || 'customer').trim().toLowerCase() === 'supplier' ? 'supplier' : 'customer';
    const balanceExpr = ledgerKind === 'supplier' ? 'lines.CR_AMT - lines.DR_AMT' : 'lines.DR_AMT - lines.CR_AMT';
    const outstandingExpr = ledgerKind === 'supplier' ? 'NVL(CR_AMT,0) - NVL(DR_AMT,0)' : 'NVL(DR_AMT,0) - NVL(CR_AMT,0)';
    const wantInt = String(req.query.include_interest ?? '')
      .trim()
      .toUpperCase()
      .startsWith('Y');
    const intIndt = wantInt ? String(req.query.int_indt ?? '').trim() : '';
    if (wantInt && !intIndt) {
      return res.status(400).json({
        error:
          'When include_interest=Y, int_indt is required (interest as-of date, DD-MM-YYYY, same format as other bill-ledger dates).',
      });
    }

    const linesCte = `
      WITH lines AS (
        SELECT
          A.CODE,
          B.NAME,
          A.BILL_NO,
          A.BILL_DATE,
          A.B_TYPE,
          A.VR_DATE,
          A.V_DATE,
          A.VR_NO,
          A.VR_TYPE,
          NVL(A.DR_AMT,0) DR_AMT,
          NVL(A.CR_AMT,0) CR_AMT
        FROM BILLS A, MASTER B
        WHERE A.COMP_CODE = B.COMP_CODE
          AND TRIM(A.CODE) = TRIM(B.CODE)
          AND A.COMP_CODE = :comp_code
          AND TRIM(A.CODE) = TRIM(:code)
          AND (
            A.BILL_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
            OR (
              NVL(A.DR_AMT,0) > 0
              AND TRIM(A.VR_TYPE) IN (
                'S','W','SL','SW','SI','SR',
                'DN','DR','DI',
                'PU','PI','PR'
              )
              AND A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
            )
          )
          AND (
            (B.SCHEDULE >= 8 AND B.SCHEDULE < 9 AND
              (
                (TRIM(A.VR_TYPE) IN (
                  'S','W','SL','SW','SI','SR',
                  'DN','DR','DI',
                  'PU','PI','PR'
                ) AND (
                  A.BILL_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
                  OR A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
                ))
                OR
                (TRIM(A.VR_TYPE) IN ('CV','BV','JV') AND A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY'))
              )
            )
            OR
            ((B.SCHEDULE = 11.10 OR ROUND(B.SCHEDULE, 2) = 11.1) AND
              (
                (TRIM(A.VR_TYPE) IN ('PU','DN','PI','PR') AND (
                  A.BILL_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
                  OR A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
                ))
                OR
                (TRIM(A.VR_TYPE) IN ('CV','BV','JV') AND A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY'))
              )
            )
          )
      ),
      filtered AS (
        SELECT
          lines.CODE,
          lines.NAME,
          lines.BILL_NO,
          lines.BILL_DATE,
          lines.B_TYPE,
          lines.VR_DATE,
          lines.V_DATE,
          lines.VR_NO,
          lines.VR_TYPE,
          lines.DR_AMT,
          lines.CR_AMT,
          SUM(${balanceExpr}) OVER (
            PARTITION BY lines.CODE, lines.BILL_NO
            ORDER BY lines.VR_DATE, lines.VR_NO
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) CL_BALANCE
        FROM lines
        WHERE (
          :mco = 'A'
          OR
          (:mco = 'O' AND lines.BILL_NO IN (
            SELECT BILL_NO
            FROM BILLS
            WHERE COMP_CODE = :comp_code2
              AND CODE = :code2
            GROUP BY BILL_NO
            HAVING SUM(${outstandingExpr}) <> 0
          ))
        )
      )`;

    const orderBy = `
      ORDER BY NVL(filtered.BILL_DATE, TRUNC(filtered.VR_DATE)), filtered.BILL_NO, filtered.VR_DATE, filtered.VR_NO`;

    let sql;
    const binds = {
      comp_code,
      code,
      s_date,
      e_date,
      p_edt,
      mco: mode,
      comp_code2: comp_code,
      code2: code,
    };

    if (wantInt) {
      const gs = req.query.gs_days != null && String(req.query.gs_days).trim() !== '' ? String(req.query.gs_days).trim() : '0';
      const ged = req.query.ged_days != null && String(req.query.ged_days).trim() !== '' ? String(req.query.ged_days).trim() : '30';
      const grp = req.query.group_cd != null && String(req.query.group_cd).trim() !== '' ? String(req.query.group_cd).trim() : '0';
      const bomb = req.query.bombay_dhara != null && String(req.query.bombay_dhara).trim() !== '' ? String(req.query.bombay_dhara).trim() : '0';
      binds.int_indt = intIndt;
      binds.gs_days = gs;
      binds.ged_days = ged;
      binds.group_cd = grp;
      binds.bombay_dhara = bomb;
      binds.comp_code_gi = String(comp_code).trim();
      const interestFn = ledgerKind === 'supplier' ? 'GETINT_SUP' : 'GETINT';
      const interestFnSql =
        ledgerKind === 'supplier'
          ? `${interestFn}(
            TO_NUMBER(TRIM(:comp_code_gi)),
            TRIM(bk.CODE),
            bk.BILL_DATE,
            bk.BILL_NO,
            TRIM(bk.B_TYPE),
            TO_DATE(:int_indt, 'DD-MM-YYYY'),
            TO_NUMBER(:gs_days),
            TO_NUMBER(:ged_days),
            TO_NUMBER(:group_cd),
            TO_NUMBER(:bombay_dhara),
            TO_DATE(:e_date, 'DD-MM-YYYY')
          )`
          : `${interestFn}(
            TO_NUMBER(TRIM(:comp_code_gi)),
            TRIM(bk.CODE),
            bk.BILL_DATE,
            bk.BILL_NO,
            TRIM(bk.B_TYPE),
            TO_DATE(:int_indt, 'DD-MM-YYYY'),
            TO_NUMBER(:gs_days),
            TO_NUMBER(:ged_days),
            TO_NUMBER(:group_cd),
            TO_NUMBER(:bombay_dhara),
            TO_DATE(:e_date, 'DD-MM-YYYY'),
            TO_DATE(:p_edt, 'DD-MM-YYYY')
          )`;

      sql =
        linesCte +
        `,
      bill_keys AS (
        SELECT DISTINCT
          filtered.CODE,
          filtered.BILL_DATE,
          filtered.BILL_NO,
          filtered.B_TYPE
        FROM filtered
      ),
      bill_int AS (
        SELECT
          bk.CODE,
          bk.BILL_DATE,
          bk.BILL_NO,
          bk.B_TYPE,
          ${interestFnSql} AS GETINT_RAW
        FROM bill_keys bk
      )
      SELECT
        filtered.CODE,
        filtered.NAME,
        filtered.BILL_NO,
        filtered.BILL_DATE,
        filtered.B_TYPE,
        filtered.VR_DATE,
        filtered.V_DATE,
        filtered.VR_NO,
        filtered.VR_TYPE,
        filtered.DR_AMT,
        filtered.CR_AMT,
        filtered.CL_BALANCE,
        bi.GETINT_RAW
      FROM filtered
      LEFT JOIN bill_int bi ON
        TRIM(filtered.CODE) = TRIM(bi.CODE)
        AND NVL(TRUNC(filtered.BILL_DATE), DATE '1899-12-30') = NVL(TRUNC(bi.BILL_DATE), DATE '1899-12-30')
        AND NVL(TO_CHAR(filtered.BILL_NO), ' ') = NVL(TO_CHAR(bi.BILL_NO), ' ')
        AND NVL(TRIM(filtered.B_TYPE), ' ') = NVL(TRIM(bi.B_TYPE), ' ')` + orderBy;
    } else {
      sql =
        linesCte +
        `
      SELECT
        filtered.CODE,
        filtered.NAME,
        filtered.BILL_NO,
        filtered.BILL_DATE,
        filtered.B_TYPE,
        filtered.VR_DATE,
        filtered.V_DATE,
        filtered.VR_NO,
        filtered.VR_TYPE,
        filtered.DR_AMT,
        filtered.CR_AMT,
        filtered.CL_BALANCE
      FROM filtered` +
        orderBy;
    }

    let rows = await runQuery(sql, binds, comp_uid);
    rows = rows || [];
    if (wantInt) {
      rows = rows.map((r) => {
        const raw = r.GETINT_RAW ?? r.getint_raw;
        const { interestDays, interestAmt } = parseOraGetintReturn(raw);
        const out = { ...r };
        delete out.GETINT_RAW;
        delete out.getint_raw;
        out.INTEREST_DAYS = interestDays;
        out.INTEREST_AMT = interestAmt;
        return out;
      });
    }
    rows = rows.map((r) => ({ ...r, LEDGER_KIND: ledgerKind }));
    res.json(rows);
  } catch (err) {
    console.error('❌ Bill ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Brokers (MASTER codes starting with B) for broker-wise outstanding */
app.get('/api/broker-os-brokers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND SUBSTR(TRIM(CODE), 1, 1) = 'B'
      ORDER BY CODE`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Broker list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Customers / suppliers (C or S prefix) for optional party filter on broker OS */
app.get('/api/broker-os-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CITY, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND (SUBSTR(TRIM(CODE), 1, 1) = 'C' OR SUBSTR(TRIM(CODE), 1, 1) = 'S')
      ORDER BY NAME, CITY, CODE`;
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Broker OS parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Broker-wise outstanding (BILLS + MASTER).
 * Bills included only if they have a line with BK_CODE in range and VR_TYPE in SL, SE, PU.
 * Credits after payment end date are treated as zero in CR_AMT / balances (per legacy).
 */
app.get('/api/broker-outstanding', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      p_edt,
      brok_start,
      brok_end,
      party_code,
      mco,
    } = req.query;

    const mode = String(mco || 'A').toUpperCase() === 'O' ? 'O' : 'A';
    const b1 = String(brok_start ?? 'B00001').trim();
    const b2 = String(brok_end ?? 'B99999').trim();
    const party = party_code != null ? String(party_code).trim() : '';
    const partyFilter = party ? 'AND A.CODE = :party_code' : '';

    const sql = `
      SELECT
        x.*,
        (
          SELECT MAX(BM.NAME)
          FROM MASTER BM
          WHERE BM.COMP_CODE = x.COMP_CODE
            AND TRIM(BM.CODE) = TRIM(x.BK_CODE)
        ) AS BK_NAME
      FROM (
        SELECT
          A.COMP_CODE,
          MAX(TRIM(A.BK_CODE)) OVER (
            PARTITION BY A.COMP_CODE, A.CODE, A.BILL_NO, TRUNC(A.BILL_DATE)
          ) AS BK_CODE,
          A.CODE,
          B.NAME,
          A.BILL_NO,
          A.BILL_DATE,
          A.VR_TYPE,
          A.VR_DATE,
          A.VR_NO,
          NVL(A.DETAIL, '') AS DETAIL,
          NVL(A.DR_AMT,0) AS DR_AMT,
          CASE
            WHEN A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0)
            ELSE 0
          END AS CR_AMT,
          CASE WHEN NVL(A.DR_AMT,0) > 0 THEN 1 ELSE 2 END AS DR_CR_FLAG,
          SUM(
            NVL(A.DR_AMT,0) -
            CASE
              WHEN A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0)
              ELSE 0
            END
          ) OVER (
            PARTITION BY A.COMP_CODE, A.CODE, A.BILL_NO, TRUNC(A.BILL_DATE)
            ORDER BY A.VR_DATE,
                     CASE WHEN NVL(A.DR_AMT,0) > 0 THEN 1 ELSE 2 END,
                     A.VR_NO
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS RUN_BAL,
          SUM(
            NVL(A.DR_AMT,0) -
            CASE
              WHEN A.VR_DATE <= TO_DATE(:p_edt,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0)
              ELSE 0
            END
          ) OVER (
            PARTITION BY A.COMP_CODE, A.CODE, A.BILL_NO, TRUNC(A.BILL_DATE)
          ) AS FINAL_BAL
        FROM BILLS A
        JOIN MASTER B
          ON A.COMP_CODE = B.COMP_CODE
         AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          ${partyFilter}
          AND EXISTS (
            SELECT 1
            FROM BILLS seed
            WHERE seed.COMP_CODE = A.COMP_CODE
              AND seed.CODE = A.CODE
              AND seed.BILL_NO = A.BILL_NO
              AND TRUNC(seed.BILL_DATE) = TRUNC(A.BILL_DATE)
              AND TRIM(seed.BK_CODE) BETWEEN :brok_start AND :brok_end
              AND TRIM(seed.VR_TYPE) IN ('SL','SE','PU')
          )
          AND A.BILL_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
      ) x
      WHERE :mco = 'A' OR (:mco = 'O' AND NVL(x.FINAL_BAL,0) <> 0)
      ORDER BY x.BK_CODE, x.NAME, x.CODE, x.BILL_DATE, x.VR_DATE, x.DR_CR_FLAG, x.VR_NO`;

    const binds = {
      comp_code,
      s_date,
      e_date,
      p_edt,
      brok_start: b1,
      brok_end: b2,
      mco: mode,
    };
    if (party) binds.party_code = party;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Broker outstanding error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** SALE line in period — this schema uses BILL_DATE only (no VR_DATE on SALE). */
const SALE_LIST_DATE_FILTER_SQL = `
          AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))`;

/** Sale list — parties; date range: same pattern as SQL*Plus (SALE A, MASTER B, BILL_DATE, join on CODE). */
app.get('/api/salelist-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CITY, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
      ORDER BY NAME, CITY, CODE`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sale list — brokers (MASTER.CODE starts with B); same SALE+MASTER pattern on BK_CODE = B.CODE. */
app.get('/api/salelist-brokers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT NAME, CITY, CODE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND SUBSTR(TRIM(CODE), 1, 1) = 'B'
      ORDER BY NAME, CITY, CODE`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list brokers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Sale list — items; same pattern: SALE A, ITEMMAST B, BILL_DATE range, join on ITEM_CODE. */
app.get('/api/salelist-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const sql = `
      SELECT ITEM_NAME, ITEM_CODE
      FROM ITEMMAST
      WHERE COMP_CODE = :comp_code
      ORDER BY ITEM_NAME`;
    const binds = { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sale list lines (TYPE in SL, SE, CN).
 * Optional: mcode (party), bk_code, item_code
 */
app.get('/api/sale-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, mcode, bk_code, item_code } = req.query;
    const m = mcode != null ? String(mcode).trim() : '';
    const b = bk_code != null ? String(bk_code).trim() : '';
    const it = parseItemCodeForSql(item_code);

    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.BK_CODE,
        C.NAME AS BK_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        D.ITEM_NAME,
        A.LOT,
        A.STATUS,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.BILL_AMT,
        A.DIS_AMT,
        A.OTH_EXP5
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.BK_CODE) = TRIM(C.CODE)
      LEFT JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(A.TYPE)) IN ('SL', 'SE', 'CN')
        ${SALE_LIST_DATE_FILTER_SQL}
        ${m ? 'AND TRIM(A.CODE) = TRIM(:mcode)' : ''}
        ${b ? 'AND TRIM(A.BK_CODE) = TRIM(:bk_code)' : ''}
        ${it !== undefined ? 'AND A.ITEM_CODE = :item_code' : ''}
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;

    const binds = { comp_code, s_date, e_date };
    if (m) binds.mcode = m;
    if (b) binds.bk_code = b;
    if (it !== undefined) binds.item_code = it;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sale Bill Printing list (header-level rows) for one TYPE: SL / SE / CN.
 * Optional filters: bill_no_from / bill_no_to, bill_date_from / bill_date_to (DD-MM-YYYY),
 * legacy bill_no / bill_date (single), b_type, mcode (party code).
 */
app.get('/api/sale-bill-printing-list', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      type,
      bill_no,
      bill_no_from,
      bill_no_to,
      b_type,
      bill_date,
      bill_date_from,
      bill_date_to,
      mcode,
    } = req.query;
    const t = String(type ?? '').trim().toUpperCase();
    if (!['SL', 'SE', 'CN'].includes(t)) {
      return res.status(400).json({ error: "type is required and must be one of 'SL', 'SE', 'CN'." });
    }
    const bt = b_type != null ? String(b_type).trim() : '';
    const m = mcode != null ? String(mcode).trim() : '';

    let bdf = bill_date_from != null ? String(bill_date_from).trim() : '';
    let bdt = bill_date_to != null ? String(bill_date_to).trim() : '';
    const bdLegacy = bill_date != null ? String(bill_date).trim() : '';
    if (!bdf && !bdt && bdLegacy) {
      bdf = bdLegacy;
      bdt = bdLegacy;
    }
    if (bdf && !bdt) bdt = bdf;
    if (bdt && !bdf) bdf = bdt;

    const oracleDmyKey = (dmy) => {
      const p = String(dmy).split('-');
      if (p.length !== 3) return 0;
      const [dd, mm, yy] = p.map((x) => parseInt(x, 10));
      if (!yy || !mm || !dd) return 0;
      return yy * 10000 + mm * 100 + dd;
    };
    if (bdf && bdt && oracleDmyKey(bdf) > oracleDmyKey(bdt)) {
      const x = bdf;
      bdf = bdt;
      bdt = x;
    }

    let nobf = bill_no_from != null ? String(bill_no_from).trim() : '';
    let nobt = bill_no_to != null ? String(bill_no_to).trim() : '';
    const bnLegacy = bill_no != null ? String(bill_no).trim() : '';
    if (!nobf && !nobt && bnLegacy) {
      nobf = bnLegacy;
      nobt = bnLegacy;
    }
    if (nobf && !nobt) nobt = nobf;
    if (nobt && !nobf) nobf = nobt;

    const billNosNumeric = (a, b) => {
      const ta = String(a).trim();
      const tb = String(b).trim();
      if (!/^-?\d+$/.test(ta) || !/^-?\d+$/.test(tb)) return null;
      const na = Number(ta);
      const nb = Number(tb);
      if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
      return na <= nb ? { lo: na, hi: nb } : { lo: nb, hi: na };
    };

    let billNoSql = '';
    const nums = nobf && nobt ? billNosNumeric(nobf, nobt) : null;
    if (nums) {
      billNoSql = 'AND A.BILL_NO BETWEEN :bill_no_lo AND :bill_no_hi';
    } else if (nobf && nobt) {
      billNoSql = 'AND TRIM(TO_CHAR(A.BILL_NO)) BETWEEN TRIM(:bill_no_from) AND TRIM(:bill_no_to)';
      if (nobf > nobt) {
        const z = nobf;
        nobf = nobt;
        nobt = z;
      }
    }

    const dateSql =
      bdf && bdt
        ? "AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:bill_date_from, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:bill_date_to, 'DD-MM-YYYY'))"
        : '';

    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        MAX(NVL(A.BILL_AMT, 0)) AS BILL_AMT,
        SUM(NVL(A.CGST_AMT, 0) + NVL(A.SGST_AMT, 0) + NVL(A.IGST_AMT, 0)) AS TOTAL_TAX
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(A.TYPE)) = :type
        ${billNoSql}
        ${bt ? 'AND NVL(TRIM(A.B_TYPE), \' \') = NVL(TRIM(:b_type), \' \')' : ''}
        ${dateSql}
        ${m ? 'AND TRIM(A.CODE) = TRIM(:mcode)' : ''}
      GROUP BY
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY
      ORDER BY TRUNC(A.BILL_DATE) ASC, A.BILL_NO ASC, A.B_TYPE, A.CODE`;

    const binds = { comp_code, type: t };
    if (nums) {
      binds.bill_no_lo = nums.lo;
      binds.bill_no_hi = nums.hi;
    } else if (nobf && nobt) {
      binds.bill_no_from = nobf;
      binds.bill_no_to = nobt;
    }
    if (bt) binds.b_type = bt;
    if (bdf && bdt) {
      binds.bill_date_from = bdf;
      binds.bill_date_to = bdt;
    }
    if (m) binds.mcode = m;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Sale bill printing list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** All SALE lines for one bill (open sale bill) */
app.get('/api/sale-bill', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, bill_no, bill_date } = req.query;
    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        B.PAN,
        B.GST_NO,
        A.BK_CODE,
        C.NAME AS BK_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        D.ITEM_NAME,
        A.LOT,
        A.STATUS,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.BILL_AMT
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.BK_CODE = C.CODE
      JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.ITEM_CODE = D.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.TYPE = :type
        AND A.BILL_NO = :bill_no
        AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))
      ORDER BY A.B_TYPE, A.TRN_NO`;

    const rows = await runQuery(
      sql,
      { comp_code, type: String(type).trim(), bill_no: String(bill_no).trim(), bill_date },
      comp_uid
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale bill error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Company header for sale bill print (compdet in hub schema: GRAIN or GRAINFAS — same as /api/years).
 *  Do not pass comp_uid as 3rd arg to runQuery here; year schema is comp_uid/comp_uid@XE only after year pick.
 *  Match comp_uid with TO_CHAR so string/number binds from the client both work. */
app.get('/api/compdet-print-header', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const one = await runCompdetHeaderRow(comp_code, comp_uid);
    if (one) {
      await drainOracleLobsInRows([one]);
      normalizeRowBuffers(one);
      await hydrateImageFieldInRows([one], 'sale_logo');
      await hydrateImageFieldInRows([one], 'sale_logo2');
      await hydrateImageFieldInRows([one], 'signature_file');
    }
    res.json(one);
  } catch (err) {
    console.error('❌ compdet print header error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Text-only company lines for ledger screen/PDF (no logos; avoids heavy print-header payload). */
app.get('/api/compdet-ledger-header', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const row = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!row) {
      return res.json({});
    }
    stripSalePrintImageFields(row);
    const textVal = (logical) => {
      const v = rowValueCI(row, logical);
      if (v == null || v === '') return '';
      if (typeof v === 'object') return '';
      return String(v).trim();
    };
    const gst = textVal('gst_no') || textVal('comp_gst') || textVal('gstin') || '';
    res.json({
      COMP_NAME: textVal('comp_name'),
      COMP_ADD1: textVal('comp_add1'),
      COMP_ADD2: textVal('comp_add2'),
      GST_NO: gst,
    });
  } catch (err) {
    console.error('❌ compdet ledger header error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Full sale bill lines for tax invoice / bill of supply print */
app.get('/api/sale-bill-print', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, bill_no, b_type, bill_date } = req.query;
    const bt = b_type != null ? String(b_type).trim() : '';
    const rows = await runSaleBillPrintRows(
      {
        comp_code,
        type: String(type).trim(),
        bill_no: String(bill_no).trim(),
        b_type: bt || ' ',
        bill_date,
      },
      comp_uid
    );
    const first = rows[0] ?? null;
    const rowBType = first ? rowValueCI(first, 'b_type') : null;
    const rowGodCode = first ? rowValueCI(first, 'god_code') : null;

    const saleCondQueries = [
      `SELECT cond1, cond2, cond3, cond4, cond5, cond6, cond7
       FROM sale_cond
       WHERE comp_code = :comp_code
         AND ROWNUM = 1`,
      `SELECT cond_1 AS cond1, cond_2 AS cond2, cond_3 AS cond3, cond_4 AS cond4, cond_5 AS cond5, cond_6 AS cond6, cond_7 AS cond7
       FROM sale_cond
       WHERE comp_code = :comp_code
         AND ROWNUM = 1`,
    ];
    const godownSql = `
      SELECT god_add1, god_add2, god_gst_no, god_tel_no_1, god_tel_no_2, god_fssai_no
      FROM godown
      WHERE comp_code = :comp_code
        AND NVL(TRIM(god_b_type), ' ') = NVL(TRIM(:b_type), ' ')
        AND NVL(TRIM(god_code), ' ') = NVL(TRIM(:god_code), ' ')
        AND ROWNUM = 1`;
    const defValueSql = `
      SELECT god_print_in_sale, sale_logo, sale_logo2, signature_file, g_weight AS print_g_weight, wgt_k_q, g_weight_header, d_weight_header, g_rate_header
      FROM defvalue
      WHERE comp_code = :comp_code
        AND ROWNUM = 1`;

    const saleCondPromise = (async () => {
      for (const q of saleCondQueries) {
        const row = await runOptionalSingleRow(q, { comp_code }, [comp_uid, null]);
        if (row) return row;
      }
      return null;
    })();

    const [saleCondRow, godownRow, defValueRow] = await Promise.all([
      saleCondPromise,
      rowBType != null && rowGodCode != null
        ? runOptionalSingleRow(
            godownSql,
            {
              comp_code,
              b_type: String(rowBType).trim() || ' ',
              god_code: String(rowGodCode).trim() || ' ',
            },
            [comp_uid, null]
          )
        : Promise.resolve(null),
      runOptionalSingleRow(defValueSql, { comp_code }, [comp_uid, null]),
    ]);

    const extra = {
      ...(saleCondRow || {}),
      ...(godownRow || {}),
      ...(defValueRow || {}),
    };
    if (Object.keys(extra).length > 0) {
      for (const r of rows) {
        stripSalePrintImageFields(r);
        Object.assign(r, extra);
      }
    } else {
      for (const r of rows) stripSalePrintImageFields(r);
    }

    await drainOracleLobsInRows(rows);
    for (const r of rows) {
      normalizeRowBuffers(r);
      normalizeSignedQrColumn(r);
    }
    await hydrateImageFieldInRows(rows, 'sale_logo');
    await hydrateImageFieldInRows(rows, 'sale_logo2');
    await hydrateImageFieldInRows(rows, 'signature_file');
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale bill print error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock summary by item (LOTSTOCK + ITEMMAST + MASTER) */
app.get('/api/stock-sum', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, god_code } = req.query;
    const gc = god_code != null ? String(god_code).trim() : '';
    const godAll = gc === '' ? 1 : 0;
    const sql = `
      SELECT
        A.ITEM_CODE,
        B.ITEM_NAME,
        MAX(C.SCHEDULE) AS SCHEDULE,
        NVL(B.CAT_CODE, '') AS CAT_CODE,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END) AS R_QNTY,
        SUM(CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END) AS S_QNTY,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS R_WEIGHT,
        SUM(CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS S_WEIGHT,
        SUM(CASE
              WHEN A.STATUS = 'B' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'B' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS BAGS,
        SUM(CASE
              WHEN A.STATUS = 'K' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'K' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS KATTA,
        SUM(CASE
              WHEN A.STATUS = 'H' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'H' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS HKATTA,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END) AS WEIGHT,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE NVL(A.G_WEIGHT, 0) * -1 END) AS G_WEIGHT
      FROM LOTSTOCK A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.SUP_CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
      GROUP BY A.ITEM_CODE, B.ITEM_NAME, B.CAT_CODE
      ORDER BY A.ITEM_CODE`;
    const binds = { comp_code, e_date, god_all: godAll, god_code: gc };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot movements for one item (running balance computed on client) */
app.get('/api/stock-sum-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, item_code, e_date, god_code } = req.query;
    const ic = String(item_code ?? '').trim();
    if (!ic) return res.status(400).json({ error: 'item_code is required' });
    const gc = god_code != null ? String(god_code).trim() : '';
    const godAll = gc === '' ? 1 : 0;
    const sql = `
      SELECT
        A.VR_DATE,
        A.VR_NO,
        A.VR_TYPE,
        A.TYPE,
        A.ITEM_CODE,
        A.LOT,
        A.STATUS,
        A.B_NO,
        A.GOD_CODE,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS R_QNTY,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS S_QNTY,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS R_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS S_WEIGHT,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS R_G_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS SG_WEIGHT
      FROM LOTSTOCK A
      WHERE A.COMP_CODE = :comp_code
        AND A.ITEM_CODE = :item_code
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
      ORDER BY A.VR_DATE, A.VR_NO`;
    const binds = {
      comp_code,
      item_code: ic,
      e_date,
      god_all: godAll,
      god_code: gc,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Stock sum detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot search helps */
app.get('/api/stocklot-godowns', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT GOD_CODE, GOD_NAME FROM GODOWN WHERE COMP_CODE = :comp_code ORDER BY GOD_CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot godowns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocklot-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT ITEM_NAME, ITEM_CODE FROM ITEMMAST WHERE COMP_CODE = :comp_code ORDER BY ITEM_NAME`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocklot-suppliers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot suppliers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stocklot-costs', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT COST_CODE, COST_NAME FROM COST WHERE COMP_CODE = :comp_code ORDER BY COST_CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot costs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot summary by item/lot/bikri no/supplier */
app.get('/api/stock-lot', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, god_code, item_code, sup_code, b_no, lot, cost_code, c_o } = req.query;
    const god = String(god_code ?? '').trim();
    const item = String(item_code ?? '').trim();
    const sup = String(sup_code ?? '').trim();
    const bikri = String(b_no ?? '').trim();
    const lotNo = String(lot ?? '').trim();
    const cost = String(cost_code ?? '').trim();
    const co = String(c_o ?? 'C').trim().toUpperCase() === 'O' ? 'O' : 'C';

    const sql = `
      SELECT
        A.ITEM_CODE,
        A.LOT,
        A.B_NO,
        A.SUP_CODE,
        B.ITEM_NAME,
        C.NAME AS SUP_NAME,
        MAX(C.SCHEDULE) AS SCHEDULE,
        A.GOD_CODE,
        MAX(D.GOD_NAME) AS GOD_NAME,
        MIN(A.VR_DATE) AS VR_DATE,
        MAX(A.COST_CODE) AS COST_CODE,
        MAX(A.REMARKS) AS REMARKS,
        MAX(A.MSUP_CODE) AS MSUP_CODE,
        MAX(A.MSUP_NAME) AS MSUP_NAME,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END) AS QNTY,
        SUM(CASE
              WHEN A.STATUS = 'B' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'B' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS BAGS,
        SUM(CASE
              WHEN A.STATUS = 'K' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'K' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS KATTA,
        SUM(CASE
              WHEN A.STATUS = 'H' AND A.E_TYPE = 'R' THEN NVL(A.QNTY, 0)
              WHEN A.STATUS = 'H' AND NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) * -1
              ELSE 0
            END) AS HKATTA,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END) AS WEIGHT,
        SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE NVL(A.G_WEIGHT, 0) * -1 END) AS G_WEIGHT
      FROM LOTSTOCK A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.SUP_CODE = C.CODE
      LEFT JOIN GODOWN D ON A.COMP_CODE = D.COMP_CODE AND A.GOD_CODE = D.GOD_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:item_all = 1 OR A.ITEM_CODE = :item_code)
        AND (:sup_all = 1 OR NVL(A.SUP_CODE, '') = :sup_code)
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
        AND (:bno_all = 1 OR TRIM(TO_CHAR(A.B_NO)) = :b_no)
        AND (:lot_all = 1 OR NVL(TRIM(A.LOT), '') = :lot)
        AND (:cost_all = 1 OR NVL(TRIM(A.COST_CODE), '') = :cost_code)
      GROUP BY A.ITEM_CODE, A.LOT, A.B_NO, A.SUP_CODE, B.ITEM_NAME, C.NAME, A.GOD_CODE
      HAVING (:c_o = 'C' OR SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END) <> 0)
      ORDER BY A.ITEM_CODE, A.LOT, MIN(A.VR_DATE)`;

    const binds = {
      comp_code,
      e_date,
      item_all: item === '' ? 1 : 0,
      item_code: item,
      sup_all: sup === '' ? 1 : 0,
      sup_code: sup,
      god_all: god === '' ? 1 : 0,
      god_code: god,
      bno_all: bikri === '' ? 1 : 0,
      b_no: bikri,
      lot_all: lotNo === '' ? 1 : 0,
      lot: lotNo,
      cost_all: cost === '' ? 1 : 0,
      cost_code: cost,
      c_o: co,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stock lot date-wise detail for one selected lot row */
app.get('/api/stock-lot-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, e_date, item_code, lot, b_no, sup_code, god_code, cost_code } = req.query;
    const item = String(item_code ?? '').trim();
    const lotNo = String(lot ?? '').trim();
    if (!item) return res.status(400).json({ error: 'item_code is required' });
    if (!lotNo) return res.status(400).json({ error: 'lot is required' });
    const bikri = String(b_no ?? '').trim();
    const sup = String(sup_code ?? '').trim();
    const god = String(god_code ?? '').trim();
    const cost = String(cost_code ?? '').trim();

    const sql = `
      SELECT
        A.VR_DATE,
        A.VR_NO,
        A.VR_TYPE,
        A.TYPE,
        A.ITEM_CODE,
        A.LOT,
        A.STATUS,
        A.B_NO,
        A.GOD_CODE,
        A.SUP_CODE,
        A.COST_CODE,
        A.REMARKS,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS R_QNTY,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS S_QNTY,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS R_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS S_WEIGHT,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS R_G_WEIGHT,
        CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS SG_WEIGHT
      FROM LOTSTOCK A
      WHERE A.COMP_CODE = :comp_code
        AND A.ITEM_CODE = :item_code
        AND NVL(TRIM(A.LOT), '') = :lot
        AND A.VR_DATE <= TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:bno_all = 1 OR TRIM(TO_CHAR(A.B_NO)) = :b_no)
        AND (:sup_all = 1 OR NVL(A.SUP_CODE, '') = :sup_code)
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
        AND (:cost_all = 1 OR NVL(TRIM(A.COST_CODE), '') = :cost_code)
      ORDER BY A.VR_DATE, A.VR_NO`;

    const binds = {
      comp_code,
      item_code: item,
      lot: lotNo,
      e_date,
      bno_all: bikri === '' ? 1 : 0,
      b_no: bikri,
      sup_all: sup === '' ? 1 : 0,
      sup_code: sup,
      god_all: god === '' ? 1 : 0,
      god_code: god,
      cost_all: cost === '' ? 1 : 0,
      cost_code: cost,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ StockLot detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Purchase list search helps */
app.get('/api/purchaselist-suppliers', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList suppliers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchaselist-items', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT ITEM_NAME, ITEM_CODE FROM ITEMMAST WHERE COMP_CODE = :comp_code ORDER BY ITEM_NAME`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList items error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchaselist-purcodes', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList purchase codes error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchaselist-godowns', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    const rows = await runQuery(
      `SELECT GOD_CODE, GOD_NAME FROM GODOWN WHERE COMP_CODE = :comp_code ORDER BY GOD_CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ PurchaseList godowns error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Purchase list (PU / DN) */
app.get('/api/purchase-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, code, item_code, pur_code, god_code } = req.query;
    const item = String(item_code ?? '').trim();
    const sup = String(code ?? '').trim();
    const pur = String(pur_code ?? '').trim();
    const god = String(god_code ?? '').trim();
    const sql = `
      SELECT
        A.TYPE,
        A.R_DATE,
        A.R_NO,
        A.BILL_DATE,
        A.BILL_NO,
        A.CODE,
        B.NAME,
        B.CITY,
        B.GST_NO,
        B.PAN,
        A.TRN_NO,
        A.PUR_CODE,
        D.NAME AS PUR_NAME,
        A.ITEM_CODE,
        C.ITEM_NAME,
        A.GOD_CODE,
        A.LOT,
        A.B_NO,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.FREIGHT,
        A.LABOUR,
        A.BILL_AMT
      FROM PURCHASE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.PUR_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.TYPE IN ('PU', 'DN')
        AND A.R_DATE BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
        AND (:item_all = 1 OR A.ITEM_CODE = :item_code)
        AND (:sup_all = 1 OR NVL(A.CODE, '') = :code)
        AND (:pur_all = 1 OR NVL(A.PUR_CODE, '') = :pur_code)
        AND (:god_all = 1 OR NVL(A.GOD_CODE, '') = :god_code)
      ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`;

    const binds = {
      comp_code,
      s_date,
      e_date,
      item_all: item === '' ? 1 : 0,
      item_code: item,
      sup_all: sup === '' ? 1 : 0,
      code: sup,
      pur_all: pur === '' ? 1 : 0,
      pur_code: pur,
      god_all: god === '' ? 1 : 0,
      god_code: god,
    };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Purchase list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Cash/Bank/Journal voucher list from VOUCHER joined with MASTER. */
app.get('/api/voucher-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, vr_type, s_date, e_date, code, dc_code, drcr_flag } = req.query;
    if (!comp_code || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, s_date, and e_date are required' });
    }
    const vrType = String(vr_type ?? '').trim().toUpperCase();
    const codeVal = String(code ?? '').trim().toUpperCase();
    const dcCodeVal = String(dc_code ?? '').trim().toUpperCase();
    const drcr = String(drcr_flag ?? '').trim().toUpperCase();
    let sql = `
      SELECT
        A.VR_TYPE,
        A.VR_DATE,
        A.VR_NO,
        A.TYPE,
        A.TRN_NO,
        A.V_DATE,
        A.CODE,
        B.NAME,
        B.CITY,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.DETAIL,
        A.DR_AMT,
        A.CR_AMT,
        A.CD_AMT,
        A.DC_CODE
      FROM VOUCHER A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')`;

    if (vrType) sql += ` AND A.VR_TYPE = :vr_type`;
    if (codeVal) sql += ` AND A.CODE = :code`;
    if (dcCodeVal) sql += ` AND A.DC_CODE = :dc_code`;
    if (drcr === 'D') sql += ` AND NVL(A.DR_AMT,0) <> 0`;
    else if (drcr === 'C') sql += ` AND NVL(A.CR_AMT,0) <> 0`;

    sql += ` ORDER BY A.VR_TYPE, A.VR_DATE, A.VR_NO, A.TRN_NO`;
    const binds = {
      comp_code,
      s_date,
      e_date,
    };
    if (vrType) binds.vr_type = vrType;
    if (codeVal) binds.code = codeVal;
    if (dcCodeVal) binds.dc_code = dcCodeVal;

    // VOUCHER data may live in hub schema on some installs; try selected year schema first, then hub fallback.
    let rows = await runQuery(sql, binds, comp_uid);
    if ((!rows || rows.length === 0) && comp_uid) {
      rows = await runQuery(sql, binds, null, { suppressDbErrorLog: true });
    }
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Voucher list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Purchase bill / debit note — all lines for one voucher (TYPE + R_DATE + R_NO) */
app.get('/api/purchase-bill-print', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, r_date, r_no } = req.query;
    const typ = String(type ?? '').trim();
    const rno = String(r_no ?? '').trim();
    if (!comp_code || !typ || !r_date || !rno) {
      return res.status(400).json({ error: 'comp_code, type, r_date, and r_no are required' });
    }
    const sql = `
      SELECT
        A.R_DATE,
        A.R_NO,
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.CODE,
        PRT.NAME,
        PRT.ADD1,
        PRT.ADD2,
        PRT.ADD3,
        PRT.CITY,
        PRT.GST_NO,
        PRT.STATE,
        PRT.STATE_CODE,
        PRT.PAN,
        PRT.TEL_NO_O,
        PRT.TEL_NO_R,
        BK.NAME AS BK_NAME,
        A.B_CODE,
        A.TRN_NO,
        IT.ITEM_CODE,
        IT.ITEM_NAME,
        IT.HSN_CODE,
        PURM.NAME AS PUR_NAME,
        A.GOD_CODE,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.DIS_AMT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.OTH_EXP_1,
        A.OTH_EXP_2,
        A.OTH_EXP_3,
        A.OTH_EXP_4,
        A.OTH_EXP_5,
        A.OTH_EXP_6,
        A.OTH_EXP_7,
        A.OTH_EXP_8,
        A.BROK_PAID,
        A.MANDI_EXP,
        A.LABOUR AS LABOUR_EXP,
        A.BARDANA_EXP,
        A.FREIGHT AS FREIGHT_PAID,
        A.CD_AMOUNT,
        A.DHARAM_KANTA AS DHARM_KANTA,
        A.TULWAI_EXP,
        A.ROUND_OFF,
        A.BILL_AMT,
        A.TRUCK,
        A.GR_NO,
        A.TPT,
        A.COST_CODE
      FROM PURCHASE A
      JOIN ITEMMAST IT ON A.COMP_CODE = IT.COMP_CODE AND A.ITEM_CODE = IT.ITEM_CODE
      JOIN MASTER PRT ON A.COMP_CODE = PRT.COMP_CODE AND A.CODE = PRT.CODE
      LEFT JOIN MASTER PURM ON A.COMP_CODE = PURM.COMP_CODE AND A.PUR_CODE = PURM.CODE
      LEFT JOIN MASTER BK ON A.COMP_CODE = BK.COMP_CODE AND A.B_CODE = BK.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRUNC(A.R_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))
        AND TRIM(TO_CHAR(A.R_NO)) = TRIM(TO_CHAR(:r_no))
      ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`;
    const rows = await runQuery(sql, { comp_code, type: typ, r_date, r_no: rno }, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Purchase bill print error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function hsnNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function hsnTxt(v) {
  return String(v ?? '').trim();
}
function hsnRate(row) {
  return +(hsnNum(row.CGST_PER) + hsnNum(row.SGST_PER) + hsnNum(row.IGST_PER)).toFixed(2);
}
function hsnMonthKey(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  return `${d.getFullYear()}-${String(m).padStart(2, '0')}`;
}
function hsnMonthNameFromKey(k) {
  const [y, m] = String(k || '').split('-');
  const mm = Number(m);
  const yy = Number(y);
  if (!Number.isFinite(mm) || !Number.isFinite(yy) || mm < 1 || mm > 12) return '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[mm - 1]}-${yy}`;
}

function hsnYmdLocal(dt) {
  const d = dt instanceof Date ? dt : new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hsnRoundLineRow(r) {
  return {
    TYPE: hsnTxt(r.TYPE),
    BILL_DATE: hsnTxt(r.BILL_DATE),
    BILL_NO: hsnTxt(r.BILL_NO),
    B_TYPE: hsnTxt(r.B_TYPE),
    CODE: hsnTxt(r.CODE),
    NAME: hsnTxt(r.NAME),
    GST_NO: hsnTxt(r.GST_NO),
    STATE_CODE: hsnTxt(r.STATE_CODE),
    STATE: hsnTxt(r.STATE),
    ITEM_CODE: hsnTxt(r.ITEM_CODE),
    ITEM_NAME: hsnTxt(r.ITEM_NAME),
    HSN_CODE: hsnTxt(r.HSN_CODE),
    HSN_UNIT: hsnTxt(r.HSN_UNIT),
    SCHEDULE: +hsnNum(r.SCHEDULE).toFixed(2),
    QNTY: +hsnNum(r.QNTY).toFixed(3),
    WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
    TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
    CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
    SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
    IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
    CGST_PER: +hsnNum(r.CGST_PER).toFixed(2),
    SGST_PER: +hsnNum(r.SGST_PER).toFixed(2),
    IGST_PER: +hsnNum(r.IGST_PER).toFixed(2),
  };
}

async function buildHsnSalesFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const codeFilter = hsnTxt(code);
  const { sql: murcSchSql, scheduleBind } = hsnMurcScheduleSqlFragment({ m_r_u_c, schedule });
  const saleSql = `
    SELECT
      A.TYPE,
      A.BILL_DATE,
      A.BILL_NO,
      NVL(A.B_TYPE, 'N') AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(A.HSN_CODE, '') AS HSN_CODE,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM SALE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND UPPER(TRIM(A.TYPE)) IN ('SL', 'CN', 'RC', 'SE')
      AND A.BILL_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;

  const dbikriSql = `
    SELECT
      'GR' AS TYPE,
      A.SV_DATE AS BILL_DATE,
      A.SV_NO AS BILL_NO,
      'N' AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.AMOUNT, 0) AS TAXABLE,
      0 AS CGST_AMT,
      0 AS SGST_AMT,
      0 AS IGST_AMT,
      0 AS CGST_PER,
      0 AS SGST_PER,
      0 AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM DBIKRI A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.S_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.SV_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.SV_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;

  const jobworkSql = `
    SELECT
      'GT' AS TYPE,
      A.R_DATE AS BILL_DATE,
      A.R_NO AS BILL_NO,
      'N' AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.JOB_AMT, 0) AS TAXABLE,
      0 AS CGST_AMT,
      0 AS SGST_AMT,
      0 AS IGST_AMT,
      0 AS CGST_PER,
      0 AS SGST_PER,
      0 AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM JOBWORK A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.CR_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;

  const binds = { comp_code, s_date, e_date };
  if (codeFilter) binds.code = codeFilter;
  if (scheduleBind !== undefined) binds.hsn_sch_no = scheduleBind;
  const [saleRows, dbikriRows, jobRows] = await Promise.all([
    runQuery(saleSql, binds, comp_uid),
    runQuery(dbikriSql, binds, comp_uid),
    runQuery(jobworkSql, binds, comp_uid),
  ]);

  return [...(saleRows || []), ...(dbikriRows || []), ...(jobRows || [])].map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sign = type === 'CN' ? -1 : 1;
    const hsn = hsnTxt(r.HSN_CODE) || hsnTxt(r.IHSN_CODE);
    const dt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
      BILL_NO: hsnTxt(r.BILL_NO),
      B_TYPE: hsnTxt(r.B_TYPE || 'N'),
      CODE: hsnTxt(r.CODE),
      NAME: hsnTxt(r.NAME),
      GST_NO: hsnTxt(r.GST_NO),
      STATE_CODE: hsnTxt(r.STATE_CODE),
      STATE: hsnTxt(r.STATE),
      ITEM_CODE: hsnTxt(r.ITEM_CODE),
      ITEM_NAME: hsnTxt(r.ITEM_NAME),
      HSN_CODE: hsn,
      HSN_UNIT: hsnTxt(r.HSN_UNIT),
      SCHEDULE: hsnNum(r.SCHEDULE),
      QNTY: sign * hsnNum(r.QNTY),
      WEIGHT: sign * hsnNum(r.WEIGHT),
      TAXABLE: sign * hsnNum(r.TAXABLE),
      CGST_AMT: sign * hsnNum(r.CGST_AMT),
      SGST_AMT: sign * hsnNum(r.SGST_AMT),
      IGST_AMT: sign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
      TAX_RATE: hsnRate(r),
      MONTH_KEY: Number.isNaN(dt.getTime()) ? '' : hsnMonthKey(dt),
      MONTH: Number.isNaN(dt.getTime()) ? '' : hsnMonthNameFromKey(hsnMonthKey(dt)),
    };
  });
}

async function buildHsnSalesSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const codeFilter = hsnTxt(code);
  const { sql: murcSchSql, scheduleBind } = hsnMurcScheduleSqlFragment({ m_r_u_c, schedule });
  const saleSql = `
    SELECT
      A.TYPE,
      A.BILL_DATE,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(A.HSN_CODE, '') AS HSN_CODE,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM SALE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND UPPER(TRIM(A.TYPE)) IN ('SL', 'CN', 'RC', 'SE')
      AND A.BILL_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;

  const dbikriSql = `
    SELECT
      'GR' AS TYPE,
      A.SV_DATE AS BILL_DATE,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(A.AMOUNT, 0) AS TAXABLE,
      0 AS CGST_AMT,
      0 AS SGST_AMT,
      0 AS IGST_AMT,
      0 AS CGST_PER,
      0 AS SGST_PER,
      0 AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM DBIKRI A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.S_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.SV_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.SV_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;

  const jobworkSql = `
    SELECT
      'GT' AS TYPE,
      A.R_DATE AS BILL_DATE,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(A.JOB_AMT, 0) AS TAXABLE,
      0 AS CGST_AMT,
      0 AS SGST_AMT,
      0 AS IGST_AMT,
      0 AS CGST_PER,
      0 AS SGST_PER,
      0 AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM JOBWORK A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.CR_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;

  const binds = { comp_code, s_date, e_date };
  if (codeFilter) binds.code = codeFilter;
  if (scheduleBind !== undefined) binds.hsn_sch_no = scheduleBind;
  const [saleRows, dbikriRows, jobRows] = await Promise.all([
    runQuery(saleSql, binds, comp_uid),
    runQuery(dbikriSql, binds, comp_uid),
    runQuery(jobworkSql, binds, comp_uid),
  ]);

  return [...(saleRows || []), ...(dbikriRows || []), ...(jobRows || [])].map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sign = type === 'CN' ? -1 : 1;
    const hsn = hsnTxt(r.HSN_CODE) || hsnTxt(r.IHSN_CODE);
    const dt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
      HSN_CODE: hsn,
      SCHEDULE: hsnNum(r.SCHEDULE),
      GST_NO: hsnTxt(r.GST_NO),
      QNTY: sign * hsnNum(r.QNTY),
      WEIGHT: sign * hsnNum(r.WEIGHT),
      TAXABLE: sign * hsnNum(r.TAXABLE),
      CGST_AMT: sign * hsnNum(r.CGST_AMT),
      SGST_AMT: sign * hsnNum(r.SGST_AMT),
      IGST_AMT: sign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
      TAX_RATE: hsnRate(r),
      MONTH_KEY: Number.isNaN(dt.getTime()) ? '' : hsnMonthKey(dt),
      MONTH: Number.isNaN(dt.getTime()) ? '' : hsnMonthNameFromKey(hsnMonthKey(dt)),
    };
  });
}

/** Extra WHERE lines for SALE/DBIKRI/JOBWORK (party = B, schedule supplier = D). Matches applyHsnBaseFilters. */
function hsnMurcScheduleSqlFragment({ m_r_u_c, schedule }) {
  const murc = hsnTxt(m_r_u_c || 'C').toUpperCase().slice(0, 1);
  const schNo = Number(schedule);
  const schFilterOn = Number.isFinite(schNo) && schNo !== 0;
  const lines = [];
  if (murc === 'R') lines.push("AND NVL(TRIM(B.GST_NO), '') <> ''");
  else if (murc === 'U') lines.push("AND NVL(TRIM(B.GST_NO), '') = ''");
  if (schFilterOn) lines.push('AND NVL(D.SCHEDULE, 0) = :hsn_sch_no');
  return {
    sql: lines.length ? `\n      ${lines.join('\n      ')}` : '',
    scheduleBind: schFilterOn ? schNo : undefined,
  };
}

function applyHsnBaseFilters(baseRows, { m_r_u_c, schedule }) {
  const murc = hsnTxt(m_r_u_c || 'C').toUpperCase().slice(0, 1);
  const schNo = Number(schedule);
  const schFilterOn = Number.isFinite(schNo) && schNo !== 0;
  let filtered = Array.isArray(baseRows) ? baseRows : [];
  if (schFilterOn) filtered = filtered.filter((r) => hsnNum(r.SCHEDULE) === schNo);
  if (murc === 'R') filtered = filtered.filter((r) => hsnTxt(r.GST_NO) !== '');
  if (murc === 'U') filtered = filtered.filter((r) => hsnTxt(r.GST_NO) === '');
  return filtered;
}

function hsnFastCmp(a, b) {
  const aa = hsnTxt(a);
  const bb = hsnTxt(b);
  if (aa === bb) return 0;
  return aa < bb ? -1 : 1;
}

/** HSN Sales report with 3 tab views: date-wise, monthly hsn-wise, hsn-wise monthly. */
app.get('/api/hsn-sales', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }

    const base = await buildHsnSalesSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });

    const monthlyHsnMap = new Map();
    const hsnMonthlyMap = new Map();
    filtered.forEach((r) => {
      const mKey = hsnTxt(r.MONTH_KEY);
      if (!mKey) return;

      const mhKey = `${mKey}|${r.HSN_CODE}|${r.TAX_RATE}`;
      const mhRow = monthlyHsnMap.get(mhKey) || {
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        HSN_CODE: r.HSN_CODE,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      mhRow.QNTY += r.QNTY;
      mhRow.WEIGHT += r.WEIGHT;
      mhRow.TAXABLE += r.TAXABLE;
      mhRow.CGST_AMT += r.CGST_AMT;
      mhRow.SGST_AMT += r.SGST_AMT;
      mhRow.IGST_AMT += r.IGST_AMT;
      monthlyHsnMap.set(mhKey, mhRow);

      const hmKey = `${r.HSN_CODE}|${mKey}|${r.TAX_RATE}`;
      const hmRow = hsnMonthlyMap.get(hmKey) || {
        HSN_CODE: r.HSN_CODE,
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      hmRow.QNTY += r.QNTY;
      hmRow.WEIGHT += r.WEIGHT;
      hmRow.TAXABLE += r.TAXABLE;
      hmRow.CGST_AMT += r.CGST_AMT;
      hmRow.SGST_AMT += r.SGST_AMT;
      hmRow.IGST_AMT += r.IGST_AMT;
      hsnMonthlyMap.set(hmKey, hmRow);
    });

    const roundRows = (rows) =>
      rows.map((r) => ({
        ...r,
        QNTY: +hsnNum(r.QNTY).toFixed(3),
        WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
        TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
        CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
        SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
        IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
        TAX_RATE: +hsnNum(r.TAX_RATE).toFixed(2),
      }));

    const monthlyHsnWise = roundRows(Array.from(monthlyHsnMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    const hsnWiseMonthly = roundRows(Array.from(hsnMonthlyMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );

    res.json({
      ok: true,
      sheets: {
        dateWise: [],
        monthlyHsnWise: monthlyHsnWise.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
        hsnWiseMonthly: hsnWiseMonthly.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
      },
      dateWiseDeferred: true,
    });
  } catch (err) {
    console.error('❌ HSN sales error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-sales-datewise', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const base = await buildHsnSalesFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN sales datewise error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-sales-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code, tab, month, hsn_code, tax_rate } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const tabName = hsnTxt(tab);
    if (!['monthlyHsnWise', 'hsnWiseMonthly'].includes(tabName)) {
      return res.status(400).json({ error: "tab must be 'monthlyHsnWise' or 'hsnWiseMonthly'" });
    }
    const monthKey = hsnTxt(month);
    const hsnCode = hsnTxt(hsn_code);
    const taxRate = hsnNum(tax_rate);
    if (!monthKey || !hsnCode) {
      return res.status(400).json({ error: 'month and hsn_code are required' });
    }
    const base = await buildHsnSalesFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule }).filter(
      (r) =>
        hsnTxt(r.MONTH_KEY) === monthKey &&
        hsnTxt(r.HSN_CODE) === hsnCode &&
        Math.abs(hsnNum(r.TAX_RATE) - taxRate) < 0.0001
    );
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN sales detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-sales-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const rows = await runQuery(
      `SELECT CODE, NAME, CITY FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ HSN sales parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function stateWiseGstPer(row) {
  return +(hsnNum(row.CGST_PER) + hsnNum(row.SGST_PER) + hsnNum(row.IGST_PER)).toFixed(2);
}

function stateWiseSaleTypeNum(raw) {
  const s = hsnTxt(raw);
  if (!s) return NaN;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : NaN;
}

function stateWiseSaleRowAllowed(rawType) {
  const n = stateWiseSaleTypeNum(rawType);
  if (Number.isFinite(n)) return [0, 1, 3, 4, 7, 8].includes(n);
  const u = hsnTxt(rawType).toUpperCase();
  return ['SL', 'SE', 'CN', 'GN', 'CX'].includes(u);
}

function stateWiseSaleRowSign(rawType) {
  const n = stateWiseSaleTypeNum(rawType);
  if (Number.isFinite(n)) return n === 4 || n === 8 ? -1 : 1;
  const u = hsnTxt(rawType).toUpperCase();
  return ['CN', 'GN'].includes(u) ? -1 : 1;
}

async function buildStateWiseSalesLineRows({ comp_code, comp_uid, s_date, e_date, state_code }) {
  const stateFilter = String(state_code ?? '').trim();
  const stateSql = stateFilter ? "\n      AND TRIM(NVL(B.STATE_CODE,'')) = :state_code" : '';
  const saleSql = `
    SELECT
      A.TYPE,
      A.BILL_DATE,
      A.BILL_NO,
      NVL(A.B_TYPE, 'N') AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.CITY, '') AS CITY,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM SALE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
    WHERE A.COMP_CODE = :comp_code
      AND A.BILL_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1${stateSql}`;

  const binds = { comp_code, s_date, e_date };
  if (stateFilter) binds.state_code = stateFilter;
  const saleRows = await runQuery(saleSql, binds, comp_uid);

  return (saleRows || [])
    .filter((r) => stateWiseSaleRowAllowed(r.TYPE))
    .map((r) => {
      const sign = stateWiseSaleRowSign(r.TYPE);
      const dt = new Date(r.BILL_DATE);
      return {
        TYPE: hsnTxt(r.TYPE).toUpperCase(),
        BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
        BILL_NO: hsnTxt(r.BILL_NO),
        B_TYPE: hsnTxt(r.B_TYPE || 'N'),
        CODE: hsnTxt(r.CODE),
        NAME: hsnTxt(r.NAME),
        CITY: hsnTxt(r.CITY),
        STATE_CODE: hsnTxt(r.STATE_CODE),
        STATE: hsnTxt(r.STATE),
        QNTY: sign * hsnNum(r.QNTY),
        WEIGHT: sign * hsnNum(r.WEIGHT),
        TAXABLE: sign * hsnNum(r.TAXABLE),
        CGST_AMT: sign * hsnNum(r.CGST_AMT),
        SGST_AMT: sign * hsnNum(r.SGST_AMT),
        IGST_AMT: sign * hsnNum(r.IGST_AMT),
        CGST_PER: hsnNum(r.CGST_PER),
        SGST_PER: hsnNum(r.SGST_PER),
        IGST_PER: hsnNum(r.IGST_PER),
      };
    });
}

function aggregateStateWiseSummaryRows(lines) {
  const map = new Map();
  for (const r of lines || []) {
    const gstPer = stateWiseGstPer(r);
    const key = `${hsnTxt(r.STATE_CODE)}|${hsnTxt(r.STATE)}|${gstPer.toFixed(2)}`;
    const agg =
      map.get(key) ||
      {
        STATE_CODE: hsnTxt(r.STATE_CODE),
        STATE: hsnTxt(r.STATE),
        GST_PER: gstPer,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
    agg.QNTY += hsnNum(r.QNTY);
    agg.WEIGHT += hsnNum(r.WEIGHT);
    agg.TAXABLE += hsnNum(r.TAXABLE);
    agg.CGST_AMT += hsnNum(r.CGST_AMT);
    agg.SGST_AMT += hsnNum(r.SGST_AMT);
    agg.IGST_AMT += hsnNum(r.IGST_AMT);
    map.set(key, agg);
  }
  return Array.from(map.values())
    .sort(
      (a, b) =>
        hsnFastCmp(a.STATE, b.STATE) ||
        hsnFastCmp(a.STATE_CODE, b.STATE_CODE) ||
        hsnNum(a.GST_PER) - hsnNum(b.GST_PER)
    )
    .map((r) => ({
      STATE_CODE: hsnTxt(r.STATE_CODE),
      STATE: hsnTxt(r.STATE),
      GST_PER: +hsnNum(r.GST_PER).toFixed(2),
      QNTY: +hsnNum(r.QNTY).toFixed(3),
      WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
      TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
      CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
      SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
      IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
    }));
}

function stateWiseRoundDetailRow(r) {
  return {
    BILL_DATE: hsnTxt(r.BILL_DATE),
    BILL_NO: hsnTxt(r.BILL_NO),
    B_TYPE: hsnTxt(r.B_TYPE),
    TYPE: hsnTxt(r.TYPE),
    CODE: hsnTxt(r.CODE),
    NAME: hsnTxt(r.NAME),
    CITY: hsnTxt(r.CITY),
    STATE_CODE: hsnTxt(r.STATE_CODE),
    STATE: hsnTxt(r.STATE),
    QNTY: +hsnNum(r.QNTY).toFixed(3),
    WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
    TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
    GST_PER: stateWiseGstPer(r),
    CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
    SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
    IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
  };
}

/** State lookup for State Wise Sales filter (MASTER / GST_STATE). */
app.get('/api/state-wise-sales/states', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const rows = await fetchMasterPartyStateRows(comp_uid, comp_code);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ state-wise-sales states error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** State Wise Sales — summary by STATE_CODE, STATE, GST% (CGST+SGST+IGST). */
app.get('/api/state-wise-sales', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, state_code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const lines = await buildStateWiseSalesLineRows({ comp_code, comp_uid, s_date, e_date, state_code });
    const rows = aggregateStateWiseSummaryRows(lines);
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ state-wise-sales error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function buildStateWisePurchaseLineRows({ comp_code, comp_uid, s_date, e_date, state_code }) {
  const stateFilter = String(state_code ?? '').trim();
  const stateSql = stateFilter ? "\n      AND TRIM(NVL(B.STATE_CODE,'')) = :state_code" : '';
  const purchaseSql = `
    SELECT
      A.TYPE,
      A.R_DATE,
      A.R_NO,
      A.BILL_DATE,
      A.BILL_NO,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.CITY, '') AS CITY,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(A.S_P, '') AS S_P,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT
    FROM PURCHASE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      AND (
        UPPER(TRIM(A.TYPE)) = 'PU'
        OR (UPPER(TRIM(A.TYPE)) = 'EV' AND NVL(A.INPUT_YN,'Y') = 'Y' AND NVL(A.SHOW_IN_GSTR,'Y') = 'Y')
        OR UPPER(TRIM(A.TYPE)) = 'DN'
        OR (UPPER(TRIM(A.TYPE)) = 'DX' AND NVL(A.INPUT_YN,'Y') <> 'N')
        OR (UPPER(TRIM(A.TYPE)) = 'CX' AND NVL(A.INPUT_YN,'Y') <> 'N')
      )${stateSql}`;

  const binds = { comp_code, s_date, e_date };
  if (stateFilter) binds.state_code = stateFilter;
  const purchaseRows = await runQuery(purchaseSql, binds, comp_uid);

  return (purchaseRows || []).map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sp = hsnTxt(r.S_P).toUpperCase();
    const qtySign = type === 'DN' || type === 'DX' ? -1 : 1;
    const taxableSign = (type !== 'DN' && type !== 'DX') || (type === 'CX' && sp === 'P') ? 1 : -1;
    const rDt = new Date(r.R_DATE);
    const billDt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      R_DATE: Number.isNaN(rDt.getTime()) ? '' : hsnYmdLocal(rDt),
      R_NO: hsnTxt(r.R_NO),
      BILL_DATE: Number.isNaN(billDt.getTime()) ? '' : hsnYmdLocal(billDt),
      BILL_NO: hsnTxt(r.BILL_NO),
      B_TYPE: 'N',
      CODE: hsnTxt(r.CODE),
      NAME: hsnTxt(r.NAME),
      CITY: hsnTxt(r.CITY),
      STATE_CODE: hsnTxt(r.STATE_CODE),
      STATE: hsnTxt(r.STATE),
      QNTY: qtySign * hsnNum(r.QNTY),
      WEIGHT: qtySign * hsnNum(r.WEIGHT),
      TAXABLE: taxableSign * hsnNum(r.TAXABLE),
      CGST_AMT: qtySign * hsnNum(r.CGST_AMT),
      SGST_AMT: qtySign * hsnNum(r.SGST_AMT),
      IGST_AMT: qtySign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
    };
  });
}

function stateWiseRoundPurchaseDetailRow(r) {
  return {
    R_DATE: hsnTxt(r.R_DATE),
    R_NO: hsnTxt(r.R_NO),
    BILL_DATE: hsnTxt(r.BILL_DATE),
    BILL_NO: hsnTxt(r.BILL_NO),
    TYPE: hsnTxt(r.TYPE),
    CODE: hsnTxt(r.CODE),
    NAME: hsnTxt(r.NAME),
    CITY: hsnTxt(r.CITY),
    STATE_CODE: hsnTxt(r.STATE_CODE),
    STATE: hsnTxt(r.STATE),
    QNTY: +hsnNum(r.QNTY).toFixed(3),
    WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
    TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
    GST_PER: stateWiseGstPer(r),
    CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
    SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
    IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
  };
}

/** State lookup for State Wise Purchase filter (MASTER / GST_STATE). */
app.get('/api/state-wise-purchase/states', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const rows = await fetchMasterPartyStateRows(comp_uid, comp_code);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ state-wise-purchase states error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** State Wise Purchase — summary by STATE_CODE, STATE, GST% (CGST+SGST+IGST). */
app.get('/api/state-wise-purchase', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, state_code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const lines = await buildStateWisePurchaseLineRows({ comp_code, comp_uid, s_date, e_date, state_code });
    const rows = aggregateStateWiseSummaryRows(lines);
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ state-wise-purchase error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** State Wise Purchase — purchase lines for one state + GST% row (click drill-down). */
app.get('/api/state-wise-purchase/detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, state_code, state, gst_per } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const wantStateCode = hsnTxt(state_code);
    const wantState = hsnTxt(state);
    const wantGst = hsnNum(gst_per);
    const lines = await buildStateWisePurchaseLineRows({
      comp_code,
      comp_uid,
      s_date,
      e_date,
      state_code: state_code || '',
    });
    const rows = lines
      .filter(
        (r) =>
          hsnTxt(r.STATE_CODE) === wantStateCode &&
          hsnTxt(r.STATE) === wantState &&
          Math.abs(stateWiseGstPer(r) - wantGst) < 0.0001
      )
      .map(stateWiseRoundPurchaseDetailRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.R_DATE, b.R_DATE) ||
          hsnFastCmp(a.R_NO, b.R_NO) ||
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.CODE, b.CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ state-wise-purchase detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** State Wise Sales — bill lines for one state + GST% row (click drill-down). */
app.get('/api/state-wise-sales/detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, state_code, state, gst_per } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const wantStateCode = hsnTxt(state_code);
    const wantState = hsnTxt(state);
    const wantGst = hsnNum(gst_per);
    const lines = await buildStateWiseSalesLineRows({
      comp_code,
      comp_uid,
      s_date,
      e_date,
      state_code: state_code || '',
    });
    const rows = lines
      .filter(
        (r) =>
          hsnTxt(r.STATE_CODE) === wantStateCode &&
          hsnTxt(r.STATE) === wantState &&
          Math.abs(stateWiseGstPer(r) - wantGst) < 0.0001
      )
      .map(stateWiseRoundDetailRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.CODE, b.CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ state-wise-sales detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const codeFilter = hsnTxt(code);
  const { sql: murcSchSql, scheduleBind } = hsnMurcScheduleSqlFragment({ m_r_u_c, schedule });
  const sql = `
    SELECT
      A.TYPE,
      A.R_DATE AS BILL_DATE,
      A.R_NO AS BILL_NO,
      'N' AS B_TYPE,
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.GST_NO, '') AS GST_NO,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.STATE, '') AS STATE,
      NVL(C.ITEM_CODE, '') AS ITEM_CODE,
      NVL(C.ITEM_NAME, '') AS ITEM_NAME,
      NVL(C.HSN_CODE, '') AS IHSN_CODE,
      NVL(C.HSN_UNIT, '') AS HSN_UNIT,
      NVL(D.SCHEDULE, 0) AS SCHEDULE,
      NVL(C.HSN_CODE, '') AS HSN_CODE,
      NVL(A.TAXABLE, 0) AS TAXABLE,
      NVL(A.CGST_AMT, 0) AS CGST_AMT,
      NVL(A.SGST_AMT, 0) AS SGST_AMT,
      NVL(A.IGST_AMT, 0) AS IGST_AMT,
      NVL(A.CGST_PER, 0) AS CGST_PER,
      NVL(A.SGST_PER, 0) AS SGST_PER,
      NVL(A.IGST_PER, 0) AS IGST_PER,
      NVL(A.QNTY, 0) AS QNTY,
      NVL(A.WEIGHT, 0) AS WEIGHT,
      NVL(A.S_P, '') AS S_P
    FROM PURCHASE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
    LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.PUR_CODE) = TRIM(D.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date,'DD-MM-YYYY') + 1
      AND (
        UPPER(TRIM(A.TYPE)) = 'PU'
        OR (UPPER(TRIM(A.TYPE)) = 'EV' AND NVL(A.INPUT_YN,'Y') = 'Y' AND NVL(A.SHOW_IN_GSTR,'Y') = 'Y')
        OR UPPER(TRIM(A.TYPE)) = 'DN'
        OR (UPPER(TRIM(A.TYPE)) = 'DX' AND NVL(A.INPUT_YN,'Y') <> 'N')
        OR (UPPER(TRIM(A.TYPE)) = 'CX' AND NVL(A.INPUT_YN,'Y') <> 'N')
      )
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}${murcSchSql}`;
  const binds = { comp_code, s_date, e_date };
  if (codeFilter) binds.code = codeFilter;
  if (scheduleBind !== undefined) binds.hsn_sch_no = scheduleBind;
  const rows = await runQuery(sql, binds, comp_uid);
  return (rows || []).map((r) => {
    const type = hsnTxt(r.TYPE).toUpperCase();
    const sp = hsnTxt(r.S_P).toUpperCase();
    const qtySign = type === 'DN' || type === 'DX' ? -1 : 1;
    const taxableSign = (type !== 'DN' && type !== 'DX') || (type === 'CX' && sp === 'P') ? 1 : -1;
    const hsn = hsnTxt(r.HSN_CODE) || hsnTxt(r.IHSN_CODE);
    const dt = new Date(r.BILL_DATE);
    return {
      TYPE: type,
      BILL_DATE: Number.isNaN(dt.getTime()) ? '' : hsnYmdLocal(dt),
      BILL_NO: hsnTxt(r.BILL_NO),
      B_TYPE: hsnTxt(r.B_TYPE || 'N'),
      CODE: hsnTxt(r.CODE),
      NAME: hsnTxt(r.NAME),
      GST_NO: hsnTxt(r.GST_NO),
      STATE_CODE: hsnTxt(r.STATE_CODE),
      STATE: hsnTxt(r.STATE),
      ITEM_CODE: hsnTxt(r.ITEM_CODE),
      ITEM_NAME: hsnTxt(r.ITEM_NAME),
      HSN_CODE: hsn,
      HSN_UNIT: hsnTxt(r.HSN_UNIT),
      SCHEDULE: hsnNum(r.SCHEDULE),
      QNTY: qtySign * hsnNum(r.QNTY),
      WEIGHT: qtySign * hsnNum(r.WEIGHT),
      TAXABLE: taxableSign * hsnNum(r.TAXABLE),
      CGST_AMT: qtySign * hsnNum(r.CGST_AMT),
      SGST_AMT: qtySign * hsnNum(r.SGST_AMT),
      IGST_AMT: qtySign * hsnNum(r.IGST_AMT),
      CGST_PER: hsnNum(r.CGST_PER),
      SGST_PER: hsnNum(r.SGST_PER),
      IGST_PER: hsnNum(r.IGST_PER),
      TAX_RATE: hsnRate(r),
      MONTH_KEY: Number.isNaN(dt.getTime()) ? '' : hsnMonthKey(dt),
      MONTH: Number.isNaN(dt.getTime()) ? '' : hsnMonthNameFromKey(hsnMonthKey(dt)),
    };
  });
}

async function buildHsnPurchaseSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule }) {
  const full = await buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
  return full.map((r) => ({
    TYPE: r.TYPE,
    BILL_DATE: r.BILL_DATE,
    HSN_CODE: r.HSN_CODE,
    SCHEDULE: r.SCHEDULE,
    GST_NO: r.GST_NO,
    QNTY: r.QNTY,
    WEIGHT: r.WEIGHT,
    TAXABLE: r.TAXABLE,
    CGST_AMT: r.CGST_AMT,
    SGST_AMT: r.SGST_AMT,
    IGST_AMT: r.IGST_AMT,
    CGST_PER: r.CGST_PER,
    SGST_PER: r.SGST_PER,
    IGST_PER: r.IGST_PER,
    TAX_RATE: r.TAX_RATE,
    MONTH_KEY: r.MONTH_KEY,
    MONTH: r.MONTH,
  }));
}

/** HSN Purchase report with 3 tab views: date-wise, monthly hsn-wise, hsn-wise monthly. */
app.get('/api/hsn-purchase', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const base = await buildHsnPurchaseSummaryRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });
    const monthlyHsnMap = new Map();
    const hsnMonthlyMap = new Map();
    filtered.forEach((r) => {
      const mKey = hsnTxt(r.MONTH_KEY);
      if (!mKey) return;
      const mhKey = `${mKey}|${r.HSN_CODE}|${r.TAX_RATE}`;
      const mhRow = monthlyHsnMap.get(mhKey) || {
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        HSN_CODE: r.HSN_CODE,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      mhRow.QNTY += r.QNTY;
      mhRow.WEIGHT += r.WEIGHT;
      mhRow.TAXABLE += r.TAXABLE;
      mhRow.CGST_AMT += r.CGST_AMT;
      mhRow.SGST_AMT += r.SGST_AMT;
      mhRow.IGST_AMT += r.IGST_AMT;
      monthlyHsnMap.set(mhKey, mhRow);

      const hmKey = `${r.HSN_CODE}|${mKey}|${r.TAX_RATE}`;
      const hmRow = hsnMonthlyMap.get(hmKey) || {
        HSN_CODE: r.HSN_CODE,
        MONTH: hsnMonthNameFromKey(mKey),
        MONTH_KEY: mKey,
        TAX_RATE: r.TAX_RATE,
        QNTY: 0,
        WEIGHT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
      };
      hmRow.QNTY += r.QNTY;
      hmRow.WEIGHT += r.WEIGHT;
      hmRow.TAXABLE += r.TAXABLE;
      hmRow.CGST_AMT += r.CGST_AMT;
      hmRow.SGST_AMT += r.SGST_AMT;
      hmRow.IGST_AMT += r.IGST_AMT;
      hsnMonthlyMap.set(hmKey, hmRow);
    });
    const roundRows = (rows) =>
      rows.map((r) => ({
        ...r,
        QNTY: +hsnNum(r.QNTY).toFixed(3),
        WEIGHT: +hsnNum(r.WEIGHT).toFixed(3),
        TAXABLE: +hsnNum(r.TAXABLE).toFixed(2),
        CGST_AMT: +hsnNum(r.CGST_AMT).toFixed(2),
        SGST_AMT: +hsnNum(r.SGST_AMT).toFixed(2),
        IGST_AMT: +hsnNum(r.IGST_AMT).toFixed(2),
        TAX_RATE: +hsnNum(r.TAX_RATE).toFixed(2),
      }));
    const monthlyHsnWise = roundRows(Array.from(monthlyHsnMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    const hsnWiseMonthly = roundRows(Array.from(hsnMonthlyMap.values())).sort(
      (a, b) =>
        hsnFastCmp(a.HSN_CODE, b.HSN_CODE) ||
        hsnFastCmp(a.MONTH_KEY, b.MONTH_KEY) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    res.json({
      ok: true,
      sheets: {
        dateWise: [],
        monthlyHsnWise: monthlyHsnWise.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
        hsnWiseMonthly: hsnWiseMonthly.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
      },
      dateWiseDeferred: true,
    });
  } catch (err) {
    console.error('❌ HSN purchase error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-purchase-datewise', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const base = await buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN purchase datewise error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-purchase-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code, tab, month, hsn_code, tax_rate } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const tabName = hsnTxt(tab);
    if (!['monthlyHsnWise', 'hsnWiseMonthly'].includes(tabName)) {
      return res.status(400).json({ error: "tab must be 'monthlyHsnWise' or 'hsnWiseMonthly'" });
    }
    const monthKey = hsnTxt(month);
    const hsnCode = hsnTxt(hsn_code);
    const taxRate = hsnNum(tax_rate);
    if (!monthKey || !hsnCode) {
      return res.status(400).json({ error: 'month and hsn_code are required' });
    }
    const base = await buildHsnPurchaseFullRows({ comp_code, comp_uid, s_date, e_date, code, m_r_u_c, schedule });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule }).filter(
      (r) =>
        hsnTxt(r.MONTH_KEY) === monthKey &&
        hsnTxt(r.HSN_CODE) === hsnCode &&
        Math.abs(hsnNum(r.TAX_RATE) - taxRate) < 0.0001
    );
    const rows = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnFastCmp(a.BILL_DATE, b.BILL_DATE) ||
          hsnFastCmp(a.BILL_NO, b.BILL_NO) ||
          hsnFastCmp(a.B_TYPE, b.B_TYPE) ||
          hsnFastCmp(a.ITEM_CODE, b.ITEM_CODE)
      );
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ HSN purchase detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hsn-purchase-parties', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const rows = await runQuery(
      `SELECT CODE, NAME, CITY FROM MASTER WHERE COMP_CODE = :comp_code ORDER BY NAME, CITY, CODE`,
      { comp_code },
      comp_uid
    );
    res.json(rows || []);
  } catch (err) {
    console.error('❌ HSN purchase parties error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Trading A/C summary (API for new Trading A/C button). */
app.get('/api/trading-ac-accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid, schedule } = req.query;
    if (!comp_code || !comp_uid || !schedule) {
      return res.status(400).json({ error: 'comp_code, comp_uid, schedule are required' });
    }
    const scheduleNumRaw = Number(String(schedule).trim());
    const scheduleNum = Number.isFinite(scheduleNumRaw) ? scheduleNumRaw : 0;
    let rows = await runQuery(
      `
      SELECT TRIM(CODE) AS CODE, NVL(NAME,'') AS NAME
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
      ORDER BY UPPER(NVL(NAME,'')), TRIM(CODE)
      `,
      { comp_code, schedule_num: scheduleNum },
      comp_uid
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      rows = await runQuery(
        `
        SELECT TRIM(CODE) AS CODE, NVL(NAME,'') AS NAME
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
        ORDER BY UPPER(NVL(NAME,'')), TRIM(CODE)
        `,
        { comp_code, schedule_num: scheduleNum },
        null,
        { suppressDbErrorLog: true }
      );
    }
    res.json({ ok: true, rows: rows || [] });
  } catch (err) {
    console.error('❌ Trading account list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      schedule,
      code,
      edt,
      // accepted for parity with VFP call signature
      mcb,
      mwyn,
      cat_code_yn,
      m_short_pick,
      mfyn,
      manual_confirmed,
    } = req.query;
    void mcb;
    void mwyn;
    void cat_code_yn;
    void m_short_pick;
    void mfyn;

    if (!comp_code || !comp_uid || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, edt are required' });
    }

    const eDate = parseDateOnly(edt);
    if (!eDate) {
      return res.status(400).json({ error: 'edt must be a valid date (DD-MM-YYYY or YYYY-MM-DD)' });
    }
    const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!compdet) {
      return res.status(400).json({ error: 'Unable to resolve compdet row for comp_code / comp_uid' });
    }
    const sDate = parseDateOnly(compdet.COMP_S_DT ?? compdet.comp_s_dt);
    if (!sDate) {
      return res.status(400).json({ error: 'COMP_S_DT not found for selected company/year' });
    }

    const scheduleInput = String(schedule ?? '').trim();
    const scheduleNumRaw = Number(scheduleInput);
    const scheduleNum = Number.isFinite(scheduleNumRaw) ? scheduleNumRaw : 0;
    const scheduleTxt = scheduleInput
      ? (Number.isFinite(scheduleNumRaw) ? scheduleNumRaw.toFixed(2) : scheduleInput)
      : '';
    const codeFilter = String(code ?? '').trim();
    const mfynMode = String(mfyn || 'A').trim().toUpperCase();
    const manualConfirmed = String(manual_confirmed || 'N').trim().toUpperCase() === 'Y';
    const needLedgerBase = mfynMode === 'A' && codeFilter === '' ? 1 : 0;

    // Auto mode keeps rebuilding CLSTOCK from MASTER schedule.
    // Manual mode must preserve saved AMOUNT/SHORTAGE so user doesn't re-enter every run.
    const mustRebuildClstock = mfynMode !== 'M';
    if (mustRebuildClstock) {
      // Exact VFP-style reset flow:
      // DELETE FROM CLSTOCK WHERE COMP_CODE=:COMP_CODE
      // INSERT INTO CLSTOCK(COMP_CODE,CODE,NAME,OP_BALANCE) SELECT ... FROM MASTER WHERE ... SCHEDULE=:SCHEDULE
      await runQuery(`DELETE FROM CLSTOCK WHERE COMP_CODE = :comp_code`, { comp_code }, comp_uid, { autoCommit: true });
      await runQuery(
        `
        INSERT INTO CLSTOCK (COMP_CODE, CODE, NAME, OP_BALANCE)
        SELECT COMP_CODE, CODE, NAME, NVL(OP_BALANCE,0)
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
          AND (NVL(:code_filter, ' ') = ' ' OR TRIM(CODE) = TRIM(:code_filter))
        `,
        { comp_code, schedule_num: scheduleNum, code_filter: codeFilter },
        comp_uid,
        { autoCommit: true }
      );
    }

    let baseMasterRows = await runQuery(
      `
      SELECT TRIM(CODE) AS CODE, NVL(NAME,'') AS NAME, NVL(OP_BALANCE,0) AS OP_BALANCE
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
        AND (NVL(:code_filter, ' ') = ' ' OR TRIM(CODE) = TRIM(:code_filter))
      ORDER BY TRIM(CODE)
      `,
      { comp_code, schedule_num: scheduleNum, code_filter: codeFilter },
      comp_uid
    );
    let masterSource = 'comp_uid';
    if (!Array.isArray(baseMasterRows) || baseMasterRows.length === 0) {
      baseMasterRows = await runQuery(
        `
        SELECT TRIM(CODE) AS CODE, NVL(NAME,'') AS NAME, NVL(OP_BALANCE,0) AS OP_BALANCE
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
          AND (NVL(:code_filter, ' ') = ' ' OR TRIM(CODE) = TRIM(:code_filter))
        ORDER BY TRIM(CODE)
        `,
        { comp_code, schedule_num: scheduleNum, code_filter: codeFilter },
        null,
        { suppressDbErrorLog: true }
      );
      masterSource = 'hub';
    }

    // Manual mode: first show CLSTOCK table for AMOUNT/SHORTAGE entry, then caller confirms and reruns.
    if (mfynMode === 'M' && !manualConfirmed) {
      let manualRows = await runQuery(
        `
        SELECT TRIM(CODE) AS CODE, NVL(NAME,'') AS NAME, NVL(OP_BALANCE,0) AS OP_BALANCE, NVL(AMOUNT,0) AS AMOUNT, NVL(SHORTAGE,0) AS SHORTAGE
        FROM CLSTOCK
        WHERE COMP_CODE = :comp_code
          AND (NVL(:code_filter, ' ') = ' ' OR TRIM(CODE) = TRIM(:code_filter))
        ORDER BY TRIM(CODE)
        `,
        { comp_code, code_filter: codeFilter },
        comp_uid
      );
      const masterMap = new Map(
        (baseMasterRows || []).map((r) => [
          String(r.CODE || '').trim(),
          {
            CODE: String(r.CODE || '').trim(),
            NAME: String(r.NAME || ''),
            OP_BALANCE: Number(r.OP_BALANCE) || 0,
            AMOUNT: 0,
            SHORTAGE: 0,
          },
        ])
      );
      (manualRows || []).forEach((r) => {
        const k = String(r?.CODE || '').trim();
        if (!k || !masterMap.has(k)) return;
        const cur = masterMap.get(k);
        cur.AMOUNT = Number(r?.AMOUNT) || 0;
        cur.SHORTAGE = Number(r?.SHORTAGE) || 0;
        cur.OP_BALANCE = Number(r?.OP_BALANCE) || cur.OP_BALANCE;
        masterMap.set(k, cur);
      });
      manualRows = Array.from(masterMap.values());
      return res.json({
        ok: true,
        requiresManualEntry: true,
        rows: manualRows || [],
        debug: {
          comp_code,
          comp_uid,
          schedule_input: schedule,
          schedule_num: scheduleNum,
          master_count: (baseMasterRows || []).length,
          clstock_count: (manualRows || []).length,
          master_source: masterSource,
          sample_master_codes: (baseMasterRows || []).slice(0, 10).map((r) => `${String(r.CODE || '').trim()}:${String(r.NAME || '').trim()}`),
        },
      });
    }
    const baseAccounts = await runQuery(
      `
      SELECT
        TRIM(M.CODE) AS CODE,
        NVL(M.NAME,'') AS NAME,
        NVL(M.OP_BALANCE,0) AS M_OP_BALANCE,
        NVL(M.SHORTAGE,0) AS M_SHORTAGE,
        NVL(C.OP_BALANCE, NVL(M.OP_BALANCE,0)) AS C_OP_BALANCE,
        NVL(C.AMOUNT,0) AS C_AMOUNT,
        NVL(C.SHORTAGE, NVL(M.SHORTAGE,0)) AS C_SHORTAGE,
        TRIM(M.CODE) AS P_CODE,
        'W' AS TDG_Q_W,
        CAST('' AS VARCHAR2(6)) AS CAT_CODE,
        CAST('' AS VARCHAR2(40)) AS CAT_NAME
      FROM MASTER M
      LEFT JOIN CLSTOCK C
        ON C.COMP_CODE = M.COMP_CODE
       AND TRIM(C.CODE) = TRIM(M.CODE)
      WHERE M.COMP_CODE = :comp_code
        AND (
          :schedule_txt = ''
          OR ROUND(NVL(M.SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
          OR TRUNC(NVL(M.SCHEDULE,0)) = TRUNC(:schedule_num)
        )
        AND (NVL(:code_filter, ' ') = ' ' OR TRIM(M.CODE) = TRIM(:code_filter))
      ORDER BY TRIM(M.CODE)
      `,
      {
        comp_code,
        schedule_txt: scheduleTxt,
        schedule_num: scheduleNum,
        code_filter: codeFilter,
      },
      comp_uid
    );

    const openingRows = await runQuery(
      `SELECT TRIM(SUP_CODE) AS CODE, SUM(NVL(BAGS,0)+NVL(KATTA,0)+NVL(HKATTA,0)) AS OQTY, SUM(NVL(WEIGHT,0)) AS OWGT
       FROM CPUR
       WHERE COMP_CODE = :comp_code AND R_DATE < :s_date
       GROUP BY TRIM(SUP_CODE)`,
      { comp_code, s_date: sDate },
      comp_uid
    );
    const purchaseRows = await runQuery(
      `SELECT TRIM(PUR_CODE) AS CODE,
              SUM(CASE WHEN TYPE='DN' THEN NVL(QNTY,0)*-1 ELSE NVL(QNTY,0) END) AS PQTY,
              SUM(CASE WHEN TYPE='DN' THEN NVL(WEIGHT,0)*-1 ELSE NVL(WEIGHT,0) END) AS PWGT
       FROM PURCHASE
       WHERE COMP_CODE = :comp_code AND R_DATE <= :e_date AND TYPE IN ('PU','DN','PB')
       GROUP BY TRIM(PUR_CODE)`,
      { comp_code, e_date: eDate },
      comp_uid
    );
    const saleTypeList = String(mcb || 'C').trim().toUpperCase() === 'C' ? `'SL','SE','CH'` : `'SL','SE'`;
    const saleRows = await runQuery(
      `SELECT TRIM(SUP_CODE) AS CODE, SUM(NVL(QNTY,0)) AS SQTY, SUM(NVL(WEIGHT,0)) AS SWGT
       FROM SALE
       WHERE COMP_CODE = :comp_code AND BILL_DATE <= :e_date AND TYPE IN (${saleTypeList})
       GROUP BY TRIM(SUP_CODE)`,
      { comp_code, e_date: eDate },
      comp_uid
    );
    const cnRows = await runQuery(
      `SELECT TRIM(SUP_CODE) AS CODE, SUM(NVL(QNTY,0)) AS SQTY, SUM(NVL(WEIGHT,0)) AS SWGT
       FROM SALE
       WHERE COMP_CODE = :comp_code AND BILL_DATE <= :e_date AND TYPE = 'CN'
       GROUP BY TRIM(SUP_CODE)`,
      { comp_code, e_date: eDate },
      comp_uid
    );
    const dbikriRows =
      String(mcb || 'C').trim().toUpperCase() === 'B'
        ? await runQuery(
            `SELECT TRIM(S_CODE) AS CODE, SUM(NVL(QNTY,0)) AS SQTY, SUM(NVL(WEIGHT,0)) AS SWGT
             FROM DBIKRI
             WHERE COMP_CODE = :comp_code AND SV_DATE <= :e_date
             GROUP BY TRIM(S_CODE)`,
            { comp_code, e_date: eDate },
            comp_uid
          )
        : [];
    const ledgerRows = await runQuery(
      `SELECT TRIM(CODE) AS CODE, SUM(NVL(DR_AMT,0)) AS DR_AMT, SUM(NVL(CR_AMT,0)) AS CR_AMT
       FROM LEDGER
       WHERE COMP_CODE = :comp_code
         AND VR_DATE >= :s_date
         AND VR_DATE <= :e_date
         AND NVL(BIKRI,'N') <> 'Y'
         AND NVL(COST_CODE,'ZZZZZZ') <> 'CLOSNG'
       GROUP BY TRIM(CODE)`,
      { comp_code, s_date: sDate, e_date: eDate },
      comp_uid
    );

    const toMap = (arr, key = 'CODE') => {
      const map = new Map();
      (arr || []).forEach((r) => map.set(String(r?.[key] ?? '').trim(), r || {}));
      return map;
    };
    const openingMap = toMap(openingRows);
    const purchaseMap = toMap(purchaseRows);
    const saleMap = toMap(saleRows);
    const cnMap = toMap(cnRows);
    const dbikriMap = toMap(dbikriRows);
    const ledgerMap = toMap(ledgerRows);

    const stockRows = (baseAccounts || [])
      .map((a) => {
        const codeKey = String(a.CODE || '').trim();
        const pCode = codeKey;
        const op = openingMap.get(codeKey) || {};
        const pur = purchaseMap.get(pCode) || {};
        const sale = saleMap.get(codeKey) || {};
        const cn = cnMap.get(codeKey) || {};
        const dbk = dbikriMap.get(codeKey) || {};
        const ledCode = ledgerMap.get(codeKey) || {};
        const ledP = codeKey === pCode ? {} : ledgerMap.get(pCode) || {};

        // As per VFP logic: opening amount comes from OP_BALANCE (master/code),
        // while opening qty/weight comes from CPUR before start date.
        const moamt = numVal(a.M_OP_BALANCE);
        const mshort = numVal(a.C_SHORTAGE) !== 0 ? numVal(a.C_SHORTAGE) : numVal(a.M_SHORTAGE);
        const moqty = numVal(op.OQTY);
        const mowgt = numVal(op.OWGT);
        const mpqty = numVal(pur.PQTY);
        const mpwgt = numVal(pur.PWGT);
        let msqty = numVal(sale.SQTY) - numVal(cn.SQTY) + numVal(dbk.SQTY);
        let mswgt = numVal(sale.SWGT) - numVal(cn.SWGT) + numVal(dbk.SWGT);
        const mpamt = numVal(ledCode.DR_AMT);
        const msamt = numVal(ledCode.CR_AMT);
        const mcqty = moqty + mpqty - msqty;
        const mcwgt = mowgt + mpwgt - (mswgt + mshort);
        let mcamt = numVal(a.C_AMOUNT);
        if (String(mfyn || 'A').trim().toUpperCase() !== 'M') {
          if (mcqty > 0 || mcwgt > 0) {
            if (mowgt !== 0 || mpwgt !== 0) {
              const rate = (moamt + mpamt) / (mowgt + mpwgt || 1);
              mcamt = mcwgt * rate;
            } else if (moqty !== 0 || mpqty !== 0) {
              const rate = (moamt + mpamt) / (moqty + mpqty || 1);
              mcamt = mcqty * rate;
            }
          } else {
            mcamt = 0;
          }
        }
        const mploss = (moamt + mpamt) - (msamt + mcamt);
        const gprofit = mploss < 0 ? Math.abs(mploss) : 0;
        const gloss = mploss > 0 ? mploss : 0;
        return {
          CODE: codeKey,
          NAME: String(a.NAME || '').trim(),
          OQTY: moqty,
          OWGT: mowgt,
          OAMT: moamt,
          PQTY: mpqty,
          PWGT: mpwgt,
          PAMT: mpamt,
          SQTY: msqty,
          SWGT: mswgt,
          SAMT: msamt,
          SHORT: mshort,
          CQTY: mcqty,
          CWGT: mcwgt,
          CAMT: mcamt,
          GPROFIT: gprofit,
          GLOSS: gloss,
          S_NO: 0,
          DR_AMT: 0,
          CR_AMT: 0,
          A_CODE: '',
          P_CODE: pCode,
          MILLING_YN: String(mwyn || '').trim().toUpperCase().slice(0, 1),
          E_DATE: eDate,
          CAT_CODE: String(a.CAT_CODE || '').trim(),
          CAT_NAME: String(a.CAT_NAME || '').trim(),
        };
      })
      .filter((r) => String(r.CODE || '').trim() !== '');

    const expenseRows = await runQuery(
      `
      SELECT
        '000000' AS CODE,
        NVL(B.NAME,'') AS NAME,
        0 AS OQTY, 0 AS OWGT, 0 AS OAMT,
        0 AS PQTY, 0 AS PWGT, 0 AS PAMT,
        0 AS SQTY, 0 AS SWGT, 0 AS SAMT,
        0 AS SHORT, 0 AS CQTY, 0 AS CWGT, 0 AS CAMT,
        NVL(SUM(NVL(A.CR_AMT,0)-NVL(A.DR_AMT,0)),0) AS GPROFIT,
        NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS GLOSS,
        1 AS S_NO,
        CASE WHEN SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) > 0 THEN SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) ELSE 0 END AS DR_AMT,
        CASE WHEN SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)) < 0 THEN ABS(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0))) ELSE 0 END AS CR_AMT,
        TRIM(B.CODE) AS A_CODE,
        CAST('' AS VARCHAR2(6)) AS P_CODE,
        CAST('' AS VARCHAR2(1)) AS MILLING_YN,
        :e_date AS E_DATE,
        CAST('' AS VARCHAR2(6)) AS CAT_CODE,
        CAST('' AS VARCHAR2(40)) AS CAT_NAME
      FROM LEDGER A
      JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND TRIM(A.CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= :e_date
        AND NVL(A.BIKRI,'N') <> 'Y'
        AND NVL(A.COST_CODE,'ZZZZZZ') <> 'CLOSNG'
        AND NVL(B.SCHEDULE,0) >= 13
        AND NVL(B.SCHEDULE,0) < 16
        AND TRUNC(NVL(B.SCHEDULE,0)) <> 14
      GROUP BY TRIM(B.CODE), NVL(B.NAME,'')
      HAVING ABS(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0))) > 0.0001
      ORDER BY NAME
      `,
      { comp_code, e_date: eDate },
      comp_uid
    );

    let stockOut = stockRows || [];
    if (!stockOut.length) {
      const fallbackRows = await runQuery(
        `
        WITH BASE AS (
          SELECT
            TRIM(M.CODE) AS CODE,
            NVL(M.NAME,'') AS NAME,
            NVL(C.OP_BALANCE, NVL(M.OP_BALANCE,0)) AS OAMT,
            NVL(C.AMOUNT,0) AS CAMT,
            NVL(C.SHORTAGE, NVL(M.SHORTAGE,0)) AS SHORT,
            NVL(I.P_CODE, '') AS P_CODE,
            NVL(I.CAT_CODE, '') AS CAT_CODE,
            NVL(E.CAT_NAME, '') AS CAT_NAME
          FROM MASTER M
          LEFT JOIN CLSTOCK C
            ON C.COMP_CODE = M.COMP_CODE
           AND TRIM(C.CODE) = TRIM(M.CODE)
          LEFT JOIN (
            SELECT COMP_CODE, TRIM(S_CODE) AS S_CODE, MAX(TRIM(P_CODE)) AS P_CODE, MAX(NVL(CAT_CODE,'')) AS CAT_CODE
            FROM ITEMMAST
            GROUP BY COMP_CODE, TRIM(S_CODE)
          ) I
            ON I.COMP_CODE = M.COMP_CODE
           AND I.S_CODE = TRIM(M.CODE)
          LEFT JOIN CATMAST E
            ON E.COMP_CODE = M.COMP_CODE
           AND E.CAT_CODE = I.CAT_CODE
          WHERE M.COMP_CODE = :comp_code
            AND (
              :schedule_txt = ''
              OR ROUND(NVL(M.SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
              OR TRUNC(NVL(M.SCHEDULE,0)) = TRUNC(:schedule_num)
            )
            AND (NVL(:code_filter, ' ') = ' ' OR TRIM(M.CODE) = TRIM(:code_filter))
        ),
        LED AS (
          SELECT TRIM(CODE) AS CODE, SUM(NVL(DR_AMT,0)) AS PAMT, SUM(NVL(CR_AMT,0)) AS SAMT
          FROM LEDGER
          WHERE COMP_CODE = :comp_code
            AND VR_DATE >= :s_date
            AND VR_DATE <= :e_date
            AND NVL(BIKRI,'N') <> 'Y'
            AND NVL(COST_CODE,'ZZZZZZ') <> 'CLOSNG'
          GROUP BY TRIM(CODE)
        )
        SELECT
          B.CODE, B.NAME,
          0 AS OQTY, 0 AS OWGT, NVL(B.OAMT,0) AS OAMT,
          0 AS PQTY, 0 AS PWGT, NVL(L.PAMT,0) AS PAMT,
          0 AS SQTY, 0 AS SWGT, NVL(L.SAMT,0) AS SAMT,
          NVL(B.SHORT,0) AS SHORT, 0 AS CQTY, 0 AS CWGT, NVL(B.CAMT,0) AS CAMT,
          CASE WHEN ((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) < 0 THEN ABS((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) ELSE 0 END AS GPROFIT,
          CASE WHEN ((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) > 0 THEN ((NVL(B.OAMT,0)+NVL(L.PAMT,0))-(NVL(L.SAMT,0)+NVL(B.CAMT,0))) ELSE 0 END AS GLOSS,
          0 AS S_NO, 0 AS DR_AMT, 0 AS CR_AMT,
          CAST('' AS VARCHAR2(6)) AS A_CODE,
          NVL(B.P_CODE, '') AS P_CODE,
          CAST('' AS VARCHAR2(1)) AS MILLING_YN,
          :e_date AS E_DATE,
          NVL(B.CAT_CODE,'') AS CAT_CODE,
          NVL(B.CAT_NAME,'') AS CAT_NAME
        FROM BASE B
        LEFT JOIN LED L ON L.CODE = B.CODE
        ORDER BY B.CODE
        `,
        {
          comp_code,
          schedule_txt: scheduleTxt,
          schedule_num: scheduleNum,
          code_filter: codeFilter,
          s_date: sDate,
          e_date: eDate,
        },
        comp_uid
      );
      stockOut = fallbackRows || [];
    }
    if (!stockOut.length) {
      const masterOnlyRows = await runQuery(
        `
        SELECT TRIM(CODE) AS CODE, NVL(NAME,'') AS NAME, NVL(SCHEDULE,0) AS SCHEDULE
        FROM MASTER
        WHERE COMP_CODE = :comp_code
          AND (
            :schedule_txt = ''
            OR ROUND(NVL(SCHEDULE,0), 2) = ROUND(:schedule_num, 2)
            OR TRUNC(NVL(SCHEDULE,0)) = TRUNC(:schedule_num)
          )
          AND (NVL(:code_filter, ' ') = ' ' OR TRIM(CODE) = TRIM(:code_filter))
        ORDER BY TRIM(CODE)
        `,
        { comp_code, schedule_txt: scheduleTxt, schedule_num: scheduleNum, code_filter: codeFilter },
        comp_uid
      );
      stockOut = (masterOnlyRows || []).map((r) => ({
        CODE: String(r.CODE || '').trim(),
        NAME: String(r.NAME || '').trim(),
        OQTY: 0,
        OWGT: 0,
        OAMT: 0,
        PQTY: 0,
        PWGT: 0,
        PAMT: 0,
        SQTY: 0,
        SWGT: 0,
        SAMT: 0,
        SHORT: 0,
        CQTY: 0,
        CWGT: 0,
        CAMT: 0,
        GPROFIT: 0,
        GLOSS: 0,
        S_NO: 0,
        DR_AMT: 0,
        CR_AMT: 0,
        A_CODE: '',
        P_CODE: '',
        MILLING_YN: String(mwyn || '').trim().toUpperCase().slice(0, 1),
        E_DATE: eDate,
        CAT_CODE: '',
        CAT_NAME: '',
      }));
    }
    if (String(cat_code_yn || 'N').trim().toUpperCase() === 'Y') {
      const grp = new Map();
      stockOut.forEach((r) => {
        const k = String(r.CAT_CODE || '').trim() || '__BLANK__';
        const cur = grp.get(k) || {
          ...r,
          CODE: r.CODE,
          NAME: String(r.CAT_NAME || r.NAME || '').trim(),
          OQTY: 0, OWGT: 0, OAMT: 0,
          PQTY: 0, PWGT: 0, PAMT: 0,
          SQTY: 0, SWGT: 0, SAMT: 0,
          SHORT: 0, CQTY: 0, CWGT: 0, CAMT: 0,
          GPROFIT: 0, GLOSS: 0,
        };
        cur.OQTY += numVal(r.OQTY); cur.OWGT += numVal(r.OWGT); cur.OAMT += numVal(r.OAMT);
        cur.PQTY += numVal(r.PQTY); cur.PWGT += numVal(r.PWGT); cur.PAMT += numVal(r.PAMT);
        cur.SQTY += numVal(r.SQTY); cur.SWGT += numVal(r.SWGT); cur.SAMT += numVal(r.SAMT);
        cur.SHORT += numVal(r.SHORT); cur.CQTY += numVal(r.CQTY); cur.CWGT += numVal(r.CWGT); cur.CAMT += numVal(r.CAMT);
        cur.GPROFIT += numVal(r.GPROFIT); cur.GLOSS += numVal(r.GLOSS);
        grp.set(k, cur);
      });
      stockOut = Array.from(grp.values());
    }

    const rows = [...stockOut, ...(expenseRows || [])];
    res.json({
      ok: true,
      params: {
        comp_code,
        comp_uid,
        schedule: scheduleNum,
        code: codeFilter,
        edt,
      },
      rows,
      debug: {
        comp_code,
        comp_uid,
        schedule_input: schedule,
        schedule_num: scheduleNum,
        stock_count: (stockOut || []).length,
        expense_count: (expenseRows || []).length,
      },
    });
  } catch (err) {
    console.error('❌ Trading A/C error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Profit & Loss (VFP PLACT-style): schedule ≥ 16 ledger balances as-of edt,
 * plus trading gross from SUM(GPROFIT)−SUM(GLOSS) passed from client (same as FTDG / web Trading A/C stock rows).
 */
app.get('/api/pl-profit-loss', async (req, res) => {
  try {
    const { comp_code, comp_uid, edt, sum_gprofit, sum_gloss } = req.query;
    if (!comp_code || !comp_uid || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and edt are required' });
    }
    const eDate = parseDateOnly(edt);
    if (!eDate) {
      return res.status(400).json({ error: 'edt must be a valid date' });
    }
    const dd = String(eDate.getDate()).padStart(2, '0');
    const mm = String(eDate.getMonth() + 1).padStart(2, '0');
    const yyyy = eDate.getFullYear();
    const eDateOracle = `${dd}-${mm}-${yyyy}`;

    const gProfit = numVal(sum_gprofit);
    const gLoss = numVal(sum_gloss);
    const mGpl = gProfit - gLoss;

    let tradingDrAmt = 0;
    let tradingCrAmt = 0;
    let tradingDrLabel = '';
    let tradingCrLabel = '';
    if (mGpl > 0) {
      tradingCrAmt = mGpl;
      tradingCrLabel = 'GROSS PROFIT';
    } else if (mGpl < 0) {
      tradingDrAmt = Math.abs(mGpl);
      tradingDrLabel = 'GROSS LOSS';
    }

    const x0 = await runQuery(
      `
      SELECT
        NVL(B.SCHEDULE, 0) AS SCHEDULE,
        NVL(TRIM(C.NAME), '') AS SCH_NAME,
        TRIM(A.CODE) AS CODE,
        NVL(TRIM(B.NAME), '') AS NAME,
        SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(A.BIKRI, 'N') <> 'Y'
        AND NVL(A.COST_CODE, 'ZZZZZZ') <> 'CLOSNG'
        AND NVL(C.NO, 0) >= 16
      GROUP BY B.SCHEDULE, C.NAME, A.CODE, B.NAME
      HAVING ABS(SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0))) > 0.0001
      ORDER BY NVL(B.SCHEDULE, 0), C.NAME, A.CODE, B.NAME
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );

    const accounts = (x0 || []).map((r) => {
      const clBal = numVal(r.CLBAL);
      const drAmt = clBal > 0 ? clBal : 0;
      const crAmt = clBal < 0 ? Math.abs(clBal) : 0;
      const drDetail = clBal > 0 ? String(r.NAME || '').trim() : '';
      const crDetail = clBal < 0 ? String(r.NAME || '').trim() : '';
      return {
        SCHEDULE: numVal(r.SCHEDULE),
        SCH_NAME: String(r.SCH_NAME || '').trim(),
        CODE: String(r.CODE || '').trim(),
        NAME: String(r.NAME || '').trim(),
        CLBAL: clBal,
        DR_AMT: drAmt,
        CR_AMT: crAmt,
        DR_DETAIL: drDetail,
        CR_DETAIL: crDetail,
      };
    });

    const scheduleBlocks = [];
    let curKey = null;
    let buf = [];
    let subDr = 0;
    let subCr = 0;
    const flush = () => {
      if (!buf.length) return;
      scheduleBlocks.push({
        schedule: buf[0].SCHEDULE,
        schName: buf[0].SCH_NAME,
        lines: buf,
        scheduleTotalDr: subDr,
        scheduleTotalCr: subCr,
      });
      buf = [];
      subDr = 0;
      subCr = 0;
    };
    for (const row of accounts) {
      const sk = `${row.SCHEDULE}|${row.SCH_NAME}`;
      if (curKey !== null && sk !== curKey) {
        flush();
      }
      curKey = sk;
      buf.push(row);
      subDr += numVal(row.DR_AMT);
      subCr += numVal(row.CR_AMT);
    }
    flush();

    const sumAcctDr = accounts.reduce((s, r) => s + numVal(r.DR_AMT), 0);
    const sumAcctCr = accounts.reduce((s, r) => s + numVal(r.CR_AMT), 0);
    const totalLeftDr = tradingDrAmt + sumAcctDr;
    const totalIncomeWithoutGp = sumAcctCr;
    const rightWithTrading = sumAcctCr + tradingCrAmt;
    const net = rightWithTrading - totalLeftDr;
    const netLoss = net < 0 ? -net : 0;
    const netProfit = net > 0 ? net : 0;
    const grandTotal = net < 0 ? totalLeftDr : rightWithTrading;

    res.json({
      ok: true,
      as_on: eDateOracle,
      trading: {
        SCHEDULE: 12.1,
        SCH_NAME: 'TRADING',
        DR_AMT: tradingDrAmt,
        CR_AMT: tradingCrAmt,
        DR_DETAIL: tradingDrLabel,
        CR_DETAIL: tradingCrLabel,
        M_G_PL: mGpl,
        SUM_GPROFIT: gProfit,
        SUM_GLOSS: gLoss,
      },
      accounts,
      scheduleBlocks,
      totals: {
        totalLeftDr,
        totalIncomeWithoutGp,
        rightWithTrading,
        netLoss,
        netProfit,
        grandTotal,
      },
    });
  } catch (err) {
    console.error('❌ P&L error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Balance Sheet (VFP bsheet-style):
 * - Uses CLSTOCK total for schedule 7 adjustment
 * - Uses PLACT-equivalent closing (M_G_PL) from schedules >=16 plus trading gross diff
 * - Maps schedule by NORM_BAL/CORR_NO and builds liability/asset tree for NO < 12
 */
app.get('/api/balance-sheet', async (req, res) => {
  try {
    const { comp_code, comp_uid, edt, sum_gprofit, sum_gloss } = req.query;
    if (!comp_code || !comp_uid || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and edt are required' });
    }
    const eDate = parseDateOnly(edt);
    if (!eDate) {
      return res.status(400).json({ error: 'edt must be a valid date' });
    }
    const dd = String(eDate.getDate()).padStart(2, '0');
    const mm = String(eDate.getMonth() + 1).padStart(2, '0');
    const yyyy = eDate.getFullYear();
    const eDateOracle = `${dd}-${mm}-${yyyy}`;

    // G_CLAMT = SUM(CLSTOCK.AMOUNT)
    const clstockRows = await runQuery(
      `SELECT NVL(SUM(NVL(AMOUNT,0)),0) AS AMOUNT FROM CLSTOCK WHERE COMP_CODE = :comp_code`,
      { comp_code },
      comp_uid
    );
    const gClAmt = numVal(clstockRows?.[0]?.AMOUNT);

    // PLACT-equivalent M_G_PL:
    // raw trading diff = SUM(GPROFIT)-SUM(GLOSS)
    // schedules>=16 net = SUM(DR-CR)
    // M_G_PL (as used in bsheet) = SUM(PLACT.DR_AMT-PLACT.CR_AMT)
    //                             = schedule16Net - rawTradingDiff
    const rawTradingDiff = numVal(sum_gprofit) - numVal(sum_gloss);
    const plSchedRows = await runQuery(
      `
      SELECT NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(A.BIKRI,'N') <> 'Y'
        AND NVL(A.COST_CODE,'ZZZZZZ') <> 'CLOSNG'
        AND NVL(C.NO,0) >= 16
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );
    const sched16Net = numVal(plSchedRows?.[0]?.CLBAL);
    const mGPl = sched16Net - rawTradingDiff;

    // X1: code-wise CLBAL for NO<12 with corr/norm
    const codeRows = await runQuery(
      `
      SELECT
        TRIM(A.CODE) AS CODE,
        NVL(B.SCHEDULE,0) AS SCH_NO,
        MAX(NVL(C.CORR_NO,0)) AS CORR_NO,
        MAX(NVL(C.NORM_BAL,'')) AS NORM_BAL,
        NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(A.BIKRI,'Z') <> 'Y'
        AND NVL(A.COST_CODE,'ZZZZZZ') <> 'CLOSNG'
        AND NVL(C.NO,0) < 12
      GROUP BY A.CODE, B.SCHEDULE
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );

    const scheduleRows = await runQuery(
      `
      SELECT NVL(NO,0) AS NO, NVL(NAME,'') AS NAME, NVL(CORR_NO,0) AS CORR_NO, NVL(NORM_BAL,'') AS NORM_BAL
      FROM SCHEDULE
      WHERE COMP_CODE = :comp_code
      `,
      { comp_code },
      comp_uid
    );

    const scheduleMap = new Map();
    (scheduleRows || []).forEach((r) => {
      const no = numVal(r.NO);
      scheduleMap.set(no, {
        no,
        name: String(r.NAME || '').trim(),
        corrNo: numVal(r.CORR_NO),
        normBal: String(r.NORM_BAL || '').trim().toUpperCase(),
      });
    });

    // X2: remap sch_no using NORM_BAL/CORR_NO
    const x2 = (codeRows || []).map((r) => {
      const schNo = numVal(r.SCH_NO);
      const corrNo = numVal(r.CORR_NO);
      const normBal = String(r.NORM_BAL || '').trim().toUpperCase();
      const clBal = numVal(r.CLBAL);
      let eff = schNo;
      if (normBal) {
        if (normBal === 'D') {
          eff = clBal < 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
        } else {
          eff = clBal > 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
        }
      }
      return {
        code: String(r.CODE || '').trim(),
        schNo: eff,
        clBal,
      };
    });

    // X3: sum by effective schedule
    const x3Map = new Map();
    x2.forEach((r) => {
      const k = numVal(r.schNo);
      x3Map.set(k, numVal(x3Map.get(k)) + numVal(r.clBal));
    });

    // XX3/XX4 base tree for NO < 12
    const xx4 = Array.from(scheduleMap.values())
      .filter((s) => s.no < 12)
      .map((s) => {
        const no = numVal(s.no);
        const mainNo = no - Math.trunc(no) === 0 ? 0 : Math.trunc(no);
        const treeSchNo = no - Math.trunc(no) === 0 ? `${no.toFixed(2)}     ` : `${String(Math.trunc(no)).padStart(5, ' ')}${no.toFixed(2)}`;
        const schType = no >= 5 && no < 11 ? 'A' : 'L';
        return {
          schNo: no,
          mainNo,
          treeSchNo,
          schName: s.name,
          schType,
          clBal: numVal(x3Map.get(no)),
        };
      })
      .sort((a, b) => String(a.treeSchNo).localeCompare(String(b.treeSchNo)));

    // XX5: totals by main_no
    const xx5Map = new Map();
    xx4.forEach((r) => {
      if (numVal(r.mainNo) === 0) return;
      xx5Map.set(numVal(r.mainNo), numVal(xx5Map.get(numVal(r.mainNo))) + numVal(r.clBal));
    });

    // TREEBS
    const treeBs = [];
    xx4.forEach((a) => {
      const hasMainTotal = xx5Map.has(numVal(a.schNo));
      if (hasMainTotal) {
        const bClBal = numVal(xx5Map.get(numVal(a.schNo)));
        let outBal = bClBal;
        if (numVal(a.schNo) === 1) outBal = bClBal + numVal(mGPl);
        else if (numVal(a.schNo) === 7) outBal = bClBal + numVal(gClAmt);
        let outName = a.schName;
        if (numVal(a.schNo) === 1) outName = `${String(a.schName || '').trim()} ${numVal(mGPl).toFixed(2)}`;
        treeBs.push({
          schNo: a.schNo,
          mainNo: a.mainNo,
          schName: outName,
          treeSchNo: a.treeSchNo,
          schType: a.schType,
          clBal: outBal,
          level: 1,
        });
      } else {
        treeBs.push({
          schNo: a.schNo,
          mainNo: a.mainNo,
          schName: a.schName,
          treeSchNo: a.treeSchNo,
          schType: a.schType,
          clBal: numVal(a.clBal),
          level: numVal(a.mainNo) === 0 ? 1 : 2,
        });
      }
    });

    // Build liabilities + assets lists (BS cursor-style)
    const liabilities = [];
    const assets = [];
    let insertedProfitLoss = false;
    treeBs.forEach((r) => {
      if (r.schType === 'L') {
        if (numVal(r.mainNo) === 0) {
          liabilities.push({
            schNo: numVal(r.schNo),
            detail: String(r.schName || ''),
            amount: 0,
            grandAmount: numVal(r.clBal) * -1,
            level: 1,
          });
          if (Math.trunc(numVal(r.schNo)) === 1 && !insertedProfitLoss) {
            liabilities.push({
              schNo: 1.1,
              detail: '  PROFIT/LOSS',
              amount: numVal(mGPl),
              grandAmount: 0,
              level: 2,
            });
            insertedProfitLoss = true;
          }
        } else {
          liabilities.push({
            schNo: numVal(r.schNo),
            detail: `  ${String(r.schName || '')}`,
            amount: numVal(r.clBal) * -1,
            grandAmount: 0,
            level: 2,
          });
        }
      } else if (r.schType === 'A') {
        if (numVal(r.mainNo) === 0) {
          assets.push({
            schNo: numVal(r.schNo),
            detail: String(r.schName || ''),
            amount: 0,
            grandAmount: numVal(r.clBal),
            level: 1,
          });
        } else {
          assets.push({
            schNo: numVal(r.schNo),
            detail: `  ${String(r.schName || '')}`,
            amount: numVal(r.clBal),
            grandAmount: 0,
            level: 2,
          });
        }
      }
    });

    const sortBsSide = (arr) =>
      (arr || []).sort((a, b) => {
        const sa = numVal(a?.schNo);
        const sb = numVal(b?.schNo);
        const ma = Math.trunc(sa);
        const mb = Math.trunc(sb);
        if (ma !== mb) return ma - mb;
        const la = numVal(a?.level) === 1 ? 0 : 1;
        const lb = numVal(b?.level) === 1 ? 0 : 1;
        if (la !== lb) return la - lb;
        return sa - sb;
      });

    // Keep main schedule (x.00) first, then sub schedules (x.10, x.20 ...)
    sortBsSide(liabilities);
    sortBsSide(assets);

    const rowCount = Math.max(liabilities.length, assets.length);
    const rows = [];
    for (let i = 0; i < rowCount; i += 1) {
      const l = liabilities[i] || {};
      const a = assets[i] || {};
      rows.push({
        L_SCH_NO: numVal(l.schNo),
        L_DETAIL: String(l.detail || ''),
        L_AMOUNT: numVal(l.amount),
        CR_AMT: numVal(l.grandAmount),
        L_LEVEL: numVal(l.level),
        A_SCH_NO: numVal(a.schNo),
        A_DETAIL: String(a.detail || ''),
        A_AMOUNT: numVal(a.amount),
        DR_AMT: numVal(a.grandAmount),
        A_LEVEL: numVal(a.level),
      });
    }

    const liabilitiesTotal = rows.reduce((s, r) => s + numVal(r.CR_AMT), 0);
    const assetsTotal = rows.reduce((s, r) => s + numVal(r.DR_AMT), 0);
    res.json({
      ok: true,
      as_on: eDateOracle,
      rows,
      totals: {
        liabilitiesTotal,
        assetsTotal,
      },
      meta: {
        g_clamt: gClAmt,
        m_g_pl: mGPl,
      },
    });
  } catch (err) {
    console.error('❌ Balance Sheet error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Balance Sheet drilldown: accounts under one effective sub-schedule (e.g. 1.10)
 * using same NORM_BAL/CORR_NO remap logic as /api/balance-sheet.
 */
app.get('/api/balance-sheet-schedule-accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid, edt, sch_no } = req.query;
    if (!comp_code || !comp_uid || !edt || sch_no == null || sch_no === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, edt, sch_no are required' });
    }
    const eDate = parseDateOnly(edt);
    if (!eDate) return res.status(400).json({ error: 'edt must be a valid date' });
    const targetSch = numVal(sch_no);
    if (!targetSch) return res.status(400).json({ error: 'sch_no must be numeric' });
    const dd = String(eDate.getDate()).padStart(2, '0');
    const mm = String(eDate.getMonth() + 1).padStart(2, '0');
    const yyyy = eDate.getFullYear();
    const eDateOracle = `${dd}-${mm}-${yyyy}`;

    const codeRows = await runQuery(
      `
      SELECT
        TRIM(A.CODE) AS CODE,
        NVL(TRIM(B.NAME),'') AS NAME,
        NVL(B.SCHEDULE,0) AS SCH_NO,
        MAX(NVL(C.CORR_NO,0)) AS CORR_NO,
        MAX(NVL(C.NORM_BAL,'')) AS NORM_BAL,
        NVL(SUM(NVL(A.DR_AMT,0)-NVL(A.CR_AMT,0)),0) AS CLBAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND NVL(A.BIKRI,'Z') <> 'Y'
        AND NVL(A.COST_CODE,'ZZZZZZ') <> 'CLOSNG'
        AND NVL(C.NO,0) < 12
      GROUP BY A.CODE, B.NAME, B.SCHEDULE
      `,
      { comp_code, e_date: eDateOracle },
      comp_uid
    );

    const rows = (codeRows || [])
      .map((r) => {
        const schNo = numVal(r.SCH_NO);
        const corrNo = numVal(r.CORR_NO);
        const normBal = String(r.NORM_BAL || '').trim().toUpperCase();
        const clBal = numVal(r.CLBAL);
        let effSch = schNo;
        if (normBal) {
          if (normBal === 'D') effSch = clBal < 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
          else effSch = clBal > 0 ? (corrNo !== 0 ? corrNo : schNo) : schNo;
        }
        return {
          CODE: String(r.CODE || '').trim(),
          NAME: String(r.NAME || '').trim(),
          SCH_NO: schNo,
          EFF_SCH_NO: effSch,
          CLBAL: clBal,
          DR_AMT: clBal > 0 ? clBal : 0,
          CR_AMT: clBal < 0 ? Math.abs(clBal) : 0,
        };
      })
      .filter((r) => Math.abs(numVal(r.EFF_SCH_NO) - targetSch) < 0.0001 && Math.abs(numVal(r.CLBAL)) > 0.0001)
      .sort((a, b) => String(a.NAME || '').localeCompare(String(b.NAME || '')) || String(a.CODE || '').localeCompare(String(b.CODE || '')));

    res.json({ ok: true, sch_no: targetSch, rows });
  } catch (err) {
    console.error('❌ Balance Sheet schedule accounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trading-ac/manual-save', async (req, res) => {
  try {
    const { comp_code, comp_uid, rows } = req.body || {};
    if (!comp_code || !comp_uid) return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    const list = Array.isArray(rows) ? rows : [];
    for (const r of list) {
      const code = String(r?.code ?? r?.CODE ?? '').trim();
      if (!code) continue;
      const amount = Number(r?.amount ?? r?.AMOUNT ?? 0);
      const shortage = Number(r?.shortage ?? r?.SHORTAGE ?? 0);
      let master = await runQuery(
        `SELECT NVL(NAME,'') AS NAME, NVL(OP_BALANCE,0) AS OP_BALANCE FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE)=TRIM(:code)`,
        { comp_code, code },
        comp_uid
      );
      if (!Array.isArray(master) || master.length === 0) {
        master = await runQuery(
          `SELECT NVL(NAME,'') AS NAME, NVL(OP_BALANCE,0) AS OP_BALANCE FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE)=TRIM(:code)`,
          { comp_code, code },
          null,
          { suppressDbErrorLog: true }
        );
      }
      const m = (master || [])[0] || {};
      const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
      const compYear = Number(compdet?.COMP_YEAR ?? compdet?.comp_year ?? 0) || 0;
      await runQuery(
        `
        MERGE INTO CLSTOCK C
        USING (
          SELECT :comp_code AS COMP_CODE, :comp_year AS COMP_YEAR, :code AS CODE, :name AS NAME, :op_balance AS OP_BALANCE,
                 :amount AS AMOUNT, :shortage AS SHORTAGE
          FROM DUAL
        ) X
        ON (C.COMP_CODE = X.COMP_CODE AND TRIM(C.CODE) = TRIM(X.CODE))
        WHEN MATCHED THEN
          UPDATE SET C.AMOUNT = X.AMOUNT, C.SHORTAGE = X.SHORTAGE, C.NAME = X.NAME, C.OP_BALANCE = X.OP_BALANCE
        WHEN NOT MATCHED THEN
          INSERT (COMP_CODE, COMP_YEAR, CODE, NAME, OP_BALANCE, AMOUNT, SHORTAGE)
          VALUES (X.COMP_CODE, X.COMP_YEAR, X.CODE, X.NAME, X.OP_BALANCE, X.AMOUNT, X.SHORTAGE)
        `,
        {
          comp_code,
          comp_year: compYear,
          code,
          name: String(m.NAME || ''),
          op_balance: Number(m.OP_BALANCE) || 0,
          amount: Number.isFinite(amount) ? amount : 0,
          shortage: Number.isFinite(shortage) ? shortage : 0,
        },
        comp_uid,
        { autoCommit: true }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Trading manual save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac-ledger', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, edt, mcb } = req.query;
    if (!comp_code || !comp_uid || !code || !edt) {
      return res.status(400).json({ error: 'comp_code, comp_uid, code, edt are required' });
    }
    const compdet = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!compdet) return res.status(400).json({ error: 'Unable to resolve compdet row' });
    const sDate = parseDateOnly(compdet.COMP_S_DT ?? compdet.comp_s_dt);
    const eDate = parseDateOnly(edt);
    if (!sDate || !eDate) return res.status(400).json({ error: 'Invalid dates' });

    const saleTypes = String(mcb || 'C').trim().toUpperCase() === 'C' ? ['SL', 'SE', 'CH', 'CN'] : ['SL', 'SE', 'CN'];

    const [purchaseRows, saleRows, ledgerRows] = await Promise.all([
      runQuery(
        `
        SELECT 'PUR' AS SRC, TRIM(TYPE) AS VR_TYPE, TO_CHAR(TRUNC(R_DATE), 'YYYY-MM-DD') AS VR_DATE, R_NO AS VR_NO, TYPE,
               SUM(CASE WHEN TYPE='DN' THEN NVL(QNTY,0)*-1 ELSE NVL(QNTY,0) END) AS R_QNTY,
               SUM(CASE WHEN TYPE='DN' THEN NVL(WEIGHT,0)*-1 ELSE NVL(WEIGHT,0) END) AS R_WEIGHT,
               0 AS DR_AMOUNT, 0 AS S_QNTY, 0 AS S_WEIGHT, 0 AS CR_AMOUNT
        FROM PURCHASE
        WHERE COMP_CODE = :comp_code
          AND TRIM(PUR_CODE) = TRIM(:code)
          AND R_DATE >= :s_date
          AND R_DATE <= :e_date
          AND TYPE IN ('PU','DN','PB')
        GROUP BY TRUNC(R_DATE), R_NO, TYPE
        `,
        { comp_code, code, s_date: sDate, e_date: eDate },
        comp_uid
      ),
      runQuery(
        `
        SELECT 'SAL' AS SRC,
               TRIM(TYPE) AS VR_TYPE,
               TO_CHAR(TRUNC(BILL_DATE), 'YYYY-MM-DD') AS VR_DATE,
               BILL_NO AS VR_NO,
               TRIM(NVL(B_TYPE,'N')) AS TYPE,
               0 AS R_QNTY,
               0 AS R_WEIGHT,
               0 AS DR_AMOUNT,
               SUM(CASE WHEN TRIM(TYPE)='CN' THEN NVL(QNTY,0)*-1 ELSE NVL(QNTY,0) END) AS S_QNTY,
               SUM(
                 CASE
                   WHEN TRIM(TYPE)='CN'
                     THEN (NVL(WEIGHT,0) - (NVL(DANE_WGT,0)+NVL(PAPLOO3,0))) * -1
                   ELSE (NVL(WEIGHT,0) - (NVL(DANE_WGT,0)+NVL(PAPLOO3,0)))
                 END
               ) AS S_WEIGHT,
               SUM(CASE WHEN TRIM(TYPE)='CN' THEN NVL(BILL_AMT,0)*-1 ELSE NVL(BILL_AMT,0) END) AS CR_AMOUNT
        FROM SALE
        WHERE COMP_CODE = :comp_code
          AND TRIM(SUP_CODE) = TRIM(:code)
          AND BILL_DATE >= :s_date
          AND BILL_DATE <= :e_date
          AND TRIM(TYPE) IN (${saleTypes.map((_, i) => `:st${i}`).join(',')})
        GROUP BY TRUNC(BILL_DATE), BILL_NO, TRIM(TYPE), TRIM(NVL(B_TYPE,'N'))
        `,
        Object.assign({ comp_code, code, s_date: sDate, e_date: eDate }, ...saleTypes.map((t, i) => ({ [`st${i}`]: t }))),
        comp_uid
      ),
      runQuery(
        `
        SELECT 'LED' AS SRC, TRIM(VR_TYPE) AS VR_TYPE, TO_CHAR(TRUNC(VR_DATE), 'YYYY-MM-DD') AS VR_DATE, VR_NO, TYPE,
               0 AS R_QNTY, 0 AS R_WEIGHT,
               SUM(NVL(DR_AMT,0)) AS DR_AMOUNT,
               0 AS S_QNTY, 0 AS S_WEIGHT,
               SUM(NVL(CR_AMT,0)) AS CR_AMOUNT
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND TRIM(CODE) = TRIM(:code)
          AND VR_DATE >= :s_date
          AND VR_DATE <= :e_date
          AND NVL(BIKRI,'N') <> 'Y'
        GROUP BY TRUNC(VR_DATE), VR_NO, VR_TYPE, TYPE
        `,
        { comp_code, code, s_date: sDate, e_date: eDate },
        comp_uid
      ),
    ]);

    const allRows = [...(purchaseRows || []), ...(saleRows || []), ...(ledgerRows || [])]
      .map((r) => ({
        VR_TYPE: String(r.VR_TYPE || '').trim(),
        VR_DATE: r.VR_DATE,
        VR_NO: Number(r.VR_NO) || 0,
        TYPE: String(r.TYPE || '').trim(),
        R_QNTY: numVal(r.R_QNTY),
        R_WEIGHT: numVal(r.R_WEIGHT),
        DR_AMOUNT: numVal(r.DR_AMOUNT),
        S_QNTY: numVal(r.S_QNTY),
        S_WEIGHT: numVal(r.S_WEIGHT),
        CR_AMOUNT: numVal(r.CR_AMOUNT),
      }))
      .sort((a, b) => {
        const da = parseDateOnly(a.VR_DATE)?.getTime() || 0;
        const db = parseDateOnly(b.VR_DATE)?.getTime() || 0;
        if (da !== db) return da - db;
        if (a.VR_NO !== b.VR_NO) return a.VR_NO - b.VR_NO;
        return String(a.VR_TYPE).localeCompare(String(b.VR_TYPE));
      });

    let balQty = 0;
    let balWeight = 0;
    let clBalance = 0;
    const rows = allRows.map((r) => {
      balQty += numVal(r.R_QNTY) - numVal(r.S_QNTY);
      balWeight += numVal(r.R_WEIGHT) - numVal(r.S_WEIGHT);
      clBalance += numVal(r.DR_AMOUNT) - numVal(r.CR_AMOUNT);
      return {
        ...r,
        BAL_QNTY: balQty,
        BAL_WEIGHT: balWeight,
        CL_BALANCE: clBalance,
      };
    });

    const totals = rows.reduce(
      (a, r) => ({
        R_QNTY: a.R_QNTY + numVal(r.R_QNTY),
        R_WEIGHT: a.R_WEIGHT + numVal(r.R_WEIGHT),
        DR_AMOUNT: a.DR_AMOUNT + numVal(r.DR_AMOUNT),
        S_QNTY: a.S_QNTY + numVal(r.S_QNTY),
        S_WEIGHT: a.S_WEIGHT + numVal(r.S_WEIGHT),
        CR_AMOUNT: a.CR_AMOUNT + numVal(r.CR_AMOUNT),
        BAL_QNTY: numVal(r.BAL_QNTY),
        BAL_WEIGHT: numVal(r.BAL_WEIGHT),
        CL_BALANCE: numVal(r.CL_BALANCE),
      }),
      { R_QNTY: 0, R_WEIGHT: 0, DR_AMOUNT: 0, S_QNTY: 0, S_WEIGHT: 0, CR_AMOUNT: 0, BAL_QNTY: 0, BAL_WEIGHT: 0, CL_BALANCE: 0 }
    );

    res.json({ ok: true, rows, totals });
  } catch (err) {
    console.error('❌ Trading ledger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trading-ac-ledger-entry-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, vr_type, vr_date, vr_no, type } = req.query;
    if (!comp_code || !comp_uid || !vr_type || !vr_date || vr_no == null || vr_no === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, vr_type, vr_date, vr_no are required' });
    }
    const vrType = String(vr_type || '').trim().toUpperCase();
    const vrNoNum = Number(vr_no);
    if (!Number.isFinite(vrNoNum)) {
      return res.status(400).json({ error: 'vr_no must be numeric' });
    }
    const vrDateIso = String(vr_date || '').trim();
    const typeVal = String(type || '').trim();
    const saleTypes = ['SL', 'SE', 'CH', 'CN'];
    const purchaseTypes = ['PU', 'DN', 'DX', 'CX', 'PB'];

    if (saleTypes.includes(vrType)) {
      const saleSql = `
        SELECT
          TRIM(A.TYPE) AS TYPE,
          TO_CHAR(TRUNC(A.BILL_DATE), 'YYYY-MM-DD') AS VR_DATE,
          A.BILL_NO AS VR_NO,
          A.TRN_NO,
          TRIM(A.CODE) AS CODE,
          TRIM(NVL(B.NAME,'')) AS NAME,
          TRIM(NVL(B.CITY,'')) AS CITY,
          TRIM(A.SUP_CODE) AS SUP_CODE,
          TRIM(NVL(D.NAME,'')) AS SUP_NAME,
          TRIM(A.ITEM_CODE) AS ITEM_CODE,
          TRIM(NVL(C.ITEM_NAME,'')) AS ITEM_NAME,
          NVL(A.QNTY,0) AS QNTY,
          NVL(A.WEIGHT,0) AS WEIGHT,
          NVL(A.RATE,0) AS RATE,
          NVL(A.AMOUNT,0) AS AMOUNT,
          NVL(A.TAXABLE,0) AS TAXABLE
        FROM SALE A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
        LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND NVL(A.SUP_CODE, A.CODE) = D.CODE
        WHERE A.COMP_CODE = :comp_code
          AND TRIM(A.TYPE) = :vr_type
          AND TRUNC(A.BILL_DATE) = TO_DATE(:vr_date, 'YYYY-MM-DD')
          AND A.BILL_NO = :vr_no
          AND TRIM(NVL(A.B_TYPE,'N')) = :type
        ORDER BY A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO
      `;
      const rows = await runQuery(
        saleSql,
        {
          comp_code,
          vr_type: vrType,
          vr_date: vrDateIso,
          vr_no: vrNoNum,
          type: typeVal || 'N',
        },
        comp_uid
      );
      return res.json({ ok: true, rows: rows || [] });
    }

    if (purchaseTypes.includes(vrType)) {
      const purchaseSql = `
        SELECT
          TRIM(A.TYPE) AS TYPE,
          TO_CHAR(TRUNC(A.R_DATE), 'YYYY-MM-DD') AS VR_DATE,
          A.R_NO AS VR_NO,
          A.TRN_NO,
          TRIM(A.CODE) AS CODE,
          TRIM(NVL(B.NAME,'')) AS NAME,
          TRIM(NVL(B.CITY,'')) AS CITY,
          TRIM(NVL(A.P_CODE, A.SUP_CODE)) AS SUP_CODE,
          TRIM(NVL(D.NAME,'')) AS SUP_NAME,
          TRIM(A.ITEM_CODE) AS ITEM_CODE,
          TRIM(NVL(C.ITEM_NAME,'')) AS ITEM_NAME,
          NVL(A.QNTY,0) AS QNTY,
          NVL(A.WEIGHT,0) AS WEIGHT,
          NVL(A.RATE,0) AS RATE,
          NVL(A.AMOUNT,0) AS AMOUNT,
          NVL(A.TAXABLE,0) AS TAXABLE
        FROM PURCHASE A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
        LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND NVL(A.SUP_CODE, A.P_CODE) = D.CODE
        WHERE A.COMP_CODE = :comp_code
          AND TRIM(A.TYPE) = :vr_type
          AND TRUNC(A.R_DATE) = TO_DATE(:vr_date, 'YYYY-MM-DD')
          AND A.R_NO = :vr_no
        ORDER BY A.TYPE, A.R_DATE, A.R_NO, A.TRN_NO
      `;
      const rows = await runQuery(
        purchaseSql,
        {
          comp_code,
          vr_type: vrType,
          vr_date: vrDateIso,
          vr_no: vrNoNum,
        },
        comp_uid
      );
      return res.json({ ok: true, rows: rows || [] });
    }

    return res.json({ ok: true, rows: [] });
  } catch (err) {
    console.error('❌ Trading ledger entry detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function gstrNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function gstrTxt(v) {
  return String(v ?? '').trim();
}
function gstrHas(v) {
  return gstrTxt(v) !== '';
}
function gstrRate(r) {
  return +(gstrNum(r).toFixed(2));
}
function gstrDt(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dd}-${mon[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`;
}
function fmtInvNo(row, opts) {
  const saleInv = gstrTxt(row.SALE_INV_NO ?? row.sale_inv_no);
  const billNoRaw = String(row.BILL_NO ?? row.bill_no ?? '').trim();
  const bType = gstrTxt(row.B_TYPE ?? row.b_type);
  let base = saleInv || billNoRaw;
  if (opts.bTypeYn === 'Y' && bType) base += bType;
  if (opts.zeroBeforeBillNo === 'Y') {
    const onlyNum = String(row.BILL_NO ?? '').replace(/\D/g, '');
    if (onlyNum) base = onlyNum.padStart(opts.billNoLength, '0') + (opts.bTypeYn === 'Y' && bType ? bType : '');
  }
  return base;
}
function keyOf(...parts) {
  return parts.map((p) => gstrTxt(p)).join('|');
}
function gstrRound2(v) {
  return +gstrNum(v).toFixed(2);
}
function gstrParseDispDate(s) {
  const t = gstrTxt(s);
  if (!t) return 0;
  const m = t.match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return 0;
  const monMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const dd = Number(m[1]);
  const mm = monMap[m[2]] ?? 0;
  const yy = Number(m[3]);
  const yyyy = 2000 + yy;
  return new Date(yyyy, mm, dd).getTime();
}
function gstrRoundAmountColumns(rows) {
  const amtRx = /(AMT|AMOUNT|VALUE|TAXABLE|TAX|IGST|CGST|SGST|CESS|FREIGHT|LABOUR|TOTAL)/i;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const out = { ...row };
    Object.keys(out).forEach((k) => {
      if (!amtRx.test(k)) return;
      if (typeof out[k] !== 'number') return;
      out[k] = gstrRound2(out[k]);
    });
    return out;
  });
}

app.get('/api/gstr1', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      btype_yn,
      zero_before_bill_no,
      bill_no_length,
      btob_yn,
      btocl_yn,
      btocs_yn,
      b2cl_limit_mode,
    } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const opts = {
      bTypeYn: String(btype_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      zeroBeforeBillNo: String(zero_before_bill_no || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      billNoLength: Math.max(1, Math.min(12, Number(bill_no_length) || 6)),
      btobYn: String(btob_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      btoclYn: String(btocl_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      btocsYn: String(btocs_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      b2clLimit: String(b2cl_limit_mode || '1').trim() === '2' ? 100000 : 250000,
    };

    const saleSql = `
      SELECT
        A.TYPE, A.B_TYPE, A.BILL_DATE, A.BILL_NO, A.SALE_INV_NO,
        A.SB_NO, A.SB_DATE, A.SB_TYPE,
        A.CODE, M.NAME, M.GST_NO, M.L_C, M.STATE_CODE, M.STATE,
        I.HSN_CODE, I.ITEM_NAME, I.HSN_UNIT,
        A.QNTY, A.WEIGHT,
        A.INPUT_YN, CAST(NULL AS VARCHAR2(1)) AS SL_C, CAST(NULL AS NUMBER) AS SCHEDULE,
        A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT,
        A.CGST_PER, A.SGST_PER, A.IGST_PER,
        A.BILL_AMT, A.REMARKS, A.REMARKS1, A.V_DATE
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.CODE = M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))`;
    const purchaseSql = `
      SELECT
        A.TYPE, A.S_P, A.R_DATE, A.R_NO, A.BILL_DATE, A.BILL_NO, CAST(NULL AS VARCHAR2(1)) AS B_TYPE,
        A.CODE, M.NAME, M.GST_NO, M.L_C, M.STATE_CODE, M.STATE,
        I.HSN_CODE, I.ITEM_NAME, I.HSN_UNIT,
        A.QNTY, A.WEIGHT, A.INPUT_YN, CAST(NULL AS VARCHAR2(5)) AS TAX_FORM, A.REMARKS, A.SHOW_IN_GSTR, A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT,
        A.CGST_PER, A.SGST_PER, A.IGST_PER
      FROM PURCHASE A
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.CODE = M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.R_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))`;
    const binds = { comp_code, s_date, e_date };
    const saleRows = (await runQuery(saleSql, binds, comp_uid)) || [];
    const purRows = (await runQuery(purchaseSql, binds, comp_uid)) || [];

    const billTotals = new Map();
    saleRows.forEach((r) => {
      const k = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE);
      const inv = gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      billTotals.set(k, gstrNum(billTotals.get(k)) + inv);
    });

    const outwardSet = new Set(['SL', 'ST', 'SR', 'GT', 'GR', 'SX']);
    const outwardSetCn = new Set(['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN', 'GN', 'CX']);
    const b2b = [];
    const b2bMap = new Map();
    const b2bBillTaxableMap = new Map();
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!outwardSet.has(tp)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const bk = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE);
      b2bBillTaxableMap.set(bk, gstrNum(b2bBillTaxableMap.get(bk)) + gstrNum(r.TAXABLE));
    });
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!outwardSet.has(tp)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const invNo = gstrTxt(r.SALE_INV_NO);
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.GST_NO, invNo, r.B_TYPE, r.BILL_DATE, rate);
      const item = b2bMap.get(k) || {
        GSTIN: gstrTxt(r.GST_NO),
        NAME: gstrTxt(r.NAME),
        INVOICE_NO: invNo,
        INVOICE_DATE: gstrDt(r.BILL_DATE),
        INVOICE_VALUE: 0,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        REVERSE_CHARGE: tp === 'RC' ? 'Y' : 'N',
        APPLICABLE_TAX: null,
        INVOICE_TYPE: 'Regular B2B',
        E_COMMERCE_GSTIN: '',
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS_AMT: 0,
        _TYPE: tp,
        _BILL_NO: gstrTxt(r.BILL_NO),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      item.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      item.INVOICE_VALUE = gstrNum(billTotals.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE)));
      item.TAXABLE_VALUE = gstrNum(b2bBillTaxableMap.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));
      b2bMap.set(k, item);
    });
    b2b.push(...Array.from(b2bMap.values()));
    b2b.sort((a, b) => {
      const d = gstrParseDispDate(a.INVOICE_DATE) - gstrParseDispDate(b.INVOICE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.INVOICE_NO).localeCompare(gstrTxt(b.INVOICE_NO), 'en', { numeric: true, sensitivity: 'base' });
    });

    const b2cl = [];
    const b2clMap = new Map();
    const b2clBillTotals = new Map();
    const b2clBillTaxable = new Map();
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!outwardSetCn.has(tp)) return;
      if (gstrHas(r.GST_NO)) return;
      const sign = tp === 'CN' ? -1 : 1;
      const billKey = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE);
      const lineInv = gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      b2clBillTotals.set(billKey, gstrNum(b2clBillTotals.get(billKey)) + sign * lineInv);
      b2clBillTaxable.set(billKey, gstrNum(b2clBillTaxable.get(billKey)) + sign * gstrNum(r.TAXABLE));
    });
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!outwardSetCn.has(tp)) return;
      if (gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btoclYn !== 'Y' && taxTotal === 0) return;
      const billAmt = gstrNum(r.BILL_AMT);
      if (!(billAmt > opts.b2clLimit)) return;
      const invNo = gstrTxt(r.SALE_INV_NO) || gstrTxt(r.BILL_NO);
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(invNo, r.BILL_DATE, rate, r.TYPE, r.B_TYPE);
      const sign = tp === 'CN' ? -1 : 1;
      const it = b2clMap.get(k) || {
        INVOICE_NO: invNo,
        INVOICE_DATE: gstrDt(r.BILL_DATE),
        INVOICE_VALUE: 0,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        _TYPE: tp,
        _BILL_NO: gstrTxt(r.BILL_NO),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.INVOICE_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
      it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
      it.INVOICE_VALUE = gstrNum(b2clBillTotals.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));
      it.TAXABLE_VALUE = gstrNum(b2clBillTaxable.get(keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));
      b2clMap.set(k, it);
    });
    b2cl.push(...Array.from(b2clMap.values()));
    const b2clInvoiceWise = b2cl.map((r) => ({
      INVOICE_NO: gstrTxt(r.INVOICE_NO),
      INVOICE_DATE: gstrTxt(r.INVOICE_DATE),
      INVOICE_VALUE: gstrNum(r.INVOICE_VALUE),
      PLACE_OF_SUPPLY: gstrTxt(r.PLACE_OF_SUPPLY),
      APPLICABLE_TAX: 0,
      RATE: gstrNum(r.RATE),
      TAXABLE_VALUE: gstrNum(r.TAXABLE_VALUE),
      CESS_AMT: 0,
      E_COMMERCE_GSTIN: '',
      _TYPE: gstrTxt(r._TYPE),
      _BILL_NO: gstrTxt(r._BILL_NO),
      _B_TYPE: gstrTxt(r._B_TYPE),
    }));
    b2cl.length = 0;
    b2cl.push(...b2clInvoiceWise);
    b2cl.sort((a, b) => {
      const d = gstrParseDispDate(a.INVOICE_DATE) - gstrParseDispDate(b.INVOICE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.INVOICE_NO).localeCompare(gstrTxt(b.INVOICE_NO), 'en', { numeric: true, sensitivity: 'base' });
    });

    // --------- B2CS (VFP X1/X2/X3/X4/X5/X6/X7 equivalent) ---------
    const mdetRows = saleRows.filter((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!outwardSetCn.has(tp)) return false;
      if (gstrHas(r.GST_NO)) return false;
      if (opts.btocsYn !== 'Y') {
        const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
        if (taxTotal === 0) return false;
      }
      return true;
    });

    // X1: grouped invoice/rate rows
    const x1Map = new Map();
    mdetRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      const sign = ['CN', 'GN', 'CX'].includes(tp) ? -1 : 1;
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const invNo = gstrTxt(r.BILL_NO);
      const invDt = gstrDt(r.BILL_DATE);
      const k = keyOf(invNo, invDt, rate, tp, r.B_TYPE);
      const it = x1Map.get(k) || {
        INVOICE_NO: invNo,
        INVOICE_DATE: invDt,
        INVOICE_VALUE: 0,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        RATE: rate,
        TAXABLE_VALUE: 0,
        TYPE: tp,
        B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.INVOICE_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
      it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
      x1Map.set(k, it);
    });
    const x1 = Array.from(x1Map.values());

    // X2: grouped by bill + code + l_c (and tax condition when btocsYn != 'Y')
    const x2Map = new Map();
    mdetRows.forEach((r) => {
      const k = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, gstrDt(r.BILL_DATE), r.CODE, r.NAME, r.GST_NO, r.L_C);
      const it = x2Map.get(k) || {
        TYPE: gstrTxt(r.TYPE).toUpperCase(),
        BILL_NO: gstrTxt(r.BILL_NO),
        B_TYPE: gstrTxt(r.B_TYPE),
        BILL_DATE: gstrDt(r.BILL_DATE),
        CODE: gstrTxt(r.CODE),
        NAME: gstrTxt(r.NAME),
        GST_NO: gstrTxt(r.GST_NO),
        L_C: gstrTxt(r.L_C).toUpperCase(),
        BILL_AMT: 0,
        TAX_TOTAL: 0,
      };
      it.BILL_AMT += gstrNum(r.BILL_AMT);
      it.TAX_TOTAL += gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      x2Map.set(k, it);
    });
    let x2 = Array.from(x2Map.values());
    if (opts.btocsYn === 'Y') {
      x2 = x2.filter((r) => gstrNum(r.BILL_AMT) < opts.b2clLimit);
    } else {
      x2 = x2.filter((r) => gstrNum(r.TAX_TOTAL) !== 0);
    }

    // X3 + X4 => X5
    const x3 = x2.filter((r) => r.L_C === 'C' && gstrNum(r.BILL_AMT) <= opts.b2clLimit);
    const x4 = x2.filter((r) => r.L_C === 'L');
    const x5 = [...x3, ...x4];
    const x5Keys = new Set(x5.map((r) => keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));

    // X6: pick X1 entries that EXIST in X5 (type,bill_no,b_type,bill_date)
    const x6 = x1.filter((r) => x5Keys.has(keyOf(r.TYPE, r.INVOICE_NO, r.B_TYPE, r.INVOICE_DATE)));

    // X7: final b2cs grouped by place + rate
    const b2csMap = new Map();
    x6.forEach((r) => {
      const k = keyOf(r.PLACE_OF_SUPPLY, r.RATE);
      const it = b2csMap.get(k) || {
        TYPE: 'OE',
        PLACE_OF_SUPPLY: gstrTxt(r.PLACE_OF_SUPPLY),
        APPLICABLE_TAX: 0,
        RATE: gstrRate(r.RATE),
        TAXABLE_VALUE: 0,
      };
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE_VALUE);
      b2csMap.set(k, it);
    });
    const b2cs = Array.from(b2csMap.values());

    const cdnrMap = new Map();
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!['CN', 'GN', 'CX'].includes(tp)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const noteType = tp === 'CX' ? 'D' : 'C';
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.GST_NO, r.BILL_NO, r.BILL_DATE, noteType, rate);
      const it = cdnrMap.get(k) || {
        GSTIN: gstrTxt(r.GST_NO),
        NAME: gstrTxt(r.NAME),
        NOTE_NUMBER: gstrTxt(r.BILL_NO),
        NOTE_DATE: gstrDt(r.BILL_DATE),
        DOCUMENT_TYPE: noteType,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        REV_CHARGE: 'N',
        NOTE_SUPPLY_TYPE: 'Regular',
        VOUCHER_VALUE: 0,
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS: 0,
        _SOURCE: 'SALE',
        _TYPE: tp,
        _NOTE_NO: gstrTxt(r.BILL_NO),
        _NOTE_DATE: gstrDt(r.BILL_DATE),
        _B_TYPE: gstrTxt(r.SB_TYPE || r.B_TYPE),
      };
      it.VOUCHER_VALUE += gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      cdnrMap.set(k, it);
    });
    purRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!['DN', 'DX', 'CX'].includes(tp)) return;
      if (!gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const noteType = tp === 'CX' ? 'C' : 'D';
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.GST_NO, r.R_NO, r.R_DATE, noteType, rate);
      const it = cdnrMap.get(k) || {
        GSTIN: gstrTxt(r.GST_NO),
        NAME: gstrTxt(r.NAME),
        NOTE_NUMBER: gstrTxt(r.R_NO),
        NOTE_DATE: gstrDt(r.R_DATE),
        DOCUMENT_TYPE: noteType,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        REV_CHARGE: 'N',
        NOTE_SUPPLY_TYPE: 'Regular',
        VOUCHER_VALUE: 0,
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS: 0,
        _SOURCE: 'PURCHASE',
        _TYPE: tp,
        _NOTE_NO: gstrTxt(r.R_NO),
        _NOTE_DATE: gstrDt(r.R_DATE),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.VOUCHER_VALUE += gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      cdnrMap.set(k, it);
    });
    const cdnr = Array.from(cdnrMap.values());
    cdnr.sort((a, b) => {
      const d = gstrParseDispDate(a.NOTE_DATE) - gstrParseDispDate(b.NOTE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.NOTE_NUMBER).localeCompare(gstrTxt(b.NOTE_NUMBER), 'en', { numeric: true, sensitivity: 'base' });
    });

    const cdnur = [];
    const cdnurMap = new Map();
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!['CN', 'GN', 'CX'].includes(tp)) return;
      if (gstrHas(r.GST_NO)) return;
      const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      if (opts.btobYn !== 'Y' && taxTotal === 0) return;
      const noteType = tp === 'CX' ? 'D' : 'C';
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.BILL_NO, r.BILL_DATE, noteType, rate);
      const it = cdnurMap.get(k) || {
        UR_TYPE: 'B2CL',
        NOTE_NUMBER: gstrTxt(r.BILL_NO),
        NOTE_DATE: gstrDt(r.BILL_DATE),
        DOCUMENT_TYPE: noteType,
        PLACE_OF_SUPPLY: `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim(),
        VOUCHER_VALUE: 0,
        APPLICABLE_TAX: 0,
        RATE: rate,
        TAXABLE_VALUE: 0,
        CESS: 0,
        PRE_GST: 'N',
        _SOURCE: 'SALE',
        _TYPE: tp,
        _NOTE_NO: gstrTxt(r.BILL_NO),
        _NOTE_DATE: gstrDt(r.BILL_DATE),
        _B_TYPE: gstrTxt(r.SB_TYPE || r.B_TYPE),
      };
      it.VOUCHER_VALUE += gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      it.TAXABLE_VALUE += gstrNum(r.TAXABLE);
      cdnurMap.set(k, it);
    });
    cdnur.push(...Array.from(cdnurMap.values()));
    cdnur.sort((a, b) => {
      const d = gstrParseDispDate(a.NOTE_DATE) - gstrParseDispDate(b.NOTE_DATE);
      if (d !== 0) return d;
      return gstrTxt(a.NOTE_NUMBER).localeCompare(gstrTxt(b.NOTE_NUMBER), 'en', { numeric: true, sensitivity: 'base' });
    });

    const expMap = new Map();
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!['SE', 'ER'].includes(tp)) return;
      const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      const k = keyOf(r.BILL_NO, r.BILL_DATE, rate);
      const sign = tp === 'ER' ? -1 : 1;
      const it = expMap.get(k) || {
        EXPORT_TYPE: rate === 0 ? 'WOPAY' : 'WPAY',
        INVOICE_NO: fmtInvNo(r, opts),
        INVOICE_DATE: gstrDt(r.BILL_DATE),
        INVOICE_VALUE: 0,
        PORT: gstrTxt(r.REMARKS1) || 'INDB91',
        SHIPPING_BILL_NO: gstrTxt(r.REMARKS),
        SHIPPING_BILL_DATE: gstrDt(r.V_DATE),
        RATE: rate,
        TAXABLE_VALUE: 0,
        _TYPE: tp,
        _BILL_NO: gstrTxt(r.BILL_NO),
        _B_TYPE: gstrTxt(r.B_TYPE),
      };
      it.INVOICE_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
      it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
      expMap.set(k, it);
    });
    const exp = Array.from(expMap.values());
    const expa = [];

    // EXEMP: keep VFP parity (compute only when BTOBYN <> 'Y')
    let exemp = [];
    if (opts.btobYn !== 'Y') {
      // X1
      const x1 = saleRows.filter((r) => {
        const tp = gstrTxt(r.TYPE).toUpperCase();
        if (!['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN'].includes(tp)) return false;
        const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
        return taxTotal === 0;
      });
      // X2/X3
      const x2 = x1.filter((r) => gstrHas(r.GST_NO)); // registered
      const x3 = x1.filter((r) => !gstrHas(r.GST_NO)); // unregistered

      const sumByLc = (rows) => {
        const out = new Map();
        rows.forEach((r) => {
          const lc = gstrTxt(r.L_C).toUpperCase() === 'L' ? 'L' : 'C';
          const tp = gstrTxt(r.TYPE).toUpperCase();
          const amt = tp === 'CN' ? -gstrNum(r.TAXABLE) : gstrNum(r.TAXABLE);
          out.set(lc, gstrNum(out.get(lc)) + amt);
        });
        return out;
      };

      // X4 / X5
      const x4 = sumByLc(x2); // reg sale
      const x5 = sumByLc(x3); // ur sale

      const sumPurchaseByLc = (filterFn) => {
        const out = new Map();
        purRows.forEach((r) => {
          const tp = gstrTxt(r.TYPE).toUpperCase();
          if (!filterFn(tp, r)) return;
          const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
          if (taxTotal !== 0) return;
          const lc = gstrTxt(r.L_C).toUpperCase() === 'L' ? 'L' : 'C';
          out.set(lc, gstrNum(out.get(lc)) + gstrNum(r.TAXABLE));
        });
        return out;
      };

      // X41/X51 (CX, S_P<>'P')
      const x41 = sumPurchaseByLc((tp, r) => tp === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && gstrHas(r.GST_NO));
      const x51 = sumPurchaseByLc((tp, r) => tp === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && !gstrHas(r.GST_NO));
      // X42/X52 (DX, S_P='S')
      const x42 = sumPurchaseByLc((tp, r) => tp === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && gstrHas(r.GST_NO));
      const x52 = sumPurchaseByLc((tp, r) => tp === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && !gstrHas(r.GST_NO));

      let exmp_l_r = 0;
      let exmp_c_r = 0;
      let exmp_l_ur = 0;
      let exmp_c_ur = 0;

      exmp_l_r = gstrNum(x4.get('L'));
      exmp_c_r = gstrNum(x4.get('C'));
      exmp_l_r -= gstrNum(x41.get('L'));
      exmp_c_r -= gstrNum(x41.get('C'));
      exmp_l_r += gstrNum(x42.get('L'));
      exmp_c_r += gstrNum(x42.get('C'));

      exmp_l_ur = gstrNum(x5.get('L'));
      exmp_c_ur = gstrNum(x5.get('C'));
      exmp_l_ur -= gstrNum(x51.get('L'));
      exmp_c_ur -= gstrNum(x51.get('C'));
      exmp_l_ur += gstrNum(x52.get('L'));
      exmp_c_ur += gstrNum(x52.get('C'));

      exemp = [
        { DESCRIPTION: 'Inter-State supplies to registered persons', NIL_RATED: 0, EXMPTED: exmp_c_r, NON_GST_SUP: 0, _KEY: 'REG_INTER' },
        { DESCRIPTION: 'Intra-State supplies to registered persons', NIL_RATED: 0, EXMPTED: exmp_l_r, NON_GST_SUP: 0, _KEY: 'REG_INTRA' },
        { DESCRIPTION: 'Inter-State supplies to unregistered persons', NIL_RATED: 0, EXMPTED: exmp_c_ur, NON_GST_SUP: 0, _KEY: 'UR_INTER' },
        { DESCRIPTION: 'Intra-State supplies to unregistered persons', NIL_RATED: 0, EXMPTED: exmp_l_ur, NON_GST_SUP: 0, _KEY: 'UR_INTRA' },
      ];
    }

    const buildHsn = (registered) => {
      const m = new Map();
      saleRows.forEach((r) => {
        const isReg = gstrHas(r.GST_NO);
        if (isReg !== registered) return;
        const tp = gstrTxt(r.TYPE).toUpperCase();
        const sign = ['CN', 'GN', 'CX', 'ER'].includes(tp) ? -1 : 1;
        const rate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
        const k = keyOf(r.HSN_CODE, rate);
        const it = m.get(k) || {
          HSN_CODE: gstrTxt(r.HSN_CODE),
          DESCRIPTION: gstrTxt(r.ITEM_NAME) || gstrTxt(r.HSN_CODE),
          UQC: gstrTxt(r.HSN_UNIT),
          TOTAL_QUANTITY: 0,
          TOTAL_VALUE: 0,
          TAX_RATE: rate,
          TAXABLE_VALUE: 0,
          IGST: 0,
          CGST: 0,
          SGST: 0,
          CESS_AMOUNT: 0,
        };
        it.TOTAL_QUANTITY += sign * gstrNum(r.WEIGHT ?? r.QNTY);
        it.TOTAL_VALUE += sign * (gstrNum(r.TAXABLE) + gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT));
        it.TAXABLE_VALUE += sign * gstrNum(r.TAXABLE);
        it.IGST += sign * gstrNum(r.IGST_AMT);
        it.CGST += sign * gstrNum(r.CGST_AMT);
        it.SGST += sign * gstrNum(r.SGST_AMT);
        m.set(k, it);
      });
      return Array.from(m.values());
    };
    const hsn_b2b = buildHsn(true);
    const hsn_b2c = buildHsn(false);

    // DOCS: count unique documents by TYPE+B_TYPE+BILL_DATE+BILL_NO,
    // then summarize by TYPE+B_TYPE for from/to/total.
    const uniqueDocs = new Map();
    saleRows.forEach((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      const bt = gstrTxt(r.B_TYPE);
      const billNo = gstrTxt(r.BILL_NO);
      const billDate = gstrDt(r.BILL_DATE);
      const k = keyOf(tp, bt, billDate, billNo);
      if (!uniqueDocs.has(k)) {
        uniqueDocs.set(k, { TYPE: tp, B_TYPE: bt, BILL_DATE: billDate, BILL_NO: billNo });
      }
    });
    const docsMap = new Map();
    Array.from(uniqueDocs.values()).forEach((d) => {
      const k = keyOf(d.TYPE, d.B_TYPE);
      const it = docsMap.get(k) || { TYPE: d.TYPE, B_TYPE: d.B_TYPE, from: d.BILL_NO, to: d.BILL_NO, total: 0 };
      it.total += 1;
      if (!it.from || gstrTxt(d.BILL_NO).localeCompare(gstrTxt(it.from), 'en', { numeric: true, sensitivity: 'base' }) < 0) it.from = d.BILL_NO;
      if (!it.to || gstrTxt(d.BILL_NO).localeCompare(gstrTxt(it.to), 'en', { numeric: true, sensitivity: 'base' }) > 0) it.to = d.BILL_NO;
      docsMap.set(k, it);
    });
    const docs = Array.from(docsMap.values()).map((d) => ({
      NATURE_OF_DOCUMENT:
        d.TYPE === 'CN'
          ? 'Credit note'
          : (d.TYPE === 'SL' || d.TYPE === 'SE')
            ? 'Invoice for outward supply'
            : 'Invoice for outward supply',
      SR_NO_FROM: d.from,
      SR_NO_TO: d.to,
      TOTAL_NUMBER: d.total,
      CANCELLED: 0,
    }));

    // GSTR3B (VFP-aligned totals)
    const saleSign = (tp) => (['CN', 'GN', 'CX', 'ER'].includes(gstrTxt(tp).toUpperCase()) ? -1 : 1);
    const saleSignNoEr = (tp) => (['CN', 'GN', 'CX'].includes(gstrTxt(tp).toUpperCase()) ? -1 : 1);
    const sumSigned = (rows, signFn) => rows.reduce((a, r) => {
      const s = signFn(r.TYPE);
      a.taxable += s * gstrNum(r.TAXABLE);
      a.igst += s * gstrNum(r.IGST_AMT);
      a.cgst += s * gstrNum(r.CGST_AMT);
      a.sgst += s * gstrNum(r.SGST_AMT);
      return a;
    }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    const sumPlain = (rows) => rows.reduce((a, r) => {
      a.taxable += gstrNum(r.TAXABLE);
      a.igst += gstrNum(r.IGST_AMT);
      a.cgst += gstrNum(r.CGST_AMT);
      a.sgst += gstrNum(r.SGST_AMT);
      return a;
    }, { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    const taxTotal = (r) => gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);

    let CGST_PAYABLE = 0;
    let SGST_PAYABLE = 0;
    let IGST_PAYABLE = 0;
    let CGST_PAID = 0;
    let SGST_PAID = 0;
    let IGST_PAID = 0;

    const aBase = sumSigned(
      saleRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() !== 'RC' && taxTotal(r) !== 0),
      saleSign
    );
    const aCx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && taxTotal(r) !== 0));
    const aDx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && taxTotal(r) !== 0));
    const row31a = {
      taxable: aBase.taxable - aCx.taxable + aDx.taxable,
      igst: aBase.igst - aCx.igst + aDx.igst,
      cgst: aBase.cgst - aCx.cgst + aDx.cgst,
      sgst: aBase.sgst - aCx.sgst + aDx.sgst,
    };
    CGST_PAYABLE = row31a.cgst;
    SGST_PAYABLE = row31a.sgst;
    IGST_PAYABLE = row31a.igst;

    const row31b = sumSigned(
      saleRows.filter((r) => ['SE', 'ER'].includes(gstrTxt(r.TYPE).toUpperCase()) && taxTotal(r) === 0),
      saleSign
    );

    const cBase = sumSigned(
      saleRows.filter((r) => !['RC', 'SE', 'ER'].includes(gstrTxt(r.TYPE).toUpperCase()) && taxTotal(r) === 0),
      saleSignNoEr
    );
    const cCx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() !== 'P' && taxTotal(r) === 0));
    const cDx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'S' && taxTotal(r) === 0));
    const row31c = {
      taxable: cBase.taxable - cCx.taxable + cDx.taxable,
      igst: cBase.igst - cCx.igst + cDx.igst,
      cgst: cBase.cgst - cCx.cgst + cDx.cgst,
      sgst: cBase.sgst - cCx.sgst + cDx.sgst,
    };

    const row31d = sumSigned(
      saleRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'RC' && taxTotal(r) !== 0),
      saleSignNoEr
    );
    CGST_PAYABLE += row31d.cgst;
    SGST_PAYABLE += row31d.sgst;
    IGST_PAYABLE += row31d.igst;

    const row4a1 = sumPlain(purRows.filter((r) => gstrTxt(r.TAX_FORM).toUpperCase() === 'I'));
    IGST_PAID = row4a1.igst;
    SGST_PAID = row4a1.sgst;
    CGST_PAID = row4a1.cgst;
    const row4a2 = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'EV' && gstrTxt(r.REMARKS).toUpperCase().startsWith('IS') && gstrTxt(r.SHOW_IN_GSTR).toUpperCase() === 'Y'));
    IGST_PAID += row4a2.igst;
    SGST_PAID += row4a2.sgst;
    CGST_PAID += row4a2.cgst;
    const row4a3 = sumSigned(
      saleRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'RC' && gstrTxt(r.INPUT_YN).toUpperCase() !== 'N' && taxTotal(r) !== 0),
      saleSignNoEr
    );
    IGST_PAID += row4a3.igst;
    SGST_PAID += row4a3.sgst;
    CGST_PAID += row4a3.cgst;

    const row4a5Base = sumPlain(purRows.filter((r) => (gstrTxt(r.TYPE).toUpperCase() === 'PU' || (gstrTxt(r.TYPE).toUpperCase() === 'EV' && !gstrTxt(r.REMARKS).toUpperCase().startsWith('IS') && gstrTxt(r.INPUT_YN).toUpperCase() !== 'N' && gstrTxt(r.SHOW_IN_GSTR).toUpperCase() === 'Y')) && gstrTxt(r.TAX_FORM).toUpperCase() !== 'I' && taxTotal(r) !== 0));
    const row4a5Dn = sumPlain(purRows.filter((r) => (gstrTxt(r.TYPE).toUpperCase() === 'DN' || (gstrTxt(r.TYPE).toUpperCase() === 'DX' && gstrTxt(r.S_P).toUpperCase() === 'P')) && taxTotal(r) !== 0));
    const row4a5Cx = sumPlain(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() === 'P' && taxTotal(r) !== 0));
    const row4a5 = {
      taxable: row4a5Base.taxable - row4a5Dn.taxable + row4a5Cx.taxable,
      igst: row4a5Base.igst - row4a5Dn.igst + row4a5Cx.igst,
      cgst: row4a5Base.cgst - row4a5Dn.cgst + row4a5Cx.cgst,
      sgst: row4a5Base.sgst - row4a5Dn.sgst + row4a5Cx.sgst,
    };
    IGST_PAID -= row4a5Cx.igst;
    SGST_PAID -= row4a5Cx.sgst;
    CGST_PAID -= row4a5Cx.cgst;

    const sumLc = (rows) => rows.reduce((a, r) => {
      const isL = gstrTxt(r.L_C).toUpperCase() === 'L';
      if (isL) a.l += gstrNum(r.TAXABLE); else a.c += gstrNum(r.TAXABLE);
      return a;
    }, { l: 0, c: 0 });
    const exBase = sumLc(purRows.filter((r) => (gstrTxt(r.TYPE).toUpperCase() === 'PU' || (gstrTxt(r.TYPE).toUpperCase() === 'EV' && gstrTxt(r.INPUT_YN).toUpperCase() === 'N' && gstrTxt(r.SHOW_IN_GSTR).toUpperCase() === 'Y')) && gstrTxt(r.TAX_FORM).toUpperCase() !== 'I' && taxTotal(r) === 0));
    const exDn = sumLc(purRows.filter((r) => ['DX', 'DN'].includes(gstrTxt(r.TYPE).toUpperCase()) && taxTotal(r) === 0));
    const exCx = sumLc(purRows.filter((r) => gstrTxt(r.TYPE).toUpperCase() === 'CX' && gstrTxt(r.S_P).toUpperCase() === 'P' && taxTotal(r) === 0));
    const row5 = { l: exBase.l - exDn.l + exCx.l, c: exBase.c - exDn.c + exCx.c };

    const row51 = saleRows.reduce((a, r) => {
      if (Math.trunc(gstrNum(r.SCHEDULE)) !== 11) return a;
      const sign = gstrTxt(r.TYPE).toUpperCase() === 'CN' ? -1 : 1;
      const isL = gstrTxt(r.SL_C).toUpperCase() === 'L';
      if (isL) a.l += sign * gstrNum(r.TAXABLE); else a.c += sign * gstrNum(r.TAXABLE);
      return a;
    }, { l: 0, c: 0 });

    const gstr3b = [
      { PARTICULARS: 'OUTWARD SUPPLIES TAXABLE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31a.taxable, IGST: row31a.igst, CGST: row31a.cgst, SGST: row31a.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'OUTWARD SUPPLIES ZERO RATED', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31b.taxable, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'OUTWARD SUPPLIES EXEMPTED', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31c.taxable, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'REVERSE CHARGE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row31d.taxable, IGST: row31d.igst, CGST: row31d.cgst, SGST: row31d.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'IMPORT OF GOODS', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a1.taxable, IGST: row4a1.igst, CGST: row4a1.cgst, SGST: row4a1.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'IMPORT OF SERVICES', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a2.taxable, IGST: row4a2.igst, CGST: row4a2.cgst, SGST: row4a2.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'REVERSE CHARGE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a3.taxable, IGST: row4a3.igst, CGST: row4a3.cgst, SGST: row4a3.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'ALL OTHER ITC', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: row4a5.taxable, IGST: row4a5.igst, CGST: row4a5.cgst, SGST: row4a5.sgst, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'NET ITC', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: IGST_PAID, CGST: CGST_PAID, SGST: SGST_PAID, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: 0 },
      { PARTICULARS: 'FROM SUPPLIER EXEMPT', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: row5.c, INTRA_STATE_SUPPLY: row5.l, TAX_PAYABLE: 0 },
      { PARTICULARS: 'CONSIGNMENT PURCHASE', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: row51.c, INTRA_STATE_SUPPLY: row51.l, TAX_PAYABLE: 0 },
      { PARTICULARS: 'IGST', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: IGST_PAID, CGST: 0, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: IGST_PAYABLE },
      { PARTICULARS: 'CGST', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: CGST_PAID, SGST: 0, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: CGST_PAYABLE },
      { PARTICULARS: 'SGST', PLACE_OF_SUPPLY: '', TAXABLE_VALUE: 0, IGST: 0, CGST: 0, SGST: SGST_PAID, INTER_STATE_SUPPLY: 0, INTRA_STATE_SUPPLY: 0, TAX_PAYABLE: SGST_PAYABLE },
    ];

    const at = [];
    const atadj = [];
    const sheets = {
      b2b: gstrRoundAmountColumns(b2b),
      b2cl: gstrRoundAmountColumns(b2cl),
      b2cs: gstrRoundAmountColumns(b2cs),
      cdnr: gstrRoundAmountColumns(cdnr),
      cdnur: gstrRoundAmountColumns(cdnur),
      exp: gstrRoundAmountColumns(exp),
      expa: gstrRoundAmountColumns(expa),
      at: gstrRoundAmountColumns(at),
      atadj: gstrRoundAmountColumns(atadj),
      exemp: gstrRoundAmountColumns(exemp),
      'hsn(b2b)': gstrRoundAmountColumns(hsn_b2b),
      'hsn(b2c)': gstrRoundAmountColumns(hsn_b2c),
      docs: gstrRoundAmountColumns(docs),
      gstr3b: gstrRoundAmountColumns(gstr3b),
    };
    res.json({ ok: true, params: opts, period: { s_date, e_date }, sheets });
  } catch (err) {
    console.error('❌ GSTR1 report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-b2cs-detail', async (req, res) => {
  try {
    const {
      comp_code,
      comp_uid,
      s_date,
      e_date,
      btocs_yn,
      b2cl_limit_mode,
      place_of_supply,
      rate,
    } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }
    const targetPos = gstrTxt(place_of_supply);
    const targetRate = gstrRate(rate);
    const opts = {
      btocsYn: String(btocs_yn || 'Y').trim().toUpperCase() === 'N' ? 'N' : 'Y',
      b2clLimit: String(b2cl_limit_mode || '1').trim() === '2' ? 100000 : 250000,
    };

    const saleSql = `
      SELECT
        A.TYPE, A.B_TYPE, A.BILL_DATE, A.BILL_NO, A.SALE_INV_NO,
        A.CODE, M.NAME, M.GST_NO, M.L_C, M.STATE_CODE, M.STATE,
        A.TRN_NO, A.ITEM_CODE, I.HSN_CODE, I.ITEM_NAME,
        A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
        A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT,
        A.CGST_PER, A.SGST_PER, A.IGST_PER
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.CODE = M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(saleSql, { comp_code, s_date, e_date }, comp_uid)) || [];

    const outwardSetCn = new Set(['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN', 'GN', 'CX']);
    const mdetRows = rows.filter((r) => {
      const tp = gstrTxt(r.TYPE).toUpperCase();
      if (!outwardSetCn.has(tp)) return false;
      if (gstrHas(r.GST_NO)) return false;
      if (opts.btocsYn !== 'Y') {
        const taxTotal = gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
        if (taxTotal === 0) return false;
      }
      return true;
    });

    const x2Map = new Map();
    const billAmtSumMap = new Map();
    mdetRows.forEach((r) => {
      const billKey = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, gstrDt(r.BILL_DATE));
      billAmtSumMap.set(billKey, gstrNum(billAmtSumMap.get(billKey)) + gstrNum(r.BILL_AMT));
      const k = keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, gstrDt(r.BILL_DATE), r.CODE, r.NAME, r.GST_NO, r.L_C);
      const it = x2Map.get(k) || {
        TYPE: gstrTxt(r.TYPE).toUpperCase(),
        BILL_NO: gstrTxt(r.BILL_NO),
        B_TYPE: gstrTxt(r.B_TYPE),
        BILL_DATE: gstrDt(r.BILL_DATE),
        L_C: gstrTxt(r.L_C).toUpperCase(),
        BILL_AMT: 0,
        TAX_TOTAL: 0,
      };
      it.BILL_AMT += gstrNum(r.BILL_AMT);
      it.TAX_TOTAL += gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT);
      x2Map.set(k, it);
    });
    let x2 = Array.from(x2Map.values());
    if (opts.btocsYn === 'Y') x2 = x2.filter((r) => gstrNum(r.BILL_AMT) < opts.b2clLimit);
    else x2 = x2.filter((r) => gstrNum(r.TAX_TOTAL) !== 0);
    const x3 = x2.filter((r) => r.L_C === 'C' && gstrNum(r.BILL_AMT) <= opts.b2clLimit);
    const x4 = x2.filter((r) => r.L_C === 'L');
    const x5 = [...x3, ...x4];
    const x5Keys = new Set(x5.map((r) => keyOf(r.TYPE, r.BILL_NO, r.B_TYPE, r.BILL_DATE)));

    const detailMap = new Map();
    mdetRows.forEach((r) => {
      const type = gstrTxt(r.TYPE).toUpperCase();
      const invNo = gstrTxt(r.BILL_NO);
      const invDate = gstrDt(r.BILL_DATE);
      const bType = gstrTxt(r.B_TYPE);
      if (!x5Keys.has(keyOf(type, invNo, bType, invDate))) return;

      const pos = `${gstrTxt(r.STATE_CODE)}-${gstrTxt(r.STATE)}`.trim();
      const rowRate = gstrRaclste(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
      if (targetPos && pos !== targetPos) return;
      if (gstrRate(rowRate) !== targetRate) return;

      const dk = keyOf(type, invDate, invNo, bType, pos, rowRate);
      const sign = ['CN', 'GN', 'CX'].includes(type) ? -1 : 1;
      const item = detailMap.get(dk) || {
        TYPE: type,
        BILL_DATE: invDate,
        BILL_NO: invNo,
        B_TYPE: bType,
        SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
        CODE: gstrTxt(r.CODE),
        NAME: gstrTxt(r.NAME),
        PLACE_OF_SUPPLY: pos,
        RATE: gstrRound2(rowRate),
        LINE_COUNT: 0,
        QNTY: 0,
        WEIGHT: 0,
        AMOUNT: 0,
        TAXABLE: 0,
        CGST_AMT: 0,
        SGST_AMT: 0,
        IGST_AMT: 0,
        BILL_AMT: gstrRound2(sign * gstrNum(billAmtSumMap.get(keyOf(type, invNo, bType, invDate)))),
      };
      item.LINE_COUNT += 1;
      item.QNTY += sign * gstrNum(r.QNTY);
      item.WEIGHT += sign * gstrNum(r.WEIGHT);
      item.AMOUNT += sign * gstrNum(r.AMOUNT);
      item.TAXABLE += sign * gstrNum(r.TAXABLE);
      item.CGST_AMT += sign * gstrNum(r.CGST_AMT);
      item.SGST_AMT += sign * gstrNum(r.SGST_AMT);
      item.IGST_AMT += sign * gstrNum(r.IGST_AMT);
      detailMap.set(dk, item);
    });
    const details = Array.from(detailMap.values())
      .map((r) => ({
        ...r,
        QNTY: gstrRound2(r.QNTY),
        WEIGHT: gstrRound2(r.WEIGHT),
        AMOUNT: gstrRound2(r.AMOUNT),
        TAXABLE: gstrRound2(r.TAXABLE),
        CGST_AMT: gstrRound2(r.CGST_AMT),
        SGST_AMT: gstrRound2(r.SGST_AMT),
        IGST_AMT: gstrRound2(r.IGST_AMT),
      }))
      .sort((a, b) => {
        const d = gstrParseDispDate(a.BILL_DATE) - gstrParseDispDate(b.BILL_DATE);
        if (d !== 0) return d;
        return gstrTxt(a.BILL_NO).localeCompare(gstrTxt(b.BILL_NO), 'en', { numeric: true, sensitivity: 'base' });
      });

    res.json({ ok: true, rows: details });
  } catch (err) {
    console.error('❌ gstr1-b2cs-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-sale-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, bill_no, b_type } = req.query;
    if (!comp_code || !comp_uid || !type || bill_no == null || bill_no === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, type, bill_no are required' });
    }
    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.SALE_INV_NO,
        A.CODE,
        B.NAME,
        B.GST_NO,
        B.STATE_CODE,
        B.STATE,
        A.TRN_NO,
        A.ITEM_CODE,
        A.HSN_CODE AS SALE_HSN_CODE,
        C.HSN_CODE,
        A.QNTY,
        A.WEIGHT,
        A.RATE,
        A.AMOUNT,
        A.TAXABLE,
        A.CGST_AMT,
        A.SGST_AMT,
        A.IGST_AMT,
        A.BILL_AMT
      FROM SALE A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      LEFT JOIN ITEMMAST C
        ON A.COMP_CODE = C.COMP_CODE
       AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(TO_CHAR(:bill_no))
        AND TRIM(NVL(A.B_TYPE, ' ')) = TRIM(NVL(:b_type, ' '))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;

    const rows = (await runQuery(sql, { comp_code, type, bill_no, b_type: b_type ?? ' ' }, comp_uid)) || [];
    const total = {
      line_count: rows.length,
      taxable_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      amount_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.AMOUNT), 0)),
      cgst_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.CGST_AMT), 0)),
      sgst_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.SGST_AMT), 0)),
      igst_total: gstrRound2(rows.reduce((s, r) => s + gstrNum(r.IGST_AMT), 0)),
      bill_total: gstrRound2(rows.reduce((m, r) => Math.max(m, gstrNum(r.BILL_AMT)), 0)),
    };

    const outRows = rows.map((r) => ({
      TYPE: gstrTxt(r.TYPE),
      BILL_DATE: gstrDt(r.BILL_DATE),
      BILL_NO: gstrTxt(r.BILL_NO),
      B_TYPE: gstrTxt(r.B_TYPE),
      SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
      CODE: gstrTxt(r.CODE),
      NAME: gstrTxt(r.NAME),
      GST_NO: gstrTxt(r.GST_NO),
      STATE_CODE: gstrTxt(r.STATE_CODE),
      STATE: gstrTxt(r.STATE),
      TRN_NO: gstrNum(r.TRN_NO),
      ITEM_CODE: gstrTxt(r.ITEM_CODE),
      SALE_HSN_CODE: gstrTxt(r.SALE_HSN_CODE),
      HSN_CODE: gstrTxt(r.HSN_CODE),
      QNTY: gstrRound2(gstrNum(r.QNTY)),
      WEIGHT: gstrRound2(gstrNum(r.WEIGHT)),
      RATE: gstrRound2(gstrNum(r.RATE)),
      AMOUNT: gstrRound2(gstrNum(r.AMOUNT)),
      TAXABLE: gstrRound2(gstrNum(r.TAXABLE)),
      CGST_AMT: gstrRound2(gstrNum(r.CGST_AMT)),
      SGST_AMT: gstrRound2(gstrNum(r.SGST_AMT)),
      IGST_AMT: gstrRound2(gstrNum(r.IGST_AMT)),
      BILL_AMT: gstrRound2(gstrNum(r.BILL_AMT)),
    }));

    res.json({ ok: true, rows: outRows, total });
  } catch (err) {
    console.error('❌ gstr1-sale-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-note-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, source, type, note_no, note_date, b_type } = req.query;
    if (!comp_code || !comp_uid || !source || !type || note_no == null || note_no === '' || !note_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, source, type, note_no, note_date are required' });
    }

    const src = String(source).trim().toUpperCase();
    if (src === 'SALE') {
      const sql = `
        SELECT
          A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.SALE_INV_NO,
          A.CODE, B.NAME, B.GST_NO, B.STATE_CODE, B.STATE,
          A.TRN_NO, A.ITEM_CODE, A.HSN_CODE AS SALE_HSN_CODE, C.HSN_CODE,
          A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT, A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT
        FROM SALE A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
        WHERE A.COMP_CODE = :comp_code
          AND TRIM(A.TYPE) = TRIM(:type)
          AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(TO_CHAR(:note_no))
          AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:note_date,'DD-MON-YY'))
          AND TRIM(NVL(A.B_TYPE,' ')) = TRIM(NVL(:b_type,' '))
        ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
      const rows = (await runQuery(sql, { comp_code, type, note_no, note_date, b_type: b_type ?? ' ' }, comp_uid)) || [];
      const outRows = rows.map((r) => ({
        SOURCE: 'SALE',
        TYPE: gstrTxt(r.TYPE),
        NOTE_DATE: gstrDt(r.BILL_DATE),
        NOTE_NO: gstrTxt(r.BILL_NO),
        B_TYPE: gstrTxt(r.B_TYPE),
        SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
        CODE: gstrTxt(r.CODE),
        NAME: gstrTxt(r.NAME),
        GST_NO: gstrTxt(r.GST_NO),
        STATE_CODE: gstrTxt(r.STATE_CODE),
        STATE: gstrTxt(r.STATE),
        TRN_NO: gstrNum(r.TRN_NO),
        ITEM_CODE: gstrTxt(r.ITEM_CODE),
        SALE_HSN_CODE: gstrTxt(r.SALE_HSN_CODE),
        HSN_CODE: gstrTxt(r.HSN_CODE),
        QNTY: gstrRound2(gstrNum(r.QNTY)),
        WEIGHT: gstrRound2(gstrNum(r.WEIGHT)),
        RATE: gstrRound2(gstrNum(r.RATE)),
        AMOUNT: gstrRound2(gstrNum(r.AMOUNT)),
        TAXABLE: gstrRound2(gstrNum(r.TAXABLE)),
        CGST_AMT: gstrRound2(gstrNum(r.CGST_AMT)),
        SGST_AMT: gstrRound2(gstrNum(r.SGST_AMT)),
        IGST_AMT: gstrRound2(gstrNum(r.IGST_AMT)),
        BILL_AMT: gstrRound2(gstrNum(r.BILL_AMT)),
      }));
      const total = {
        line_count: outRows.length,
        taxable_total: gstrRound2(outRows.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
        bill_total: gstrRound2(outRows.reduce((m, r) => Math.max(m, gstrNum(r.BILL_AMT)), 0)),
      };
      return res.json({ ok: true, rows: outRows, total });
    }

    const sql = `
      SELECT
        A.TYPE, A.R_DATE, A.R_NO, A.B_TYPE, A.BILL_DATE, A.BILL_NO,
        A.CODE, B.NAME, B.GST_NO, B.STATE_CODE, B.STATE,
        A.ITEM_CODE, C.HSN_CODE, A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
        A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT
      FROM PURCHASE A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRIM(TO_CHAR(A.R_NO)) = TRIM(TO_CHAR(:note_no))
        AND TRUNC(A.R_DATE) = TRUNC(TO_DATE(:note_date,'DD-MON-YY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(sql, { comp_code, type, note_no, note_date }, comp_uid)) || [];
    const outRows = rows.map((r) => ({
      SOURCE: 'PURCHASE',
      TYPE: gstrTxt(r.TYPE),
      NOTE_DATE: gstrDt(r.R_DATE),
      NOTE_NO: gstrTxt(r.R_NO),
      B_TYPE: gstrTxt(r.B_TYPE),
      BILL_DATE: gstrDt(r.BILL_DATE),
      BILL_NO: gstrTxt(r.BILL_NO),
      CODE: gstrTxt(r.CODE),
      NAME: gstrTxt(r.NAME),
      GST_NO: gstrTxt(r.GST_NO),
      STATE_CODE: gstrTxt(r.STATE_CODE),
      STATE: gstrTxt(r.STATE),
      ITEM_CODE: gstrTxt(r.ITEM_CODE),
      HSN_CODE: gstrTxt(r.HSN_CODE),
      QNTY: gstrRound2(gstrNum(r.QNTY)),
      WEIGHT: gstrRound2(gstrNum(r.WEIGHT)),
      RATE: gstrRound2(gstrNum(r.RATE)),
      AMOUNT: gstrRound2(gstrNum(r.AMOUNT)),
      TAXABLE: gstrRound2(gstrNum(r.TAXABLE)),
      CGST_AMT: gstrRound2(gstrNum(r.CGST_AMT)),
      SGST_AMT: gstrRound2(gstrNum(r.SGST_AMT)),
      IGST_AMT: gstrRound2(gstrNum(r.IGST_AMT)),
      BILL_AMT: gstrRound2(gstrNum(r.BILL_AMT)),
    }));
    const total = {
      line_count: outRows.length,
      taxable_total: gstrRound2(outRows.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      bill_total: gstrRound2(outRows.reduce((m, r) => Math.max(m, gstrNum(r.BILL_AMT)), 0)),
    };
    res.json({ ok: true, rows: outRows, total });
  } catch (err) {
    console.error('❌ gstr1-note-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-exemp-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, row_key } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date || !row_key) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date, row_key are required' });
    }
    const saleSql = `
      SELECT A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.SALE_INV_NO, A.CODE, M.NAME, M.GST_NO, M.L_C,
             A.TAXABLE, A.CGST_AMT, A.SGST_AMT, A.IGST_AMT, A.BILL_AMT
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE=M.COMP_CODE AND A.CODE=M.CODE
      WHERE A.COMP_CODE=:comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(saleSql, { comp_code, s_date, e_date }, comp_uid)) || [];
    const key = String(row_key).trim().toUpperCase();
    const isReg = key.startsWith('REG_');
    const isIntra = key.endsWith('_INTRA');
    const details = rows
      .filter((r) => ['SL', 'ST', 'SR', 'GT', 'GR', 'SX', 'CN'].includes(gstrTxt(r.TYPE).toUpperCase()))
      .filter((r) => (gstrNum(r.CGST_AMT) + gstrNum(r.SGST_AMT) + gstrNum(r.IGST_AMT)) === 0)
      .filter((r) => (isReg ? gstrHas(r.GST_NO) : !gstrHas(r.GST_NO)))
      .filter((r) => (isIntra ? gstrTxt(r.L_C).toUpperCase() === 'L' : gstrTxt(r.L_C).toUpperCase() !== 'L'))
      .map((r) => {
        const tp = gstrTxt(r.TYPE).toUpperCase();
        const sign = tp === 'CN' ? -1 : 1;
        return {
          TYPE: gstrTxt(r.TYPE),
          BILL_DATE: gstrDt(r.BILL_DATE),
          BILL_NO: gstrTxt(r.BILL_NO),
          B_TYPE: gstrTxt(r.B_TYPE),
          SALE_INV_NO: gstrTxt(r.SALE_INV_NO),
          CODE: gstrTxt(r.CODE),
          NAME: gstrTxt(r.NAME),
          GST_NO: gstrTxt(r.GST_NO),
          L_C: gstrTxt(r.L_C),
          TAXABLE: gstrRound2(sign * gstrNum(r.TAXABLE)),
          BILL_AMT: gstrRound2(sign * gstrNum(r.BILL_AMT)),
        };
      });
    const total = {
      line_count: details.length,
      taxable_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      bill_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.BILL_AMT), 0)),
    };
    res.json({ ok: true, rows: details, total });
  } catch (err) {
    console.error('❌ gstr1-exemp-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gstr1-hsn-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, registered, hsn_code, tax_rate } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date || hsn_code == null || tax_rate == null) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date, hsn_code, tax_rate are required' });
    }
    const isReg = String(registered).trim().toUpperCase() === 'Y';
    const targetHsn = gstrTxt(hsn_code);
    const targetRate = gstrRate(tax_rate);
    const saleSql = `
      SELECT A.TYPE,A.BILL_DATE,A.BILL_NO,A.B_TYPE,A.SALE_INV_NO,A.CODE,M.NAME,M.GST_NO,
             A.TRN_NO,A.ITEM_CODE,I.ITEM_NAME,I.HSN_CODE,I.HSN_UNIT,
             A.QNTY,A.WEIGHT,A.RATE,A.AMOUNT,A.TAXABLE,A.CGST_AMT,A.SGST_AMT,A.IGST_AMT,A.CGST_PER,A.SGST_PER,A.IGST_PER
      FROM SALE A
      LEFT JOIN MASTER M ON A.COMP_CODE=M.COMP_CODE AND A.CODE=M.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE=I.COMP_CODE AND A.ITEM_CODE=I.ITEM_CODE
      WHERE A.COMP_CODE=:comp_code
        AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
    const rows = (await runQuery(saleSql, { comp_code, s_date, e_date }, comp_uid)) || [];
    const details = rows
      .filter((r) => (isReg ? gstrHas(r.GST_NO) : !gstrHas(r.GST_NO)))
      .filter((r) => gstrTxt(r.HSN_CODE) === targetHsn)
      .filter((r) => gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER)) === targetRate)
      .map((r) => {
        const tp = gstrTxt(r.TYPE).toUpperCase();
        const sign = ['CN', 'GN', 'CX', 'ER'].includes(tp) ? -1 : 1;
        return {
          TYPE: gstrTxt(r.TYPE),
          BILL_DATE: gstrDt(r.BILL_DATE),
          BILL_NO: gstrTxt(r.BILL_NO),
          B_TYPE: gstrTxt(r.B_TYPE),
          TRN_NO: gstrNum(r.TRN_NO),
          ITEM_CODE: gstrTxt(r.ITEM_CODE),
          ITEM_NAME: gstrTxt(r.ITEM_NAME),
          HSN_CODE: gstrTxt(r.HSN_CODE),
          TAX_RATE: gstrRound2(targetRate),
          QNTY: gstrRound2(sign * gstrNum(r.QNTY)),
          WEIGHT: gstrRound2(sign * gstrNum(r.WEIGHT)),
          AMOUNT: gstrRound2(sign * gstrNum(r.AMOUNT)),
          TAXABLE: gstrRound2(sign * gstrNum(r.TAXABLE)),
          IGST_AMT: gstrRound2(sign * gstrNum(r.IGST_AMT)),
          CGST_AMT: gstrRound2(sign * gstrNum(r.CGST_AMT)),
          SGST_AMT: gstrRound2(sign * gstrNum(r.SGST_AMT)),
        };
      });
    const total = {
      line_count: details.length,
      taxable_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.TAXABLE), 0)),
      amount_total: gstrRound2(details.reduce((s, r) => s + gstrNum(r.AMOUNT), 0)),
    };
    res.json({ ok: true, rows: details, total });
  } catch (err) {
    console.error('❌ gstr1-hsn-detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master-party-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ master-party-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master-party-schedules', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchMasterPartyScheduleRows(comp_code, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ master-party-schedules error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master-party-states', async (req, res) => {
  try {
    const { comp_uid, comp_code } = req.query;
    if (comp_uid == null) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    const rows = await fetchMasterPartyStateRows(comp_uid, comp_code ? String(comp_code).trim() : '');
    res.json(rows || []);
  } catch (err) {
    console.error('❌ master-party-states error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master-party-next-code', async (req, res) => {
  try {
    const { comp_code, comp_uid, schedule } = req.query;
    if (!comp_code || comp_uid == null || schedule == null || String(schedule).trim() === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, and schedule are required' });
    }
    const result = await computeVfpMasterPartyNextCode(comp_code, comp_uid, schedule);
    res.json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('❌ master-party-next-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/master-party', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    const schedule = masterPartyScheduleBind(body.schedule);
    if (!schedule) return res.status(400).json({ error: 'schedule is required' });

    let codeKey = normalizeMasterPartyCodeKey(body.code);
    if (!codeKey) {
      const next = await computeVfpMasterPartyNextCode(comp_code, comp_uid, body.schedule);
      codeKey = normalizeMasterPartyCodeKey(next.next_code);
    }
    if (!isValidMasterPartyCodeFormat(codeKey)) {
      return res.status(400).json({
        error: 'Account code must be 6 characters: 1 letter (schedule range) + 5 digits.',
      });
    }

    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER M
       WHERE M.COMP_CODE = :comp_code AND TRIM(M.CODE) = :code AND ROWNUM = 1`,
      { comp_code, code: codeKey },
      comp_uid
    );
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) {
      return res.status(409).json({ error: `Account code ${codeKey} already exists for this company.` });
    }

    let binds;
    try {
      binds = buildMasterPartyInsertBinds(body, { comp_code, comp_year, user_name, schedule, codeKey });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    await insertMasterPartyRow(binds, comp_uid);

    const verifyRows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER M
       WHERE M.COMP_CODE = :comp_code AND TRIM(M.CODE) = :code AND ROWNUM = 1`,
      { comp_code, code: codeKey },
      comp_uid
    );
    const savedCnt = Number(verifyRows?.[0]?.CNT ?? verifyRows?.[0]?.cnt ?? 0);
    if (savedCnt < 1) {
      return res.status(500).json({
        error: 'Account was not saved to MASTER. Restart the API server and try again.',
      });
    }

    res.json(masterPartySavedJson(binds, schedule));
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('❌ master-party POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/master-accounts', async (req, res) => {
  try {
    const { comp_code, comp_uid, schedule, q, code_prefix } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const schedRaw = schedule != null && String(schedule).trim() !== '' ? masterPartyScheduleBind(schedule) : null;
    const qTrim = String(q ?? '').trim();
    const binds = { comp_code };
    let sql = `
      SELECT TRIM(M.CODE) AS CODE, M.NAME, M.SCHEDULE, M.ADD1, M.ADD2, M.ADD3, M.CITY,
             M.GST_NO, M.STATE_CODE, M.STATE, M.PAN, M.TEL_NO_O, NVL(M.L_C, 'L') AS L_C
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code`;
    sql = appendMasterCodePrefixFilter(sql, code_prefix);
    if (schedRaw) {
      binds.schedule = schedRaw;
      sql += ` AND ROUND(NVL(M.SCHEDULE, 0), 2) = :schedule`;
    }
    if (qTrim) {
      sql = appendMasterListTokenSearch(
        sql,
        binds,
        qTrim,
        ['UPPER(M.NAME)', 'UPPER(TRIM(M.CODE))', 'UPPER(NVL(M.CITY, \'\'))'],
        'acq'
      );
    }
    sql += ` ORDER BY M.SCHEDULE, M.NAME, TRIM(M.CODE)`;
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ master-accounts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** A/c Master list by specific schedule (MASTER + SCHEDULE join). */
app.get('/api/master-accounts-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, schedule } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const hasSchedule = schedule != null && String(schedule).trim() !== '';
    const sched = hasSchedule ? masterPartyScheduleBind(schedule) : null;
    if (hasSchedule && !isValidMasterScheduleNoServer(sched)) {
      return res.status(400).json({ error: 'Select valid schedule like 1.10, 8.10, 9.10, or leave blank for all' });
    }
    const sql = `
      SELECT
        A.SCHEDULE AS SCH_NO,
        B.NAME AS SCH_NAME,
        TRIM(A.CODE) AS CODE,
        A.NAME,
        A.ADD1,
        A.ADD2,
        A.ADD3,
        A.CITY,
        A.GST_NO,
        A.PAN,
        NVL(A.L_C, 'L') AS L_C
      FROM MASTER A, SCHEDULE B
      WHERE A.COMP_CODE = :comp_code
        AND A.COMP_CODE = B.COMP_CODE
        AND ROUND(NVL(A.SCHEDULE, 0), 2) = ROUND(NVL(B.NO, 0), 2)
        ${hasSchedule ? 'AND ROUND(NVL(A.SCHEDULE, 0), 2) = :schedule' : ''}
      ORDER BY A.NAME, TRIM(A.CODE)`;
    const binds = hasSchedule ? { comp_code, schedule: sched } : { comp_code };
    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ master-accounts-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/master-party', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const codeKey = normalizeMasterPartyCodeKey(body.code);
    if (!isValidMasterPartyCodeFormat(codeKey)) {
      return res.status(400).json({ error: 'code is required for edit (6 characters)' });
    }

    const schedule = masterPartyScheduleBind(body.schedule);
    if (!schedule) return res.status(400).json({ error: 'schedule is required' });

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER M
       WHERE M.COMP_CODE = :comp_code AND TRIM(M.CODE) = :code AND ROWNUM = 1`,
      { comp_code, code: codeKey },
      comp_uid
    );
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Account code ${codeKey} not found.` });
    }

    let binds;
    try {
      binds = buildMasterPartyInsertBinds(body, { comp_code, comp_year, user_name, schedule, codeKey });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    await deleteMasterPartyByCode(comp_code, codeKey, comp_uid);
    await insertMasterPartyRow(binds, comp_uid);

    const verifyRows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER M
       WHERE M.COMP_CODE = :comp_code AND TRIM(M.CODE) = :code AND ROWNUM = 1`,
      { comp_code, code: codeKey },
      comp_uid
    );
    const savedCnt = Number(verifyRows?.[0]?.CNT ?? verifyRows?.[0]?.cnt ?? 0);
    if (savedCnt < 1) {
      return res.status(500).json({
        error: 'Account was not saved to MASTER after edit. Restart the API server and try again.',
      });
    }

    res.json(masterPartySavedJson(binds, schedule));
  } catch (err) {
    console.error('❌ master-party PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/master-party', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const user_name = String(body.user_name ?? req.query.user_name ?? '').trim();
    const codeKey = normalizeMasterPartyCodeKey(body.code ?? req.query.code);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!isValidMasterPartyCodeFormat(codeKey)) {
      return res.status(400).json({ error: 'code is required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER M
       WHERE M.COMP_CODE = :comp_code AND TRIM(M.CODE) = :code AND ROWNUM = 1`,
      { comp_code, code: codeKey },
      comp_uid
    );
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Account code ${codeKey} not found.` });
    }

    await deleteMasterPartyByCode(comp_code, codeKey, comp_uid);
    res.json({ ok: true, code: codeKey, CODE: codeKey });
  } catch (err) {
    console.error('❌ master-party DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule-master-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ schedule-master-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule-master-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q, view, parent_no } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchScheduleMasterList(comp_code, comp_uid, q, {
      view: view || 'all',
      parent_no,
    });
    res.json(rows || []);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('❌ schedule-master-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/schedule-master-next-no', async (req, res) => {
  try {
    const { comp_code, comp_uid, parent_no } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const data = await fetchNextScheduleMasterNo(comp_code, comp_uid, parent_no);
    res.json(data);
  } catch (err) {
    console.error('❌ schedule-master-next-no error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/schedule-master', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    const parent_no = body.parent_no ?? body.PARENT_NO;
    let binds;
    try {
      binds = buildScheduleMasterBinds(body, { comp_code, comp_year, parent_no });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM SCHEDULE
       WHERE COMP_CODE = :comp_code AND ROUND(NVL(NO, 0), 2) = :no AND ROWNUM = 1`,
      { comp_code, no: binds.no },
      comp_uid
    );
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) {
      return res.status(409).json({ error: 'Schedule No. Already Exist' });
    }

    await insertScheduleMasterRow(binds, comp_uid);
    res.json(buildScheduleMasterSavedJson(binds));
  } catch (err) {
    console.error('❌ schedule-master POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/schedule-master', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const parent_no = body.parent_no ?? body.PARENT_NO;
    let binds;
    try {
      binds = buildScheduleMasterBinds(body, { comp_code, comp_year, parent_no });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    await updateScheduleMasterRow(binds, comp_uid);
    res.json(buildScheduleMasterSavedJson(binds));
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    console.error('❌ schedule-master PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/schedule-master', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const user_name = String(body.user_name ?? req.query.user_name ?? '').trim();
    const schedNo = scheduleMasterNumBind(body.no ?? body.NO ?? req.query.no);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!schedNo) return res.status(400).json({ error: 'no (schedule number) is required' });

    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const masterCnt = await countMasterAccountsOnSchedule(comp_code, schedNo, comp_uid);
    if (masterCnt > 0) {
      return res.status(409).json({ error: 'You Can Not Delete Schedule Already Exist In Master' });
    }
    if (isIntegerScheduleNo(schedNo)) {
      const subCnt = await countSubSchedulesUnderMain(comp_code, schedNo, comp_uid);
      if (subCnt > 0) {
        return res.status(409).json({
          error: 'Cannot delete main schedule — sub-schedules exist under this group. Delete sub-groups first.',
        });
      }
    }

    await deleteScheduleMasterByNo(comp_code, schedNo, comp_uid);
    res.json({ ok: true, no: schedNo, NO: schedNo });
  } catch (err) {
    console.error('❌ schedule-master DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function normalizeCatMastCode(v) {
  return trimItemMasterField(v, 6).toUpperCase();
}

function buildCatMastSavedJson(binds) {
  return {
    ok: true,
    CAT_CODE: binds.cat_code,
    cat_code: binds.cat_code,
    CAT_NAME: binds.cat_name,
    cat_name: binds.cat_name,
  };
}

function buildCatMastBinds(body, { comp_code, comp_year, user_name }) {
  const cat_code = normalizeCatMastCode(body.cat_code ?? body.CAT_CODE);
  if (!cat_code) {
    const err = new Error('Category code is required.');
    err.status = 400;
    throw err;
  }
  const cat_name = String(body.cat_name ?? body.CAT_NAME ?? '')
    .trim()
    .toUpperCase();
  if (!cat_name) {
    const err = new Error('Category name is required.');
    err.status = 400;
    throw err;
  }
  return {
    comp_code,
    comp_year: Number(comp_year) || 0,
    cat_code,
    cat_name,
    user_name: String(user_name ?? '').trim(),
  };
}

async function fetchCatMastMasterList(comp_code, comp_uid, q) {
  const binds = { comp_code };
  let sql = `
    SELECT TRIM(TO_CHAR(S.CAT_CODE)) AS CAT_CODE,
           NVL(S.CAT_NAME, '') AS CAT_NAME
    FROM CATMAST S
    WHERE S.COMP_CODE = :comp_code`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      ['UPPER(S.CAT_NAME)', 'UPPER(TRIM(TO_CHAR(S.CAT_CODE)))'],
      'catq'
    );
  }
  sql += `
    ORDER BY CASE
      WHEN REGEXP_LIKE(TRIM(TO_CHAR(S.CAT_CODE)), '^[0-9]+$') THEN TO_NUMBER(TRIM(TO_CHAR(S.CAT_CODE)))
      ELSE 999999999
    END,
    UPPER(S.CAT_NAME),
    TRIM(TO_CHAR(S.CAT_CODE))`;
  try {
    return await runQuery(sql, binds, comp_uid);
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
    return [];
  }
}

async function fetchNextCatMastCode(comp_code, comp_uid) {
  try {
    const rows = await runQuery(
      `SELECT NVL(MAX(
        CASE WHEN REGEXP_LIKE(TRIM(TO_CHAR(CAT_CODE)), '^[0-9]+$')
             THEN TO_NUMBER(TRIM(TO_CHAR(CAT_CODE))) ELSE NULL END
      ), 0) AS MAX_NO
       FROM CATMAST WHERE COMP_CODE = :comp_code`,
      { comp_code },
      comp_uid
    );
    const maxNo = Math.trunc(Number(rows?.[0]?.MAX_NO ?? rows?.[0]?.max_no ?? 0) || 0);
    const next = String(maxNo + 1);
    return { next_code: next, NEXT_CODE: next, max_no: maxNo, MAX_NO: maxNo };
  } catch {
    const rows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM CATMAST WHERE COMP_CODE = :comp_code`,
      { comp_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
    const next = String(cnt + 1);
    return { next_code: next, NEXT_CODE: next };
  }
}

async function countItemsUsingCatMastCode(comp_code, cat_code, comp_uid) {
  const code = normalizeCatMastCode(cat_code);
  if (!code) return 0;
  const checks = [
    `SELECT COUNT(*) AS CNT FROM ITEMMAST
     WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(CAT_CODE)) = :cat_code`,
    `SELECT COUNT(*) AS CNT FROM ITEMMAST
     WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GRP_CODE)) = :cat_code`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, cat_code: code }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return cnt;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return 0;
}

async function insertCatMastRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      INSERT INTO CATMAST (COMP_CODE, CAT_CODE, CAT_NAME)
      VALUES (:comp_code, :cat_code, :cat_name)`,
      binds: { comp_code: binds.comp_code, cat_code: binds.cat_code, cat_name: binds.cat_name },
    },
    {
      sql: `
      INSERT INTO CATMAST (COMP_CODE, COMP_YEAR, CAT_CODE, CAT_NAME)
      VALUES (:comp_code, :comp_year, :cat_code, :cat_name)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        cat_code: binds.cat_code,
        cat_name: binds.cat_name,
      },
    },
    {
      sql: `
      INSERT INTO CATMAST (COMP_CODE, COMP_YEAR, CAT_CODE, CAT_NAME, USER_NAME, ENT_DATE)
      VALUES (:comp_code, :comp_year, :cat_code, :cat_name, :user_name, SYSDATE)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        cat_code: binds.cat_code,
        cat_name: binds.cat_name,
        user_name: binds.user_name,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('CATMAST insert failed');
}

async function updateCatMastRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      UPDATE CATMAST SET CAT_NAME = :cat_name
      WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(CAT_CODE)) = :cat_code`,
      binds: {
        comp_code: binds.comp_code,
        cat_code: binds.cat_code,
        cat_name: binds.cat_name,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('CATMAST update failed');
}

async function deleteCatMastByCode(comp_code, cat_code, comp_uid) {
  const code = normalizeCatMastCode(cat_code);
  await runQuery(
    `DELETE FROM CATMAST WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(CAT_CODE)) = :cat_code`,
    { comp_code, cat_code: code },
    comp_uid,
    { autoCommit: true }
  );
}

app.get('/api/cat-mast-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ cat-mast-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cat-mast-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchCatMastMasterList(comp_code, comp_uid, q);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ cat-mast-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cat-mast-next-code', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const data = await fetchNextCatMastCode(comp_code, comp_uid);
    res.json(data);
  } catch (err) {
    console.error('❌ cat-mast-next-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cat-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      binds = buildCatMastBinds(body, { comp_code, comp_year, user_name });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM CATMAST
       WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(CAT_CODE)) = :cat_code AND ROWNUM = 1`,
      { comp_code, cat_code: binds.cat_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) {
      return res.status(409).json({ error: 'Category code already exists.' });
    }

    await insertCatMastRow(binds, comp_uid);
    res.json(buildCatMastSavedJson(binds));
  } catch (err) {
    console.error('❌ cat-mast POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cat-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    let binds;
    try {
      binds = buildCatMastBinds(body, { comp_code, comp_year, user_name });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM CATMAST
       WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(CAT_CODE)) = :cat_code AND ROWNUM = 1`,
      { comp_code, cat_code: binds.cat_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Category ${binds.cat_code} not found.` });
    }

    await updateCatMastRow(binds, comp_uid);
    res.json(buildCatMastSavedJson(binds));
  } catch (err) {
    console.error('❌ cat-mast PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cat-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const user_name = String(body.user_name ?? req.query.user_name ?? '').trim();
    const catCode = normalizeCatMastCode(body.cat_code ?? body.CAT_CODE ?? req.query.cat_code);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name || !catCode) {
      return res.status(400).json({ error: 'comp_code, comp_uid, user_name, and cat_code are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const itemCnt = await countItemsUsingCatMastCode(comp_code, catCode, comp_uid);
    if (itemCnt > 0) {
      return res.status(409).json({
        error: 'Cannot delete — this category is used in Item Master.',
      });
    }

    await deleteCatMastByCode(comp_code, catCode, comp_uid);
    res.json({ ok: true, cat_code: catCode, CAT_CODE: catCode });
  } catch (err) {
    console.error('❌ cat-mast DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Cost Centre Master (VFP DO FORM COSTMAST → COST) ---
function normalizeCostMastCode(v) {
  return trimItemMasterField(v, 6).toUpperCase();
}

function normalizeCostMastAccountCode(v) {
  return trimItemMasterField(v, 6).toUpperCase();
}

function buildCostMastSavedJson(binds) {
  return {
    ok: true,
    COST_CODE: binds.cost_code,
    cost_code: binds.cost_code,
    COST_NAME: binds.cost_name,
    cost_name: binds.cost_name,
    CODE: binds.code,
    code: binds.code,
  };
}

function buildCostMastBinds(body, { comp_code, comp_year, user_name }) {
  const cost_code = normalizeCostMastCode(body.cost_code ?? body.COST_CODE);
  if (!cost_code) {
    const err = new Error('Cost centre code is required.');
    err.status = 400;
    throw err;
  }
  const cost_name = String(body.cost_name ?? body.COST_NAME ?? '')
    .trim()
    .toUpperCase();
  if (!cost_name) {
    const err = new Error('Cost centre name is required.');
    err.status = 400;
    throw err;
  }
  const code = normalizeCostMastAccountCode(body.code ?? body.CODE ?? '');
  return {
    comp_code,
    comp_year: Number(comp_year) || 0,
    cost_code,
    cost_name,
    code,
    user_name: String(user_name ?? '').trim(),
  };
}

async function fetchCostMastMasterList(comp_code, comp_uid, q) {
  const binds = { comp_code };
  let sql = `
    SELECT TRIM(A.COST_CODE) AS COST_CODE,
           NVL(A.COST_NAME, '') AS COST_NAME,
           TRIM(NVL(A.CODE, '')) AS CODE,
           NVL(B.NAME, '') AS AC_NAME
    FROM COST A
    LEFT JOIN MASTER B
      ON A.COMP_CODE = B.COMP_CODE
     AND TRIM(NVL(A.CODE, '')) = TRIM(NVL(B.CODE, ''))
    WHERE A.COMP_CODE = :comp_code`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      [
        'UPPER(A.COST_NAME)',
        'UPPER(TRIM(A.COST_CODE))',
        'UPPER(TRIM(NVL(A.CODE, \'\')))',
        'UPPER(NVL(B.NAME, \'\'))',
      ],
      'costq'
    );
  }
  sql += `
    ORDER BY UPPER(TRIM(A.COST_CODE)), UPPER(A.COST_NAME)`;
  try {
    return await runQuery(sql, binds, comp_uid);
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
    return [];
  }
}

async function fetchNextCostMastCode(comp_code, comp_uid) {
  try {
    const rows = await runQuery(
      `SELECT NVL(MAX(
        CASE WHEN REGEXP_LIKE(TRIM(COST_CODE), '^[0-9]+$')
             THEN TO_NUMBER(TRIM(COST_CODE)) ELSE NULL END
      ), 0) AS MAX_NO
       FROM COST WHERE COMP_CODE = :comp_code`,
      { comp_code },
      comp_uid
    );
    const maxNo = Math.trunc(Number(rows?.[0]?.MAX_NO ?? rows?.[0]?.max_no ?? 0) || 0);
    const next = String(maxNo + 1);
    return { next_code: next, NEXT_CODE: next, max_no: maxNo, MAX_NO: maxNo };
  } catch {
    const rows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM COST WHERE COMP_CODE = :comp_code`,
      { comp_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
    const next = String(cnt + 1);
    return { next_code: next, NEXT_CODE: next };
  }
}

async function countLedgerUsingCostCode(comp_code, cost_code, comp_uid) {
  const code = normalizeCostMastCode(cost_code);
  if (!code) return 0;
  const checks = [
    `SELECT COUNT(*) AS CNT FROM LEDGER
     WHERE COMP_CODE = :comp_code AND TRIM(NVL(COST_CODE, '')) = :cost_code`,
    `SELECT COUNT(*) AS CNT FROM VOUCHER
     WHERE COMP_CODE = :comp_code AND TRIM(NVL(COST_CODE, '')) = :cost_code`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, cost_code: code }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return cnt;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return 0;
}

async function masterAccountExists(comp_code, code, comp_uid) {
  const ac = normalizeCostMastAccountCode(code);
  if (!ac) return true;
  try {
    const rows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER
       WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code AND ROWNUM = 1`,
      { comp_code, code: ac },
      comp_uid
    );
    return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) > 0;
  } catch (err) {
    if (isOracleMissingObjectError(err)) return true;
    throw err;
  }
}

async function insertCostMastRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      INSERT INTO COST (COMP_CODE, COST_CODE, COST_NAME, CODE)
      VALUES (:comp_code, :cost_code, :cost_name, :code)`,
      binds: {
        comp_code: binds.comp_code,
        cost_code: binds.cost_code,
        cost_name: binds.cost_name,
        code: binds.code,
      },
    },
    {
      sql: `
      INSERT INTO COST (COMP_CODE, COMP_YEAR, COST_CODE, COST_NAME, CODE)
      VALUES (:comp_code, :comp_year, :cost_code, :cost_name, :code)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        cost_code: binds.cost_code,
        cost_name: binds.cost_name,
        code: binds.code,
      },
    },
    {
      sql: `
      INSERT INTO COST (COMP_CODE, COMP_YEAR, COST_CODE, COST_NAME, CODE, USER_NAME, ENT_DATE)
      VALUES (:comp_code, :comp_year, :cost_code, :cost_name, :code, :user_name, SYSDATE)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        cost_code: binds.cost_code,
        cost_name: binds.cost_name,
        code: binds.code,
        user_name: binds.user_name,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('COST insert failed');
}

async function updateCostMastRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      UPDATE COST SET COST_NAME = :cost_name, CODE = :code
      WHERE COMP_CODE = :comp_code AND TRIM(COST_CODE) = :cost_code`,
      binds: {
        comp_code: binds.comp_code,
        cost_code: binds.cost_code,
        cost_name: binds.cost_name,
        code: binds.code,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('COST update failed');
}

async function deleteCostMastByCode(comp_code, cost_code, comp_uid) {
  const code = normalizeCostMastCode(cost_code);
  await runQuery(
    `DELETE FROM COST WHERE COMP_CODE = :comp_code AND TRIM(COST_CODE) = :cost_code`,
    { comp_code, cost_code: code },
    comp_uid,
    { autoCommit: true }
  );
}

app.get('/api/cost-mast-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ cost-mast-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cost-mast-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchCostMastMasterList(comp_code, comp_uid, q);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ cost-mast-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cost-mast-next-code', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const data = await fetchNextCostMastCode(comp_code, comp_uid);
    res.json(data);
  } catch (err) {
    console.error('❌ cost-mast-next-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cost-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      binds = buildCostMastBinds(body, { comp_code, comp_year, user_name });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const acOk = await masterAccountExists(comp_code, binds.code, comp_uid);
    if (!acOk) {
      return res.status(400).json({ error: `Account code ${binds.code} not found in A/c Master.` });
    }

    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM COST
       WHERE COMP_CODE = :comp_code AND TRIM(COST_CODE) = :cost_code AND ROWNUM = 1`,
      { comp_code, cost_code: binds.cost_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) {
      return res.status(409).json({ error: 'Cost centre code already exists.' });
    }

    await insertCostMastRow(binds, comp_uid);
    res.json(buildCostMastSavedJson(binds));
  } catch (err) {
    console.error('❌ cost-mast POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cost-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    let binds;
    try {
      binds = buildCostMastBinds(body, { comp_code, comp_year, user_name });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    if (binds.cost_code === 'CLOSNG') {
      return res.status(403).json({ error: 'System cost centre CLOSNG cannot be edited.' });
    }

    const acOk = await masterAccountExists(comp_code, binds.code, comp_uid);
    if (!acOk) {
      return res.status(400).json({ error: `Account code ${binds.code} not found in A/c Master.` });
    }

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM COST
       WHERE COMP_CODE = :comp_code AND TRIM(COST_CODE) = :cost_code AND ROWNUM = 1`,
      { comp_code, cost_code: binds.cost_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Cost centre ${binds.cost_code} not found.` });
    }

    await updateCostMastRow(binds, comp_uid);
    res.json(buildCostMastSavedJson(binds));
  } catch (err) {
    console.error('❌ cost-mast PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cost-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const user_name = String(body.user_name ?? req.query.user_name ?? '').trim();
    const costCode = normalizeCostMastCode(body.cost_code ?? body.COST_CODE ?? req.query.cost_code);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name || !costCode) {
      return res.status(400).json({ error: 'comp_code, comp_uid, user_name, and cost_code are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    if (costCode === 'CLOSNG') {
      return res.status(403).json({ error: 'System cost centre CLOSNG cannot be deleted.' });
    }

    const ledCnt = await countLedgerUsingCostCode(comp_code, costCode, comp_uid);
    if (ledCnt > 0) {
      return res.status(409).json({
        error: 'Cannot delete — this cost centre is used in ledger/vouchers.',
      });
    }

    await deleteCostMastByCode(comp_code, costCode, comp_uid);
    res.json({ ok: true, cost_code: costCode, COST_CODE: costCode });
  } catch (err) {
    console.error('❌ cost-mast DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Bikri Exp Master (VFP DO FORM BIKEXP → BIKEXP) ---
const BIKEXP_NUM_FIELDS = [
  'ARHAT_B', 'ARHAT_K', 'ARHAT_H', 'ARHAT_A',
  'LABOUR_B', 'LABOUR_K', 'LABOUR_H', 'LABOUR_A',
  'DALA_B', 'DALA_K', 'DALA_H', 'DALA_A',
  'DALALI_B', 'DALALI_K', 'DALALI_H', 'DALALI_A',
  'POSTAGE_B', 'POSTAGE_K', 'POSTAGE_H', 'POSTAGE_A',
  'SUTLI_B', 'SUTLI_K', 'SUTLI_H', 'SUTLI_A',
  'DHARMADA', 'GAUSHALA', 'INSURANCE', 'MUDAT', 'AVG_DAYS',
  'TB_RATE_B', 'TB_RATE_K', 'TB_RATE_H', 'TB_AMT_A',
  'ST_PER', 'ST_AMT', 'SE_PER', 'SE_AMT',
  'TL_RATE_B', 'TL_RATE_K', 'TL_RATE_H', 'TL_AMT_A',
];
const BIKEXP_CD_FIELDS = [
  'ARHAT_CD', 'LABOUR_CD', 'DALA_CD', 'DALALI_CD', 'POSTAGE_CD', 'SUTLI_CD',
  'DHAR_CD', 'GAU_CD', 'INS_CD', 'MUDAT_CD', 'GODRENT_CD', 'GOD_RENT_CODE',
  'TB_CODE', 'ST_CODE', 'SE_CODE', 'TL_CODE',
];
/** Columns used in INSERT/UPDATE (Oracle may only have GOD_RENT_CODE, not GODRENT_CD). */
const BIKEXP_CD_WRITE = BIKEXP_CD_FIELDS.filter((c) => c !== 'GODRENT_CD');

function normalizeBikexpCat(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return s ? s.slice(0, 1) : '';
}

function normalizeBikexpNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeBikexpYn(v) {
  return String(v ?? '').trim().toUpperCase() === 'Y' ? 'Y' : 'N';
}

function normalizeBikexpCode(v) {
  return String(v ?? '').trim().toUpperCase().slice(0, 6);
}

function mapBikexpRow(row) {
  if (!row) return null;
  const out = {
    COMP_CODE: Number(row.COMP_CODE ?? row.comp_code ?? 0) || 0,
    COMP_YEAR: Number(row.COMP_YEAR ?? row.comp_year ?? 0) || 0,
    EXP_CAT: normalizeBikexpCat(row.EXP_CAT ?? row.exp_cat),
    GODRENT: normalizeBikexpYn(row.GODRENT ?? row.godrent),
  };
  for (const k of BIKEXP_NUM_FIELDS) {
    const v = row[k] ?? row[k.toLowerCase()];
    out[k] = v == null || v === '' ? null : Number(v);
  }
  for (const k of BIKEXP_CD_FIELDS) {
    const v = row[k] ?? row[k.toLowerCase()];
    out[k] = v == null || String(v).trim() === '' ? '' : normalizeBikexpCode(v);
  }
  if (out.GOD_RENT_CODE && !out.GODRENT_CD) out.GODRENT_CD = out.GOD_RENT_CODE;
  if (out.GODRENT_CD && !out.GOD_RENT_CODE) out.GOD_RENT_CODE = out.GODRENT_CD;
  return out;
}

function buildBikexpBinds(body, { comp_code, comp_year }) {
  const exp_cat = normalizeBikexpCat(body.exp_cat ?? body.EXP_CAT);
  if (!exp_cat) {
    const err = new Error('Expense category (Exp.Cat.) is required.');
    err.status = 400;
    throw err;
  }
  const binds = {
    comp_code: Number(comp_code ?? body.comp_code ?? body.COMP_CODE) || 0,
    comp_year: Number(comp_year ?? body.comp_year ?? body.COMP_YEAR) || 0,
    exp_cat,
    godrent: normalizeBikexpYn(body.godrent ?? body.GODRENT),
  };
  for (const k of BIKEXP_NUM_FIELDS) {
    const camel = k.toLowerCase();
    binds[k] = normalizeBikexpNum(body[k] ?? body[camel]);
  }
  for (const k of BIKEXP_CD_FIELDS) {
    const camel = k.toLowerCase();
    binds[k] = normalizeBikexpCode(body[k] ?? body[camel]) || null;
  }
  if (binds.GOD_RENT_CODE && !binds.GODRENT_CD) binds.GODRENT_CD = binds.GOD_RENT_CODE;
  if (binds.GODRENT_CD && !binds.GOD_RENT_CODE) binds.GOD_RENT_CODE = binds.GODRENT_CD;
  return binds;
}

function isBikexpMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

const bikexpSourceCache = new Map();
const bikexpColCache = new Map();

async function getBikexpColumns(comp_uid) {
  const key = comp_uid == null ? '__HUB__' : String(comp_uid).trim();
  if (bikexpColCache.has(key)) return bikexpColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'BIKEXP' ORDER BY COLUMN_ID`,
    {},
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase())
  );
  bikexpColCache.set(key, cols);
  return cols;
}

function mergeBikexpRows(primary, secondary) {
  if (!secondary) return primary;
  if (!primary) return secondary;
  const out = { ...primary };
  const keys = ['GODRENT', 'EXP_CAT', 'COMP_CODE', 'COMP_YEAR', ...BIKEXP_NUM_FIELDS, ...BIKEXP_CD_FIELDS];
  for (const k of keys) {
    const v = out[k];
    const empty = v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
    if (empty && secondary[k] != null && secondary[k] !== '') out[k] = secondary[k];
  }
  if (out.GOD_RENT_CODE && !out.GODRENT_CD) out.GODRENT_CD = out.GOD_RENT_CODE;
  if (out.GODRENT_CD && !out.GOD_RENT_CODE) out.GOD_RENT_CODE = out.GODRENT_CD;
  return out;
}

function bikexpDmlRowsAffected(result) {
  const ra = result?.rowsAffected;
  if (Array.isArray(ra)) return ra.reduce((s, n) => s + (Number(n) || 0), 0);
  return Number(ra) || 0;
}

function buildDynamicBikexpUpdate(binds, cols, match = 'full') {
  const sets = [];
  const b = {};
  if (cols.has('GODRENT')) {
    sets.push('GODRENT = :godrent');
    b.godrent = binds.godrent;
  }
  for (const k of BIKEXP_NUM_FIELDS) {
    if (cols.has(k)) {
      sets.push(`${k} = :${k}`);
      b[k] = binds[k];
    }
  }
  for (const k of BIKEXP_CD_WRITE) {
    if (cols.has(k)) {
      sets.push(`${k} = :${k}`);
      b[k] = binds[k];
    } else if (k === 'GOD_RENT_CODE' && cols.has('GODRENT_CD')) {
      sets.push('GODRENT_CD = :GOD_RENT_CODE');
      b.GOD_RENT_CODE = binds.GOD_RENT_CODE ?? binds.GODRENT_CD ?? null;
    }
  }
  if (!sets.length) {
    const err = new Error('BIKEXP table has no updatable columns.');
    err.status = 500;
    throw err;
  }
  b.comp_year = binds.comp_year;
  b.exp_cat = binds.exp_cat;
  let where;
  if (match === 'year_cat') {
    where = 'COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat';
  } else {
    b.comp_code = binds.comp_code;
    where = 'COMP_CODE = :comp_code AND COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat';
  }
  return { sql: `UPDATE BIKEXP SET ${sets.join(', ')} WHERE ${where}`, binds: b };
}

function buildDynamicBikexpInsert(binds, cols) {
  const colsIns = [];
  const ph = [];
  const b = {};
  const add = (col, bindKey, val) => {
    if (!cols.has(col)) return;
    colsIns.push(col);
    const key = bindKey || col;
    ph.push(col === 'GODRENT' ? ':godrent' : `:${key}`);
    b[key] = val;
  };
  add('COMP_CODE', 'comp_code', binds.comp_code);
  add('COMP_YEAR', 'comp_year', binds.comp_year);
  add('EXP_CAT', 'exp_cat', binds.exp_cat);
  add('GODRENT', 'godrent', binds.godrent);
  for (const k of BIKEXP_NUM_FIELDS) add(k, k, binds[k]);
  for (const k of BIKEXP_CD_WRITE) {
    if (cols.has(k)) add(k, k, binds[k]);
    else if (k === 'GOD_RENT_CODE' && cols.has('GODRENT_CD')) {
      colsIns.push('GODRENT_CD');
      ph.push(':GOD_RENT_CODE');
      b.GOD_RENT_CODE = binds.GOD_RENT_CODE ?? binds.GODRENT_CD ?? null;
    }
  }
  if (colsIns.length < 3) {
    const err = new Error('BIKEXP table missing required columns.');
    err.status = 500;
    throw err;
  }
  return {
    sql: `INSERT INTO BIKEXP (${colsIns.join(', ')}) VALUES (${ph.join(', ')})`,
    binds: b,
  };
}

async function upsertBikexpAt(binds, comp_uid, match = 'full') {
  const cols = await getBikexpColumns(comp_uid);
  let { sql, binds: b } = buildDynamicBikexpUpdate(binds, cols, match);
  let n = await runBikexpDml(sql, b, comp_uid);
  if (n === 0 && match === 'full') {
    ({ sql, binds: b } = buildDynamicBikexpUpdate(binds, cols, 'year_cat'));
    n = await runBikexpDml(sql, b, comp_uid);
  }
  if (n === 0) {
    const ins = buildDynamicBikexpInsert(binds, cols);
    try {
      await runBikexpDml(ins.sql, ins.binds, comp_uid);
    } catch (err) {
      if (!/unique constraint|ORA-00001/i.test(String(err?.message || ''))) throw err;
      ({ sql, binds: b } = buildDynamicBikexpUpdate(binds, cols, match));
      n = await runBikexpDml(sql, b, comp_uid);
      if (n === 0 && match === 'full') {
        ({ sql, binds: b } = buildDynamicBikexpUpdate(binds, cols, 'year_cat'));
        n = await runBikexpDml(sql, b, comp_uid);
      }
      if (n === 0) {
        const err2 = new Error('BIKEXP save did not update or insert any row.');
        err2.status = 409;
        throw err2;
      }
    }
  }
}

async function fetchBikexpHubRow(comp_code, comp_year, exp_cat) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const cat = normalizeBikexpCat(exp_cat);
  if (!cc || !cy || !cat) return null;
  try {
    const rows = await runQuery(
      `SELECT * FROM BIKEXP
       WHERE COMP_CODE = :comp_code AND COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat AND ROWNUM = 1`,
      { comp_code: cc, comp_year: cy, exp_cat: cat }
    );
    return rows?.[0] ? mapBikexpRow(rows[0]) : null;
  } catch (err) {
    if (!isBikexpMissingTableError(err)) throw err;
    return null;
  }
}

function bikexpCacheKey(comp_uid, comp_code, comp_year) {
  return `${String(comp_uid || '').trim()}|${Number(comp_code) || 0}|${Number(comp_year) || 0}`;
}

function invalidateBikexpSourceCache(comp_uid, comp_code, comp_year) {
  bikexpSourceCache.delete(bikexpCacheKey(comp_uid, comp_code, comp_year));
}

/** Prefer company BIKEXP when the table exists there (VFP G_DATA5); otherwise GRAINFAS hub. */
async function resolveBikexpSource(comp_code, comp_year, comp_uid) {
  const key = bikexpCacheKey(comp_uid, comp_code, comp_year);
  if (bikexpSourceCache.has(key)) return bikexpSourceCache.get(key);
  let source = 'hub';
  if (isEffectiveCompUid(comp_uid)) {
    try {
      const rows = await runQuery(
        'SELECT 1 AS OK FROM BIKEXP WHERE ROWNUM = 1',
        {},
        comp_uid,
        { suppressDbErrorLog: true }
      );
      if (rows?.length) source = 'company';
    } catch (err) {
      if (!isBikexpMissingTableError(err)) throw err;
    }
  }
  bikexpSourceCache.set(key, source);
  return source;
}

async function runBikexpDml(sql, binds, comp_uid) {
  let conn;
  const compEffective = isEffectiveCompUid(comp_uid);
  const connCfg = compEffective
    ? {
        user: String(comp_uid).trim(),
        password: String(comp_uid).trim(),
        connectString: activeDbConfig.connectString,
      }
    : activeDbConfig;
  try {
    conn = await oracledb.getConnection(connCfg);
    const result = await conn.execute(sql, binds, { autoCommit: true });
    return bikexpDmlRowsAffected(result);
  } catch (err) {
    console.error('❌ BIKEXP DML error:', err.message);
    throw err;
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.error(e);
      }
    }
  }
}

function bikexpWhereClause(match) {
  if (match === 'year_cat') {
    return 'COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat';
  }
  return 'COMP_CODE = :comp_code AND COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat';
}

function bikexpInsertSql() {
  const cols = ['COMP_CODE', 'COMP_YEAR', 'EXP_CAT', 'GODRENT', ...BIKEXP_NUM_FIELDS, ...BIKEXP_CD_FIELDS];
  const ph = cols.map((c) => (c === 'GODRENT' ? ':godrent' : `:${c}`));
  return `INSERT INTO BIKEXP (${cols.join(', ')}) VALUES (${ph.join(', ')})`;
}

function bikexpUpdateSql(match = 'full') {
  const sets = [
    'GODRENT = :godrent',
    ...BIKEXP_NUM_FIELDS.map((c) => `${c} = :${c}`),
    ...BIKEXP_CD_FIELDS.map((c) => `${c} = :${c}`),
  ];
  return `UPDATE BIKEXP SET ${sets.join(', ')} WHERE ${bikexpWhereClause(match)}`;
}

function bikexpDeleteSql(match = 'full') {
  return `DELETE FROM BIKEXP WHERE ${bikexpWhereClause(match)}`;
}

async function findBikexpLocation(comp_code, comp_year, exp_cat, comp_uid) {
  const cat = normalizeBikexpCat(exp_cat);
  if (!cat) return null;
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const fullBinds = { comp_code: cc, comp_year: cy, exp_cat: cat };
  const yearCatBinds = { comp_year: cy, exp_cat: cat };
  const fullSql = `SELECT * FROM BIKEXP
    WHERE COMP_CODE = :comp_code AND COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat AND ROWNUM = 1`;
  const yearCatSql = `SELECT * FROM BIKEXP
    WHERE COMP_YEAR = :comp_year AND EXP_CAT = :exp_cat AND ROWNUM = 1`;

  const source = await resolveBikexpSource(cc, cy, comp_uid);

  const hubRow = await fetchBikexpHubRow(cc, cy, cat);

  if (source === 'company' && isEffectiveCompUid(comp_uid)) {
    try {
      let rows = await runQuery(fullSql, fullBinds, comp_uid);
      if (rows?.length) {
        const row = mergeBikexpRows(mapBikexpRow(rows[0]), hubRow);
        return { row, source: 'company', match: 'full' };
      }
      rows = await runQuery(yearCatSql, yearCatBinds, comp_uid);
      if (rows?.length) {
        const row = mergeBikexpRows(mapBikexpRow(rows[0]), hubRow);
        return { row, source: 'company', match: 'year_cat' };
      }
    } catch (err) {
      if (!isBikexpMissingTableError(err)) throw err;
    }
    if (hubRow) return { row: hubRow, source: 'hub', match: 'full' };
    return null;
  }

  try {
    const rows = await runQuery(fullSql, fullBinds);
    if (rows?.length) {
      const row = mergeBikexpRows(mapBikexpRow(rows[0]), hubRow);
      return { row, source: 'hub', match: 'full' };
    }
  } catch (err) {
    if (!isBikexpMissingTableError(err)) throw err;
  }
  if (hubRow) return { row: hubRow, source: 'hub', match: 'full' };
  return null;
}

async function fetchBikexpRow(comp_code, comp_year, exp_cat, comp_uid) {
  const loc = await findBikexpLocation(comp_code, comp_year, exp_cat, comp_uid);
  return loc?.row ?? null;
}

async function fetchBikexpCatList(comp_code, comp_year, comp_uid) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const source = await resolveBikexpSource(cc, cy, comp_uid);

  if (source === 'company' && isEffectiveCompUid(comp_uid)) {
    try {
      const rows = await runQuery(
        `SELECT EXP_CAT FROM BIKEXP WHERE COMP_YEAR = :comp_year ORDER BY EXP_CAT`,
        { comp_year: cy },
        comp_uid
      );
      return rows
        .map((row) => normalizeBikexpCat(row.EXP_CAT ?? row.exp_cat))
        .filter(Boolean)
        .sort();
    } catch (err) {
      if (!isBikexpMissingTableError(err)) throw err;
    }
  }

  const rows = await runQuery(
    `SELECT EXP_CAT FROM BIKEXP WHERE COMP_CODE = :comp_code AND COMP_YEAR = :comp_year ORDER BY EXP_CAT`,
    { comp_code: cc, comp_year: cy }
  );
  return rows
    .map((row) => normalizeBikexpCat(row.EXP_CAT ?? row.exp_cat))
    .filter(Boolean)
    .sort();
}

function bikexpDmlBinds(binds, match = 'full', { forDelete = false } = {}) {
  if (forDelete) {
    if (match === 'year_cat') {
      return { comp_year: binds.comp_year, exp_cat: binds.exp_cat };
    }
    return {
      comp_code: binds.comp_code,
      comp_year: binds.comp_year,
      exp_cat: binds.exp_cat,
    };
  }
  const b = {
    comp_year: binds.comp_year,
    exp_cat: binds.exp_cat,
    godrent: binds.godrent,
  };
  if (match !== 'year_cat') b.comp_code = binds.comp_code;
  for (const k of BIKEXP_NUM_FIELDS) b[k] = binds[k];
  for (const k of BIKEXP_CD_WRITE) b[k] = binds[k];
  if (binds.GODRENT_CD != null && b.GOD_RENT_CODE == null) b.GOD_RENT_CODE = binds.GODRENT_CD;
  return b;
}

function invalidateBikexpCaches(comp_uid, comp_code, comp_year) {
  invalidateBikexpSourceCache(comp_uid, comp_code, comp_year);
  bikexpColCache.delete('__HUB__');
  if (isEffectiveCompUid(comp_uid)) bikexpColCache.delete(String(comp_uid).trim());
}

async function writeBikexpRow(binds, comp_uid, { isUpdate = false, match = 'full', preferSource } = {}) {
  const cc = binds.comp_code;
  const cy = binds.comp_year;

  // GRAINFAS.BIKEXP — schema-aware upsert (matches SQL*Plus / reports)
  await upsertBikexpAt(binds, null, 'full');

  const source = preferSource || (await resolveBikexpSource(cc, cy, comp_uid));
  if (source === 'company' && isEffectiveCompUid(comp_uid)) {
    await upsertBikexpAt(binds, comp_uid, isUpdate ? match : 'full');
    invalidateBikexpCaches(comp_uid, cc, cy);
    return 'both';
  }

  invalidateBikexpCaches(comp_uid, cc, cy);
  return 'hub';
}

async function insertBikexpRow(binds, comp_uid) {
  try {
    await writeBikexpRow(binds, comp_uid, { isUpdate: false });
    return true;
  } catch (err) {
    if (!/unique constraint|ORA-00001/i.test(String(err?.message || ''))) throw err;
    const e = new Error('Expense category already exists for this company/year.');
    e.status = 409;
    throw e;
  }
}

async function updateBikexpRow(binds, comp_uid, loc) {
  await writeBikexpRow(binds, comp_uid, {
    isUpdate: true,
    match: loc?.match || 'full',
    preferSource: loc?.source,
  });
}

async function deleteBikexpRow(comp_code, comp_year, exp_cat, comp_uid, loc) {
  const location =
    loc || (await findBikexpLocation(comp_code, comp_year, exp_cat, comp_uid));
  if (!location) {
    const err = new Error('Bikri expense record not found.');
    err.status = 404;
    throw err;
  }
  const cat = normalizeBikexpCat(exp_cat);
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const rowBinds = { comp_code: cc, comp_year: cy, exp_cat: cat };
  const sql = bikexpDeleteSql(location.match);
  const dmlBinds = bikexpDmlBinds(rowBinds, location.match, { forDelete: true });

  if (location.source === 'company' && isEffectiveCompUid(comp_uid)) {
    let n = await runBikexpDml(sql, dmlBinds, comp_uid);
    if (n === 0 && location.match === 'full') {
      n = await runBikexpDml(
        bikexpDeleteSql('year_cat'),
        bikexpDmlBinds(rowBinds, 'year_cat', { forDelete: true }),
        comp_uid
      );
    }
    if (n === 0) {
      const err = new Error('Delete did not remove any row.');
      err.status = 409;
      throw err;
    }
  } else {
    const n = await runBikexpDml(sql, dmlBinds, null);
    if (n === 0) {
      const err = new Error('Delete did not remove any row.');
      err.status = 409;
      throw err;
    }
  }
  try {
    await runBikexpDml(
      bikexpDeleteSql('full'),
      bikexpDmlBinds(rowBinds, 'full', { forDelete: true }),
      null
    );
  } catch (err) {
    if (!isBikexpMissingTableError(err)) throw err;
  }
  invalidateBikexpCaches(comp_uid, cc, cy);
}

app.get('/api/bikri-exp-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ bikri-exp-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bikri-exp-categories', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const comp_year = Number(req.query.comp_year ?? req.query.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || !comp_year) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and comp_year are required' });
    }
    const cats = await fetchBikexpCatList(comp_code, comp_year, comp_uid);
    res.json(cats);
  } catch (err) {
    console.error('❌ bikri-exp-categories error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bikri-exp-next-cat', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const comp_year = Number(req.query.comp_year ?? req.query.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || !comp_year) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and comp_year are required' });
    }
    const existing = new Set(await fetchBikexpCatList(comp_code, comp_year, comp_uid));
    const order = 'ABCDEFGHIJKLMZ';
    let next = '';
    for (const c of order) {
      if (!existing.has(c)) {
        next = c;
        break;
      }
    }
    res.json({ next_cat: next, NEXT_CAT: next, existing: [...existing] });
  } catch (err) {
    console.error('❌ bikri-exp-next-cat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bikri-exp', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const comp_year = Number(req.query.comp_year ?? req.query.compYear ?? 0) || 0;
    const exp_cat = normalizeBikexpCat(req.query.exp_cat ?? req.query.EXP_CAT);
    if (!comp_code || comp_uid == null || !comp_year || !exp_cat) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and exp_cat are required' });
    }
    const loc = await findBikexpLocation(comp_code, comp_year, exp_cat, comp_uid);
    if (!loc) return res.status(404).json({ error: 'Bikri expense record not found.' });
    res.json(loc.row);
  } catch (err) {
    console.error('❌ bikri-exp GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bikri-exp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || !user_name || !comp_year) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    const binds = buildBikexpBinds(body, { comp_code, comp_year });
    const existsLoc = await findBikexpLocation(comp_code, comp_year, binds.exp_cat, comp_uid);
    if (existsLoc) return res.status(409).json({ error: 'Expense category already exists.' });

    await insertBikexpRow(binds, comp_uid);
    const savedLoc = await findBikexpLocation(comp_code, comp_year, binds.exp_cat, comp_uid);
    res.json({
      ok: true,
      message: `Bikri Exp [${binds.exp_cat}] created successfully.`,
      ...(savedLoc?.row || {}),
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-exp POST error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/bikri-exp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || !user_name || !comp_year) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const binds = buildBikexpBinds(body, { comp_code, comp_year });
    const loc = await findBikexpLocation(comp_code, comp_year, binds.exp_cat, comp_uid);
    if (!loc) return res.status(404).json({ error: 'Bikri expense record not found.' });

    await updateBikexpRow(binds, comp_uid, loc);
    const savedLoc = await findBikexpLocation(comp_code, comp_year, binds.exp_cat, comp_uid);
    res.json({
      ok: true,
      message: `Bikri Exp [${binds.exp_cat}] updated successfully.`,
      ...(savedLoc?.row || {}),
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-exp PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/bikri-exp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query?.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query?.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? req.query?.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? req.query?.comp_year ?? 0) || 0;
    const exp_cat = normalizeBikexpCat(body.exp_cat ?? body.EXP_CAT ?? req.query?.exp_cat);
    if (!comp_code || comp_uid == null || !user_name || !comp_year || !exp_cat) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, exp_cat, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const loc = await findBikexpLocation(comp_code, comp_year, exp_cat, comp_uid);
    if (!loc) return res.status(404).json({ error: 'Bikri expense record not found.' });

    await deleteBikexpRow(comp_code, comp_year, exp_cat, comp_uid, loc);
    res.json({
      ok: true,
      message: `Bikri Exp [${exp_cat}] deleted successfully.`,
      exp_cat,
      EXP_CAT: exp_cat,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-exp DELETE error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Godown Rent Master (VFP DO GODRENT → GODRENT) ---
function normalizeGodrentNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function mapGodrentRow(row) {
  if (!row) return null;
  return {
    COMP_CODE: Number(row.COMP_CODE ?? row.comp_code ?? 0) || 0,
    COMP_YEAR: Number(row.COMP_YEAR ?? row.comp_year ?? 0) || 0,
    DAYS1: Number(row.DAYS1 ?? row.days1 ?? 0) || 0,
    DAYS2: Number(row.DAYS2 ?? row.days2 ?? 0) || 0,
    RENT1: normalizeGodrentNum(row.RENT1 ?? row.rent1),
    RENT2: normalizeGodrentNum(row.RENT2 ?? row.rent2),
    RENT3: normalizeGodrentNum(row.RENT3 ?? row.rent3),
  };
}

function isGodrentMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryGodrentRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isGodrentMissingTableError(err)) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchGodrentList(comp_code, comp_year, comp_uid) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const sql = `
    SELECT COMP_CODE, COMP_YEAR, DAYS1, DAYS2,
           NVL(RENT1, 0) AS RENT1, NVL(RENT2, 0) AS RENT2, NVL(RENT3, 0) AS RENT3
    FROM GODRENT
    WHERE COMP_CODE = :comp_code AND COMP_YEAR = :comp_year
    ORDER BY DAYS1`;
  const rows = await queryGodrentRows(sql, { comp_code: cc, comp_year: cy }, comp_uid);
  return (rows || []).map(mapGodrentRow).filter((r) => r.DAYS1 > 0 || r.DAYS2 > 0);
}

function normalizeGodrentSaveRows(rows, comp_code, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const out = [];
  for (const raw of rows || []) {
    const days1 = Math.trunc(Number(raw.DAYS1 ?? raw.days1 ?? 0) || 0);
    const days2 = Math.trunc(Number(raw.DAYS2 ?? raw.days2 ?? 0) || 0);
    if (days1 === 0 && days2 === 0) continue;
    out.push({
      comp_code: cc,
      comp_year: cy,
      days1,
      days2,
      rent1: normalizeGodrentNum(raw.RENT1 ?? raw.rent1) ?? 0,
      rent2: normalizeGodrentNum(raw.RENT2 ?? raw.rent2) ?? 0,
      rent3: normalizeGodrentNum(raw.RENT3 ?? raw.rent3) ?? 0,
    });
  }
  out.sort((a, b) => a.days1 - b.days1);
  return out;
}

async function saveGodrentList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const normalized = normalizeGodrentSaveRows(rows, cc, cy);
  const deleteSql = `DELETE FROM GODRENT WHERE COMP_CODE = :comp_code AND COMP_YEAR = :comp_year`;
  const insertSql = `
    INSERT INTO GODRENT (COMP_CODE, COMP_YEAR, DAYS1, DAYS2, RENT1, RENT2, RENT3)
    VALUES (:comp_code, :comp_year, :days1, :days2, :rent1, :rent2, :rent3)`;
  const delBinds = { comp_code: cc, comp_year: cy };

  async function applyOnSchema(schema) {
    await runQuery(deleteSql, delBinds, schema, { autoCommit: true });
    for (const r of normalized) {
      await runQuery(insertSql, r, schema, { autoCommit: true });
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return 'company';
    } catch (err) {
      if (!isGodrentMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  return 'hub';
}

app.get('/api/godrent-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ godrent-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/godrent', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const comp_year = Number(req.query.comp_year ?? req.query.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || !comp_year) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and comp_year are required' });
    }
    const rows = await fetchGodrentList(comp_code, comp_year, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ godrent GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/godrent', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name || !comp_year) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveGodrentList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchGodrentList(comp_code, comp_year, comp_uid);
    res.json({
      ok: true,
      message: 'Godown rent saved successfully.',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ godrent PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Customer Interest (VFP DO CUSTINT → NEWINT) ---
function normalizeNewintNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeNewintType(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return '';
  return s.charAt(0);
}

/** ISO yyyy-mm-dd or DD-MM-YYYY / DD/MM/YYYY → JS Date or null */
function parseNewintDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (!m) return null;
  let dd = Number(m[1]);
  let mm = Number(m[2]);
  let yy = Number(m[3]);
  if (yy < 100) yy += 2000;
  const d = new Date(yy, mm - 1, dd);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatNewintDateOut(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = parseNewintDate(s);
  return parsed ? formatNewintDateOut(parsed) : '';
}

function mapNewintRow(row) {
  if (!row) return null;
  return {
    COMP_CODE: Number(row.COMP_CODE ?? row.comp_code ?? 0) || 0,
    COMP_YEAR: Number(row.COMP_YEAR ?? row.comp_year ?? 0) || 0,
    DATE1: formatNewintDateOut(row.DATE1 ?? row.date1),
    DATE2: formatNewintDateOut(row.DATE2 ?? row.date2),
    DATE3: formatNewintDateOut(row.DATE3 ?? row.date3),
    DAY1: Math.trunc(Number(row.DAY1 ?? row.day1 ?? 0) || 0),
    DAY2: Math.trunc(Number(row.DAY2 ?? row.day2 ?? 0) || 0),
    TYPE: normalizeNewintType(row.TYPE ?? row.type),
    NRATE: normalizeNewintNum(row.NRATE ?? row.nrate),
    ORATE: normalizeNewintNum(row.ORATE ?? row.orate),
    GDAYS: Math.trunc(Number(row.GDAYS ?? row.gdays ?? 0) || 0),
    EDAYS: Math.trunc(Number(row.EDAYS ?? row.edays ?? 0) || 0),
  };
}

function isNewintMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryNewintRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isNewintMissingTableError(err)) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchNewintList(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT COMP_CODE, COMP_YEAR,
           DATE1, DATE2, DATE3,
           NVL(DAY1, 0) AS DAY1, NVL(DAY2, 0) AS DAY2,
           NVL(TRIM(TYPE), '') AS TYPE,
           NVL(NRATE, 0) AS NRATE, NVL(ORATE, 0) AS ORATE,
           NVL(GDAYS, 0) AS GDAYS, NVL(EDAYS, 0) AS EDAYS
    FROM NEWINT
    WHERE COMP_CODE = :comp_code
    ORDER BY TYPE, DAY1, DAY2`;
  const rows = await queryNewintRows(sql, { comp_code: cc }, comp_uid);
  return (rows || []).map(mapNewintRow).filter((r) => {
    return (
      r.DAY1 > 0 ||
      r.DAY2 > 0 ||
      r.TYPE ||
      r.DATE1 ||
      r.DATE2 ||
      r.DATE3 ||
      r.NRATE !== 0 ||
      r.ORATE !== 0 ||
      r.GDAYS !== 0 ||
      r.EDAYS !== 0
    );
  });
}

function normalizeNewintSaveRows(rows, comp_code, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const out = [];
  for (const raw of rows || []) {
    const day1 = Math.trunc(Number(raw.DAY1 ?? raw.day1 ?? 0) || 0);
    const day2 = Math.trunc(Number(raw.DAY2 ?? raw.day2 ?? 0) || 0);
    const type = normalizeNewintType(raw.TYPE ?? raw.type);
    const date1 = parseNewintDate(raw.DATE1 ?? raw.date1);
    const date2 = parseNewintDate(raw.DATE2 ?? raw.date2);
    const date3 = parseNewintDate(raw.DATE3 ?? raw.date3);
    const orate = normalizeNewintNum(raw.ORATE ?? raw.orate);
    const nrate = normalizeNewintNum(raw.NRATE ?? raw.nrate);
    const gdays = Math.trunc(Number(raw.GDAYS ?? raw.gdays ?? 0) || 0);
    const edays = Math.trunc(Number(raw.EDAYS ?? raw.edays ?? 0) || 0);
    if (!type && !day1 && !day2 && !date1 && !date2 && !date3 && !orate && !nrate && !gdays && !edays) {
      continue;
    }
    out.push({
      comp_code: cc,
      comp_year: cy,
      date1,
      date2,
      date3,
      day1,
      day2,
      type,
      nrate,
      orate,
      gdays,
      edays,
    });
  }
  out.sort((a, b) => {
    const tc = String(a.type).localeCompare(String(b.type));
    if (tc !== 0) return tc;
    if (a.day1 !== b.day1) return a.day1 - b.day1;
    return a.day2 - b.day2;
  });
  return out;
}

async function saveNewintList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const normalized = normalizeNewintSaveRows(rows, cc, cy);
  const deleteSql = `DELETE FROM NEWINT WHERE COMP_CODE = :comp_code`;
  const insertSql = `
    INSERT INTO NEWINT (
      COMP_CODE, COMP_YEAR, DATE1, DATE2, DATE3,
      DAY1, DAY2, TYPE, NRATE, ORATE, GDAYS, EDAYS
    ) VALUES (
      :comp_code, :comp_year, :date1, :date2, :date3,
      :day1, :day2, :type, :nrate, :orate, :gdays, :edays
    )`;

  async function applyOnSchema(schema) {
    await runQuery(deleteSql, { comp_code: cc }, schema, { autoCommit: true });
    for (const r of normalized) {
      await runQuery(insertSql, r, schema, { autoCommit: true });
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return 'company';
    } catch (err) {
      if (!isNewintMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  return 'hub';
}

app.get('/api/customer-interest-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ customer-interest-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customer-interest', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const comp_year = Number(req.query.comp_year ?? req.query.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchNewintList(comp_code, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ customer-interest GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customer-interest', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveNewintList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchNewintList(comp_code, comp_uid);
    res.json({
      ok: true,
      message: 'Customer interest saved successfully.',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ customer-interest PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Holiday Master (VFP DO HOLIDAY → HOLIDAY) ---
function isHolidayMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryHolidayRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isHolidayMissingTableError(err)) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

function formatHolidayDateOut(v) {
  return formatNewintDateOut(v);
}

function parseHolidayDate(v) {
  return parseNewintDate(v);
}

function mapHolidayRow(row) {
  const cc = Number(row.COMP_CODE ?? row.comp_code ?? 0) || 0;
  const cy = Number(row.COMP_YEAR ?? row.comp_year ?? 0) || 0;
  return {
    COMP_CODE: cc,
    COMP_YEAR: cy,
    S_DATE: formatHolidayDateOut(row.S_DATE ?? row.s_date),
  };
}

async function fetchHolidayList(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT COMP_CODE, COMP_YEAR, TRUNC(S_DATE) AS S_DATE
    FROM HOLIDAY
    WHERE COMP_CODE = :comp_code
    ORDER BY S_DATE`;
  const rows = await queryHolidayRows(sql, { comp_code: cc }, comp_uid);
  return (rows || []).map(mapHolidayRow).filter((r) => r.S_DATE);
}

function normalizeHolidaySaveRows(rows, comp_code, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const seen = new Set();
  const out = [];
  for (const raw of rows || []) {
    const d = parseHolidayDate(raw.S_DATE ?? raw.s_date);
    if (!d) continue;
    const key = formatHolidayDateOut(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ comp_code: cc, comp_year: cy, s_date: d });
  }
  out.sort((a, b) => a.s_date.getTime() - b.s_date.getTime());
  return out;
}

async function saveHolidayList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const normalized = normalizeHolidaySaveRows(rows, cc, cy);
  const deleteSql = `DELETE FROM HOLIDAY WHERE COMP_CODE = :comp_code`;
  const insertSql = `
    INSERT INTO HOLIDAY (COMP_CODE, COMP_YEAR, S_DATE)
    VALUES (:comp_code, :comp_year, :s_date)`;
  const delBinds = { comp_code: cc };

  async function applyOnSchema(schema) {
    await runQuery(deleteSql, delBinds, schema, { autoCommit: true });
    for (const r of normalized) {
      await runQuery(insertSql, r, schema, { autoCommit: true });
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return 'company';
    } catch (err) {
      if (!isHolidayMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  return 'hub';
}

app.get('/api/holiday-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ holiday-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/holiday', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchHolidayList(comp_code, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ holiday GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/holiday', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveHolidayList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchHolidayList(comp_code, comp_uid);
    res.json({
      ok: true,
      message: 'Holiday calendar saved successfully.',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ holiday PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Dane Master (VFP DO DANE → DANE) ---
/** Oracle DANE.BAGS / KATTA / HKATTA are NUMBER(5,3) — max magnitude 99.999 */
const DANE_QTY_MAX = 99.999;
const DANE_QTY_MIN = -99.999;

function normalizeDaneQty(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(DANE_QTY_MIN, Math.min(DANE_QTY_MAX, n));
  return Math.round(clamped * 1000) / 1000;
}

function mapDaneRow(row) {
  return {
    DANE: String(row.DANE ?? row.dane ?? '').trim().slice(0, 1),
    BAGS: normalizeDaneQty(row.BAGS ?? row.bags),
    KATTA: normalizeDaneQty(row.KATTA ?? row.katta),
    HKATTA: normalizeDaneQty(row.HKATTA ?? row.hkatta),
    DEF_VALUE: String(row.DEF_VALUE ?? row.def_value ?? '').trim().slice(0, 1),
  };
}

function isDaneMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryDaneRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isDaneMissingTableError(err)) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchDaneList(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT COMP_CODE, COMP_YEAR, DANE,
           CAST(NVL(BAGS, 0) AS NUMBER(5, 3)) AS BAGS,
           CAST(NVL(KATTA, 0) AS NUMBER(5, 3)) AS KATTA,
           CAST(NVL(HKATTA, 0) AS NUMBER(5, 3)) AS HKATTA,
           NVL(DEF_VALUE, '') AS DEF_VALUE
    FROM DANE
    WHERE COMP_CODE = :comp_code
    ORDER BY DANE`;
  const rows = await queryDaneRows(sql, { comp_code: cc }, comp_uid);
  return (rows || []).map(mapDaneRow).filter((r) => r.DANE);
}

function normalizeDaneSaveRows(rows, comp_code, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const out = [];
  for (const raw of rows || []) {
    const mapped = mapDaneRow(raw);
    if (!mapped.DANE) continue;
    out.push({
      comp_code: cc,
      comp_year: cy,
      dane: mapped.DANE,
      bags: mapped.BAGS,
      katta: mapped.KATTA,
      hkatta: mapped.HKATTA,
      def_value: mapped.DEF_VALUE,
    });
  }
  out.sort((a, b) => String(a.dane).localeCompare(String(b.dane)));
  return out;
}

async function saveDaneList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const normalized = normalizeDaneSaveRows(rows, cc, cy);
  const deleteSql = `DELETE FROM DANE WHERE COMP_CODE = :comp_code`;
  const insertSql = `
    INSERT INTO DANE (COMP_CODE, COMP_YEAR, DANE, BAGS, KATTA, HKATTA, DEF_VALUE)
    VALUES (:comp_code, :comp_year, :dane, :bags, :katta, :hkatta, :def_value)`;
  const delBinds = { comp_code: cc };

  async function applyOnSchema(schema) {
    await runQuery(deleteSql, delBinds, schema, { autoCommit: true });
    for (const r of normalized) {
      await runQuery(insertSql, r, schema, { autoCommit: true });
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return 'company';
    } catch (err) {
      if (!isDaneMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  return 'hub';
}

app.get('/api/dane-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ dane-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dane', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchDaneList(comp_code, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ dane GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/dane', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveDaneList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchDaneList(comp_code, comp_uid);
    res.json({
      ok: true,
      message: 'Dane master saved successfully.',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ dane PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Marka Master (VFP DO FORM MARKA → MARKA) ---
/** Oracle MARKA: MARKA C(30), MIN_RATE/MAX_RATE/LAB_RATE NUMBER(8,2). */
const MARKA_NAME_MAX_LEN = 30;
const MARKA_RATE_MAX = 999999.99;
const MARKA_RATE_MIN = -999999.99;

function normalizeMarkaName(v) {
  return String(v ?? '')
    .trim()
    .slice(0, MARKA_NAME_MAX_LEN);
}

function normalizeMarkaRate(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) {
    const err = new Error('Invalid rate value.');
    err.status = 400;
    throw err;
  }
  const clamped = Math.max(MARKA_RATE_MIN, Math.min(MARKA_RATE_MAX, n));
  return Math.round(clamped * 100) / 100;
}

function mapMarkaRow(r) {
  return {
    MARKA: normalizeMarkaName(r.MARKA ?? r.marka),
    marka: normalizeMarkaName(r.MARKA ?? r.marka),
    MIN_RATE: normalizeMarkaRate(r.MIN_RATE ?? r.min_rate ?? 0),
    min_rate: normalizeMarkaRate(r.MIN_RATE ?? r.min_rate ?? 0),
    MAX_RATE: normalizeMarkaRate(r.MAX_RATE ?? r.max_rate ?? 0),
    max_rate: normalizeMarkaRate(r.MAX_RATE ?? r.max_rate ?? 0),
    LAB_RATE: normalizeMarkaRate(r.LAB_RATE ?? r.lab_rate ?? 0),
    lab_rate: normalizeMarkaRate(r.LAB_RATE ?? r.lab_rate ?? 0),
  };
}

function buildMarkaSavedJson(binds) {
  return {
    ok: true,
    MARKA: binds.marka,
    marka: binds.marka,
    MIN_RATE: binds.min_rate,
    min_rate: binds.min_rate,
    MAX_RATE: binds.max_rate,
    max_rate: binds.max_rate,
    LAB_RATE: binds.lab_rate,
    lab_rate: binds.lab_rate,
  };
}

function buildMarkaBinds(body, { comp_code, comp_year }) {
  const marka = normalizeMarkaName(body.marka ?? body.MARKA);
  if (!marka) {
    const err = new Error('Marka is required.');
    err.status = 400;
    throw err;
  }
  return {
    comp_code,
    comp_year: Number(comp_year) || 0,
    marka,
    min_rate: normalizeMarkaRate(body.min_rate ?? body.MIN_RATE),
    max_rate: normalizeMarkaRate(body.max_rate ?? body.MAX_RATE),
    lab_rate: normalizeMarkaRate(body.lab_rate ?? body.LAB_RATE),
  };
}

async function fetchMarkaMasterList(comp_code, comp_uid, q) {
  const binds = { comp_code };
  let sql = `
    SELECT TRIM(MARKA) AS MARKA,
           NVL(MIN_RATE, 0) AS MIN_RATE,
           NVL(MAX_RATE, 0) AS MAX_RATE,
           NVL(LAB_RATE, 0) AS LAB_RATE
    FROM MARKA
    WHERE COMP_CODE = :comp_code`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(sql, binds, qTrim, ['UPPER(TRIM(MARKA))'], 'markaq');
  }
  sql += ` ORDER BY UPPER(TRIM(MARKA))`;
  try {
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map(mapMarkaRow).filter((r) => r.MARKA);
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
    return [];
  }
}

async function markaExists(comp_code, marka, comp_uid) {
  const name = normalizeMarkaName(marka);
  if (!name) return false;
  try {
    const rows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MARKA
       WHERE COMP_CODE = :comp_code AND UPPER(TRIM(MARKA)) = UPPER(TRIM(:marka)) AND ROWNUM = 1`,
      { comp_code, marka: name },
      comp_uid
    );
    return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) > 0;
  } catch (err) {
    if (isOracleMissingObjectError(err)) return false;
    throw err;
  }
}

async function countSaleUsingMarka(comp_code, marka, comp_uid) {
  const name = normalizeMarkaName(marka);
  if (!name) return 0;
  const checks = [
    `SELECT COUNT(*) AS CNT FROM SALE
     WHERE COMP_CODE = :comp_code AND UPPER(TRIM(NVL(MARKA, ''))) = UPPER(TRIM(:marka))`,
    `SELECT COUNT(*) AS CNT FROM SALE
     WHERE COMP_CODE = :comp_code AND TRIM(NVL(MARKA, '')) = TRIM(:marka)`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, marka: name }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return cnt;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return 0;
}

async function insertMarkaRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      INSERT INTO MARKA (COMP_CODE, COMP_YEAR, MARKA, MIN_RATE, MAX_RATE, LAB_RATE)
      VALUES (:comp_code, :comp_year, :marka, :min_rate, :max_rate, :lab_rate)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        marka: binds.marka,
        min_rate: binds.min_rate,
        max_rate: binds.max_rate,
        lab_rate: binds.lab_rate,
      },
    },
    {
      sql: `
      INSERT INTO MARKA (COMP_CODE, MARKA, MIN_RATE, MAX_RATE, LAB_RATE)
      VALUES (:comp_code, :marka, :min_rate, :max_rate, :lab_rate)`,
      binds: {
        comp_code: binds.comp_code,
        marka: binds.marka,
        min_rate: binds.min_rate,
        max_rate: binds.max_rate,
        lab_rate: binds.lab_rate,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('MARKA insert failed');
}

async function deleteMarkaByName(comp_code, marka, comp_uid) {
  const name = normalizeMarkaName(marka);
  await runQuery(
    `DELETE FROM MARKA WHERE COMP_CODE = :comp_code AND UPPER(TRIM(MARKA)) = UPPER(TRIM(:marka))`,
    { comp_code, marka: name },
    comp_uid,
    { autoCommit: true }
  );
}

app.get('/api/marka-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ marka-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/marka-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchMarkaMasterList(comp_code, comp_uid, q);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ marka-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/marka', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      binds = buildMarkaBinds(body, { comp_code, comp_year });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    if (await markaExists(comp_code, binds.marka, comp_uid)) {
      return res.status(409).json({ error: 'Marka already exists.' });
    }

    await insertMarkaRow(binds, comp_uid);
    res.json(buildMarkaSavedJson(binds));
  } catch (err) {
    console.error('❌ marka POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/marka', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const original_marka = normalizeMarkaName(body.original_marka ?? body.ORIGINAL_MARKA ?? body.marka ?? body.MARKA);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!original_marka) {
      return res.status(400).json({ error: 'original_marka is required for edit.' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    let binds;
    try {
      binds = buildMarkaBinds(body, { comp_code, comp_year });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    if (!(await markaExists(comp_code, original_marka, comp_uid))) {
      return res.status(404).json({ error: `Marka ${original_marka} not found.` });
    }

    await deleteMarkaByName(comp_code, original_marka, comp_uid);
    await insertMarkaRow(binds, comp_uid);
    res.json(buildMarkaSavedJson(binds));
  } catch (err) {
    console.error('❌ marka PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/marka', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const marka = normalizeMarkaName(body.marka ?? body.MARKA);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name || !marka) {
      return res.status(400).json({ error: 'comp_code, comp_uid, user_name, and marka are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    if (!(await markaExists(comp_code, marka, comp_uid))) {
      return res.status(404).json({ error: `Marka ${marka} not found.` });
    }

    const saleCnt = await countSaleUsingMarka(comp_code, marka, comp_uid);
    if (saleCnt > 0) {
      return res.status(409).json({ error: 'Entries already exist in SALE — cannot delete.' });
    }

    await deleteMarkaByName(comp_code, marka, comp_uid);
    res.json({ ok: true, marka });
  } catch (err) {
    console.error('❌ marka DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Purchase Exp Master (VFP DO FORM PUREXP → PUREXP; form title Tdsnat) ---
/** Oracle PUREXP: EXP_NAME, EXP_RATE, CAL_TYPE (Q/A/W), CODE (A/c). */
const PUR_EXP_TABLE = 'PUREXP';
const PUR_EXP_NAME_MAX = 40;
const PUR_EXP_RATE_MAX = 999999.99;
const PUR_EXP_CAL_VALUES = new Set(['Q', 'A', 'W']);

function normalizePurExpName(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, PUR_EXP_NAME_MAX);
}

/** PUREXP may store legacy numeric codes; MASTER uses 1 letter + 5 digits (e.g. O06004). */
function purExpLegacyMasterCode(code) {
  const c = String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
  if (!c) return '';
  if (/^[A-Z]\d{5}$/.test(c)) return c;
  if (/^\d+$/.test(c)) {
    const n = parseInt(c, 10);
    if (!Number.isFinite(n) || n < 0) return c;
    return `O${String(n).padStart(5, '0').slice(-5)}`;
  }
  return c;
}

function normalizePurExpCode(v) {
  const c = String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
  if (!c) return '';
  return purExpLegacyMasterCode(c) || c;
}

function normalizePurExpCal(v) {
  const c = String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  if (!c) return '';
  if (PUR_EXP_CAL_VALUES.has(c)) return c;
  const err = new Error('CAL must be Q (Qty), A (Amount), or W (Weight).');
  err.status = 400;
  throw err;
}

function normalizePurExpRate(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) {
    const err = new Error('Invalid expense rate.');
    err.status = 400;
    throw err;
  }
  return Math.round(Math.max(-PUR_EXP_RATE_MAX, Math.min(PUR_EXP_RATE_MAX, n)) * 100) / 100;
}

function mapPurExpRow(row) {
  const calRaw =
    row.CAL ??
    row.cal ??
    row.CAL_TYPE ??
    row.cal_type ??
    row.CAL_QAW ??
    row.cal_qaw ??
    '';
  return {
    EXP_NAME: normalizePurExpName(row.EXP_NAME ?? row.exp_name),
    exp_name: normalizePurExpName(row.EXP_NAME ?? row.exp_name),
    EXP_RATE: normalizePurExpRate(row.EXP_RATE ?? row.exp_rate ?? 0),
    exp_rate: normalizePurExpRate(row.EXP_RATE ?? row.exp_rate ?? 0),
    CAL: String(calRaw ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 1),
    cal: String(calRaw ?? '')
      .trim()
      .toUpperCase()
      .slice(0, 1),
    CODE: normalizePurExpCode(row.CODE ?? row.code),
    code: normalizePurExpCode(row.CODE ?? row.code),
    AC_NAME: String(row.AC_NAME ?? row.ac_name ?? '').trim(),
    ac_name: String(row.AC_NAME ?? row.ac_name ?? '').trim(),
  };
}

function isPurExpMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryPurExpRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPurExpMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchPurExpList(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT TRIM(T.EXP_NAME) AS EXP_NAME,
           NVL(T.EXP_RATE, 0) AS EXP_RATE,
           TRIM(NVL(T.CAL_TYPE, '')) AS CAL,
           TRIM(NVL(T.CODE, '')) AS CODE,
           NVL(M.NAME, '') AS AC_NAME
    FROM ${PUR_EXP_TABLE} T
    LEFT JOIN MASTER M
      ON T.COMP_CODE = M.COMP_CODE
     AND (
       TRIM(NVL(T.CODE, '')) = TRIM(NVL(M.CODE, ''))
       OR (
         REGEXP_LIKE(TRIM(T.CODE), '^[0-9]+$')
         AND TRIM(M.CODE) = 'O' || SUBSTR(LPAD(TRIM(T.CODE), 6, '0'), 2, 5)
       )
     )
    WHERE T.COMP_CODE = :comp_code
    ORDER BY UPPER(TRIM(T.EXP_NAME))`;
  try {
    const rows = await queryPurExpRows(sql, { comp_code: cc }, comp_uid);
    return (rows || []).map(mapPurExpRow).filter((r) => r.EXP_NAME);
  } catch (err) {
    if (isPurExpMissingTableError(err)) return [];
    throw err;
  }
}

function normalizePurExpSaveRows(rows, comp_code, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const seen = new Set();
  const out = [];
  for (const raw of rows || []) {
    const name = normalizePurExpName(raw.EXP_NAME ?? raw.exp_name);
    if (!name) continue;
    if (seen.has(name)) {
      const err = new Error(`Duplicate expense name: ${name}`);
      err.status = 400;
      throw err;
    }
    seen.add(name);
    const cal = normalizePurExpCal(raw.CAL ?? raw.cal);
    const code = normalizePurExpCode(raw.CODE ?? raw.code);
    out.push({
      comp_code: cc,
      comp_year: cy,
      exp_name: name,
      exp_rate: normalizePurExpRate(raw.EXP_RATE ?? raw.exp_rate),
      cal,
      code,
    });
  }
  out.sort((a, b) => String(a.exp_name).localeCompare(String(b.exp_name)));
  return out;
}

async function savePurExpList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const normalized = normalizePurExpSaveRows(rows, cc, cy);
  const deleteSql = `DELETE FROM ${PUR_EXP_TABLE} WHERE COMP_CODE = :comp_code`;
  const insertSql = `
    INSERT INTO ${PUR_EXP_TABLE} (COMP_CODE, COMP_YEAR, EXP_NAME, EXP_RATE, CAL_TYPE, CODE)
    VALUES (:comp_code, :comp_year, :exp_name, :exp_rate, :cal, :code)`;

  const delBinds = { comp_code: cc };
  let storage = 'company';
  const applyOnSchema = async (uid) => {
    await runQuery(deleteSql, delBinds, uid, { autoCommit: true });
    for (const row of normalized) {
      const binds = {
        comp_code: cc,
        comp_year: cy,
        exp_name: row.exp_name,
        exp_rate: row.exp_rate,
        cal: row.cal,
        code: row.code,
      };
      await runQuery(insertSql, binds, uid, { autoCommit: true });
    }
  };

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return storage;
    } catch (err) {
      if (!isPurExpMissingTableError(err)) throw err;
    }
  }
  storage = 'hub';
  await applyOnSchema(null);
  return storage;
}

app.get('/api/pur-exp-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ pur-exp-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pur-exp', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchPurExpList(comp_code, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ pur-exp GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pur-exp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await savePurExpList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchPurExpList(comp_code, comp_uid);
    res.json({
      ok: true,
      message: 'Purchase expense master saved successfully.',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ pur-exp PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Sale Bill Condition (VFP DO SALECOND → SALE_COND, COND1..COND7) ---
const SALE_COND_COUNT = 7;
const SALE_COND_TEXT_MAX = 150;

function normalizeSaleCondText(v) {
  return String(v ?? '')
    .trim()
    .slice(0, SALE_COND_TEXT_MAX);
}

function saleCondListFromDbRow(row) {
  const r = row || {};
  const list = [];
  for (let i = 1; i <= SALE_COND_COUNT; i++) {
    const v = rowValueCI(r, `COND${i}`) ?? rowValueCI(r, `COND_${i}`) ?? '';
    list.push(normalizeSaleCondText(v));
  }
  return list;
}

function saleCondApiRows(list) {
  const conds = Array.isArray(list) ? list : [];
  return Array.from({ length: SALE_COND_COUNT }, (_, i) => ({
    NO: i + 1,
    no: i + 1,
    COND: normalizeSaleCondText(conds[i]),
    cond: normalizeSaleCondText(conds[i]),
  }));
}

function normalizeSaleCondSaveRows(rows) {
  const byNo = new Map();
  for (const raw of rows || []) {
    const no = Number(raw.NO ?? raw.no ?? 0);
    if (no >= 1 && no <= SALE_COND_COUNT) {
      byNo.set(no, normalizeSaleCondText(raw.COND ?? raw.cond));
    }
  }
  return Array.from({ length: SALE_COND_COUNT }, (_, i) => byNo.get(i + 1) ?? '');
}

function isSaleCondMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function querySaleCondRow(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      const rows = await fn();
      if (rows?.[0]) return rows[0];
    } catch (err) {
      lastErr = err;
      if (!isSaleCondMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

async function fetchSaleCondList(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sqlAttempts = [
    `SELECT COND1, COND2, COND3, COND4, COND5, COND6, COND7, COMP_YEAR
     FROM SALE_COND
     WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
    `SELECT COND_1 AS COND1, COND_2 AS COND2, COND_3 AS COND3, COND_4 AS COND4,
            COND_5 AS COND5, COND_6 AS COND6, COND_7 AS COND7, COMP_YEAR
     FROM SALE_COND
     WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
  ];
  for (const sql of sqlAttempts) {
    try {
      const row = await querySaleCondRow(sql, { comp_code: cc }, comp_uid);
      if (row) return saleCondApiRows(saleCondListFromDbRow(row));
    } catch (err) {
      if (!isSaleCondMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return saleCondApiRows([]);
}

async function saveSaleCondList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const conds = normalizeSaleCondSaveRows(rows);
  const deleteSql = `DELETE FROM SALE_COND WHERE COMP_CODE = :comp_code`;
  const insertSql = `
    INSERT INTO SALE_COND (COMP_CODE, COMP_YEAR, COND1, COND2, COND3, COND4, COND5, COND6, COND7)
    VALUES (:comp_code, :comp_year, :cond1, :cond2, :cond3, :cond4, :cond5, :cond6, :cond7)`;
  const binds = {
    comp_code: cc,
    comp_year: cy,
    cond1: conds[0],
    cond2: conds[1],
    cond3: conds[2],
    cond4: conds[3],
    cond5: conds[4],
    cond6: conds[5],
    cond7: conds[6],
  };

  /** Each runQuery uses its own connection — must autoCommit (see saveDaneList). */
  async function applyOnSchema(uid) {
    await runQuery(deleteSql, { comp_code: cc }, uid, { autoCommit: true });
    await runQuery(insertSql, binds, uid, { autoCommit: true });
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      const verify = await querySaleCondRow(
        `SELECT COND1 FROM SALE_COND WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: cc },
        comp_uid
      );
      if (verify) return 'company';
    } catch (err) {
      if (!isSaleCondMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  const verifyHub = await querySaleCondRow(
    `SELECT COND1 FROM SALE_COND WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
    { comp_code: cc },
    null
  );
  if (!verifyHub) {
    const err = new Error('Sale bill conditions were not saved to SALE_COND.');
    err.status = 500;
    throw err;
  }
  return 'hub';
}

app.get('/api/sale-cond-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ sale-cond-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sale-cond', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchSaleCondList(comp_code, comp_uid);
    res.json({ rows });
  } catch (err) {
    console.error('❌ sale-cond GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sale-cond', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required (7 conditions)' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveSaleCondList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchSaleCondList(comp_code, comp_uid);
    res.json({
      ok: true,
      message: 'DONE',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ sale-cond PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Location Wise BType (VFP DO LOC_B_TYPE → LOC_B_TYPE) ---
const LOC_B_TYPE_TABLE = 'LOC_B_TYPE';

function normalizeLocBTypeCode(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 1);
}

function normalizeLocBillInit(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
}

function normalizeLocFinYear(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 1);
}

function mapLocBTypeRow(row) {
  return {
    B_TYPE: normalizeLocBTypeCode(row.B_TYPE ?? row.b_type),
    b_type: normalizeLocBTypeCode(row.B_TYPE ?? row.b_type),
    BILL_INIT: normalizeLocBillInit(row.BILL_INIT ?? row.bill_init),
    bill_init: normalizeLocBillInit(row.BILL_INIT ?? row.bill_init),
    FIN_YEAR: normalizeLocFinYear(row.FIN_YEAR ?? row.fin_year),
    fin_year: normalizeLocFinYear(row.FIN_YEAR ?? row.fin_year),
  };
}

function isLocBTypeMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryLocBTypeRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isLocBTypeMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchLocBTypeList(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT TRIM(NVL(T.B_TYPE, '')) AS B_TYPE,
           TRIM(NVL(T.BILL_INIT, '')) AS BILL_INIT,
           TRIM(NVL(T.FIN_YEAR, '')) AS FIN_YEAR
    FROM ${LOC_B_TYPE_TABLE} T
    WHERE T.COMP_CODE = :comp_code
    ORDER BY UPPER(TRIM(T.B_TYPE)), UPPER(TRIM(T.BILL_INIT))`;
  try {
    const rows = await queryLocBTypeRows(sql, { comp_code: cc }, comp_uid);
    return (rows || []).map(mapLocBTypeRow).filter((r) => r.B_TYPE);
  } catch (err) {
    if (isLocBTypeMissingTableError(err)) return [];
    throw err;
  }
}

function normalizeLocBTypeSaveRows(rows, comp_code, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const seen = new Set();
  const out = [];
  for (const raw of rows || []) {
    const bType = normalizeLocBTypeCode(raw.B_TYPE ?? raw.b_type);
    const billInit = normalizeLocBillInit(raw.BILL_INIT ?? raw.bill_init);
    const finYear = normalizeLocFinYear(raw.FIN_YEAR ?? raw.fin_year);
    if (!bType && !billInit && !finYear) continue;
    if (!bType) {
      const err = new Error('B_Type is required on each row.');
      err.status = 400;
      throw err;
    }
    if (seen.has(bType)) {
      const err = new Error(`Duplicate B_Type: ${bType}`);
      err.status = 400;
      throw err;
    }
    seen.add(bType);
    out.push({
      comp_code: cc,
      comp_year: cy,
      b_type: bType,
      bill_init: billInit,
      fin_year: finYear,
    });
  }
  out.sort((a, b) => String(a.b_type).localeCompare(String(b.b_type)));
  return out;
}

async function saveLocBTypeList(comp_code, comp_year, comp_uid, rows) {
  const cc = Number(comp_code) || 0;
  const normalized = normalizeLocBTypeSaveRows(rows, cc, comp_year);
  const deleteSql = `DELETE FROM ${LOC_B_TYPE_TABLE} WHERE COMP_CODE = :comp_code`;
  const insertSql = `
    INSERT INTO ${LOC_B_TYPE_TABLE} (COMP_CODE, COMP_YEAR, B_TYPE, BILL_INIT, FIN_YEAR)
    VALUES (:comp_code, :comp_year, :b_type, :bill_init, :fin_year)`;

  async function applyOnSchema(uid) {
    await runQuery(deleteSql, { comp_code: cc }, uid, { autoCommit: true });
    for (const row of normalized) {
      await runQuery(insertSql, row, uid, { autoCommit: true });
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      const verify = await queryLocBTypeRows(
        `SELECT B_TYPE FROM ${LOC_B_TYPE_TABLE} WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: cc },
        comp_uid
      );
      if (normalized.length === 0 || (verify && verify.length)) return 'company';
    } catch (err) {
      if (!isLocBTypeMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  if (normalized.length > 0) {
    const verifyHub = await queryLocBTypeRows(
      `SELECT B_TYPE FROM ${LOC_B_TYPE_TABLE} WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
      { comp_code: cc },
      null
    );
    if (!verifyHub?.length) {
      const err = new Error('Location BType rows were not saved to LOC_B_TYPE.');
      err.status = 500;
      throw err;
    }
  }
  return 'hub';
}

app.get('/api/loc-b-type-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ loc-b-type-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/loc-b-type', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchLocBTypeList(comp_code, comp_uid);
    res.json({ rows });
  } catch (err) {
    console.error('❌ loc-b-type GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/loc-b-type', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveLocBTypeList(comp_code, comp_year, comp_uid, rows);
    const saved = await fetchLocBTypeList(comp_code, comp_uid);
    res.json({
      ok: true,
      message: 'DONE',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ loc-b-type PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Detail Master (VFP DO FORM DETAIL → DETAIL_MASTER) ---
const DETAIL_MAST_TABLE = 'DETAIL_MASTER';
const DETAIL_MAST_TEXT_MAX = 150;
const DETAIL_MAST_CODE_MAX = 6;
const DETAIL_MAST_TRN_MAX = 999;

function normalizeDetailMastCode(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, DETAIL_MAST_CODE_MAX);
}

function normalizeDetailMastText(v) {
  return String(v ?? '')
    .trim()
    .slice(0, DETAIL_MAST_TEXT_MAX);
}

function normalizeDetailMastTrnNo(v) {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(DETAIL_MAST_TRN_MAX, Math.trunc(n));
}

function normalizeDetailMastSNo(v) {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.trunc(n);
}

function isDetailMastMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryDetailMastRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isDetailMastMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchDetailMastList(comp_code, comp_uid, q) {
  const cc = Number(comp_code) || 0;
  const binds = { comp_code: cc };
  let sql = `
    SELECT Q.S_NO,
           Q.CODE,
           Q.AC_NAME,
           Q.LINE_CNT,
           Q.DETAIL_PREVIEW
    FROM (
      SELECT A.S_NO,
             TRIM(MAX(A.CODE)) AS CODE,
             MAX(B.NAME) AS AC_NAME,
             COUNT(*) AS LINE_CNT,
             SUBSTR(MAX(CASE WHEN A.TRN_NO = 1 THEN TRIM(A.DETAIL) END), 1, 80) AS DETAIL_PREVIEW
      FROM ${DETAIL_MAST_TABLE} A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND TRIM(NVL(A.CODE, '')) = TRIM(NVL(B.CODE, ''))
      WHERE A.COMP_CODE = :comp_code
      GROUP BY A.S_NO
    ) Q
    WHERE 1 = 1`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      ['TO_CHAR(Q.S_NO)', 'UPPER(Q.CODE)', 'UPPER(Q.AC_NAME)', 'UPPER(Q.DETAIL_PREVIEW)'],
      'dtmq'
    );
  }
  sql += ` ORDER BY Q.S_NO`;
  try {
    const rows = await queryDetailMastRows(sql, binds, comp_uid);
    return (rows || []).map((r) => ({
      S_NO: normalizeDetailMastSNo(r.S_NO ?? r.s_no),
      s_no: normalizeDetailMastSNo(r.S_NO ?? r.s_no),
      CODE: normalizeDetailMastCode(r.CODE ?? r.code),
      code: normalizeDetailMastCode(r.CODE ?? r.code),
      AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      ac_name: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      LINE_CNT: Number(r.LINE_CNT ?? r.line_cnt ?? 0) || 0,
      DETAIL_PREVIEW: normalizeDetailMastText(r.DETAIL_PREVIEW ?? r.detail_preview),
      detail_preview: normalizeDetailMastText(r.DETAIL_PREVIEW ?? r.detail_preview),
    }));
  } catch (err) {
    if (isDetailMastMissingTableError(err)) return [];
    throw err;
  }
}

async function fetchDetailMastRecord(comp_code, comp_uid, s_no) {
  const cc = Number(comp_code) || 0;
  const sn = normalizeDetailMastSNo(s_no);
  if (!sn) return null;
  const sql = `
    SELECT TRIM(NVL(T.CODE, '')) AS CODE,
           NVL(T.TRN_NO, 0) AS TRN_NO,
           TRIM(NVL(T.DETAIL, '')) AS DETAIL,
           NVL(M.NAME, '') AS AC_NAME
    FROM ${DETAIL_MAST_TABLE} T
    LEFT JOIN MASTER M
      ON T.COMP_CODE = M.COMP_CODE
     AND TRIM(NVL(T.CODE, '')) = TRIM(NVL(M.CODE, ''))
    WHERE T.COMP_CODE = :comp_code
      AND T.S_NO = :s_no
    ORDER BY T.TRN_NO`;
  const rows = await queryDetailMastRows(sql, { comp_code: cc, s_no: sn }, comp_uid);
  if (!rows?.length) return null;
  const code = normalizeDetailMastCode(rows[0].CODE ?? rows[0].code);
  const acName = String(rows[0].AC_NAME ?? rows[0].ac_name ?? '').trim();
  const lines = rows
    .map((r) => ({
      TRN_NO: normalizeDetailMastTrnNo(r.TRN_NO ?? r.trn_no),
      trn_no: normalizeDetailMastTrnNo(r.TRN_NO ?? r.trn_no),
      DETAIL: normalizeDetailMastText(r.DETAIL ?? r.detail),
      detail: normalizeDetailMastText(r.DETAIL ?? r.detail),
    }))
    .filter((l) => l.TRN_NO > 0);
  return { S_NO: sn, s_no: sn, CODE: code, code, AC_NAME: acName, ac_name: acName, lines };
}

async function fetchDetailMastNextSNo(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `SELECT NVL(MAX(S_NO), 0) + 1 AS NEXT_SNO FROM ${DETAIL_MAST_TABLE} WHERE COMP_CODE = :comp_code`;
  const rows = await queryDetailMastRows(sql, { comp_code: cc }, comp_uid);
  return normalizeDetailMastSNo(rows?.[0]?.NEXT_SNO ?? rows?.[0]?.next_sno ?? 1) || 1;
}

async function assertDetailMastAccountExists(comp_code, code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const c = normalizeDetailMastCode(code);
  if (!c) {
    const err = new Error('A/c Code is required.');
    err.status = 400;
    throw err;
  }
  const sql = `
    SELECT COUNT(*) AS CNT
    FROM MASTER
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(CODE, '')) = :code`;
  const rows = await queryDetailMastRows(sql, { comp_code: cc, code: c }, comp_uid);
  const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
  if (cnt < 1) {
    const err = new Error('Invalid A/c Code.');
    err.status = 400;
    throw err;
  }
  return c;
}

function normalizeDetailMastSaveLines(lines) {
  const out = [];
  const seenTrn = new Set();
  for (const raw of lines || []) {
    const detail = normalizeDetailMastText(raw.DETAIL ?? raw.detail);
    if (!detail) continue;
    let trn = normalizeDetailMastTrnNo(raw.TRN_NO ?? raw.trn_no);
    if (!trn) trn = out.length + 1;
    if (seenTrn.has(trn)) {
      const err = new Error(`Duplicate Trn No: ${trn}`);
      err.status = 400;
      throw err;
    }
    seenTrn.add(trn);
    out.push({ trn_no: trn, detail });
  }
  if (!out.length) {
    const err = new Error('At least one detail line is required.');
    err.status = 400;
    throw err;
  }
  out.sort((a, b) => a.trn_no - b.trn_no);
  return out;
}

async function saveDetailMastRecord(comp_code, comp_year, comp_uid, s_no, code, lines, user_name) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const sn = normalizeDetailMastSNo(s_no);
  if (!sn) {
    const err = new Error('S_No is required.');
    err.status = 400;
    throw err;
  }
  const acCode = await assertDetailMastAccountExists(comp_code, code, comp_uid);
  const normalized = normalizeDetailMastSaveLines(lines);
  const deleteSql = `DELETE FROM ${DETAIL_MAST_TABLE} WHERE COMP_CODE = :comp_code AND S_NO = :s_no`;
  const insertSql = `
    INSERT INTO ${DETAIL_MAST_TABLE} (COMP_CODE, COMP_YEAR, S_NO, CODE, TRN_NO, DETAIL, USER_NAME)
    VALUES (:comp_code, :comp_year, :s_no, :code, :trn_no, :detail, :user_name)`;

  async function applyOnSchema(uid) {
    await runQuery(deleteSql, { comp_code: cc, s_no: sn }, uid, { autoCommit: true });
    for (const row of normalized) {
      await runQuery(
        insertSql,
        {
          comp_code: cc,
          comp_year: cy,
          s_no: sn,
          code: acCode,
          trn_no: row.trn_no,
          detail: row.detail,
          user_name: String(user_name ?? '').trim() || null,
        },
        uid,
        { autoCommit: true }
      );
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      const verify = await fetchDetailMastRecord(comp_code, comp_uid, sn);
      if (verify) return 'company';
    } catch (err) {
      if (!isDetailMastMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  const verifyHub = await fetchDetailMastRecord(comp_code, null, sn);
  if (!verifyHub) {
    const err = new Error('Detail master was not saved to DETAIL_MASTER.');
    err.status = 500;
    throw err;
  }
  return 'hub';
}

async function deleteDetailMastRecord(comp_code, comp_uid, s_no) {
  const cc = Number(comp_code) || 0;
  const sn = normalizeDetailMastSNo(s_no);
  if (!sn) {
    const err = new Error('S_No is required.');
    err.status = 400;
    throw err;
  }
  const deleteSql = `DELETE FROM ${DETAIL_MAST_TABLE} WHERE COMP_CODE = :comp_code AND S_NO = :s_no`;
  async function applyOnSchema(uid) {
    await runQuery(deleteSql, { comp_code: cc, s_no: sn }, uid, { autoCommit: true });
  }
  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return 'company';
    } catch (err) {
      if (!isDetailMastMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  return 'hub';
}

app.get('/api/detail-mast-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ detail-mast-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/detail-mast-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchDetailMastList(comp_code, comp_uid, q);
    res.json(rows);
  } catch (err) {
    console.error('❌ detail-mast-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/detail-mast-next-sno', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const next_sno = await fetchDetailMastNextSNo(comp_code, comp_uid);
    res.json({ next_sno, NEXT_SNO: next_sno });
  } catch (err) {
    console.error('❌ detail-mast-next-sno error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/detail-mast', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const s_no = req.query.s_no ?? req.query.S_NO;
    if (!comp_code || comp_uid == null || s_no == null) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and s_no are required' });
    }
    const rec = await fetchDetailMastRecord(comp_code, comp_uid, s_no);
    if (!rec) return res.status(404).json({ error: 'Detail record not found.' });
    res.json(rec);
  } catch (err) {
    console.error('❌ detail-mast GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/detail-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const s_no = body.s_no ?? body.S_NO;
    const code = body.code ?? body.CODE;
    const lines = Array.isArray(body.lines) ? body.lines : body.LINES;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let sn = normalizeDetailMastSNo(s_no);
    if (!sn) sn = await fetchDetailMastNextSNo(comp_code, comp_uid);
    const existing = await fetchDetailMastRecord(comp_code, comp_uid, sn);
    if (existing) {
      return res.status(409).json({ error: 'Detail of this S_No already exists.' });
    }

    const storage = await saveDetailMastRecord(comp_code, comp_year, comp_uid, sn, code, lines, user_name);
    const saved = await fetchDetailMastRecord(comp_code, comp_uid, sn);
    res.json({ ok: true, message: 'Saved successfully.', storage, ...saved });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ detail-mast POST error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/detail-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    const s_no = body.s_no ?? body.S_NO;
    const code = body.code ?? body.CODE;
    const lines = Array.isArray(body.lines) ? body.lines : body.LINES;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const sn = normalizeDetailMastSNo(s_no);
    const existing = await fetchDetailMastRecord(comp_code, comp_uid, sn);
    if (!existing) return res.status(404).json({ error: 'Detail record not found.' });

    const storage = await saveDetailMastRecord(comp_code, comp_year, comp_uid, sn, code, lines, user_name);
    const saved = await fetchDetailMastRecord(comp_code, comp_uid, sn);
    res.json({ ok: true, message: 'Saved successfully.', storage, ...saved });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ detail-mast PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/detail-mast', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const s_no = body.s_no ?? body.S_NO;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const storage = await deleteDetailMastRecord(comp_code, comp_uid, s_no);
    res.json({ ok: true, message: 'Entry deleted.', storage, s_no: normalizeDetailMastSNo(s_no) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ detail-mast DELETE error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Opening Bills Detail (VFP DO FORM OPDET → OPDET) ---
const OPDET_TABLE = 'OPDET';
const OPDET_CODE_MAX = 6;
const OPDET_BTYPE_MAX = 1;
const OPDET_TRN_MAX = 999;
const OPDET_BROKER_SCHEDULE = '11.20';
const OPDET_VR_TYPE = 'OP';
const OPDET_DEFAULT_B_TYPE = 'N';
const OPDET_BILLS_TABLE = 'BILLS';

function normalizeOpdetCode(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, OPDET_CODE_MAX);
}

function normalizeOpdetOpNo(v) {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.trunc(n);
}

function normalizeOpdetTrnNo(v) {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(OPDET_TRN_MAX, Math.trunc(n));
}

function normalizeOpdetAmt(v) {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeOpdetDays(v) {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

function parseOpdetDate(v) {
  return parseDateOnly(v);
}

function formatOpdetDateOut(v) {
  const d = parseOpdetDate(v);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isOpdetMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryOpdetRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isOpdetMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function assertOpdetAccountExists(comp_code, code, comp_uid, label = 'A/c Code') {
  const cc = Number(comp_code) || 0;
  const c = normalizeOpdetCode(code);
  if (!c) {
    const err = new Error(`${label} is required.`);
    err.status = 400;
    throw err;
  }
  const sql = `
    SELECT COUNT(*) AS CNT
    FROM MASTER
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(CODE, '')) = :code
      AND (UPPER(SUBSTR(TRIM(NVL(CODE, '')), 1, 1)) = 'C'
        OR UPPER(SUBSTR(TRIM(NVL(CODE, '')), 1, 1)) = 'S')`;
  const rows = await queryOpdetRows(sql, { comp_code: cc, code: c }, comp_uid);
  const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
  if (cnt < 1) {
    const err = new Error(`Invalid ${label} (customer/supplier C or S code only).`);
    err.status = 400;
    throw err;
  }
  return c;
}

async function assertOpdetBrokerExists(comp_code, code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const c = normalizeOpdetCode(code);
  if (!c) return '';
  const sched = masterPartyScheduleBind(OPDET_BROKER_SCHEDULE);
  const sql = `
    SELECT COUNT(*) AS CNT
    FROM MASTER
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(CODE, '')) = :code
      AND ROUND(NVL(SCHEDULE, 0), 2) = :schedule`;
  const rows = await queryOpdetRows(sql, { comp_code: cc, code: c, schedule: sched }, comp_uid);
  const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
  if (cnt < 1) {
    const err = new Error('Invalid Broker Code (schedule must be 11.20).');
    err.status = 400;
    throw err;
  }
  return c;
}

function assertOpdetDateBeforeFyStart(date, fyStart, label) {
  const d = parseOpdetDate(date);
  const fy = parseOpdetDate(fyStart);
  if (!d || !fy) return;
  if (d.getTime() >= fy.getTime()) {
    const err = new Error(`${label} must be before financial year start (${formatOpdetDateOut(fy)}).`);
    err.status = 400;
    throw err;
  }
}

function normalizeOpdetBType(v) {
  const bt = String(v ?? '').trim().slice(0, OPDET_BTYPE_MAX);
  return bt || OPDET_DEFAULT_B_TYPE;
}

function opdetBillsDrCrForBill(schedule, billAmt) {
  const amt = normalizeOpdetAmt(billAmt);
  const isCustomer = Math.trunc(Number(schedule) || 0) === 8;
  if (isCustomer) return { dr_amt: amt, cr_amt: 0 };
  return { dr_amt: 0, cr_amt: amt };
}

function opdetBillsDrCrForPayment(schedule, pmtAmt) {
  const amt = normalizeOpdetAmt(pmtAmt);
  const isCustomer = Math.trunc(Number(schedule) || 0) === 8;
  if (isCustomer) return { dr_amt: 0, cr_amt: amt };
  return { dr_amt: amt, cr_amt: 0 };
}

async function fetchOpdetPartyMeta(comp_code, code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const c = normalizeOpdetCode(code);
  const sql = `
    SELECT NVL(SCHEDULE, 0) AS SCHEDULE, NVL(NAME, '') AS NAME
    FROM MASTER
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(CODE, '')) = :code`;
  const rows = await queryOpdetRows(sql, { comp_code: cc, code: c }, comp_uid);
  const row = rows?.[0] || {};
  return {
    schedule: Number(row.SCHEDULE ?? row.schedule ?? 0) || 0,
    name: String(row.NAME ?? row.name ?? '').trim(),
  };
}

async function fetchOpdetBillsSummary(comp_code, op_no, comp_uid) {
  const cc = Number(comp_code) || 0;
  const on = normalizeOpdetOpNo(op_no);
  if (!on) return [];
  const sql = `
    SELECT NVL(DR_AMT, 0) AS DR_AMT,
           NVL(CR_AMT, 0) AS CR_AMT,
           VR_DATE,
           NVL(DETAIL, '') AS DETAIL
    FROM ${OPDET_BILLS_TABLE}
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(VR_TYPE, '')) = :vr_type
      AND VR_NO = :vr_no
    ORDER BY CASE WHEN NVL(DR_AMT, 0) <> 0 OR NVL(DETAIL, '') <> '' THEN 0 ELSE 1 END,
             VR_DATE`;
  const rows = await queryOpdetRows(sql, { comp_code: cc, vr_type: OPDET_VR_TYPE, vr_no: on }, comp_uid);
  return (rows || []).map((r) => ({
    DR_AMT: normalizeOpdetAmt(r.DR_AMT ?? r.dr_amt),
    dr_amt: normalizeOpdetAmt(r.DR_AMT ?? r.dr_amt),
    CR_AMT: normalizeOpdetAmt(r.CR_AMT ?? r.cr_amt),
    cr_amt: normalizeOpdetAmt(r.CR_AMT ?? r.cr_amt),
    DETAIL: String(r.DETAIL ?? r.detail ?? '').trim(),
    detail: String(r.DETAIL ?? r.detail ?? '').trim(),
  }));
}

async function countOpdetBillsRows(comp_code, op_no, comp_uid) {
  const cc = Number(comp_code) || 0;
  const on = normalizeOpdetOpNo(op_no);
  if (!on) return 0;
  const sql = `
    SELECT COUNT(*) AS CNT
    FROM ${OPDET_BILLS_TABLE}
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(VR_TYPE, '')) = :vr_type
      AND VR_NO = :vr_no`;
  const rows = await queryOpdetRows(sql, { comp_code: cc, vr_type: OPDET_VR_TYPE, vr_no: on }, comp_uid);
  return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
}

async function deleteOpdetBillsRows(comp_code, op_no, comp_uid) {
  const cc = Number(comp_code) || 0;
  const on = normalizeOpdetOpNo(op_no);
  if (!on) return;
  const sql = `
    DELETE FROM ${OPDET_BILLS_TABLE}
    WHERE COMP_CODE = :comp_code
      AND TRIM(NVL(VR_TYPE, '')) = :vr_type
      AND VR_NO = :vr_no`;
  await runQuery(sql, { comp_code: cc, vr_type: OPDET_VR_TYPE, vr_no: on }, comp_uid, { autoCommit: true });
}

async function insertOpdetBillsHeaderRow(
  comp_code,
  comp_year,
  comp_uid,
  {
    op_no,
    code,
    b_code,
    bill_date,
    bill_no,
    bill_amt,
    v_date,
    days,
    b_type,
    ac_name,
  },
  partyMeta
) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const on = normalizeOpdetOpNo(op_no);
  const c = normalizeOpdetCode(code);
  const bCode = normalizeOpdetCode(b_code);
  const billDate = parseOpdetDate(bill_date);
  const vDate = parseOpdetDate(v_date);
  const billNo = Number(bill_no) || 0;
  const billAmt = normalizeOpdetAmt(bill_amt);
  const dayCnt = normalizeOpdetDays(days);
  const bType = normalizeOpdetBType(b_type);
  const partyName = String(ac_name ?? partyMeta.name ?? '').trim();
  const headerDrCr = opdetBillsDrCrForBill(partyMeta.schedule, billAmt);
  const sql = `
    INSERT INTO ${OPDET_BILLS_TABLE} (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
      BILL_DATE, BILL_NO, DR_AMT, CR_AMT, V_DATE, DAYS, BK_CODE, B_TYPE, DETAIL
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code,
      :bill_date, :bill_no, :dr_amt, :cr_amt, :v_date, :days, :bk_code, :b_type, :detail
    )`;
  await runQuery(
    sql,
    {
      comp_code: cc,
      comp_year: cy,
      vr_type: OPDET_VR_TYPE,
      vr_date: billDate,
      vr_no: on,
      code: c,
      bill_date: billDate,
      bill_no: billNo,
      dr_amt: headerDrCr.dr_amt,
      cr_amt: headerDrCr.cr_amt,
      v_date: vDate,
      days: dayCnt,
      bk_code: bCode || null,
      b_type: bType,
      detail: partyName || null,
    },
    comp_uid,
    { autoCommit: true }
  );
}

async function insertOpdetBillsPaymentRow(
  comp_code,
  comp_year,
  comp_uid,
  { op_no, code, bill_date, bill_no, b_type, pmt_date, pmt_amt },
  partyMeta
) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const on = normalizeOpdetOpNo(op_no);
  const c = normalizeOpdetCode(code);
  const billDate = parseOpdetDate(bill_date);
  const billNo = Number(bill_no) || 0;
  const bType = normalizeOpdetBType(b_type);
  const pmtDate = parseOpdetDate(pmt_date);
  const pmtDrCr = opdetBillsDrCrForPayment(partyMeta.schedule, pmt_amt);
  const sql = `
    INSERT INTO ${OPDET_BILLS_TABLE} (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE,
      BILL_DATE, BILL_NO, DR_AMT, CR_AMT, V_DATE, B_TYPE
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code,
      :bill_date, :bill_no, :dr_amt, :cr_amt, :v_date, :b_type
    )`;
  await runQuery(
    sql,
    {
      comp_code: cc,
      comp_year: cy,
      vr_type: OPDET_VR_TYPE,
      vr_date: pmtDate,
      vr_no: on,
      code: c,
      bill_date: billDate,
      bill_no: billNo,
      dr_amt: pmtDrCr.dr_amt,
      cr_amt: pmtDrCr.cr_amt,
      v_date: pmtDate,
      b_type: bType,
    },
    comp_uid,
    { autoCommit: true }
  );
}

function expectedOpdetBillsRowCount(lineCount) {
  const n = Number(lineCount) || 0;
  if (n <= 0) return 1;
  return 1 + n;
}

async function assertOpdetBillsSaved(comp_code, op_no, comp_uid, lineCount) {
  const expected = expectedOpdetBillsRowCount(lineCount);
  const cnt = await countOpdetBillsRows(comp_code, op_no, comp_uid);
  if (cnt < expected) {
    const err = new Error(
      `Opening bills were not transferred to BILLS (VR_TYPE=OP, VR_NO=${normalizeOpdetOpNo(op_no)}). Expected ${expected} row(s), found ${cnt}.`
    );
    err.status = 500;
    throw err;
  }
  return cnt;
}

async function fetchOpdetReport(comp_code, comp_uid, q) {
  const cc = Number(comp_code) || 0;
  const binds = { comp_code: cc };
  let sql = `
    SELECT TRIM(NVL(A.CODE, '')) AS CODE,
           NVL(P.NAME, '') AS AC_NAME,
           A.OP_NO,
           A.TRN_NO,
           A.BILL_DATE,
           NVL(A.BILL_NO, 0) AS BILL_NO,
           A.V_DATE,
           NVL(A.DAYS, 0) AS DAYS,
           NVL(H.BILL_AMT, 0) AS BILL_AMT,
           A.PMT_DATE,
           NVL(A.PMT_AMT, 0) AS PMT_AMT,
           TRIM(NVL(A.B_CODE, '')) AS B_CODE,
           NVL(B.NAME, '') AS BROKER_NAME
    FROM ${OPDET_TABLE} A
    LEFT JOIN ${OPDET_TABLE} H
      ON A.COMP_CODE = H.COMP_CODE
     AND A.OP_NO = H.OP_NO
     AND H.TRN_NO = 1
    LEFT JOIN MASTER P
      ON A.COMP_CODE = P.COMP_CODE
     AND TRIM(NVL(A.CODE, '')) = TRIM(NVL(P.CODE, ''))
    LEFT JOIN MASTER B
      ON A.COMP_CODE = B.COMP_CODE
     AND TRIM(NVL(A.B_CODE, '')) = TRIM(NVL(B.CODE, ''))
    WHERE A.COMP_CODE = :comp_code`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      [
        'TO_CHAR(A.OP_NO)',
        'UPPER(TRIM(A.CODE))',
        'UPPER(P.NAME)',
        'UPPER(TRIM(A.B_CODE))',
        'UPPER(B.NAME)',
        'TO_CHAR(A.BILL_NO)',
      ],
      'oprq'
    );
  }
  sql += ` ORDER BY TRIM(A.CODE), A.OP_NO, A.TRN_NO`;
  try {
    const rows = await queryOpdetRows(sql, binds, comp_uid);
    const lines = (rows || []).map((r) => ({
      CODE: normalizeOpdetCode(r.CODE ?? r.code),
      code: normalizeOpdetCode(r.CODE ?? r.code),
      AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      ac_name: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      OP_NO: normalizeOpdetOpNo(r.OP_NO ?? r.op_no),
      op_no: normalizeOpdetOpNo(r.OP_NO ?? r.op_no),
      TRN_NO: normalizeOpdetTrnNo(r.TRN_NO ?? r.trn_no),
      trn_no: normalizeOpdetTrnNo(r.TRN_NO ?? r.trn_no),
      BILL_DATE: formatOpdetDateOut(r.BILL_DATE ?? r.bill_date),
      bill_date: formatOpdetDateOut(r.BILL_DATE ?? r.bill_date),
      BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      V_DATE: formatOpdetDateOut(r.V_DATE ?? r.v_date),
      v_date: formatOpdetDateOut(r.V_DATE ?? r.v_date),
      DAYS: normalizeOpdetDays(r.DAYS ?? r.days),
      days: normalizeOpdetDays(r.DAYS ?? r.days),
      BILL_AMT: normalizeOpdetAmt(r.BILL_AMT ?? r.bill_amt),
      bill_amt: normalizeOpdetAmt(r.BILL_AMT ?? r.bill_amt),
      PMT_DATE: formatOpdetDateOut(r.PMT_DATE ?? r.pmt_date),
      pmt_date: formatOpdetDateOut(r.PMT_DATE ?? r.pmt_date),
      PMT_AMT: normalizeOpdetAmt(r.PMT_AMT ?? r.pmt_amt),
      pmt_amt: normalizeOpdetAmt(r.PMT_AMT ?? r.pmt_amt),
      B_CODE: normalizeOpdetCode(r.B_CODE ?? r.b_code),
      b_code: normalizeOpdetCode(r.B_CODE ?? r.b_code),
      BROKER_NAME: String(r.BROKER_NAME ?? r.broker_name ?? '').trim(),
      broker_name: String(r.BROKER_NAME ?? r.broker_name ?? '').trim(),
    }));
    return { lines };
  } catch (err) {
    if (isOpdetMissingTableError(err)) return { lines: [] };
    throw err;
  }
}

async function fetchOpdetList(comp_code, comp_uid, q) {
  const cc = Number(comp_code) || 0;
  const binds = { comp_code: cc };
  let sql = `
    SELECT Q.OP_NO,
           Q.CODE,
           Q.AC_NAME,
           Q.B_CODE,
           Q.BROKER_NAME,
           Q.BILL_DATE,
           Q.BILL_NO,
           Q.BILL_AMT,
           Q.LINE_CNT,
           Q.PMT_PREVIEW
    FROM (
      SELECT A.OP_NO,
             TRIM(MAX(A.CODE)) AS CODE,
             MAX(P.NAME) AS AC_NAME,
             TRIM(MAX(A.B_CODE)) AS B_CODE,
             MAX(B.NAME) AS BROKER_NAME,
             MAX(A.BILL_DATE) AS BILL_DATE,
             MAX(A.BILL_NO) AS BILL_NO,
             MAX(NVL(A.BILL_AMT, 0)) AS BILL_AMT,
             COUNT(*) AS LINE_CNT,
             SUBSTR(MAX(CASE WHEN A.TRN_NO = 1 THEN TO_CHAR(A.PMT_DATE, 'DD-MM-YYYY') || ' / ' || TO_CHAR(NVL(A.PMT_AMT, 0)) END), 1, 80) AS PMT_PREVIEW
      FROM ${OPDET_TABLE} A
      LEFT JOIN MASTER P
        ON A.COMP_CODE = P.COMP_CODE
       AND TRIM(NVL(A.CODE, '')) = TRIM(NVL(P.CODE, ''))
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND TRIM(NVL(A.B_CODE, '')) = TRIM(NVL(B.CODE, ''))
      WHERE A.COMP_CODE = :comp_code
      GROUP BY A.OP_NO
    ) Q
    WHERE 1 = 1`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      [
        'TO_CHAR(Q.OP_NO)',
        'UPPER(Q.CODE)',
        'UPPER(Q.AC_NAME)',
        'UPPER(Q.B_CODE)',
        'UPPER(Q.BROKER_NAME)',
        'TO_CHAR(Q.BILL_NO)',
        'UPPER(Q.PMT_PREVIEW)',
      ],
      'opq'
    );
  }
  sql += ` ORDER BY Q.OP_NO`;
  try {
    const rows = await queryOpdetRows(sql, binds, comp_uid);
    return (rows || []).map((r) => ({
      OP_NO: normalizeOpdetOpNo(r.OP_NO ?? r.op_no),
      op_no: normalizeOpdetOpNo(r.OP_NO ?? r.op_no),
      CODE: normalizeOpdetCode(r.CODE ?? r.code),
      code: normalizeOpdetCode(r.CODE ?? r.code),
      AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      ac_name: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      B_CODE: normalizeOpdetCode(r.B_CODE ?? r.b_code),
      b_code: normalizeOpdetCode(r.B_CODE ?? r.b_code),
      BROKER_NAME: String(r.BROKER_NAME ?? r.broker_name ?? '').trim(),
      broker_name: String(r.BROKER_NAME ?? r.broker_name ?? '').trim(),
      BILL_DATE: formatOpdetDateOut(r.BILL_DATE ?? r.bill_date),
      bill_date: formatOpdetDateOut(r.BILL_DATE ?? r.bill_date),
      BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      BILL_AMT: normalizeOpdetAmt(r.BILL_AMT ?? r.bill_amt),
      bill_amt: normalizeOpdetAmt(r.BILL_AMT ?? r.bill_amt),
      LINE_CNT: Number(r.LINE_CNT ?? r.line_cnt ?? 0) || 0,
      PMT_PREVIEW: String(r.PMT_PREVIEW ?? r.pmt_preview ?? '').trim(),
      pmt_preview: String(r.PMT_PREVIEW ?? r.pmt_preview ?? '').trim(),
    }));
  } catch (err) {
    if (isOpdetMissingTableError(err)) return [];
    throw err;
  }
}

async function fetchOpdetRecord(comp_code, comp_uid, op_no) {
  const cc = Number(comp_code) || 0;
  const on = normalizeOpdetOpNo(op_no);
  if (!on) return null;
  const sql = `
    SELECT TRIM(NVL(T.CODE, '')) AS CODE,
           TRIM(NVL(T.B_CODE, '')) AS B_CODE,
           T.BILL_DATE,
           NVL(T.BILL_NO, 0) AS BILL_NO,
           NVL(T.BILL_AMT, 0) AS BILL_AMT,
           T.V_DATE,
           NVL(T.DAYS, 0) AS DAYS,
           TRIM(NVL(T.B_TYPE, '')) AS B_TYPE,
           NVL(T.TRN_NO, 0) AS TRN_NO,
           T.PMT_DATE,
           NVL(T.PMT_AMT, 0) AS PMT_AMT,
           NVL(P.NAME, '') AS AC_NAME,
           NVL(B.NAME, '') AS BROKER_NAME
    FROM ${OPDET_TABLE} T
    LEFT JOIN MASTER P
      ON T.COMP_CODE = P.COMP_CODE
     AND TRIM(NVL(T.CODE, '')) = TRIM(NVL(P.CODE, ''))
    LEFT JOIN MASTER B
      ON T.COMP_CODE = B.COMP_CODE
     AND TRIM(NVL(T.B_CODE, '')) = TRIM(NVL(B.CODE, ''))
    WHERE T.COMP_CODE = :comp_code
      AND T.OP_NO = :op_no
    ORDER BY T.TRN_NO`;
  const rows = await queryOpdetRows(sql, { comp_code: cc, op_no: on }, comp_uid);
  if (!rows?.length) return null;
  const head = rows[0];
  const lines = rows
    .map((r) => ({
      TRN_NO: normalizeOpdetTrnNo(r.TRN_NO ?? r.trn_no),
      trn_no: normalizeOpdetTrnNo(r.TRN_NO ?? r.trn_no),
      PMT_DATE: formatOpdetDateOut(r.PMT_DATE ?? r.pmt_date),
      pmt_date: formatOpdetDateOut(r.PMT_DATE ?? r.pmt_date),
      PMT_AMT: normalizeOpdetAmt(r.PMT_AMT ?? r.pmt_amt),
      pmt_amt: normalizeOpdetAmt(r.PMT_AMT ?? r.pmt_amt),
    }))
    .filter((l) => l.TRN_NO > 0);
  return {
    OP_NO: on,
    op_no: on,
    CODE: normalizeOpdetCode(head.CODE ?? head.code),
    code: normalizeOpdetCode(head.CODE ?? head.code),
    AC_NAME: String(head.AC_NAME ?? head.ac_name ?? '').trim(),
    ac_name: String(head.AC_NAME ?? head.ac_name ?? '').trim(),
    B_CODE: normalizeOpdetCode(head.B_CODE ?? head.b_code),
    b_code: normalizeOpdetCode(head.B_CODE ?? head.b_code),
    BROKER_NAME: String(head.BROKER_NAME ?? head.broker_name ?? '').trim(),
    broker_name: String(head.BROKER_NAME ?? head.broker_name ?? '').trim(),
    BILL_DATE: formatOpdetDateOut(head.BILL_DATE ?? head.bill_date),
    bill_date: formatOpdetDateOut(head.BILL_DATE ?? head.bill_date),
    BILL_NO: Number(head.BILL_NO ?? head.bill_no ?? 0) || 0,
    bill_no: Number(head.BILL_NO ?? head.bill_no ?? 0) || 0,
    BILL_AMT: normalizeOpdetAmt(head.BILL_AMT ?? head.bill_amt),
    bill_amt: normalizeOpdetAmt(head.BILL_AMT ?? head.bill_amt),
    V_DATE: formatOpdetDateOut(head.V_DATE ?? head.v_date),
    v_date: formatOpdetDateOut(head.V_DATE ?? head.v_date),
    DAYS: normalizeOpdetDays(head.DAYS ?? head.days),
    days: normalizeOpdetDays(head.DAYS ?? head.days),
    B_TYPE: String(head.B_TYPE ?? head.b_type ?? '').trim().slice(0, OPDET_BTYPE_MAX),
    b_type: String(head.B_TYPE ?? head.b_type ?? '').trim().slice(0, OPDET_BTYPE_MAX),
    lines,
  };
}

async function fetchOpdetNextOpNo(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `SELECT NVL(MAX(OP_NO), 0) + 1 AS NEXT_OPNO FROM ${OPDET_TABLE} WHERE COMP_CODE = :comp_code`;
  const rows = await queryOpdetRows(sql, { comp_code: cc }, comp_uid);
  return normalizeOpdetOpNo(rows?.[0]?.NEXT_OPNO ?? rows?.[0]?.next_opno ?? 1) || 1;
}

function normalizeOpdetSaveLines(lines) {
  const out = [];
  const seenTrn = new Set();
  for (const raw of lines || []) {
    const pmtAmt = normalizeOpdetAmt(raw.PMT_AMT ?? raw.pmt_amt);
    const pmtDate = parseOpdetDate(raw.PMT_DATE ?? raw.pmt_date);
    if (!pmtDate && !pmtAmt) continue;
    let trn = normalizeOpdetTrnNo(raw.TRN_NO ?? raw.trn_no);
    if (!trn) trn = out.length + 1;
    if (seenTrn.has(trn)) {
      const err = new Error(`Duplicate Trn No: ${trn}`);
      err.status = 400;
      throw err;
    }
    seenTrn.add(trn);
    if (!pmtDate) {
      const err = new Error(`Payment date is required on line ${trn}.`);
      err.status = 400;
      throw err;
    }
    out.push({ trn_no: trn, pmt_date: pmtDate, pmt_amt: pmtAmt });
  }
  if (!out.length) {
    const err = new Error('At least one payment line is required.');
    err.status = 400;
    throw err;
  }
  out.sort((a, b) => a.trn_no - b.trn_no);
  return out;
}

async function saveOpdetRecord(comp_code, comp_year, comp_uid, payload) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const on = normalizeOpdetOpNo(payload.op_no);
  if (!on) {
    const err = new Error('Sr.No is required.');
    err.status = 400;
    throw err;
  }
  const code = await assertOpdetAccountExists(comp_code, payload.code, comp_uid, 'Party Code');
  let bCode = normalizeOpdetCode(payload.b_code);
  if (bCode) {
    bCode = await assertOpdetBrokerExists(comp_code, bCode, comp_uid);
  }
  const fyStart = parseOpdetDate(payload.comp_s_dt ?? payload.COMP_S_DT);
  if (!fyStart) {
    const err = new Error('Financial year start date is required for opening bills.');
    err.status = 400;
    throw err;
  }
  const billDate = parseOpdetDate(payload.bill_date);
  if (!billDate) {
    const err = new Error('Bill Date is required.');
    err.status = 400;
    throw err;
  }
  assertOpdetDateBeforeFyStart(billDate, fyStart, 'Bill Date');
  const vDate = parseOpdetDate(payload.v_date);
  const billNo = Number(payload.bill_no) || 0;
  const billAmt = normalizeOpdetAmt(payload.bill_amt);
  const days = normalizeOpdetDays(payload.days);
  const bType = normalizeOpdetBType(payload.b_type);
  const normalized = normalizeOpdetSaveLines(payload.lines);
  for (const row of normalized) {
    assertOpdetDateBeforeFyStart(row.pmt_date, fyStart, `Payment date on line ${row.trn_no}`);
  }
  const deleteSql = `DELETE FROM ${OPDET_TABLE} WHERE COMP_CODE = :comp_code AND OP_NO = :op_no`;
  const insertSql = `
    INSERT INTO ${OPDET_TABLE} (
      COMP_CODE, COMP_YEAR, OP_NO, TRN_NO, CODE, B_CODE,
      BILL_DATE, BILL_NO, BILL_AMT, PMT_DATE, PMT_AMT, V_DATE, DAYS, B_TYPE
    ) VALUES (
      :comp_code, :comp_year, :op_no, :trn_no, :code, :b_code,
      :bill_date, :bill_no, :bill_amt, :pmt_date, :pmt_amt, :v_date, :days, :b_type
    )`;
  const billsPayload = {
    op_no: on,
    code,
    b_code: bCode,
    bill_date: billDate,
    bill_no: billNo,
    bill_amt: billAmt,
    v_date: vDate,
    days,
    b_type: bType,
    ac_name: payload.ac_name ?? payload.AC_NAME,
  };

  async function applyOnSchema(uid) {
    const partyMeta = await fetchOpdetPartyMeta(comp_code, code, uid);
    await deleteOpdetBillsRows(cc, on, uid);
    await runQuery(deleteSql, { comp_code: cc, op_no: on }, uid, { autoCommit: true });
    for (let i = 0; i < normalized.length; i++) {
      const row = normalized[i];
      const lineBillAmt = i === 0 ? billAmt : 0;
      await runQuery(
        insertSql,
        {
          comp_code: cc,
          comp_year: cy,
          op_no: on,
          trn_no: row.trn_no,
          code,
          b_code: bCode || null,
          bill_date: billDate,
          bill_no: billNo,
          bill_amt: lineBillAmt,
          pmt_date: row.pmt_date,
          pmt_amt: row.pmt_amt,
          v_date: vDate,
          days,
          b_type: bType,
        },
        uid,
        { autoCommit: true }
      );
      if (i === 0) {
        await insertOpdetBillsHeaderRow(cc, cy, uid, billsPayload, partyMeta);
      }
      await insertOpdetBillsPaymentRow(
        cc,
        cy,
        uid,
        {
          op_no: on,
          code,
          bill_date: billDate,
          bill_no: billNo,
          b_type: bType,
          pmt_date: row.pmt_date,
          pmt_amt: row.pmt_amt,
        },
        partyMeta
      );
    }
    await assertOpdetBillsSaved(comp_code, on, uid, normalized.length);
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      const verify = await fetchOpdetRecord(comp_code, comp_uid, on);
      if (verify) return 'company';
    } catch (err) {
      if (!isOpdetMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  const verifyHub = await fetchOpdetRecord(comp_code, null, on);
  if (!verifyHub) {
    const err = new Error('Opening bills detail was not saved to OPDET.');
    err.status = 500;
    throw err;
  }
  return 'hub';
}

async function deleteOpdetRecord(comp_code, comp_uid, op_no) {
  const cc = Number(comp_code) || 0;
  const on = normalizeOpdetOpNo(op_no);
  if (!on) {
    const err = new Error('Sr.No is required.');
    err.status = 400;
    throw err;
  }
  async function applyOnSchema(uid) {
    await deleteOpdetBillsRows(cc, on, uid);
    await runQuery(
      `DELETE FROM ${OPDET_TABLE} WHERE COMP_CODE = :comp_code AND OP_NO = :op_no`,
      { comp_code: cc, op_no: on },
      uid,
      { autoCommit: true }
    );
  }
  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      return 'company';
    } catch (err) {
      if (!isOpdetMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  return 'hub';
}

app.get('/api/opdet-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ opdet-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/opdet-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchOpdetList(comp_code, comp_uid, q);
    res.json(rows);
  } catch (err) {
    console.error('❌ opdet-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/opdet-report', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const report = await fetchOpdetReport(comp_code, comp_uid, q);
    res.json(report);
  } catch (err) {
    console.error('❌ opdet-report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/opdet-next-opno', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const next_opno = await fetchOpdetNextOpNo(comp_code, comp_uid);
    res.json({ next_opno, NEXT_OPNO: next_opno });
  } catch (err) {
    console.error('❌ opdet-next-opno error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/opdet', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const op_no = req.query.op_no ?? req.query.OP_NO;
    if (!comp_code || comp_uid == null || op_no == null) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and op_no are required' });
    }
    const rec = await fetchOpdetRecord(comp_code, comp_uid, op_no);
    if (!rec) return res.status(404).json({ error: 'Opening bills record not found.' });
    const bills_lines = await fetchOpdetBillsSummary(comp_code, op_no, comp_uid);
    res.json({ ...rec, bills_lines, BILLS_LINES: bills_lines });
  } catch (err) {
    console.error('❌ opdet GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/opdet', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let opNo = normalizeOpdetOpNo(body.op_no ?? body.OP_NO);
    if (!opNo) opNo = await fetchOpdetNextOpNo(comp_code, comp_uid);
    const existing = await fetchOpdetRecord(comp_code, comp_uid, opNo);
    if (existing) {
      return res.status(409).json({ error: 'Opening bills record of this Sr.No already exists.' });
    }

    const storage = await saveOpdetRecord(comp_code, comp_year, comp_uid, { ...body, op_no: opNo });
    const saved = await fetchOpdetRecord(comp_code, comp_uid, opNo);
    const bills_count = await countOpdetBillsRows(comp_code, opNo, comp_uid);
    const bills_lines = await fetchOpdetBillsSummary(comp_code, opNo, comp_uid);
    res.json({
      ok: true,
      message: 'Saved successfully.',
      storage,
      bills_count,
      BILLS_COUNT: bills_count,
      bills_lines,
      BILLS_LINES: bills_lines,
      ...saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ opdet POST error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/opdet', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const opNo = normalizeOpdetOpNo(body.op_no ?? body.OP_NO);
    const existing = await fetchOpdetRecord(comp_code, comp_uid, opNo);
    if (!existing) return res.status(404).json({ error: 'Opening bills record not found.' });

    const storage = await saveOpdetRecord(comp_code, comp_year, comp_uid, { ...body, op_no: opNo });
    const saved = await fetchOpdetRecord(comp_code, comp_uid, opNo);
    const bills_count = await countOpdetBillsRows(comp_code, opNo, comp_uid);
    const bills_lines = await fetchOpdetBillsSummary(comp_code, opNo, comp_uid);
    res.json({
      ok: true,
      message: 'Saved successfully.',
      storage,
      bills_count,
      BILLS_COUNT: bills_count,
      bills_lines,
      BILLS_LINES: bills_lines,
      ...saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ opdet PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/opdet', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const op_no = body.op_no ?? body.OP_NO;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const storage = await deleteOpdetRecord(comp_code, comp_uid, op_no);
    res.json({ ok: true, message: 'Entry deleted.', storage, op_no: normalizeOpdetOpNo(op_no) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ opdet DELETE error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Interest Transfer (VFP DO FORM INTTRF) ---
const INTTRF_VR_TYPE = 'JV';
const INTTRF_DEFAULT_SCHNO = 8.1;
const INTTRF_DEFAULT_TRF_CODE = '006005';

function normalizeInttrfCode(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
}

function roundInttrfSchedule(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function inttrfSchedulesEqual(a, b) {
  return Math.abs(roundInttrfSchedule(a) - roundInttrfSchedule(b)) < 0.0001;
}

function inttrfCodeRangeForSchedule(schno) {
  if (inttrfSchedulesEqual(schno, 11.1)) {
    return { scd: 'S00001', ecd: 'S99999' };
  }
  return { scd: 'C00001', ecd: 'E00001' };
}

function inttrfMinAmtForMdc(mdc) {
  return String(mdc || '').trim().toUpperCase() === 'D' ? 100 : -99999;
}

function inttrfEntTimeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function inttrfComputerName(req) {
  const xf = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || 'WEB';
}

async function queryInttrfRows(sql, binds, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

function inttrfMasterCodeVariants(code) {
  const c = normalizeInttrfCode(code);
  if (!c) return [];
  const out = new Set([c]);
  const legacy = purExpLegacyMasterCode(c);
  if (legacy) out.add(legacy);
  if (/^[A-Z]\d{5}$/.test(c)) {
    const digits = c.slice(1);
    out.add(digits);
    out.add(digits.padStart(6, '0'));
  }
  return [...out];
}

async function assertInttrfMasterCode(comp_code, code, comp_uid, label) {
  const cc = Number(comp_code) || 0;
  const variants = inttrfMasterCodeVariants(code);
  if (!variants.length) {
    const err = new Error(`${label} is required.`);
    err.status = 400;
    throw err;
  }
  const sql = `
    SELECT TRIM(NVL(CODE, '')) AS CODE, TRIM(NVL(NAME, '')) AS NAME
    FROM MASTER
    WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code`;
  for (const variant of variants) {
    const rows = await queryInttrfRows(sql, { comp_code: cc, code: variant }, comp_uid);
    if (rows?.length) {
      return {
        code: String(rows[0].CODE ?? rows[0].code ?? variant).trim().toUpperCase(),
        name: String(rows[0].NAME ?? rows[0].name ?? '').trim(),
      };
    }
  }
  const err = new Error(`Invalid ${label}.`);
  err.status = 400;
  throw err;
}

async function fetchInttrfNextVrNo(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT NVL(MAX(VR_NO), 0) AS VR_NO
    FROM VOUCHER
    WHERE COMP_CODE = :comp_code AND VR_TYPE = :vr_type`;
  const rows = await queryInttrfRows(sql, { comp_code: cc, vr_type: INTTRF_VR_TYPE }, comp_uid);
  let vr = Number(rows?.[0]?.VR_NO ?? rows?.[0]?.vr_no ?? 0) || 0;
  if (vr < 10000) return 10000;
  return vr + 1;
}

async function fetchInttrfScheduleName(comp_code, comp_uid, schno) {
  const cc = Number(comp_code) || 0;
  const sch = roundInttrfSchedule(schno);
  if (!sch) return '';
  const sql = `
    SELECT TRIM(NVL(NAME, '')) AS NAME
    FROM SCHEDULE
    WHERE COMP_CODE = :comp_code
      AND (ROUND(NVL(NO, 0), 2) = :schno OR NVL(NO, 0) = :schno)
      AND ROWNUM = 1`;
  const rows = await queryInttrfRows(sql, { comp_code: cc, schno: sch }, comp_uid);
  return String(rows?.[0]?.NAME ?? rows?.[0]?.name ?? '').trim();
}

async function fetchInttrfInitContext(comp_code, comp_uid, comp_year, body = {}) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  let edt = parseDateOnly(body.edt ?? body.EDT ?? body.e_date) || new Date();
  const fyEnd = parseDateOnly(body.comp_e_dt ?? body.COMP_E_DT ?? body.e_date);
  if (fyEnd && edt > fyEnd) edt = fyEnd;

  const vr_no = await fetchInttrfNextVrNo(cc, comp_uid);
  const schno = roundInttrfSchedule(body.schno ?? INTTRF_DEFAULT_SCHNO) || INTTRF_DEFAULT_SCHNO;
  const { scd, ecd } = inttrfCodeRangeForSchedule(schno);
  const mdc = String(body.mdc ?? 'C').trim().toUpperCase().slice(0, 1) || 'C';
  const schName = await fetchInttrfScheduleName(cc, comp_uid, schno);

  return {
    edt: formatOpdetDateOut(edt),
    schno,
    sch_name: schName,
    vr_no,
    vr_type: INTTRF_VR_TYPE,
    trf_code_dr: INTTRF_DEFAULT_TRF_CODE,
    trf_code_cr: INTTRF_DEFAULT_TRF_CODE,
    mdc,
    oby: 'C',
    minamt: inttrfMinAmtForMdc(mdc),
    scd,
    ecd,
    l_c: '',
    b_type: '',
    bk_code: '',
    m_detail: 'TRANS',
    comp_year: cy,
  };
}

function inttrfPassesBusinessFilter(row, schno, mdc, minamt) {
  const dr = Number(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
  const cr = Number(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
  const clbal = Number(row.CLBAL ?? row.clbal ?? 0) || 0;
  const min = Number(minamt) || 0;
  const xdc = String(mdc || '').trim().toUpperCase();

  if (inttrfSchedulesEqual(schno, 8.1)) {
    if (xdc === 'C') {
      if (cr === 0 || clbal >= 0) return false;
      if (min !== 0 && Math.abs(clbal) > Math.abs(min)) return false;
      return true;
    }
    return dr !== 0 && cr !== 0 && clbal > 0 && clbal <= min;
  }
  if (inttrfSchedulesEqual(schno, 11.1)) {
    const cap = min !== 0 ? Math.abs(min) : Number.MAX_SAFE_INTEGER;
    return cr !== 0 && dr !== 0 && clbal < 0 && Math.abs(clbal) <= cap;
  }
  return false;
}

function inttrfAddTotTrf(rows) {
  let currentCode = '';
  let running = 0;
  return (rows || []).map((r) => {
    const code = String(r.CODE ?? r.code ?? '').trim();
    const clbal = Number(r.CLBAL ?? r.clbal ?? 0) || 0;
    if (code !== currentCode) {
      currentCode = code;
      running = clbal;
      return { ...r, CODE: code, TOT_TRF: running, SLCT: '' };
    }
    running += clbal;
    return { ...r, CODE: code, TOT_TRF: 0, SLCT: '' };
  });
}

function mapInttrfProceedRow(r) {
  return {
    CODE: normalizeInttrfCode(r.CODE ?? r.code),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    CITY: String(r.CITY ?? r.city ?? '').trim(),
    BILL_DATE: formatOpdetDateOut(r.BILL_DATE ?? r.bill_date),
    BILL_NO: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
    B_TYPE: String(r.B_TYPE ?? r.b_type ?? '').trim().slice(0, 1),
    L_C: String(r.L_C ?? r.l_c ?? '').trim().slice(0, 1),
    DR_AMT: normalizeOpdetAmt(r.DR_AMT ?? r.dr_amt),
    CR_AMT: normalizeOpdetAmt(r.CR_AMT ?? r.cr_amt),
    CLBAL: normalizeOpdetAmt(r.CLBAL ?? r.clbal),
    BK_CODE: normalizeInttrfCode(r.BK_CODE ?? r.bk_code),
    CR_AMT1: normalizeOpdetAmt(r.CR_AMT1 ?? r.cr_amt1),
  };
}

async function fetchInttrfProceedRows(comp_code, comp_uid, params) {
  const cc = Number(comp_code) || 0;
  const edt = parseDateOnly(params.edt ?? params.EDT);
  if (!edt) {
    const err = new Error('Ending Date is required.');
    err.status = 400;
    throw err;
  }
  const schno = roundInttrfSchedule(params.schno);
  const scd = normalizeInttrfCode(params.scd || inttrfCodeRangeForSchedule(schno).scd);
  const ecd = normalizeInttrfCode(params.ecd || inttrfCodeRangeForSchedule(schno).ecd);
  const lcXlc = String(params.l_c ?? params.L_C ?? '').trim().toUpperCase().slice(0, 1);
  const bkCode = normalizeInttrfCode(params.bk_code ?? params.BK_CODE);
  const bType = String(params.b_type ?? params.B_TYPE ?? '').trim().toUpperCase().slice(0, 1);
  const mdc = String(params.mdc ?? params.MDC ?? 'C').trim().toUpperCase().slice(0, 1) || 'C';
  const minamt = Number(params.minamt ?? params.MINAMT ?? 0) || 0;
  const oby = String(params.oby ?? params.OBY ?? 'C').trim().toUpperCase() === 'D' ? 'D' : 'C';

  await assertInttrfMasterCode(cc, params.trf_code_dr ?? params.trfcode, comp_uid, 'Transfer Code Dr.');

  const sql = `
    SELECT A.CODE,
           C.NAME,
           C.CITY,
           A.BILL_DATE,
           A.BILL_NO,
           A.B_TYPE,
           C.L_C,
           SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
           SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
           SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CLBAL,
           SUM(CASE
                 WHEN NVL(A.CR_AMT, 0) <> 0 AND NVL(TRIM(A.VR_TYPE), 'X') <> 'SL'
                 THEN NVL(A.CR_AMT, 0)
                 ELSE 0
               END) AS CR_AMT1,
           MAX(A.BK_CODE) AS BK_CODE
    FROM BILLS A
    INNER JOIN MASTER C
      ON A.COMP_CODE = C.COMP_CODE
     AND TRIM(A.CODE) = TRIM(C.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.VR_DATE <= :edt
      AND TRIM(A.CODE) BETWEEN :scd AND :ecd
      AND ROUND(NVL(C.SCHEDULE, 0), 2) = :schno
    GROUP BY A.CODE, C.NAME, C.CITY, A.BILL_DATE, A.BILL_NO, A.B_TYPE, C.L_C
    HAVING SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) <> 0`;

  const rawRows = await queryInttrfRows(
    sql,
    { comp_code: cc, edt, scd, ecd, schno },
    comp_uid
  );

  let rows = (rawRows || []).map(mapInttrfProceedRow);
  rows = rows.filter((r) => (Number(r.CR_AMT1) || 0) !== 0);
  if (bkCode) rows = rows.filter((r) => r.BK_CODE === bkCode);
  if (bType) rows = rows.filter((r) => String(r.B_TYPE || '').toUpperCase() === bType);
  if (lcXlc) rows = rows.filter((r) => String(r.L_C || '').toUpperCase() === lcXlc);
  rows = rows.filter((r) => inttrfPassesBusinessFilter(r, schno, mdc, minamt));

  rows.sort((a, b) => {
    if (oby === 'D') {
      const da = String(a.BILL_DATE || '');
      const db = String(b.BILL_DATE || '');
      if (da !== db) return da.localeCompare(db);
      return (a.BILL_NO || 0) - (b.BILL_NO || 0);
    }
    const ca = String(a.CODE || '');
    const cb = String(b.CODE || '');
    if (ca !== cb) return ca.localeCompare(cb);
    const da = String(a.BILL_DATE || '');
    const db = String(b.BILL_DATE || '');
    if (da !== db) return da.localeCompare(db);
    return (a.BILL_NO || 0) - (b.BILL_NO || 0);
  });

  return inttrfAddTotTrf(rows);
}

function inttrfDrCrForLine(schno, clbal) {
  const bal = Number(clbal) || 0;
  if (inttrfSchedulesEqual(schno, 8.1)) {
    if (bal < 0) return { dr: Math.abs(bal), cr: 0 };
    return { dr: 0, cr: bal };
  }
  if (bal < 0) return { dr: 0, cr: Math.abs(bal) };
  return { dr: bal, cr: 0 };
}

function inttrfPartyTotalsForLine(schno, clbal) {
  const bal = Number(clbal) || 0;
  let crAmt = 0;
  let drAmt = 0;
  if (inttrfSchedulesEqual(schno, 8.1)) {
    if (bal < 0) crAmt += Math.abs(bal);
    else drAmt += Math.abs(bal);
  } else if (bal < 0) drAmt += Math.abs(bal);
  else crAmt += Math.abs(bal);
  return { crAmt, drAmt };
}

async function saveInttrfTransfer(comp_code, comp_year, comp_uid, payload, req) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const schno = roundInttrfSchedule(payload.schno);
  if (!inttrfSchedulesEqual(schno, 8.1) && !inttrfSchedulesEqual(schno, 11.1)) {
    const err = new Error('Interest transfer is only supported for schedule 8.10 or 11.10.');
    err.status = 400;
    throw err;
  }

  const edt = parseDateOnly(payload.edt ?? payload.EDT);
  if (!edt) {
    const err = new Error('Ending Date is required.');
    err.status = 400;
    throw err;
  }

  const trfDr = await assertInttrfMasterCode(
    cc,
    payload.trf_code_dr ?? payload.trfcode,
    comp_uid,
    'Transfer Code Dr.'
  );
  const trfCr = await assertInttrfMasterCode(
    cc,
    payload.trf_code_cr ?? payload.trfcodecr,
    comp_uid,
    'Transfer Code Cr.'
  );

  const selected = (Array.isArray(payload.rows) ? payload.rows : []).filter(
    (r) => String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y'
  );
  if (!selected.length) {
    const err = new Error('Select at least one row to save.');
    err.status = 400;
    throw err;
  }

  selected.sort((a, b) => {
    const ca = String(a.CODE ?? a.code ?? '');
    const cb = String(b.CODE ?? b.code ?? '');
    if (ca !== cb) return ca.localeCompare(cb);
    const da = String(a.BILL_DATE ?? a.bill_date ?? '');
    const db = String(b.BILL_DATE ?? b.bill_date ?? '');
    if (da !== db) return da.localeCompare(db);
    return (Number(a.BILL_NO ?? a.bill_no ?? 0) || 0) - (Number(b.BILL_NO ?? b.bill_no ?? 0) || 0);
  });

  let mvno = Number(payload.vr_no ?? payload.VR_NO ?? 0) || 0;
  if (mvno < 10000) {
    const err = new Error('Voucher No. must be at least 10000.');
    err.status = 400;
    throw err;
  }

  const detailRaw = String(payload.m_detail ?? payload.M_DETAIL ?? 'TRANS').trim();
  const mdet = `* ${detailRaw}`;
  const userName = String(payload.user_name ?? payload.actor_name ?? '').trim();
  const entDate = new Date();
  const entTime = inttrfEntTimeNow();
  const computerName = inttrfComputerName(req);
  const mtype = 'N';
  const mvtype = INTTRF_VR_TYPE;

  const voucherSql = `
    INSERT INTO VOUCHER (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, DETAIL,
      DC_CODE, BILL_DATE, BILL_NO, TRN_NO, V_DATE, B_TYPE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code, :dr_amt, :cr_amt, :detail,
      :dc_code, :bill_date, :bill_no, :trn_no, :v_date, :b_type, :user_name, :ent_date, :ent_time, :computer_name
    )`;
  const ledgerSql = `
    INSERT INTO LEDGER (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, DETAIL,
      DC_CODE, TRN_NO, V_DATE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code, :dr_amt, :cr_amt, :detail,
      :dc_code, :trn_no, :v_date, :user_name, :ent_date, :ent_time, :computer_name
    )`;
  const billsSql = `
    INSERT INTO BILLS (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, DETAIL,
      BILL_DATE, BILL_NO, V_DATE, B_TYPE
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code, :dr_amt, :cr_amt, :detail,
      :bill_date, :bill_no, :v_date, :b_type
    )`;

  let partyCode = '';
  let crAmt = 0;
  let drAmt = 0;
  let trnNo = 1;
  let vouchersWritten = 0;

  async function flushPartySummary(summaryCode, summaryName) {
    if (!summaryCode) return;
    if (crAmt !== 0) {
      await runQuery(
        voucherSql,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: mvtype,
          vr_date: edt,
          vr_no: mvno,
          type: mtype,
          code: trfDr.code,
          dr_amt: 0,
          cr_amt: crAmt,
          detail: summaryName,
          dc_code: summaryCode,
          bill_date: null,
          bill_no: 0,
          trn_no: trnNo,
          v_date: edt,
          b_type: '',
          user_name: userName,
          ent_date: entDate,
          ent_time: entTime,
          computer_name: computerName,
        },
        comp_uid,
        { autoCommit: true }
      );
      await runQuery(
        ledgerSql,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: mvtype,
          vr_date: edt,
          vr_no: mvno,
          type: mtype,
          code: trfDr.code,
          dr_amt: 0,
          cr_amt: crAmt,
          detail: summaryName,
          dc_code: summaryCode,
          trn_no: trnNo,
          v_date: edt,
          user_name: userName,
          ent_date: entDate,
          ent_time: entTime,
          computer_name: computerName,
        },
        comp_uid,
        { autoCommit: true }
      );
      trnNo += 1;
      vouchersWritten += 1;
    }
    if (drAmt !== 0) {
      await runQuery(
        voucherSql,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: mvtype,
          vr_date: edt,
          vr_no: mvno,
          type: mtype,
          code: trfCr.code,
          dr_amt: drAmt,
          cr_amt: 0,
          detail: summaryName,
          dc_code: summaryCode,
          bill_date: null,
          bill_no: 0,
          trn_no: trnNo,
          v_date: edt,
          b_type: '',
          user_name: userName,
          ent_date: entDate,
          ent_time: entTime,
          computer_name: computerName,
        },
        comp_uid,
        { autoCommit: true }
      );
      await runQuery(
        ledgerSql,
        {
          comp_code: cc,
          comp_year: cy,
          vr_type: mvtype,
          vr_date: edt,
          vr_no: mvno,
          type: mtype,
          code: trfCr.code,
          dr_amt: drAmt,
          cr_amt: 0,
          detail: summaryName,
          dc_code: summaryCode,
          trn_no: trnNo,
          v_date: edt,
          user_name: userName,
          ent_date: entDate,
          ent_time: entTime,
          computer_name: computerName,
        },
        comp_uid,
        { autoCommit: true }
      );
      vouchersWritten += 1;
    }
    mvno += 1;
    crAmt = 0;
    drAmt = 0;
    trnNo = 1;
  }

  for (let i = 0; i < selected.length; i++) {
    const row = selected[i];
    const code = normalizeInttrfCode(row.CODE ?? row.code);
    const billDate = parseDateOnly(row.BILL_DATE ?? row.bill_date);
    const billNo = Number(row.BILL_NO ?? row.bill_no ?? 0) || 0;
    const bType = String(row.B_TYPE ?? row.b_type ?? '').trim().slice(0, 1);
    const clbal = Number(row.CLBAL ?? row.clbal ?? 0) || 0;
    const { dr, cr } = inttrfDrCrForLine(schno, clbal);
    const totals = inttrfPartyTotalsForLine(schno, clbal);

    if (!partyCode) {
      partyCode = code;
      crAmt = 0;
      drAmt = 0;
      trnNo = 1;
    }

    crAmt += totals.crAmt;
    drAmt += totals.drAmt;

    const binds = {
      comp_code: cc,
      comp_year: cy,
      vr_type: mvtype,
      vr_date: edt,
      vr_no: mvno,
      type: mtype,
      code,
      dr_amt: dr,
      cr_amt: cr,
      detail: mdet,
      dc_code: trfDr.code,
      bill_date: billDate,
      bill_no: billNo,
      trn_no: trnNo,
      v_date: edt,
      b_type: bType,
      user_name: userName,
      ent_date: entDate,
      ent_time: entTime,
      computer_name: computerName,
    };

    await runQuery(voucherSql, binds, comp_uid, { autoCommit: true });
    await runQuery(
      ledgerSql,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: mvtype,
        vr_date: edt,
        vr_no: mvno,
        type: mtype,
        code,
        dr_amt: dr,
        cr_amt: cr,
        detail: mdet,
        dc_code: trfDr.code,
        trn_no: trnNo,
        v_date: edt,
        user_name: userName,
        ent_date: entDate,
        ent_time: entTime,
        computer_name: computerName,
      },
      comp_uid,
      { autoCommit: true }
    );
    await runQuery(
      billsSql,
      {
        comp_code: cc,
        comp_year: cy,
        vr_type: mvtype,
        vr_date: edt,
        vr_no: mvno,
        type: mtype,
        code,
        dr_amt: dr,
        cr_amt: cr,
        detail: mdet,
        bill_date: billDate,
        bill_no: billNo,
        v_date: edt,
        b_type: bType,
      },
      comp_uid,
      { autoCommit: true }
    );
    trnNo += 1;
    vouchersWritten += 1;

    const next = selected[i + 1];
    const nextCode = next ? normalizeInttrfCode(next.CODE ?? next.code) : '';
    if (!next || nextCode !== partyCode) {
      const meta = await assertInttrfMasterCode(cc, partyCode, comp_uid, 'Party Code');
      await flushPartySummary(partyCode, meta.name);
      partyCode = nextCode;
    }
  }

  const nextVrNo = await fetchInttrfNextVrNo(cc, comp_uid);
  return {
    ok: true,
    message: 'DONE',
    vouchers_written: vouchersWritten,
    next_vr_no: nextVrNo,
  };
}

async function deleteInttrfVouchers(comp_code, comp_uid, payload) {
  const cc = Number(comp_code) || 0;
  const svno = Number(payload.svno ?? payload.SVNO ?? 0) || 0;
  const evno = Number(payload.evno ?? payload.EVNO ?? 0) || 0;
  const vdt = parseDateOnly(payload.edt ?? payload.EDT ?? payload.vr_date);
  if (!svno || !evno) {
    const err = new Error('Can Not Delete');
    err.status = 400;
    throw err;
  }
  if (!vdt) {
    const err = new Error('Ending Date is required for delete.');
    err.status = 400;
    throw err;
  }
  const binds = { comp_code: cc, vr_type: INTTRF_VR_TYPE, vdt, svno, evno };
  const where = `COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_DATE = :vdt AND VR_NO BETWEEN :svno AND :evno`;
  await runQuery(`DELETE FROM BILLS WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM LEDGER WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM VOUCHER WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  return { ok: true, message: 'Deleted' };
}

app.get('/api/inttrf-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ inttrf-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inttrf-init', async (req, res) => {
  try {
    const { comp_code, comp_uid, comp_year, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const context = await fetchInttrfInitContext(cc, comp_uid, comp_year, req.query);
    res.json({ ok: true, context });
  } catch (err) {
    console.error('❌ inttrf-init error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inttrf-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (user_name) {
      const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const rows = await fetchInttrfProceedRows(comp_code, comp_uid, body);
    res.json({ ok: true, rows, count: rows.length });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ inttrf-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/inttrf-save', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });
    const result = await saveInttrfTransfer(comp_code, comp_year, comp_uid, body, req);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ inttrf-save error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/inttrf-delete-vouchers', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    const result = await deleteInttrfVouchers(comp_code, comp_uid, body);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ inttrf-delete-vouchers error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Square Up Accounts (VFP DO FORM SQUARE) ---
const SQUARE_VR_TYPE = 'JV';
const SQUARE_DEFAULT_SCHNO = 8.1;
const SQUARE_DEFAULT_TRF_CODE = 'O00062';

function normalizeSquareCode(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
}

function roundSquareSchedule(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function fetchSquareScheduleName(comp_code, comp_uid, schno) {
  return fetchInttrfScheduleName(comp_code, comp_uid, schno);
}

async function fetchSquareInitContext(comp_code, comp_uid, comp_year, body = {}) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  let edt = parseDateOnly(body.edt ?? body.EDT ?? body.e_date) || new Date();
  const fyEnd = parseDateOnly(body.comp_e_dt ?? body.COMP_E_DT ?? body.e_date);
  if (fyEnd && edt > fyEnd) edt = fyEnd;

  const schno = roundSquareSchedule(body.schno ?? SQUARE_DEFAULT_SCHNO) || SQUARE_DEFAULT_SCHNO;
  const schName = await fetchSquareScheduleName(cc, comp_uid, schno);
  const trfDr = await assertInttrfMasterCode(cc, body.trf_code_dr ?? SQUARE_DEFAULT_TRF_CODE, comp_uid, 'Transfer Code Dr.').catch(() => ({
    code: SQUARE_DEFAULT_TRF_CODE,
    name: '',
  }));
  const trfCr = await assertInttrfMasterCode(cc, body.trf_code_cr ?? SQUARE_DEFAULT_TRF_CODE, comp_uid, 'Transfer Code Cr.').catch(() => ({
    code: SQUARE_DEFAULT_TRF_CODE,
    name: '',
  }));

  return {
    edt: formatOpdetDateOut(edt),
    schno,
    sch_name: schName,
    vr_type: SQUARE_VR_TYPE,
    trf_code_dr: trfDr.code || SQUARE_DEFAULT_TRF_CODE,
    trf_code_cr: trfCr.code || SQUARE_DEFAULT_TRF_CODE,
    trf_name_dr: trfDr.name || '',
    trf_name_cr: trfCr.name || '',
    mdc: String(body.mdc ?? 'B').trim().toUpperCase().slice(0, 1) || 'B',
    minamt: Number(body.minamt ?? 10) || 10,
    mincamt: Number(body.mincamt ?? -10) || -10,
    scd: normalizeSquareCode(body.scd ?? '1') || '1',
    ecd: normalizeSquareCode(body.ecd ?? 'Z99999') || 'Z99999',
    comp_year: cy,
  };
}

function mapSquareProceedRow(r) {
  const curbal = Number(r.CURBAL ?? r.curbal ?? 0) || 0;
  return {
    CODE: normalizeSquareCode(r.CODE ?? r.code),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    SCH_NO: roundSquareSchedule(r.SCH_NO ?? r.sch_no ?? 0),
    CURBAL: normalizeOpdetAmt(curbal),
    DR_TRF: 0,
    CR_TRF: 0,
    SLCT: '',
  };
}

function squareApplyTransferAmounts(rows, minamt, mincamt) {
  const minDr = Number(minamt) || 0;
  const minCr = Math.abs(Number(mincamt) || 0);
  return (rows || [])
    .map((row) => {
      const curbal = Number(row.CURBAL ?? row.curbal ?? 0) || 0;
      let drTrf = 0;
      let crTrf = 0;
      if (curbal > 0 && curbal <= minDr) drTrf = curbal;
      if (curbal < 0 && Math.abs(curbal) <= minCr) crTrf = Math.abs(curbal);
      return {
        ...row,
        DR_TRF: normalizeOpdetAmt(drTrf),
        CR_TRF: normalizeOpdetAmt(crTrf),
        SLCT: '',
      };
    })
    .filter((row) => (Number(row.DR_TRF) || 0) !== 0 || (Number(row.CR_TRF) || 0) !== 0);
}

async function fetchSquareProceedRows(comp_code, comp_uid, params) {
  const cc = Number(comp_code) || 0;
  const edt = parseDateOnly(params.edt ?? params.EDT);
  if (!edt) {
    const err = new Error('Ending Date is required.');
    err.status = 400;
    throw err;
  }
  const schno = roundSquareSchedule(params.schno);
  if (!schno) {
    const err = new Error('Schedule No. is required.');
    err.status = 400;
    throw err;
  }
  const scd = normalizeSquareCode(params.scd ?? '1');
  const ecd = normalizeSquareCode(params.ecd ?? 'Z99999');
  const minamt = Number(params.minamt ?? params.MINAMT ?? 10) || 0;
  const mincamt = Number(params.mincamt ?? params.MINCAMT ?? -10) || -10;

  await assertInttrfMasterCode(cc, params.trf_code_dr ?? params.trfcode, comp_uid, 'Transfer Code Dr.');

  const sql = `
    SELECT TRIM(A.CODE) AS CODE,
           TRIM(B.NAME) AS NAME,
           ROUND(NVL(B.SCHEDULE, 0), 2) AS SCH_NO,
           SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CURBAL
    FROM LEDGER A
    INNER JOIN MASTER B
      ON A.COMP_CODE = B.COMP_CODE
     AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.VR_DATE <= :edt
      AND NVL(A.BIKRI, 'N') <> 'Y'
      AND ROUND(NVL(B.SCHEDULE, 0), 2) = :schno
      AND TRIM(A.CODE) BETWEEN :scd AND :ecd
    GROUP BY TRIM(A.CODE), TRIM(B.NAME), ROUND(NVL(B.SCHEDULE, 0), 2)
    HAVING SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) <> 0
    ORDER BY TRIM(A.CODE)`;

  const rawRows = await queryInttrfRows(sql, { comp_code: cc, edt, schno, scd, ecd }, comp_uid);
  const mapped = (rawRows || []).map(mapSquareProceedRow);
  return squareApplyTransferAmounts(mapped, minamt, mincamt);
}

async function fetchSquareNextVrNoForDate(comp_code, comp_uid, edt) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT NVL(MAX(VR_NO), 0) AS VR_NO
    FROM VOUCHER
    WHERE COMP_CODE = :comp_code
      AND VR_TYPE = :vr_type
      AND VR_DATE = :vr_date`;
  const rows = await queryInttrfRows(sql, { comp_code: cc, vr_type: SQUARE_VR_TYPE, vr_date: edt }, comp_uid);
  const vr = Number(rows?.[0]?.VR_NO ?? rows?.[0]?.vr_no ?? 0) || 0;
  return vr + 1;
}

async function insertSquareVoucherLine(comp_code, comp_year, comp_uid, binds) {
  const voucherSql = `
    INSERT INTO VOUCHER (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, DETAIL,
      DC_CODE, TRN_NO, V_DATE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code, :dr_amt, :cr_amt, :detail,
      :dc_code, :trn_no, :v_date, :user_name, :ent_date, :ent_time, :computer_name
    )`;
  const ledgerSql = `
    INSERT INTO LEDGER (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, DETAIL,
      DC_CODE, TRN_NO, V_DATE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code, :dr_amt, :cr_amt, :detail,
      :dc_code, :trn_no, :v_date, :user_name, :ent_date, :ent_time, :computer_name
    )`;
  await runQuery(voucherSql, binds, comp_uid, { autoCommit: true });
  await runQuery(ledgerSql, binds, comp_uid, { autoCommit: true });
}

async function saveSquareTransfer(comp_code, comp_year, comp_uid, payload, req) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const edt = parseDateOnly(payload.edt ?? payload.EDT);
  if (!edt) {
    const err = new Error('Ending Date is required.');
    err.status = 400;
    throw err;
  }

  const trfDr = await assertInttrfMasterCode(
    cc,
    payload.trf_code_dr ?? payload.trfcode,
    comp_uid,
    'Transfer Code Dr.'
  );
  const trfCr = await assertInttrfMasterCode(
    cc,
    payload.trf_code_cr ?? payload.trfcodecr,
    comp_uid,
    'Transfer Code Cr.'
  );

  const selected = (Array.isArray(payload.rows) ? payload.rows : []).filter(
    (r) => String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y'
  );
  if (!selected.length) {
    const err = new Error('Select at least one row to save.');
    err.status = 400;
    throw err;
  }

  selected.sort((a, b) =>
    String(a.CODE ?? a.code ?? '').localeCompare(String(b.CODE ?? b.code ?? ''))
  );

  const userName = String(payload.user_name ?? payload.actor_name ?? '').trim();
  const entDate = new Date();
  const entTime = inttrfEntTimeNow();
  const computerName = inttrfComputerName(req);
  const mtype = 'N';
  let vouchersWritten = 0;
  let lastVrNo = 0;

  for (const row of selected) {
    const partyCode = normalizeSquareCode(row.CODE ?? row.code);
    const partyName = String(row.NAME ?? row.name ?? '').trim();
    const drTrf = Number(row.DR_TRF ?? row.dr_trf ?? 0) || 0;
    const crTrf = Number(row.CR_TRF ?? row.cr_trf ?? 0) || 0;
    if (!partyCode || (drTrf === 0 && crTrf === 0)) continue;

    const mvno = await fetchSquareNextVrNoForDate(cc, comp_uid, edt);
    lastVrNo = mvno;

    const line1 =
      drTrf > 0
        ? {
            code: partyCode,
            dr_amt: 0,
            cr_amt: drTrf,
            dc_code: trfDr.code,
            detail: trfDr.name,
          }
        : {
            code: partyCode,
            dr_amt: crTrf,
            cr_amt: 0,
            dc_code: trfCr.code,
            detail: trfCr.name,
          };

    const line2 =
      drTrf > 0
        ? {
            code: trfDr.code,
            dr_amt: drTrf,
            cr_amt: 0,
            dc_code: partyCode,
            detail: partyName,
          }
        : {
            code: trfCr.code,
            dr_amt: 0,
            cr_amt: crTrf,
            dc_code: partyCode,
            detail: partyName,
          };

    for (let trnNo = 1; trnNo <= 2; trnNo += 1) {
      const line = trnNo === 1 ? line1 : line2;
      await insertSquareVoucherLine(cc, cy, comp_uid, {
        comp_code: cc,
        comp_year: cy,
        vr_type: SQUARE_VR_TYPE,
        vr_date: edt,
        vr_no: mvno,
        type: mtype,
        code: line.code,
        dr_amt: line.dr_amt,
        cr_amt: line.cr_amt,
        detail: line.detail,
        dc_code: line.dc_code,
        trn_no: trnNo,
        v_date: edt,
        user_name: userName,
        ent_date: entDate,
        ent_time: entTime,
        computer_name: computerName,
      });
    }
    vouchersWritten += 1;
  }

  return {
    ok: true,
    message: 'DONE',
    vouchers_written: vouchersWritten,
    last_vr_no: lastVrNo,
  };
}

async function deleteSquareVouchers(comp_code, comp_uid, payload) {
  const cc = Number(comp_code) || 0;
  const svno = Number(payload.svno ?? payload.SVNO ?? 0) || 0;
  const evno = Number(payload.evno ?? payload.EVNO ?? 0) || 0;
  const vdt = parseDateOnly(payload.edt ?? payload.EDT ?? payload.vr_date);
  if (!svno || !evno) {
    const err = new Error('Can Not Delete');
    err.status = 400;
    throw err;
  }
  if (!vdt) {
    const err = new Error('Ending Date is required for delete.');
    err.status = 400;
    throw err;
  }
  const binds = { comp_code: cc, vr_type: SQUARE_VR_TYPE, vdt, svno, evno };
  const where = `COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_DATE = :vdt AND VR_NO BETWEEN :svno AND :evno`;
  await runQuery(`DELETE FROM LEDGER WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM VOUCHER WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  return { ok: true, message: 'Deleted' };
}

app.get('/api/square-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ square-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/square-init', async (req, res) => {
  try {
    const { comp_code, comp_uid, comp_year, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const context = await fetchSquareInitContext(cc, comp_uid, comp_year, req.query);
    res.json({ ok: true, context });
  } catch (err) {
    console.error('❌ square-init error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/square-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (user_name) {
      const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const rows = await fetchSquareProceedRows(comp_code, comp_uid, body);
    res.json({ ok: true, rows, count: rows.length });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ square-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/square-save', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.COMP_YEAR ?? 0) || 0;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });
    const result = await saveSquareTransfer(comp_code, comp_year, comp_uid, body, req);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ square-save error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/square-delete-vouchers', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    const result = await deleteSquareVouchers(comp_code, comp_uid, body);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ square-delete-vouchers error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Trial Difference (VFP DO trldif) ---
async function queryTrldifRows(sql, binds, comp_uid) {
  return queryInttrfRows(sql, binds, comp_uid);
}

function mapTrldifAmt(v) {
  return normalizeOpdetAmt(v);
}

function mapTrldifDate(v) {
  return formatOpdetDateOut(v);
}

function mapTrldifRow(row, fields) {
  const out = {};
  for (const f of fields) {
    const u = f.toUpperCase();
    const l = f.toLowerCase();
    let val = row[u] ?? row[l];
    if (f.endsWith('_DATE') || f === 'VR_DATE') val = mapTrldifDate(val);
    else if (['DR_AMT', 'CR_AMT', 'CLBAL', 'OPDIF', 'BIK_AMT', 'SALE_AMT', 'DIF_AMT', 'SCHEDULE'].includes(u)) {
      val = mapTrldifAmt(val);
    } else if (val != null) val = String(val).trim();
    out[u] = val;
    out[l] = val;
  }
  return out;
}

async function buildTrialDifferenceReport(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }
  const binds = { comp_code: cc };

  const missingScheduleSql = `
    SELECT TRIM(A.CODE) AS CODE, TRIM(A.NAME) AS NAME, ROUND(NVL(A.SCHEDULE, 0), 2) AS SCHEDULE
    FROM MASTER A
    WHERE A.COMP_CODE = :comp_code
      AND ROUND(NVL(A.SCHEDULE, 0), 2) NOT IN (
        SELECT ROUND(NVL(B.NO, 0), 2)
        FROM SCHEDULE B
        WHERE B.COMP_CODE = A.COMP_CODE
      )
    ORDER BY TRIM(A.CODE)`;

  const missingCodeSql = `
    SELECT TRIM(A.CODE) AS CODE
    FROM LEDGER A
    WHERE A.COMP_CODE = :comp_code
      AND TRIM(A.CODE) NOT IN (
        SELECT TRIM(B.CODE) FROM MASTER B
        WHERE B.COMP_CODE = A.COMP_CODE
      )
    GROUP BY TRIM(A.CODE)
    ORDER BY TRIM(A.CODE)`;

  const missingLedgerDetailSql = `
    SELECT TRIM(A.CODE) AS CODE, TRIM(A.VR_TYPE) AS VR_TYPE, A.VR_DATE, A.VR_NO,
           TRIM(A.TYPE) AS TYPE, NVL(A.DR_AMT, 0) AS DR_AMT, NVL(A.CR_AMT, 0) AS CR_AMT
    FROM LEDGER A
    WHERE A.COMP_CODE = :comp_code
      AND TRIM(A.CODE) NOT IN (
        SELECT TRIM(B.CODE) FROM MASTER B
        WHERE B.COMP_CODE = A.COMP_CODE
      )
    ORDER BY TRIM(A.CODE), TRIM(A.VR_TYPE), A.VR_DATE, A.VR_NO`;

  const doubleCodeSql = `
    SELECT TRIM(CODE) AS CODE
    FROM MASTER
    WHERE COMP_CODE = :comp_code
    GROUP BY TRIM(CODE)
    HAVING COUNT(*) > 1
    ORDER BY TRIM(CODE)`;

  const openingDiffSql = `
    SELECT TRIM(VR_TYPE) AS VR_TYPE, SUM(NVL(DR_AMT, 0) - NVL(CR_AMT, 0)) AS OPDIF
    FROM LEDGER
    WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = 'OP'
    GROUP BY TRIM(VR_TYPE)`;

  const voucherDiffSql = `
    SELECT TRIM(VR_TYPE) AS VR_TYPE, A.VR_DATE, A.VR_NO, TRIM(A.TYPE) AS TYPE,
           SUM(NVL(A.DR_AMT, 0)) AS DR_AMT, SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
           SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CLBAL
    FROM LEDGER A
    WHERE A.COMP_CODE = :comp_code
      AND TRIM(A.VR_TYPE) NOT IN ('OP', 'SV')
    GROUP BY TRIM(A.VR_TYPE), A.VR_DATE, A.VR_NO, TRIM(A.TYPE)
    HAVING SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) <> 0
    ORDER BY TRIM(A.VR_TYPE), A.VR_DATE, A.VR_NO`;

  const bikriDiffSql = `
    SELECT B_NO,
           SUM(CASE WHEN TRIM(VR_TYPE) = 'SV' THEN NVL(DR_AMT, 0) - NVL(CR_AMT, 0) ELSE 0 END) AS BIK_AMT,
           SUM(CASE WHEN TRIM(VR_TYPE) <> 'SV' AND NVL(BIKRI, 'X') = 'Y'
               THEN NVL(DR_AMT, 0) - NVL(CR_AMT, 0) ELSE 0 END) AS SALE_AMT,
           SUM(CASE WHEN TRIM(VR_TYPE) = 'SV' THEN NVL(DR_AMT, 0) - NVL(CR_AMT, 0) ELSE 0 END)
             - SUM(CASE WHEN TRIM(VR_TYPE) <> 'SV' AND NVL(BIKRI, 'X') = 'Y'
               THEN NVL(DR_AMT, 0) - NVL(CR_AMT, 0) ELSE 0 END) AS DIF_AMT
    FROM LEDGER
    WHERE COMP_CODE = :comp_code AND NVL(B_NO, 0) <> 0
    GROUP BY B_NO
    HAVING SUM(CASE WHEN TRIM(VR_TYPE) = 'SV' THEN NVL(DR_AMT, 0) - NVL(CR_AMT, 0) ELSE 0 END)
             - SUM(CASE WHEN TRIM(VR_TYPE) <> 'SV' AND NVL(BIKRI, 'X') = 'Y'
               THEN NVL(DR_AMT, 0) - NVL(CR_AMT, 0) ELSE 0 END) <> 0
    ORDER BY B_NO`;

  const tradingBikriSql = `
    SELECT TRIM(A.VR_TYPE) AS VR_TYPE, A.VR_DATE, A.VR_NO, TRIM(A.TYPE) AS TYPE,
           TRIM(A.CODE) AS CODE, NVL(A.DR_AMT, 0) AS DR_AMT, NVL(A.CR_AMT, 0) AS CR_AMT,
           NVL(A.B_NO, 0) AS B_NO, TRIM(A.BIKRI) AS BIKRI
    FROM LEDGER A
    INNER JOIN MASTER B
      ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND ROUND(NVL(B.SCHEDULE, 0), 2) = 12.1
      AND NVL(A.BIKRI, 'N') = 'Y'
    ORDER BY TRIM(A.CODE), NVL(A.B_NO, 0)`;

  const [
    missingScheduleRaw,
    missingCodeRaw,
    doubleCodeRaw,
    openingDiffRaw,
    voucherDiffRaw,
    bikriDiffRaw,
    tradingBikriRaw,
  ] = await Promise.all([
    queryTrldifRows(missingScheduleSql, binds, comp_uid),
    queryTrldifRows(missingCodeSql, binds, comp_uid),
    queryTrldifRows(doubleCodeSql, binds, comp_uid),
    queryTrldifRows(openingDiffSql, binds, comp_uid),
    queryTrldifRows(voucherDiffSql, binds, comp_uid),
    queryTrldifRows(bikriDiffSql, binds, comp_uid),
    queryTrldifRows(tradingBikriSql, binds, comp_uid),
  ]);

  let missingLedgerDetailRaw = [];
  if ((missingCodeRaw || []).length > 0) {
    missingLedgerDetailRaw = await queryTrldifRows(missingLedgerDetailSql, binds, comp_uid);
  }

  const openingDiffRow = (openingDiffRaw || [])[0];
  const opdif = Number(openingDiffRow?.OPDIF ?? openingDiffRow?.opdif ?? 0) || 0;

  return {
    ok: true,
    message: 'DONE',
    missing_schedule: (missingScheduleRaw || []).map((r) =>
      mapTrldifRow(r, ['CODE', 'NAME', 'SCHEDULE'])
    ),
    missing_code_in_master: (missingCodeRaw || []).map((r) => mapTrldifRow(r, ['CODE'])),
    missing_ledger_detail: (missingLedgerDetailRaw || []).map((r) =>
      mapTrldifRow(r, ['CODE', 'VR_TYPE', 'VR_DATE', 'VR_NO', 'TYPE', 'DR_AMT', 'CR_AMT'])
    ),
    double_code_in_master: (doubleCodeRaw || []).map((r) => mapTrldifRow(r, ['CODE'])),
    opening_diff: {
      vr_type: 'OP',
      opdif: mapTrldifAmt(opdif),
      has_difference: opdif !== 0,
    },
    voucher_diff: (voucherDiffRaw || []).map((r) =>
      mapTrldifRow(r, ['VR_TYPE', 'VR_DATE', 'VR_NO', 'TYPE', 'DR_AMT', 'CR_AMT', 'CLBAL'])
    ),
    bikri_diff: (bikriDiffRaw || []).map((r) =>
      mapTrldifRow(r, ['B_NO', 'BIK_AMT', 'SALE_AMT', 'DIF_AMT'])
    ),
    trading_bikri: (tradingBikriRaw || []).map((r) =>
      mapTrldifRow(r, ['VR_TYPE', 'VR_DATE', 'VR_NO', 'TYPE', 'CODE', 'DR_AMT', 'CR_AMT', 'B_NO', 'BIKRI'])
    ),
    counts: {
      missing_schedule: (missingScheduleRaw || []).length,
      missing_code_in_master: (missingCodeRaw || []).length,
      missing_ledger_detail: (missingLedgerDetailRaw || []).length,
      double_code_in_master: (doubleCodeRaw || []).length,
      voucher_diff: (voucherDiffRaw || []).length,
      bikri_diff: (bikriDiffRaw || []).length,
      trading_bikri: (tradingBikriRaw || []).length,
    },
  };
}

app.get('/api/trial-difference-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ trial-difference-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trial-difference', async (req, res) => {
  try {
    const { comp_code, comp_uid, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const payload = await buildTrialDifferenceReport(cc, comp_uid);
    res.json(payload);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ trial-difference error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

async function fixTrialDifferenceDoubleCode(comp_code, comp_uid, code) {
  const cc = Number(comp_code) || 0;
  const codeKey = String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
  if (!cc || !codeKey) {
    const err = new Error('comp_code and code are required');
    err.status = 400;
    throw err;
  }
  const sql = `
    DELETE FROM MASTER a
    WHERE a.COMP_CODE = :comp_code
      AND TRIM(a.CODE) = :code
      AND a.ROWID <> (
        SELECT MIN(b.ROWID)
        FROM MASTER b
        WHERE b.COMP_CODE = a.COMP_CODE
          AND TRIM(b.CODE) = TRIM(a.CODE)
      )`;
  const result = await runQuery(sql, { comp_code: cc, code: codeKey }, comp_uid, { autoCommit: true });
  const deleted = Number(result?.rowsAffected ?? result?.rowsDeleted ?? 0) || 0;
  return { ok: true, message: deleted > 0 ? `Removed ${deleted} duplicate row(s).` : 'No duplicate rows to remove.', deleted };
}

app.post('/api/trial-difference-fix-double-code', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const code = body.code ?? body.CODE;
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    const result = await fixTrialDifferenceDoubleCode(comp_code, comp_uid, code);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ trial-difference-fix-double-code error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Account Merge (VFP DO FORM amerge) ---
/** @type {Array<{ table: string, column: string, dateKind: 'bill'|'r_date'|'vr_dr'|'vr_cr'|'vr'|'none', typeKind: 'TYPE'|'VR_TYPE'|null }>} */
const ACCOUNT_MERGE_UPDATE_SPECS = [
  { table: 'SALE', column: 'CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'DELV_CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'BK_CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'BD_CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'SUP_CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'MSUP_CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'P_CODE1', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'P_CODE2', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'P_CODE3', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'P_CODE5', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'SALE', column: 'DANE_CODE', dateKind: 'bill', typeKind: 'TYPE' },
  { table: 'LOTSTOCK', column: 'CODE', dateKind: 'vr', typeKind: 'TYPE' },
  { table: 'LOTSTOCK', column: 'BK_CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
  { table: 'LOTSTOCK', column: 'SUP_CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
  { table: 'LOTSTOCK', column: 'MSUP_CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
  { table: 'VOUCHER', column: 'CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'VOUCHER', column: 'CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'VOUCHER', column: 'DC_CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'VOUCHER', column: 'DC_CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'LEDGER', column: 'CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'LEDGER', column: 'CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'LEDGER', column: 'DC_CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'LEDGER', column: 'DC_CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'LEDGER', column: 'BK_CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'LEDGER', column: 'BK_CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'BILLS', column: 'CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'BILLS', column: 'CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'BILLS', column: 'BK_CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
  { table: 'BANKSTMT', column: 'CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'BANKSTMT', column: 'CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'BANKSTMT', column: 'DC_CODE', dateKind: 'vr_dr', typeKind: 'VR_TYPE' },
  { table: 'BANKSTMT', column: 'DC_CODE', dateKind: 'vr_cr', typeKind: 'VR_TYPE' },
  { table: 'BIKRI', column: 'CODE', dateKind: 'none', typeKind: null },
  { table: 'DBIKRI', column: 'CODE', dateKind: 'none', typeKind: null },
  { table: 'DBIKRI', column: 'PCODE', dateKind: 'none', typeKind: null },
  { table: 'DBIKRI', column: 'S_CODE', dateKind: 'none', typeKind: null },
  { table: 'FREIGHT', column: 'CODE', dateKind: 'none', typeKind: null },
  { table: 'FREIGHT', column: 'S_CODE', dateKind: 'none', typeKind: null },
  { table: 'PRODUCT', column: 'SUP_CODE', dateKind: 'none', typeKind: null },
  { table: 'PURCHASE', column: 'CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'PURCHASE', column: 'SUP_CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'PURCHASE', column: 'P_CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'PURCHASE', column: 'PUR_CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'PURCHASE', column: 'B_CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'CPUR', column: 'SUP_CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'CPUR', column: 'MSUP_CODE', dateKind: 'r_date', typeKind: 'TYPE' },
  { table: 'TDS', column: 'CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
  { table: 'TDS', column: 'T_CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
  { table: 'TDS', column: 'TC_CODE', dateKind: 'vr', typeKind: 'VR_TYPE' },
];

function assertAccountMergeDateDmy(v, label) {
  const d = formatDateDmyFromRaw(v);
  if (!d) {
    const err = new Error(`${label} is required (DD-MM-YYYY).`);
    err.status = 400;
    throw err;
  }
  return d;
}

function buildAccountMergeUpdateSql(spec, hasVtp) {
  const { table, column, dateKind, typeKind } = spec;
  let sql = `UPDATE ${table} SET ${column} = :ncode WHERE COMP_CODE = :comp_code AND ${column} = :mcode`;
  if (dateKind === 'bill') {
    sql += ` AND BILL_DATE BETWEEN TO_DATE(:sdt, 'DD-MM-YYYY') AND TO_DATE(:edt, 'DD-MM-YYYY')`;
  } else if (dateKind === 'r_date') {
    sql += ` AND R_DATE BETWEEN TO_DATE(:sdt, 'DD-MM-YYYY') AND TO_DATE(:edt, 'DD-MM-YYYY')`;
  } else if (dateKind === 'vr_dr') {
    sql += ` AND VR_DATE BETWEEN TO_DATE(:sdt, 'DD-MM-YYYY') AND TO_DATE(:edt, 'DD-MM-YYYY') AND NVL(DR_AMT, 0) <> 0`;
  } else if (dateKind === 'vr_cr') {
    sql += ` AND VR_DATE BETWEEN TO_DATE(:scdt, 'DD-MM-YYYY') AND TO_DATE(:ecdt, 'DD-MM-YYYY') AND NVL(CR_AMT, 0) <> 0`;
  } else if (dateKind === 'vr') {
    sql += ` AND VR_DATE BETWEEN TO_DATE(:sdt, 'DD-MM-YYYY') AND TO_DATE(:edt, 'DD-MM-YYYY')`;
  }
  if (hasVtp && typeKind) {
    sql += typeKind === 'TYPE' ? ` AND TYPE = :vtp` : ` AND VR_TYPE = :vtp`;
  }
  return sql;
}

function buildAccountMergeBinds(spec, hasVtp, { comp_code, mcode, ncode, sdt, edt, scdt, ecdt, vtp }) {
  const binds = { comp_code, mcode, ncode };
  if (spec.dateKind === 'vr_cr') {
    binds.scdt = scdt;
    binds.ecdt = ecdt;
  } else if (spec.dateKind !== 'none') {
    binds.sdt = sdt;
    binds.edt = edt;
  }
  if (hasVtp && spec.typeKind) {
    binds.vtp = vtp;
  }
  return binds;
}

async function fetchAccountMergeMasterAccount(comp_code, code, comp_uid) {
  const codeKey = normalizeMasterPartyCodeKey(code);
  if (!codeKey) {
    const err = new Error('Account code is required.');
    err.status = 400;
    throw err;
  }
  const rows = await runQuery(
    `SELECT TRIM(CODE) AS CODE, TRIM(NAME) AS NAME
     FROM MASTER
     WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code AND ROWNUM = 1`,
    { comp_code, code: codeKey },
    comp_uid
  );
  if (!rows?.length) {
    const err = new Error(`!!! Invalid A/c Code !!! [${codeKey}]`);
    err.status = 400;
    throw err;
  }
  return {
    code: codeKey,
    name: String(rows[0].NAME ?? rows[0].name ?? '').trim(),
  };
}

async function fetchAccountMergeInitContext(comp_code, comp_uid, comp_year, body = {}) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  let sdt = formatDateDmyFromRaw(body.comp_s_dt ?? body.COMP_S_DT ?? body.sdt);
  let edt = formatDateDmyFromRaw(body.comp_e_dt ?? body.COMP_E_DT ?? body.edt);
  if ((!sdt || !edt) && cc && cy) {
    const rows = await runQuery(
      `SELECT TO_CHAR(comp_s_dt, 'DD-MM-YYYY') AS comp_s_dt, TO_CHAR(comp_e_dt, 'DD-MM-YYYY') AS comp_e_dt
       FROM compdet WHERE comp_code = :comp_code AND comp_year = :comp_year AND ROWNUM = 1`,
      { comp_code: cc, comp_year: cy }
    );
    if (!sdt) sdt = formatDateDmyFromRaw(rows?.[0]?.COMP_S_DT ?? rows?.[0]?.comp_s_dt);
    if (!edt) edt = formatDateDmyFromRaw(rows?.[0]?.COMP_E_DT ?? rows?.[0]?.comp_e_dt);
  }
  const scdt = formatDateDmyFromRaw(body.scdt) || sdt || '';
  const ecdt = formatDateDmyFromRaw(body.ecdt) || edt || '';
  return {
    sdt: sdt || '',
    edt: edt || '',
    scdt,
    ecdt,
    sdt_iso: formatOpdetDateOut(sdt) || formatOpdetDateOut(parseDateOnly(sdt)),
    edt_iso: formatOpdetDateOut(edt) || formatOpdetDateOut(parseDateOnly(edt)),
    scdt_iso: formatOpdetDateOut(scdt) || formatOpdetDateOut(parseDateOnly(scdt)),
    ecdt_iso: formatOpdetDateOut(ecdt) || formatOpdetDateOut(parseDateOnly(ecdt)),
    comp_year: cy,
  };
}

async function executeAccountMerge(comp_code, comp_uid, body) {
  const cc = Number(comp_code) || 0;
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }
  const mcode = normalizeMasterPartyCodeKey(body.mcode ?? body.MCODE);
  const ncode = normalizeMasterPartyCodeKey(body.ncode ?? body.NCODE);
  if (!mcode || !ncode) {
    const err = new Error('Old and new account codes are required.');
    err.status = 400;
    throw err;
  }
  if (mcode === ncode) {
    const err = new Error('Old and new account codes must be different.');
    err.status = 400;
    throw err;
  }
  const sdt = assertAccountMergeDateDmy(body.sdt ?? body.SDT, 'Starting Date Debit');
  const edt = assertAccountMergeDateDmy(body.edt ?? body.EDT, 'Ending Date Debit');
  const scdt = assertAccountMergeDateDmy(body.scdt ?? body.SCDT, 'Starting Date Credit');
  const ecdt = assertAccountMergeDateDmy(body.ecdt ?? body.ECDT, 'Ending Date Credit');
  const vtp = String(body.vtp ?? body.VTP ?? '').trim();
  const hasVtp = vtp.length > 0;

  await fetchAccountMergeMasterAccount(cc, mcode, comp_uid);
  await fetchAccountMergeMasterAccount(cc, ncode, comp_uid);

  const bindBase = { comp_code: cc, mcode, ncode, sdt, edt, scdt, ecdt, vtp };

  for (const spec of ACCOUNT_MERGE_UPDATE_SPECS) {
    const sql = buildAccountMergeUpdateSql(spec, hasVtp);
    const binds = buildAccountMergeBinds(spec, hasVtp, bindBase);
    try {
      await runQuery(sql, binds, comp_uid, { autoCommit: true });
    } catch (err) {
      const wrapped = new Error(`${spec.table}.${spec.column}: ${err.message}`);
      wrapped.status = 500;
      throw wrapped;
    }
  }

  return { ok: true, message: 'Merge Completed', mcode, ncode };
}

app.get('/api/account-merge-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ account-merge-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/account-merge-init', async (req, res) => {
  try {
    const { comp_code, comp_uid, comp_year, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const context = await fetchAccountMergeInitContext(cc, comp_uid, comp_year, req.query);
    res.json({ ok: true, context });
  } catch (err) {
    console.error('❌ account-merge-init error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/account-merge-lookup', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null || !code) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and code are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const acc = await fetchAccountMergeMasterAccount(cc, code, comp_uid);
    res.json({ ok: true, ...acc });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ account-merge-lookup error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/account-merge', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });
    const result = await executeAccountMerge(comp_code, comp_uid, body);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ account-merge error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Bikri No. Merge (VFP DO FORM bnotrf) ---
function normalizeBikriMergeNo(v) {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/** @type {Array<{ sqlWithMcode: string, sqlNoMcode: string }>} */
const BIKRI_NO_MERGE_UPDATES = [
  {
    sqlWithMcode: `UPDATE SALE SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE SALE SET SUP_CODE = :ncode, B_NO = :nbno, MSUP_CODE = :ncode WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE LOTSTOCK SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE LOTSTOCK SET SUP_CODE = :ncode, B_NO = :nbno, MSUP_CODE = :ncode WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE VOUCHER SET CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE VOUCHER SET CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE LEDGER SET CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE LEDGER SET CODE = :ncode, B_NO = :nbno, MSUP_CODE = :ncode WHERE COMP_CODE = :comp_code AND B_NO = :bno AND SUBSTR(CODE, 1, 1) IN ('S', 'T')`,
  },
  {
    sqlWithMcode: `UPDATE BIKRI SET CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE BIKRI SET CODE = :ncode, B_NO = :nbno, MSUP_CODE = :ncode WHERE COMP_CODE = :comp_code AND B_NO = :bno AND SUBSTR(CODE, 1, 1) IN ('S', 'T')`,
  },
  {
    sqlWithMcode: `UPDATE PRODUCT SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE PRODUCT SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE PURCHASE SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE PURCHASE SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE PURCHASE SET P_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND P_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE PURCHASE SET P_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE PURCHASE SET PUR_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND PUR_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE PURCHASE SET PUR_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
  {
    sqlWithMcode: `UPDATE CPUR SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND B_NO = :bno`,
    sqlNoMcode: `UPDATE CPUR SET SUP_CODE = :ncode, B_NO = :nbno, MSUP_CODE = :ncode WHERE COMP_CODE = :comp_code AND B_NO = :bno`,
  },
];

async function assertBikriLotstockExists(comp_code, bno, comp_uid) {
  const rows = await runQuery(
    `SELECT 1 AS X FROM LOTSTOCK WHERE COMP_CODE = :comp_code AND B_NO = :bno AND ROWNUM = 1`,
    { comp_code, bno },
    comp_uid
  );
  if (!rows?.length) {
    const err = new Error('Invalid Sup.Code/B.No.');
    err.status = 400;
    throw err;
  }
}

function isBikriMergeSupplierCode(code) {
  const c = normalizeMasterPartyCodeKey(code);
  if (!c) return false;
  const ch = c.charAt(0);
  return ch === 'S' || ch === 'T';
}

function assertBikriMergeSupplierCode(code, label) {
  if (!isBikriMergeSupplierCode(code)) {
    const err = new Error(`${label} must be a supplier code (SUBSTR(CODE,1,1) = S or T).`);
    err.status = 400;
    throw err;
  }
}

async function executeBikriNoMerge(comp_code, comp_uid, body) {
  const cc = Number(comp_code) || 0;
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }

  const mcodeRaw = String(body.mcode ?? body.MCODE ?? '').trim();
  const mcode = mcodeRaw ? normalizeMasterPartyCodeKey(mcodeRaw) : '';
  const ncode = normalizeMasterPartyCodeKey(body.ncode ?? body.NCODE);
  const bno = normalizeBikriMergeNo(body.bno ?? body.BNO);
  const nbno = normalizeBikriMergeNo(body.nbno ?? body.NBNO);

  if (!ncode) {
    const err = new Error('Invalid New Ledger Code');
    err.status = 400;
    throw err;
  }
  if (mcodeRaw && !mcode) {
    const err = new Error('!!! Invalid A/c Code !!!');
    err.status = 400;
    throw err;
  }
  if (!bno) {
    const err = new Error('Old Bikri No. is required.');
    err.status = 400;
    throw err;
  }
  if (!nbno) {
    const err = new Error('New Bikri No. is required.');
    err.status = 400;
    throw err;
  }

  assertBikriMergeSupplierCode(ncode, 'New supplier code');
  if (mcode) assertBikriMergeSupplierCode(mcode, 'Old supplier code');

  if (!mcode && !ncode) {
    return { ok: true, message: 'Nothing to merge.', skipped: true };
  }

  await fetchAccountMergeMasterAccount(cc, ncode, comp_uid);
  if (mcode) await fetchAccountMergeMasterAccount(cc, mcode, comp_uid);
  await assertBikriLotstockExists(cc, bno, comp_uid);

  const binds = { comp_code: cc, ncode, bno, nbno };
  if (mcode) binds.mcode = mcode;
  const withMcode = Boolean(mcode);

  for (let i = 0; i < BIKRI_NO_MERGE_UPDATES.length; i++) {
    const spec = BIKRI_NO_MERGE_UPDATES[i];
    const sql = withMcode ? spec.sqlWithMcode : spec.sqlNoMcode;
    try {
      await runQuery(sql, binds, comp_uid, { autoCommit: true });
    } catch (err) {
      const wrapped = new Error(`Step ${i + 1}: ${err.message}`);
      wrapped.status = 500;
      throw wrapped;
    }
  }

  return { ok: true, message: 'Merge Completed', mcode: mcode || null, ncode, bno, nbno };
}

app.get('/api/bikri-merge-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ bikri-merge-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bikri-merge-lookup', async (req, res) => {
  try {
    const { comp_code, comp_uid, code, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null || !code) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and code are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const acc = await fetchAccountMergeMasterAccount(cc, code, comp_uid);
    if (!isBikriMergeSupplierCode(acc.code)) {
      return res.status(400).json({
        error: 'Supplier code must start with S or T (SUBSTR(CODE,1,1) = S or T).',
      });
    }
    res.json({ ok: true, ...acc });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-merge-lookup error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/bikri-merge', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });
    const result = await executeBikriNoMerge(comp_code, comp_uid, body);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-merge error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Bikri No. Trf To Lot (VFP DO FORM bnotrf_lot) ---
function normalizeBikriLotItemCode(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function normalizeBikriLotNumber(v) {
  return normalizeBikriLotItemCode(v);
}

const BIKRI_LOT_MERGE_SQL = [
  `UPDATE SALE SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND LOT = :lot`,
  `UPDATE LOTSTOCK SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND ITEM_CODE = :item_code AND LOT = :lot`,
  `UPDATE VOUCHER SET CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND LOT = :lot`,
  `UPDATE LEDGER SET CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND CODE = :mcode AND ITEM_CODE = :item_code AND LOT = :lot`,
  `UPDATE PRODUCT SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND ITEM_CODE = :item_code AND LOT = :lot`,
  `UPDATE PURCHASE SET B_NO = :nbno, P_CODE = :ncode, PUR_CODE = :ncode WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND LOT = :lot`,
  `UPDATE CPUR SET SUP_CODE = :ncode, B_NO = :nbno WHERE COMP_CODE = :comp_code AND SUP_CODE = :mcode AND ITEM_CODE = :item_code AND LOT = :lot`,
];

async function fetchBikriLotMergeLotContext(comp_code, comp_uid, item_code, lot) {
  const cc = Number(comp_code) || 0;
  const itemCode = normalizeBikriLotItemCode(item_code);
  const lotNo = normalizeBikriLotNumber(lot);
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }
  if (itemCode == null) {
    const err = new Error('Item Code is required.');
    err.status = 400;
    throw err;
  }
  if (lotNo == null) {
    const err = new Error('Lot is required.');
    err.status = 400;
    throw err;
  }
  const rows = await runQuery(
    `SELECT NVL(L.B_NO, 0) AS B_NO,
            TRIM(L.SUP_CODE) AS SUP_CODE,
            TRIM(M.NAME) AS NAME
     FROM LOTSTOCK L
     LEFT JOIN MASTER M ON M.COMP_CODE = L.COMP_CODE AND TRIM(M.CODE) = TRIM(L.SUP_CODE)
     WHERE L.COMP_CODE = :comp_code
       AND L.ITEM_CODE = :item_code
       AND L.LOT = :lot
       AND ROWNUM = 1`,
    { comp_code: cc, item_code: itemCode, lot: lotNo },
    comp_uid
  );
  if (!rows?.length) {
    const err = new Error('Invalid Lot');
    err.status = 400;
    throw err;
  }
  const r = rows[0];
  const bNo = Number(r.B_NO ?? r.b_no ?? 0) || 0;
  const supCode = normalizeMasterPartyCodeKey(r.SUP_CODE ?? r.sup_code ?? '');
  const name = String(r.NAME ?? r.name ?? '').trim();
  return {
    item_code: itemCode,
    lot: lotNo,
    b_no: bNo,
    obno: bNo,
    sup_code: supCode,
    ncode: supCode,
    name,
    nbno: bNo,
  };
}

async function executeBikriLotMerge(comp_code, comp_uid, body) {
  const cc = Number(comp_code) || 0;
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }

  const itemCode = normalizeBikriLotItemCode(body.item_code ?? body.ITEM_CODE);
  const lotNo = normalizeBikriLotNumber(body.lot ?? body.LOT);
  const ncode = normalizeMasterPartyCodeKey(body.ncode ?? body.NCODE);
  const mcode = normalizeMasterPartyCodeKey(body.mcode ?? body.MCODE);
  const obno = normalizeBikriMergeNo(body.obno ?? body.OBNO ?? body.bno ?? body.BNO);
  const nbno = normalizeBikriMergeNo(body.nbno ?? body.NBNO);

  if (itemCode == null) {
    const err = new Error('Item Code is required.');
    err.status = 400;
    throw err;
  }
  if (lotNo == null) {
    const err = new Error('Lot is required.');
    err.status = 400;
    throw err;
  }
  if (!ncode) {
    const err = new Error('Invalid New Ledger Code');
    err.status = 400;
    throw err;
  }
  if (!mcode) {
    const err = new Error('Supplier code from lot is required — load lot first.');
    err.status = 400;
    throw err;
  }
  if (!obno) {
    const err = new Error('Old Bikri No. is required.');
    err.status = 400;
    throw err;
  }
  if (!nbno) {
    const err = new Error('New Bikri No. is required.');
    err.status = 400;
    throw err;
  }

  assertBikriMergeSupplierCode(ncode, 'Supplier code');
  assertBikriMergeSupplierCode(mcode, 'Original supplier code');
  await fetchAccountMergeMasterAccount(cc, ncode, comp_uid);
  await fetchAccountMergeMasterAccount(cc, mcode, comp_uid);
  await fetchBikriLotMergeLotContext(cc, comp_uid, itemCode, lotNo);

  const binds = {
    comp_code: cc,
    ncode,
    mcode,
    nbno,
    item_code: itemCode,
    lot: lotNo,
  };

  for (let i = 0; i < BIKRI_LOT_MERGE_SQL.length; i++) {
    try {
      await runQuery(BIKRI_LOT_MERGE_SQL[i], binds, comp_uid, { autoCommit: true });
    } catch (err) {
      const wrapped = new Error(`Step ${i + 1}: ${err.message}`);
      wrapped.status = 500;
      throw wrapped;
    }
  }

  return {
    ok: true,
    message: 'Merge Completed',
    item_code: itemCode,
    lot: lotNo,
    mcode,
    ncode,
    obno,
    nbno,
  };
}

app.get('/api/bikri-lot-merge-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ bikri-lot-merge-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bikri-lot-merge-lookup', async (req, res) => {
  try {
    const { comp_code, comp_uid, item_code, lot, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null || item_code == null || lot == null) {
      return res.status(400).json({ error: 'comp_code, comp_uid, item_code, and lot are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const ctx = await fetchBikriLotMergeLotContext(cc, comp_uid, item_code, lot);
    res.json({ ok: true, context: ctx });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-lot-merge-lookup error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/bikri-lot-merge', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });
    const result = await executeBikriLotMerge(comp_code, comp_uid, body);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ bikri-lot-merge error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Shortage Transfer (VFP DO FORM shortage) ---
const SHORTAGE_VR_TYPE = 'SH';
const SHORTAGE_LEDGER_CONTRA = 'E00000';
const lotstockColCache = new Map();
const shortageColCache = new Map();

async function getLotstockColumns(comp_uid) {
  const key = String(comp_uid || '_').trim() || '_';
  if (lotstockColCache.has(key)) return lotstockColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'LOTSTOCK' ORDER BY COLUMN_ID`,
    {},
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase())
  );
  lotstockColCache.set(key, cols);
  return cols;
}

async function getShortageColumns(comp_uid) {
  const key = String(comp_uid || '_').trim() || '_';
  if (shortageColCache.has(key)) return shortageColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'SHORTAGE' ORDER BY COLUMN_ID`,
    {},
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase())
  );
  shortageColCache.set(key, cols);
  return cols;
}

async function fetchShortageUsesGWeight(comp_code, comp_uid) {
  try {
    const rows = await queryInttrfRows(
      `SELECT NVL(STK_TDG_WGT_TYPE, 'W') AS WT FROM DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
      { comp_code: Number(comp_code) || 0 },
      comp_uid
    );
    return String(rows?.[0]?.WT ?? rows?.[0]?.wt ?? 'W')
      .trim()
      .toUpperCase() === 'G';
  } catch {
    return false;
  }
}

async function resolveShortageWeightField(comp_code, comp_uid) {
  const lotCols = await getLotstockColumns(comp_uid);
  if (!lotCols.has('G_WEIGHT')) return 'WEIGHT';
  const useG = await fetchShortageUsesGWeight(comp_code, comp_uid);
  return useG ? 'G_WEIGHT' : 'WEIGHT';
}

function buildShortageLotDetailGWeightExprs(hasGWeight) {
  if (hasGWeight) {
    return {
      rGWeight: `CASE WHEN A.E_TYPE = 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS R_G_WEIGHT`,
      sGWeight: `CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.G_WEIGHT, 0) ELSE 0 END AS SG_WEIGHT`,
    };
  }
  return {
    rGWeight: `0 AS R_G_WEIGHT`,
    sGWeight: `0 AS SG_WEIGHT`,
  };
}

const SHORTAGE_ROW_INSERT_SPECS = [
  ['COMP_CODE', 'comp_code', true],
  ['COMP_YEAR', 'comp_year', true],
  ['VR_TYPE', 'vr_type', true],
  ['VR_DATE', 'vr_date', true],
  ['VR_NO', 'vr_no', true],
  ['TRN_NO', 'trn_no', false],
  ['ITEM_CODE', 'item_code', true],
  ['LOT', 'lot', true],
  ['B_NO', 'b_no', true],
  ['SUP_CODE', 'sup_code', true],
  ['QNTY', 'qnty', true],
  ['WEIGHT', 'weight', true],
  ['G_WEIGHT', 'g_weight', false],
  ['RATE', 'rate', true],
  ['AMOUNT', 'amount', true],
  ['STATUS', 'status', true],
  ['GOD_CODE', 'god_code', false],
  ['MSUP_CODE', 'msup_code', false],
  ['MSUP_NAME', 'msup_name', false],
];

const SHORTAGE_LOTSTOCK_INSERT_EXTRAS = [
  ['E_TYPE', 'e_type', false],
  ['ENT_DATE', 'ent_date', false],
  ['ENT_TIME', 'ent_time', false],
  ['USER_NAME', 'user_name', false],
  ['COMPUTER_NAME', 'computer_name', false],
];

function pickSqlBinds(all, keys) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(all, k)) out[k] = all[k];
  }
  return out;
}

function buildShortageTableInsert(tableName, tableCols, { lotstock = false } = {}) {
  const specs = lotstock
    ? [...SHORTAGE_ROW_INSERT_SPECS, ...SHORTAGE_LOTSTOCK_INSERT_EXTRAS]
    : SHORTAGE_ROW_INSERT_SPECS;
  const cols = [];
  const vals = [];
  const bindKeys = [];
  for (const [col, bind, required] of specs) {
    if (!required && !tableCols.has(col)) continue;
    cols.push(col);
    vals.push(`:${bind}`);
    bindKeys.push(bind);
  }
  return {
    sql: `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
    bindKeys,
  };
}

function buildShortageProceedSql(useGWeight) {
  const wfld = useGWeight ? 'G_WEIGHT' : 'WEIGHT';
  return `
    SELECT X.ITEM_CODE,
           X.LOT,
           X.B_NO,
           X.SUP_CODE,
           X.ITEM_NAME,
           X.NAME,
           X.GOD_CODE,
           X.VR_DATE,
           X.STATUS,
           NVL(X.QNTY, 0) AS QNTY,
           CAST(NVL(X.AMOUNT, 0) AS NUMBER(13, 2)) AS AMOUNT,
           CAST(NVL(X.WEIGHT, 0) AS NUMBER(10, 3)) AS WEIGHT,
           CASE WHEN NVL(X.WEIGHT, 0) <> 0
             THEN ROUND(CAST(NVL(X.AMOUNT, 0) AS NUMBER(13, 2)) / CAST(NVL(X.WEIGHT, 0) AS NUMBER(10, 3)) * 100, 2)
             ELSE 0 END AS RATE,
           CAST(NVL(X.OWEIGHT, 0) AS NUMBER(13, 3)) AS OWEIGHT,
           CAST(NVL(X.BQTY, 0) AS NUMBER(6)) AS BQTY,
           TRIM(NVL(X.MSUP_CODE, '')) AS MSUP_CODE,
           TRIM(NVL(X.MSUP_NAME, '')) AS MSUP_NAME
    FROM (
      SELECT A.ITEM_CODE,
             A.LOT,
             MAX(A.B_NO) AS B_NO,
             TRIM(A.SUP_CODE) AS SUP_CODE,
             TRIM(B.ITEM_NAME) AS ITEM_NAME,
             TRIM(C.NAME) AS NAME,
             TRIM(A.GOD_CODE) AS GOD_CODE,
             MAX(A.VR_DATE) AS VR_DATE,
             MAX(TRIM(A.MSUP_CODE)) AS MSUP_CODE,
             MAX(TRIM(A.MSUP_NAME)) AS MSUP_NAME,
             MAX(TRIM(A.STATUS)) AS STATUS,
             SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END) AS QNTY,
             SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.${wfld}, 0) ELSE 0 END) AS WEIGHT,
             SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.AMOUNT, 0) ELSE 0 END) AS AMOUNT,
             SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.${wfld}, 0) ELSE NVL(A.${wfld}, 0) * -1 END) AS OWEIGHT,
             SUM(CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END) AS BQTY
      FROM LOTSTOCK A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      INNER JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(C.CODE)
      WHERE A.COMP_CODE = :comp_code
      GROUP BY A.ITEM_CODE, A.LOT, TRIM(A.SUP_CODE), TRIM(B.ITEM_NAME), TRIM(C.NAME), TRIM(A.GOD_CODE)
    ) X
    WHERE NVL(X.BQTY, 0) = 0 AND NVL(X.OWEIGHT, 0) <> 0
    ORDER BY X.VR_DATE, X.ITEM_CODE, X.LOT`;
}

function mapShortageProceedRow(r, idx) {
  const oweight = Number(r.OWEIGHT ?? r.oweight ?? 0) || 0;
  const rate = Number(r.RATE ?? r.rate ?? 0) || 0;
  const clAmt = Math.round(((oweight * rate) / 100) * 100) / 100;
  const vrDate = r.VR_DATE ?? r.vr_date ?? null;
  return {
    TRN_NO: idx + 1,
    VR_DATE: vrDate ? formatOpdetDateOut(vrDate) : '',
    ITEM_CODE: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    ITEM_NAME: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
    LOT: Number(r.LOT ?? r.lot ?? 0) || 0,
    B_NO: Number(r.B_NO ?? r.b_no ?? 0) || 0,
    SUP_CODE: String(r.SUP_CODE ?? r.sup_code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    QNTY: Number(r.QNTY ?? r.qnty ?? 0) || 0,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
    RATE: rate,
    B_QTY: Number(r.BQTY ?? r.bqty ?? 0) || 0,
    B_WEIGHT: oweight,
    CL_AMT: clAmt,
    SLCT: '',
    STATUS: String(r.STATUS ?? r.status ?? '').trim(),
    GOD_CODE: String(r.GOD_CODE ?? r.god_code ?? '').trim(),
    MSUP_CODE: String(r.MSUP_CODE ?? r.msup_code ?? '').trim(),
    MSUP_NAME: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
  };
}

async function fetchShortageProceedRows(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }
  const wfld = await resolveShortageWeightField(cc, comp_uid);
  const sql = buildShortageProceedSql(wfld === 'G_WEIGHT');
  const rawRows = await queryInttrfRows(sql, { comp_code: cc }, comp_uid);
  return (rawRows || []).map(mapShortageProceedRow);
}

async function fetchShortageInitContext(comp_code, comp_uid, comp_year) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const rows = await queryInttrfRows(
    `SELECT NVL(MAX(VR_NO), 0) AS VR_NO
     FROM SHORTAGE
     WHERE COMP_CODE = :comp_code AND VR_TYPE = :vr_type`,
    { comp_code: cc, vr_type: SHORTAGE_VR_TYPE },
    comp_uid
  );
  const maxVr = Number(rows?.[0]?.VR_NO ?? rows?.[0]?.vr_no ?? 0) || 0;
  const wfld = await resolveShortageWeightField(cc, comp_uid);
  return {
    vr_type: SHORTAGE_VR_TYPE,
    svno: maxVr + 1 || 1,
    evno: 0,
    legtrf: 'N',
    use_g_weight: wfld === 'G_WEIGHT',
    comp_year: cy,
  };
}

async function fetchShortageLotDetailRows(comp_code, comp_uid, params) {
  const cc = Number(comp_code) || 0;
  const itemCode = Number(params.item_code ?? params.ITEM_CODE);
  const lot = Number(params.lot ?? params.LOT);
  const supCode = String(params.sup_code ?? params.SUP_CODE ?? '')
    .trim()
    .toUpperCase();
  const godCode = String(params.god_code ?? params.GOD_CODE ?? '').trim().toUpperCase();
  if (!cc) {
    const err = new Error('comp_code is required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(itemCode)) {
    const err = new Error('item_code is required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(lot)) {
    const err = new Error('lot is required');
    err.status = 400;
    throw err;
  }
  if (!supCode) {
    const err = new Error('sup_code is required');
    err.status = 400;
    throw err;
  }
  const lotCols = await getLotstockColumns(comp_uid);
  const gExprs = buildShortageLotDetailGWeightExprs(lotCols.has('G_WEIGHT'));
  const sql = `
    SELECT A.VR_DATE,
           A.VR_NO,
           A.VR_TYPE,
           A.TYPE,
           A.ITEM_CODE,
           A.LOT,
           A.STATUS,
           A.B_NO,
           TRIM(NVL(A.GOD_CODE, '')) AS GOD_CODE,
           TRIM(A.SUP_CODE) AS SUP_CODE,
           TRIM(NVL(A.E_TYPE, '')) AS E_TYPE,
           CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS R_QNTY,
           CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS S_QNTY,
           CASE WHEN A.E_TYPE = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS R_WEIGHT,
           CASE WHEN NVL(A.E_TYPE, ' ') <> 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END AS S_WEIGHT,
           ${gExprs.rGWeight},
           ${gExprs.sGWeight},
           CAST(NVL(A.RATE, 0) AS NUMBER(13, 2)) AS RATE,
           CAST(NVL(A.AMOUNT, 0) AS NUMBER(13, 2)) AS AMOUNT,
           TRIM(NVL(A.MSUP_CODE, '')) AS MSUP_CODE,
           TRIM(NVL(A.MSUP_NAME, '')) AS MSUP_NAME
    FROM LOTSTOCK A
    WHERE A.COMP_CODE = :comp_code
      AND A.ITEM_CODE = :item_code
      AND A.LOT = :lot
      AND TRIM(A.SUP_CODE) = :sup_code
      AND (:god_all = 1 OR TRIM(NVL(A.GOD_CODE, '')) = :god_code)
    ORDER BY A.VR_DATE, A.VR_NO`;
  const rows = await queryInttrfRows(
    sql,
    {
      comp_code: cc,
      item_code: itemCode,
      lot,
      sup_code: supCode,
      god_all: godCode ? 0 : 1,
      god_code: godCode,
    },
    comp_uid
  );
  return (rows || []).map((r) => ({
    VR_DATE: formatOpdetDateOut(r.VR_DATE ?? r.vr_date),
    VR_NO: Number(r.VR_NO ?? r.vr_no ?? 0) || 0,
    VR_TYPE: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
    TYPE: String(r.TYPE ?? r.type ?? '').trim(),
    ITEM_CODE: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    LOT: Number(r.LOT ?? r.lot ?? 0) || 0,
    STATUS: String(r.STATUS ?? r.status ?? '').trim(),
    B_NO: Number(r.B_NO ?? r.b_no ?? 0) || 0,
    GOD_CODE: String(r.GOD_CODE ?? r.god_code ?? '').trim(),
    SUP_CODE: String(r.SUP_CODE ?? r.sup_code ?? '').trim(),
    E_TYPE: String(r.E_TYPE ?? r.e_type ?? '').trim(),
    R_QNTY: Number(r.R_QNTY ?? r.r_qnty ?? 0) || 0,
    S_QNTY: Number(r.S_QNTY ?? r.s_qnty ?? 0) || 0,
    R_WEIGHT: Number(r.R_WEIGHT ?? r.r_weight ?? 0) || 0,
    S_WEIGHT: Number(r.S_WEIGHT ?? r.s_weight ?? 0) || 0,
    R_G_WEIGHT: Number(r.R_G_WEIGHT ?? r.r_g_weight ?? 0) || 0,
    SG_WEIGHT: Number(r.SG_WEIGHT ?? r.sg_weight ?? 0) || 0,
    RATE: Number(r.RATE ?? r.rate ?? 0) || 0,
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0) || 0,
    MSUP_CODE: String(r.MSUP_CODE ?? r.msup_code ?? '').trim(),
    MSUP_NAME: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
  }));
}

async function fetchShortageListRows(comp_code, comp_uid) {
  const cc = Number(comp_code) || 0;
  const sql = `
    SELECT NVL(A.VR_TYPE, ' ') AS VR_TYPE,
           CAST(NVL(A.VR_DATE, SYSDATE) AS DATE) AS VR_DATE,
           NVL(A.VR_NO, 0) AS VR_NO,
           NVL(A.TRN_NO, 0) AS TRN_NO,
           NVL(A.ITEM_CODE, 0) AS ITEM_CODE,
           NVL(A.LOT, 0) AS LOT,
           NVL(A.STATUS, ' ') AS STATUS,
           NVL(A.B_NO, 0) AS B_NO,
           TRIM(NVL(A.GOD_CODE, '')) AS GOD_CODE,
           TRIM(NVL(A.SUP_CODE, '')) AS SUP_CODE,
           TRIM(NVL(B.NAME, '')) AS SUP_NAME,
           NVL(A.QNTY, 0) AS QNTY,
           CAST(NVL(A.WEIGHT, 0) AS NUMBER(13, 3)) AS WEIGHT,
           CAST(NVL(A.RATE, 0) AS NUMBER(13, 2)) AS RATE,
           CAST(NVL(A.AMOUNT, 0) AS NUMBER(13, 2)) AS AMOUNT,
           TRIM(NVL(A.MSUP_CODE, '')) AS MSUP_CODE,
           TRIM(NVL(C.NAME, '')) AS MSUP_NAME
    FROM SHORTAGE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(B.CODE)
    LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.MSUP_CODE) = TRIM(C.CODE)
    WHERE A.COMP_CODE = :comp_code
    ORDER BY A.VR_TYPE, A.VR_DATE, A.VR_NO, A.TRN_NO`;
  const rawRows = await queryInttrfRows(sql, { comp_code: cc }, comp_uid);
  return (rawRows || []).map((r) => ({
    VR_TYPE: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
    VR_DATE: formatOpdetDateOut(r.VR_DATE ?? r.vr_date),
    VR_NO: Number(r.VR_NO ?? r.vr_no ?? 0) || 0,
    TRN_NO: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
    ITEM_CODE: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    LOT: Number(r.LOT ?? r.lot ?? 0) || 0,
    STATUS: String(r.STATUS ?? r.status ?? '').trim(),
    B_NO: Number(r.B_NO ?? r.b_no ?? 0) || 0,
    GOD_CODE: String(r.GOD_CODE ?? r.god_code ?? '').trim(),
    SUP_CODE: String(r.SUP_CODE ?? r.sup_code ?? '').trim(),
    SUP_NAME: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
    QNTY: Number(r.QNTY ?? r.qnty ?? 0) || 0,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
    RATE: Number(r.RATE ?? r.rate ?? 0) || 0,
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0) || 0,
    MSUP_CODE: String(r.MSUP_CODE ?? r.msup_code ?? '').trim(),
    MSUP_NAME: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
  }));
}

async function saveShortageTransfer(comp_code, comp_year, comp_uid, payload, req) {
  const cc = Number(comp_code) || 0;
  const cy = Number(comp_year) || 0;
  const selected = (Array.isArray(payload.rows) ? payload.rows : []).filter(
    (r) => String(r.SLCT ?? r.slct ?? '').trim().toUpperCase() === 'Y'
  );
  if (!selected.length) {
    const err = new Error('Select at least one row to save.');
    err.status = 400;
    throw err;
  }

  let vno = Number(payload.svno ?? payload.SVNO ?? 0) || 0;
  if (!vno) {
    const err = new Error('Starting Voucher No. is required.');
    err.status = 400;
    throw err;
  }

  const legtrf = String(payload.legtrf ?? payload.LEGTRF ?? 'N')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  const userName = String(payload.user_name ?? payload.actor_name ?? '').trim();
  const entDate = new Date();
  const entTime = inttrfEntTimeNow();
  const computerName = inttrfComputerName(req);
  const vtp = SHORTAGE_VR_TYPE;
  const etype = 'S';
  const ccode = SHORTAGE_LEDGER_CONTRA;
  let rowsWritten = 0;

  const lotCols = await getLotstockColumns(comp_uid);
  const shortageCols = await getShortageColumns(comp_uid);
  const shortageInsert = buildShortageTableInsert('SHORTAGE', shortageCols);
  const lotstockInsert = buildShortageTableInsert('LOTSTOCK', lotCols, { lotstock: true });

  const ledgerSql = `
    INSERT INTO LEDGER (
      COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, CODE, DR_AMT, CR_AMT,
      QNTY, WEIGHT, RATE, DC_CODE, ENT_DATE, ENT_TIME, USER_NAME, COMPUTER_NAME
    ) VALUES (
      :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :code, :dr_amt, :cr_amt,
      :qnty, :weight, :rate, :dc_code, :ent_date, :ent_time, :user_name, :computer_name
    )`;

  for (const row of selected) {
    const vdt = parseDateOnly(row.VR_DATE ?? row.vr_date) || entDate;
    const trnNo = Number(row.TRN_NO ?? row.trn_no ?? 0) || 0;
    const itemCode = Number(row.ITEM_CODE ?? row.item_code ?? 0) || 0;
    const lot = Number(row.LOT ?? row.lot ?? 0) || 0;
    const bNo = Number(row.B_NO ?? row.b_no ?? 0) || 0;
    const supCode = String(row.SUP_CODE ?? row.sup_code ?? '').trim().toUpperCase();
    const mq = Number(row.B_QTY ?? row.b_qty ?? row.BQTY ?? 0) || 0;
    const mw = Number(row.B_WEIGHT ?? row.b_weight ?? row.OWEIGHT ?? 0) || 0;
    const mrate = Number(row.RATE ?? row.rate ?? 0) || 0;
    const mamt = Number(row.CL_AMT ?? row.cl_amt ?? row.AMOUNT ?? 0) || 0;
    const mstatus = String(row.STATUS ?? row.status ?? '').trim().toUpperCase().slice(0, 1);
    const godCode = String(row.GOD_CODE ?? row.god_code ?? '').trim().toUpperCase();
    const msCode = String(row.MSUP_CODE ?? row.msup_code ?? '').trim().toUpperCase();
    const msName = String(row.MSUP_NAME ?? row.msup_name ?? '').trim();

    if (!supCode) continue;

    const rowAll = {
      comp_code: cc,
      comp_year: cy,
      vr_type: vtp,
      vr_date: vdt,
      vr_no: vno,
      trn_no: trnNo,
      item_code: itemCode,
      lot,
      b_no: bNo,
      sup_code: supCode,
      qnty: mq,
      weight: mw,
      g_weight: mw,
      rate: mrate,
      amount: mamt,
      status: mstatus,
      god_code: godCode,
      msup_code: msCode,
      msup_name: msName,
      e_type: etype,
      ent_date: entDate,
      ent_time: entTime,
      user_name: userName,
      computer_name: computerName,
    };

    await runQuery(
      shortageInsert.sql,
      pickSqlBinds(rowAll, shortageInsert.bindKeys),
      comp_uid,
      { autoCommit: true }
    );
    await runQuery(
      lotstockInsert.sql,
      pickSqlBinds(rowAll, lotstockInsert.bindKeys),
      comp_uid,
      { autoCommit: true }
    );

    if (legtrf === 'Y') {
      const dcode = supCode;
      const ledgerBase = {
        comp_code: cc,
        comp_year: cy,
        vr_type: vtp,
        vr_date: vdt,
        vr_no: vno,
        qnty: mq,
        weight: mw,
        rate: mrate,
        ent_date: entDate,
        ent_time: entTime,
        user_name: userName,
        computer_name: computerName,
      };
      await runQuery(
        ledgerSql,
        { ...ledgerBase, code: dcode, dr_amt: mamt, cr_amt: 0, dc_code: ccode },
        comp_uid,
        { autoCommit: true }
      );
      await runQuery(
        ledgerSql,
        { ...ledgerBase, code: ccode, dr_amt: 0, cr_amt: mamt, dc_code: dcode },
        comp_uid,
        { autoCommit: true }
      );
    }

    vno += 1;
    rowsWritten += 1;
  }

  return {
    ok: true,
    message: 'DONE',
    rows_written: rowsWritten,
    next_svno: vno,
  };
}

async function deleteShortageTransfer(comp_code, comp_uid, payload) {
  const cc = Number(comp_code) || 0;
  const svno = Number(payload.svno ?? payload.SVNO ?? 0) || 0;
  const evno = Number(payload.evno ?? payload.EVNO ?? 0) || 0;
  if (!svno || !evno) {
    const err = new Error('Can Not Delete');
    err.status = 400;
    throw err;
  }
  const binds = { comp_code: cc, vr_type: SHORTAGE_VR_TYPE, svno, evno };
  const where = `COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_NO BETWEEN :svno AND :evno`;
  await runQuery(`DELETE FROM SHORTAGE WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM LEDGER WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM LOTSTOCK WHERE ${where}`, binds, comp_uid, { autoCommit: true });
  return { ok: true, message: 'Deleted' };
}

app.get('/api/shortage-transfer-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ shortage-transfer-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shortage-transfer-init', async (req, res) => {
  try {
    const { comp_code, comp_uid, comp_year, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const context = await fetchShortageInitContext(cc, comp_uid, comp_year);
    res.json({ ok: true, context });
  } catch (err) {
    console.error('❌ shortage-transfer-init error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/shortage-transfer-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    const rows = await fetchShortageProceedRows(comp_code, comp_uid);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ shortage-transfer-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/shortage-transfer-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, user_name } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const rows = await fetchShortageListRows(cc, comp_uid);
    res.json({ ok: true, rows });
  } catch (err) {
    console.error('❌ shortage-transfer-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/shortage-transfer-lot-detail', async (req, res) => {
  try {
    const { comp_code, comp_uid, user_name, item_code, lot, sup_code, god_code } = req.query;
    const cc = String(comp_code ?? '').trim();
    if (!cc || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const u = String(user_name ?? '').trim();
    if (u) {
      const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
      const perms = masterPartyPermissionsFromF4(f4);
      if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    }
    const rows = await fetchShortageLotDetailRows(cc, comp_uid, {
      item_code,
      lot,
      sup_code,
      god_code,
    });
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ shortage-transfer-lot-detail error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/shortage-transfer-save', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const comp_year = body.comp_year;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });
    const result = await saveShortageTransfer(comp_code, comp_year, comp_uid, body, req);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ shortage-transfer-save error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/shortage-transfer-delete', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    const result = await deleteShortageTransfer(comp_code, comp_uid, body);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ shortage-transfer-delete error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Unused Account List (VFP DO FORM master_delete) ---
const UNUSED_ACCOUNTS_ADMIN_PW = 'GRAINFAS';

function assertUnusedAccountsAdminPassword(password) {
  const ok = String(password ?? '')
    .trim()
    .toUpperCase() === UNUSED_ACCOUNTS_ADMIN_PW;
  if (!ok) {
    const err = new Error('Invalid Passowrd');
    err.status = 403;
    throw err;
  }
}

function roundUnusedAccountsSchedule(v) {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 100) / 100 : 0;
}

async function fetchUnusedAccountRows(comp_code, comp_uid, schno) {
  const cc = Number(comp_code) || 0;
  const sch = roundUnusedAccountsSchedule(schno);
  const allSchedules = sch === 0 ? 1 : 0;
  const sql = `
    SELECT ROUND(NVL(A.SCHEDULE, 0), 2) AS SCHEDULE,
           TRIM(A.CODE) AS CODE,
           TRIM(NVL(A.NAME, '')) AS NAME,
           TRIM(NVL(A.CITY, '')) AS CITY,
           TRIM(NVL(A.TEL_NO_O, '')) AS TEL_NO,
           TRIM(NVL(A.GST_NO, '')) AS GST_NO,
           TRIM(NVL(A.PAN, '')) AS PAN
    FROM MASTER A
    WHERE A.COMP_CODE = :comp_code
      AND NOT EXISTS (
        SELECT 1 FROM LEDGER B
        WHERE B.COMP_CODE = A.COMP_CODE AND TRIM(B.CODE) = TRIM(A.CODE)
      )
      AND (:all_schedules = 1 OR ROUND(NVL(A.SCHEDULE, 0), 2) = :schno)
    ORDER BY ROUND(NVL(A.SCHEDULE, 0), 2), TRIM(A.CODE)`;
  const rows = await queryInttrfRows(
    sql,
    { comp_code: cc, all_schedules: allSchedules, schno: sch || 0 },
    comp_uid
  );
  return (rows || []).map((r, idx) => ({
    SCHEDULE: Number(r.SCHEDULE ?? r.schedule ?? 0) || 0,
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    CITY: String(r.CITY ?? r.city ?? '').trim(),
    TEL_NO: String(r.TEL_NO ?? r.tel_no ?? '').trim(),
    GST_NO: String(r.GST_NO ?? r.gst_no ?? '').trim(),
    PAN: String(r.PAN ?? r.pan ?? '').trim(),
    SLCT: '',
    _row: idx + 1,
  }));
}

async function deleteUnusedAccounts(comp_code, comp_uid, codes) {
  const cc = Number(comp_code) || 0;
  const list = Array.isArray(codes) ? codes : [];
  let deleted = 0;
  for (const raw of list) {
    const code = String(raw ?? '').trim().toUpperCase();
    if (!code) continue;
    await runQuery(
      `DELETE FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code`,
      { comp_code: cc, code },
      comp_uid,
      { autoCommit: true }
    );
    deleted += 1;
  }
  return { ok: true, message: 'Done', deleted };
}

app.get('/api/unused-accounts-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    const u = String(user_name ?? '').trim();
    if (!u) return res.status(400).json({ error: 'user_name is required' });
    const { f4 } = await fetchMasterPartyUserF4String(u, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ permissions: perms, flags: perms.flags });
  } catch (err) {
    console.error('❌ unused-accounts-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/unused-accounts-verify-admin', async (req, res) => {
  try {
    const password = req.body?.password ?? req.body?.admin_password ?? req.body?.apw ?? '';
    assertUnusedAccountsAdminPassword(password);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/unused-accounts-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    assertUnusedAccountsAdminPassword(body.admin_password ?? body.password ?? body.apw);
    const rows = await fetchUnusedAccountRows(comp_code, comp_uid, body.schno ?? body.SCHNO);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ unused-accounts-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/unused-accounts-delete', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    assertUnusedAccountsAdminPassword(body.admin_password ?? body.password ?? body.apw);
    const codes = Array.isArray(body.codes) ? body.codes : [];
    if (!codes.length) {
      return res.status(400).json({ error: 'Select at least one account to delete.' });
    }
    const result = await deleteUnusedAccounts(comp_code, comp_uid, codes);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ unused-accounts-delete error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Unused Cost Centre Codes (VFP DO FORM cost_delete) ---
const UNUSED_COST_CENTRES_ADMIN_PW = 'GRAINFAS';

function assertUnusedCostCentresAdminPassword(password) {
  const ok = String(password ?? '')
    .trim()
    .toUpperCase() === UNUSED_COST_CENTRES_ADMIN_PW;
  if (!ok) {
    const err = new Error('Invalid Passowrd');
    err.status = 403;
    throw err;
  }
}

async function collectUsedCostCentreCodes(comp_code, comp_uid) {
  const used = new Set();
  const sources = [
    `SELECT TRIM(COST_CODE) AS COST_CODE FROM LEDGER
     WHERE COMP_CODE = :comp_code AND COST_CODE IS NOT NULL
     GROUP BY TRIM(COST_CODE)`,
    `SELECT TRIM(COST_CODE) AS COST_CODE FROM LOTSTOCK
     WHERE COMP_CODE = :comp_code AND COST_CODE IS NOT NULL
     GROUP BY TRIM(COST_CODE)`,
    `SELECT TRIM(COST_CODE) AS COST_CODE FROM BILLS
     WHERE COMP_CODE = :comp_code AND COST_CODE IS NOT NULL
     GROUP BY TRIM(COST_CODE)`,
  ];
  for (const sql of sources) {
    try {
      const rows = await runQuery(sql, { comp_code }, comp_uid);
      for (const r of rows || []) {
        const c = String(r.COST_CODE ?? r.cost_code ?? '').trim().toUpperCase();
        if (c) used.add(c);
      }
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return used;
}

async function fetchUnusedCostCentreRows(comp_code, comp_uid) {
  const used = await collectUsedCostCentreCodes(comp_code, comp_uid);
  const allRows = await fetchCostMastMasterList(comp_code, comp_uid, '');
  return (allRows || [])
    .filter((r) => {
      const c = String(r.COST_CODE ?? r.cost_code ?? '').trim().toUpperCase();
      return c && !used.has(c);
    })
    .map((r, idx) => ({
      COST_CODE: String(r.COST_CODE ?? r.cost_code ?? '').trim(),
      COST_NAME: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
      CODE: String(r.CODE ?? r.code ?? '').trim(),
      AC_NAME: String(r.AC_NAME ?? r.ac_name ?? '').trim(),
      SLCT: '',
      _row: idx + 1,
    }));
}

async function deleteUnusedCostCentres(comp_code, comp_uid, costCodes) {
  const list = Array.isArray(costCodes) ? costCodes : [];
  let deleted = 0;
  for (const raw of list) {
    const code = normalizeCostMastCode(raw);
    if (!code) continue;
    await deleteCostMastByCode(comp_code, code, comp_uid);
    deleted += 1;
  }
  return { ok: true, message: 'Done', deleted };
}

app.get('/api/unused-cost-centres-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    res.json({ f5, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ unused-cost-centres-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/unused-cost-centres-verify-admin', async (req, res) => {
  try {
    const password = req.body?.password ?? req.body?.admin_password ?? req.body?.apw ?? '';
    assertUnusedCostCentresAdminPassword(password);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/unused-cost-centres-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    assertUnusedCostCentresAdminPassword(body.admin_password ?? body.password ?? body.apw);
    const rows = await fetchUnusedCostCentreRows(comp_code, comp_uid);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ unused-cost-centres-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/unused-cost-centres-delete', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    assertUnusedCostCentresAdminPassword(body.admin_password ?? body.password ?? body.apw);
    const costCodes = Array.isArray(body.cost_codes) ? body.cost_codes : [];
    if (!costCodes.length) {
      return res.status(400).json({ error: 'Select at least one cost centre code to delete.' });
    }
    const result = await deleteUnusedCostCentres(comp_code, comp_uid, costCodes);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ unused-cost-centres-delete error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Unused Godown Codes (VFP DO FORM godown_delete) ---
const UNUSED_GODOWNS_ADMIN_PW = 'GRAINFAS';

function assertUnusedGodownsAdminPassword(password) {
  const ok = String(password ?? '')
    .trim()
    .toUpperCase() === UNUSED_GODOWNS_ADMIN_PW;
  if (!ok) {
    const err = new Error('Invalid Passowrd');
    err.status = 403;
    throw err;
  }
}

async function collectUsedGodownCodes(comp_code, comp_uid) {
  const used = new Set();
  const sql = `SELECT TRIM(TO_CHAR(GOD_CODE)) AS GOD_CODE FROM LOTSTOCK
     WHERE COMP_CODE = :comp_code AND GOD_CODE IS NOT NULL
     GROUP BY TRIM(TO_CHAR(GOD_CODE))`;
  try {
    const rows = await runQuery(sql, { comp_code }, comp_uid);
    for (const r of rows || []) {
      const c = String(r.GOD_CODE ?? r.god_code ?? '').trim().toUpperCase();
      if (c) used.add(c);
    }
  } catch (err) {
    if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
      throw err;
    }
  }
  return used;
}

async function fetchUnusedGodownRows(comp_code, comp_uid) {
  const used = await collectUsedGodownCodes(comp_code, comp_uid);
  const allRows = await fetchGodownMasterList(comp_code, comp_uid, '');
  return (allRows || [])
    .filter((r) => {
      const c = String(r.GOD_CODE ?? r.god_code ?? '').trim().toUpperCase();
      return c && !used.has(c);
    })
    .map((r, idx) => ({
      GOD_CODE: String(r.GOD_CODE ?? r.god_code ?? '').trim(),
      GOD_NAME: String(r.GOD_NAME ?? r.god_name ?? '').trim(),
      GOD_LOCATION: String(r.GOD_LOCATION ?? r.god_location ?? '').trim(),
      SLCT: '',
      _row: idx + 1,
    }));
}

async function deleteUnusedGodowns(comp_code, comp_uid, godCodes) {
  const list = Array.isArray(godCodes) ? godCodes : [];
  let deleted = 0;
  for (const raw of list) {
    const code = normalizeGodownCode(raw);
    if (!code) continue;
    await deleteGodownByCode(comp_code, code, comp_uid);
    deleted += 1;
  }
  return { ok: true, message: 'Done', deleted };
}

app.get('/api/unused-godowns-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ unused-godowns-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/unused-godowns-verify-admin', async (req, res) => {
  try {
    const password = req.body?.password ?? req.body?.admin_password ?? req.body?.apw ?? '';
    assertUnusedGodownsAdminPassword(password);
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/unused-godowns-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    assertUnusedGodownsAdminPassword(body.admin_password ?? body.password ?? body.apw);
    const rows = await fetchUnusedGodownRows(comp_code, comp_uid);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ unused-godowns-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/unused-godowns-delete', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });
    assertUnusedGodownsAdminPassword(body.admin_password ?? body.password ?? body.apw);
    const godCodes = Array.isArray(body.god_codes) ? body.god_codes : [];
    if (!godCodes.length) {
      return res.status(400).json({ error: 'Select at least one godown code to delete.' });
    }
    const result = await deleteUnusedGodowns(comp_code, comp_uid, godCodes);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ unused-godowns-delete error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Missing Codes (VFP DO FORM master_missing_numbers) ---
function parseMasterCodeNumericParts(code) {
  const c = normalizeMasterPartyCodeKey(code);
  if (!isValidMasterPartyCodeFormat(c)) return null;
  return { prefix: c.charAt(0), num: parseInt(c.slice(1), 10), code: c };
}

function buildMasterCodeFromParts(prefix, num) {
  const p = String(prefix ?? '')
    .trim()
    .toUpperCase()
    .charAt(0);
  const n = Number(num);
  if (!p || !Number.isFinite(n) || n < 0 || n > 99999) return '';
  return `${p}${String(Math.trunc(n)).padStart(5, '0')}`;
}

async function fetchMasterCodeRangeForSchedule(comp_code, comp_uid, schedule) {
  const sched = masterPartyScheduleBind(schedule);
  if (!isValidMasterScheduleNoServer(sched)) {
    const err = new Error('Select valid schedule like 8.10, 9.10, or 11.10');
    err.status = 400;
    throw err;
  }
  const rows = await runQuery(
    `SELECT MIN(TRIM(M.CODE)) AS SCODE, MAX(TRIM(M.CODE)) AS ECODE
     FROM MASTER M
     WHERE M.COMP_CODE = :comp_code
       AND ROUND(NVL(M.SCHEDULE, 0), 2) = :schedule`,
    { comp_code, schedule: sched },
    comp_uid
  );
  const scode = String(rows?.[0]?.SCODE ?? rows?.[0]?.scode ?? '').trim().toUpperCase();
  const ecode = String(rows?.[0]?.ECODE ?? rows?.[0]?.ecode ?? '').trim().toUpperCase();
  return { scode, ecode, SCODE: scode, ECODE: ecode, schedule: sched };
}

async function fetchExistingMasterCodesInRange(comp_code, comp_uid, schedule, scode, ecode) {
  const sched = masterPartyScheduleBind(schedule);
  const s = normalizeMasterPartyCodeKey(scode);
  const e = normalizeMasterPartyCodeKey(ecode);
  const rows = await runQuery(
    `SELECT TRIM(M.CODE) AS CODE
     FROM MASTER M
     WHERE M.COMP_CODE = :comp_code
       AND ROUND(NVL(M.SCHEDULE, 0), 2) = :schedule
       AND TRIM(M.CODE) >= :scode
       AND TRIM(M.CODE) <= :ecode
     ORDER BY TRIM(M.CODE)`,
    { comp_code, schedule: sched, scode: s, ecode: e },
    comp_uid
  );
  return (rows || []).map((r) => normalizeMasterPartyCodeKey(r.CODE ?? r.code)).filter(Boolean);
}

function computeMissingMasterCodes(scode, ecode, existingCodes) {
  const start = parseMasterCodeNumericParts(scode);
  const end = parseMasterCodeNumericParts(ecode);
  if (!start || !end) {
    const err = new Error('Starting Code and Ending Code must be 6 characters: 1 letter + 5 digits.');
    err.status = 400;
    throw err;
  }
  if (start.prefix !== end.prefix) {
    const err = new Error('Starting Code and Ending Code must use the same range letter.');
    err.status = 400;
    throw err;
  }
  if (start.num > end.num) {
    const err = new Error('Starting Code must not be greater than Ending Code.');
    err.status = 400;
    throw err;
  }
  const existing = new Set((existingCodes || []).map((c) => normalizeMasterPartyCodeKey(c)));
  const missing = [];
  for (let n = start.num; n <= end.num; n += 1) {
    const code = buildMasterCodeFromParts(start.prefix, n);
    if (!existing.has(code)) {
      missing.push({ CODE: code, code, SLCT: '', _row: missing.length + 1 });
    }
  }
  return missing;
}

async function insertMissingMasterPartyRow(comp_code, comp_year, schedule, code, user_name, comp_uid) {
  const binds = {
    comp_code,
    comp_year: Number(comp_year) || 0,
    schedule: masterPartyScheduleBind(schedule),
    code: normalizeMasterPartyCodeKey(code),
    name: '.',
    add1: '',
    add2: '',
    add3: '',
    city: '',
    gst_no: '',
    state_code: '',
    state: '',
    pan: '',
    tel_no_o: '',
    l_c: 'L',
    user_name: String(user_name ?? '').trim(),
  };
  await insertMasterPartyRow(binds, comp_uid);
}

async function createMissingMasterCodes(comp_code, comp_uid, comp_year, schedule, user_name, codes) {
  const list = Array.isArray(codes) ? codes : [];
  let created = 0;
  for (const raw of list) {
    const code = normalizeMasterPartyCodeKey(raw);
    if (!isValidMasterPartyCodeFormat(code)) continue;
    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM MASTER M
       WHERE M.COMP_CODE = :comp_code AND TRIM(M.CODE) = :code AND ROWNUM = 1`,
      { comp_code, code },
      comp_uid
    );
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) continue;
    await insertMissingMasterPartyRow(comp_code, comp_year, schedule, code, user_name, comp_uid);
    created += 1;
  }
  return { ok: true, message: 'Done', created };
}

app.get('/api/missing-codes-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ missing-codes-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/missing-codes-code-range', async (req, res) => {
  try {
    const { comp_code, comp_uid, schedule } = req.query;
    if (!comp_code || comp_uid == null || schedule == null || String(schedule).trim() === '') {
      return res.status(400).json({ error: 'comp_code, comp_uid, and schedule are required' });
    }
    const data = await fetchMasterCodeRangeForSchedule(comp_code, comp_uid, schedule);
    res.json(data);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ missing-codes-code-range error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/missing-codes-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const schedule = body.schedule ?? body.schno ?? body.SCHNO;
    const scode = body.scode ?? body.SCODE ?? '';
    const ecode = body.ecode ?? body.ECODE ?? '';
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (schedule == null || String(schedule).trim() === '') {
      return res.status(400).json({ error: 'schedule is required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    const existing = await fetchExistingMasterCodesInRange(comp_code, comp_uid, schedule, scode, ecode);
    const rows = computeMissingMasterCodes(scode, ecode, existing);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ missing-codes-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/missing-codes-create', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    const schedule = body.schedule ?? body.schno ?? body.SCHNO;
    const codes = Array.isArray(body.codes) ? body.codes : [];
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (schedule == null || String(schedule).trim() === '') {
      return res.status(400).json({ error: 'schedule is required' });
    }
    if (!codes.length) {
      return res.status(400).json({ error: 'Select at least one missing code to create.' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });
    const result = await createMissingMasterCodes(
      comp_code,
      comp_uid,
      comp_year,
      schedule,
      user_name,
      codes
    );
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ missing-codes-create error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Brok.Find (VFP DO FORM brokchk WITH 1) ---
async function fetchBrokFindRows(comp_code, comp_uid, s_date, e_date) {
  const sql = `
    SELECT A.BILL_NO,
           A.BILL_DATE,
           A.B_TYPE,
           TRIM(A.CODE) AS CODE,
           NVL(B.NAME, '') AS NAME,
           NVL(A.QNTY, 0) AS QNTY,
           NVL(A.WEIGHT, 0) AS WEIGHT,
           NVL(A.RATE, 0) AS RATE,
           NVL(A.AMOUNT, 0) AS AMOUNT,
           NVL(A.DANE, '') AS DANE,
           NVL(A.DANE_WGT, 0) AS DANE_WGT,
           NVL(A.BROK_PER, 0) AS BROK_PER,
           NVL(A.BROKERAGE, 0) AS BROKERAGE
    FROM SALE A
    LEFT JOIN MASTER B
      ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND UPPER(TRIM(A.TYPE)) = 'SL'
      ${SALE_LIST_DATE_FILTER_SQL}
      AND NVL(A.BROK_PER, 0) <> 0
      AND NVL(A.BROKERAGE, 0) = 0
    ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
  const rows = await runQuery(sql, { comp_code, s_date, e_date }, comp_uid);
  return rows || [];
}

app.get('/api/brok-find-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ brok-find-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/brok-find-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const s_date = String(body.s_date ?? body.sdt ?? '').trim();
    const e_date = String(body.e_date ?? body.edt ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date are required (DD-MM-YYYY)' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    const rows = await fetchBrokFindRows(comp_code, comp_uid, s_date, e_date);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ brok-find-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Dane Find (VFP DO FORM brokchk WITH 2) ---
async function fetchDaneFindRows(comp_code, comp_uid, s_date, e_date) {
  const sql = `
    SELECT A.BILL_NO,
           A.BILL_DATE,
           A.B_TYPE,
           TRIM(A.CODE) AS CODE,
           NVL(B.NAME, '') AS NAME,
           NVL(A.QNTY, 0) AS QNTY,
           NVL(A.WEIGHT, 0) AS WEIGHT,
           NVL(A.RATE, 0) AS RATE,
           NVL(A.AMOUNT, 0) AS AMOUNT,
           NVL(A.DANE, '') AS DANE,
           NVL(A.DANE_WGT, 0) AS DANE_WGT,
           NVL(A.DANE_AMT, 0) AS DANE_AMT,
           NVL(A.BROK_PER, 0) AS BROK_PER,
           NVL(A.BROKERAGE, 0) AS BROKERAGE
    FROM SALE A
    LEFT JOIN MASTER B
      ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND UPPER(TRIM(A.TYPE)) = 'SL'
      ${SALE_LIST_DATE_FILTER_SQL}
      AND UPPER(TRIM(NVL(A.DANE, 'X'))) = 'D'
      AND NVL(A.DANE_AMT, 0) <> 0
    ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
  try {
    const rows = await runQuery(sql, { comp_code, s_date, e_date }, comp_uid);
    return rows || [];
  } catch (err) {
    if (/invalid identifier/i.test(String(err?.message || '')) && /DANE_AMT/i.test(String(err?.message || ''))) {
      const err2 = new Error('SALE.DANE_AMT column is not available in this company schema.');
      err2.status = 400;
      throw err2;
    }
    throw err;
  }
}

app.get('/api/dane-find-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ dane-find-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dane-find-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const s_date = String(body.s_date ?? body.sdt ?? '').trim();
    const e_date = String(body.e_date ?? body.edt ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date are required (DD-MM-YYYY)' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    const rows = await fetchDaneFindRows(comp_code, comp_uid, s_date, e_date);
    res.json({ ok: true, rows });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ dane-find-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Stock Transfer (VFP DO FORM stktrf) ---
function stockTransferYn(v) {
  return String(v ?? '').trim().toUpperCase() === 'Y' || v === true;
}

function stockNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stockStr(v, maxLen = 0) {
  const s = String(v ?? '').trim();
  if (!maxLen) return s;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

async function fetchStockTransferPrefs(comp_code, comp_uid) {
  const prefs = { purUseStk: false, saleUseG: false, saleWgtType2: true };
  try {
    const rows = await runQuery(
      `SELECT * FROM DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
      { comp_code },
      comp_uid,
      { suppressDbErrorLog: true }
    );
    const r = rows?.[0] || {};
    const pur = String(r.STK_PUR_WGT ?? r.PUR_WGT ?? r.stk_pur_wgt ?? '').trim().toUpperCase();
    const saleG = String(r.STK_TDG_WGT_TYPE ?? r.STK_SALE_WGT ?? r.stk_tdg_wgt_type ?? 'W')
      .trim()
      .toUpperCase();
    const saleT = Number(r.STK_SALE_WGT_TYPE ?? r.SALE_WGT_TYPE ?? r.stk_sale_wgt_type ?? 2);
    prefs.purUseStk = pur === 'S';
    prefs.saleUseG = saleG === 'G';
    prefs.saleWgtType2 = saleT === 2;
  } catch {
    /* use defaults */
  }
  return prefs;
}

async function insertLotstockRecordsBatch(comp_uid, fieldRecords) {
  if (!fieldRecords?.length) return 0;
  const lotCols = await getLotstockColumns(comp_uid);
  const colSet = new Set();
  for (const rec of fieldRecords) {
    for (const k of Object.keys(rec)) {
      const c = String(k).toUpperCase();
      if (lotCols.has(c)) colSet.add(c);
    }
  }
  const cols = [...colSet];
  if (!cols.length) return 0;
  const sql = `INSERT INTO LOTSTOCK (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`;
  const binds = fieldRecords.map((rec) => {
    const b = {};
    cols.forEach((c, i) => {
      const raw = rec[c] ?? rec[c.toLowerCase()];
      b[`b${i}`] = raw === undefined ? null : raw;
    });
    return b;
  });

  const compUid = String(comp_uid ?? '').trim();
  if (!compUid) throw new Error('comp_uid is required');
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: compUid,
      password: compUid,
      connectString: activeDbConfig.connectString,
    });
    await conn.executeMany(sql, binds, { autoCommit: false, batchSize: 500 });
    await conn.commit();
    return fieldRecords.length;
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function stockTransferVrTypesForFlags(flags) {
  const types = [];
  if (stockTransferYn(flags.purchase ?? flags.pyn)) types.push('PU');
  if (stockTransferYn(flags.sale ?? flags.syn)) types.push('SL', '.H', '.C', 'CN');
  if (stockTransferYn(flags.cpur ?? flags.cyn)) types.push('PC');
  if (stockTransferYn(flags.production ?? flags.pryn)) types.push('R', 'I', 'JR', 'JI', 'D');
  return types;
}

async function planStockTransferPurchase(comp_code, comp_year, comp_uid, prefs) {
  const rows = await runQuery(
    `SELECT A.*, B.NAME AS SUP_NAME
     FROM PURCHASE A
     JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(B.CODE)
     WHERE A.COMP_CODE = :comp_code
     ORDER BY A.TYPE, A.R_DATE, A.R_NO`,
    { comp_code },
    comp_uid
  ).catch(() => []);
  const gridRows = [];
  const inserts = [];
  let skipped = 0;
  for (const r of rows || []) {
    const stk = stockStr(r.STK ?? r.stk ?? 'Y', 1).toUpperCase();
    if (stk && stk !== 'Y') {
      skipped += 1;
      continue;
    }
    const mw = prefs.purUseStk ? stockNum(r.STK_WEIGHT ?? r.stk_weight) : stockNum(r.WEIGHT ?? r.weight);
    const vrDate = r.R_DATE ?? r.r_date;
    const vrNo = stockNum(r.R_NO ?? r.r_no);
    const itemCode = stockNum(r.ITEM_CODE ?? r.item_code);
    const qnty = stockNum(r.QNTY ?? r.qnty);
    const lot = stockNum(r.LOT ?? r.lot);
    const status = stockStr(r.STATUS ?? r.status, 1);
    const bNo = stockNum(r.B_NO ?? r.b_no);
    inserts.push({
      COMP_CODE: comp_code,
      COMP_YEAR: comp_year,
      VR_TYPE: stockStr(r.TYPE ?? r.type ?? 'PU', 6),
      VR_DATE: vrDate,
      VR_NO: vrNo,
      E_TYPE: 'R',
      SUP_CODE: stockStr(r.S_CODE ?? r.s_code ?? r.SUP_CODE ?? r.sup_code, 6),
      ITEM_CODE: itemCode,
      STATUS: status,
      QNTY: qnty,
      WEIGHT: mw,
      RATE: stockNum(r.RATE ?? r.rate),
      AMOUNT: stockNum(r.AMOUNT ?? r.amount),
      LOT: lot,
      B_NO: bNo,
      GOD_CODE: stockStr(r.GOD_CODE ?? r.god_code, 6),
      SUP_DATE: r.R_DATE ?? r.r_date,
      COST_CODE: stockStr(r.COST_CODE ?? r.cost_code, 6),
      REMARKS: stockStr(r.MLOT_NO ?? r.mlot_no, 40),
      MSUP_CODE: stockStr(r.SUP_CODE ?? r.sup_code, 6),
      MSUP_NAME: stockStr(r.SUP_NAME ?? r.sup_name ?? r.NAME ?? r.name, 50),
      TAX_FORM: stockStr(r.F_FORM ?? r.f_form, 10),
      G_WEIGHT: stockNum(r.G_WEIGHT ?? r.g_weight),
      A_WEIGHT: stockNum(r.WEIGHT ?? r.weight),
    });
    gridRows.push(stockTransferGridRow('Purchase', vrDate, vrNo, itemCode, qnty, mw, lot, status, bNo));
  }
  return { gridRows, inserts, skipped };
}

async function planStockTransferSale(comp_code, comp_year, comp_uid, prefs) {
  const rows = await runQuery(
    `SELECT A.*, B.NAME AS SUP_NAME
     FROM SALE A
     JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(B.CODE)
     WHERE A.COMP_CODE = :comp_code
     ORDER BY A.TYPE, A.BILL_DATE, A.BILL_NO`,
    { comp_code },
    comp_uid
  ).catch(() => []);
  const gridRows = [];
  const inserts = [];
  for (const r of rows || []) {
    const mwgt = saleTransferWeight(r, prefs);
    const vrDate = r.BILL_DATE ?? r.bill_date;
    const vrNo = stockNum(r.BILL_NO ?? r.bill_no);
    const itemCode = stockNum(r.ITEM_CODE ?? r.item_code);
    const qnty = stockNum(r.QNTY ?? r.qnty);
    const lot = stockNum(r.LOT ?? r.lot);
    const status = stockStr(r.STATUS ?? r.status, 1);
    const bNo = stockNum(r.B_NO ?? r.b_no);
    inserts.push({
      COMP_CODE: comp_code,
      COMP_YEAR: comp_year,
      VR_TYPE: stockStr(r.TYPE ?? r.type, 6),
      VR_DATE: vrDate,
      VR_NO: vrNo,
      TYPE: stockStr(r.B_TYPE ?? r.b_type, 6),
      E_TYPE: 'S',
      SUP_CODE: stockStr(r.SUP_CODE ?? r.sup_code, 6),
      ITEM_CODE: itemCode,
      STATUS: status,
      QNTY: qnty,
      WEIGHT: mwgt,
      RATE: stockNum(r.RATE ?? r.rate),
      AMOUNT: stockNum(r.AMOUNT ?? r.amount),
      LOT: lot,
      B_NO: bNo,
      GOD_CODE: stockStr(r.GOD_CODE ?? r.god_code, 6),
      SUP_DATE: r.SUP_DATE ?? r.sup_date,
      COST_CODE: stockStr(r.COST_CODE ?? r.cost_code, 6),
      DANE: stockStr(r.DANE ?? r.dane, 1),
      PAPLOO1: stockNum(r.PAPLOO1 ?? r.paploo1),
      PAPLOO2: stockNum(r.PAPLOO2 ?? r.paploo2),
      PAPLOO3: stockNum(r.PAPLOO3 ?? r.paploo3),
      PAPLOO4: stockNum(r.PAPLOO4 ?? r.paploo4),
      PAPLOO5: stockNum(r.PAPLOO5 ?? r.paploo5),
      COMMISSION: stockNum(r.COMMISSION ?? r.commission),
      BROKERAGE: stockNum(r.BROKERAGE ?? r.brokerage),
      CODE: stockStr(r.CODE ?? r.code, 6),
      BK_CODE: stockStr(r.BK_CODE ?? r.bk_code, 6),
      G_WEIGHT: stockNum(r.G_WEIGHT ?? r.g_weight),
      A_WEIGHT: stockNum(r.WEIGHT ?? r.weight),
    });
    gridRows.push(stockTransferGridRow('Sale', vrDate, vrNo, itemCode, qnty, mwgt, lot, status, bNo));
  }
  return { gridRows, inserts, skipped: 0 };
}

async function planStockTransferCpur(comp_code, comp_year, comp_uid) {
  const rows = await runQuery(
    `SELECT A.*, B.NAME AS MSUP_NAME
     FROM CPUR A
     LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.MSUP_CODE) = TRIM(B.CODE)
     WHERE A.COMP_CODE = :comp_code AND UPPER(TRIM(A.TYPE)) = 'PC'
     ORDER BY A.TYPE, A.R_DATE, A.R_NO`,
    { comp_code },
    comp_uid
  ).catch(() => []);
  const gridRows = [];
  const inserts = [];
  for (const r of rows || []) {
    const base = {
      COMP_CODE: comp_code,
      COMP_YEAR: comp_year,
      VR_TYPE: stockStr(r.TYPE ?? r.type ?? 'PC', 6),
      VR_DATE: r.R_DATE ?? r.r_date,
      VR_NO: stockNum(r.R_NO ?? r.r_no),
      E_TYPE: 'R',
      SUP_CODE: stockStr(r.SUP_CODE ?? r.sup_code, 6),
      ITEM_CODE: stockNum(r.ITEM_CODE ?? r.item_code),
      LOT: stockNum(r.LOT ?? r.lot),
      B_NO: stockNum(r.B_NO ?? r.b_no),
      GOD_CODE: stockStr(r.GOD_CODE ?? r.god_code, 6),
      EXP_CAT: stockStr(r.EXP_CAT ?? r.exp_cat, 10),
      GR_NO: stockStr(r.GR_NO ?? r.gr_no, 20),
      TRUCK_NO: stockStr(r.TRUCK_NO ?? r.truck_no, 20),
      TPT: stockStr(r.TPT ?? r.tpt, 20),
      CH_NO: stockStr(r.CH_NO ?? r.ch_no, 20),
      CH_DATE: r.CH_DATE ?? r.ch_date,
      F_FORM: stockStr(r.F_FORM ?? r.f_form, 10),
      LABOUR: stockStr(r.LABOUR ?? r.labour, 20),
      REMARKS: stockStr(r.REMARKS ?? r.remarks, 40),
      SUP_DATE: r.R_DATE ?? r.r_date,
      MSUP_CODE: stockStr(r.MSUP_CODE ?? r.msup_code, 6),
      MSUP_NAME: stockStr(r.MSUP_NAME ?? r.msup_name, 50),
      TAX_FORM: stockStr(r.F_FORM ?? r.f_form, 10),
      G_WEIGHT: stockNum(r.WEIGHT ?? r.weight),
      A_WEIGHT: stockNum(r.WEIGHT ?? r.weight),
    };
    let mw = stockNum(r.WEIGHT ?? r.weight);
    let ma = stockNum(r.AMOUNT ?? r.amount);
    const vrDate = r.R_DATE ?? r.r_date;
    const vrNo = stockNum(r.R_NO ?? r.r_no);
    const itemCode = stockNum(r.ITEM_CODE ?? r.item_code);
    const lot = stockNum(r.LOT ?? r.lot);
    const bNo = stockNum(r.B_NO ?? r.b_no);
    const pushCpurLine = (qty, status, weight) => {
      inserts.push({ ...base, STATUS: status, QNTY: qty, WEIGHT: weight, AMOUNT: ma });
      gridRows.push(stockTransferGridRow('CPUR', vrDate, vrNo, itemCode, qty, weight, lot, status, bNo));
    };
    const bags = stockNum(r.BAGS ?? r.bags);
    const katta = stockNum(r.KATTA ?? r.katta);
    const hkatta = stockNum(r.HKATTA ?? r.hkatta);
    if (bags !== 0) {
      pushCpurLine(bags, 'B', mw);
      mw = 0;
      ma = 0;
    }
    if (katta !== 0) {
      pushCpurLine(katta, 'K', mw);
      mw = 0;
      ma = 0;
    }
    if (hkatta !== 0) {
      pushCpurLine(hkatta, 'H', mw);
    }
  }
  return { gridRows, inserts, skipped: 0 };
}

async function planStockTransferProduction(comp_code, comp_year, comp_uid) {
  const rows = await runQuery(
    `SELECT A.*, B.NAME AS SUP_NAME
     FROM PRODUCT A
     JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(B.CODE)
     WHERE A.COMP_CODE = :comp_code
     ORDER BY A.TYPE, A.R_DATE, A.R_NO`,
    { comp_code },
    comp_uid
  ).catch(() => []);
  const gridRows = [];
  const inserts = [];
  let skipped = 0;
  for (const r of rows || []) {
    const mapped = mapProductLotstockTypes(r);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    const vrDate = r.R_DATE ?? r.r_date;
    const vrNo = stockNum(r.R_NO ?? r.r_no);
    const itemCode = stockNum(r.ITEM_CODE ?? r.item_code);
    const qnty = stockNum(r.QNTY ?? r.qnty);
    const weight = stockNum(r.WEIGHT ?? r.weight);
    const lot = stockNum(r.LOT ?? r.lot);
    const status = stockStr(r.STATUS ?? r.status, 1);
    const bNo = stockNum(r.B_NO ?? r.b_no);
    inserts.push({
      COMP_CODE: comp_code,
      COMP_YEAR: comp_year,
      VR_TYPE: mapped.vrType,
      TYPE: mapped.subType,
      VR_DATE: vrDate,
      VR_NO: vrNo,
      E_TYPE: mapped.eType,
      SUP_CODE: stockStr(r.SUP_CODE ?? r.sup_code, 6),
      ITEM_CODE: itemCode,
      STATUS: status,
      QNTY: qnty,
      WEIGHT: weight,
      LOT: lot,
      B_NO: bNo,
      GOD_CODE: stockStr(r.GOD_CODE ?? r.god_code, 6),
      SUP_DATE: r.R_DATE ?? r.r_date,
      REMARKS: stockStr(r.DETAIL ?? r.detail, 40),
      RATE: stockNum(r.RATE ?? r.rate),
      AMOUNT: stockNum(r.AMOUNT ?? r.amount),
      G_WEIGHT: weight,
      A_WEIGHT: weight,
    });
    gridRows.push(stockTransferGridRow('Production', vrDate, vrNo, itemCode, qnty, weight, lot, status, bNo));
  }
  return { gridRows, inserts, skipped };
}

async function buildStockTransferPlan(comp_code, comp_year, comp_uid, flags) {
  const prefs = await fetchStockTransferPrefs(comp_code, comp_uid);
  const rows = [];
  const inserts = [];
  const results = {};
  if (stockTransferYn(flags.purchase ?? flags.pyn)) {
    const p = await planStockTransferPurchase(comp_code, comp_year, comp_uid, prefs);
    results.purchase = { count: p.inserts.length, skipped: p.skipped };
    rows.push(...p.gridRows);
    inserts.push(...p.inserts);
  }
  if (stockTransferYn(flags.sale ?? flags.syn)) {
    const p = await planStockTransferSale(comp_code, comp_year, comp_uid, prefs);
    results.sale = { count: p.inserts.length, skipped: p.skipped };
    rows.push(...p.gridRows);
    inserts.push(...p.inserts);
  }
  if (stockTransferYn(flags.cpur ?? flags.cyn)) {
    const p = await planStockTransferCpur(comp_code, comp_year, comp_uid);
    results.cpur = { count: p.inserts.length, skipped: p.skipped };
    rows.push(...p.gridRows);
    inserts.push(...p.inserts);
  }
  if (stockTransferYn(flags.production ?? flags.pryn)) {
    const p = await planStockTransferProduction(comp_code, comp_year, comp_uid);
    results.production = { count: p.inserts.length, skipped: p.skipped };
    rows.push(...p.gridRows);
    inserts.push(...p.inserts);
  }
  return {
    rows,
    inserts,
    total: inserts.length,
    results,
    vrTypesToDelete: stockTransferVrTypesForFlags(flags),
  };
}

const stockTransferJobs = new Map();
const STOCK_TRANSFER_JOB_TTL_MS = 30 * 60 * 1000;
const STOCK_TRANSFER_BATCH_SIZE = 400;

function pruneStockTransferJobs() {
  const now = Date.now();
  for (const [id, job] of stockTransferJobs) {
    if (now - job.created > STOCK_TRANSFER_JOB_TTL_MS) stockTransferJobs.delete(id);
  }
}

function createStockTransferJob(comp_code, comp_uid, comp_year, user_name, plan) {
  pruneStockTransferJobs();
  const jobId = `stktrf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  stockTransferJobs.set(jobId, {
    comp_code,
    comp_uid,
    comp_year,
    user_name,
    rows: plan.rows,
    inserts: plan.inserts,
    total: plan.total,
    results: plan.results,
    vrTypesToDelete: plan.vrTypesToDelete,
    deleteDone: false,
    insertOffset: 0,
    created: Date.now(),
  });
  return jobId;
}

async function executeStockTransferJobChunk(jobId, comp_code, comp_uid, batchSize = STOCK_TRANSFER_BATCH_SIZE) {
  const job = stockTransferJobs.get(jobId);
  if (!job) {
    const err = new Error('Transfer session expired. Click Proceed again.');
    err.status = 410;
    throw err;
  }
  if (job.comp_code !== comp_code || String(job.comp_uid) !== String(comp_uid)) {
    const err = new Error('Transfer session does not match company.');
    err.status = 403;
    throw err;
  }
  if (!job.deleteDone) {
    await deleteLotstockByVrTypes(job.comp_code, job.comp_uid, job.vrTypesToDelete);
    job.deleteDone = true;
  }
  const size = Math.max(50, Math.min(1000, Number(batchSize) || STOCK_TRANSFER_BATCH_SIZE));
  const start = job.insertOffset;
  const end = Math.min(start + size, job.inserts.length);
  const chunk = job.inserts.slice(start, end);
  if (chunk.length) {
    await insertLotstockRecordsBatch(job.comp_uid, chunk);
    job.insertOffset = end;
  }
  const done = job.insertOffset >= job.inserts.length;
  if (done) stockTransferJobs.delete(jobId);
  return {
    completed: job.insertOffset,
    total: job.inserts.length,
    done,
    results: job.results,
    message: done ? 'Done' : 'Transferring',
  };
}

async function validateStockTransferRequest(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
  const user_name = String(body.user_name ?? '').trim();
  if (!comp_code || comp_uid == null || !user_name) {
    const err = new Error('comp_code, comp_uid, comp_year, and user_name are required');
    err.status = 400;
    throw err;
  }
  const any =
    stockTransferYn(body.purchase ?? body.pyn) ||
    stockTransferYn(body.sale ?? body.syn) ||
    stockTransferYn(body.cpur ?? body.cyn) ||
    stockTransferYn(body.production ?? body.pryn);
  if (!any) {
    const err = new Error('Select at least one module (Y) to rebuild.');
    err.status = 400;
    throw err;
  }
  const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
  const perms = itemMasterPermissionsFromF5(f5);
  if (!perms.canOpen) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (!perms.canAdd) {
    const err = new Error('You Can Not Add');
    err.status = 403;
    throw err;
  }
  return { comp_code, comp_uid, comp_year, user_name, perms };
}

async function deleteLotstockByVrTypes(comp_code, comp_uid, vrTypes) {
  const list = (Array.isArray(vrTypes) ? vrTypes : []).map((t) => stockStr(t, 6)).filter(Boolean);
  if (!list.length) return 0;
  const placeholders = list.map((_, i) => `:vt${i}`).join(', ');
  const binds = { comp_code };
  list.forEach((t, i) => {
    binds[`vt${i}`] = t;
  });
  await runQuery(
    `DELETE FROM LOTSTOCK WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) IN (${placeholders})`,
    binds,
    comp_uid,
    { autoCommit: true }
  );
  return list.length;
}

function saleTransferWeight(row, prefs) {
  const daneWgt = stockNum(row.DANE_WGT ?? row.dane_wgt);
  const paploo3 = stockNum(row.PAPLOO3 ?? row.paploo3);
  const deduct = prefs.saleWgtType2 ? daneWgt + paploo3 : 0;
  if (prefs.saleUseG) {
    const gw = stockNum(row.G_WEIGHT ?? row.g_weight);
    if (gw !== 0) {
      return prefs.saleWgtType2 ? gw - deduct : gw;
    }
    const w = stockNum(row.WEIGHT ?? row.weight);
    return prefs.saleWgtType2 ? w - deduct : w;
  }
  const w = stockNum(row.WEIGHT ?? row.weight);
  return prefs.saleWgtType2 ? w - deduct : w;
}

function mapProductLotstockTypes(row) {
  const t = stockStr(row.TYPE ?? row.type, 6).toUpperCase();
  const trn = stockNum(row.TRN_NO ?? row.trn_no);
  if (t === 'I' || t === 'JI') {
    return { vrType: t, subType: t === 'I' ? 'N' : '', eType: 'S' };
  }
  if (t === 'R' || t === 'JR') {
    return { vrType: t, subType: t === 'R' ? 'N' : '', eType: 'R' };
  }
  if (t === 'D') {
    if (trn <= 100) return { vrType: 'I', subType: 'D', eType: 'S' };
    return { vrType: 'R', subType: 'D', eType: 'R' };
  }
  return null;
}

function stockTransferGridRow(module, vrDate, vrNo, itemCode, qnty, weight, lot, status, bNo) {
  return {
    MODULE: module,
    VR_DATE: formatDateDmyFromRaw(vrDate),
    VR_NO: stockNum(vrNo),
    ITEM_CODE: stockNum(itemCode),
    QNTY: stockNum(qnty),
    WEIGHT: stockNum(weight),
    LOT: stockNum(lot),
    STATUS: stockStr(status, 1),
    B_NO: stockNum(bNo),
  };
}

app.get('/api/stock-transfer-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    res.json({ f5, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ stock-transfer-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stock-transfer-preview', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, comp_year, user_name } = await validateStockTransferRequest(body);
    const plan = await buildStockTransferPlan(comp_code, comp_year, comp_uid, body);
    const jobId = createStockTransferJob(comp_code, comp_uid, comp_year, user_name, plan);
    res.json({
      ok: true,
      jobId,
      rows: plan.rows,
      total: plan.total,
      results: plan.results,
      message: plan.total ? `${plan.total} transaction(s) ready to transfer.` : 'No entries to transfer.',
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ stock-transfer-preview error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/stock-transfer-execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid } = await validateStockTransferRequest(body);
    const jobId = String(body.jobId ?? body.job_id ?? '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const batchSize = Number(body.batchSize ?? body.batch_size ?? STOCK_TRANSFER_BATCH_SIZE) || STOCK_TRANSFER_BATCH_SIZE;
    const out = await executeStockTransferJobChunk(jobId, comp_code, comp_uid, batchSize);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ stock-transfer-execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/stock-transfer-proceed', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, comp_year, user_name } = await validateStockTransferRequest(body);
    const plan = await buildStockTransferPlan(comp_code, comp_year, comp_uid, body);
    if (!plan.total) {
      return res.json({ ok: true, message: 'No entries to transfer.', rows: [], total: 0, results: plan.results });
    }
    const jobId = createStockTransferJob(comp_code, comp_uid, comp_year, user_name, plan);
    let completed = 0;
    let done = false;
    while (!done) {
      const chunk = await executeStockTransferJobChunk(jobId, comp_code, comp_uid, STOCK_TRANSFER_BATCH_SIZE);
      completed = chunk.completed;
      done = chunk.done;
    }
    res.json({
      ok: true,
      message: 'Done',
      results: plan.results,
      rows: plan.rows,
      count: completed,
      total: plan.total,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ stock-transfer-proceed error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Sale Transfer (VFP DO FORM saletrf → SALE_GST transfer mode) ---
const SALE_TRANSFER_JOB_TTL_MS = 30 * 60 * 1000;
const SALE_TRANSFER_BATCH_BILLS = 2;
const saleTransferJobs = new Map();
const tableColCache = new Map();

function saleTrfStr(v, maxLen = 0) {
  const s = String(v ?? '').trim();
  if (!maxLen) return s;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function saleTrfNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function saleTransferGridRow(r, weight) {
  return {
    VR_DATE: formatDateDmyFromRaw(r.BILL_DATE ?? r.bill_date),
    VR_NO: saleTrfNum(r.BILL_NO ?? r.bill_no),
    B_TYPE: saleTrfStr(r.B_TYPE ?? r.b_type, 6),
    ITEM_CODE: saleTrfNum(r.ITEM_CODE ?? r.item_code),
    QNTY: saleTrfNum(r.QNTY ?? r.qnty),
    WEIGHT: saleTrfNum(weight ?? r.WEIGHT ?? r.weight),
    LOT: saleTrfNum(r.LOT ?? r.lot),
    STATUS: saleTrfStr(r.STATUS ?? r.status, 1),
    B_NO: saleTrfNum(r.B_NO ?? r.b_no),
  };
}

async function getTableColumns(comp_uid, tableName) {
  const key = `${String(comp_uid || '_').trim()}:${String(tableName || '').toUpperCase()}`;
  if (tableColCache.has(key)) return tableColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tbl ORDER BY COLUMN_ID`,
    { tbl: String(tableName || '').toUpperCase() },
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase())
  );
  tableColCache.set(key, cols);
  return cols;
}

async function insertTableRecordsBatch(comp_uid, tableName, records) {
  if (!records?.length) return 0;
  const tableCols = await getTableColumns(comp_uid, tableName);
  const colSet = new Set();
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      const c = String(k).toUpperCase();
      if (tableCols.has(c)) colSet.add(c);
    }
  }
  const cols = [...colSet];
  if (!cols.length) return 0;
  const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`;
  const binds = records.map((rec) => {
    const b = {};
    cols.forEach((c, i) => {
      const raw = rec[c] ?? rec[c.toLowerCase()];
      b[`b${i}`] = raw === undefined ? null : raw;
    });
    return b;
  });
  const compUid = String(comp_uid ?? '').trim();
  if (!compUid) throw new Error('comp_uid is required');
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: compUid,
      password: compUid,
      connectString: activeDbConfig.connectString,
    });
    await conn.executeMany(sql, binds, { autoCommit: false, batchSize: 200 });
    await conn.commit();
    return records.length;
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function saleTransferCompBind(comp_code) {
  const s = String(comp_code ?? '').trim();
  if (!s) return s;
  const n = Number(s);
  if (Number.isFinite(n) && String(n) === s) return n;
  return s;
}

function buildSaleTransferLineFilters(body) {
  const binds = {};
  const s_date = String(body.s_date ?? body.sdt ?? '').trim();
  const e_date = String(body.e_date ?? body.edt ?? '').trim();
  if (!s_date || !e_date) {
    const err = new Error('s_date and e_date are required (DD-MM-YYYY)');
    err.status = 400;
    throw err;
  }
  binds.comp_code = saleTransferCompBind(body.comp_code);
  binds.s_date = s_date;
  binds.e_date = e_date;
  const parts = [
    `A.COMP_CODE = :comp_code`,
    `AND UPPER(TRIM(A.TYPE)) = 'SL'`,
    `AND A.BILL_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')`,
    `AND A.BILL_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1`,
  ];
  const bType = saleTrfStr(body.b_type ?? body.btype ?? body.B_TYPE ?? '', 6);
  if (bType) {
    parts.push(`AND UPPER(TRIM(A.B_TYPE)) = UPPER(TRIM(:b_type))`);
    binds.b_type = bType;
  }
  const billNo = saleTrfNum(body.bill_no ?? body.billNo ?? body.BILL_NO ?? 0);
  if (billNo) {
    parts.push(`AND A.BILL_NO = :bill_no`);
    binds.bill_no = billNo;
  }
  const bikriNo = saleTrfNum(body.b_no ?? body.bikri_no ?? body.BIKRI_NO ?? 0);
  if (bikriNo) {
    parts.push(`AND A.B_NO = :b_no`);
    binds.b_no = bikriNo;
  }
  return { whereSql: parts.join('\n      '), binds };
}

async function fetchSaleTransferSaleLines(comp_code, comp_uid, body) {
  const { whereSql, binds } = buildSaleTransferLineFilters({ ...body, comp_code });
  const sql = `
    SELECT A.*, B.NAME AS PARTY_NAME
    FROM SALE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE ${whereSql}
    ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;
  return runQuery(sql, binds, comp_uid);
}

function buildSaleLotstockInsert(comp_code, comp_year, r, prefs) {
  const mwgt = saleTransferWeight(r, prefs);
  const partyCode = saleTrfStr(r.SUP_CODE ?? r.sup_code ?? r.CODE ?? r.code, 6);
  return {
    COMP_CODE: saleTransferCompBind(comp_code),
    COMP_YEAR: comp_year,
    VR_TYPE: saleTrfStr(r.TYPE ?? r.type ?? 'SL', 6),
    VR_DATE: r.BILL_DATE ?? r.bill_date,
    VR_NO: saleTrfNum(r.BILL_NO ?? r.bill_no),
    TYPE: saleTrfStr(r.B_TYPE ?? r.b_type, 6),
    E_TYPE: 'S',
    SUP_CODE: partyCode,
    ITEM_CODE: saleTrfNum(r.ITEM_CODE ?? r.item_code),
    STATUS: saleTrfStr(r.STATUS ?? r.status, 1),
    QNTY: saleTrfNum(r.QNTY ?? r.qnty),
    WEIGHT: mwgt,
    RATE: saleTrfNum(r.RATE ?? r.rate),
    AMOUNT: saleTrfNum(r.AMOUNT ?? r.amount),
    LOT: saleTrfNum(r.LOT ?? r.lot),
    B_NO: saleTrfNum(r.B_NO ?? r.b_no),
    GOD_CODE: saleTrfStr(r.GOD_CODE ?? r.god_code, 6),
    SUP_DATE: r.SUP_DATE ?? r.sup_date,
    COST_CODE: saleTrfStr(r.COST_CODE ?? r.cost_code, 6),
    DANE: saleTrfStr(r.DANE ?? r.dane, 1),
    PAPLOO1: saleTrfNum(r.PAPLOO1 ?? r.paploo1),
    PAPLOO2: saleTrfNum(r.PAPLOO2 ?? r.paploo2),
    PAPLOO3: saleTrfNum(r.PAPLOO3 ?? r.paploo3),
    PAPLOO4: saleTrfNum(r.PAPLOO4 ?? r.paploo4),
    PAPLOO5: saleTrfNum(r.PAPLOO5 ?? r.paploo5),
    COMMISSION: saleTrfNum(r.COMMISSION ?? r.commission),
    BROKERAGE: saleTrfNum(r.BROKERAGE ?? r.brokerage),
    CODE: saleTrfStr(r.CODE ?? r.code, 6),
    BK_CODE: saleTrfStr(r.BK_CODE ?? r.bk_code, 6),
    G_WEIGHT: saleTrfNum(r.G_WEIGHT ?? r.g_weight),
    A_WEIGHT: saleTrfNum(r.WEIGHT ?? r.weight),
  };
}

function saleBillKey(r) {
  const vrType = saleTrfStr(r.TYPE ?? r.type ?? 'SL', 6);
  const billNo = saleTrfNum(r.BILL_NO ?? r.bill_no);
  const bType = saleTrfStr(r.B_TYPE ?? r.b_type, 6);
  const billDate = formatDateDmyFromRaw(r.BILL_DATE ?? r.bill_date);
  return `${vrType}|${billDate}|${billNo}|${bType}`;
}

async function snapshotSaleBillPosts(comp_code, comp_uid, bill) {
  const baseBinds = {
    comp_code: saleTransferCompBind(comp_code),
    vr_type: bill.vr_type,
    vr_no: bill.bill_no,
    b_type: bill.b_type,
  };
  const billsBinds = { ...baseBinds, bill_date: bill.bill_date };
  const ledger = await runQuery(
    `SELECT * FROM LEDGER
     WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:vr_type)
       AND VR_NO = :vr_no AND TRIM(TYPE) = TRIM(:b_type)`,
    baseBinds,
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const bills = await runQuery(
    `SELECT * FROM BILLS
     WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:vr_type)
       AND VR_NO = :vr_no AND TRIM(TYPE) = TRIM(:b_type)
       AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))`,
    billsBinds,
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  return { ledger: ledger || [], bills: bills || [] };
}

async function deleteSaleBillPosts(comp_code, comp_uid, bill) {
  const baseBinds = {
    comp_code: saleTransferCompBind(comp_code),
    vr_type: bill.vr_type,
    vr_no: bill.bill_no,
    b_type: bill.b_type,
  };
  const billsBinds = { ...baseBinds, bill_date: bill.bill_date };
  const ledgerWhere = `COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:vr_type) AND VR_NO = :vr_no AND TRIM(TYPE) = TRIM(:b_type)`;
  const lotWhere = ledgerWhere;
  const billsWhere = `${ledgerWhere} AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))`;
  await runQuery(`DELETE FROM LEDGER WHERE ${ledgerWhere}`, baseBinds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM LOTSTOCK WHERE ${lotWhere}`, baseBinds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM BILLS WHERE ${billsWhere}`, billsBinds, comp_uid, { autoCommit: true });
  await runQuery(`DELETE FROM BARDSTOCK WHERE ${lotWhere}`, baseBinds, comp_uid, {
    autoCommit: true,
    suppressDbErrorLog: true,
  }).catch(() => {});
}

async function validateSaleTransferExecute(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  if (!comp_code || comp_uid == null) {
    const err = new Error('comp_code and comp_uid are required');
    err.status = 400;
    throw err;
  }
  return { comp_code, comp_uid };
}

async function transferOneSaleBill(comp_code, comp_year, comp_uid, bill, lotColsCached) {
  const baseBinds = {
    comp_code: saleTransferCompBind(comp_code),
    vr_type: bill.vr_type,
    vr_no: bill.bill_no,
    b_type: bill.b_type,
  };
  const lotWhere = `COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:vr_type) AND VR_NO = :vr_no AND TRIM(TYPE) = TRIM(:b_type)`;
  const deleteSql = `DELETE FROM LOTSTOCK WHERE ${lotWhere}`;
  const inserts = bill.lotstockInserts || [];
  if (!inserts.length) {
    await runQuery(deleteSql, baseBinds, comp_uid, { autoCommit: true });
    return {
      bill_no: bill.bill_no,
      bill_date: bill.bill_date,
      b_type: bill.b_type,
      lines: bill.lineCount,
      lotstock: 0,
    };
  }
  const lotCols = lotColsCached || (await getLotstockColumns(comp_uid));
  const colSet = new Set();
  for (const rec of inserts) {
    for (const k of Object.keys(rec)) {
      const c = String(k).toUpperCase();
      if (lotCols.has(c)) colSet.add(c);
    }
  }
  const cols = [...colSet];
  const insertSql = `INSERT INTO LOTSTOCK (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`;
  const insertBinds = inserts.map((rec) => {
    const b = {};
    cols.forEach((c, i) => {
      const raw = rec[c] ?? rec[c.toLowerCase()];
      b[`b${i}`] = raw === undefined ? null : raw;
    });
    return b;
  });
  const compUid = String(comp_uid ?? '').trim();
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: compUid,
      password: compUid,
      connectString: activeDbConfig.connectString,
    });
    await conn.execute(deleteSql, baseBinds, { autoCommit: false });
    await conn.executeMany(insertSql, insertBinds, { autoCommit: false, batchSize: 200 });
    await conn.commit();
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
  return {
    bill_no: bill.bill_no,
    bill_date: bill.bill_date,
    b_type: bill.b_type,
    lines: bill.lineCount,
    lotstock: inserts.length,
  };
}

async function buildSaleTransferPlan(comp_code, comp_year, comp_uid, body) {
  const prefs = await fetchStockTransferPrefs(comp_code, comp_uid);
  const saleLines = await fetchSaleTransferSaleLines(comp_code, comp_uid, body);
  const rows = [];
  const bills = [];
  const billMap = new Map();
  for (const r of saleLines || []) {
    const key = saleBillKey(r);
    const mwgt = saleTransferWeight(r, prefs);
    rows.push(saleTransferGridRow(r, mwgt));
    let bill = billMap.get(key);
    if (!bill) {
      bill = {
        key,
        vr_type: saleTrfStr(r.TYPE ?? r.type ?? 'SL', 6),
        bill_no: saleTrfNum(r.BILL_NO ?? r.bill_no),
        bill_date: formatDateDmyFromRaw(r.BILL_DATE ?? r.bill_date),
        b_type: saleTrfStr(r.B_TYPE ?? r.b_type, 6),
        lineCount: 0,
        lotstockInserts: [],
      };
      billMap.set(key, bill);
      bills.push(bill);
    }
    bill.lineCount += 1;
    bill.lotstockInserts.push(buildSaleLotstockInsert(comp_code, comp_year, r, prefs));
  }
  return { rows, bills, total: bills.length, lineCount: rows.length };
}

function pruneSaleTransferJobs() {
  const now = Date.now();
  for (const [id, job] of saleTransferJobs) {
    if (now - job.created > SALE_TRANSFER_JOB_TTL_MS) saleTransferJobs.delete(id);
  }
}

function createSaleTransferJob(comp_code, comp_uid, comp_year, user_name, plan) {
  pruneSaleTransferJobs();
  const jobId = `saletrf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  saleTransferJobs.set(jobId, {
    comp_code,
    comp_uid,
    comp_year,
    user_name,
    rows: plan.rows,
    bills: plan.bills,
    total: plan.total,
    lineCount: plan.lineCount,
    billOffset: 0,
    created: Date.now(),
  });
  return jobId;
}

async function executeSaleTransferJobChunk(jobId, comp_code, comp_uid, batchSize = SALE_TRANSFER_BATCH_BILLS) {
  const job = saleTransferJobs.get(jobId);
  if (!job) {
    const err = new Error('Transfer session expired. Click Proceed again.');
    err.status = 410;
    throw err;
  }
  if (String(job.comp_code) !== String(comp_code) || String(job.comp_uid) !== String(comp_uid)) {
    const err = new Error('Transfer session does not match company.');
    err.status = 403;
    throw err;
  }
  const prefs = job.prefs || (await fetchStockTransferPrefs(job.comp_code, job.comp_uid));
  job.prefs = prefs;
  if (!job.lotCols) job.lotCols = await getLotstockColumns(comp_uid);
  const size = Math.max(1, Math.min(5, Number(batchSize) || SALE_TRANSFER_BATCH_BILLS));
  const start = job.billOffset;
  const end = Math.min(start + size, job.bills.length);
  const transferred = [];
  for (let i = start; i < end; i += 1) {
    transferred.push(
      await transferOneSaleBill(job.comp_code, job.comp_year, job.comp_uid, job.bills[i], job.lotCols)
    );
  }
  job.billOffset = end;
  const done = job.billOffset >= job.bills.length;
  if (done) saleTransferJobs.delete(jobId);
  const completedLines = job.bills.slice(0, job.billOffset).reduce((n, b) => n + (b.lineCount || 0), 0);
  return {
    completed: job.billOffset,
    total: job.total,
    completedLines,
    lineCount: job.lineCount,
    transferred,
    done,
    message: done ? 'Done' : 'Transferring',
  };
}

async function validateSaleTransferRequest(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
  const user_name = String(body.user_name ?? '').trim();
  if (!comp_code || comp_uid == null || !user_name) {
    const err = new Error('comp_code, comp_uid, comp_year, and user_name are required');
    err.status = 400;
    throw err;
  }
  buildSaleTransferLineFilters({ ...body, comp_code });
  const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
  const perms = masterPartyPermissionsFromF4(f4);
  if (!perms.canOpen) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (!perms.canAdd) {
    const err = new Error('You Can Not Add');
    err.status = 403;
    throw err;
  }
  return { comp_code, comp_uid, comp_year, user_name, perms };
}

app.get('/api/sale-transfer-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ sale-transfer-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sale-transfer-preview', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, comp_year, user_name } = await validateSaleTransferRequest(body);
    const plan = await buildSaleTransferPlan(comp_code, comp_year, comp_uid, body);
    const jobId = createSaleTransferJob(comp_code, comp_uid, comp_year, user_name, plan);
    res.json({
      ok: true,
      jobId,
      rows: plan.rows,
      total: plan.total,
      lineCount: plan.lineCount,
      message: plan.total
        ? `${plan.total} bill(s) / ${plan.lineCount} line(s) ready to transfer.`
        : 'No sale bills found for the selected criteria.',
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ sale-transfer-preview error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/sale-transfer-execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid } = await validateSaleTransferExecute(body);
    const jobId = String(body.jobId ?? body.job_id ?? '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const batchSize = Number(body.batchSize ?? body.batch_size ?? SALE_TRANSFER_BATCH_BILLS) || SALE_TRANSFER_BATCH_BILLS;
    const out = await executeSaleTransferJobChunk(jobId, comp_code, comp_uid, batchSize);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ sale-transfer-execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Voucher Transfer (VFP DO FORM voutrf → VOUCHER transfer mode) ---
const VOUCHER_TRANSFER_JOB_TTL_MS = 30 * 60 * 1000;
const VOUCHER_TRANSFER_BATCH = 2;
const voucherTransferJobs = new Map();

function vouTrfStr(v, maxLen = 0) {
  return saleTrfStr(v, maxLen);
}

function vouTrfNum(v) {
  return saleTrfNum(v);
}

function voucherTransferCompBind(comp_code) {
  return saleTransferCompBind(comp_code);
}

function buildVoucherTransferLineFilters(body) {
  const binds = {};
  const s_date = String(body.s_date ?? body.sdt ?? '').trim();
  const e_date = String(body.e_date ?? body.edt ?? '').trim();
  if (!s_date || !e_date) {
    const err = new Error('s_date and e_date are required (DD-MM-YYYY)');
    err.status = 400;
    throw err;
  }
  binds.comp_code = voucherTransferCompBind(getCompCodeFromBody(body));
  binds.s_date = s_date;
  binds.e_date = e_date;
  const parts = [
    `A.COMP_CODE = :comp_code`,
    `AND A.VR_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')`,
    `AND A.VR_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1`,
  ];
  const vrType = vouTrfStr(body.vr_type ?? body.vrType ?? body.VR_TYPE ?? '', 6);
  if (vrType) {
    parts.push(`AND UPPER(TRIM(A.VR_TYPE)) = UPPER(TRIM(:vr_type))`);
    binds.vr_type = vrType;
  }
  return { whereSql: parts.join('\n      '), binds };
}

function getCompCodeFromBody(body) {
  return String(body.comp_code ?? '').trim();
}

function voucherTransferGridRow(r) {
  return {
    VR_DATE: formatDateDmyFromRaw(r.VR_DATE ?? r.vr_date),
    VR_TYPE: vouTrfStr(r.VR_TYPE ?? r.vr_type, 6),
    VR_NO: vouTrfNum(r.VR_NO ?? r.vr_no),
    TYPE: vouTrfStr(r.TYPE ?? r.type, 6),
    TRN_NO: vouTrfNum(r.TRN_NO ?? r.trn_no),
    CODE: vouTrfStr(r.CODE ?? r.code, 6),
    DR_AMT: vouTrfNum(r.DR_AMT ?? r.dr_amt),
    CR_AMT: vouTrfNum(r.CR_AMT ?? r.cr_amt),
    DETAIL: vouTrfStr(r.DETAIL ?? r.detail, 80),
  };
}

function voucherHeaderKey(r) {
  const vrType = vouTrfStr(r.VR_TYPE ?? r.vr_type, 6);
  const vrDate = formatDateDmyFromRaw(r.VR_DATE ?? r.vr_date);
  const vrNo = vouTrfNum(r.VR_NO ?? r.vr_no);
  const typ = vouTrfStr(r.TYPE ?? r.type, 6);
  return `${vrType}|${vrDate}|${vrNo}|${typ}`;
}

function voucherRowToLedgerRecord(r) {
  const out = {};
  for (const [k, v] of Object.entries(r || {})) {
    const key = String(k).toUpperCase();
    if (key === 'PARTY_NAME' || key === 'NAME' || key === 'SCHEDULE') continue;
    out[key] = v;
  }
  return out;
}

async function fetchVoucherTransferLines(comp_code, comp_uid, body) {
  const { whereSql, binds } = buildVoucherTransferLineFilters({ ...body, comp_code });
  const sql = `
    SELECT A.*
    FROM VOUCHER A
    WHERE ${whereSql}
    ORDER BY A.VR_TYPE, A.VR_DATE, A.VR_NO, A.TYPE, A.TRN_NO`;
  return runQuery(sql, binds, comp_uid);
}

async function transferOneVoucher(comp_code, comp_uid, voucher, ledgerColsCached) {
  const baseBinds = {
    comp_code: voucherTransferCompBind(comp_code),
    vr_type: voucher.vr_type,
    vr_date: voucher.vr_date,
    vr_no: voucher.vr_no,
    v_type: voucher.type,
  };
  const ledgerWhere = `COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:vr_type)
    AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:vr_date, 'DD-MM-YYYY'))
    AND VR_NO = :vr_no AND TRIM(TYPE) = TRIM(:v_type)`;
  const deleteSql = `DELETE FROM LEDGER WHERE ${ledgerWhere}`;
  const inserts = voucher.ledgerInserts || [];
  if (!inserts.length) {
    await runQuery(deleteSql, baseBinds, comp_uid, { autoCommit: true });
    return {
      vr_type: voucher.vr_type,
      vr_date: voucher.vr_date,
      vr_no: voucher.vr_no,
      type: voucher.type,
      lines: voucher.lineCount,
      ledger: 0,
    };
  }
  const ledgerCols = ledgerColsCached || (await getTableColumns(comp_uid, 'LEDGER'));
  const colSet = new Set();
  for (const rec of inserts) {
    for (const k of Object.keys(rec)) {
      const c = String(k).toUpperCase();
      if (ledgerCols.has(c)) colSet.add(c);
    }
  }
  const cols = [...colSet];
  const insertSql = `INSERT INTO LEDGER (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`;
  const insertBinds = inserts.map((rec) => {
    const b = {};
    cols.forEach((c, i) => {
      const raw = rec[c] ?? rec[c.toLowerCase()];
      b[`b${i}`] = raw === undefined ? null : raw;
    });
    return b;
  });
  const compUid = String(comp_uid ?? '').trim();
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: compUid,
      password: compUid,
      connectString: activeDbConfig.connectString,
    });
    await conn.execute(deleteSql, baseBinds, { autoCommit: false });
    await conn.executeMany(insertSql, insertBinds, { autoCommit: false, batchSize: 200 });
    await conn.commit();
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
  return {
    vr_type: voucher.vr_type,
    vr_date: voucher.vr_date,
    vr_no: voucher.vr_no,
    type: voucher.type,
    lines: voucher.lineCount,
    ledger: inserts.length,
  };
}

async function buildVoucherTransferPlan(comp_code, comp_uid, body) {
  const lines = await fetchVoucherTransferLines(comp_code, comp_uid, body);
  const rows = [];
  const voucherMap = new Map();
  const vouchers = [];
  for (const r of lines || []) {
    rows.push(voucherTransferGridRow(r));
    const key = voucherHeaderKey(r);
    let voucher = voucherMap.get(key);
    if (!voucher) {
      voucher = {
        vr_type: vouTrfStr(r.VR_TYPE ?? r.vr_type, 6),
        vr_date: formatDateDmyFromRaw(r.VR_DATE ?? r.vr_date),
        vr_no: vouTrfNum(r.VR_NO ?? r.vr_no),
        type: vouTrfStr(r.TYPE ?? r.type, 6),
        lineCount: 0,
        ledgerInserts: [],
      };
      voucherMap.set(key, voucher);
      vouchers.push(voucher);
    }
    voucher.lineCount += 1;
    voucher.ledgerInserts.push(voucherRowToLedgerRecord(r));
  }
  return { rows, vouchers, total: vouchers.length, lineCount: rows.length };
}

function pruneVoucherTransferJobs() {
  const now = Date.now();
  for (const [id, job] of voucherTransferJobs) {
    if (now - job.created > VOUCHER_TRANSFER_JOB_TTL_MS) voucherTransferJobs.delete(id);
  }
}

function createVoucherTransferJob(comp_code, comp_uid, comp_year, user_name, plan) {
  pruneVoucherTransferJobs();
  const jobId = `voutrf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  voucherTransferJobs.set(jobId, {
    comp_code,
    comp_uid,
    comp_year,
    user_name,
    rows: plan.rows,
    vouchers: plan.vouchers,
    total: plan.total,
    lineCount: plan.lineCount,
    voucherOffset: 0,
    created: Date.now(),
  });
  return jobId;
}

async function executeVoucherTransferJobChunk(jobId, comp_code, comp_uid, batchSize = VOUCHER_TRANSFER_BATCH) {
  const job = voucherTransferJobs.get(jobId);
  if (!job) {
    const err = new Error('Transfer session expired. Click Proceed again.');
    err.status = 410;
    throw err;
  }
  if (String(job.comp_code) !== String(comp_code) || String(job.comp_uid) !== String(comp_uid)) {
    const err = new Error('Transfer session does not match company.');
    err.status = 403;
    throw err;
  }
  if (!job.ledgerCols) job.ledgerCols = await getTableColumns(comp_uid, 'LEDGER');
  const size = Math.max(1, Math.min(5, Number(batchSize) || VOUCHER_TRANSFER_BATCH));
  const start = job.voucherOffset;
  const end = Math.min(start + size, job.vouchers.length);
  const transferred = [];
  for (let i = start; i < end; i += 1) {
    transferred.push(
      await transferOneVoucher(job.comp_code, job.comp_uid, job.vouchers[i], job.ledgerCols)
    );
  }
  job.voucherOffset = end;
  const done = job.voucherOffset >= job.vouchers.length;
  if (done) voucherTransferJobs.delete(jobId);
  const completedLines = job.vouchers.slice(0, job.voucherOffset).reduce((n, v) => n + (v.lineCount || 0), 0);
  return {
    completed: job.voucherOffset,
    total: job.total,
    completedLines,
    lineCount: job.lineCount,
    transferred,
    done,
    message: done ? 'Done' : 'Transferring',
  };
}

async function validateVoucherTransferRequest(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
  const user_name = String(body.user_name ?? '').trim();
  if (!comp_code || comp_uid == null || !user_name) {
    const err = new Error('comp_code, comp_uid, comp_year, and user_name are required');
    err.status = 400;
    throw err;
  }
  buildVoucherTransferLineFilters({ ...body, comp_code });
  const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
  const perms = masterPartyPermissionsFromF4(f4);
  if (!perms.canOpen) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (!perms.canAdd) {
    const err = new Error('You Can Not Add');
    err.status = 403;
    throw err;
  }
  return { comp_code, comp_uid, comp_year, user_name, perms };
}

async function validateVoucherTransferExecute(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  if (!comp_code || comp_uid == null) {
    const err = new Error('comp_code and comp_uid are required');
    err.status = 400;
    throw err;
  }
  return { comp_code, comp_uid };
}

app.get('/api/voucher-transfer-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ voucher-transfer-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/voucher-transfer-preview', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, comp_year, user_name } = await validateVoucherTransferRequest(body);
    const plan = await buildVoucherTransferPlan(comp_code, comp_uid, body);
    const jobId = createVoucherTransferJob(comp_code, comp_uid, comp_year, user_name, plan);
    res.json({
      ok: true,
      jobId,
      rows: plan.rows,
      total: plan.total,
      lineCount: plan.lineCount,
      message: plan.total
        ? `${plan.total} voucher(s) / ${plan.lineCount} line(s) ready to transfer.`
        : 'No vouchers found for the selected criteria.',
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ voucher-transfer-preview error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/voucher-transfer-execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid } = await validateVoucherTransferExecute(body);
    const jobId = String(body.jobId ?? body.job_id ?? '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const batchSize = Number(body.batchSize ?? body.batch_size ?? VOUCHER_TRANSFER_BATCH) || VOUCHER_TRANSFER_BATCH;
    const out = await executeVoucherTransferJobChunk(jobId, comp_code, comp_uid, batchSize);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ voucher-transfer-execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Purchase Transfer (VFP DO FORM purtrf → PURCHASE_GST transfer mode) ---
const PURCHASE_TRANSFER_JOB_TTL_MS = 30 * 60 * 1000;
const PURCHASE_TRANSFER_BATCH_BILLS = 2;
const purchaseTransferJobs = new Map();

function purTrfStr(v, maxLen = 0) {
  return saleTrfStr(v, maxLen);
}

function purTrfNum(v) {
  return saleTrfNum(v);
}

function purchaseTransferCompBind(comp_code) {
  return saleTransferCompBind(comp_code);
}

function purchaseTransferWeight(row, prefs) {
  return prefs?.purUseStk
    ? purTrfNum(row.STK_WEIGHT ?? row.stk_weight)
    : purTrfNum(row.WEIGHT ?? row.weight);
}

function buildPurchaseTransferLineFilters(body) {
  const binds = {};
  const s_date = String(body.s_date ?? body.sdt ?? '').trim();
  const e_date = String(body.e_date ?? body.edt ?? '').trim();
  if (!s_date || !e_date) {
    const err = new Error('s_date and e_date are required (DD-MM-YYYY)');
    err.status = 400;
    throw err;
  }
  binds.comp_code = purchaseTransferCompBind(body.comp_code);
  binds.s_date = s_date;
  binds.e_date = e_date;
  const parts = [
    `A.COMP_CODE = :comp_code`,
    `AND UPPER(TRIM(A.TYPE)) = 'PU'`,
    `AND A.R_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')`,
    `AND A.R_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1`,
  ];
  return { whereSql: parts.join('\n      '), binds };
}

function purchaseTransferGridRow(r, weight) {
  return {
    VR_DATE: formatDateDmyFromRaw(r.R_DATE ?? r.r_date),
    VR_NO: purTrfNum(r.R_NO ?? r.r_no),
    ITEM_CODE: purTrfNum(r.ITEM_CODE ?? r.item_code),
    QNTY: purTrfNum(r.QNTY ?? r.qnty),
    WEIGHT: purTrfNum(weight ?? r.WEIGHT ?? r.weight),
    LOT: purTrfNum(r.LOT ?? r.lot),
    STATUS: purTrfStr(r.STATUS ?? r.status, 1),
    B_NO: purTrfNum(r.B_NO ?? r.b_no),
  };
}

function purchaseBillKey(r) {
  const typ = purTrfStr(r.TYPE ?? r.type ?? 'PU', 6);
  const rDate = formatDateDmyFromRaw(r.R_DATE ?? r.r_date);
  const rNo = purTrfNum(r.R_NO ?? r.r_no);
  return `${typ}|${rDate}|${rNo}`;
}

function buildPurchaseLotstockInsert(comp_code, comp_year, r, prefs) {
  const mwgt = purchaseTransferWeight(r, prefs);
  return {
    COMP_CODE: purchaseTransferCompBind(comp_code),
    COMP_YEAR: comp_year,
    VR_TYPE: purTrfStr(r.TYPE ?? r.type ?? 'PU', 6),
    VR_DATE: r.R_DATE ?? r.r_date,
    VR_NO: purTrfNum(r.R_NO ?? r.r_no),
    E_TYPE: 'R',
    SUP_CODE: purTrfStr(r.S_CODE ?? r.s_code ?? r.SUP_CODE ?? r.sup_code, 6),
    ITEM_CODE: purTrfNum(r.ITEM_CODE ?? r.item_code),
    STATUS: purTrfStr(r.STATUS ?? r.status, 1),
    QNTY: purTrfNum(r.QNTY ?? r.qnty),
    WEIGHT: mwgt,
    RATE: purTrfNum(r.RATE ?? r.rate),
    AMOUNT: purTrfNum(r.AMOUNT ?? r.amount),
    LOT: purTrfNum(r.LOT ?? r.lot),
    B_NO: purTrfNum(r.B_NO ?? r.b_no),
    GOD_CODE: purTrfStr(r.GOD_CODE ?? r.god_code, 6),
    SUP_DATE: r.R_DATE ?? r.r_date,
    COST_CODE: purTrfStr(r.COST_CODE ?? r.cost_code, 6),
    REMARKS: purTrfStr(r.MLOT_NO ?? r.mlot_no, 40),
    MSUP_CODE: purTrfStr(r.SUP_CODE ?? r.sup_code, 6),
    MSUP_NAME: purTrfStr(r.SUP_NAME ?? r.sup_name ?? r.NAME ?? r.name, 50),
    TAX_FORM: purTrfStr(r.F_FORM ?? r.f_form, 10),
    G_WEIGHT: purTrfNum(r.G_WEIGHT ?? r.g_weight),
    A_WEIGHT: purTrfNum(r.WEIGHT ?? r.weight),
  };
}

async function fetchPurchaseTransferLines(comp_code, comp_uid, body) {
  const { whereSql, binds } = buildPurchaseTransferLineFilters({ ...body, comp_code });
  const sql = `
    SELECT A.*, B.NAME AS SUP_NAME
    FROM PURCHASE A
    LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(B.CODE)
    WHERE ${whereSql}
    ORDER BY A.R_DATE, A.R_NO, A.TRN_NO`;
  return runQuery(sql, binds, comp_uid);
}

async function transferOnePurchaseBill(comp_code, comp_year, comp_uid, bill, lotColsCached) {
  const baseBinds = {
    comp_code: purchaseTransferCompBind(comp_code),
    vr_type: bill.vr_type,
    vr_no: bill.r_no,
    r_date: bill.r_date,
  };
  const lotWhere = `COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:vr_type)
    AND VR_NO = :vr_no
    AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:r_date, 'DD-MM-YYYY'))`;
  const deleteSql = `DELETE FROM LOTSTOCK WHERE ${lotWhere}`;
  const inserts = bill.lotstockInserts || [];
  if (!inserts.length) {
    await runQuery(deleteSql, baseBinds, comp_uid, { autoCommit: true });
    return {
      r_no: bill.r_no,
      r_date: bill.r_date,
      vr_type: bill.vr_type,
      lines: bill.lineCount,
      lotstock: 0,
    };
  }
  const lotCols = lotColsCached || (await getLotstockColumns(comp_uid));
  const colSet = new Set();
  for (const rec of inserts) {
    for (const k of Object.keys(rec)) {
      const c = String(k).toUpperCase();
      if (lotCols.has(c)) colSet.add(c);
    }
  }
  const cols = [...colSet];
  const insertSql = `INSERT INTO LOTSTOCK (${cols.join(', ')}) VALUES (${cols.map((_, i) => `:b${i}`).join(', ')})`;
  const insertBinds = inserts.map((rec) => {
    const b = {};
    cols.forEach((c, i) => {
      const raw = rec[c] ?? rec[c.toLowerCase()];
      b[`b${i}`] = raw === undefined ? null : raw;
    });
    return b;
  });
  const compUid = String(comp_uid ?? '').trim();
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: compUid,
      password: compUid,
      connectString: activeDbConfig.connectString,
    });
    await conn.execute(deleteSql, baseBinds, { autoCommit: false });
    await conn.executeMany(insertSql, insertBinds, { autoCommit: false, batchSize: 200 });
    await conn.commit();
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
  return {
    r_no: bill.r_no,
    r_date: bill.r_date,
    vr_type: bill.vr_type,
    lines: bill.lineCount,
    lotstock: inserts.length,
  };
}

async function buildPurchaseTransferPlan(comp_code, comp_year, comp_uid, body) {
  const prefs = await fetchStockTransferPrefs(comp_code, comp_uid);
  const purLines = await fetchPurchaseTransferLines(comp_code, comp_uid, body);
  const rows = [];
  const bills = [];
  const billMap = new Map();
  for (const r of purLines || []) {
    const key = purchaseBillKey(r);
    const mwgt = purchaseTransferWeight(r, prefs);
    rows.push(purchaseTransferGridRow(r, mwgt));
    let bill = billMap.get(key);
    if (!bill) {
      bill = {
        key,
        vr_type: purTrfStr(r.TYPE ?? r.type ?? 'PU', 6),
        r_no: purTrfNum(r.R_NO ?? r.r_no),
        r_date: formatDateDmyFromRaw(r.R_DATE ?? r.r_date),
        lineCount: 0,
        lotstockInserts: [],
      };
      billMap.set(key, bill);
      bills.push(bill);
    }
    bill.lineCount += 1;
    bill.lotstockInserts.push(buildPurchaseLotstockInsert(comp_code, comp_year, r, prefs));
  }
  return { rows, bills, total: bills.length, lineCount: rows.length };
}

function prunePurchaseTransferJobs() {
  const now = Date.now();
  for (const [id, job] of purchaseTransferJobs) {
    if (now - job.created > PURCHASE_TRANSFER_JOB_TTL_MS) purchaseTransferJobs.delete(id);
  }
}

function createPurchaseTransferJob(comp_code, comp_uid, comp_year, user_name, plan) {
  prunePurchaseTransferJobs();
  const jobId = `purtrf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  purchaseTransferJobs.set(jobId, {
    comp_code,
    comp_uid,
    comp_year,
    user_name,
    rows: plan.rows,
    bills: plan.bills,
    total: plan.total,
    lineCount: plan.lineCount,
    billOffset: 0,
    created: Date.now(),
  });
  return jobId;
}

async function executePurchaseTransferJobChunk(jobId, comp_code, comp_uid, batchSize = PURCHASE_TRANSFER_BATCH_BILLS) {
  const job = purchaseTransferJobs.get(jobId);
  if (!job) {
    const err = new Error('Transfer session expired. Click Proceed again.');
    err.status = 410;
    throw err;
  }
  if (String(job.comp_code) !== String(comp_code) || String(job.comp_uid) !== String(comp_uid)) {
    const err = new Error('Transfer session does not match company.');
    err.status = 403;
    throw err;
  }
  const prefs = job.prefs || (await fetchStockTransferPrefs(job.comp_code, job.comp_uid));
  job.prefs = prefs;
  if (!job.lotCols) job.lotCols = await getLotstockColumns(comp_uid);
  const size = Math.max(1, Math.min(5, Number(batchSize) || PURCHASE_TRANSFER_BATCH_BILLS));
  const start = job.billOffset;
  const end = Math.min(start + size, job.bills.length);
  const transferred = [];
  for (let i = start; i < end; i += 1) {
    transferred.push(
      await transferOnePurchaseBill(job.comp_code, job.comp_year, job.comp_uid, job.bills[i], job.lotCols)
    );
  }
  job.billOffset = end;
  const done = job.billOffset >= job.bills.length;
  if (done) purchaseTransferJobs.delete(jobId);
  const completedLines = job.bills.slice(0, job.billOffset).reduce((n, b) => n + (b.lineCount || 0), 0);
  return {
    completed: job.billOffset,
    total: job.total,
    completedLines,
    lineCount: job.lineCount,
    transferred,
    done,
    message: done ? 'Done' : 'Transferring',
  };
}

async function validatePurchaseTransferRequest(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
  const user_name = String(body.user_name ?? '').trim();
  if (!comp_code || comp_uid == null || !user_name) {
    const err = new Error('comp_code, comp_uid, comp_year, and user_name are required');
    err.status = 400;
    throw err;
  }
  buildPurchaseTransferLineFilters({ ...body, comp_code });
  const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
  const perms = masterPartyPermissionsFromF4(f4);
  if (!perms.canOpen) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (!perms.canAdd) {
    const err = new Error('You Can Not Add');
    err.status = 403;
    throw err;
  }
  return { comp_code, comp_uid, comp_year, user_name, perms };
}

async function validatePurchaseTransferExecute(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  if (!comp_code || comp_uid == null) {
    const err = new Error('comp_code and comp_uid are required');
    err.status = 400;
    throw err;
  }
  return { comp_code, comp_uid };
}

app.get('/api/purchase-transfer-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ purchase-transfer-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-transfer-preview', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, comp_year, user_name } = await validatePurchaseTransferRequest(body);
    const plan = await buildPurchaseTransferPlan(comp_code, comp_year, comp_uid, body);
    const jobId = createPurchaseTransferJob(comp_code, comp_uid, comp_year, user_name, plan);
    res.json({
      ok: true,
      jobId,
      rows: plan.rows,
      total: plan.total,
      lineCount: plan.lineCount,
      message: plan.total
        ? `${plan.total} bill(s) / ${plan.lineCount} line(s) ready to transfer.`
        : 'No purchase bills found for the selected criteria.',
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ purchase-transfer-preview error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/purchase-transfer-execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid } = await validatePurchaseTransferExecute(body);
    const jobId = String(body.jobId ?? body.job_id ?? '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const batchSize =
      Number(body.batchSize ?? body.batch_size ?? PURCHASE_TRANSFER_BATCH_BILLS) || PURCHASE_TRANSFER_BATCH_BILLS;
    const out = await executePurchaseTransferJobChunk(jobId, comp_code, comp_uid, batchSize);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ purchase-transfer-execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Update SaleInvNo (VFP DO FORM update_sale_inv_no) — desktop only ---
const UPDATE_SALE_INV_JOB_TTL_MS = 30 * 60 * 1000;
const UPDATE_SALE_INV_BATCH = 25;
const updateSaleInvJobs = new Map();

function usiStr(v, maxLen = 0) {
  return saleTrfStr(v, maxLen);
}

function usiNum(v) {
  return saleTrfNum(v);
}

function usiCompBind(comp_code) {
  return saleTransferCompBind(comp_code);
}

function defvaluePick(row, keys, fallback = '') {
  for (const key of keys) {
    const raw = row?.[key] ?? row?.[key.toLowerCase()];
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  }
  return fallback;
}

async function fetchUpdateSaleInvNoPrefs(comp_code, comp_uid, comp_year) {
  const rows = await runQuery(
    `SELECT * FROM DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
    { comp_code: usiCompBind(comp_code) },
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const r = rows?.[0] || {};
  const zeroRaw = defvaluePick(r, ['ZERO_BEFORE_PRINTING', 'ZERO_BEFORE_BILL_NO', 'zero_before_printing', 'zero_before_bill_no'], 'Y');
  const btypeRaw = defvaluePick(r, ['BTYPE_YN', 'BTYPEYN', 'btype_yn'], 'Y');
  const saleBillInit = defvaluePick(r, ['SALE_BILL_INIT', 'G_SALE_BILL_INIT', 'sale_bill_init'], '');
  const gFinYear = defvaluePick(r, ['G_FIN_YEAR', 'FIN_YEAR_LABEL', 'fin_year_label'], '');
  const yearSuffix = gFinYear || String(comp_year || '').replace(/\D/g, '').slice(-2);
  return {
    zeroBeforePrinting: zeroRaw.toUpperCase() !== 'N',
    btypeYn: btypeRaw.toUpperCase() !== 'N',
    saleBillInit: saleBillInit.toUpperCase(),
    gFinYear: yearSuffix,
  };
}

function buildUpdateSaleInvNo(bill, prefs) {
  const billNo = usiNum(bill.bill_no ?? bill.BILL_NO);
  let part = prefs.zeroBeforePrinting ? String(billNo).padStart(6, '0') : String(billNo);
  if (prefs.btypeYn) part += usiStr(bill.b_type ?? bill.B_TYPE, 6);
  const billInit = usiStr(bill.bill_init ?? bill.BILL_INIT, 6);
  let inv = billInit || prefs.saleBillInit || '';
  inv += part;
  const finYear = usiStr(bill.fin_year ?? bill.FIN_YEAR, 1).toUpperCase();
  if (finYear === 'Y' && prefs.gFinYear) inv += `/${prefs.gFinYear}`;
  return inv.trim();
}

function buildUpdateSaleInvFilters(body) {
  const binds = {};
  const s_date = String(body.s_date ?? body.sdt ?? '').trim();
  const e_date = String(body.e_date ?? body.edt ?? '').trim();
  if (!s_date || !e_date) {
    const err = new Error('s_date and e_date are required (DD-MM-YYYY)');
    err.status = 400;
    throw err;
  }
  binds.comp_code = usiCompBind(body.comp_code);
  binds.s_date = s_date;
  binds.e_date = e_date;
  const whereSql = `
      A.COMP_CODE = :comp_code
      AND A.BILL_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1`;
  return { whereSql, binds };
}

function updateSaleInvBillKey(r) {
  const typ = usiStr(r.TYPE ?? r.type, 6);
  const billDate = formatDateDmyFromRaw(r.BILL_DATE ?? r.bill_date);
  const billNo = usiNum(r.BILL_NO ?? r.bill_no);
  const bType = usiStr(r.B_TYPE ?? r.b_type, 6);
  const billInit = usiStr(r.BILL_INIT ?? r.bill_init, 6);
  const finYear = usiStr(r.FIN_YEAR ?? r.fin_year, 1);
  return `${typ}|${billDate}|${billNo}|${bType}|${billInit}|${finYear}`;
}

function updateSaleInvGridRow(bill) {
  return {
    BILL_DATE: bill.bill_date,
    BILL_NO: bill.bill_no,
    B_TYPE: bill.b_type,
    OLD_INV_NO: bill.old_inv_no,
    NEW_INV_NO: bill.sale_inv_no,
  };
}

async function fetchUpdateSaleInvBills(comp_code, comp_uid, body) {
  const { whereSql, binds } = buildUpdateSaleInvFilters({ ...body, comp_code });
  const sql = `
    SELECT
      A.TYPE,
      A.BILL_DATE,
      A.BILL_NO,
      A.B_TYPE,
      A.SALE_INV_NO,
      NVL(TRIM(B.BILL_INIT), '') AS BILL_INIT,
      NVL(TRIM(B.FIN_YEAR), '') AS FIN_YEAR
    FROM SALE A
    LEFT JOIN LOC_B_TYPE B
      ON A.COMP_CODE = B.COMP_CODE
     AND TRIM(A.B_TYPE) = TRIM(B.B_TYPE)
    WHERE ${whereSql}
    ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE`;
  return runQuery(sql, binds, comp_uid);
}

async function buildUpdateSaleInvPlan(comp_code, comp_uid, comp_year, body) {
  const prefs = await fetchUpdateSaleInvNoPrefs(comp_code, comp_uid, comp_year);
  const rawRows = await fetchUpdateSaleInvBills(comp_code, comp_uid, body);
  const billMap = new Map();
  const bills = [];
  const rows = [];
  for (const r of rawRows || []) {
    const key = updateSaleInvBillKey(r);
    let bill = billMap.get(key);
    if (!bill) {
      bill = {
        key,
        type: usiStr(r.TYPE ?? r.type, 6),
        bill_date: formatDateDmyFromRaw(r.BILL_DATE ?? r.bill_date),
        bill_no: usiNum(r.BILL_NO ?? r.bill_no),
        b_type: usiStr(r.B_TYPE ?? r.b_type, 6),
        bill_init: usiStr(r.BILL_INIT ?? r.bill_init, 6),
        fin_year: usiStr(r.FIN_YEAR ?? r.fin_year, 1),
        old_inv_no: usiStr(r.SALE_INV_NO ?? r.sale_inv_no, 40),
        sale_inv_no: '',
      };
      bill.sale_inv_no = buildUpdateSaleInvNo(bill, prefs);
      billMap.set(key, bill);
      bills.push(bill);
      rows.push(updateSaleInvGridRow(bill));
    }
  }
  return { rows, bills, total: bills.length, prefs };
}

async function applyOneUpdateSaleInvNo(comp_code, comp_uid, bill) {
  const baseBinds = {
    comp_code: usiCompBind(comp_code),
    sale_inv_no: bill.sale_inv_no,
    m_type: bill.type,
    bill_date: bill.bill_date,
    bill_no: bill.bill_no,
    b_type: bill.b_type,
  };
  const saleSql = `
    UPDATE SALE SET SALE_INV_NO = :sale_inv_no
    WHERE COMP_CODE = :comp_code
      AND TRIM(TYPE) = TRIM(:m_type)
      AND TRUNC(BILL_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))
      AND BILL_NO = :bill_no
      AND TRIM(B_TYPE) = TRIM(:b_type)`;
  const ledgerSql = `
    UPDATE LEDGER SET SALE_INV_NO = :sale_inv_no
    WHERE COMP_CODE = :comp_code
      AND TRIM(VR_TYPE) = TRIM(:m_type)
      AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))
      AND VR_NO = :bill_no
      AND TRIM(TYPE) = TRIM(:b_type)`;
  const compUid = String(comp_uid ?? '').trim();
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: compUid,
      password: compUid,
      connectString: activeDbConfig.connectString,
    });
    await conn.execute(saleSql, baseBinds, { autoCommit: false });
    await conn.execute(ledgerSql, baseBinds, { autoCommit: false });
    await conn.commit();
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
  return {
    bill_no: bill.bill_no,
    bill_date: bill.bill_date,
    b_type: bill.b_type,
    sale_inv_no: bill.sale_inv_no,
  };
}

function pruneUpdateSaleInvJobs() {
  const now = Date.now();
  for (const [id, job] of updateSaleInvJobs) {
    if (now - job.created > UPDATE_SALE_INV_JOB_TTL_MS) updateSaleInvJobs.delete(id);
  }
}

function createUpdateSaleInvJob(comp_code, comp_uid, comp_year, user_name, plan) {
  pruneUpdateSaleInvJobs();
  const jobId = `usinv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  updateSaleInvJobs.set(jobId, {
    comp_code,
    comp_uid,
    comp_year,
    user_name,
    rows: plan.rows,
    bills: plan.bills,
    total: plan.total,
    billOffset: 0,
    created: Date.now(),
  });
  return jobId;
}

async function executeUpdateSaleInvJobChunk(jobId, comp_code, comp_uid, batchSize = UPDATE_SALE_INV_BATCH) {
  const job = updateSaleInvJobs.get(jobId);
  if (!job) {
    const err = new Error('Update session expired. Click Proceed again.');
    err.status = 410;
    throw err;
  }
  if (String(job.comp_code) !== String(comp_code) || String(job.comp_uid) !== String(comp_uid)) {
    const err = new Error('Update session does not match company.');
    err.status = 403;
    throw err;
  }
  const size = Math.max(1, Math.min(100, Number(batchSize) || UPDATE_SALE_INV_BATCH));
  const start = job.billOffset;
  const end = Math.min(start + size, job.bills.length);
  const updated = [];
  for (let i = start; i < end; i += 1) {
    updated.push(await applyOneUpdateSaleInvNo(job.comp_code, job.comp_uid, job.bills[i]));
  }
  job.billOffset = end;
  const done = job.billOffset >= job.bills.length;
  if (done) updateSaleInvJobs.delete(jobId);
  return {
    completed: job.billOffset,
    total: job.total,
    updated,
    done,
    message: done ? 'Done' : 'Updating',
  };
}

async function validateUpdateSaleInvRequest(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
  const user_name = String(body.user_name ?? '').trim();
  if (!comp_code || comp_uid == null || !user_name) {
    const err = new Error('comp_code, comp_uid, comp_year, and user_name are required');
    err.status = 400;
    throw err;
  }
  buildUpdateSaleInvFilters({ ...body, comp_code });
  const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
  const perms = masterPartyPermissionsFromF4(f4);
  if (!perms.canOpen) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (!perms.canAdd) {
    const err = new Error('You Can Not Add');
    err.status = 403;
    throw err;
  }
  return { comp_code, comp_uid, comp_year, user_name, perms };
}

async function validateUpdateSaleInvExecute(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  if (!comp_code || comp_uid == null) {
    const err = new Error('comp_code and comp_uid are required');
    err.status = 400;
    throw err;
  }
  return { comp_code, comp_uid };
}

app.get('/api/update-sale-inv-no-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ update-sale-inv-no-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update-sale-inv-no-preview', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, comp_year, user_name } = await validateUpdateSaleInvRequest(body);
    const plan = await buildUpdateSaleInvPlan(comp_code, comp_uid, comp_year, body);
    const jobId = createUpdateSaleInvJob(comp_code, comp_uid, comp_year, user_name, plan);
    res.json({
      ok: true,
      jobId,
      rows: plan.rows,
      total: plan.total,
      message: plan.total
        ? `${plan.total} bill(s) ready to update.`
        : 'No sale bills found for the selected criteria.',
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ update-sale-inv-no-preview error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/update-sale-inv-no-execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid } = await validateUpdateSaleInvExecute(body);
    const jobId = String(body.jobId ?? body.job_id ?? '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const batchSize = Number(body.batchSize ?? body.batch_size ?? UPDATE_SALE_INV_BATCH) || UPDATE_SALE_INV_BATCH;
    const out = await executeUpdateSaleInvJobChunk(jobId, comp_code, comp_uid, batchSize);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ update-sale-inv-no-execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Update Pan With GstIn (VFP DO pan_with_gstin) — desktop only ---
const UPDATE_PAN_GSTIN_JOB_TTL_MS = 30 * 60 * 1000;
const UPDATE_PAN_GSTIN_BATCH = 50;
const updatePanGstinJobs = new Map();

function upgCompBind(comp_code) {
  return saleTransferCompBind(comp_code);
}

function mapUpdatePanGstinPreviewRow(r) {
  const code = String(r.CODE ?? r.code ?? '').trim();
  const gstNo = String(r.GST_NO ?? r.gst_no ?? '').trim();
  const newPan = String(r.NEW_PAN ?? r.new_pan ?? '').trim();
  return {
    CODE: code,
    code,
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    name: String(r.NAME ?? r.name ?? '').trim(),
    GST_NO: gstNo,
    gst_no: gstNo,
    NEW_PAN: newPan,
    new_pan: newPan,
  };
}

async function buildUpdatePanGstinPlan(comp_code, comp_uid) {
  const rows = await runQuery(
    `SELECT TRIM(CODE) AS CODE,
            TRIM(NAME) AS NAME,
            TRIM(GST_NO) AS GST_NO,
            SUBSTR(TRIM(GST_NO), 3, 10) AS NEW_PAN
       FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND PAN IS NULL
        AND GST_NO IS NOT NULL
      ORDER BY TRIM(NAME), TRIM(CODE)`,
    { comp_code: upgCompBind(comp_code) },
    comp_uid
  );
  const mapped = (rows || []).map(mapUpdatePanGstinPreviewRow).filter((r) => r.code && r.gst_no && r.new_pan);
  return { rows: mapped, total: mapped.length, codes: mapped.map((r) => r.code) };
}

async function applyOneUpdatePanGstin(comp_code, comp_uid, code) {
  await runQuery(
    `UPDATE MASTER
        SET PAN = SUBSTR(TRIM(GST_NO), 3, 10)
      WHERE COMP_CODE = :comp_code
        AND TRIM(CODE) = TRIM(:code)
        AND PAN IS NULL
        AND GST_NO IS NOT NULL`,
    { comp_code: upgCompBind(comp_code), code: String(code ?? '').trim() },
    comp_uid,
    { autoCommit: true }
  );
  return { code: String(code ?? '').trim() };
}

function pruneUpdatePanGstinJobs() {
  const now = Date.now();
  for (const [id, job] of updatePanGstinJobs) {
    if (now - job.created > UPDATE_PAN_GSTIN_JOB_TTL_MS) updatePanGstinJobs.delete(id);
  }
}

function createUpdatePanGstinJob(comp_code, comp_uid, user_name, plan) {
  pruneUpdatePanGstinJobs();
  const jobId = `upg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  updatePanGstinJobs.set(jobId, {
    comp_code,
    comp_uid,
    user_name,
    rows: plan.rows,
    codes: plan.codes,
    total: plan.total,
    codeOffset: 0,
    created: Date.now(),
  });
  return jobId;
}

async function executeUpdatePanGstinJobChunk(jobId, comp_code, comp_uid, batchSize = UPDATE_PAN_GSTIN_BATCH) {
  const job = updatePanGstinJobs.get(jobId);
  if (!job) {
    const err = new Error('Update session expired. Click Proceed again.');
    err.status = 410;
    throw err;
  }
  if (String(job.comp_code) !== String(comp_code) || String(job.comp_uid) !== String(comp_uid)) {
    const err = new Error('Update session does not match company.');
    err.status = 403;
    throw err;
  }
  const size = Math.max(1, Math.min(200, Number(batchSize) || UPDATE_PAN_GSTIN_BATCH));
  const start = job.codeOffset;
  const end = Math.min(start + size, job.codes.length);
  const updated = [];
  for (let i = start; i < end; i += 1) {
    updated.push(await applyOneUpdatePanGstin(job.comp_code, job.comp_uid, job.codes[i]));
  }
  job.codeOffset = end;
  const done = job.codeOffset >= job.codes.length;
  if (done) updatePanGstinJobs.delete(jobId);
  return {
    completed: job.codeOffset,
    total: job.total,
    updated,
    done,
    message: done ? 'Done' : 'Updating',
  };
}

async function validateUpdatePanGstinRequest(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  const user_name = String(body.user_name ?? '').trim();
  if (!comp_code || comp_uid == null || !user_name) {
    const err = new Error('comp_code, comp_uid, and user_name are required');
    err.status = 400;
    throw err;
  }
  const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
  const perms = masterPartyPermissionsFromF4(f4);
  if (!perms.canOpen) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (!perms.canAdd) {
    const err = new Error('You Can Not Add');
    err.status = 403;
    throw err;
  }
  return { comp_code, comp_uid, user_name, perms };
}

async function validateUpdatePanGstinExecute(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const comp_uid = body.comp_uid;
  if (!comp_code || comp_uid == null) {
    const err = new Error('comp_code and comp_uid are required');
    err.status = 400;
    throw err;
  }
  return { comp_code, comp_uid };
}

app.get('/api/update-pan-with-gstin-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    res.json({ f4, source, permissions: perms, ...perms });
  } catch (err) {
    console.error('❌ update-pan-with-gstin-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update-pan-with-gstin-preview', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid, user_name } = await validateUpdatePanGstinRequest(body);
    const plan = await buildUpdatePanGstinPlan(comp_code, comp_uid);
    const jobId = createUpdatePanGstinJob(comp_code, comp_uid, user_name, plan);
    res.json({
      ok: true,
      jobId,
      rows: plan.rows,
      total: plan.total,
      message: plan.total
        ? `${plan.total} account(s) ready to update.`
        : 'No accounts found with GSTIN and blank PAN.',
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ update-pan-with-gstin-preview error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/update-pan-with-gstin-execute', async (req, res) => {
  try {
    const body = req.body || {};
    const { comp_code, comp_uid } = await validateUpdatePanGstinExecute(body);
    const jobId = String(body.jobId ?? body.job_id ?? '').trim();
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });
    const batchSize = Number(body.batchSize ?? body.batch_size ?? UPDATE_PAN_GSTIN_BATCH) || UPDATE_PAN_GSTIN_BATCH;
    const out = await executeUpdatePanGstinJobChunk(jobId, comp_code, comp_uid, batchSize);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ update-pan-with-gstin-execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- User Report (VFP DO FORM userrpt) — add / edit / delete activity ---
const USER_REPORT_OP_COLS = ['HI_TYPE', 'OPERATION', 'OPR_TYPE', 'RECORD_TYPE', 'ACT_TYPE', 'TYPE_FLAG'];
const USER_REPORT_DATE_COLS = ['ENT_DATE', 'ENTRY_DATE', 'VR_DATE', 'BILL_DATE'];

const USER_REPORT_ADD_SPECS = [
  {
    table: 'MASTER',
    module: 'A/c Master',
    refExpr: `TRIM(CODE)`,
    detailExpr: `TRIM(NVL(NAME, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'LEDGER',
    module: 'Ledger',
    refExpr: `TRIM(VR_TYPE)||' '||TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)||' '||TRIM(TYPE)||' '||TRIM(CODE)`,
    detailExpr: `TRIM(NVL(NARRATION, CODE))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'SALE',
    module: 'Sale Bill',
    refExpr: `TO_CHAR(BILL_DATE,'DD-MM-YYYY')||' / '||TO_CHAR(BILL_NO)||' '||TRIM(B_TYPE)`,
    detailExpr: `TRIM(NVL(CODE, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'PURCHASE',
    module: 'Purchase',
    refExpr: `TO_CHAR(BILL_DATE,'DD-MM-YYYY')||' / '||TO_CHAR(BILL_NO)||' '||TRIM(B_TYPE)`,
    detailExpr: `TRIM(NVL(CODE, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'VOUCHER',
    module: 'Voucher',
    refExpr: `TRIM(VR_TYPE)||' '||TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)`,
    detailExpr: `TRIM(NVL(REMARK, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'ITEMMAST',
    module: 'Item Master',
    refExpr: `TRIM(ITEM_CODE)`,
    detailExpr: `TRIM(NVL(ITEM_NAME, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'CATMAST',
    module: 'Category',
    refExpr: `TRIM(CAT_CODE)`,
    detailExpr: `TRIM(NVL(CAT_NAME, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'ITEM_GRP',
    module: 'Item Group',
    refExpr: `TRIM(GRP_CODE)`,
    detailExpr: `TRIM(NVL(GRP_NAME, ''))`,
    dateCol: 'ENT_DATE',
  },
  {
    table: 'LOTSTOCK',
    module: 'Lot Stock',
    refExpr: `TRIM(VR_TYPE)||' '||TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)||' '||TRIM(ITEM_CODE)`,
    detailExpr: `TRIM(NVL(LOT, ''))`,
    dateCol: 'ENT_DATE',
  },
];

const USER_REPORT_HIST_SPECS = [
  { table: 'HI_MASTER', module: 'A/c Master', refExpr: `TRIM(CODE)`, detailExpr: `TRIM(NVL(NAME, ''))` },
  { table: 'HI_SALE', module: 'Sale Bill', refExpr: `TO_CHAR(BILL_DATE,'DD-MM-YYYY')||' / '||TO_CHAR(BILL_NO)||' '||TRIM(B_TYPE)`, detailExpr: `TRIM(NVL(CODE, ''))` },
  { table: 'HI_PUR', module: 'Purchase', refExpr: `TO_CHAR(BILL_DATE,'DD-MM-YYYY')||' / '||TO_CHAR(BILL_NO)||' '||TRIM(B_TYPE)`, detailExpr: `TRIM(NVL(CODE, ''))` },
  { table: 'HI_VOU', module: 'Voucher', refExpr: `TRIM(VR_TYPE)||' '||TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)`, detailExpr: `TRIM(NVL(REMARK, ''))` },
  { table: 'HI_PRODUCT', module: 'Product', refExpr: `TRIM(NVL(ITEM_CODE, PRODUCT_CODE))`, detailExpr: `TRIM(NVL(ITEM_NAME, PRODUCT_NAME))` },
  { table: 'HI_JOBWORK', module: 'Job Work', refExpr: `TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)`, detailExpr: `TRIM(NVL(CODE, ''))` },
  { table: 'HI_INDENT', module: 'Indent', refExpr: `TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)`, detailExpr: `TRIM(NVL(CODE, ''))` },
  { table: 'HI_BROKLEG', module: 'Broker Ledger', refExpr: `TRIM(CODE)`, detailExpr: `TRIM(NVL(NAME, ''))` },
  { table: 'AUDIT_LEDGER', module: 'Ledger Audit', refExpr: `TRIM(VR_TYPE)||' '||TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)||' '||TRIM(TYPE)`, detailExpr: `TRIM(CODE)` },
  { table: 'AUDIT_LOTSTOCK', module: 'Lot Audit', refExpr: `TRIM(VR_TYPE)||' '||TO_CHAR(VR_DATE,'DD-MM-YYYY')||' '||TO_CHAR(VR_NO)`, detailExpr: `TRIM(ITEM_CODE)` },
];

function normalizeUserReportMode(mode) {
  const m = String(mode ?? '').trim().toLowerCase();
  if (m === 'edit' || m === '1' || m === 'e') return 'edit';
  if (m === 'delete' || m === '3' || m === 'd') return 'delete';
  return 'add';
}

function userReportOpFlag(mode) {
  if (mode === 'edit') return 'E';
  if (mode === 'delete') return 'D';
  return 'A';
}

function pickUserReportDateCol(cols, preferred) {
  if (preferred && cols.has(preferred)) return preferred;
  for (const c of USER_REPORT_DATE_COLS) {
    if (cols.has(c)) return c;
  }
  return null;
}

function pickUserReportOpCol(cols) {
  for (const c of USER_REPORT_OP_COLS) {
    if (cols.has(c)) return c;
  }
  return null;
}

function mapUserReportRow(r, module) {
  const entDate = r.ENT_DATE ?? r.ent_date ?? r.ENTRY_DATE ?? r.entry_date ?? '';
  const entTime = r.ENT_TIME ?? r.ent_time ?? '';
  return {
    MODULE: module,
    ENT_DATE: entDate instanceof Date ? entDate.toISOString().slice(0, 10) : String(entDate ?? '').trim(),
    ENT_TIME: String(entTime ?? '').trim(),
    REF: String(r.REF ?? r.ref ?? '').trim(),
    DETAIL: String(r.DETAIL ?? r.detail ?? '').trim(),
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    COMPUTER_NAME: String(r.COMPUTER_NAME ?? r.computer_name ?? '').trim(),
  };
}

async function userReportTableExists(comp_uid, tableName) {
  const rows = await runQuery(
    `SELECT COUNT(*) AS CNT FROM USER_TABLES WHERE TABLE_NAME = :tbl`,
    { tbl: String(tableName || '').toUpperCase() },
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => [{ CNT: 0 }]);
  return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) > 0;
}

async function queryUserReportAddTable(comp_code, comp_uid, spec, userName, s_date, e_date) {
  const exists = await userReportTableExists(comp_uid, spec.table);
  if (!exists) return [];
  const cols = await getTableColumns(comp_uid, spec.table);
  if (!cols.has('COMP_CODE') || !cols.has('USER_NAME')) return [];
  const dateCol = pickUserReportDateCol(cols, spec.dateCol);
  if (!dateCol) return [];
  const hasEntTime = cols.has('ENT_TIME');
  const hasComputer = cols.has('COMPUTER_NAME');
  const sql = `
    SELECT '${spec.module.replace(/'/g, "''")}' AS MODULE,
           TO_CHAR(${dateCol}, 'DD-MM-YYYY') AS ENT_DATE,
           ${hasEntTime ? `TRIM(NVL(TO_CHAR(ENT_TIME), ''))` : `''`} AS ENT_TIME,
           ${spec.refExpr} AS REF,
           ${spec.detailExpr} AS DETAIL,
           TRIM(USER_NAME) AS USER_NAME,
           ${hasComputer ? `TRIM(NVL(COMPUTER_NAME, ''))` : `''`} AS COMPUTER_NAME
      FROM ${spec.table}
     WHERE COMP_CODE = :comp_code
       AND UPPER(TRIM(USER_NAME)) = :user_name
       AND TRUNC(${dateCol}) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
     ORDER BY ${dateCol}, REF`;
  const rows = await runQuery(
    sql,
    { comp_code, user_name: userName, s_date, e_date },
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  return (rows || []).map((r) => mapUserReportRow(r, spec.module));
}

async function queryUserReportHistTable(comp_code, comp_uid, spec, userName, s_date, e_date, opFlag) {
  const exists = await userReportTableExists(comp_uid, spec.table);
  if (!exists) return [];
  const cols = await getTableColumns(comp_uid, spec.table);
  if (!cols.has('COMP_CODE') || !cols.has('USER_NAME')) return [];
  const dateCol = pickUserReportDateCol(cols, 'ENT_DATE');
  if (!dateCol) return [];
  const opCol = pickUserReportOpCol(cols);
  const hasEntTime = cols.has('ENT_TIME');
  const hasComputer = cols.has('COMPUTER_NAME');
  let opFilter = '';
  const binds = { comp_code, user_name: userName, s_date, e_date };
  if (opCol) {
    opFilter = ` AND UPPER(TRIM(${opCol})) = :op_flag`;
    binds.op_flag = opFlag;
  }
  const sql = `
    SELECT '${spec.module.replace(/'/g, "''")}' AS MODULE,
           TO_CHAR(${dateCol}, 'DD-MM-YYYY') AS ENT_DATE,
           ${hasEntTime ? `TRIM(NVL(TO_CHAR(ENT_TIME), ''))` : `''`} AS ENT_TIME,
           ${spec.refExpr} AS REF,
           ${spec.detailExpr} AS DETAIL,
           TRIM(USER_NAME) AS USER_NAME,
           ${hasComputer ? `TRIM(NVL(COMPUTER_NAME, ''))` : `''`} AS COMPUTER_NAME
      FROM ${spec.table}
     WHERE COMP_CODE = :comp_code
       AND UPPER(TRIM(USER_NAME)) = :user_name
       AND TRUNC(${dateCol}) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
       ${opFilter}
     ORDER BY ${dateCol}, REF`;
  const rows = await runQuery(
    sql,
    binds,
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  return (rows || []).map((r) => mapUserReportRow(r, spec.module));
}

async function buildUserReportData(comp_code, comp_uid, userName, s_date, e_date, mode) {
  const normalizedMode = normalizeUserReportMode(mode);
  const opFlag = userReportOpFlag(normalizedMode);
  const chunks = [];
  if (normalizedMode === 'add') {
    for (const spec of USER_REPORT_ADD_SPECS) {
      chunks.push(await queryUserReportAddTable(comp_code, comp_uid, spec, userName, s_date, e_date));
    }
  } else {
    for (const spec of USER_REPORT_HIST_SPECS) {
      chunks.push(await queryUserReportHistTable(comp_code, comp_uid, spec, userName, s_date, e_date, opFlag));
    }
  }
  const rows = chunks.flat();
  rows.sort((a, b) => {
    const da = String(a.ENT_DATE || '');
    const db = String(b.ENT_DATE || '');
    if (da !== db) return da.localeCompare(db);
    return String(a.MODULE || '').localeCompare(String(b.MODULE || ''));
  });
  const label = normalizedMode === 'add' ? 'Add' : normalizedMode === 'edit' ? 'Edit' : 'Delete';
  return {
    rows,
    total: rows.length,
    mode: normalizedMode,
    message: rows.length
      ? `${rows.length} ${label} record(s) for ${userName}.`
      : `No ${label.toLowerCase()} records found for ${userName} in the selected period.`,
  };
}

async function fetchUserReportUsers(q) {
  await detectPreferredUsersHubTable();
  const qTrim = String(q ?? '').trim().toUpperCase();
  const binds = {};
  let where = '1=1';
  if (qTrim) {
    binds.qlike = `%${qTrim}%`;
    where = `(UPPER(TRIM(USER_NAME)) LIKE :qlike OR TRIM(TO_CHAR(USER_NO)) LIKE :qlike)`;
  }
  const { rows } = await runUsersHubQuery(
    `SELECT USER_NO, USER_NAME, SUPERVISOR FROM {TABLE} WHERE ${where} ORDER BY USER_NAME`,
    binds
  );
  return (rows || []).map((r) => ({
    USER_NO: r.USER_NO ?? r.user_no,
    user_no: r.USER_NO ?? r.user_no,
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    user_name: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    SUPERVISOR: String(r.SUPERVISOR ?? r.supervisor ?? '').trim(),
  }));
}

app.get('/api/user-report-users', async (req, res) => {
  try {
    const rows = await fetchUserReportUsers(req.query.q);
    res.json(rows);
  } catch (err) {
    console.error('❌ user-report-users error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user-report-user-lookup', async (req, res) => {
  try {
    const user_name = String(req.query.user_name ?? '').trim();
    if (!user_name) return res.status(400).json({ error: 'user_name is required' });
    const row = await fetchUserMasterByName(user_name);
    if (!row) return res.json({ ok: false, error: 'Invalid User' });
    res.json({
      ok: true,
      USER_NO: row.USER_NO ?? row.user_no,
      user_no: row.USER_NO ?? row.user_no,
      USER_NAME: row.USER_NAME ?? row.user_name,
      user_name: row.USER_NAME ?? row.user_name,
    });
  } catch (err) {
    console.error('❌ user-report-user-lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user-report-data', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim().toUpperCase();
    const s_date = String(body.s_date ?? body.sdt ?? '').trim();
    const e_date = String(body.e_date ?? body.edt ?? '').trim();
    const mode = normalizeUserReportMode(body.mode ?? body.report_type ?? body.rtype);
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!s_date || !e_date) {
      return res.status(400).json({ error: 's_date and e_date are required (DD-MM-YYYY)' });
    }
    const hubUser = await fetchUserMasterByName(user_name);
    if (!hubUser) return res.status(400).json({ error: 'Invalid User' });
    const out = await buildUserReportData(comp_code, comp_uid, user_name, s_date, e_date, mode);
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ user-report-data error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Audit Trail Report (VFP DO FORM audit_report / audit_report1) ---
function normalizeAuditTrailEntryType(v) {
  const t = String(v ?? '').trim().toUpperCase();
  if (!t) return '';
  if (['N', 'E', 'D', 'O'].includes(t)) return t;
  return '';
}

function mapAuditTrailRow(r) {
  return {
    MOD_DEL_ENT_DATE: String(r.MOD_DEL_ENT_DATE ?? r.mod_del_ent_date ?? '').trim(),
    MOD_DEL_ENT_TIME: String(r.MOD_DEL_ENT_TIME ?? r.mod_del_ent_time ?? '').trim(),
    MOD_DEL_NO: r.MOD_DEL_NO ?? r.mod_del_no ?? '',
    MOD_DEL_TYPE: String(r.MOD_DEL_TYPE ?? r.mod_del_type ?? '').trim(),
    MOD_DEL_USER_NAME: String(r.MOD_DEL_USER_NAME ?? r.mod_del_user_name ?? '').trim(),
    MOD_DEL_COMPUTER_NAME: String(r.MOD_DEL_COMPUTER_NAME ?? r.mod_del_computer_name ?? '').trim(),
    VR_DATE: String(r.VR_DATE ?? r.vr_date ?? '').trim(),
    VR_NO: r.VR_NO ?? r.vr_no ?? '',
    VR_TYPE: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
    TYPE: String(r.TYPE ?? r.type ?? '').trim(),
    CODE: String(r.CODE ?? r.code ?? '').trim(),
    NAME: String(r.NAME ?? r.name ?? '').trim(),
    DR_AMT: r.DR_AMT ?? r.dr_amt ?? '',
    CR_AMT: r.CR_AMT ?? r.cr_amt ?? '',
    CHQ_NO: String(r.CHQ_NO ?? r.chq_no ?? '').trim(),
    DETAIL: String(r.DETAIL ?? r.detail ?? '').trim(),
    ITEM_CODE: String(r.ITEM_CODE ?? r.item_code ?? '').trim(),
    ITEM_NAME: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
    LOT: String(r.LOT ?? r.lot ?? '').trim(),
    QNTY: r.QNTY ?? r.qnty ?? '',
    WEIGHT: r.WEIGHT ?? r.weight ?? '',
    RATE: r.RATE ?? r.rate ?? '',
    B_NO: r.B_NO ?? r.b_no ?? '',
    USER_NAME: String(r.USER_NAME ?? r.user_name ?? '').trim(),
    ENT_DATE: String(r.ENT_DATE ?? r.ent_date ?? '').trim(),
    ENT_TIME: String(r.ENT_TIME ?? r.ent_time ?? '').trim(),
    COMPUTER_NAME: String(r.COMPUTER_NAME ?? r.computer_name ?? '').trim(),
    MOD_DEL_REASON: String(r.MOD_DEL_REASON ?? r.mod_del_reason ?? '').trim(),
  };
}

async function buildAuditTrailReport(comp_code, comp_uid, filters) {
  const exists = await userReportTableExists(comp_uid, 'AUDIT_LEDGER');
  if (!exists) {
    const err = new Error('AUDIT_LEDGER table not found for this company.');
    err.status = 404;
    throw err;
  }
  const auditCols = await getTableColumns(comp_uid, 'AUDIT_LEDGER');
  const masterExists = await userReportTableExists(comp_uid, 'MASTER');
  const itemExists = await userReportTableExists(comp_uid, 'ITEMMAST');
  const hasItemJoin = itemExists && auditCols.has('ITEM_CODE');

  const binds = {
    comp_code,
    s_date: filters.s_date,
    e_date: filters.e_date,
    v_s_date: filters.v_s_date,
    v_e_date: filters.v_e_date,
    svno: Math.max(0, Number(filters.svno) || 0),
    evno: Math.max(0, Number(filters.evno) || 999999),
  };

  let codeFilter = '';
  const mcode = String(filters.mcode ?? '').trim().toUpperCase();
  if (mcode) {
    binds.mcode = mcode;
    codeFilter = ` AND TRIM(A.CODE) = TRIM(:mcode)`;
  }

  let vrTypeFilter = '';
  const vrType = String(filters.vr_type ?? '').trim().toUpperCase();
  if (vrType) {
    binds.vr_type = vrType;
    vrTypeFilter = ` AND TRIM(A.VR_TYPE) = TRIM(:vr_type)`;
  }

  let userFilter = '';
  const filterUser = String(filters.user_name ?? '').trim().toUpperCase();
  if (filterUser) {
    binds.filter_user = filterUser;
    userFilter = ` AND (UPPER(TRIM(A.USER_NAME)) = :filter_user OR UPPER(TRIM(A.MOD_DEL_USER_NAME)) = :filter_user)`;
  }

  const entryType = normalizeAuditTrailEntryType(filters.entry_type);
  let entryFilter = '';
  if (entryType === 'O') {
    entryFilter = ` AND TRIM(NVL(A.MOD_DEL_TYPE, '')) = 'N' AND TRUNC(A.VR_DATE) <> TRUNC(A.MOD_DEL_ENT_DATE)`;
  } else if (entryType) {
    binds.entry_type = entryType;
    entryFilter = ` AND TRIM(NVL(A.MOD_DEL_TYPE, '')) = :entry_type`;
  }

  const nameExpr = masterExists ? `TRIM(NVL(B.NAME, ''))` : `''`;
  const itemNameExpr = hasItemJoin ? `TRIM(NVL(C.ITEM_NAME, ''))` : `''`;
  const masterJoin = masterExists
    ? `LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)`
    : '';
  const itemJoin = hasItemJoin
    ? `LEFT JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.ITEM_CODE) = TRIM(C.ITEM_CODE)`
    : '';

  const sql = `
    SELECT TO_CHAR(A.MOD_DEL_ENT_DATE, 'DD-MM-YYYY') AS MOD_DEL_ENT_DATE,
           TRIM(NVL(TO_CHAR(A.MOD_DEL_ENT_TIME), '')) AS MOD_DEL_ENT_TIME,
           NVL(A.MOD_DEL_NO, 0) AS MOD_DEL_NO,
           TRIM(NVL(A.MOD_DEL_TYPE, '')) AS MOD_DEL_TYPE,
           TRIM(NVL(A.MOD_DEL_USER_NAME, '')) AS MOD_DEL_USER_NAME,
           TRIM(NVL(A.MOD_DEL_COMPUTER_NAME, '')) AS MOD_DEL_COMPUTER_NAME,
           TO_CHAR(A.VR_DATE, 'DD-MM-YYYY') AS VR_DATE,
           NVL(A.VR_NO, 0) AS VR_NO,
           TRIM(NVL(A.VR_TYPE, '')) AS VR_TYPE,
           TRIM(NVL(A.TYPE, '')) AS TYPE,
           TRIM(NVL(A.CODE, '')) AS CODE,
           ${nameExpr} AS NAME,
           NVL(A.DR_AMT, 0) AS DR_AMT,
           NVL(A.CR_AMT, 0) AS CR_AMT,
           TRIM(NVL(A.CHQ_NO, '')) AS CHQ_NO,
           TRIM(NVL(A.DETAIL, '')) AS DETAIL,
           TRIM(NVL(A.ITEM_CODE, '')) AS ITEM_CODE,
           ${itemNameExpr} AS ITEM_NAME,
           TRIM(NVL(A.LOT, '')) AS LOT,
           NVL(A.QNTY, 0) AS QNTY,
           NVL(A.WEIGHT, 0) AS WEIGHT,
           NVL(A.RATE, 0) AS RATE,
           NVL(A.B_NO, 0) AS B_NO,
           TRIM(NVL(A.USER_NAME, '')) AS USER_NAME,
           TO_CHAR(A.ENT_DATE, 'DD-MM-YYYY') AS ENT_DATE,
           TRIM(NVL(TO_CHAR(A.ENT_TIME), '')) AS ENT_TIME,
           TRIM(NVL(A.COMPUTER_NAME, '')) AS COMPUTER_NAME,
           TRIM(NVL(A.MOD_DEL_REASON, '')) AS MOD_DEL_REASON
      FROM AUDIT_LEDGER A
      ${masterJoin}
      ${itemJoin}
     WHERE A.COMP_CODE = :comp_code
       AND TRUNC(A.MOD_DEL_ENT_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
       AND TRUNC(A.VR_DATE) BETWEEN TRUNC(TO_DATE(:v_s_date, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:v_e_date, 'DD-MM-YYYY'))
       AND NVL(A.VR_NO, 0) BETWEEN :svno AND :evno
       ${codeFilter}
       ${vrTypeFilter}
       ${userFilter}
       ${entryFilter}
     ORDER BY A.MOD_DEL_ENT_DATE, A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.MOD_DEL_NO`;

  const rows = await runQuery(sql, binds, comp_uid);
  const mapped = (rows || []).map(mapAuditTrailRow);
  return {
    rows: mapped,
    total: mapped.length,
    message: mapped.length
      ? `${mapped.length} audit trail row(s).`
      : 'No audit trail rows found for the selected criteria.',
  };
}

app.get('/api/audit-trail-account-lookup', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const code = String(req.query.code ?? '').trim().toUpperCase();
    if (!comp_code || comp_uid == null || !code) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and code are required' });
    }
    const rows = await runQuery(
      `SELECT TRIM(NAME) AS NAME FROM MASTER
        WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code AND ROWNUM = 1`,
      { comp_code, code },
      comp_uid,
      { suppressDbErrorLog: true }
    );
    if (!rows?.length) return res.json({ ok: false, error: 'Invalid A/C Code' });
    res.json({ ok: true, CODE: code, code, NAME: rows[0].NAME ?? rows[0].name, name: rows[0].NAME ?? rows[0].name });
  } catch (err) {
    console.error('❌ audit-trail-account-lookup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit-trail-report-data', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const s_date = String(body.s_date ?? body.sdt ?? '').trim();
    const e_date = String(body.e_date ?? body.edt ?? '').trim();
    const v_s_date = String(body.v_s_date ?? body.vsdt ?? s_date).trim();
    const v_e_date = String(body.v_e_date ?? body.vedt ?? e_date).trim();
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    if (!s_date || !e_date || !v_s_date || !v_e_date) {
      return res.status(400).json({ error: 's_date, e_date, v_s_date, and v_e_date are required (DD-MM-YYYY)' });
    }
    const filterUser = String(body.user_name ?? '').trim();
    if (filterUser) {
      const hubUser = await fetchUserMasterByName(filterUser);
      if (!hubUser) return res.status(400).json({ error: 'Invalid User' });
    }
    const mcode = String(body.mcode ?? body.code ?? '').trim();
    if (mcode) {
      const acc = await runQuery(
        `SELECT COUNT(*) AS CNT FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :code AND ROWNUM = 1`,
        { comp_code, code: mcode.toUpperCase() },
        comp_uid,
        { suppressDbErrorLog: true }
      );
      if (!Number(acc?.[0]?.CNT ?? 0)) {
        return res.status(400).json({ error: '!!! Invalid A/C Code !!!' });
      }
    }
    const out = await buildAuditTrailReport(comp_code, comp_uid, {
      s_date,
      e_date,
      v_s_date,
      v_e_date,
      svno: body.svno ?? body.sv_no ?? 0,
      evno: body.evno ?? body.ev_no ?? 999999,
      mcode,
      vr_type: body.vr_type ?? body.vrType ?? '',
      user_name: filterUser,
      entry_type: body.entry_type ?? body.nedo ?? body.entryType ?? '',
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ audit-trail-report-data error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Company Detail Edit (VFP DO FORM compdet) ---
const COMPDET_EDIT_PW_LIMITED = 'NEWFAS';
const COMPDET_EDIT_PW_FULL = 'VANYA99';
const COMPDET_LIMITED_LOCKED_COLS = new Set(['COMP_NAME', 'COMP_S_DT', 'COMP_E_DT']);
const COMPDET_ACCESS_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const compdetAccessTokens = new Map();

function verifyCompdetEditPassword(password) {
  const p = String(password ?? '').trim().toUpperCase();
  if (p === COMPDET_EDIT_PW_LIMITED) return 'limited';
  if (p === COMPDET_EDIT_PW_FULL) return 'full';
  return null;
}

function issueCompdetAccessToken(comp_code, comp_uid, comp_year, accessLevel) {
  const token = crypto.randomBytes(24).toString('hex');
  compdetAccessTokens.set(token, {
    comp_code: String(comp_code ?? '').trim(),
    comp_uid: String(comp_uid ?? '').trim(),
    comp_year: Number(comp_year) || 0,
    accessLevel,
    expires: Date.now() + COMPDET_ACCESS_TOKEN_TTL_MS,
  });
  return token;
}

function resolveCompdetAccessToken(req) {
  return String(
    req.headers['x-compdet-access-token'] ||
      req.body?.access_token ||
      req.query?.access_token ||
      ''
  ).trim();
}

function assertCompdetAccessToken(req, comp_code, comp_uid, comp_year) {
  const token = resolveCompdetAccessToken(req);
  const row = compdetAccessTokens.get(token);
  if (!row || row.expires < Date.now()) {
    if (token) compdetAccessTokens.delete(token);
    const err = new Error('Company detail password required or expired.');
    err.status = 403;
    throw err;
  }
  if (
    row.comp_code !== String(comp_code ?? '').trim() ||
    row.comp_uid !== String(comp_uid ?? '').trim() ||
    Number(row.comp_year) !== Number(comp_year || 0)
  ) {
    const err = new Error('Company detail password does not match this session.');
    err.status = 403;
    throw err;
  }
  return row.accessLevel;
}

function compdetFieldValuesEqual(col, newRaw, existingRow) {
  const key = String(col || '').toUpperCase();
  const newVal = normalizeCompdetSaveValue(key, newRaw);
  const oldVal = rowValueUpper(existingRow, key);
  if (COMPDET_DATE_COLS.has(key)) {
    const newIso = /^\d{4}-\d{2}-\d{2}$/.test(String(newRaw ?? '').trim())
      ? String(newRaw).trim()
      : toInputDateStringFromDmy(newVal);
    const oldIso = toInputDateStringFromDmy(oldVal);
    return newIso === oldIso;
  }
  return String(newVal ?? '').trim() === String(oldVal ?? '').trim();
}

function toInputDateStringFromDmy(dmy) {
  const s = String(dmy ?? '').trim();
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (!m) return s;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function applyCompdetAccessFieldLocks(accessLevel, fields, existingRow) {
  const body = fields && typeof fields === 'object' ? { ...fields } : {};
  if (accessLevel === 'full') return body;
  for (const col of COMPDET_LIMITED_LOCKED_COLS) {
    const raw = body[col] ?? body[col.toLowerCase()];
    if (raw === undefined) continue;
    if (!compdetFieldValuesEqual(col, raw, existingRow)) {
      const labels = {
        COMP_NAME: 'Company Name',
        COMP_S_DT: 'F.Year Start Date',
        COMP_E_DT: 'F.Year End Date',
      };
      const err = new Error(`You cannot change ${labels[col] || col} with this password.`);
      err.status = 403;
      throw err;
    }
    delete body[col];
    delete body[col.toLowerCase()];
  }
  return body;
}

const COMPDET_HUB_TABLE = 'COMPDET';
const COMPDET_READONLY_COLS = new Set(['COMP_CODE', 'COMP_YEAR', 'COMP_UID', 'ROWID']);
const COMPDET_YN_COLS = new Set([
  'HIDE_YEAR',
  'BACKUP_YN',
  'BTYPE_YN',
  'ZERO_BEFORE_PRINTING',
]);
const COMPDET_DATE_COLS = new Set(['COMP_S_DT', 'COMP_E_DT']);
const COMPDET_EDITABLE_COLS = new Set([
  'COMP_NAME',
  'COMP_ADD1',
  'COMP_ADD2',
  'COMP_TEL1',
  'COMP_TEL2',
  'COMP_TEL3',
  'COMP_PAN',
  'COMP_TIN',
  'COMP_TDSNO',
  'COMP_S_DT',
  'COMP_E_DT',
  'COMP_PROP',
  'COMP_P_D',
  'BANK_AC_NO',
  'BANK_AC_NO1',
  'GROUP_ID',
  'EMAIL',
  'LEG_CODE',
  'CIN_NO',
  'SALE_EMAIL',
  'SALE_EMAIL_PW',
  'SALE_EMAIL_NOREPLY',
  'SMS_LINK',
  'SMS_SENDER_ID',
  'EMAIL_PORT',
  'HIDE_YEAR',
  'GST_NO',
  'STATE',
  'STATE_CODE',
  'PIN_CODE',
  'BACKUP_YN',
  'SALE_BILL_INIT',
  'BTYPE_YN',
  'ZERO_BEFORE_PRINTING',
  'FSSAI_NO',
  'WEBSITE',
  'SMS_MSG_TYPE',
  'LLPIN',
  'EINV_FILE_NAME',
  'CUSTOMER_ID_IBL',
  'IBL_BANK_AC_NO',
  'IBL_AUTH_PERSON',
  'IBL_AUTH_PERSON_TEL',
  'IBL_MAKER_ID',
  'FAS_INVOYZ_API_KEY',
  'EMAIL_L_O',
  'FAS_INVOYZ_MID',
  'UPI_ID',
  'FAS_INVOYZ_SALT',
  'FAS_INVOYZ_OUR_BANK_CODE',
  'FAS_INVOYZ_BANK_CHGS_CODE',
  'FAS_INVOYZ_DR_CODE',
  'UDYAM_REG_NO',
  'DOVESOFT_URL',
  'DOVESOFT_USER',
  'DOVESOFT_KEY',
  'DOVESOFT_SENDER_ID',
  'DOVESOFT_ACCUSAGE',
]);

const compdetHubColCache = new Map();

async function getCompdetHubColumns() {
  const key = 'hub:COMPDET';
  if (compdetHubColCache.has(key)) return compdetHubColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tbl ORDER BY COLUMN_ID`,
    { tbl: COMPDET_HUB_TABLE },
    null,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase()).filter(Boolean)
  );
  compdetHubColCache.set(key, cols);
  return cols;
}

function rowValueUpper(row, logical) {
  if (!row) return '';
  const u = String(logical || '').toUpperCase();
  const l = u.toLowerCase();
  const raw = row[u] ?? row[l];
  if (raw == null) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return formatDateDmyFromRaw(raw);
  }
  if (typeof raw === 'object') return '';
  return String(raw).trim();
}

function formatCompdetRowForClient(row) {
  if (!row) return {};
  const out = {};
  for (const col of COMPDET_EDITABLE_COLS) {
    if (!Object.prototype.hasOwnProperty.call(row, col) && !Object.prototype.hasOwnProperty.call(row, col.toLowerCase())) {
      out[col] = rowValueUpper(row, col);
      continue;
    }
    out[col] = rowValueUpper(row, col);
  }
  out.COMP_CODE = rowValueUpper(row, 'COMP_CODE') || rowValueUpper(row, 'comp_code');
  out.COMP_YEAR = rowValueUpper(row, 'COMP_YEAR') || rowValueUpper(row, 'comp_year');
  out.COMP_UID = rowValueUpper(row, 'COMP_UID') || rowValueUpper(row, 'comp_uid');
  return out;
}

function normalizeCompdetSaveValue(col, raw) {
  const key = String(col || '').toUpperCase();
  if (COMPDET_DATE_COLS.has(key)) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return `${d}-${m}-${y}`;
    }
    return s;
  }
  if (COMPDET_YN_COLS.has(key)) {
    const v = String(raw ?? 'N').trim().toUpperCase();
    return v === 'Y' ? 'Y' : 'N';
  }
  if (raw == null) return '';
  return String(raw).trim();
}

async function assertCompanyDetailAccess(user_name, comp_uid, requireEdit = false) {
  const perms = await fetchUserMasterAdminPerms(String(user_name || ''), comp_uid);
  if (!perms.canOpen && !perms.isSupervisor) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (requireEdit && !perms.canEdit && !perms.isSupervisor) {
    const err = new Error('You Can Not Edit');
    err.status = 403;
    throw err;
  }
  return perms;
}

async function loadCompdetEditRow(comp_code, comp_uid, comp_year) {
  const row = await runCompdetHeaderRow(comp_code, comp_uid);
  if (!row) return null;
  const yr = Number(comp_year ?? row.COMP_YEAR ?? row.comp_year ?? 0) || 0;
  const rowYear = Number(row.COMP_YEAR ?? row.comp_year ?? 0) || 0;
  if (yr && rowYear && yr !== rowYear) {
    const exact = await runQuery(
      `SELECT * FROM compdet
        WHERE comp_code = :comp_code
          AND comp_year = :comp_year
          AND TRIM(TO_CHAR(comp_uid)) = :comp_uid
          AND ROWNUM = 1`,
      { comp_code, comp_year: yr, comp_uid: String(comp_uid ?? '').trim() },
      null,
      { suppressDbErrorLog: true }
    ).catch(() => []);
    if (exact?.[0]) return exact[0];
  }
  return row;
}

async function saveCompdetEditRow(comp_code, comp_uid, comp_year, fields) {
  const tableCols = await getCompdetHubColumns();
  if (!tableCols.size) {
    const err = new Error('COMPDET table not found in hub schema.');
    err.status = 404;
    throw err;
  }
  const sets = [];
  const binds = {
    comp_code,
    comp_year: Number(comp_year) || 0,
    comp_uid: String(comp_uid ?? '').trim(),
  };
  const body = fields && typeof fields === 'object' ? fields : {};
  for (const col of COMPDET_EDITABLE_COLS) {
    if (!tableCols.has(col) || COMPDET_READONLY_COLS.has(col)) continue;
    const raw = body[col] ?? body[col.toLowerCase()];
    if (raw === undefined) continue;
    const bind = col.toLowerCase();
    const val = normalizeCompdetSaveValue(col, raw);
    if (COMPDET_DATE_COLS.has(col)) {
      if (val == null || val === '') {
        sets.push(`${bind} = NULL`);
      } else {
        sets.push(`${bind} = TO_DATE(:${bind}, 'DD-MM-YYYY')`);
        binds[bind] = val;
      }
    } else {
      sets.push(`${bind} = :${bind}`);
      binds[bind] = val;
    }
  }
  if (!sets.length) {
    const err = new Error('No editable COMPDET columns to update.');
    err.status = 400;
    throw err;
  }
  const sql = `
    UPDATE compdet
       SET ${sets.join(', ')}
     WHERE comp_code = :comp_code
       AND comp_year = :comp_year
       AND TRIM(TO_CHAR(comp_uid)) = :comp_uid`;
  await runQuery(sql, binds, null, { autoCommit: true });

  const compName = normalizeCompdetSaveValue('COMP_NAME', body.COMP_NAME ?? body.comp_name);
  if (compName && tableCols.has('COMP_NAME')) {
    await runQuery(
      `UPDATE company SET comp_name = :comp_name WHERE comp_code = :comp_code`,
      { comp_code, comp_name: compName },
      null,
      { autoCommit: true, suppressDbErrorLog: true }
    ).catch(() => {});
  }

  return loadCompdetEditRow(comp_code, comp_uid, comp_year);
}

app.post('/api/company-detail-verify-password', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const comp_year = Number(body.comp_year ?? 0) || 0;
    const user_name = String(body.user_name ?? '').trim();
    const password = body.password ?? body.apw ?? '';
    if (!comp_code || comp_uid == null || !comp_year || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    await assertCompanyDetailAccess(user_name, comp_uid, false);
    const accessLevel = verifyCompdetEditPassword(password);
    if (!accessLevel) {
      return res.status(403).json({ error: 'Invalid Password' });
    }
    const token = issueCompdetAccessToken(comp_code, comp_uid, comp_year, accessLevel);
    res.json({ ok: true, token, accessLevel });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ company-detail-verify-password error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/company-detail', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = req.query.comp_uid;
    const comp_year = Number(req.query.comp_year ?? 0) || 0;
    const user_name = String(req.query.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !comp_year || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const accessLevel = assertCompdetAccessToken(req, comp_code, comp_uid, comp_year);
    const perms = await assertCompanyDetailAccess(user_name, comp_uid, false);
    const row = await loadCompdetEditRow(comp_code, comp_uid, comp_year);
    if (!row) return res.status(404).json({ error: 'COMPDET row not found for this company/year.' });
    stripSalePrintImageFields(row);
    res.json({ ok: true, permissions: perms, accessLevel, row: formatCompdetRowForClient(row) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ company-detail GET error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/company-detail', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const comp_year = Number(body.comp_year ?? 0) || 0;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !comp_year || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const accessLevel = assertCompdetAccessToken(req, comp_code, comp_uid, comp_year);
    const perms = await assertCompanyDetailAccess(user_name, comp_uid, false);
    const existing = await loadCompdetEditRow(comp_code, comp_uid, comp_year);
    if (!existing) return res.status(404).json({ error: 'COMPDET row not found for this company/year.' });
    const fields = applyCompdetAccessFieldLocks(accessLevel, body.fields, existing);
    if (!String(fields?.COMP_NAME ?? fields?.comp_name ?? existing.COMP_NAME ?? existing.comp_name ?? '').trim()) {
      return res.status(400).json({ error: 'Company Name is required.' });
    }
    const saved = await saveCompdetEditRow(comp_code, comp_uid, comp_year, fields);
    if (!saved) return res.status(404).json({ error: 'COMPDET row not found after save.' });
    stripSalePrintImageFields(saved);
    res.json({ ok: true, permissions: perms, accessLevel, row: formatCompdetRowForClient(saved) });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ company-detail PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- GST Profile Setting (VFP DO FORM gst_profile) ---
const GST_PROFILE_HUB_TABLE = 'GST_PROFILE';
const GST_PROFILE_EDIT_PW = 'NEWFAS_EINV';
const GST_PROFILE_ACCESS_TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const gstProfileAccessTokens = new Map();
const GST_PROFILE_READONLY_COLS = new Set(['COMP_CODE', 'ROWID']);
const GST_PROFILE_DATE_COLS = new Set(['RENEWAL_DATE']);
const GST_PROFILE_EDITABLE_COLS = new Set([
  'GST_NO',
  'COMP_NAME',
  'TRADE_NAME',
  'POS_STATE_CODE',
  'ADD1',
  'ADD2',
  'CITY',
  'PIN_CODE',
  'STATE_CODE',
  'PHONE',
  'EMAIL',
  'API_LINK',
  'USER_NAME',
  'PASSWORD',
  'CUSTOMER_ID',
  'APPID',
  'APISECRET',
  'API_LINK_CANC',
  'API_LINK_EWAY',
  'API_LINK_EWAY_CANC',
  'USER_NAME_EWAY',
  'PASSWORD_EWAY',
  'EWAY_ENVIRONMENT_TYPE',
  'API_LINK_EWAY_IRN_NO',
  'API_LINK_EWAY_PRINT',
  'API_LINK_EINV_PRINT',
  'RENEWAL_DATE',
]);

const gstProfileHubColCache = new Map();

function verifyGstProfilePassword(password) {
  return String(password ?? '').trim().toUpperCase() === GST_PROFILE_EDIT_PW;
}

function issueGstProfileAccessToken(comp_code) {
  const token = crypto.randomBytes(24).toString('hex');
  gstProfileAccessTokens.set(token, {
    comp_code: String(comp_code ?? '').trim(),
    expires: Date.now() + GST_PROFILE_ACCESS_TOKEN_TTL_MS,
  });
  return token;
}

function resolveGstProfileAccessToken(req) {
  return String(
    req.headers['x-gst-profile-access-token'] ||
      req.body?.access_token ||
      req.query?.access_token ||
      ''
  ).trim();
}

function assertGstProfileAccessToken(req, comp_code) {
  const token = resolveGstProfileAccessToken(req);
  const row = gstProfileAccessTokens.get(token);
  if (!row || row.expires < Date.now()) {
    if (token) gstProfileAccessTokens.delete(token);
    const err = new Error('GST profile password required or expired.');
    err.status = 403;
    throw err;
  }
  if (row.comp_code !== String(comp_code ?? '').trim()) {
    const err = new Error('GST profile password does not match this company.');
    err.status = 403;
    throw err;
  }
}

async function getGstProfileHubColumns() {
  const key = 'hub:GST_PROFILE';
  if (gstProfileHubColCache.has(key)) return gstProfileHubColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tbl ORDER BY COLUMN_ID`,
    { tbl: GST_PROFILE_HUB_TABLE },
    null,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase()).filter(Boolean)
  );
  gstProfileHubColCache.set(key, cols);
  return cols;
}

function gstProfileRowValue(row, logical) {
  if (!row) return '';
  const u = String(logical || '').toUpperCase();
  const l = u.toLowerCase();
  const raw = row[u] ?? row[l];
  if (raw == null) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return formatDateDmyFromRaw(raw);
  }
  if (typeof raw === 'object') return '';
  return String(raw).trim();
}

function formatGstProfileRowForClient(row, comp_code) {
  const out = { COMP_CODE: String(comp_code ?? '').trim() };
  if (!row) return out;
  for (const col of GST_PROFILE_EDITABLE_COLS) {
    out[col] = gstProfileRowValue(row, col);
  }
  out.COMP_CODE =
    gstProfileRowValue(row, 'COMP_CODE') || String(comp_code ?? '').trim();
  return out;
}

function normalizeGstProfileSaveValue(col, raw) {
  const key = String(col || '').toUpperCase();
  if (GST_PROFILE_DATE_COLS.has(key)) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return `${d}-${m}-${y}`;
    }
    return s;
  }
  if (raw == null) return '';
  return String(raw).trim();
}

async function assertGstProfileUserAccess(user_name, comp_uid, requireEdit = false) {
  const perms = await fetchUserMasterAdminPerms(String(user_name || ''), comp_uid);
  if (!perms.canOpen && !perms.isSupervisor) {
    const err = new Error('Access Denied');
    err.status = 403;
    throw err;
  }
  if (requireEdit && !perms.canEdit && !perms.isSupervisor) {
    const err = new Error('You Can Not Edit');
    err.status = 403;
    throw err;
  }
  return perms;
}

async function loadGstProfileRow(comp_code) {
  const code = String(comp_code ?? '').trim();
  const rows = await runQuery(
    `SELECT * FROM gst_profile WHERE comp_code = :comp_code AND ROWNUM = 1`,
    { comp_code: code },
    null,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  return rows?.[0] || null;
}

async function upsertGstProfileRow(comp_code, fields) {
  const tableCols = await getGstProfileHubColumns();
  if (!tableCols.size) {
    const err = new Error('GST_PROFILE table not found in hub schema.');
    err.status = 404;
    throw err;
  }
  const existing = await loadGstProfileRow(comp_code);
  const body = fields && typeof fields === 'object' ? fields : {};
  const binds = { comp_code: String(comp_code ?? '').trim() };

  if (existing) {
    const sets = [];
    for (const col of GST_PROFILE_EDITABLE_COLS) {
      if (!tableCols.has(col) || GST_PROFILE_READONLY_COLS.has(col)) continue;
      const raw = body[col] ?? body[col.toLowerCase()];
      if (raw === undefined) continue;
      const bind = col.toLowerCase();
      const val = normalizeGstProfileSaveValue(col, raw);
      if (GST_PROFILE_DATE_COLS.has(col)) {
        if (val == null || val === '') {
          sets.push(`${bind} = NULL`);
        } else {
          sets.push(`${bind} = TO_DATE(:${bind}, 'DD-MM-YYYY')`);
          binds[bind] = val;
        }
      } else {
        sets.push(`${bind} = :${bind}`);
        binds[bind] = val;
      }
    }
    if (!sets.length) {
      const err = new Error('No editable GST_PROFILE columns to update.');
      err.status = 400;
      throw err;
    }
    await runQuery(
      `UPDATE gst_profile SET ${sets.join(', ')} WHERE comp_code = :comp_code`,
      binds,
      null,
      { autoCommit: true }
    );
  } else {
    const cols = ['COMP_CODE'];
    const vals = [':comp_code'];
    for (const col of GST_PROFILE_EDITABLE_COLS) {
      if (!tableCols.has(col) || GST_PROFILE_READONLY_COLS.has(col)) continue;
      const raw = body[col] ?? body[col.toLowerCase()];
      if (raw === undefined) continue;
      const bind = col.toLowerCase();
      const val = normalizeGstProfileSaveValue(col, raw);
      cols.push(col);
      if (GST_PROFILE_DATE_COLS.has(col)) {
        if (val == null || val === '') {
          vals.push('NULL');
        } else {
          vals.push(`TO_DATE(:${bind}, 'DD-MM-YYYY')`);
          binds[bind] = val;
        }
      } else {
        vals.push(`:${bind}`);
        binds[bind] = val;
      }
    }
    await runQuery(
      `INSERT INTO gst_profile (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
      binds,
      null,
      { autoCommit: true }
    );
  }

  return loadGstProfileRow(comp_code);
}

app.post('/api/gst-profile-verify-password', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.headers['x-comp-code'] ?? '').trim();
    const user_name = String(body.user_name ?? '').trim();
    const password = body.password ?? body.apw ?? '';
    if (!comp_code || !user_name) {
      return res.status(400).json({ error: 'comp_code and user_name are required' });
    }
    if (!verifyGstProfilePassword(password)) {
      return res.status(403).json({ error: 'Invalid Passowrd' });
    }
    const token = issueGstProfileAccessToken(comp_code);
    res.json({ ok: true, token, compCode: comp_code });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ gst-profile-verify-password error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/gst-profile', async (req, res) => {
  try {
    const comp_code = String(req.query.comp_code ?? '').trim();
    const user_name = String(req.query.user_name ?? '').trim();
    if (!comp_code || !user_name) {
      return res.status(400).json({ error: 'comp_code and user_name are required' });
    }
    assertGstProfileAccessToken(req, comp_code);
    const row = await loadGstProfileRow(comp_code);
    res.json({
      ok: true,
      exists: Boolean(row),
      row: formatGstProfileRowForClient(row, comp_code),
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ gst-profile GET error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/gst-profile', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || !user_name) {
      return res.status(400).json({ error: 'comp_code and user_name are required' });
    }
    assertGstProfileAccessToken(req, comp_code);
    if (!String(body.fields?.GST_NO ?? body.fields?.gst_no ?? '').trim()) {
      return res.status(400).json({ error: 'GST No. is required.' });
    }
    const saved = await upsertGstProfileRow(comp_code, body.fields);
    res.json({
      ok: true,
      exists: true,
      row: formatGstProfileRowForClient(saved, comp_code),
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ gst-profile PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Updation (VFP DO FORM update) — desktop only; transfer balances to next year schema ---
function safeOracleSchemaToken(uid) {
  const s = String(uid ?? '').trim().toUpperCase();
  if (!s || !/^[A-Z0-9_]+$/.test(s)) {
    const err = new Error('Invalid directory / schema name.');
    err.status = 400;
    throw err;
  }
  return s;
}

function updationYnFlag(v, defaultYn = 'Y') {
  return String(v ?? defaultYn).trim().toUpperCase() === 'Y';
}

function updationEndDateDmy(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  }
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) return s;
  const d = parseDateOnly(raw);
  return d ? formatDateDmyFromRaw(d) : s;
}

function updationDatesEqual(a, b) {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  if (!da || !db) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

async function findUpdationNextCompdet(comp_code, currentStartRaw) {
  const sdt = formatDateDmyFromRaw(currentStartRaw);
  if (!sdt) return null;
  const rows = await runQuery(
    `SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt
       FROM compdet
      WHERE comp_code = :comp_code
        AND comp_s_dt > TO_DATE(:sdt, 'DD-MM-YYYY')
      ORDER BY comp_s_dt ASC`,
    { comp_code: String(comp_code).trim(), sdt },
    null,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  return rows?.[0] || null;
}

async function loadUpdationCompdetByUid(comp_code, comp_uid) {
  const rows = await runQuery(
    `SELECT comp_uid, comp_year, comp_s_dt, comp_e_dt
       FROM compdet
      WHERE comp_code = :comp_code
        AND TRIM(TO_CHAR(comp_uid)) = :comp_uid
        AND ROWNUM = 1`,
    { comp_code: String(comp_code).trim(), comp_uid: String(comp_uid ?? '').trim() },
    null,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  return rows?.[0] || null;
}

async function fetchUpdationBalances(comp_code, source_uid) {
  return runQuery(
    `SELECT TRIM(a.code) AS code,
            b.schedule AS schedule,
            SUM(NVL(a.dr_amt, 0) - NVL(a.cr_amt, 0)) AS cbal
       FROM ledger a
       INNER JOIN master b ON a.comp_code = b.comp_code AND a.code = b.code
      WHERE a.comp_code = :comp_code
        AND NVL(a.bikri, 'X') <> 'Y'
        AND b.schedule < 12
      GROUP BY a.code, b.schedule
     HAVING SUM(NVL(a.dr_amt, 0) - NVL(a.cr_amt, 0)) <> 0`,
    { comp_code: String(comp_code).trim() },
    source_uid
  );
}

async function runUpdationOpeningTransfer({
  comp_code,
  target_uid,
  end_date_dmy,
  target_year,
  balances,
}) {
  const code = String(comp_code).trim();
  let accounts = 0;

  await runQuery(
    `DELETE FROM ledger a
      WHERE a.comp_code = :comp_code
        AND a.vr_type = 'OP'
        AND a.code IN (
          SELECT b.code FROM master b
           WHERE a.comp_code = b.comp_code AND b.schedule <> 12.10
        )`,
    { comp_code: code },
    target_uid,
    { autoCommit: true }
  );

  await runQuery(
    `UPDATE master SET op_balance = 0
      WHERE comp_code = :comp_code AND NVL(schedule, 0) <> 12.10`,
    { comp_code: code },
    target_uid,
    { autoCommit: true }
  );

  await runQuery(
    `DELETE FROM bills
      WHERE comp_code = :comp_code
        AND vr_date <= TO_DATE(:edt, 'DD-MM-YYYY')
        AND vr_type <> 'OP'`,
    { comp_code: code, edt: end_date_dmy },
    target_uid,
    { autoCommit: true }
  );

  for (const row of balances) {
    const acCode = String(row.CODE ?? row.code ?? '').trim();
    if (!acCode) continue;
    const cbal = Number(row.CBAL ?? row.cbal ?? 0) || 0;
    if (cbal === 0) continue;
    const dr = cbal > 0 ? cbal : 0;
    const cr = cbal < 0 ? Math.abs(cbal) : 0;
    await runQuery(
      `INSERT INTO ledger (comp_code, comp_year, code, vr_type, vr_date, dr_amt, cr_amt, detail)
       VALUES (:comp_code, :comp_year, :code, 'OP', TO_DATE(:edt, 'DD-MM-YYYY'), :dr_amt, :cr_amt, 'OPENING BALANCE')`,
      {
        comp_code: code,
        comp_year: Number(target_year) || 0,
        code: acCode,
        edt: end_date_dmy,
        dr_amt: dr,
        cr_amt: cr,
      },
      target_uid,
      { autoCommit: true }
    );
    await runQuery(
      `UPDATE master SET op_balance = :cbal WHERE comp_code = :comp_code AND code = :code`,
      { comp_code: code, code: acCode, cbal },
      target_uid,
      { autoCommit: true }
    );
    accounts += 1;
  }
  return accounts;
}

async function countUpdationBillsToTransfer(comp_code, source_uid, minAmt) {
  const code = String(comp_code).trim();
  const src = safeOracleSchemaToken(source_uid);
  const rows = await runQuery(
    `SELECT COUNT(*) AS cnt
       FROM ${src}.bills a
      WHERE a.comp_code = :comp_code
        AND EXISTS (
          SELECT 1
            FROM (
              SELECT a2.comp_code, a2.code, a2.bill_date, a2.bill_no, a2.b_type,
                     SUM(CASE WHEN b2.schedule IN (8.10, 8.20, 8.30, 8.40)
                              THEN NVL(a2.dr_amt, 0) - NVL(a2.cr_amt, 0)
                              ELSE NVL(a2.cr_amt, 0) - NVL(a2.dr_amt, 0) END) AS cl
                FROM ${src}.bills a2
                INNER JOIN ${src}.master b2
                  ON a2.comp_code = b2.comp_code AND a2.code = b2.code
               WHERE a2.comp_code = :comp_code
                 AND b2.schedule IN (8.10, 8.20, 8.30, 8.40, 11.10, 11.30, 11.70, 11.50)
               GROUP BY a2.comp_code, a2.code, a2.bill_date, a2.bill_no, a2.b_type
              HAVING SUM(CASE WHEN b2.schedule IN (8.10, 8.20, 8.30, 8.40)
                              THEN NVL(a2.dr_amt, 0) - NVL(a2.cr_amt, 0)
                              ELSE NVL(a2.cr_amt, 0) - NVL(a2.dr_amt, 0) END) <> 0
            ) t1
            INNER JOIN (
              SELECT TRIM(a3.code) AS code
                FROM ${src}.ledger a3
                INNER JOIN ${src}.master b3
                  ON a3.comp_code = b3.comp_code AND a3.code = b3.code
               WHERE a3.comp_code = :comp_code
                 AND NVL(a3.bikri, 'X') <> 'Y'
                 AND b3.schedule < 12
               GROUP BY a3.code, b3.schedule
              HAVING SUM(NVL(a3.dr_amt, 0) - NVL(a3.cr_amt, 0)) <> 0
            ) t2 ON t1.code = t2.code
           WHERE t1.comp_code = a.comp_code
             AND t1.code = a.code
             AND t1.bill_date = a.bill_date
             AND t1.bill_no = a.bill_no
             AND NVL(t1.b_type, 'Z') = NVL(a.b_type, 'Z')
             AND NVL(t1.cl, 0) > :min_amt
        )`,
    { comp_code: code, min_amt: Number(minAmt) || 0 },
    null,
    { suppressDbErrorLog: true }
  ).catch(() => [{ cnt: 0 }]);
  return Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) || 0;
}

async function runUpdationBillsTransfer(comp_code, source_uid, target_uid, minAmt) {
  const code = String(comp_code).trim();
  const src = safeOracleSchemaToken(source_uid);
  const tgt = safeOracleSchemaToken(target_uid);
  await runQuery(
    `INSERT INTO ${tgt}.bills
     SELECT a.*
       FROM ${src}.bills a
      WHERE a.comp_code = :comp_code
        AND EXISTS (
          SELECT 1
            FROM (
              SELECT a2.comp_code, a2.code, a2.bill_date, a2.bill_no, a2.b_type,
                     SUM(CASE WHEN b2.schedule IN (8.10, 8.20, 8.30, 8.40)
                              THEN NVL(a2.dr_amt, 0) - NVL(a2.cr_amt, 0)
                              ELSE NVL(a2.cr_amt, 0) - NVL(a2.dr_amt, 0) END) AS cl
                FROM ${src}.bills a2
                INNER JOIN ${src}.master b2
                  ON a2.comp_code = b2.comp_code AND a2.code = b2.code
               WHERE a2.comp_code = :comp_code
                 AND b2.schedule IN (8.10, 8.20, 8.30, 8.40, 11.10, 11.30, 11.70, 11.50)
               GROUP BY a2.comp_code, a2.code, a2.bill_date, a2.bill_no, a2.b_type
              HAVING SUM(CASE WHEN b2.schedule IN (8.10, 8.20, 8.30, 8.40)
                              THEN NVL(a2.dr_amt, 0) - NVL(a2.cr_amt, 0)
                              ELSE NVL(a2.cr_amt, 0) - NVL(a2.dr_amt, 0) END) <> 0
            ) t1
            INNER JOIN (
              SELECT TRIM(a3.code) AS code
                FROM ${src}.ledger a3
                INNER JOIN ${src}.master b3
                  ON a3.comp_code = b3.comp_code AND a3.code = b3.code
               WHERE a3.comp_code = :comp_code
                 AND NVL(a3.bikri, 'X') <> 'Y'
                 AND b3.schedule < 12
               GROUP BY a3.code, b3.schedule
              HAVING SUM(NVL(a3.dr_amt, 0) - NVL(a3.cr_amt, 0)) <> 0
            ) t2 ON t1.code = t2.code
           WHERE t1.comp_code = a.comp_code
             AND t1.code = a.code
             AND t1.bill_date = a.bill_date
             AND t1.bill_no = a.bill_no
             AND NVL(t1.b_type, 'Z') = NVL(a.b_type, 'Z')
             AND NVL(t1.cl, 0) > :min_amt
        )`,
    { comp_code: code, min_amt: Number(minAmt) || 0 },
    null,
    { autoCommit: true }
  );
}

async function executeUpdationTransfer(body) {
  const comp_code = String(body.comp_code ?? '').trim();
  const source_uid = String(body.source_comp_uid ?? body.comp_uid ?? '').trim();
  const target_uid = String(body.next_year_directory ?? body.target_comp_uid ?? '').trim();
  const end_date_dmy = updationEndDateDmy(body.end_date ?? body.e_date);
  const min_amt = Number(body.min_amount ?? body.min_amt ?? 10) || 0;
  const sup_trf = updationYnFlag(body.sup_trf, 'Y');
  const cust_trf = updationYnFlag(body.cust_trf, 'Y');

  if (!comp_code || !source_uid) {
    const err = new Error('comp_code and current year directory are required.');
    err.status = 400;
    throw err;
  }
  if (!target_uid) {
    const err = new Error('!!! Directory Name Should Not Be Empty !!!');
    err.status = 400;
    throw err;
  }
  if (!end_date_dmy) {
    const err = new Error('Ending Date is required.');
    err.status = 400;
    throw err;
  }

  const targetRow = await loadUpdationCompdetByUid(comp_code, target_uid);
  if (!targetRow) {
    const err = new Error('!!! Next Year Directory Not Found !!!');
    err.status = 400;
    throw err;
  }
  const targetEnd = targetRow.COMP_E_DT ?? targetRow.comp_e_dt;
  if (updationDatesEqual(targetEnd, end_date_dmy)) {
    const err = new Error('!!! You Can Not Update Same Year!!!');
    err.status = 400;
    throw err;
  }

  const target_year = Number(targetRow.COMP_YEAR ?? targetRow.comp_year ?? 0) || 0;
  const balances = await fetchUpdationBalances(comp_code, source_uid);
  const accountsUpdated = await runUpdationOpeningTransfer({
    comp_code,
    target_uid,
    end_date_dmy,
    target_year,
    balances,
  });

  let billsTransferred = 0;
  if (sup_trf || cust_trf) {
    billsTransferred = await countUpdationBillsToTransfer(comp_code, source_uid, min_amt);
    if (billsTransferred > 0) {
      await runUpdationBillsTransfer(comp_code, source_uid, target_uid, min_amt);
    }
  }

  return { accountsUpdated, billsTransferred, balanceRows: balances.length };
}

app.get('/api/updation/context', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Updation cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const comp_code = String(req.query.comp_code ?? '').trim();
    const comp_uid = String(req.query.comp_uid ?? '').trim();
    const user_name = String(req.query.user_name ?? '').trim();
    if (!comp_code || !comp_uid || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(user_name, comp_uid);
    if (!perms.canOpen && !perms.isSupervisor) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    const source = await runCompdetHeaderRow(comp_code, comp_uid);
    if (!source) return res.status(404).json({ error: 'Current compdet row not found.' });

    const nextRow = await findUpdationNextCompdet(
      comp_code,
      source.COMP_S_DT ?? source.comp_s_dt
    );
    const nextUid = nextRow
      ? String(nextRow.COMP_UID ?? nextRow.comp_uid ?? '').trim()
      : '';

    res.json({
      ok: true,
      permissions: perms,
      context: {
        currentYearDirectory: comp_uid,
        nextYearDirectory: nextUid,
        hasNextYear: Boolean(nextUid),
        endDate: formatDateDmyFromRaw(source.COMP_E_DT ?? source.comp_e_dt),
        defaultMinAmount: 10,
        defaultSupTrf: 'Y',
        defaultCustTrf: 'Y',
      },
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ updation context error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/updation/execute', async (req, res) => {
  try {
    if (isDesktopOnlyUtilityMobileClient(req)) {
      return res.status(403).json({
        error: 'Updation cannot be run from mobile. Use desktop view on a computer.',
      });
    }
    const body = req.body || {};
    const comp_uid = String(body.comp_uid ?? body.source_comp_uid ?? '').trim();
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_uid || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(user_name, comp_uid);
    if (!perms.canEdit && !perms.isSupervisor) {
      return res.status(403).json({ error: 'You Can Not Edit' });
    }
    const result = await executeUpdationTransfer(body);
    res.json({ ok: true, message: 'DONE', ...result });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ updation execute error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- GST State Master (VFP DO GST_STATE → GST_STATE) ---
const GST_STATE_TABLE = 'GST_STATE';
const GST_STATE_CODE_MAX = 2;
const GST_STATE_NAME_MAX = 30;

function normalizeGstStateCode(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, GST_STATE_CODE_MAX);
}

function normalizeGstStateName(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, GST_STATE_NAME_MAX);
}

function mapGstStateRow(row) {
  const stateCode = normalizeGstStateCode(row.STATE_CODE ?? row.state_code);
  const state = normalizeGstStateName(row.STATE ?? row.state);
  return {
    STATE_CODE: stateCode,
    state_code: stateCode,
    STATE: state,
    state,
  };
}

function isGstStateMissingTableError(err) {
  const msg = String(err?.message || '');
  return (
    isOracleMissingObjectError(err) ||
    /table or view does not exist/i.test(msg) ||
    msg.includes('ORA-00942')
  );
}

async function queryGstStateRows(sql, binds = {}, comp_uid) {
  const attempts = [];
  if (isEffectiveCompUid(comp_uid)) {
    attempts.push(() => runQuery(sql, binds, comp_uid));
  }
  attempts.push(() => runQuery(sql, binds));
  let lastErr;
  for (const fn of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isGstStateMissingTableError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function fetchGstStateList(comp_uid) {
  const sql = `
    SELECT TRIM(NVL(T.STATE_CODE, '')) AS STATE_CODE,
           TRIM(NVL(T.STATE, '')) AS STATE
    FROM ${GST_STATE_TABLE} T
    ORDER BY UPPER(TRIM(T.STATE_CODE)), UPPER(TRIM(T.STATE))`;
  try {
    if (isEffectiveCompUid(comp_uid)) {
      const companyRows = await queryGstStateRows(sql, {}, comp_uid);
      const mappedCompany = (companyRows || []).map(mapGstStateRow).filter((r) => r.STATE_CODE);
      if (mappedCompany.length) return mappedCompany;
    }
    const hubRows = await queryGstStateRows(sql, {}, null);
    return (hubRows || []).map(mapGstStateRow).filter((r) => r.STATE_CODE);
  } catch (err) {
    if (isGstStateMissingTableError(err)) return [];
    throw err;
  }
}

function normalizeGstStateSaveRows(rows) {
  const seen = new Set();
  const out = [];
  for (const raw of rows || []) {
    const stateCode = normalizeGstStateCode(raw.STATE_CODE ?? raw.state_code);
    const state = normalizeGstStateName(raw.STATE ?? raw.state);
    if (!stateCode && !state) continue;
    if (!stateCode) {
      const err = new Error('State_Code is required on each row.');
      err.status = 400;
      throw err;
    }
    if (!state) {
      const err = new Error(`State name is required for code ${stateCode}.`);
      err.status = 400;
      throw err;
    }
    if (seen.has(stateCode)) {
      const err = new Error(`Duplicate State_Code: ${stateCode}`);
      err.status = 400;
      throw err;
    }
    seen.add(stateCode);
    out.push({ state_code: stateCode, state });
  }
  out.sort((a, b) => String(a.state_code).localeCompare(String(b.state_code)));
  return out;
}

async function saveGstStateList(comp_uid, rows) {
  const normalized = normalizeGstStateSaveRows(rows);
  const deleteSql = `DELETE FROM ${GST_STATE_TABLE}`;
  const insertSql = `
    INSERT INTO ${GST_STATE_TABLE} (STATE, STATE_CODE)
    VALUES (:state, :state_code)`;

  async function applyOnSchema(uid) {
    await runQuery(deleteSql, {}, uid, { autoCommit: true });
    for (const row of normalized) {
      await runQuery(insertSql, row, uid, { autoCommit: true });
    }
  }

  if (isEffectiveCompUid(comp_uid)) {
    try {
      await applyOnSchema(comp_uid);
      const verify = await queryGstStateRows(
        `SELECT STATE_CODE FROM ${GST_STATE_TABLE} WHERE ROWNUM = 1`,
        {},
        comp_uid
      );
      if (normalized.length === 0 || (verify && verify.length)) return 'company';
    } catch (err) {
      if (!isGstStateMissingTableError(err)) throw err;
    }
  }
  await applyOnSchema(null);
  if (normalized.length > 0) {
    const verifyHub = await queryGstStateRows(
      `SELECT STATE_CODE FROM ${GST_STATE_TABLE} WHERE ROWNUM = 1`,
      {},
      null
    );
    if (!verifyHub?.length) {
      const err = new Error('GST state rows were not saved to GST_STATE.');
      err.status = 500;
      throw err;
    }
  }
  return 'hub';
}

app.get('/api/gst-state-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ gst-state-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gst-state', async (req, res) => {
  try {
    const comp_uid = req.query.comp_uid;
    if (comp_uid == null) {
      return res.status(400).json({ error: 'comp_uid is required' });
    }
    const rows = await fetchGstStateList(comp_uid);
    res.json({ rows });
  } catch (err) {
    console.error('❌ gst-state GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/gst-state', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? body.actor_name ?? '').trim();
    const rows = Array.isArray(body.rows) ? body.rows : body.ROWS;
    if (comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const storage = await saveGstStateList(comp_uid, rows);
    const saved = await fetchGstStateList(comp_uid);
    res.json({
      ok: true,
      message: 'DONE',
      storage,
      rows: saved,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ gst-state PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

// --- Godown Master (VFP DO FORM godown → GODOWN) ---
/** Legacy GODOWN schemas may use STATE / STATE_CODE instead of GOD_STATE / GOD_STATE_CODE. */
const GODOWN_COL_ALIASES = {
  GOD_STATE: ['STATE'],
  GOD_STATE_CODE: ['STATE_CODE'],
};

const GODOWN_FIELD_DEFS = [
  { col: 'GOD_CODE', bind: 'god_code', str: true, required: true },
  { col: 'GOD_NAME', bind: 'god_name', str: true, required: true },
  { col: 'GOD_NAME1', bind: 'god_name1', str: true },
  { col: 'GOD_ADD1', bind: 'god_add1', str: true },
  { col: 'GOD_ADD2', bind: 'god_add2', str: true },
  { col: 'GOD_LOCATION', bind: 'god_location', str: true },
  { col: 'GOD_PIN_CODE', bind: 'god_pin_code', str: true },
  { col: 'GOD_STATE_CODE', bind: 'god_state_code', str: true },
  { col: 'GOD_STATE', bind: 'god_state', str: true },
  { col: 'GOD_GST_NO', bind: 'god_gst_no', str: true },
  { col: 'GOD_TEL_NO_1', bind: 'god_tel_no_1', str: true },
  { col: 'GOD_TEL_NO_2', bind: 'god_tel_no_2', str: true },
  { col: 'GOD_FSSAI_NO', bind: 'god_fssai_no', str: true },
  { col: 'GOD_B_TYPE', bind: 'god_b_type', str: true },
  { col: 'GOD_CODE_MAIN', bind: 'god_code_main', str: true },
];
const godownColCache = new Map();

async function getGodownColumns(comp_uid) {
  const key = String(comp_uid || '_').trim() || '_';
  if (godownColCache.has(key)) return godownColCache.get(key);
  const colRows = await runQuery(
    `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'GODOWN' ORDER BY COLUMN_ID`,
    {},
    comp_uid,
    { suppressDbErrorLog: true }
  ).catch(() => []);
  const cols = new Set(
    (colRows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toUpperCase())
  );
  godownColCache.set(key, cols);
  return cols;
}

function normalizeGodownCode(v) {
  return String(v ?? '').trim().toUpperCase().slice(0, 6);
}

function godownPhysicalCol(cols, logicalCol) {
  if (cols.has(logicalCol)) return logicalCol;
  for (const alt of GODOWN_COL_ALIASES[logicalCol] || []) {
    if (cols.has(alt)) return alt;
  }
  return null;
}

function godownPick(row, col) {
  const keys = [col, ...(GODOWN_COL_ALIASES[col] || [])];
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()];
    if (v != null && String(v).trim() !== '') return v;
  }
  return '';
}

function lookupGstStateName(code, byCode) {
  const c = String(code ?? '').trim();
  if (!c || !byCode?.size) return '';
  if (byCode.has(c)) return byCode.get(c);
  if (/^\d+$/.test(c)) {
    const n = parseInt(c, 10);
    for (const [k, v] of byCode) {
      if (/^\d+$/.test(k) && parseInt(k, 10) === n) return v;
    }
  }
  return '';
}

async function enrichGodownRowsStateNames(rows, comp_uid, comp_code, cols) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const mapped = rows.map((r) => mapGodownRow(r));
  const needsLookup = mapped.some(
    (r) => String(r.GOD_STATE_CODE ?? '').trim() && !String(r.GOD_STATE ?? '').trim()
  );
  if (!needsLookup) return mapped;
  const stateRows = await fetchMasterPartyStateRows(comp_uid, comp_code);
  const byCode = new Map();
  for (const s of stateRows || []) {
    const c = String(s.STATE_CODE ?? s.state_code ?? '').trim();
    if (!c) continue;
    byCode.set(c, String(s.STATE ?? s.state ?? '').trim());
  }
  if (!byCode.size) return mapped;
  return mapped.map((r) => {
    if (String(r.GOD_STATE ?? '').trim()) return r;
    const code = String(r.GOD_STATE_CODE ?? '').trim();
    const name = lookupGstStateName(code, byCode);
    if (!name) return r;
    return { ...r, GOD_STATE: name, god_state: name };
  });
}

function mapGodownRow(row) {
  if (!row) return null;
  const out = { COMP_CODE: Number(godownPick(row, 'COMP_CODE')) || 0 };
  for (const { col, bind, str } of GODOWN_FIELD_DEFS) {
    const v = godownPick(row, col);
    out[col] = str ? String(v).trim() : v;
    out[bind] = out[col];
  }
  return out;
}

function buildGodownBinds(body, { comp_code }) {
  const god_code = normalizeGodownCode(body.god_code ?? body.GOD_CODE);
  if (!god_code) {
    const err = new Error('Godown code is required.');
    err.status = 400;
    throw err;
  }
  const god_name = String(body.god_name ?? body.GOD_NAME ?? '').trim().toUpperCase();
  if (!god_name) {
    const err = new Error('Godown name is required.');
    err.status = 400;
    throw err;
  }
  const caps = (v, max) => String(v ?? '').trim().toUpperCase().slice(0, max || 200);
  const binds = {
    comp_code: String(comp_code).trim(),
    god_code,
    god_name,
    god_name1: caps(body.god_name1 ?? body.GOD_NAME1, 80),
    god_add1: caps(body.god_add1 ?? body.GOD_ADD1, 80),
    god_add2: caps(body.god_add2 ?? body.GOD_ADD2, 80),
    god_location: caps(body.god_location ?? body.GOD_LOCATION, 40),
    god_pin_code: String(body.god_pin_code ?? body.GOD_PIN_CODE ?? '').trim().slice(0, 10),
    god_state_code: String(body.god_state_code ?? body.GOD_STATE_CODE ?? '').trim().slice(0, 4),
    god_state: caps(body.god_state ?? body.GOD_STATE, 40),
    god_gst_no: String(body.god_gst_no ?? body.GOD_GST_NO ?? '').trim().toUpperCase().slice(0, 20),
    god_tel_no_1: String(body.god_tel_no_1 ?? body.GOD_TEL_NO_1 ?? '').trim().slice(0, 20),
    god_tel_no_2: String(body.god_tel_no_2 ?? body.GOD_TEL_NO_2 ?? '').trim().slice(0, 20),
    god_fssai_no: String(body.god_fssai_no ?? body.GOD_FSSAI_NO ?? '').trim().toUpperCase().slice(0, 20),
    god_b_type: caps(body.god_b_type ?? body.GOD_B_TYPE, 1) || 'N',
    god_code_main: normalizeGodownCode(body.god_code_main ?? body.GOD_CODE_MAIN) || null,
  };
  return binds;
}

function godownListSelectExprs(cols) {
  if (!cols.has('GOD_CODE')) return [];
  const sel = ['TRIM(TO_CHAR(G.GOD_CODE)) AS GOD_CODE'];
  for (const { col } of GODOWN_FIELD_DEFS) {
    if (col === 'GOD_CODE') continue;
    const physical = godownPhysicalCol(cols, col);
    if (!physical) continue;
    if (col === 'GOD_CODE_MAIN' || physical === 'GOD_CODE_MAIN') {
      sel.push(`TRIM(TO_CHAR(G.${physical})) AS GOD_CODE_MAIN`);
    } else {
      sel.push(`NVL(G.${physical}, '') AS ${col}`);
    }
  }
  return sel;
}

async function fetchGodownMasterList(comp_code, comp_uid, q) {
  const cols = await getGodownColumns(comp_uid);
  if (!cols.has('GOD_CODE') || !cols.has('COMP_CODE')) return [];
  const binds = { comp_code: String(comp_code).trim() };
  const sel = godownListSelectExprs(cols);
  if (!sel.length) return [];
  let sql = `SELECT ${sel.join(', ')} FROM GODOWN G WHERE G.COMP_CODE = :comp_code`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      [
        cols.has('GOD_NAME') ? 'UPPER(G.GOD_NAME)' : null,
        'UPPER(TRIM(TO_CHAR(G.GOD_CODE)))',
        cols.has('GOD_LOCATION') ? 'UPPER(G.GOD_LOCATION)' : null,
        cols.has('GOD_NAME1') ? 'UPPER(G.GOD_NAME1)' : null,
        cols.has('GOD_ADD1') ? 'UPPER(G.GOD_ADD1)' : null,
        cols.has('GOD_ADD2') ? 'UPPER(G.GOD_ADD2)' : null,
        godownPhysicalCol(cols, 'GOD_STATE') ? `UPPER(G.${godownPhysicalCol(cols, 'GOD_STATE')})` : null,
        godownPhysicalCol(cols, 'GOD_STATE_CODE') ? `UPPER(G.${godownPhysicalCol(cols, 'GOD_STATE_CODE')})` : null,
        cols.has('GOD_GST_NO') ? 'UPPER(G.GOD_GST_NO)' : null,
        cols.has('GOD_PIN_CODE') ? 'UPPER(G.GOD_PIN_CODE)' : null,
      ].filter(Boolean),
      'godq'
    );
  }
  sql += ` ORDER BY CASE
    WHEN REGEXP_LIKE(TRIM(TO_CHAR(G.GOD_CODE)), '^[0-9]+$') THEN TO_NUMBER(TRIM(TO_CHAR(G.GOD_CODE)))
    ELSE 999999999
  END, UPPER(TRIM(TO_CHAR(G.GOD_CODE)))`;
  try {
    const rows = await runQuery(sql, binds, comp_uid);
    return enrichGodownRowsStateNames(rows, comp_uid, comp_code, cols);
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
    return [];
  }
}

async function fetchGodownByCode(comp_code, god_code, comp_uid) {
  const code = normalizeGodownCode(god_code);
  if (!code) return null;
  const cols = await getGodownColumns(comp_uid);
  const sel = ['G.COMP_CODE'];
  for (const { col } of GODOWN_FIELD_DEFS) {
    const physical = godownPhysicalCol(cols, col);
    if (physical) sel.push(`G.${physical}`);
  }
  const sql = `SELECT ${sel.join(', ')} FROM GODOWN G
    WHERE G.COMP_CODE = :comp_code AND TRIM(TO_CHAR(G.GOD_CODE)) = :god_code AND ROWNUM = 1`;
  const rows = await runQuery(
    sql,
    { comp_code: String(comp_code).trim(), god_code: code },
    comp_uid
  ).catch(() => []);
  if (!rows?.[0]) return null;
  const enriched = await enrichGodownRowsStateNames([rows[0]], comp_uid, comp_code, cols);
  return enriched[0] || mapGodownRow(rows[0]);
}

async function fetchNextGodownCode(comp_code, comp_uid) {
  try {
    const rows = await runQuery(
      `SELECT NVL(MAX(
        CASE WHEN REGEXP_LIKE(TRIM(TO_CHAR(GOD_CODE)), '^[0-9]+$')
             THEN TO_NUMBER(TRIM(TO_CHAR(GOD_CODE))) ELSE NULL END
      ), 0) AS MAX_NO FROM GODOWN WHERE COMP_CODE = :comp_code`,
      { comp_code: String(comp_code).trim() },
      comp_uid
    );
    const maxNo = Math.trunc(Number(rows?.[0]?.MAX_NO ?? rows?.[0]?.max_no ?? 0) || 0);
    return { next_code: String(maxNo + 1), NEXT_CODE: String(maxNo + 1) };
  } catch {
    const rows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM GODOWN WHERE COMP_CODE = :comp_code`,
      { comp_code: String(comp_code).trim() },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    return { next_code: String(Number(rows?.[0]?.CNT ?? 0) + 1), NEXT_CODE: String(Number(rows?.[0]?.CNT ?? 0) + 1) };
  }
}

async function countGodownUsage(comp_code, god_code, comp_uid) {
  const code = normalizeGodownCode(god_code);
  const checks = [
    `SELECT COUNT(*) AS CNT FROM LOTSTOCK WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GOD_CODE)) = :god_code`,
    `SELECT COUNT(*) AS CNT FROM LOTSTOCK WHERE COMP_CODE = :comp_code AND GOD_CODE = :god_code`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, god_code: code }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return cnt;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) throw err;
    }
  }
  return 0;
}

async function insertGodownRow(binds, comp_uid) {
  const cols = await getGodownColumns(comp_uid);
  const insCols = ['COMP_CODE'];
  const ph = [':comp_code'];
  const b = { comp_code: binds.comp_code };
  for (const { col, bind } of GODOWN_FIELD_DEFS) {
    const physical = godownPhysicalCol(cols, col);
    if (physical) {
      insCols.push(physical);
      ph.push(`:${bind}`);
      b[bind] = binds[bind];
    }
  }
  const sql = `INSERT INTO GODOWN (${insCols.join(', ')}) VALUES (${ph.join(', ')})`;
  await runQuery(sql, b, comp_uid, { autoCommit: true });
}

async function updateGodownRow(binds, comp_uid) {
  const cols = await getGodownColumns(comp_uid);
  const sets = [];
  const b = { comp_code: binds.comp_code, god_code: binds.god_code };
  for (const { col, bind } of GODOWN_FIELD_DEFS) {
    if (col === 'GOD_CODE') continue;
    const physical = godownPhysicalCol(cols, col);
    if (physical) {
      sets.push(`${physical} = :${bind}`);
      b[bind] = binds[bind];
    }
  }
  if (!sets.length) {
    const err = new Error('GODOWN table has no updatable columns.');
    err.status = 500;
    throw err;
  }
  const sql = `UPDATE GODOWN SET ${sets.join(', ')}
    WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GOD_CODE)) = :god_code`;
  await runQuery(sql, b, comp_uid, { autoCommit: true });
}

async function deleteGodownByCode(comp_code, god_code, comp_uid) {
  const code = normalizeGodownCode(god_code);
  const attempts = [
    `DELETE FROM GODOWN WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GOD_CODE)) = :god_code`,
    `DELETE FROM GODOWN WHERE COMP_CODE = :comp_code AND GOD_CODE = :god_code`,
  ];
  let lastErr;
  for (const sql of attempts) {
    try {
      await runQuery(sql, { comp_code, god_code: code }, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('GODOWN delete failed');
}

function buildGodownSavedJson(binds) {
  const row = { COMP_CODE: binds.comp_code };
  for (const { col, bind } of GODOWN_FIELD_DEFS) row[col] = binds[bind];
  return { ok: true, ...mapGodownRow(row) };
}

app.get('/api/godown-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f4, source } = await fetchMasterPartyUserF4String(String(user_name), comp_uid);
    res.json({ f4, source, ...masterPartyPermissionsFromF4(f4) });
  } catch (err) {
    console.error('❌ godown-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/godown-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchGodownMasterList(comp_code, comp_uid, q);
    res.json((rows || []).map(mapGodownRow));
  } catch (err) {
    console.error('❌ godown-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/godown-next-code', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    res.json(await fetchNextGodownCode(comp_code, comp_uid));
  } catch (err) {
    console.error('❌ godown-next-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/godown', async (req, res) => {
  try {
    const { comp_code, comp_uid, god_code } = req.query;
    if (!comp_code || comp_uid == null || !god_code) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and god_code are required' });
    }
    const row = await fetchGodownByCode(comp_code, god_code, comp_uid);
    if (!row) return res.status(404).json({ error: 'Godown not found.' });
    res.json(row);
  } catch (err) {
    console.error('❌ godown GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/godown', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      binds = buildGodownBinds(body, { comp_code });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    if (await fetchGodownByCode(comp_code, binds.god_code, comp_uid)) {
      return res.status(409).json({ error: 'Godown code already exists.' });
    }

    await insertGodownRow(binds, comp_uid);
    res.json(buildGodownSavedJson(binds));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ godown POST error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.put('/api/godown', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    if (!comp_code || comp_uid == null || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    let binds;
    try {
      binds = buildGodownBinds(body, { comp_code });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    if (!(await fetchGodownByCode(comp_code, binds.god_code, comp_uid))) {
      return res.status(404).json({ error: 'Godown not found.' });
    }

    await updateGodownRow(binds, comp_uid);
    res.json(buildGodownSavedJson(binds));
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ godown PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/godown', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query?.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query?.comp_uid;
    const user_name = String(body.user_name ?? req.query?.user_name ?? '').trim();
    const god_code = normalizeGodownCode(body.god_code ?? body.GOD_CODE ?? req.query?.god_code);
    if (!comp_code || comp_uid == null || !user_name || !god_code) {
      return res.status(400).json({ error: 'comp_code, comp_uid, god_code, and user_name are required' });
    }
    const { f4 } = await fetchMasterPartyUserF4String(user_name, comp_uid);
    const perms = masterPartyPermissionsFromF4(f4);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    if (!(await fetchGodownByCode(comp_code, god_code, comp_uid))) {
      return res.status(404).json({ error: 'Godown not found.' });
    }

    const usage = await countGodownUsage(comp_code, god_code, comp_uid);
    if (usage > 0) {
      return res.status(409).json({ error: 'Cannot delete — this godown is used in stock (LOTSTOCK).' });
    }

    await deleteGodownByCode(comp_code, god_code, comp_uid);
    res.json({ ok: true, message: `Godown [${god_code}] deleted.`, god_code, GOD_CODE: god_code });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ godown DELETE error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

function normalizeItemGrpCode(v) {
  return trimItemMasterField(v, 6).toUpperCase();
}

function buildItemGrpSavedJson(binds) {
  return {
    ok: true,
    GRP_CODE: binds.grp_code,
    grp_code: binds.grp_code,
    GRP_NAME: binds.grp_name,
    grp_name: binds.grp_name,
  };
}

function buildItemGrpBinds(body, { comp_code, comp_year, user_name }) {
  const grp_code = normalizeItemGrpCode(body.grp_code ?? body.GRP_CODE);
  if (!grp_code) {
    const err = new Error('Group code is required.');
    err.status = 400;
    throw err;
  }
  const grp_name = String(body.grp_name ?? body.GRP_NAME ?? '')
    .trim()
    .toUpperCase();
  if (!grp_name) {
    const err = new Error('Group name is required.');
    err.status = 400;
    throw err;
  }
  return {
    comp_code,
    comp_year: Number(comp_year) || 0,
    grp_code,
    grp_name,
    user_name: String(user_name ?? '').trim(),
  };
}

async function fetchItemGrpMasterList(comp_code, comp_uid, q) {
  const binds = { comp_code };
  let sql = `
    SELECT TRIM(TO_CHAR(S.GRP_CODE)) AS GRP_CODE,
           NVL(S.GRP_NAME, '') AS GRP_NAME
    FROM ITEM_GRP S
    WHERE S.COMP_CODE = :comp_code`;
  const qTrim = String(q ?? '').trim();
  if (qTrim) {
    sql = appendMasterListTokenSearch(
      sql,
      binds,
      qTrim,
      ['UPPER(S.GRP_NAME)', 'UPPER(TRIM(TO_CHAR(S.GRP_CODE)))'],
      'igrpq'
    );
  }
  sql += `
    ORDER BY CASE
      WHEN REGEXP_LIKE(TRIM(TO_CHAR(S.GRP_CODE)), '^[0-9]+$') THEN TO_NUMBER(TRIM(TO_CHAR(S.GRP_CODE)))
      ELSE 999999999
    END,
    UPPER(S.GRP_NAME),
    TRIM(TO_CHAR(S.GRP_CODE))`;
  try {
    return await runQuery(sql, binds, comp_uid);
  } catch (err) {
    if (!isOracleMissingObjectError(err)) throw err;
    return [];
  }
}

async function countItemsUsingItemGrpCode(comp_code, grp_code, comp_uid) {
  const code = normalizeItemGrpCode(grp_code);
  if (!code) return 0;
  const checks = [
    `SELECT COUNT(*) AS CNT FROM ITEMMAST
     WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GRP_CODE)) = :grp_code`,
    `SELECT COUNT(*) AS CNT FROM ITEMMAST
     WHERE COMP_CODE = :comp_code AND TRIM(GRP_CODE) = :grp_code`,
  ];
  for (const sql of checks) {
    try {
      const rows = await runQuery(sql, { comp_code, grp_code: code }, comp_uid);
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > 0) return cnt;
    } catch (err) {
      if (!isOracleMissingObjectError(err) && !/invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }
  return 0;
}

async function insertItemGrpRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      INSERT INTO ITEM_GRP (COMP_CODE, GRP_CODE, GRP_NAME)
      VALUES (:comp_code, :grp_code, :grp_name)`,
      binds: { comp_code: binds.comp_code, grp_code: binds.grp_code, grp_name: binds.grp_name },
    },
    {
      sql: `
      INSERT INTO ITEM_GRP (COMP_CODE, COMP_YEAR, GRP_CODE, GRP_NAME)
      VALUES (:comp_code, :comp_year, :grp_code, :grp_name)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        grp_code: binds.grp_code,
        grp_name: binds.grp_name,
      },
    },
    {
      sql: `
      INSERT INTO ITEM_GRP (COMP_CODE, COMP_YEAR, GRP_CODE, GRP_NAME, USER_NAME, ENT_DATE)
      VALUES (:comp_code, :comp_year, :grp_code, :grp_name, :user_name, SYSDATE)`,
      binds: {
        comp_code: binds.comp_code,
        comp_year: binds.comp_year,
        grp_code: binds.grp_code,
        grp_name: binds.grp_name,
        user_name: binds.user_name,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('ITEM_GRP insert failed');
}

async function updateItemGrpRow(binds, comp_uid) {
  const attempts = [
    {
      sql: `
      UPDATE ITEM_GRP SET GRP_NAME = :grp_name
      WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GRP_CODE)) = :grp_code`,
      binds: {
        comp_code: binds.comp_code,
        grp_code: binds.grp_code,
        grp_name: binds.grp_name,
      },
    },
    {
      sql: `
      UPDATE ITEM_GRP SET GRP_NAME = :grp_name
      WHERE COMP_CODE = :comp_code AND GRP_CODE = :grp_code`,
      binds: {
        comp_code: binds.comp_code,
        grp_code: binds.grp_code,
        grp_name: binds.grp_name,
      },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('ITEM_GRP update failed');
}

async function deleteItemGrpByCode(comp_code, grp_code, comp_uid) {
  const code = normalizeItemGrpCode(grp_code);
  const attempts = [
    {
      sql: `DELETE FROM ITEM_GRP WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GRP_CODE)) = :grp_code`,
      binds: { comp_code, grp_code: code },
    },
    {
      sql: `DELETE FROM ITEM_GRP WHERE COMP_CODE = :comp_code AND GRP_CODE = :grp_code`,
      binds: { comp_code, grp_code: code },
    },
  ];
  let lastErr;
  for (const { sql, binds: b } of attempts) {
    try {
      await runQuery(sql, b, comp_uid, { autoCommit: true });
      return;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (!msg.includes('00904') && !/invalid identifier/i.test(msg)) throw err;
    }
  }
  throw lastErr || new Error('ITEM_GRP delete failed');
}

app.get('/api/item-grp-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ item-grp-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item-grp-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchItemGrpMasterList(comp_code, comp_uid, q);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ item-grp-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/item-grp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      binds = buildItemGrpBinds(body, { comp_code, comp_year, user_name });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM ITEM_GRP
       WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GRP_CODE)) = :grp_code AND ROWNUM = 1`,
      { comp_code, grp_code: binds.grp_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) {
      return res.status(409).json({ error: 'Group code already exists.' });
    }

    await insertItemGrpRow(binds, comp_uid);
    res.json(buildItemGrpSavedJson(binds));
  } catch (err) {
    console.error('❌ item-grp POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/item-grp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    let binds;
    try {
      binds = buildItemGrpBinds(body, { comp_code, comp_year, user_name });
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM ITEM_GRP
       WHERE COMP_CODE = :comp_code AND TRIM(TO_CHAR(GRP_CODE)) = :grp_code AND ROWNUM = 1`,
      { comp_code, grp_code: binds.grp_code },
      comp_uid
    ).catch(() => [{ CNT: 0 }]);
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Group ${binds.grp_code} not found.` });
    }

    await updateItemGrpRow(binds, comp_uid);
    res.json(buildItemGrpSavedJson(binds));
  } catch (err) {
    console.error('❌ item-grp PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/item-grp', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const user_name = String(body.user_name ?? req.query.user_name ?? '').trim();
    const grpCode = normalizeItemGrpCode(body.grp_code ?? body.GRP_CODE ?? req.query.grp_code);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name || !grpCode) {
      return res.status(400).json({ error: 'comp_code, comp_uid, user_name, and grp_code are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const itemCnt = await countItemsUsingItemGrpCode(comp_code, grpCode, comp_uid);
    if (itemCnt > 0) {
      return res.status(409).json({
        error: 'Cannot delete — this group is used in Item Master.',
      });
    }

    await deleteItemGrpByCode(comp_code, grpCode, comp_uid);
    res.json({ ok: true, grp_code: grpCode, GRP_CODE: grpCode });
  } catch (err) {
    console.error('❌ item-grp DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const USER_HUB_TABLES = ['DAL.USERS', 'USERS', 'GRAIN.USERS'];
/** Hub table that actually holds user rows (insert/list must use the same one). */
let preferredUsersHubTable = null;

function usersHubTableOrder(tableHint = null) {
  if (tableHint) return [tableHint];
  if (preferredUsersHubTable) {
    return [preferredUsersHubTable, ...USER_HUB_TABLES.filter((t) => t !== preferredUsersHubTable)];
  }
  return [...USER_HUB_TABLES];
}

async function detectPreferredUsersHubTable() {
  if (preferredUsersHubTable) return preferredUsersHubTable;
  let bestTable = null;
  let bestCount = -1;
  for (const t of USER_HUB_TABLES) {
    try {
      const rows = await runQuery(`SELECT COUNT(*) AS CNT FROM ${t}`, {}, null, { suppressDbErrorLog: true });
      const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0);
      if (cnt > bestCount) {
        bestCount = cnt;
        bestTable = t;
      }
    } catch (_) {
      /* try next */
    }
  }
  if (bestTable) {
    preferredUsersHubTable = bestTable;
    return bestTable;
  }
  for (const t of USER_HUB_TABLES) {
    try {
      await runQuery(`SELECT 1 AS OK FROM ${t} WHERE ROWNUM = 1`, {}, null, { suppressDbErrorLog: true });
      preferredUsersHubTable = t;
      return t;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

async function runUsersHubQuery(sqlTemplate, binds = {}, tableHint = null) {
  if (!tableHint && !preferredUsersHubTable) await detectPreferredUsersHubTable();
  let lastErr;
  for (const t of usersHubTableOrder(tableHint)) {
    try {
      const sql = String(sqlTemplate).replace(/\{TABLE\}/g, t);
      const rows = await runQuery(sql, binds, null, { suppressDbErrorLog: true });
      if (!tableHint && !preferredUsersHubTable) preferredUsersHubTable = t;
      return { rows: rows || [], table: t };
    } catch (err) {
      lastErr = err;
      if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) throw err;
    }
  }
  throw lastErr || new Error('USERS table not available');
}

function normalizeUserMasterNo(v) {
  const n = Math.trunc(Number(String(v ?? '').trim()) || 0);
  return n > 0 ? n : 0;
}

function normalizeUserMasterName(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 10);
}

function normalizeUserMasterPassword(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 10);
}

function normalizeYnField(v) {
  const s = String(v ?? '')
    .trim()
    .toUpperCase()
    .charAt(0);
  return s === 'Y' ? 'Y' : s === 'N' ? 'N' : '';
}

function normalizeRights4(v) {
  const str = String(v ?? '').trim();
  const ch = (i) => (str.length > i ? str.charAt(i) : '0');
  return `${ch(0) === '1' ? '1' : '0'}${ch(1) === '1' ? '1' : '0'}${ch(2) === '1' ? '1' : '0'}${ch(3) === '1' ? '1' : '0'}`;
}

function mapUserMasterRow(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {
    USER_NO: Number(row.USER_NO ?? row.user_no ?? 0) || 0,
    USER_NAME: String(row.USER_NAME ?? row.user_name ?? '').trim(),
    SUPERVISOR: String(row.SUPERVISOR ?? row.supervisor ?? '').trim(),
    COMP_CODE: String(row.COMP_CODE ?? row.comp_code ?? '').trim(),
    F_DAYS: row.F_DAYS ?? row.f_days ?? '',
    F_DATE: row.F_DATE ?? row.f_date ?? null,
    R_C_NO: row.R_C_NO ?? row.r_c_no ?? '',
    S_R_C_NO: row.S_R_C_NO ?? row.s_r_c_no ?? '',
    E_R_C_NO: row.E_R_C_NO ?? row.e_r_c_no ?? '',
    TRIAL_ACCESS: String(row.TRIAL_ACCESS ?? row.trial_access ?? '').trim(),
    BS_ACCESS: String(row.BS_ACCESS ?? row.bs_access ?? '').trim(),
    IBL_PAYMENT: normalizeYnField(row.IBL_PAYMENT ?? row.ibl_payment),
    IBL_PAYMENT_LIMIT: row.IBL_PAYMENT_LIMIT ?? row.ibl_payment_limit ?? '',
  };
  for (let i = 1; i <= 13; i++) {
    const k = `F${i}`;
    out[k] = normalizeRights4(row[k] ?? row[k.toLowerCase()]);
  }
  return out;
}

async function fetchUserMasterAdminPerms(user_name, comp_uid) {
  const u = String(user_name || '').trim().toUpperCase();
  const { f4, source: f4Source } = await fetchMasterPartyUserF4String(u, comp_uid);
  const f4perms = masterPartyPermissionsFromF4(f4);
  let supervisor = '';
  try {
    const { rows } = await runUsersHubQuery(
      `SELECT NVL(SUPERVISOR, '') AS SUPERVISOR FROM {TABLE}
       WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
      { u }
    );
    supervisor = String(rows[0]?.SUPERVISOR ?? rows[0]?.supervisor ?? '').trim().toUpperCase();
  } catch (_) {
    /* optional */
  }
  const isSupervisor = supervisor === 'Y';
  return {
    f4,
    f4Source,
    supervisor,
    isSupervisor,
    canOpen: isSupervisor || f4perms.canOpen,
    canAdd: isSupervisor || f4perms.canAdd,
    canEdit: isSupervisor || f4perms.canEdit,
    canDelete: isSupervisor || f4perms.canDelete,
    flags: isSupervisor ? 'supervisor' : f4perms.flags,
  };
}

async function fetchUserMasterList(q) {
  await detectPreferredUsersHubTable();
  const qTrim = String(q ?? '').trim().toUpperCase();
  const binds = {};
  let where = '1=1';
  if (qTrim) {
    binds.qlike = `%${qTrim}%`;
    where = `(UPPER(TRIM(USER_NAME)) LIKE :qlike OR TRIM(TO_CHAR(USER_NO)) LIKE :qlike)`;
  }
  const selects = [
    `SELECT USER_NO, USER_NAME, SUPERVISOR, COMP_CODE, F_DAYS, F_DATE, R_C_NO, S_R_C_NO, E_R_C_NO,
            TRIAL_ACCESS, BS_ACCESS, IBL_PAYMENT, IBL_PAYMENT_LIMIT,
            F1,F2,F3,F4,F5,F6,F7,F8,F9,F10,F11,F12,F13
     FROM {TABLE} WHERE ${where} ORDER BY USER_NO`,
    `SELECT USER_NO, USER_NAME, SUPERVISOR, COMP_CODE FROM {TABLE} WHERE ${where} ORDER BY USER_NO`,
  ];
  let lastErr;
  for (const sqlTemplate of selects) {
    try {
      const { rows } = await runUsersHubQuery(sqlTemplate, binds);
      return rows.map(mapUserMasterRow).filter(Boolean);
    } catch (err) {
      lastErr = err;
      if (!isUnknownUsersColumnError(err)) throw err;
    }
  }
  throw lastErr || new Error('USERS list failed');
}

async function fetchUserMasterByNo(userNo, tableHint = null) {
  const no = normalizeUserMasterNo(userNo);
  if (!no) return null;
  const { rows } = await runUsersHubQuery(
    `SELECT USER_NO, USER_NAME, SUPERVISOR, COMP_CODE, F_DAYS, F_DATE, R_C_NO, S_R_C_NO, E_R_C_NO,
            TRIAL_ACCESS, BS_ACCESS, IBL_PAYMENT, IBL_PAYMENT_LIMIT,
            F1,F2,F3,F4,F5,F6,F7,F8,F9,F10,F11,F12,F13
     FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
    { user_no: no },
    tableHint
  ).catch(async (err) => {
    if (!isUnknownUsersColumnError(err)) throw err;
    const r = await runUsersHubQuery(
      `SELECT USER_NO, USER_NAME, SUPERVISOR, COMP_CODE FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
      { user_no: no },
      tableHint
    );
    return r;
  });
  return rows.length ? mapUserMasterRow(rows[0]) : null;
}

async function fetchNextUserMasterNo() {
  /** VFP / client rule: next USER_NO = MAX(NVL(USER_NO,0)) + 1 from GRAINFAS.USERS */
  const grainfasAttempts = [
    'SELECT MAX(NVL(USER_NO, 0)) + 1 AS NEXT_NO FROM GRAINFAS.USERS',
    'SELECT NVL(MAX(USER_NO), 0) + 1 AS NEXT_NO FROM GRAINFAS.USERS',
    'SELECT MAX(NVL(USER_NO, 0)) + 1 AS NEXT_NO FROM USERS',
    'SELECT NVL(MAX(TO_NUMBER(TRIM(TO_CHAR(USER_NO)))), 0) + 1 AS NEXT_NO FROM GRAINFAS.USERS',
  ];
  let lastErr;
  for (const sql of grainfasAttempts) {
    try {
      const rows = await runQuery(sql, {}, null, { suppressDbErrorLog: true });
      const next = Math.trunc(Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 0) || 0);
      if (next > 0) {
        const maxNo = next - 1;
        return {
          next_no: next,
          NEXT_NO: next,
          max_no: maxNo,
          MAX_NO: maxNo,
          source: 'GRAINFAS.USERS',
        };
      }
    } catch (err) {
      lastErr = err;
      if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) throw err;
    }
  }
  try {
    const { rows, table } = await runUsersHubQuery(
      `SELECT NVL(MAX(USER_NO), 0) + 1 AS NEXT_NO FROM {TABLE}`
    );
    const next = Math.trunc(Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 0) || 0);
    if (next > 0) {
      const maxNo = next - 1;
      return {
        next_no: next,
        NEXT_NO: next,
        max_no: maxNo,
        MAX_NO: maxNo,
        source: table || preferredUsersHubTable,
      };
    }
  } catch (err) {
    lastErr = err;
  }
  throw lastErr || new Error('Could not read next USER_NO from GRAINFAS.USERS');
}

function buildUserMasterBinds(body) {
  const user_no = normalizeUserMasterNo(body.user_no ?? body.USER_NO);
  /** Target login name — never use body.user_name (logged-in actor). */
  const user_name = normalizeUserMasterName(
    body.USER_NAME ?? body.record_user_name ?? body.target_user_name ?? body.login_name
  );
  if (!user_name) {
    const err = new Error('User name is required.');
    err.status = 400;
    throw err;
  }
  const mods = {};
  for (let i = 1; i <= 13; i++) {
    const k = `F${i}`;
    mods[k] = normalizeRights4(body[k] ?? body[k.toLowerCase()]);
  }
  const fDateRaw = body.f_date ?? body.F_DATE ?? '';
  const fDateParsed = parseDateOnly(fDateRaw);
  return {
    user_no,
    user_name,
    pw: normalizeUserMasterPassword(body.pw ?? body.PW ?? ''),
    reset_password: (() => {
      const r = body.reset_password ?? body.RESET_PASSWORD;
      if (typeof r === 'string') return r.trim().toUpperCase() === 'Y';
      return Boolean(r);
    })(),
    supervisor: normalizeYnField(body.supervisor ?? body.SUPERVISOR) || 'N',
    comp_code: String(body.comp_code ?? body.COMP_CODE ?? '').trim().toUpperCase(),
    f_days: String(body.f_days ?? body.F_DAYS ?? '').trim(),
    f_date: fDateParsed ? fDateParsed : null,
    f_date_ymd: fDateParsed
      ? `${fDateParsed.getFullYear()}-${String(fDateParsed.getMonth() + 1).padStart(2, '0')}-${String(fDateParsed.getDate()).padStart(2, '0')}`
      : '',
    r_c_no: String(body.r_c_no ?? body.R_C_NO ?? '').trim(),
    s_r_c_no: String(body.s_r_c_no ?? body.S_R_C_NO ?? '').trim(),
    e_r_c_no: String(body.e_r_c_no ?? body.E_R_C_NO ?? '').trim(),
    trial_access: normalizeYnField(body.trial_access ?? body.TRIAL_ACCESS) || 'N',
    bs_access: normalizeYnField(body.bs_access ?? body.BS_ACCESS) || 'N',
    ibl_payment: normalizeYnField(body.ibl_payment ?? body.IBL_PAYMENT) || 'N',
    ibl_payment_limit: String(body.ibl_payment_limit ?? body.IBL_PAYMENT_LIMIT ?? '').trim(),
    ...mods,
  };
}

function isUserMasterSqlRetryableError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('00904') ||
    msg.includes('01036') ||
    /invalid identifier/i.test(msg) ||
    /unrecognized bind variable/i.test(msg) ||
    isLoginOptionalTableError(err)
  );
}

function buildUserMasterSqlBinds(binds, { includePw = true } = {}) {
  const core = {
    user_no: binds.user_no,
    user_name: binds.user_name,
    supervisor: binds.supervisor,
    comp_code: binds.comp_code,
    f1: binds.F1,
    f2: binds.F2,
    f3: binds.F3,
    f4: binds.F4,
    f5: binds.F5,
    f6: binds.F6,
    f7: binds.F7,
    f8: binds.F8,
    f9: binds.F9,
    f10: binds.F10,
    f11: binds.F11,
    f12: binds.F12,
    f13: binds.F13,
  };
  if (includePw) core.pw = binds.pw || normalizeUserMasterPassword(binds.user_name);
  return core;
}

async function insertUserMasterRow(binds, tableHint) {
  if (!tableHint && !preferredUsersHubTable) await detectPreferredUsersHubTable();
  const tables = usersHubTableOrder(tableHint);
  const coreBinds = buildUserMasterSqlBinds(binds, { includePw: true });
  const fullBinds = {
    ...coreBinds,
    f_days: binds.f_days,
    f_date_ymd: binds.f_date_ymd,
    f_date_ymd2: binds.f_date_ymd,
    r_c_no: binds.r_c_no,
    s_r_c_no: binds.s_r_c_no,
    e_r_c_no: binds.e_r_c_no,
    trial_access: binds.trial_access,
    bs_access: binds.bs_access,
    ibl_payment: binds.ibl_payment,
    ibl_payment_limit: binds.ibl_payment_limit,
  };
  const attempts = [
    {
      sql: `INSERT INTO {TABLE} (USER_NO, USER_NAME, PW, F1,F2,F3,F4,F5,F6,F7,F8,F9,F10,F11,F12,F13, SUPERVISOR, COMP_CODE)
       VALUES (:user_no, :user_name, :pw, :f1,:f2,:f3,:f4,:f5,:f6,:f7,:f8,:f9,:f10,:f11,:f12,:f13, :supervisor, :comp_code)`,
      binds: coreBinds,
    },
    {
      sql: `INSERT INTO {TABLE} (
        USER_NO, USER_NAME, PW, F1,F2,F3,F4,F5,F6,F7,F8,F9,F10,F11,F12,F13,
        SUPERVISOR, F_DATE, COMP_CODE, F_DAYS, R_C_NO, S_R_C_NO, E_R_C_NO,
        TRIAL_ACCESS, BS_ACCESS, IBL_PAYMENT, IBL_PAYMENT_LIMIT
      ) VALUES (
        :user_no, :user_name, :pw, :f1,:f2,:f3,:f4,:f5,:f6,:f7,:f8,:f9,:f10,:f11,:f12,:f13,
        :supervisor,
        CASE WHEN :f_date_ymd IS NULL OR :f_date_ymd = '' THEN NULL ELSE TO_DATE(:f_date_ymd2, 'YYYY-MM-DD') END,
        :comp_code, :f_days, :r_c_no, :s_r_c_no, :e_r_c_no,
        :trial_access, :bs_access, :ibl_payment, :ibl_payment_limit
      )`,
      binds: fullBinds,
    },
  ];
  let lastErr;
  for (const t of tables) {
    for (const { sql, binds: b } of attempts) {
      try {
        await runQuery(sql.replace(/\{TABLE\}/g, t), b, null, { autoCommit: true });
        const verify = await runUsersHubQuery(
          `SELECT USER_NO FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
          { user_no: binds.user_no },
          t
        );
        if (!verify.rows?.length) {
          throw new Error(`Insert into ${t} did not persist (USER_NO ${binds.user_no}).`);
        }
        preferredUsersHubTable = t;
        return t;
      } catch (err) {
        lastErr = err;
        if (!isUserMasterSqlRetryableError(err)) throw err;
      }
    }
  }
  throw lastErr || new Error('USERS insert failed');
}

async function updateUserMasterRow(binds, tableHint) {
  if (!tableHint && !preferredUsersHubTable) await detectPreferredUsersHubTable();
  const tables = usersHubTableOrder(tableHint);
  const coreBinds = buildUserMasterSqlBinds(binds, { includePw: false });
  const fullBinds = {
    ...coreBinds,
    f_days: binds.f_days,
    f_date_ymd: binds.f_date_ymd,
    f_date_ymd2: binds.f_date_ymd,
    r_c_no: binds.r_c_no,
    s_r_c_no: binds.s_r_c_no,
    e_r_c_no: binds.e_r_c_no,
    trial_access: binds.trial_access,
    bs_access: binds.bs_access,
    ibl_payment: binds.ibl_payment,
    ibl_payment_limit: binds.ibl_payment_limit,
  };
  const attempts = [
    {
      sql: `UPDATE {TABLE} SET USER_NAME = :user_name,
        F1=:f1,F2=:f2,F3=:f3,F4=:f4,F5=:f5,F6=:f6,F7=:f7,F8=:f8,F9=:f9,F10=:f10,F11=:f11,F12=:f12,F13=:f13,
        SUPERVISOR=:supervisor, COMP_CODE=:comp_code
       WHERE USER_NO = :user_no`,
      binds: coreBinds,
    },
    {
      sql: `UPDATE {TABLE} SET USER_NAME = :user_name,
        F1=:f1,F2=:f2,F3=:f3,F4=:f4,F5=:f5,F6=:f6,F7=:f7,F8=:f8,F9=:f9,F10=:f10,F11=:f11,F12=:f12,F13=:f13,
        SUPERVISOR=:supervisor, COMP_CODE=:comp_code, F_DAYS=:f_days,
        F_DATE = CASE WHEN :f_date_ymd IS NULL OR :f_date_ymd = '' THEN NULL ELSE TO_DATE(:f_date_ymd2, 'YYYY-MM-DD') END,
        R_C_NO=:r_c_no, S_R_C_NO=:s_r_c_no, E_R_C_NO=:e_r_c_no,
        TRIAL_ACCESS=:trial_access, BS_ACCESS=:bs_access, IBL_PAYMENT=:ibl_payment, IBL_PAYMENT_LIMIT=:ibl_payment_limit
       WHERE USER_NO = :user_no`,
      binds: fullBinds,
    },
  ];
  let lastErr;
  for (const t of tables) {
    for (const { sql, binds: b } of attempts) {
      try {
        const rowsBefore = await runUsersHubQuery(
          `SELECT USER_NO FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
          { user_no: binds.user_no },
          t
        );
        if (!rowsBefore.rows?.length) continue;

        await runQuery(sql.replace(/\{TABLE\}/g, t), b, null, { autoCommit: true });
        if (binds.reset_password) {
          await runQuery(
            `UPDATE ${t} SET PW = '' WHERE USER_NO = :user_no`,
            { user_no: binds.user_no },
            null,
            { autoCommit: true }
          ).catch(() => {});
        } else if (binds.pw) {
          await runQuery(
            `UPDATE ${t} SET PW = :pw WHERE USER_NO = :user_no`,
            { user_no: binds.user_no, pw: binds.pw },
            null,
            { autoCommit: true }
          ).catch(() => {});
        }
        preferredUsersHubTable = t;
        return t;
      } catch (err) {
        lastErr = err;
        if (!isUserMasterSqlRetryableError(err)) throw err;
      }
    }
  }
  throw lastErr || new Error('USERS update failed — user not found in hub table.');
}

async function deleteUserMasterByNo(userNo, tableHint) {
  const no = normalizeUserMasterNo(userNo);
  if (!no) {
    const err = new Error('user_no is required');
    err.status = 400;
    throw err;
  }
  await detectPreferredUsersHubTable();
  const tables = usersHubTableOrder(tableHint);
  let foundTable = null;
  let lastErr;
  for (const t of tables) {
    try {
      const { rows } = await runUsersHubQuery(
        `SELECT USER_NO FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
        { user_no: no },
        t
      );
      if (rows?.length) {
        foundTable = t;
        break;
      }
    } catch (err) {
      lastErr = err;
      if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) throw err;
    }
  }
  if (!foundTable) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }
  try {
    await runQuery(
      `DELETE FROM ${foundTable} WHERE USER_NO = :user_no`,
      { user_no: no },
      null,
      { autoCommit: true }
    );
    const verify = await runUsersHubQuery(
      `SELECT USER_NO FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
      { user_no: no },
      foundTable
    );
    if (verify.rows?.length) {
      throw new Error(`Delete from ${foundTable} did not remove USER_NO ${no}.`);
    }
    preferredUsersHubTable = foundTable;
    return foundTable;
  } catch (err) {
    lastErr = err;
    if (!isLoginOptionalTableError(err)) throw err;
  }
  throw lastErr || new Error('USERS delete failed');
}

async function fetchUserMasterByName(userName) {
  const name = normalizeUserMasterName(userName);
  if (!name) return null;
  const { rows } = await runUsersHubQuery(
    `SELECT USER_NO, USER_NAME, SUPERVISOR, COMP_CODE FROM {TABLE}
     WHERE UPPER(TRIM(USER_NAME)) = :user_name AND ROWNUM = 1`,
    { user_name: name }
  );
  return rows.length ? mapUserMasterRow(rows[0]) : null;
}

async function verifyUserHubCurrentPassword(userNo, userName, oldPw) {
  const no = normalizeUserMasterNo(userNo);
  const name = normalizeUserMasterName(userName);
  const old = normalizeUserMasterPassword(oldPw);
  if (!no || !name) {
    const err = new Error('User number and user name are required.');
    err.status = 400;
    throw err;
  }
  if (!old) {
    const err = new Error('Old password is required.');
    err.status = 400;
    throw err;
  }

  await detectPreferredUsersHubTable();
  const tables = usersHubTableOrder();
  let lastErr;
  for (const t of tables) {
    try {
      const { rows } = await runUsersHubQuery(
        `SELECT PW FROM {TABLE}
         WHERE USER_NO = :user_no AND UPPER(TRIM(USER_NAME)) = :user_name AND ROWNUM = 1`,
        { user_no: no, user_name: name },
        t
      );
      if (!rows?.length) continue;
      const stored = normalizeUserMasterPassword(rows[0].PW ?? rows[0].pw);
      if (stored !== old) {
        const err = new Error('Old password is incorrect.');
        err.status = 400;
        throw err;
      }
      return t;
    } catch (err) {
      if (err.status === 400) throw err;
      lastErr = err;
      if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) throw err;
    }
  }
  const err = new Error('User not found or old password could not be verified.');
  err.status = 404;
  throw lastErr && lastErr.status ? lastErr : err;
}

async function updateUserPasswordRow(userNo, userName, pw) {
  const no = normalizeUserMasterNo(userNo);
  const name = normalizeUserMasterName(userName);
  if (!no || !name) {
    const err = new Error('User number and user name are required.');
    err.status = 400;
    throw err;
  }
  const password = normalizeUserMasterPassword(pw);
  if (!password) {
    const err = new Error('Password is required.');
    err.status = 400;
    throw err;
  }

  await detectPreferredUsersHubTable();
  const tables = usersHubTableOrder();
  let lastErr;
  for (const t of tables) {
    try {
      const { rows } = await runUsersHubQuery(
        `SELECT USER_NO, USER_NAME FROM {TABLE}
         WHERE USER_NO = :user_no AND UPPER(TRIM(USER_NAME)) = :user_name AND ROWNUM = 1`,
        { user_no: no, user_name: name },
        t
      );
      if (!rows?.length) continue;
      await runQuery(
        `UPDATE ${t} SET PW = :pw WHERE USER_NO = :user_no`,
        { user_no: no, pw: password },
        null,
        { autoCommit: true }
      );
      preferredUsersHubTable = t;
      return t;
    } catch (err) {
      lastErr = err;
      if (!isLoginOptionalTableError(err) && !isUnknownUsersColumnError(err)) throw err;
    }
  }
  const err = new Error('User not found or password could not be updated.');
  err.status = 404;
  throw err;
}

app.get('/api/user-master-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(String(user_name), comp_uid);
    res.json(perms);
  } catch (err) {
    console.error('❌ user-master-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** VFP user.scx — verify COMPANY.COMP_P_D before opening User Master. */
app.post('/api/user-master-verify-admin-password', async (req, res) => {
  try {
    const comp_code = resolveUserMasterCompCode(req);
    const password = req.body?.password ?? req.body?.apw ?? '';
    const ok = await verifyCompanyAdminPassword(password, comp_code);
    if (!ok) {
      return res.status(403).json({ error: 'Invalid Passowrd' });
    }
    const token = issueUserMasterAdminToken(comp_code);
    res.json({ ok: true, token, compCode: comp_code });
  } catch (err) {
    console.error('❌ user-master-verify-admin-password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** VFP DO FORM PASSWORD — same admin rights as User Master (Supervisor or Master F4 edit). */
app.get('/api/user-password-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(String(user_name), comp_uid);
    res.json(perms);
  } catch (err) {
    console.error('❌ user-password-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user-password', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_uid = body.comp_uid;
    const actor = String(body.actor_name ?? body.session_user ?? body.user_name ?? '').trim().toUpperCase();
    if (comp_uid == null || String(comp_uid).trim() === '' || !actor) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(actor, comp_uid);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const targetName = normalizeUserMasterName(
      body.USER_NAME ?? body.record_user_name ?? body.target_user_name
    );
    const userNo = normalizeUserMasterNo(body.user_no ?? body.USER_NO);
    const oldPw = normalizeUserMasterPassword(
      body.old_pw ?? body.OLD_PW ?? body.old_password
    );
    const pw = normalizeUserMasterPassword(body.pw ?? body.PW ?? body.new_password);
    const confirm = normalizeUserMasterPassword(
      body.confirm_pw ?? body.CONFIRM_PW ?? body.confirm_password
    );

    if (!targetName) return res.status(400).json({ error: 'User name is required.' });
    if (!oldPw) return res.status(400).json({ error: 'Old password is required.' });
    if (!pw) return res.status(400).json({ error: 'Password is required.' });
    if (pw === oldPw) {
      return res.status(400).json({ error: 'New password must be different from old password.' });
    }
    if (pw !== confirm) {
      return res.status(400).json({ error: 'Password and confirm password do not match.' });
    }

    let user = userNo ? await fetchUserMasterByNo(userNo) : null;
    if (user && String(user.USER_NAME || '').toUpperCase() !== targetName) {
      return res.status(400).json({ error: 'User number does not match user name.' });
    }
    if (!user) user = await fetchUserMasterByName(targetName);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await verifyUserHubCurrentPassword(user.USER_NO, user.USER_NAME, oldPw);
    await updateUserPasswordRow(user.USER_NO, user.USER_NAME, pw);
    res.json({
      ok: true,
      message: `Password updated for [${user.USER_NO}] ${user.USER_NAME}.`,
      USER_NO: user.USER_NO,
      USER_NAME: user.USER_NAME,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ user-password PUT error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/user-master-list', async (req, res) => {
  try {
    await assertUserMasterAdminAccess(req);
    const { q } = req.query;
    const rows = await fetchUserMasterList(q);
    res.json(rows || []);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ user-master-list error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/user-master-next-no', async (req, res) => {
  try {
    await assertUserMasterAdminAccess(req);
    const data = await fetchNextUserMasterNo();
    res.json(data);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ user-master-next-no error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/user-master-detail', async (req, res) => {
  try {
    await assertUserMasterAdminAccess(req);
    const userNo = normalizeUserMasterNo(req.query.user_no ?? req.query.USER_NO);
    if (!userNo) return res.status(400).json({ error: 'user_no is required' });
    const row = await fetchUserMasterByNo(userNo);
    if (!row) return res.status(404).json({ error: 'User not found.' });
    res.json(row);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ user-master-detail error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/user-master', async (req, res) => {
  try {
    await assertUserMasterAdminAccess(req);
    const body = req.body || {};
    const comp_uid = body.comp_uid;
    const actor = String(body.actor_name ?? body.session_user ?? body.user_name ?? '').trim().toUpperCase();
    if (comp_uid == null || String(comp_uid).trim() === '' || !actor) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(actor, comp_uid);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      binds = buildUserMasterBinds(body);
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    if (!binds.user_no) {
      const next = await fetchNextUserMasterNo();
      binds.user_no = Number(next.next_no ?? next.NEXT_NO ?? 0) || 0;
    }
    if (!binds.user_no) {
      return res.status(400).json({ error: 'User number is required.' });
    }

    await detectPreferredUsersHubTable();
    const dup = await runUsersHubQuery(
      `SELECT COUNT(*) AS CNT FROM {TABLE} WHERE USER_NO = :user_no AND ROWNUM = 1`,
      { user_no: binds.user_no }
    ).catch(() => ({ rows: [{ CNT: 0 }] }));
    const dupCnt = Number(dup.rows?.[0]?.CNT ?? dup.rows?.[0]?.cnt ?? 0);
    if (dupCnt > 0) return res.status(409).json({ error: 'User number already exists.' });

    const nameDup = await runUsersHubQuery(
      `SELECT COUNT(*) AS CNT FROM {TABLE} WHERE UPPER(TRIM(USER_NAME)) = :user_name AND ROWNUM = 1`,
      { user_name: binds.user_name }
    ).catch(() => ({ rows: [{ CNT: 0 }] }));
    const nameCnt = Number(nameDup.rows?.[0]?.CNT ?? nameDup.rows?.[0]?.cnt ?? 0);
    if (nameCnt > 0) return res.status(409).json({ error: 'User name already exists.' });

    const table = await insertUserMasterRow(binds);
    const saved = await fetchUserMasterByNo(binds.user_no, table);
    if (!saved) {
      return res.status(500).json({ error: 'User was saved but could not be reloaded. Refresh the list.' });
    }
    res.json({
      ok: true,
      message: `User [${saved.USER_NO}] ${saved.USER_NAME} created successfully.`,
      table,
      ...saved,
    });
  } catch (err) {
    console.error('❌ user-master POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user-master', async (req, res) => {
  try {
    await assertUserMasterAdminAccess(req);
    const body = req.body || {};
    const comp_uid = body.comp_uid;
    const actor = String(body.actor_name ?? body.session_user ?? body.user_name ?? '').trim().toUpperCase();
    if (comp_uid == null || String(comp_uid).trim() === '' || !actor) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const perms = await fetchUserMasterAdminPerms(actor, comp_uid);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    let binds;
    try {
      binds = buildUserMasterBinds(body);
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }
    if (!binds.user_no) return res.status(400).json({ error: 'user_no is required' });

    await detectPreferredUsersHubTable();
    const exists = await fetchUserMasterByNo(binds.user_no);
    if (!exists) return res.status(404).json({ error: 'User not found.' });

    const table = await updateUserMasterRow(binds);
    const saved = await fetchUserMasterByNo(binds.user_no, table);
    if (!saved) {
      return res.status(500).json({ error: 'User was updated but could not be reloaded. Refresh the list.' });
    }
    res.json({
      ok: true,
      message: `User [${saved.USER_NO}] ${saved.USER_NAME} updated successfully.`,
      table,
      ...saved,
    });
  } catch (err) {
    console.error('❌ user-master PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/user-master', async (req, res) => {
  try {
    await assertUserMasterAdminAccess(req);
    const body = req.body || {};
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const actor = String(body.user_name ?? req.query.user_name ?? '').trim().toUpperCase();
    const userNo = normalizeUserMasterNo(body.user_no ?? body.USER_NO ?? req.query.user_no);
    if (comp_uid == null || String(comp_uid).trim() === '' || !actor || !userNo) {
      return res.status(400).json({ error: 'comp_uid, user_name, and user_no are required' });
    }
    const perms = await fetchUserMasterAdminPerms(actor, comp_uid);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const target = await fetchUserMasterByNo(userNo);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (String(target.USER_NAME || '').toUpperCase() === actor) {
      return res.status(409).json({ error: 'You cannot delete your own user record.' });
    }

    await detectPreferredUsersHubTable();
    await deleteUserMasterByNo(userNo);
    res.json({
      ok: true,
      message: `User [${userNo}] ${target.USER_NAME} deleted successfully.`,
      user_no: userNo,
      USER_NO: userNo,
      USER_NAME: target.USER_NAME,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('❌ user-master DELETE error:', err.message);
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/item-master-user-permissions', async (req, res) => {
  try {
    const { comp_uid, user_name } = req.query;
    if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_uid and user_name are required' });
    }
    const { f5, source } = await fetchItemMasterUserF5String(String(user_name), comp_uid);
    res.json({ f5, source, ...itemMasterPermissionsFromF5(f5) });
  } catch (err) {
    console.error('❌ item-master-user-permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item-master-lookups', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const saleSched = 12.1;
    const purchaseSched = 14.1;
    const accountSql = `
      SELECT M.CODE, M.NAME
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code
        AND ROUND(NVL(M.SCHEDULE, 0), 2) IN (:sale_sched, :purchase_sched)
      ORDER BY M.NAME, M.CODE`;
    const [cats, itemGroups, accountRows] = await Promise.all([
      fetchItemMasterCatRows(comp_code, comp_uid),
      fetchItemMasterItemGrpRows(comp_code, comp_uid),
      runQuery(accountSql, { comp_code, sale_sched: saleSched, purchase_sched: purchaseSched }, comp_uid).catch(() => []),
    ]);
    const mergedAccounts = Array.isArray(accountRows) ? accountRows : [];
    res.json({
      cats: cats || [],
      itemGroups: itemGroups || [],
      saleAccounts: mergedAccounts,
      purchaseAccounts: mergedAccounts,
    });
  } catch (err) {
    console.error('❌ item-master-lookups error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item-master-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, q } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const rows = await fetchItemMasterList(comp_code, comp_uid, q);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ item-master-list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item-master-next-code', async (req, res) => {
  try {
    const { comp_code, comp_uid } = req.query;
    if (!comp_code || comp_uid == null) {
      return res.status(400).json({ error: 'comp_code and comp_uid are required' });
    }
    const data = await fetchNextItemMasterCode(comp_code, comp_uid);
    res.json(data);
  } catch (err) {
    console.error('❌ item-master-next-code error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/item-master', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canAdd) return res.status(403).json({ error: 'You Can Not Add' });

    let binds;
    try {
      const autoCode = await fetchNextItemMasterCode(comp_code, comp_uid);
      const itemCode = trimItemMasterField(body.item_code ?? body.ITEM_CODE, 13) || autoCode.next_code;
      binds = buildItemMasterInsertBinds(body, { comp_code, comp_year, user_name, itemCode });
      await validateItemMasterSaveFields(comp_code, comp_uid, binds);
      if (binds.u_item_code) {
        const udup = await runQuery(
          `SELECT COUNT(*) AS CNT FROM ITEMMAST WHERE COMP_CODE = :comp_code AND U_ITEM_CODE = :u_item_code`,
          { comp_code, u_item_code: binds.u_item_code },
          comp_uid
        );
        const ucnt = Number(udup?.[0]?.CNT ?? udup?.[0]?.cnt ?? 0);
        if (ucnt > 0) return res.status(409).json({ error: 'Udaan Item Code Already Entered' });
      }
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    const dup = await runQuery(
      `SELECT COUNT(*) AS CNT FROM ITEMMAST
       WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND ROWNUM = 1`,
      { comp_code, item_code: binds.item_code },
      comp_uid
    );
    const dupCnt = Number(dup?.[0]?.CNT ?? dup?.[0]?.cnt ?? 0);
    if (dupCnt > 0) {
      return res.status(409).json({ error: `Item code ${binds.item_code} already exists.` });
    }

    await insertItemMasterRow(binds, comp_uid);
    res.json(itemMasterSavedJson(binds));
  } catch (err) {
    console.error('❌ item-master POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/item-master', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? '').trim();
    const comp_uid = body.comp_uid;
    const user_name = String(body.user_name ?? '').trim();
    const comp_year = Number(body.comp_year ?? body.compYear ?? 0) || 0;
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, comp_year, and user_name are required' });
    }
    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canEdit) return res.status(403).json({ error: 'You Can Not Edit' });

    const itemCode = trimItemMasterField(body.item_code ?? body.ITEM_CODE, 13);
    if (!itemCode) return res.status(400).json({ error: 'item_code is required for edit' });

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM ITEMMAST
       WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND ROWNUM = 1`,
      { comp_code, item_code: itemCode },
      comp_uid
    );
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Item code ${itemCode} not found.` });
    }

    let binds;
    try {
      binds = buildItemMasterInsertBinds(body, { comp_code, comp_year, user_name, itemCode });
      await validateItemMasterSaveFields(comp_code, comp_uid, binds);
    } catch (buildErr) {
      return res.status(buildErr.status || 400).json({ error: buildErr.message });
    }

    await deleteItemMasterByCode(comp_code, itemCode, comp_uid);
    await insertItemMasterRow(binds, comp_uid);
    res.json(itemMasterSavedJson(binds));
  } catch (err) {
    console.error('❌ item-master PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/item-master', async (req, res) => {
  try {
    const body = req.body || {};
    const comp_code = String(body.comp_code ?? req.query.comp_code ?? '').trim();
    const comp_uid = body.comp_uid ?? req.query.comp_uid;
    const user_name = String(body.user_name ?? req.query.user_name ?? '').trim();
    const itemCode = trimItemMasterField(body.item_code ?? body.ITEM_CODE ?? req.query.item_code, 13);
    if (!comp_code || comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
      return res.status(400).json({ error: 'comp_code, comp_uid, and user_name are required' });
    }
    if (!itemCode) return res.status(400).json({ error: 'item_code is required' });

    const { f5 } = await fetchItemMasterUserF5String(user_name, comp_uid);
    const perms = itemMasterPermissionsFromF5(f5);
    if (!perms.canOpen) return res.status(403).json({ error: 'Access Denied' });
    if (!perms.canDelete) return res.status(403).json({ error: 'You Can Not Delete' });

    const exists = await runQuery(
      `SELECT COUNT(*) AS CNT FROM ITEMMAST
       WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code AND ROWNUM = 1`,
      { comp_code, item_code: itemCode },
      comp_uid
    );
    const existsCnt = Number(exists?.[0]?.CNT ?? exists?.[0]?.cnt ?? 0);
    if (existsCnt < 1) {
      return res.status(404).json({ error: `Item code ${itemCode} not found.` });
    }

    const stockCnt = await countItemStockEntries(comp_code, itemCode, comp_uid);
    if (stockCnt > 0) {
      return res.status(409).json({ error: 'Entries Already Exist' });
    }

    await runQuery(
      `DELETE FROM BARDSTOCK WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = 'OP' AND VR_NO = :vr_no`,
      { comp_code, vr_no: itemCode },
      comp_uid,
      { autoCommit: true, suppressDbErrorLog: true }
    ).catch(() => {});
    await deleteItemMasterByCode(comp_code, itemCode, comp_uid);
    res.json({ ok: true, item_code: itemCode, ITEM_CODE: itemCode });
  } catch (err) {
    console.error('❌ item-master DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

resolveActiveDbConfig()
  .then((cfg) => {
    activeDbConfig = cfg;
    const server = app.listen(PORT, () => {
      console.log(`🚀 API server on port ${PORT}`);
      console.log(`   Oracle hub (before year schema): ${maskOracleLog(activeDbConfig)}`);
      if (!GRAIN_ORACLE_HUB_ENABLED) {
        console.log('   oracle.grainHubEnabled: false — GRAIN Oracle hub is disabled for this install.');
      }
      if (REQUIRE_GRAIN_HUB) {
        console.log(
          '   oracle.requireGrainHub: true — if DBA_USERS shows GRAIN exists, GRAIN/GRAIN@XE must succeed (no fallback).'
        );
      }
      console.log(
        '   Reports: /api/salelist-*, /api/stock-sum, /api/stock-sum-detail, /api/stocklot-*, /api/stock-lot, /api/sale-bill-print, /api/purchase-bill-print'
      );
      console.log(`✅ Ready for iPhone connections via Cloudflare Tunnel`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `❌ Port ${PORT} is already in use (another process, often node.exe). Options:\n` +
            `   • Free the port: Task Manager → Details → end the other node.exe, or (Admin) taskkill /PID <pid> /F\n` +
            `   • Use another port:  $env:PORT=5002; node server.cjs   (then point the app / tunnel to that port)`
        );
        process.exit(1);
        return;
      }
      console.error(err);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('❌ Oracle startup failed:', err.message);
    process.exit(1);
  });