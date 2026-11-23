import { registerSW } from 'virtual:pwa-register';

declare const __APP_VERSION__: string | undefined;

const APPLIED_VERSION_KEY = 'movix:applied_version';
const BUNDLED_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.trim() ? __APP_VERSION__.trim() : null;

let initialized = false;
let updating = false;
let initialServerVersion: string | null = null;
let swRegistration: ServiceWorkerRegistration | null = null;
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

async function applyAutomaticUpdate(nextVersion?: string): Promise<void> {
  if (updating || typeof window === 'undefined') return;

  // Prevent reload loops if a version was just applied in this tab session
  if (nextVersion) {
    try {
      const lastApplied = window.sessionStorage.getItem(APPLIED_VERSION_KEY);
      if (lastApplied === nextVersion) return;
      window.sessionStorage.setItem(APPLIED_VERSION_KEY, nextVersion);
    } catch {
      // Ignore storage restrictions
    }
  }

  updating = true;

  try {
    if (swRegistration) {
      await swRegistration.update().catch(() => {});
      if (swRegistration.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }

    // Clear stale app-shell caches while keeping user's offline favorites cache intact
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (name) =>
              name !== 'movix-offline-metadata-v1' &&
              name !== 'movix-offline-images-v1'
          )
          .map((name) => caches.delete(name))
      );
    }

    if (updateSWFn) {
      await updateSWFn(true);
      return;
    }
  } catch {
    // Proceed to reload regardless
  }

  window.location.reload();
}

export async function checkForAppUpdate(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  // 1. Ask Service Worker to check for updates silently
  if (swRegistration) {
    try {
      await swRegistration.update();
      if (swRegistration.waiting) {
        void applyAutomaticUpdate();
        return;
      }
    } catch {
      // Ignore transient SW check errors
    }
  }

  // 2. Compare server version with baked-in bundle version (and runtime baseline)
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (!data?.version) return;

    // In production builds, immediately detect when an installed PWA booted a stale precached bundle
    if (import.meta.env.PROD && BUNDLED_VERSION && data.version !== BUNDLED_VERSION) {
      void applyAutomaticUpdate(data.version);
      return;
    }

    if (!initialServerVersion) {
      initialServerVersion = data.version;
      return;
    }

    if (data.version !== initialServerVersion) {
      void applyAutomaticUpdate(data.version);
    }
  } catch {
    // Offline or unreachable server
  }
}

export function initAppUpdateWatcher(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  let hadController = Boolean(navigator.serviceWorker?.controller);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !updating) {
        updating = true;
        window.location.reload();
      }
      hadController = true;
    });
  }

  updateSWFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      void applyAutomaticUpdate();
    },
    onRegisteredSW(_swUrl, registration) {
      swRegistration = registration || null;
      if (registration) {
        void registration.update().catch(() => {});
      }
    },
  });

  // Initial version check right away
  void checkForAppUpdate();

  // Silent periodic check every 60 seconds while app is visible
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate();
    }
  }, 60 * 1000);

  // Silent check on return to app or reconnection
  window.addEventListener('focus', () => {
    void checkForAppUpdate();
  });
  window.addEventListener('online', () => {
    void checkForAppUpdate();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForAppUpdate();
    }
  });
}
