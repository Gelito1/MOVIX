import { CURRENT_TERMS_VERSION, type SupportedLanguage } from './firebase';

const ONBOARDING_KEY = 'movix:onboarding:v1';
const DEVICE_ACCOUNT_KEY = 'movix:device_account:v1';

export type NotificationDecision = 'granted' | 'denied' | 'skipped' | null;

export interface OnboardingState {
  notificationsDecision: NotificationDecision;
  termsAccepted: boolean;
  termsVersion: string;
  preferredLanguage: SupportedLanguage;
  languageManuallySelected?: boolean;
  detectedCountry?: string | null;
  onboardingCompleted: boolean;
}

export interface DeviceAccountRecord {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  provider: 'google' | 'password';
  boundAt: string;
}

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  nativeLabel: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'pt-BR', label: 'Português (Brasil)', nativeLabel: 'Português' },
  { code: 'pt-PT', label: 'Português (Portugal)', nativeLabel: 'Português (PT)' },
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es-419', label: 'Español (América Latina)', nativeLabel: 'Español (América Latina)' },
  { code: 'es-ES', label: 'Español (España)', nativeLabel: 'Español (España)' },
  { code: 'fr', label: 'Français', nativeLabel: 'Français' },
  { code: 'it', label: 'Italiano', nativeLabel: 'Italiano' },
];

export function isSupportedLanguage(val: unknown): val is SupportedLanguage {
  return (
    val === 'pt-BR' ||
    val === 'pt-PT' ||
    val === 'en' ||
    val === 'es-419' ||
    val === 'es-ES' ||
    val === 'fr' ||
    val === 'it'
  );
}

export function inferBrowserRegionLanguage(): SupportedLanguage {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (
      /^America\/(Sao_Paulo|Fortaleza|Recife|Bahia|Belem|Manaus|Cuiaba|Porto_Velho|Boa_Vista|Rio_Branco|Campo_Grande|Maceio|Araguaina|Santarem|Noronha)/i.test(
        tz
      )
    ) {
      return 'pt-BR';
    }
    if (/^(Europe\/Lisbon|Atlantic\/(Madeira|Azores)|Africa\/(Luanda|Maputo))/i.test(tz)) {
      return 'pt-PT';
    }
    if (/^(Europe\/Madrid|Atlantic\/Canary)/i.test(tz)) {
      return 'es-ES';
    }
    if (
      /^America\/(Mexico_City|Monterrey|Bogota|Lima|Santiago|Argentina|Buenos_Aires|Caracas|Guayaquil|La_Paz|Asuncion|Montevideo|Guatemala|San_Salvador|Managua|Tegucigalpa|Costa_Rica|Panama|Santo_Domingo|Havana)/i.test(
        tz
      )
    ) {
      return 'es-419';
    }
    if (/^Europe\/Paris/i.test(tz)) {
      return 'fr';
    }
    if (/^Europe\/Rome/i.test(tz)) {
      return 'it';
    }

    const langs =
      typeof navigator !== 'undefined'
        ? [...(navigator.languages || []), navigator.language].filter(Boolean)
        : [];
    for (const raw of langs) {
      const lc = raw.toLowerCase();
      if (lc.startsWith('pt-br')) return 'pt-BR';
      if (lc.startsWith('pt')) return 'pt-PT';
      if (lc.startsWith('es-es')) return 'es-ES';
      if (lc.startsWith('es')) return 'es-419';
      if (lc.startsWith('fr')) return 'fr';
      if (lc.startsWith('it')) return 'it';
      if (lc.startsWith('en')) return 'en';
    }
  } catch {
    // Fallback to pt-BR
  }
  return 'pt-BR';
}

const DEFAULT_ONBOARDING: OnboardingState = {
  notificationsDecision: null,
  termsAccepted: false,
  termsVersion: CURRENT_TERMS_VERSION,
  preferredLanguage: 'pt-BR',
  languageManuallySelected: false,
  detectedCountry: null,
  onboardingCompleted: false,
};

