import { emitAdmDataSync } from './admSync';
import { requestFcmDeviceToken, subscribeFcmForegroundMessages } from './firebase';
import { requestNotificationPermissionUniversal } from './onboarding';
import type { PushCategory, PushPrefs } from '../types/movix';

const STORAGE_TOKEN_KEY = 'movix:fcm_token:v1';
const STORAGE_PREFS_KEY = 'movix:push_prefs:v1';
const STORAGE_WELCOME_SHOWN_KEY = 'movix:welcome_native_shown:v1';
const STORAGE_LAST_SSE_TS_KEY = 'movix:push_sse_last_ts:v1';

export const WELCOME_NOTIFICATION_TITLE = 'Bem-vindo ao MOVIX 🎬';
export const WELCOME_NOTIFICATION_BODY =
  'Notificações ativadas! Vai receber avisos de novos filmes e séries.';

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  new_movies: true,
  new_seasons: true,
  app_updates: true,
  recommendations: true,
};

export interface FallbackNotificationDetail {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  targetUrl?: string;
  category?: PushCategory;
}

export const FALLBACK_NOTIFICATION_EVENT = 'movix:fallback-notification';

let foregroundInitialized = false;
let lastLocalWelcomeAt = 0;
let cachedSwRegPromise: Promise<ServiceWorkerRegistration | undefined> | null = null;
let activeEventSource: EventSource | null = null;
let sseReconnectTimer: number | null = null;
let sseActiveToken: string | null = null;
const deliveredCampaignIds = new Set<string>();

export function getSavedFcmToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveFcmToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function getSavedPushPrefs(): PushPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PUSH_PREFS };
    const parsed = JSON.parse(raw) as Partial<PushPrefs>;
    return {
      new_movies: typeof parsed.new_movies === 'boolean' ? parsed.new_movies : true,
      new_seasons: typeof parsed.new_seasons === 'boolean' ? parsed.new_seasons : true,
      app_updates: typeof parsed.app_updates === 'boolean' ? parsed.app_updates : true,
      recommendations: typeof parsed.recommendations === 'boolean' ? parsed.recommendations : true,
    };
  } catch {
    return { ...DEFAULT_PUSH_PREFS };
  }
}

function savePushPrefsLocal(prefs: PushPrefs): void {
  try {
    localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function hasShownWelcomeLocally(): boolean {
  try {
    return localStorage.getItem(STORAGE_WELCOME_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

function markWelcomeShownLocally(): void {
  lastLocalWelcomeAt = Date.now();
  try {
    localStorage.setItem(STORAGE_WELCOME_SHOWN_KEY, '1');
  } catch {
    // ignore
  }
}

export function resetWelcomeShownFlag(): void {
  try {
    localStorage.removeItem(STORAGE_WELCOME_SHOWN_KEY);
  } catch {
    // ignore
  }
}

function getLastSseTs(): number {
  try {
    const raw = localStorage.getItem(STORAGE_LAST_SSE_TS_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
  } catch {
    return Date.now();
  }
}

function saveLastSseTs(ts: number): void {
  try {
    localStorage.setItem(STORAGE_LAST_SSE_TS_KEY, String(ts));
  } catch {
    // ignore
  }
}

function getDeviceInfoLabel(): string {
  if (typeof navigator === 'undefined') return 'Web Browser';
  const ua = navigator.userAgent || '';
  const platform =
    /Android/i.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua)
        ? 'iOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Mac OS/i.test(ua)
            ? 'macOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Web';
  const isBrave = Boolean((navigator as Navigator & { brave?: unknown }).brave);
  const browser = isBrave
    ? 'Brave'
    : /SamsungBrowser\//i.test(ua)
      ? 'Samsung Internet'
      : /OPR\/|Opera/i.test(ua)
        ? 'Opera'
        : /EdgA?\/|Edge\//i.test(ua)
          ? 'Edge'
          : /HuaweiBrowser\//i.test(ua)
            ? 'Huawei Browser'
            : /FxiOS|Firefox\//i.test(ua)
              ? 'Firefox'
              : /CriOS|Chrome\//i.test(ua)
                ? 'Chrome'
                : /Safari\//i.test(ua)
                  ? 'Safari'
                  : 'Browser';
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return `${platform} · ${browser}${isStandalone ? ' (PWA)' : ''}`;
}

export function registerFcmServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(undefined);
  }
  if (!cachedSwRegPromise) {
    cachedSwRegPromise = (async () => {
      try {
        // 1. Register dedicated messaging SW (works in Chrome, Firefox, Edge, Opera, Samsung, Brave, Safari 16.4+)
        return await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
          scope: '/firebase-cloud-messaging-push-scope',
        });
      } catch {
        try {
          // 2. Fallback to root scope registration (better compatibility in some Firefox/Safari builds)
          return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        } catch {
          try {
            // 3. Fallback to any existing active PWA service worker registration
            const existing = await navigator.serviceWorker.getRegistration();
            return existing || undefined;
          } catch {
            return undefined;
          }
        }
      }
    })();
  }
  return cachedSwRegPromise;
}

async function waitForActiveSwRegistration(
  preferred?: ServiceWorkerRegistration
): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return undefined;
  }

  if (preferred?.active) return preferred;

  if (preferred) {
    const pending = preferred.installing || preferred.waiting;
    if (pending) {
      const activated = await new Promise<boolean>((resolve) => {
        const timeout = window.setTimeout(() => resolve(Boolean(preferred.active)), 2500);
        const onState = () => {
          if (pending.state === 'activated' || preferred.active) {
            window.clearTimeout(timeout);
            pending.removeEventListener('statechange', onState);
            resolve(true);
          } else if (pending.state === 'redundant') {
            window.clearTimeout(timeout);
            pending.removeEventListener('statechange', onState);
            resolve(false);
          }
        };
        pending.addEventListener('statechange', onState);
      });
      if (activated && preferred.active) return preferred;
    }
  }

  try {
    const ready = await Promise.race<ServiceWorkerRegistration | undefined>([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 2000)),
    ]);
    if (ready?.active) return ready;
  } catch {
    // fallback below
  }

  return undefined;
}

