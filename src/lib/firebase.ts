import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  getMessaging,
  getToken,
  isSupported as isMessagingSupported,
  onMessage,
  type MessagePayload,
  type Messaging,
} from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  DEFAULT_AD_PACING,
  type AdCampaign,
  type AdDeviceTarget,
  type AdFormatType,
  type AdPlacement,
  type AdStatus,
  type ManagedEpisode,
  type ManagedMovie,
  type ManagedSeason,
  type ManagedSeries,
  type PlaybackServerLink,
  type PublicAdItem,
  type SiteIdentityConfig,
} from '../types/adm';
import type { FavoriteItem } from '../types/movix';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Dedicated Firebase Cloud Messaging (FCM) configuration for MOVIX Web Push
export const FCM_VAPID_KEY =
  'BOf1cWMWUAZWzp2Ca7LaDhKhgXuDZXVRGQw7pDPyNr51pL5s6NnCic6CHIgblhudHQ5iDFaOXvHZFr1LE50j0ew';

export const fcmFirebaseConfig = {
  apiKey: 'AIzaSyCA1H88oadDN3cR-_b2nnaJna-DhFsJZak',
  authDomain: 'movix-e3099.firebaseapp.com',
  projectId: 'movix-e3099',
  storageBucket: 'movix-e3099.firebasestorage.app',
  messagingSenderId: '430603543344',
  appId: '1:430603543344:web:54b07b1c1b20263110def5',
  measurementId: 'G-P0Y6ZZQ92P',
};

const fcmApp =
  getApps().find((existing) => existing.name === 'movix-fcm') ||
  initializeApp(fcmFirebaseConfig, 'movix-fcm');

let messagingPromise: Promise<Messaging | null> | null = null;

export async function getMovixMessaging(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null;
  if (!messagingPromise) {
    messagingPromise = isMessagingSupported()
      .then((supported) => (supported ? getMessaging(fcmApp) : null))
      .catch(() => null);
  }
  return messagingPromise;
}

export async function requestFcmDeviceToken(
  serviceWorkerRegistration?: ServiceWorkerRegistration
): Promise<string | null> {
  const messaging = await getMovixMessaging();
  if (!messaging) return null;
  try {
    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration,
    });
    return token || null;
  } catch (err) {
    console.warn('[MOVIX FCM] Unable to obtain FCM token:', err);
    return null;
  }
}

export async function subscribeFcmForegroundMessages(
  handler: (payload: MessagePayload) => void
): Promise<() => void> {
  const messaging = await getMovixMessaging();
  if (!messaging) return () => {};
  return onMessage(messaging, handler);
}

export const CURRENT_TERMS_VERSION = '2026.1';

export type SupportedLanguage = 'pt-BR' | 'pt-PT' | 'en' | 'es-419' | 'es-ES' | 'fr' | 'it';

const ALLOWED_LANGUAGES: ReadonlySet<string> = new Set([
  'pt-BR',
  'pt-PT',
  'en',
  'es-419',
  'es-ES',
  'fr',
  'it',
]);

export type SupportCategory = 'login' | 'reproducao' | 'conta' | 'legal' | 'outro';

const ALLOWED_CATEGORIES: ReadonlySet<string> = new Set([
  'login',
  'reproducao',
  'conta',
  'legal',
  'outro',
]);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export interface CloudUserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  preferredLanguage: SupportedLanguage;
  notificationsEnabled: boolean;
  termsAccepted: boolean;
  termsVersion: string;
}

