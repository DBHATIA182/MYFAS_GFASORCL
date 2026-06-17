import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { exitApp } from '../utils/exitApp';
import WindalInitialFlowCard from '../components/WindalInitialFlowCard';
import { GFAS_BRAND } from '../utils/gfasBrand';
import { formatLoginError } from '../utils/loginErrorMessage';
import { apiUrl, formatApiBaseForDisplay } from '../utils/resolveApiBase';

const MAX_LEN = 10;

function toHubUpper(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .slice(0, MAX_LEN);
}

export default function LoginSlide({ apiBase, onSuccess, onExit, settingsSlot = null }) {
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiReachable, setApiReachable] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await axios.get(apiUrl(apiBase, '/api/health'), { timeout: 3000 });
        if (!cancelled) setApiReachable(true);
      } catch {
        if (!cancelled) setApiReachable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const u = toHubUpper(userName);
    const p = toHubUpper(password);
    if (!u || !p) {
      setError('Enter user name and password.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.post(apiUrl(apiBase, '/api/login'), { user_name: u, pw: p }, { withCredentials: true, timeout: 60000 });
      if (data?.ok) {
        onSuccess({
          userName: data.user_name ?? u,
          comp_code: data.comp_code ?? data.COMP_CODE ?? '',
        });
      } else {
        setError('Login failed.');
      }
    } catch (err) {
      const detail = formatLoginError(err, apiBase);
      console.error('Login failed:', apiUrl(apiBase, '/api/login'), detail, err?.response?.data);
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="slide slide-login slide-windal-initial">
      <WindalInitialFlowCard
        variant="login"
        stepTitle="USER LOGIN"
        settingsSlot={settingsSlot}
        footer={GFAS_BRAND.footerNote}
      >
        <form onSubmit={handleSubmit}>
          {error ? (
            <div className="windal-initial-error" role="alert">
              <strong>Could not sign in.</strong> {error}
            </div>
          ) : null}
          <p className="windal-initial-api-hint">
            API: {formatApiBaseForDisplay(apiBase)}
            {apiReachable === true ? ' · reachable' : apiReachable === false ? ' · not reachable' : ''}
          </p>
          {apiReachable === false ? (
            <p className="windal-initial-api-hint windal-initial-api-hint--warn">
              API not reachable. On this PC run start-api.cmd (port 5002), npm run dev, and cloudflared. On phone open the same
              link as tunnel (e.g. demo.fasaccountingsoftware.in), not localhost.
            </p>
          ) : null}

          <label className="windal-initial-label" htmlFor="login-user">
            User Name
          </label>
          <div className="windal-initial-input-wrap">
            <input
              id="login-user"
              name="user_name"
              type="text"
              className="windal-initial-input"
              autoComplete="username"
              maxLength={MAX_LEN}
              value={userName}
              onChange={(e) => setUserName(toHubUpper(e.target.value))}
              disabled={loading}
            />
          </div>

          <label className="windal-initial-label" htmlFor="login-pw">
            Password
          </label>
          <div className="windal-initial-input-wrap">
            <input
              id="login-pw"
              name="pw"
              type={showPassword ? 'text' : 'password'}
              className="windal-initial-input windal-initial-input--pw"
              autoComplete="current-password"
              spellCheck={false}
              maxLength={MAX_LEN}
              value={password}
              onChange={(e) => setPassword(toHubUpper(e.target.value))}
              disabled={loading}
            />
            <button
              type="button"
              className="windal-initial-pw-toggle"
              onClick={() => setShowPassword((v) => !v)}
              disabled={loading}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>

          <div className="windal-initial-btn-row">
            <button
              type="button"
              className="windal-initial-btn windal-initial-btn--ghost"
              onClick={() => (onExit ? onExit() : exitApp())}
              disabled={loading}
            >
              Exit
            </button>
            <button type="submit" className="windal-initial-btn windal-initial-btn--primary" disabled={loading}>
              {loading ? 'Connecting…' : '→ Connect'}
            </button>
          </div>
        </form>
      </WindalInitialFlowCard>
    </div>
  );
}