function dispatchFallbackNotificationEvent(params: {
  title: string;
  body: string;
  imageUrl?: string;
  targetUrl?: string;
  category?: PushCategory;
}): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const detail: FallbackNotificationDetail = {
      id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: params.title,
      body: params.body,
      imageUrl: params.imageUrl,
      targetUrl: params.targetUrl || '#/',
      category: params.category || 'new_movies',
    };
    window.dispatchEvent(new CustomEvent(FALLBACK_NOTIFICATION_EVENT, { detail }));
    return true;
  } catch {
    return false;
  }
}

export async function showNativeSystemNotification(params: {
  title: string;
  body: string;
  imageUrl?: string;
  targetUrl?: string;
  tag?: string;
  category?: PushCategory;
  swReg?: ServiceWorkerRegistration;
}): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  // Browsers without the Notification constructor (e.g. iOS Safari regular tab, in-app WebViews):
  // deliver cleanly via universal fallback banner so notifications still work in 100% of browsers.
  if (!('Notification' in window)) {
    return dispatchFallbackNotificationEvent(params);
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const tag = params.tag || (params.category ? `movix-${params.category}` : 'movix-push');
  const data = {
    target_url: params.targetUrl || '/',
    category: params.category || 'new_movies',
  };

  const richOptions: NotificationOptions & {
    vibrate?: number[];
    renotify?: boolean;
    image?: string;
    timestamp?: number;
  } = {
    body: params.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-badge-96x96.png',
    ...(params.imageUrl ? { image: params.imageUrl } : {}),
    vibrate: [140, 70, 140],
    silent: false,
    tag,
    renotify: true,
    timestamp: Date.now(),
    data,
  };

  const minimalOptions: NotificationOptions = {
    body: params.body,
    icon: '/pwa-192x192.png',
    tag,
    data,
  };

  // 1. Service Worker showNotification (required on Android Chrome, Firefox Mobile, Samsung Internet, Edge, Opera, iOS PWA)
  try {
    const preferred = params.swReg || (await registerFcmServiceWorker());
    const activeReg = await waitForActiveSwRegistration(preferred);
    if (activeReg?.showNotification) {
      try {
        await activeReg.showNotification(params.title, richOptions);
        return true;
      } catch {
        // Safari/Firefox may reject vibrate/renotify/image/badge — retry with universal minimal options
        try {
          await activeReg.showNotification(params.title, minimalOptions);
          return true;
        } catch {
          await activeReg.showNotification(params.title, { body: params.body });
          return true;
        }
      }
    }
  } catch {
    // Fallback to direct Notification constructor on desktop browsers without active SW
  }

  // 2. Direct Notification constructor (desktop Safari, Firefox, Brave, Opera, Chrome, Edge)
  try {
    const nativeNotif = new Notification(params.title, {
      body: params.body,
      icon: '/pwa-192x192.png',
      tag,
    });
    nativeNotif.onclick = () => {
      window.focus();
      if (params.targetUrl) {
        if (params.targetUrl.startsWith('#/')) {
          window.location.hash = params.targetUrl;
        } else if (params.targetUrl.startsWith('https://')) {
          window.location.assign(params.targetUrl);
        }
      }
      nativeNotif.close();
    };
    return true;
  } catch {
    try {
      const bareNotif = new Notification(params.title, { body: params.body });
      bareNotif.onclick = () => {
        window.focus();
        bareNotif.close();
      };
      return true;
    } catch {
      return dispatchFallbackNotificationEvent(params);
    }
  }
}