function clampString(val: string | null | undefined, maxLen: number, fallback = ''): string {
  const trimmed = (val ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function sanitizeLanguage(lang: string | null | undefined): SupportedLanguage {
  if (lang && ALLOWED_LANGUAGES.has(lang)) {
    return lang as SupportedLanguage;
  }
  return 'pt-BR';
}

function favoriteDocId(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `${mediaType}_${Math.max(1, Math.floor(tmdbId))}`;
}

export async function fetchUserProfile(uid: string): Promise<CloudUserProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      uid: String(data.uid || uid),
      displayName: clampString(data.displayName, 80, 'Usuário MOVIX'),
      photoURL: clampString(data.photoURL, 500, ''),
      preferredLanguage: sanitizeLanguage(data.preferredLanguage),
      notificationsEnabled: Boolean(data.notificationsEnabled),
      termsAccepted: Boolean(data.termsAccepted),
      termsVersion: clampString(data.termsVersion, 20, CURRENT_TERMS_VERSION),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function ensureCloudUserRecords(
  user: User,
  prefs: {
    displayName?: string;
    preferredLanguage: SupportedLanguage;
    notificationsEnabled: boolean;
    termsAccepted: boolean;
  }
): Promise<CloudUserProfile | null> {
  // Security rules enforce email_verified == true on writes; skip cloud write until verified
  if (!user.emailVerified) {
    return null;
  }

  const uid = user.uid;
  const profileRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'info');
  const displayName = clampString(
    prefs.displayName || user.displayName || user.email?.split('@')[0],
    80,
    'Usuário MOVIX'
  );
  const photoURL = clampString(user.photoURL, 500, '');
  const email = clampString(user.email, 254, 'usuario@movix.app');
  const provider: 'google' | 'password' = user.providerData.some(
    (p) => p.providerId === 'google.com'
  )
    ? 'google'
    : 'password';
  const preferredLanguage = sanitizeLanguage(prefs.preferredLanguage);

  try {
    const existingSnap = await getDoc(profileRef);
    if (!existingSnap.exists()) {
      const batch = writeBatch(db);
      batch.set(profileRef, {
        uid,
        displayName,
        photoURL,
        preferredLanguage,
        notificationsEnabled: Boolean(prefs.notificationsEnabled),
        termsAccepted: Boolean(prefs.termsAccepted),
        termsVersion: CURRENT_TERMS_VERSION,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privateRef, {
        uid,
        email,
        provider,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return {
        uid,
        displayName,
        photoURL,
        preferredLanguage,
        notificationsEnabled: Boolean(prefs.notificationsEnabled),
        termsAccepted: Boolean(prefs.termsAccepted),
        termsVersion: CURRENT_TERMS_VERSION,
      };
    }

    const existing = existingSnap.data();
    return {
      uid,
      displayName: clampString(existing.displayName, 80, displayName),
      photoURL: clampString(existing.photoURL, 500, photoURL),
      preferredLanguage: sanitizeLanguage(existing.preferredLanguage),
      notificationsEnabled: Boolean(existing.notificationsEnabled),
      termsAccepted: Boolean(existing.termsAccepted),
      termsVersion: clampString(existing.termsVersion, 20, CURRENT_TERMS_VERSION),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function updateCloudPreferences(
  user: User,
  patch: {
    preferredLanguage?: SupportedLanguage;
    notificationsEnabled?: boolean;
  }
): Promise<void> {
  if (!user.emailVerified) return;
  const path = `users/${user.uid}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.preferredLanguage !== undefined) {
    payload.preferredLanguage = sanitizeLanguage(patch.preferredLanguage);
  }
  if (patch.notificationsEnabled !== undefined) {
    payload.notificationsEnabled = Boolean(patch.notificationsEnabled);
  }
  try {
    await updateDoc(doc(db, 'users', user.uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserFavorites(
  uid: string,
  onFavorites: (items: FavoriteItem[]) => void
): Unsubscribe {
  const path = `users/${uid}/favorites`;
  const q = query(collection(db, 'users', uid, 'favorites'), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: FavoriteItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const mediaType: 'movie' | 'tv' = d.mediaType === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(d.tmdbId || 0);
        const createdAtVal =
          d.createdAt && typeof d.createdAt.toDate === 'function'
            ? d.createdAt.toDate().toISOString()
            : new Date().toISOString();
        return {
          key: `${mediaType}:${tmdbId}`,
          tmdbId,
          mediaType,
          title: clampString(d.title, 200, 'Título'),
          posterUrl: d.posterUrl ? clampString(d.posterUrl, 500, '') : null,
          year: clampString(d.year, 10, ''),
          rating: Number(d.rating || 0),
          addedAt: createdAtVal,
        };
      });
      onFavorites(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function upsertCloudFavorite(
  user: User,
  item: {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterUrl: string | null;
    year: string;
    rating: number;
  }
): Promise<void> {
  if (!user.emailVerified || item.tmdbId < 1) return;
  const docId = favoriteDocId(item.mediaType, item.tmdbId);
  const path = `users/${user.uid}/favorites/${docId}`;
  const ref = doc(db, 'users', user.uid, 'favorites', docId);
  const safeRating = Math.min(10, Math.max(0, Number.isFinite(item.rating) ? item.rating : 0));
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        title: clampString(item.title, 200, 'Título'),
        posterUrl: clampString(item.posterUrl, 500, ''),
        year: clampString(item.year, 10, ''),
        rating: safeRating,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid: user.uid,
        tmdbId: Math.floor(item.tmdbId),
        mediaType: item.mediaType,
        title: clampString(item.title, 200, 'Título'),
        posterUrl: clampString(item.posterUrl, 500, ''),
        year: clampString(item.year, 10, ''),
        rating: safeRating,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudFavorite(
  user: User,
  mediaType: 'movie' | 'tv',
  tmdbId: number
): Promise<void> {
  if (!user.emailVerified || tmdbId < 1) return;
  const docId = favoriteDocId(mediaType, tmdbId);
  const path = `users/${user.uid}/favorites/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'favorites', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createSupportTicket(
  user: User | null,
  category: SupportCategory,
  message: string
): Promise<{ savedToCloud: boolean }> {
  const safeCategory: SupportCategory = ALLOWED_CATEGORIES.has(category) ? category : 'outro';
  const safeMessage = clampString(message, 1000, '');
  if (safeMessage.length < 5) {
    throw new Error('Descreva o problema com pelo menos 5 caracteres.');
  }

  if (!user || !user.emailVerified) {
    return { savedToCloud: false };
  }

  const ticketId = `tkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `supportTickets/${ticketId}`;
  try {
    await setDoc(doc(db, 'supportTickets', ticketId), {
      uid: user.uid,
      category: safeCategory,
      message: safeMessage,
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { savedToCloud: true };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// =========================================================================
// Cross-Environment Real-Time Cloud Sync (/systemConfig/public & /publicAds)
// =========================================================================

const BOOTSTRAPPED_ADMIN_EMAIL = 'gelitontn1@gmail.com';
const ALLOWED_AD_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'paused',
  'scheduled',
  'expired',
  'draft',
]);

export interface CloudSystemPublicConfig {
  platformName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  heroTagline: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  aboutUs: string;
  privacyPolicy: string;
  termsOfUse: string;
  contactEmail: string;
  contactPhone: string;
  socialInstagram: string;
  socialYoutube: string;
  socialTelegram: string;
  socialTwitter: string;
  defaultLanguage: SupportedLanguage;
  maintenanceMode: boolean;
  adsGlobalEnabled: boolean;
  dismissCooldownMinutes: number;
  largeAdIntervalMinutes: number;
  playerAdIntervalMinutes: number;
  headerAdAlwaysVisible: boolean;
  updatedAt: string;
}

export interface CloudPublicAdRecord extends PublicAdItem {
  status: AdStatus;
  devices: AdDeviceTarget[];
  startDate: string;
  endDate: string;
  maxImpressions: number | null;
  targetAudience: string;
  countries: string[];
  impressions: number;
  clicks: number;
  videoViews: number;
  videoCompletes: number;
  videoPartials: number;
  totalWatchSeconds: number;
  createdAtIso: string;
  updatedAt: string;
}

export type CloudCatalogListId = 'banners' | 'highlights' | 'categories' | 'genres' | 'servers';

export interface CloudMediaAssetRecord {
  id: string;
  folder: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  updatedAt: string;
}

const ALLOWED_MEDIA_FOLDERS: ReadonlySet<string> = new Set([
  'posters',
  'backdrops',
  'ads-images',
  'ads-videos',
  'branding',
  'notifications',
  'categories',
]);

const ALLOWED_MEDIA_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
]);

let cachedCloudSystemConfig: CloudSystemPublicConfig | null = null;
let cachedCloudActiveAds: CloudPublicAdRecord[] | null = null;
let cloudActiveAdsLoaded = false;
const cloudMediaAssetCache = new Map<string, CloudMediaAssetRecord>();
const cloudMediaInFlight = new Map<string, Promise<CloudMediaAssetRecord | null>>();

export function isVerifiedFirebaseAdmin(user?: User | null): boolean {
  const target = user !== undefined ? user : auth.currentUser;
  return Boolean(
    target &&
      target.emailVerified &&
      target.email &&
      target.email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL
  );
}

export function getCachedCloudSystemConfig(): CloudSystemPublicConfig | null {
  return cachedCloudSystemConfig;
}

export function getCachedCloudActiveAds(): CloudPublicAdRecord[] | null {
  return cachedCloudActiveAds;
}

export function hasCloudActiveAdsLoaded(): boolean {
  return cloudActiveAdsLoaded;
}

export function syncLocalCloudActiveAdCache(ad: AdCampaign): void {
  const safeId = sanitizeDocId(ad.id, 'ad');
  if (cachedCloudActiveAds === null) return;
  if (ad.status !== 'active') {
    cachedCloudActiveAds = cachedCloudActiveAds.filter(
      (item) => item.id !== ad.id && item.id !== safeId
    );
    return;
  }
  const nowIso = ad.updatedAt || new Date().toISOString();
  const nextRecord: CloudPublicAdRecord = {
    id: ad.id,
    name: ad.name,
    title: ad.title,
    description: ad.description,
    format: ad.format,
    mediaKind: ad.mediaKind,
    imageUrl: ad.imageUrl,
    videoUrl: ad.videoUrl,
    destinationUrl: ad.destinationUrl,
    ctaText: ad.ctaText,
    status: 'active',
    priority: ad.priority,
    placements: ad.placements,
    devices: ad.devices,
    autoplay: ad.autoplay,
    startMuted: ad.startMuted,
    skippable: ad.skippable,
    skipAfterSeconds: ad.skipAfterSeconds,
    durationSeconds: ad.durationSeconds,
    frequencyPerSession: ad.frequencyPerSession,
    startDate: ad.startDate || '',
    endDate: ad.endDate || '',
    maxImpressions: ad.maxImpressions ?? null,
    targetAudience: ad.targetAudience || 'Todos os visitantes',
    countries: ad.countries || [],
    impressions: ad.impressions || 0,
    clicks: ad.clicks || 0,
    videoViews: ad.videoViews || 0,
    videoCompletes: ad.videoCompletes || 0,
    videoPartials: ad.videoPartials || 0,
    totalWatchSeconds: ad.totalWatchSeconds || 0,
    createdAtIso: ad.createdAt || nowIso,
    updatedAt: nowIso,
  };
  const rest = cachedCloudActiveAds.filter((item) => item.id !== ad.id && item.id !== safeId);
  cachedCloudActiveAds = [nextRecord, ...rest];
}

export function removeLocalCloudActiveAdCache(adId: string): void {
  if (cachedCloudActiveAds === null) return;
  const safeId = sanitizeDocId(adId, 'ad');
  cachedCloudActiveAds = cachedCloudActiveAds.filter(
    (item) => item.id !== adId && item.id !== safeId
  );
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function sanitizeDocId(raw: string, prefix = 'doc'): string {
  const clean = (raw || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return clean || `${prefix}_${Date.now().toString(36)}`;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function parseCloudSystemConfig(data: Record<string, unknown>): CloudSystemPublicConfig {
  const updatedAtObj = data.updatedAt as { toDate?: () => Date } | undefined;
  const updatedAtIso =
    updatedAtObj && typeof updatedAtObj.toDate === 'function'
      ? updatedAtObj.toDate().toISOString()
      : new Date().toISOString();

  return {
    platformName: clampString(String(data.platformName ?? ''), 80, 'MOVIX'),
    logoUrl: clampString(String(data.logoUrl ?? ''), 500, ''),
    faviconUrl: clampString(String(data.faviconUrl ?? ''), 500, ''),
    primaryColor: clampString(String(data.primaryColor ?? ''), 20, '#E5B85A'),
    heroTagline: clampString(String(data.heroTagline ?? ''), 200, ''),
    seoTitle: clampString(String(data.seoTitle ?? ''), 160, 'MOVIX'),
    seoDescription: clampString(String(data.seoDescription ?? ''), 400, ''),
    seoKeywords: clampString(String(data.seoKeywords ?? ''), 300, ''),
    aboutUs: clampString(String(data.aboutUs ?? ''), 5000, ''),
    privacyPolicy: clampString(String(data.privacyPolicy ?? ''), 8000, ''),
    termsOfUse: clampString(String(data.termsOfUse ?? ''), 8000, ''),
    contactEmail: clampString(String(data.contactEmail ?? ''), 120, ''),
    contactPhone: clampString(String(data.contactPhone ?? ''), 40, ''),
    socialInstagram: clampString(String(data.socialInstagram ?? ''), 500, ''),
    socialYoutube: clampString(String(data.socialYoutube ?? ''), 500, ''),
    socialTelegram: clampString(String(data.socialTelegram ?? ''), 500, ''),
    socialTwitter: clampString(String(data.socialTwitter ?? ''), 500, ''),
    defaultLanguage: sanitizeLanguage(String(data.defaultLanguage ?? 'pt-BR')),
    maintenanceMode: Boolean(data.maintenanceMode),
    adsGlobalEnabled: data.adsGlobalEnabled !== false,
    dismissCooldownMinutes: clampInt(
      data.dismissCooldownMinutes,
      1,
      1440,
      DEFAULT_AD_PACING.dismissCooldownMinutes
    ),
    largeAdIntervalMinutes: clampInt(
      data.largeAdIntervalMinutes,
      0,
      1440,
      DEFAULT_AD_PACING.largeAdIntervalMinutes
    ),
    playerAdIntervalMinutes: clampInt(
      data.playerAdIntervalMinutes,
      0,
      1440,
      DEFAULT_AD_PACING.playerAdIntervalMinutes
    ),
    headerAdAlwaysVisible:
      typeof data.headerAdAlwaysVisible === 'boolean'
        ? data.headerAdAlwaysVisible
        : DEFAULT_AD_PACING.headerAdAlwaysVisible,
    updatedAt: updatedAtIso,
  };
}

function parseCloudPublicAd(id: string, data: Record<string, unknown>): CloudPublicAdRecord {
  const updatedAtObj = data.updatedAt as { toDate?: () => Date } | undefined;
  const fallbackCreatedIso = clampString(String(data.createdAtIso ?? ''), 40, '');
  const updatedAtIso =
    updatedAtObj && typeof updatedAtObj.toDate === 'function'
      ? updatedAtObj.toDate().toISOString()
      : fallbackCreatedIso || '1970-01-01T00:00:00.000Z';
  const rawStatus = String(data.status || 'paused');
  const status: AdStatus = ALLOWED_AD_STATUSES.has(rawStatus) ? (rawStatus as AdStatus) : 'paused';
  const rawPlacements = Array.isArray(data.placements)
    ? data.placements.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : ['home'];
  const rawDevices = Array.isArray(data.devices)
    ? data.devices.filter((d): d is string => typeof d === 'string' && d.length > 0)
    : ['all'];
  const rawCountries = Array.isArray(data.countries)
    ? data.countries.filter((c): c is string => typeof c === 'string' && c.length > 0).slice(0, 50)
    : [];

  return {
    id: clampString(String(data.id || id), 128, id),
    name: clampString(String(data.name ?? ''), 160, 'Campanha MOVIX'),
    title: clampString(String(data.title ?? ''), 200, ''),
    description: clampString(String(data.description ?? ''), 600, ''),
    format: clampString(String(data.format ?? ''), 40, 'banner_horizontal') as AdFormatType,
    mediaKind: data.mediaKind === 'video' ? 'video' : 'image',
    imageUrl: clampString(String(data.imageUrl ?? ''), 1000, ''),
    videoUrl: clampString(String(data.videoUrl ?? ''), 1000, ''),
    destinationUrl: clampString(String(data.destinationUrl ?? ''), 1000, ''),
    ctaText: clampString(String(data.ctaText ?? ''), 80, 'Saiba mais'),
    status,
    priority: clampInt(data.priority, 1, 100, 10),
    placements: (rawPlacements.length > 0 ? rawPlacements : ['home']) as AdPlacement[],
    devices: (rawDevices.length > 0 ? rawDevices : ['all']) as AdDeviceTarget[],
    autoplay: data.autoplay !== false,
    startMuted: Boolean(data.startMuted),
    skippable: data.skippable !== false,
    skipAfterSeconds: clampInt(data.skipAfterSeconds, 0, 120, 5),
    durationSeconds: clampInt(data.durationSeconds, 1, 300, 15),
    frequencyPerSession: clampInt(data.frequencyPerSession, 1, 100, 3),
    startDate: clampString(String(data.startDate ?? ''), 40, ''),
    endDate: clampString(String(data.endDate ?? ''), 40, ''),
    maxImpressions:
      typeof data.maxImpressions === 'number' && Number.isFinite(data.maxImpressions)
        ? Math.max(0, Math.floor(data.maxImpressions))
        : null,
    targetAudience: clampString(String(data.targetAudience ?? ''), 200, 'Todos os visitantes'),
    countries: rawCountries,
    impressions: clampInt(data.impressions, 0, 1000000000, 0),
    clicks: clampInt(data.clicks, 0, 1000000000, 0),
    videoViews: clampInt(data.videoViews, 0, 1000000000, 0),
    videoCompletes: clampInt(data.videoCompletes, 0, 1000000000, 0),
    videoPartials: clampInt(data.videoPartials, 0, 1000000000, 0),
    totalWatchSeconds: clampNumber(data.totalWatchSeconds, 0, 1000000000, 0),
    createdAtIso: clampString(String(data.createdAtIso ?? ''), 40, updatedAtIso),
    updatedAt: updatedAtIso,
  };
}

export function applyCloudConfigToSiteConfig(
  base: SiteIdentityConfig | undefined | null,
  cloud: CloudSystemPublicConfig
): SiteIdentityConfig {
  return {
    platformName: cloud.platformName || base?.platformName || 'MOVIX',
    logoUrl: cloud.logoUrl || base?.logoUrl || '',
    faviconUrl: cloud.faviconUrl || base?.faviconUrl || '',
    primaryColor: cloud.primaryColor || base?.primaryColor || '#E5B85A',
    heroTagline: cloud.heroTagline || base?.heroTagline || '',
    aboutUs: cloud.aboutUs || base?.aboutUs || '',
    privacyPolicy: cloud.privacyPolicy || base?.privacyPolicy || '',
    termsOfUse: cloud.termsOfUse || base?.termsOfUse || '',
    contactEmail: cloud.contactEmail || base?.contactEmail || '',
    contactPhone: cloud.contactPhone || base?.contactPhone || '',
    socialInstagram: cloud.socialInstagram || base?.socialInstagram || '',
    socialYoutube: cloud.socialYoutube || base?.socialYoutube || '',
    socialTelegram: cloud.socialTelegram || base?.socialTelegram || '',
    socialTwitter: cloud.socialTwitter || base?.socialTwitter || '',
    seoTitle: cloud.seoTitle || base?.seoTitle || 'MOVIX',
    seoDescription: cloud.seoDescription || base?.seoDescription || '',
    seoKeywords: cloud.seoKeywords || base?.seoKeywords || '',
    maintenanceMode: cloud.maintenanceMode,
    adsGlobalEnabled: cloud.adsGlobalEnabled,
    adPacing: {
      dismissCooldownMinutes: cloud.dismissCooldownMinutes,
      largeAdIntervalMinutes: cloud.largeAdIntervalMinutes,
      playerAdIntervalMinutes: cloud.playerAdIntervalMinutes,
      headerAdAlwaysVisible: cloud.headerAdAlwaysVisible,
    },
    defaultLanguage: cloud.defaultLanguage,
    updatedAt: cloud.updatedAt,
  };
}

export function cloudAdToPublicAdItem(ad: CloudPublicAdRecord): PublicAdItem {
  return {
    id: ad.id,
    name: ad.name,
    title: ad.title,
    description: ad.description,
    format: ad.format,
    mediaKind: ad.mediaKind,
    imageUrl: ad.imageUrl,
    videoUrl: ad.videoUrl,
    destinationUrl: ad.destinationUrl,
    ctaText: ad.ctaText,
    placements: ad.placements,
    frequencyPerSession: ad.frequencyPerSession,
    autoplay: ad.autoplay,
    startMuted: ad.startMuted,
    skippable: ad.skippable,
    skipAfterSeconds: ad.skipAfterSeconds,
    durationSeconds: ad.durationSeconds,
    priority: ad.priority,
  };
}

export function cloudAdToCampaignFallback(ad: CloudPublicAdRecord): AdCampaign {
  return {
    id: ad.id,
    name: ad.name,
    title: ad.title,
    description: ad.description,
    format: ad.format,
    mediaKind: ad.mediaKind,
    imageUrl: ad.imageUrl,
    videoUrl: ad.videoUrl,
    destinationUrl: ad.destinationUrl,
    ctaText: ad.ctaText,
    startDate: ad.startDate || '',
    endDate: ad.endDate || '',
    status: ad.status,
    priority: ad.priority,
    placements: ad.placements,
    frequencyPerSession: ad.frequencyPerSession,
    maxImpressions: ad.maxImpressions ?? null,
    targetAudience: ad.targetAudience || 'Todos os visitantes',
    countries: ad.countries || [],
    devices: ad.devices,
    autoplay: ad.autoplay,
    startMuted: ad.startMuted,
    skippable: ad.skippable,
    skipAfterSeconds: ad.skipAfterSeconds,
    durationSeconds: ad.durationSeconds,
    impressions: ad.impressions || 0,
    clicks: ad.clicks || 0,
    videoViews: ad.videoViews || 0,
    videoCompletes: ad.videoCompletes || 0,
    videoPartials: ad.videoPartials || 0,
    totalWatchSeconds: ad.totalWatchSeconds || 0,
    byDevice: {
      desktop: { impressions: 0, clicks: 0 },
      mobile: { impressions: 0, clicks: 0 },
      tablet: { impressions: 0, clicks: 0 },
    },
    dailyStats: [],
    createdAt: ad.createdAtIso || ad.updatedAt,
    updatedAt: ad.updatedAt,
  };
}

export async function fetchCloudSystemConfig(): Promise<CloudSystemPublicConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'systemConfig', 'public'));
    if (!snap.exists()) return null;
    const parsed = parseCloudSystemConfig(snap.data() as Record<string, unknown>);
    cachedCloudSystemConfig = parsed;
    return parsed;
  } catch (err) {
    console.warn('[MOVIX Cloud Sync] Unable to read systemConfig/public:', err);
    return cachedCloudSystemConfig;
  }
}

export function subscribeCloudSystemConfig(
  onConfig: (cfg: CloudSystemPublicConfig | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'systemConfig', 'public'),
    (snap) => {
      if (!snap.exists()) {
        onConfig(null);
        return;
      }
      const parsed = parseCloudSystemConfig(snap.data() as Record<string, unknown>);
      cachedCloudSystemConfig = parsed;
      onConfig(parsed);
    },
    (err) => {
      console.warn('[MOVIX Cloud Sync] systemConfig/public listener warning:', err);
    }
  );
}

export async function upsertCloudSystemConfig(
  patch: Partial<CloudSystemPublicConfig>,
  fallback?: Partial<SiteIdentityConfig> | null
): Promise<boolean> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }

  const ref = doc(db, 'systemConfig', 'public');
  try {
    const existingSnap = await getDoc(ref).catch(() => null);
    const existing =
      existingSnap && existingSnap.exists()
        ? parseCloudSystemConfig(existingSnap.data() as Record<string, unknown>)
        : cachedCloudSystemConfig;

    const mergedPlatformName = clampString(
      patch.platformName ?? fallback?.platformName ?? existing?.platformName ?? 'MOVIX',
      80,
      'MOVIX'
    );
    const mergedLogoUrl = clampString(
      patch.logoUrl ?? fallback?.logoUrl ?? existing?.logoUrl ?? '',
      500,
      ''
    );
    const mergedFaviconUrl = clampString(
      patch.faviconUrl ?? fallback?.faviconUrl ?? existing?.faviconUrl ?? '',
      500,
      ''
    );
    const mergedPrimaryColor = clampString(
      patch.primaryColor ?? fallback?.primaryColor ?? existing?.primaryColor ?? '#E5B85A',
      20,
      '#E5B85A'
    );
    const mergedHeroTagline = clampString(
      patch.heroTagline ?? fallback?.heroTagline ?? existing?.heroTagline ?? '',
      200,
      ''
    );
    const mergedSeoTitle = clampString(
      patch.seoTitle ?? fallback?.seoTitle ?? existing?.seoTitle ?? 'MOVIX',
      160,
      'MOVIX'
    );
    const mergedSeoDescription = clampString(
      patch.seoDescription ?? fallback?.seoDescription ?? existing?.seoDescription ?? '',
      400,
      ''
    );
    const mergedSeoKeywords = clampString(
      patch.seoKeywords ?? fallback?.seoKeywords ?? existing?.seoKeywords ?? '',
      300,
      ''
    );
    const mergedAboutUs = clampString(
      patch.aboutUs ?? fallback?.aboutUs ?? existing?.aboutUs ?? '',
      5000,
      ''
    );
    const mergedPrivacyPolicy = clampString(
      patch.privacyPolicy ?? fallback?.privacyPolicy ?? existing?.privacyPolicy ?? '',
      8000,
      ''
    );
    const mergedTermsOfUse = clampString(
      patch.termsOfUse ?? fallback?.termsOfUse ?? existing?.termsOfUse ?? '',
      8000,
      ''
    );
    const mergedContactEmail = clampString(
      patch.contactEmail ?? fallback?.contactEmail ?? existing?.contactEmail ?? '',
      120,
      ''
    );
    const mergedContactPhone = clampString(
      patch.contactPhone ?? fallback?.contactPhone ?? existing?.contactPhone ?? '',
      40,
      ''
    );
    const mergedSocialInstagram = clampString(
      patch.socialInstagram ?? fallback?.socialInstagram ?? existing?.socialInstagram ?? '',
      500,
      ''
    );
    const mergedSocialYoutube = clampString(
      patch.socialYoutube ?? fallback?.socialYoutube ?? existing?.socialYoutube ?? '',
      500,
      ''
    );
    const mergedSocialTelegram = clampString(
      patch.socialTelegram ?? fallback?.socialTelegram ?? existing?.socialTelegram ?? '',
      500,
      ''
    );
    const mergedSocialTwitter = clampString(
      patch.socialTwitter ?? fallback?.socialTwitter ?? existing?.socialTwitter ?? '',
      500,
      ''
    );
    const mergedDefaultLanguage = sanitizeLanguage(
      patch.defaultLanguage ?? fallback?.defaultLanguage ?? existing?.defaultLanguage ?? 'pt-BR'
    );
    const mergedMaintenanceMode =
      patch.maintenanceMode !== undefined
        ? Boolean(patch.maintenanceMode)
        : fallback?.maintenanceMode !== undefined
          ? Boolean(fallback.maintenanceMode)
          : Boolean(existing?.maintenanceMode ?? false);
    const mergedAdsGlobalEnabled =
      patch.adsGlobalEnabled !== undefined
        ? Boolean(patch.adsGlobalEnabled)
        : fallback?.adsGlobalEnabled !== undefined
          ? Boolean(fallback.adsGlobalEnabled)
          : existing?.adsGlobalEnabled !== undefined
            ? existing.adsGlobalEnabled
            : true;
    const mergedDismissCooldown = clampInt(
      patch.dismissCooldownMinutes ??
        fallback?.adPacing?.dismissCooldownMinutes ??
        existing?.dismissCooldownMinutes ??
        DEFAULT_AD_PACING.dismissCooldownMinutes,
      1,
      1440,
      DEFAULT_AD_PACING.dismissCooldownMinutes
    );
    const mergedLargeInterval = clampInt(
      patch.largeAdIntervalMinutes ??
        fallback?.adPacing?.largeAdIntervalMinutes ??
        existing?.largeAdIntervalMinutes ??
        DEFAULT_AD_PACING.largeAdIntervalMinutes,
      0,
      1440,
      DEFAULT_AD_PACING.largeAdIntervalMinutes
    );
    const mergedPlayerInterval = clampInt(
      patch.playerAdIntervalMinutes ??
        fallback?.adPacing?.playerAdIntervalMinutes ??
        existing?.playerAdIntervalMinutes ??
        DEFAULT_AD_PACING.playerAdIntervalMinutes,
      0,
      1440,
      DEFAULT_AD_PACING.playerAdIntervalMinutes
    );
    const mergedHeaderAlways =
      patch.headerAdAlwaysVisible !== undefined
        ? Boolean(patch.headerAdAlwaysVisible)
        : fallback?.adPacing?.headerAdAlwaysVisible !== undefined
          ? Boolean(fallback.adPacing.headerAdAlwaysVisible)
          : existing?.headerAdAlwaysVisible !== undefined
            ? existing.headerAdAlwaysVisible
            : DEFAULT_AD_PACING.headerAdAlwaysVisible;

    await setDoc(ref, {
      platformName: mergedPlatformName,
      logoUrl: mergedLogoUrl,
      faviconUrl: mergedFaviconUrl,
      primaryColor: mergedPrimaryColor,
      heroTagline: mergedHeroTagline,
      seoTitle: mergedSeoTitle,
      seoDescription: mergedSeoDescription,
      seoKeywords: mergedSeoKeywords,
      aboutUs: mergedAboutUs,
      privacyPolicy: mergedPrivacyPolicy,
      termsOfUse: mergedTermsOfUse,
      contactEmail: mergedContactEmail,
      contactPhone: mergedContactPhone,
      socialInstagram: mergedSocialInstagram,
      socialYoutube: mergedSocialYoutube,
      socialTelegram: mergedSocialTelegram,
      socialTwitter: mergedSocialTwitter,
      defaultLanguage: mergedDefaultLanguage,
      maintenanceMode: mergedMaintenanceMode,
      adsGlobalEnabled: mergedAdsGlobalEnabled,
      dismissCooldownMinutes: mergedDismissCooldown,
      largeAdIntervalMinutes: mergedLargeInterval,
      playerAdIntervalMinutes: mergedPlayerInterval,
      headerAdAlwaysVisible: mergedHeaderAlways,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });

    cachedCloudSystemConfig = {
      platformName: mergedPlatformName,
      logoUrl: mergedLogoUrl,
      faviconUrl: mergedFaviconUrl,
      primaryColor: mergedPrimaryColor,
      heroTagline: mergedHeroTagline,
      seoTitle: mergedSeoTitle,
      seoDescription: mergedSeoDescription,
      seoKeywords: mergedSeoKeywords,
      aboutUs: mergedAboutUs,
      privacyPolicy: mergedPrivacyPolicy,
      termsOfUse: mergedTermsOfUse,
      contactEmail: mergedContactEmail,
      contactPhone: mergedContactPhone,
      socialInstagram: mergedSocialInstagram,
      socialYoutube: mergedSocialYoutube,
      socialTelegram: mergedSocialTelegram,
      socialTwitter: mergedSocialTwitter,
      defaultLanguage: mergedDefaultLanguage,
      maintenanceMode: mergedMaintenanceMode,
      adsGlobalEnabled: mergedAdsGlobalEnabled,
      dismissCooldownMinutes: mergedDismissCooldown,
      largeAdIntervalMinutes: mergedLargeInterval,
      playerAdIntervalMinutes: mergedPlayerInterval,
      headerAdAlwaysVisible: mergedHeaderAlways,
      updatedAt: new Date().toISOString(),
    };
    return true;
  } catch (err) {
    console.error('[MOVIX Cloud Sync] Failed to write systemConfig/public:', err);
    return false;
  }
}

export async function fetchCloudPublicAds(includeAllForAdmin = false): Promise<CloudPublicAdRecord[]> {
  try {
    const useAdminQuery = includeAllForAdmin && isVerifiedFirebaseAdmin(auth.currentUser);
    const q = useAdminQuery
      ? query(collection(db, 'publicAds'))
      : query(collection(db, 'publicAds'), where('status', '==', 'active'));
    const snap = await getDocs(q);
    const list = snap.docs.map((docSnap) =>
      parseCloudPublicAd(docSnap.id, docSnap.data() as Record<string, unknown>)
    );
    cachedCloudActiveAds = list.filter((item) => item.status === 'active');
    cloudActiveAdsLoaded = true;
    return list;
  } catch (err) {
    console.warn('[MOVIX Cloud Sync] Unable to read publicAds:', err);
    return cachedCloudActiveAds || [];
  }
}

export function subscribeCloudActiveAds(
  onAds: (ads: CloudPublicAdRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'publicAds'), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((docSnap) => parseCloudPublicAd(docSnap.id, docSnap.data() as Record<string, unknown>))
        .filter((item) => item.status === 'active');
      cachedCloudActiveAds = list;
      cloudActiveAdsLoaded = true;
      onAds(list);
    },
    (err) => {
      console.warn('[MOVIX Cloud Sync] publicAds listener warning:', err);
    }
  );
}

export async function upsertCloudPublicAd(ad: AdCampaign): Promise<boolean> {
  // Always keep local active-ads cache immediately consistent (especially when pausing/drafting an ad)
  syncLocalCloudActiveAdCache(ad);

  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeId = sanitizeDocId(ad.id, 'ad');
  const safePlacements = (Array.isArray(ad.placements) ? ad.placements : ['home'])
    .map((p) => String(p).trim())
    .filter(Boolean)
    .slice(0, 20);
  const safeDevices = (Array.isArray(ad.devices) ? ad.devices : ['all'])
    .map((d) => String(d).trim())
    .filter(Boolean)
    .slice(0, 6);
  const safeCountries = (Array.isArray(ad.countries) ? ad.countries : [])
    .map((c) => String(c).trim().toUpperCase().slice(0, 10))
    .filter(Boolean)
    .slice(0, 50);
  const safeStatus = ALLOWED_AD_STATUSES.has(ad.status) ? ad.status : 'paused';

  try {
    await setDoc(doc(db, 'publicAds', safeId), {
      id: safeId,
      name: clampString(ad.name, 160, 'Campanha MOVIX'),
      title: clampString(ad.title, 200, ''),
      description: clampString(ad.description, 600, ''),
      format: clampString(ad.format, 40, 'banner_horizontal'),
      mediaKind: ad.mediaKind === 'video' ? 'video' : 'image',
      imageUrl: clampString(ad.imageUrl, 1000, ''),
      videoUrl: clampString(ad.videoUrl, 1000, ''),
      destinationUrl: clampString(ad.destinationUrl, 1000, ''),
      ctaText: clampString(ad.ctaText, 80, 'Saiba mais'),
      status: safeStatus,
      priority: clampInt(ad.priority, 1, 100, 10),
      placements: safePlacements.length > 0 ? safePlacements : ['home'],
      devices: safeDevices.length > 0 ? safeDevices : ['all'],
      autoplay: ad.autoplay !== false,
      startMuted: Boolean(ad.startMuted),
      skippable: ad.skippable !== false,
      skipAfterSeconds: clampInt(ad.skipAfterSeconds, 0, 120, 5),
      durationSeconds: clampInt(ad.durationSeconds, 1, 300, 15),
      frequencyPerSession: clampInt(ad.frequencyPerSession, 1, 100, 3),
      startDate: clampString(ad.startDate, 40, ''),
      endDate: clampString(ad.endDate, 40, ''),
      maxImpressions:
        typeof ad.maxImpressions === 'number' && Number.isFinite(ad.maxImpressions)
          ? Math.max(0, Math.floor(ad.maxImpressions))
          : null,
      targetAudience: clampString(ad.targetAudience, 200, 'Todos os visitantes'),
      countries: safeCountries,
      impressions: clampInt(ad.impressions, 0, 1000000000, 0),
      clicks: clampInt(ad.clicks, 0, 1000000000, 0),
      videoViews: clampInt(ad.videoViews, 0, 1000000000, 0),
      videoCompletes: clampInt(ad.videoCompletes, 0, 1000000000, 0),
      videoPartials: clampInt(ad.videoPartials, 0, 1000000000, 0),
      totalWatchSeconds: clampNumber(ad.totalWatchSeconds, 0, 1000000000, 0),
      createdAtIso: clampString(ad.createdAt, 40, new Date().toISOString()),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to write publicAds/${safeId}:`, err);
    return false;
  }
}

export async function deleteCloudPublicAd(adId: string): Promise<boolean> {
  removeLocalCloudActiveAdCache(adId);
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeId = sanitizeDocId(adId, 'ad');
  try {
    await deleteDoc(doc(db, 'publicAds', safeId));
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to delete publicAds/${safeId}:`, err);
    return false;
  }
}

// =========================================================================
// Permanent Cloud Catalog Lists (/publicCatalogLists/{listId})
// =========================================================================

export async function fetchCloudCatalogList<T = Record<string, unknown>>(
  listId: CloudCatalogListId
): Promise<T[] | null> {
  try {
    const snap = await getDoc(doc(db, 'publicCatalogLists', listId));
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return Array.isArray(data.items) ? (data.items as T[]) : [];
  } catch (err) {
    console.warn(`[MOVIX Cloud Sync] Unable to read publicCatalogLists/${listId}:`, err);
    return null;
  }
}

export async function upsertCloudCatalogList(
  listId: CloudCatalogListId,
  items: unknown[]
): Promise<boolean> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeItems = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === 'object')
    .slice(0, 100)
    .map((item) => stripUndefinedDeep(item));

  try {
    await setDoc(doc(db, 'publicCatalogLists', listId), {
      listId,
      items: safeItems,
      itemCount: safeItems.length,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to write publicCatalogLists/${listId}:`, err);
    return false;
  }
}

// =========================================================================
// Permanent Cloud Movies (/publicMovies/{movieId})
// =========================================================================

function sanitizeServerLinksForCloud(input: unknown): PlaybackServerLink[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .slice(0, 20)
    .map((s, idx): PlaybackServerLink => {
      const language: PlaybackServerLink['language'] =
        s.language === 'legendado'
          ? 'legendado'
          : s.language === 'dual'
          ? 'dual'
          : 'dublado';
      const type: PlaybackServerLink['type'] = s.type === 'stream' ? 'stream' : 'embed';
      return {
        id: clampString(String(s.id ?? ''), 80, `srv_${idx + 1}`),
        name: clampString(String(s.name ?? ''), 80, `Servidor ${idx + 1}`),
        url: clampString(String(s.url ?? ''), 600, ''),
        language,
        quality: clampString(String(s.quality ?? ''), 30, 'HD 1080p'),
        type,
        active: s.active !== false,
        order: clampInt(s.order, 0, 999, idx + 1),
      };
    })
    .filter((s) => Boolean(s.url));
}

function parseCloudMovie(id: string, data: Record<string, unknown>): ManagedMovie {
  const updatedAtObj = data.updatedAt as { toDate?: () => Date } | undefined;
  const updatedAtIso =
    updatedAtObj && typeof updatedAtObj.toDate === 'function'
      ? updatedAtObj.toDate().toISOString()
      : new Date().toISOString();
  return {
    id: clampString(String(data.id || id), 128, id),
    tmdbId:
      typeof data.tmdbId === 'number' && Number.isFinite(data.tmdbId) && data.tmdbId >= 1
        ? Math.floor(data.tmdbId)
        : null,
    title: clampString(String(data.title ?? ''), 160, 'Sem título'),
    originalTitle: clampString(String(data.originalTitle ?? ''), 160, ''),
    overview: clampString(String(data.overview ?? ''), 3000, ''),
    posterUrl: clampString(String(data.posterUrl ?? ''), 1000, ''),
    backdropUrl: clampString(String(data.backdropUrl ?? ''), 1000, ''),
    trailerUrl: clampString(String(data.trailerUrl ?? ''), 600, ''),
    releaseDate: clampString(String(data.releaseDate ?? ''), 25, ''),
    year: clampString(String(data.year ?? ''), 10, ''),
    runtime: clampInt(data.runtime, 0, 1000, 0),
    language: clampString(String(data.language ?? ''), 30, 'pt-BR'),
    certification: clampString(String(data.certification ?? ''), 16, '14'),
    rating: clampNumber(data.rating, 0, 10, 0),
    categories: Array.isArray(data.categories)
      ? data.categories.filter((c): c is string => typeof c === 'string' && Boolean(c)).slice(0, 12)
      : [],
    genres: Array.isArray(data.genres)
      ? data.genres.filter((g): g is string => typeof g === 'string' && Boolean(g)).slice(0, 12)
      : [],
    servers: sanitizeServerLinksForCloud(data.servers),
    featured: Boolean(data.featured),
    recommended: Boolean(data.recommended),
    published: data.published !== false,
    views: clampInt(data.views, 0, 1000000000, 0),
    createdAt: clampString(String(data.createdAtIso ?? ''), 40, updatedAtIso),
    updatedAt: updatedAtIso,
  };
}

export async function fetchCloudMovies(includeAllForAdmin = false): Promise<ManagedMovie[]> {
  try {
    const useAdminQuery = includeAllForAdmin && isVerifiedFirebaseAdmin(auth.currentUser);
    const q = useAdminQuery
      ? query(collection(db, 'publicMovies'))
      : query(collection(db, 'publicMovies'), where('published', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) =>
      parseCloudMovie(docSnap.id, docSnap.data() as Record<string, unknown>)
    );
  } catch (err) {
    console.warn('[MOVIX Cloud Sync] Unable to read publicMovies:', err);
    return [];
  }
}

export async function upsertCloudMovie(movie: ManagedMovie): Promise<boolean> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeId = sanitizeDocId(movie.id, 'mov');
  const safeTitle = clampString(movie.title, 160, 'Filme MOVIX');
  const safeCategories = (Array.isArray(movie.categories) ? movie.categories : [])
    .map((c) => String(c).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
  const safeGenres = (Array.isArray(movie.genres) ? movie.genres : [])
    .map((g) => String(g).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);

  try {
    await setDoc(doc(db, 'publicMovies', safeId), {
      id: safeId,
      tmdbId:
        typeof movie.tmdbId === 'number' && Number.isFinite(movie.tmdbId) && movie.tmdbId >= 1
          ? Math.floor(movie.tmdbId)
          : null,
      title: safeTitle,
      originalTitle: clampString(movie.originalTitle, 160, safeTitle),
      overview: clampString(movie.overview, 3000, ''),
      posterUrl: clampString(movie.posterUrl, 1000, ''),
      backdropUrl: clampString(movie.backdropUrl, 1000, ''),
      trailerUrl: clampString(movie.trailerUrl, 600, ''),
      releaseDate: clampString(movie.releaseDate, 25, ''),
      year: clampString(movie.year, 10, ''),
      runtime: clampInt(movie.runtime, 0, 1000, 0),
      language: clampString(movie.language, 30, 'pt-BR'),
      certification: clampString(movie.certification, 16, '14'),
      rating: clampNumber(movie.rating, 0, 10, 0),
      categories: safeCategories,
      genres: safeGenres,
      servers: sanitizeServerLinksForCloud(movie.servers),
      featured: Boolean(movie.featured),
      recommended: Boolean(movie.recommended),
      published: movie.published !== false,
      views: clampInt(movie.views, 0, 1000000000, 0),
      createdAtIso: clampString(movie.createdAt, 40, new Date().toISOString()),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to write publicMovies/${safeId}:`, err);
    return false;
  }
}

export async function deleteCloudMovie(movieId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeId = sanitizeDocId(movieId, 'mov');
  try {
    await deleteDoc(doc(db, 'publicMovies', safeId));
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to delete publicMovies/${safeId}:`, err);
    return false;
  }
}

// =========================================================================
// Permanent Cloud Series (/publicSeries/{seriesId})
// =========================================================================

function sanitizeSeasonsForCloud(input: unknown, fallbackNow: string): ManagedSeason[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .slice(0, 40)
    .map((s, sIdx) => ({
      id: clampString(String(s.id ?? ''), 80, `sea_${sIdx + 1}`),
      seasonNumber: clampInt(s.seasonNumber, 0, 200, sIdx + 1),
      title: clampString(String(s.title ?? ''), 120, `Temporada ${sIdx + 1}`),
      overview: clampString(String(s.overview ?? ''), 2000, ''),
      posterUrl: clampString(String(s.posterUrl ?? ''), 1000, ''),
      published: s.published !== false,
      episodes: Array.isArray(s.episodes)
        ? s.episodes
            .filter((ep): ep is Record<string, unknown> => Boolean(ep && typeof ep === 'object'))
            .slice(0, 200)
            .map((ep, eIdx): ManagedEpisode => ({
              id: clampString(String(ep.id ?? ''), 80, `ep_${sIdx + 1}_${eIdx + 1}`),
              episodeNumber: clampInt(ep.episodeNumber, 1, 2000, eIdx + 1),
              title: clampString(String(ep.title ?? ''), 140, `Episódio ${eIdx + 1}`),
              overview: clampString(String(ep.overview ?? ''), 2000, ''),
              stillUrl: clampString(String(ep.stillUrl ?? ''), 1000, ''),
              duration: clampInt(ep.duration, 0, 600, 45),
              airDate: clampString(String(ep.airDate ?? ''), 25, ''),
              servers: sanitizeServerLinksForCloud(ep.servers),
              published: ep.published !== false,
              views: clampInt(ep.views, 0, 1000000000, 0),
              createdAt: clampString(String(ep.createdAt ?? ''), 40, fallbackNow),
              updatedAt: clampString(String(ep.updatedAt ?? ''), 40, fallbackNow),
            }))
        : [],
      createdAt: clampString(String(s.createdAt ?? ''), 40, fallbackNow),
      updatedAt: clampString(String(s.updatedAt ?? ''), 40, fallbackNow),
    }));
}

function parseCloudSeries(id: string, data: Record<string, unknown>): ManagedSeries {
  const updatedAtObj = data.updatedAt as { toDate?: () => Date } | undefined;
  const updatedAtIso =
    updatedAtObj && typeof updatedAtObj.toDate === 'function'
      ? updatedAtObj.toDate().toISOString()
      : new Date().toISOString();
  return {
    id: clampString(String(data.id || id), 128, id),
    tmdbId:
      typeof data.tmdbId === 'number' && Number.isFinite(data.tmdbId) && data.tmdbId >= 1
        ? Math.floor(data.tmdbId)
        : null,
    title: clampString(String(data.title ?? ''), 160, 'Sem título'),
    originalTitle: clampString(String(data.originalTitle ?? ''), 160, ''),
    overview: clampString(String(data.overview ?? ''), 3000, ''),
    posterUrl: clampString(String(data.posterUrl ?? ''), 1000, ''),
    backdropUrl: clampString(String(data.backdropUrl ?? ''), 1000, ''),
    trailerUrl: clampString(String(data.trailerUrl ?? ''), 600, ''),
    releaseDate: clampString(String(data.releaseDate ?? ''), 25, ''),
    year: clampString(String(data.year ?? ''), 10, ''),
    language: clampString(String(data.language ?? ''), 30, 'pt-BR'),
    certification: clampString(String(data.certification ?? ''), 16, '14'),
    rating: clampNumber(data.rating, 0, 10, 0),
    categories: Array.isArray(data.categories)
      ? data.categories.filter((c): c is string => typeof c === 'string' && Boolean(c)).slice(0, 12)
      : [],
    genres: Array.isArray(data.genres)
      ? data.genres.filter((g): g is string => typeof g === 'string' && Boolean(g)).slice(0, 12)
      : [],
    featured: Boolean(data.featured),
    recommended: Boolean(data.recommended),
    published: data.published !== false,
    views: clampInt(data.views, 0, 1000000000, 0),
    seasons: sanitizeSeasonsForCloud(data.seasons, updatedAtIso),
    createdAt: clampString(String(data.createdAtIso ?? ''), 40, updatedAtIso),
    updatedAt: updatedAtIso,
  };
}

export async function fetchCloudSeries(includeAllForAdmin = false): Promise<ManagedSeries[]> {
  try {
    const useAdminQuery = includeAllForAdmin && isVerifiedFirebaseAdmin(auth.currentUser);
    const q = useAdminQuery
      ? query(collection(db, 'publicSeries'))
      : query(collection(db, 'publicSeries'), where('published', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) =>
      parseCloudSeries(docSnap.id, docSnap.data() as Record<string, unknown>)
    );
  } catch (err) {
    console.warn('[MOVIX Cloud Sync] Unable to read publicSeries:', err);
    return [];
  }
}

export async function upsertCloudSeries(series: ManagedSeries): Promise<boolean> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeId = sanitizeDocId(series.id, 'ser');
  const safeTitle = clampString(series.title, 160, 'Série MOVIX');
  const nowIso = new Date().toISOString();
  const safeCategories = (Array.isArray(series.categories) ? series.categories : [])
    .map((c) => String(c).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
  const safeGenres = (Array.isArray(series.genres) ? series.genres : [])
    .map((g) => String(g).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);

  try {
    await setDoc(doc(db, 'publicSeries', safeId), {
      id: safeId,
      tmdbId:
        typeof series.tmdbId === 'number' && Number.isFinite(series.tmdbId) && series.tmdbId >= 1
          ? Math.floor(series.tmdbId)
          : null,
      title: safeTitle,
      originalTitle: clampString(series.originalTitle, 160, safeTitle),
      overview: clampString(series.overview, 3000, ''),
      posterUrl: clampString(series.posterUrl, 1000, ''),
      backdropUrl: clampString(series.backdropUrl, 1000, ''),
      trailerUrl: clampString(series.trailerUrl, 600, ''),
      releaseDate: clampString(series.releaseDate, 25, ''),
      year: clampString(series.year, 10, ''),
      language: clampString(series.language, 30, 'pt-BR'),
      certification: clampString(series.certification, 16, '14'),
      rating: clampNumber(series.rating, 0, 10, 0),
      categories: safeCategories,
      genres: safeGenres,
      featured: Boolean(series.featured),
      recommended: Boolean(series.recommended),
      published: series.published !== false,
      views: clampInt(series.views, 0, 1000000000, 0),
      seasons: sanitizeSeasonsForCloud(series.seasons, nowIso),
      createdAtIso: clampString(series.createdAt, 40, nowIso),
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to write publicSeries/${safeId}:`, err);
    return false;
  }
}

export async function deleteCloudSeries(seriesId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return false;
  }
  const safeId = sanitizeDocId(seriesId, 'ser');
  try {
    await deleteDoc(doc(db, 'publicSeries', safeId));
    return true;
  } catch (err) {
    console.error(`[MOVIX Cloud Sync] Failed to delete publicSeries/${safeId}:`, err);
    return false;
  }
}

// =========================================================================
// Permanent Cloud-Backed Uploaded Media Assets (/publicMedia/{mediaId})
// =========================================================================

export function extractCloudMediaId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const match = /[?&]cm=([a-zA-Z0-9_-]{1,128})(?:&|$)/.exec(url);
  return match ? match[1] : null;
}

export function getCachedCloudMediaDataUrl(url: string | null | undefined): string | null {
  const mediaId = extractCloudMediaId(url);
  if (!mediaId) return null;
  return cloudMediaAssetCache.get(mediaId)?.dataUrl || null;
}

export async function fetchCloudMediaAsset(mediaId: string): Promise<CloudMediaAssetRecord | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(mediaId)) return null;
  const cached = cloudMediaAssetCache.get(mediaId);
  if (cached) return cached;

  const existingPromise = cloudMediaInFlight.get(mediaId);
  if (existingPromise) return existingPromise;

  const promise = (async (): Promise<CloudMediaAssetRecord | null> => {
    try {
      const snap = await getDoc(doc(db, 'publicMedia', mediaId));
      if (!snap.exists()) return null;
      const d = snap.data() as Record<string, unknown>;
      const dataUrl = typeof d.dataUrl === 'string' ? d.dataUrl : '';
      if (!dataUrl || (!dataUrl.startsWith('data:image/') && !dataUrl.startsWith('data:video/'))) {
        return null;
      }
      const updatedAtObj = d.updatedAt as { toDate?: () => Date } | undefined;
      const record: CloudMediaAssetRecord = {
        id: mediaId,
        folder: clampString(String(d.folder ?? ''), 32, 'ads-images'),
        filename: clampString(String(d.filename ?? ''), 128, `${mediaId}.webp`),
        mimeType: clampString(String(d.mimeType ?? ''), 40, 'image/webp'),
        dataUrl,
        sizeBytes: clampInt(d.sizeBytes, 1, 700000, dataUrl.length),
        updatedAt:
          updatedAtObj && typeof updatedAtObj.toDate === 'function'
            ? updatedAtObj.toDate().toISOString()
            : new Date().toISOString(),
      };
      cloudMediaAssetCache.set(mediaId, record);
      return record;
    } catch (err) {
      console.warn(`[MOVIX Cloud Media] Unable to read publicMedia/${mediaId}:`, err);
      return null;
    } finally {
      cloudMediaInFlight.delete(mediaId);
    }
  })();

  cloudMediaInFlight.set(mediaId, promise);
  return promise;
}

export async function resolveCloudMediaUrl(url: string | null | undefined): Promise<string> {
  if (!url) return '';
  const mediaId = extractCloudMediaId(url);
  if (!mediaId) return url;
  const asset = await fetchCloudMediaAsset(mediaId);
  return asset?.dataUrl || url;
}

export async function upsertCloudMediaAsset(params: {
  id?: string;
  folder: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}): Promise<string | null> {
  const user = auth.currentUser;
  if (!isVerifiedFirebaseAdmin(user) || !user) {
    return null;
  }
  const safeFolder = ALLOWED_MEDIA_FOLDERS.has(params.folder) ? params.folder : 'ads-images';
  const safeMime = ALLOWED_MEDIA_MIMES.has(params.mimeType) ? params.mimeType : '';
  const safeFilename = (params.filename || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  const dataUrl = params.dataUrl || '';
  if (
    !safeMime ||
    !safeFilename ||
    dataUrl.length < 20 ||
    dataUrl.length > 700000 ||
    (!dataUrl.startsWith('data:image/') && !dataUrl.startsWith('data:video/'))
  ) {
    return null;
  }

  const safeId = sanitizeDocId(
    params.id || `med_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    'med'
  );
  const safeSize = clampInt(params.sizeBytes || dataUrl.length, 1, 700000, dataUrl.length);

  try {
    await setDoc(doc(db, 'publicMedia', safeId), {
      id: safeId,
      folder: safeFolder,
      filename: safeFilename,
      mimeType: safeMime,
      dataUrl,
      sizeBytes: safeSize,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
    cloudMediaAssetCache.set(safeId, {
      id: safeId,
      folder: safeFolder,
      filename: safeFilename,
      mimeType: safeMime,
      dataUrl,
      sizeBytes: safeSize,
      updatedAt: new Date().toISOString(),
    });
    return safeId;
  } catch (err) {
    console.error(`[MOVIX Cloud Media] Failed to write publicMedia/${safeId}:`, err);
    return null;
  }
}