export function getOnboardingState(): OnboardingState {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_KEY);
    if (!raw) {
      return {
        ...DEFAULT_ONBOARDING,
        preferredLanguage: inferBrowserRegionLanguage(),
      };
    }
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      ...DEFAULT_ONBOARDING,
      ...parsed,
    };
  } catch {
    return {
      ...DEFAULT_ONBOARDING,
      preferredLanguage: inferBrowserRegionLanguage(),
    };
  }
}

export function saveOnboardingState(patch: Partial<OnboardingState>): OnboardingState {
  const next: OnboardingState = {
    ...getOnboardingState(),
    ...patch,
  };
  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

/**
 * Single account bound to this device (1 account per device policy).
 */
export function getDeviceAccount(): DeviceAccountRecord | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceAccountRecord>;
    if (!parsed.uid || !parsed.email) return null;
    return {
      uid: parsed.uid,
      displayName: parsed.displayName || parsed.email.split('@')[0] || 'MOVIX',
      email: parsed.email,
      photoURL: parsed.photoURL || '',
      provider: parsed.provider === 'google' ? 'google' : 'password',
      boundAt: parsed.boundAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function bindDeviceAccount(
  record: Omit<DeviceAccountRecord, 'boundAt'>
): DeviceAccountRecord {
  const existing = getDeviceAccount();
  const next: DeviceAccountRecord = {
    ...record,
    boundAt: existing?.boundAt || new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(DEVICE_ACCOUNT_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

export function isSameDeviceAccount(
  bound: DeviceAccountRecord,
  candidate: { uid?: string | null; email?: string | null }
): boolean {
  if (candidate.uid && bound.uid === candidate.uid) return true;
  if (
    candidate.email &&
    bound.email.toLowerCase() === candidate.email.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

export function requestNotificationPermissionUniversal(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return Promise.resolve('unsupported');
  }
  try {
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Promise.resolve(Notification.permission);
    }
  } catch {
    return Promise.resolve('unsupported');
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (perm: NotificationPermission | 'unsupported') => {
      if (settled) return;
      settled = true;
      resolve(perm);
    };

    const timer = window.setTimeout(() => {
      try {
        finish(Notification.permission);
      } catch {
        finish('default');
      }
    }, 12_000);

    try {
      // Supports both modern Promise API (Chrome/Firefox/Edge/Safari 16+)
      // and legacy callback API (older Safari / macOS / WebKit browsers)
      const maybePromise = Notification.requestPermission((legacyPerm) => {
        window.clearTimeout(timer);
        finish(legacyPerm || Notification.permission);
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise
          .then((perm) => {
            window.clearTimeout(timer);
            finish(perm || Notification.permission);
          })
          .catch(() => {
            window.clearTimeout(timer);
            try {
              finish(Notification.permission);
            } catch {
              finish('default');
            }
          });
      }
    } catch {
      window.clearTimeout(timer);
      try {
        finish(Notification.permission);
      } catch {
        finish('default');
      }
    }
  });
}

export async function requestBrowserNotifications(): Promise<NotificationDecision> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      // Browsers without the Notification constructor (e.g. iOS Safari tab, in-app WebView)
      // use MOVIX universal real-time delivery automatically.
      return 'granted';
    }
    if (Notification.permission === 'granted') {
      return 'granted';
    }
    if (Notification.permission === 'denied') {
      return 'denied';
    }
    const result = await requestNotificationPermissionUniversal();
    if (result === 'granted' || result === 'unsupported') return 'granted';
    if (result === 'denied') return 'denied';
    // Browser deferred non-gesture prompt (Safari/Firefox/Brave/Opera): keep pending (null)
    // so the very first click/tap/keydown immediately opens the native permission dialog.
    return null;
  } catch {
    return null;
  }
}

export function getLanguageLabel(code: SupportedLanguage): string {
  return LANGUAGE_OPTIONS.find((opt) => opt.code === code)?.nativeLabel || 'Português';
}