function handleIncomingRealtimeNotification(payload: {
  campaignId?: string;
  title: string;
  body: string;
  imageUrl?: string;
  targetUrl?: string;
  category?: PushCategory;
}): void {
  const category: PushCategory = payload.category || 'new_movies';

  // Deduplicate between FCM foreground & Universal SSE stream
  if (payload.campaignId) {
    if (deliveredCampaignIds.has(payload.campaignId)) return;
    deliveredCampaignIds.add(payload.campaignId);
    if (deliveredCampaignIds.size > 100) {
      const oldest = deliveredCampaignIds.values().next().value;
      if (oldest) deliveredCampaignIds.delete(oldest);
    }
  }

  if (category === 'welcome' && Date.now() - lastLocalWelcomeAt < 30_000) {
    return;
  }

  // Respect user category preferences
  if (category !== 'welcome') {
    const prefs = getSavedPushPrefs();
    if (!prefs[category]) return;
  }

  if (payload.title || payload.body) {
    void showNativeSystemNotification({
      title: payload.title || 'MOVIX',
      body: payload.body || '',
      imageUrl: payload.imageUrl,
      targetUrl: payload.targetUrl || '#/',
      tag: payload.campaignId ? `movix-${payload.campaignId}` : `movix-${category}`,
      category,
    });
  }
}

export function startUniversalPushStream(token: string): void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  if (!token) return;
  if (activeEventSource && sseActiveToken === token && activeEventSource.readyState !== EventSource.CLOSED) {
    return;
  }

  if (activeEventSource) {
    try {
      activeEventSource.close();
    } catch {
      // ignore
    }
    activeEventSource = null;
  }
  if (sseReconnectTimer) {
    window.clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }

  sseActiveToken = token;

  const connect = () => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const since = getLastSseTs();
    const url = `/api/push/stream?token=${encodeURIComponent(token)}&since=${encodeURIComponent(String(since))}`;
    try {
      const es = new EventSource(url);
      activeEventSource = es;

      es.addEventListener('notification', (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent).data) as {
            campaignId?: string;
            title?: string;
            body?: string;
            image_url?: string;
            target_url?: string;
            category?: PushCategory;
            createdAt?: string;
          };
          saveLastSseTs(Date.now());
          handleIncomingRealtimeNotification({
            campaignId: parsed.campaignId,
            title: parsed.title || 'MOVIX',
            body: parsed.body || '',
            imageUrl: parsed.image_url || undefined,
            targetUrl: parsed.target_url || '#/',
            category: parsed.category || 'new_movies',
          });
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener('config_sync', () => {
        emitAdmDataSync();
      });

      es.onerror = () => {
        try {
          es.close();
        } catch {
          // ignore
        }
        if (activeEventSource === es) {
          activeEventSource = null;
        }
        if (!sseReconnectTimer) {
          sseReconnectTimer = window.setTimeout(() => {
            sseReconnectTimer = null;
            if (sseActiveToken === token) {
              connect();
            }
          }, 6000);
        }
      };
    } catch {
      // ignore if browser restricts EventSource
    }
  };

  connect();
}

export async function initForegroundPushListener(): Promise<void> {
  if (typeof window === 'undefined') return;

  const savedToken =
    getSavedFcmToken() ||
    `live-sync-${Math.random().toString(36).slice(2, 10)}`;
  startUniversalPushStream(savedToken);

  if (foregroundInitialized) return;
  foregroundInitialized = true;

  // Pre-register and activate SW early so native showNotification() is instant
  void registerFcmServiceWorker();

  await subscribeFcmForegroundMessages((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'MOVIX';
    const body = payload.notification?.body || payload.data?.body || '';
    const imageUrl = payload.notification?.image || payload.data?.image_url || undefined;
    const targetUrl = payload.data?.target_url || payload.fcmOptions?.link || '#/';
    const category = (payload.data?.category as PushCategory | undefined) || 'new_movies';
    const campaignId = payload.data?.campaign_id || undefined;

    handleIncomingRealtimeNotification({
      campaignId,
      title,
      body,
      imageUrl,
      targetUrl,
      category,
    });
  });
}

