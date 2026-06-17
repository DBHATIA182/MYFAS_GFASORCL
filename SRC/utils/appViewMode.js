/** True when the app is in Mobile View (Settings → Mobile, or startup Mobile choice). */
export function isAppMobileView() {
  if (typeof document === 'undefined') return false;
  return (
    document.querySelector('.app.app--mobile') != null ||
    document.body.classList.contains('force-mobile-view')
  );
}

/** True on phones/tablets (independent of desktop/mobile view toggle). */
export function isMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && window.matchMedia('(max-width: 900px)').matches) return true;
  return false;
}

/** New Year Books and similar admin utilities are desktop-only. */
export function isDesktopOnlyFrozen() {
  return isAppMobileView() || isMobileDevice();
}

export const DESKTOP_ONLY_UTILITY_MESSAGE =
  'New Year Books is available on desktop only. Open the app on a computer, or switch to Desktop View in Settings.';

export const PRIMARY_KEY_DESKTOP_ONLY_MESSAGE =
  'Primary Key rebuild is available on desktop only. Open the app on a computer, or switch to Desktop View in Settings.';

export const SET_FUNCTION_DESKTOP_ONLY_MESSAGE =
  'Set Function is available on desktop only. Open the app on a computer, or switch to Desktop View in Settings.';

export const TAKAJA_QUERY_DESKTOP_ONLY_MESSAGE =
  'Takaja Query is available on desktop only. Open the app on a computer, or switch to Desktop View in Settings.';

export const GENERIC_DESKTOP_ONLY_UTILITY_MESSAGE =
  'This utility is available on desktop only. Open the app on a computer, or switch to Desktop View in Settings.';

export const MOBILE_ONLY_UTILITY_MESSAGE =
  'This utility is available on mobile only. Open on a phone/tablet, or switch to Mobile View in Settings.';

export const GENERIC_MOBILE_ONLY_UTILITY_MESSAGE = MOBILE_ONLY_UTILITY_MESSAGE;

/** True when mobile-only utilities should be available (phone/tablet or Mobile View). */
export function isMobileOnlyAvailable() {
  return isDesktopOnlyFrozen();
}
