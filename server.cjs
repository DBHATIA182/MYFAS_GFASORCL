const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');
const oracledb = require('oracledb');
const cors = require('cors');
const connectionConfig = require('./connection.config.json');
const app = express();

/** Default 5001; override when busy: PowerShell `$env:PORT=5002; node server.cjs` */
const PORT = Number(process.env.PORT) || 5001;

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
const configuredClientName = connectionConfig.clientName || connectionConfig.defaultClientKey || '';
const autoWebOrigin = configuredClientName ? `https://${configuredClientName}.${rootDomain}` : null;
const configuredClientOrigins = Object.values(connectionConfig.clients || {})
  .map((client) => client.webOrigin)
  .filter(Boolean);
const allowedOrigins = Array.from(
  new Set([localOrigin, autoWebOrigin, ...configuredClientOrigins].filter(Boolean))
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return parsed.hostname === rootDomain || parsed.hostname.endsWith(`.${rootDomain}`);
  } catch (_) {
    return false;
  }
}

// --- 2. UPDATED CORS ---
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, origin || true);
    return callback(new Error(`CORS blocked for origin: ${origin || 'unknown'}`));
  },
  credentials: true
}));

app.use(express.json());

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

/**
 * App login: USERS / GRAIN.USERS (matches SQL*Plus GRAIN.USERS while connected as GRAINFAS if grants allow),
 * then USERNAME column variant for older tables.
 */