export async function syncPushSubscription(params: {
  userId?: string | null;
  prefs?: PushPrefs;
  forceWelcome?: boolean;
}): Promise<{
  permission: NotificationPermission | 'unsupported';
  token: string | null;
  prefs: PushPrefs;
  welcomeTriggered: boolean;
}> {
  const currentPrefs = params.prefs || getSavedPushPrefs();
  if (typeof window === 'undefined') {
    return { permission: 'unsupported', token: null, prefs: currentPrefs, welcomeTriggered: false };
  }

  const hasNativeApi = 'Notification' in window;
  let permission: NotificationPermission | 'unsupported' = hasNativeApi
    ? Notification.permission
    : 'unsupported';

  if (hasNativeApi && permission === 'default') {
    permission = await requestNotificationPermissionUniversal();
  }

  // If browser has native Notification API and user explicitly denied or hasn't chosen yet, stop here
  if (hasNativeApi && permission !== 'granted') {
    return { permission, token: null, prefs: currentPrefs, welcomeTriggered: false };
  }

  void initForegroundPushListener();

  const swReg = await registerFcmServiceWorker();

  // Trigger the welcome notification IMMEDIATELY in the device notification tray (or universal fallback)
  let localWelcomeDispatched = false;
  if (params.forceWelcome || !hasShownWelcomeLocally()) {
    markWelcomeShownLocally();
    localWelcomeDispatched = true;
    void showNativeSystemNotification({
      title: WELCOME_NOTIFICATION_TITLE,
      body: WELCOME_NOTIFICATION_BODY,
      targetUrl: '/',
      tag: 'movix-welcome',
      category: 'welcome',
      swReg,
    });
  }

  let token = hasNativeApi ? await requestFcmDeviceToken(swReg) : null;

  if (!token) {
    token =
      getSavedFcmToken() ||
      `web-universal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  saveFcmToken(token);
  savePushPrefsLocal(currentPrefs);
  startUniversalPushStream(token);

  try {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: params.userId || null,
        fcm_token: token,
        device_info: getDeviceInfoLabel(),
        prefs: currentPrefs,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        subscription?: { prefs?: PushPrefs };
        welcomeTriggered?: boolean;
        welcomeFcmSent?: boolean;
        welcomePayload?: {
          title: string;
          body: string;
          target_url?: string;
          image_url?: string;
          category?: PushCategory;
        } | null;
      };

      const savedPrefs = data.subscription?.prefs || currentPrefs;
      savePushPrefsLocal(savedPrefs);

      if (!localWelcomeDispatched && data.welcomeTriggered && !data.welcomeFcmSent && data.welcomePayload) {
        markWelcomeShownLocally();
        void showNativeSystemNotification({
          title: data.welcomePayload.title,
          body: data.welcomePayload.body,
          targetUrl: data.welcomePayload.target_url || '/',
          tag: 'movix-welcome',
          category: 'welcome',
          swReg,
        });
      }

      return {
        permission: hasNativeApi ? permission : 'granted',
        token,
        prefs: savedPrefs,
        welcomeTriggered: localWelcomeDispatched || Boolean(data.welcomeTriggered),
      };
    }
  } catch {
    // Keep local state if offline
  }

  return {
    permission: hasNativeApi ? permission : 'granted',
    token,
    prefs: currentPrefs,
    welcomeTriggered: localWelcomeDispatched,
  };
}

export async function updateDevicePushPrefs(
  patch: Partial<PushPrefs>,
  userId?: string | null
): Promise<PushPrefs> {
  const next: PushPrefs = {
    ...getSavedPushPrefs(),
    ...patch,
  };
  savePushPrefsLocal(next);

  const token = getSavedFcmToken();
  if (!token) return next;

  try {
    await fetch('/api/push/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fcm_token: token,
        user_id: userId || null,
        prefs: next,
      }),
    });
  } catch {
    // ignore transient network failure
  }
  return next;
}

export async function refreshSavedPushPrefsFromServer(): Promise<PushPrefs> {
  const token = getSavedFcmToken();
  const local = getSavedPushPrefs();
  if (!token) return local;
  try {
    const res = await fetch(`/api/push/subscription?token=${encodeURIComponent(token)}`);
    if (!res.ok) return local;
    const data = (await res.json()) as { found?: boolean; subscription?: { prefs?: PushPrefs } };
    if (data.found && data.subscription?.prefs) {
      savePushPrefsLocal(data.subscription.prefs);
      return data.subscription.prefs;
    }
  } catch {
    // ignore
  }
  return local;
}
