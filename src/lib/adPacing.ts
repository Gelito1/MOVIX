import { DEFAULT_AD_PACING, type AdPacingConfig, type AdPlacement } from '../types/adm';

/**
 * Client-side Ad Pacing & Cooldown Manager for MOVIX.
 *
 * Rules:
 * 1. The top banner (`placement === 'header'`) ALWAYS appears frequently and NEVER
 *    depends on any cooldown timer — exempt from all dismiss timers and intervals.
 * 2. ALL other ads (in-page banners, showcase cards, vertical/square cards, Hero
 *    sponsored slides, and player overlays) ALWAYS appear immediately when anyone
 *    enters the app.
 * 3. ONLY when the user manually closes/removes an ad does the configured
 *    `dismissCooldownMinutes` (default 30 min) activate, hiding non-header ads
 *    until that time expires.
 */

const STORAGE_KEY = 'movix:ad_pacing_state:v2';
const SESSION_PLAYER_KEY = 'movix:ad_player_session_ts:v1';
const PACING_EVENT = 'movix:ad-pacing-changed';

interface StoredPacingState {
  largeDismissedUntil: number;
}

const DEFAULT_STATE: StoredPacingState = {
  largeDismissedUntil: 0,
};

function readState(): StoredPacingState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<StoredPacingState>;
    return {
      largeDismissedUntil: Number(parsed.largeDismissedUntil) || 0,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(next: StoredPacingState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function readSessionPlayerLastShown(): number {
  if (typeof window === 'undefined') return 0;
  try {
    return Number(window.sessionStorage.getItem(SESSION_PLAYER_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSessionPlayerLastShown(ts: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_PLAYER_KEY, String(ts));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function emitPacingChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PACING_EVENT));
}

export function normalizeAdPacing(raw?: Partial<AdPacingConfig> | null): AdPacingConfig {
  if (!raw) return { ...DEFAULT_AD_PACING };
  return {
    dismissCooldownMinutes:
      typeof raw.dismissCooldownMinutes === 'number' && Number.isFinite(raw.dismissCooldownMinutes)
        ? Math.max(1, Math.min(1440, Math.round(raw.dismissCooldownMinutes)))
        : DEFAULT_AD_PACING.dismissCooldownMinutes,
    largeAdIntervalMinutes:
      typeof raw.largeAdIntervalMinutes === 'number' && Number.isFinite(raw.largeAdIntervalMinutes)
        ? Math.max(0, Math.min(1440, Math.round(raw.largeAdIntervalMinutes)))
        : DEFAULT_AD_PACING.largeAdIntervalMinutes,
    playerAdIntervalMinutes:
      typeof raw.playerAdIntervalMinutes === 'number' && Number.isFinite(raw.playerAdIntervalMinutes)
        ? Math.max(0, Math.min(1440, Math.round(raw.playerAdIntervalMinutes)))
        : DEFAULT_AD_PACING.playerAdIntervalMinutes,
    headerAdAlwaysVisible: true,
  };
}

/**
 * The top header strip ALWAYS appears frequently and never depends on time.
 */
export function isAlwaysVisibleHeaderAd(
  placement: AdPlacement | 'hero',
  _pacing?: AdPacingConfig
): boolean {
  return placement === 'header';
}

/**
 * Checks whether an ad slot is allowed to render right now.
 * - Top banner (`header`): ALWAYS allowed immediately, never depends on time.
 * - All other ads: ALWAYS allowed immediately upon entering the app, UNLESS the
 *   user manually removed/closed an ad and the configured cooldown is still active.
 */
export function checkLargeAdPermission(
  _slotId: string,
  placement: AdPlacement | 'hero',
  _pacing: AdPacingConfig
): { allowed: boolean; retryAfterMs: number } {
  if (placement === 'header') {
    return { allowed: true, retryAfterMs: 0 };
  }

  const now = Date.now();
  const state = readState();

  // Only wait when the user manually closed/removed an ad
  if (state.largeDismissedUntil > now) {
    return {
      allowed: false,
      retryAfterMs: Math.max(1000, state.largeDismissedUntil - now + 250),
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Retained for API compatibility; ads no longer auto-block future visits merely by being shown.
 */
export function recordLargeAdShown(
  _slotId: string,
  _placement: AdPlacement | 'hero',
  _pacing: AdPacingConfig
): void {
  // Intentionally no cooldown on passive impression — cooldown triggers ONLY on manual removal.
}

/**
 * Retained for API compatibility when ad slots unmount.
 */
export function releaseLargeAdWindow(_slotId: string): void {
  // No exclusive window lock — all ad placements show immediately upon entering the app.
}

/**
 * Called ONLY when the user manually clicks X (removes/closes) a non-header ad.
 * Hides non-header ads for `pacing.dismissCooldownMinutes` (default 30 min) across the app
 * while leaving the top banner (`header`) always visible and independent of time.
 */
export function dismissLargeAds(pacing: AdPacingConfig): number {
  const cooldownMs = Math.max(1, pacing.dismissCooldownMinutes) * 60_000;
  const until = Date.now() + cooldownMs;
  writeState({
    largeDismissedUntil: until,
  });
  emitPacingChanged();
  return until;
}

/**
 * Checks whether a video player overlay ad (pre-roll / mid-roll / post-roll) is allowed now.
 * Always appears when entering the app unless the user manually dismissed ads.
 */
export function checkPlayerAdPermission(pacing: AdPacingConfig): boolean {
  const now = Date.now();
  const state = readState();
  if (state.largeDismissedUntil > now) return false;
  if (pacing.playerAdIntervalMinutes <= 0) return true;
  const lastInSession = readSessionPlayerLastShown();
  const intervalMs = pacing.playerAdIntervalMinutes * 60_000;
  if (lastInSession > 0 && now - lastInSession < intervalMs) {
    return false;
  }
  return true;
}

/**
 * Records that a player overlay ad was shown in the current session.
 */
export function recordPlayerAdShown(): void {
  writeSessionPlayerLastShown(Date.now());
}

/**
 * Subscribes to cross-slot & cross-tab pacing changes (e.g. user dismissed a large ad).
 */
export function subscribeAdPacingChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onCustom = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener(PACING_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PACING_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