async function lookupAppLoginRows(connCfg, user_name, pw) {
  const binds = { u: user_name, p: pw };
  const predStd = `UPPER(TRIM(USER_NAME)) = UPPER(TRIM(:u)) AND UPPER(TRIM(PW)) = UPPER(TRIM(:p))`;
  const tablesStd = ['USERS', 'GRAIN.USERS'];
  for (const t of tablesStd) {
    try {
      const sql = `SELECT USER_NAME, PW FROM ${t} WHERE ${predStd}`;
      const rows = await runQuery(sql, binds, null, { hubOverride: connCfg, suppressDbErrorLog: true });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
    }
  }

  const predAlt = `UPPER(TRIM(USERNAME)) = UPPER(TRIM(:u)) AND UPPER(TRIM(PW)) = UPPER(TRIM(:p))`;
  const tablesAlt = ['USERS', 'GRAIN.USERS'];
  for (const t of tablesAlt) {
    try {
      const sql = `SELECT USERNAME AS USER_NAME, PW FROM ${t} WHERE ${predAlt}`;
      const rows = await runQuery(sql, binds, null, { hubOverride: connCfg, suppressDbErrorLog: true });
      if (Array.isArray(rows) && rows.length > 0) return rows;
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
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
  const tables = ['USERS', 'GRAIN.USERS'];

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
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
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
        A.QNTY,
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
                   WHEN a.code IS NULL AND b.schedule IS NOT NULL THEN 'TOTAL SCHEDULE ' || b.schedule
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
    const { comp_code, code, s_date, e_date, comp_uid } = req.query;

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
        FROM OP, MASTER B
        WHERE B.COMP_CODE = :comp_code
          AND B.CODE = :code
        UNION ALL
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT, A.DC_CODE, NULL AS DC_NAME
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
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
        FROM OP, MASTER B
        WHERE B.COMP_CODE = :comp_code
          AND B.CODE = :code
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
        FROM LEDGER A, MASTER B
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
          AND A.COMP_CODE = B.COMP_CODE
          AND A.CODE = B.CODE
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
          AND A.CODE = B.CODE
          AND A.COMP_CODE = :comp_code
          AND A.CODE = :code
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
      SELECT *
      FROM (
        SELECT
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
    const it = item_code != null ? String(item_code).trim() : '';

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
        ${it ? 'AND TRIM(TO_CHAR(A.ITEM_CODE)) = TRIM(:item_code)' : ''}
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;

    const binds = { comp_code, s_date, e_date };
    if (m) binds.mcode = m;
    if (b) binds.bk_code = b;
    if (it) binds.item_code = it;

    const rows = await runQuery(sql, binds, comp_uid);
    res.json(rows);
  } catch (err) {
    console.error('❌ Sale list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sale Bill Printing list (header-level rows) for one TYPE: SL / SE / CN.
 * Optional filters: bill_no, b_type, bill_date, mcode (party code).
 */
app.get('/api/sale-bill-printing-list', async (req, res) => {
  try {
    const { comp_code, comp_uid, type, bill_no, b_type, bill_date, mcode } = req.query;
    const t = String(type ?? '').trim().toUpperCase();
    if (!['SL', 'SE', 'CN'].includes(t)) {
      return res.status(400).json({ error: "type is required and must be one of 'SL', 'SE', 'CN'." });
    }
    const bn = bill_no != null ? String(bill_no).trim() : '';
    const bt = b_type != null ? String(b_type).trim() : '';
    const bd = bill_date != null ? String(bill_date).trim() : '';
    const m = mcode != null ? String(mcode).trim() : '';

    const sql = `
      SELECT
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY,
        MAX(NVL(A.BILL_AMT, 0)) AS BILL_AMT
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND UPPER(TRIM(A.TYPE)) = :type
        ${bn ? 'AND TRIM(TO_CHAR(A.BILL_NO)) = TRIM(:bill_no)' : ''}
        ${bt ? 'AND NVL(TRIM(A.B_TYPE), \' \') = NVL(TRIM(:b_type), \' \')' : ''}
        ${bd ? "AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))" : ''}
        ${m ? 'AND TRIM(A.CODE) = TRIM(:mcode)' : ''}
      GROUP BY
        A.TYPE,
        A.BILL_DATE,
        A.BILL_NO,
        A.B_TYPE,
        A.CODE,
        B.NAME,
        B.CITY
      ORDER BY A.BILL_DATE DESC, A.BILL_NO DESC, A.B_TYPE, A.CODE`;

    const binds = { comp_code, type: t };
    if (bn) binds.bill_no = bn;
    if (bt) binds.b_type = bt;
    if (bd) binds.bill_date = bd;
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
      SELECT god_print_in_sale, sale_logo, sale_logo2, signature_file
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

async function buildHsnSalesBaseRows({ comp_code, comp_uid, s_date, e_date, code }) {
  const codeFilter = hsnTxt(code);
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
      AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}`;

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
      AND TRUNC(A.SV_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}`;

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
      AND TRUNC(A.R_DATE) BETWEEN TRUNC(TO_DATE(:s_date,'DD-MM-YYYY')) AND TRUNC(TO_DATE(:e_date,'DD-MM-YYYY'))
      ${codeFilter ? 'AND TRIM(A.CODE) = TRIM(:code)' : ''}`;

  const binds = { comp_code, s_date, e_date };
  if (codeFilter) binds.code = codeFilter;
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

/** HSN Sales report with 3 tab views: date-wise, monthly hsn-wise, hsn-wise monthly. */
app.get('/api/hsn-sales', async (req, res) => {
  try {
    const { comp_code, comp_uid, s_date, e_date, m_r_u_c, schedule, code } = req.query;
    if (!comp_code || !comp_uid || !s_date || !e_date) {
      return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date are required' });
    }

    const base = await buildHsnSalesBaseRows({ comp_code, comp_uid, s_date, e_date, code });
    const filtered = applyHsnBaseFilters(base, { m_r_u_c, schedule });

    const dateWise = filtered
      .map(hsnRoundLineRow)
      .sort(
        (a, b) =>
          hsnTxt(a.BILL_DATE).localeCompare(hsnTxt(b.BILL_DATE), 'en', { numeric: true }) ||
          hsnTxt(a.BILL_NO).localeCompare(hsnTxt(b.BILL_NO), 'en', { numeric: true }) ||
          hsnTxt(a.B_TYPE).localeCompare(hsnTxt(b.B_TYPE), 'en', { numeric: true }) ||
          hsnTxt(a.ITEM_CODE).localeCompare(hsnTxt(b.ITEM_CODE), 'en', { numeric: true })
      );

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
        hsnTxt(a.MONTH_KEY).localeCompare(hsnTxt(b.MONTH_KEY), 'en', { numeric: true }) ||
        hsnTxt(a.HSN_CODE).localeCompare(hsnTxt(b.HSN_CODE), 'en', { numeric: true }) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );
    const hsnWiseMonthly = roundRows(Array.from(hsnMonthlyMap.values())).sort(
      (a, b) =>
        hsnTxt(a.HSN_CODE).localeCompare(hsnTxt(b.HSN_CODE), 'en', { numeric: true }) ||
        hsnTxt(a.MONTH_KEY).localeCompare(hsnTxt(b.MONTH_KEY), 'en', { numeric: true }) ||
        hsnNum(a.TAX_RATE) - hsnNum(b.TAX_RATE)
    );

    res.json({
      ok: true,
      sheets: {
        dateWise,
        monthlyHsnWise: monthlyHsnWise.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
        hsnWiseMonthly: hsnWiseMonthly.map(({ MONTH_KEY, ...x }) => ({ ...x, _MONTH_KEY: MONTH_KEY })),
      },
    });
  } catch (err) {
    console.error('❌ HSN sales error:', err.message);
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
    const base = await buildHsnSalesBaseRows({ comp_code, comp_uid, s_date, e_date, code });
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
          hsnTxt(a.BILL_DATE).localeCompare(hsnTxt(b.BILL_DATE), 'en', { numeric: true }) ||
          hsnTxt(a.BILL_NO).localeCompare(hsnTxt(b.BILL_NO), 'en', { numeric: true }) ||
          hsnTxt(a.B_TYPE).localeCompare(hsnTxt(b.B_TYPE), 'en', { numeric: true }) ||
          hsnTxt(a.ITEM_CODE).localeCompare(hsnTxt(b.ITEM_CODE), 'en', { numeric: true })
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
      const rowRate = gstrRate(gstrNum(r.CGST_PER) + gstrNum(r.SGST_PER) + gstrNum(r.IGST_PER));
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