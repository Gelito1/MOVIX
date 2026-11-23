import fs from 'fs';
import path from 'path';

export interface BannerItem {
  id: string;
  title: string;
  subtitle: string;
  tmdbId: number | null;
  mediaType: 'movie' | 'tv';
  backdropUrl: string;
  posterUrl: string;
  year: string;
  rating: number;
  genres: string[];
  active: boolean;
  order: number;
}

export interface HighlightItem {
  id: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterUrl: string;
  backdropUrl: string;
  year: string;
  rating: number;
  label: string;
  active: boolean;
  order: number;
}

export interface ManagedCategory {
  id: string;
  name: string;
  source: 'tmdb' | 'megambd';
  externalId: string;
  mediaType: 'movie' | 'tv';
  imageUrl?: string;
  visible: boolean;
  order: number;
}

export type PushCategory =
  | 'welcome'
  | 'new_movies'
  | 'new_seasons'
  | 'app_updates'
  | 'recommendations';

export interface PushPrefs {
  new_movies: boolean;
  new_seasons: boolean;
  app_updates: boolean;
  recommendations: boolean;
}

export interface PushSubscriptionRecord {
  id: string;
  user_id: string | null;
  fcm_token: string;
  device_info: string;
  welcome_sent: boolean;
  prefs: PushPrefs;
  created_at: string;
  updated_at: string;
}

export interface PushCampaignRecord {
  id: string;
  title: string;
  body: string;
  image_url: string;
  target_url: string;
  category: PushCategory;
  status: 'sent' | 'scheduled' | 'failed';
  scheduled_for: string | null;
  sent_at: string | null;
  created_at: string;
  targeted_count: number;
  success_count: number;
  failure_count: number;
  cleaned_tokens_count: number;
  note?: string;
}

export interface ApiErrorLog {
  id: string;
  timestamp: string;
  service: 'TMDB' | 'MegamBD' | 'Stream' | 'Sistema';
  endpoint: string;
  statusCode: number;
  message: string;
}

interface StoreData {
  adminPasswordHash: string | null;
  adultPinHash: string | null;
  banners: BannerItem[];
  highlights: HighlightItem[];
  categories: ManagedCategory[];
  errorLogs: ApiErrorLog[];
  pushSubscriptions: PushSubscriptionRecord[];
  pushCampaigns: PushCampaignRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'movix-store.json');

const DEFAULT_CATEGORIES: ManagedCategory[] = [
  { id: 'cat-series', name: 'Séries', source: 'tmdb', externalId: 'popular', mediaType: 'tv', visible: true, order: 1 },
  { id: 'cat-filmes', name: 'Filmes', source: 'tmdb', externalId: 'popular', mediaType: 'movie', visible: true, order: 2 },
  { id: 'cat-animes', name: 'Animes', source: 'tmdb', externalId: 'animes', mediaType: 'tv', visible: true, order: 3 },
  { id: 'cat-novelas', name: 'Novelas', source: 'tmdb', externalId: 'novelas', mediaType: 'tv', visible: true, order: 4 },
  { id: 'cat-doramas', name: 'Doramas', source: 'tmdb', externalId: 'doramas', mediaType: 'tv', visible: true, order: 5 },
  { id: 'cat-dramas', name: 'Dramas', source: 'tmdb', externalId: 'dramas', mediaType: 'movie', visible: true, order: 6 },
  { id: 'cat-infantil', name: 'Infantil', source: 'tmdb', externalId: 'infantil', mediaType: 'movie', visible: true, order: 7 },
  { id: 'cat-docs', name: 'Documentários', source: 'tmdb', externalId: 'documentarios', mediaType: 'movie', visible: true, order: 8 },
];

let storeState: StoreData = {
  adminPasswordHash: null,
  adultPinHash: null,
  banners: [],
  highlights: [],
  categories: DEFAULT_CATEGORIES,
  errorLogs: [],
  pushSubscriptions: [],
  pushCampaigns: [],
};

function loadStoreFromDisk(): void {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      storeState = {
        adminPasswordHash: typeof parsed.adminPasswordHash === 'string' ? parsed.adminPasswordHash : null,
        adultPinHash: typeof parsed.adultPinHash === 'string' ? parsed.adultPinHash : null,
        banners: Array.isArray(parsed.banners) ? parsed.banners : [],
        highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
        categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : DEFAULT_CATEGORIES,
        errorLogs: Array.isArray(parsed.errorLogs) ? parsed.errorLogs.slice(0, 100) : [],
        pushSubscriptions: Array.isArray(parsed.pushSubscriptions) ? parsed.pushSubscriptions.slice(0, 5000) : [],
        pushCampaigns: Array.isArray(parsed.pushCampaigns) ? parsed.pushCampaigns.slice(0, 200) : [],
      };
    }
  } catch {
    // Keep defaults if file is unreadable
  }
}

function saveStoreToDisk(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(storeState, null, 2), 'utf-8');
  } catch {
    // Ignore disk write issues
  }
}

loadStoreFromDisk();

export function getStore(): StoreData {
  return storeState;
}

export function setAdminPasswordHash(hash: string): boolean {
  if (storeState.adminPasswordHash) {
    return false;
  }
  storeState.adminPasswordHash = hash;
  saveStoreToDisk();
  return true;
}

export function getAdminPasswordHash(): string | null {
  return storeState.adminPasswordHash;
}

export function getAdultPinHash(): string | null {
  return storeState.adultPinHash;
}

export function setAdultPinHash(hash: string, force = false): boolean {
  if (storeState.adultPinHash && !force) {
    return false;
  }
  storeState.adultPinHash = hash;
  saveStoreToDisk();
  return true;
}

export function setBanners(banners: BannerItem[]): BannerItem[] {
  storeState.banners = banners;
  saveStoreToDisk();
  return storeState.banners;
}

export function setHighlights(highlights: HighlightItem[]): HighlightItem[] {
  storeState.highlights = highlights;
  saveStoreToDisk();
  return storeState.highlights;
}

export function setCategories(categories: ManagedCategory[]): ManagedCategory[] {
  storeState.categories = categories;
  saveStoreToDisk();
  return storeState.categories;
}

export function recordApiError(
  service: ApiErrorLog['service'],
  endpoint: string,
  statusCode: number,
  message: string
): void {
  const entry: ApiErrorLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    service,
    endpoint,
    statusCode,
    message,
  };
  storeState.errorLogs = [entry, ...storeState.errorLogs].slice(0, 100);
  saveStoreToDisk();
}

export function clearErrorLogs(): void {
  storeState.errorLogs = [];
  saveStoreToDisk();
}

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  new_movies: true,
  new_seasons: true,
  app_updates: true,
  recommendations: true,
};

export function sanitizePushPrefs(input: Partial<PushPrefs> | null | undefined, fallback = DEFAULT_PUSH_PREFS): PushPrefs {
  return {
    new_movies: typeof input?.new_movies === 'boolean' ? input.new_movies : fallback.new_movies,
    new_seasons: typeof input?.new_seasons === 'boolean' ? input.new_seasons : fallback.new_seasons,
    app_updates: typeof input?.app_updates === 'boolean' ? input.app_updates : fallback.app_updates,
    recommendations:
      typeof input?.recommendations === 'boolean' ? input.recommendations : fallback.recommendations,
  };
}

export function listPushSubscriptions(): PushSubscriptionRecord[] {
  return storeState.pushSubscriptions;
}

export function getPushSubscriptionByToken(token: string): PushSubscriptionRecord | null {
  return storeState.pushSubscriptions.find((s) => s.fcm_token === token) || null;
}

export function upsertPushSubscription(params: {
  user_id?: string | null;
  fcm_token: string;
  device_info?: string;
  prefs?: Partial<PushPrefs>;
}): { record: PushSubscriptionRecord; isNew: boolean } {
  const now = new Date().toISOString();
  const idx = storeState.pushSubscriptions.findIndex((s) => s.fcm_token === params.fcm_token);
  if (idx >= 0) {
    const existing = storeState.pushSubscriptions[idx];
    const updated: PushSubscriptionRecord = {
      ...existing,
      user_id: params.user_id !== undefined ? params.user_id : existing.user_id,
      device_info: params.device_info ? params.device_info.slice(0, 200) : existing.device_info,
      prefs: params.prefs ? sanitizePushPrefs(params.prefs, existing.prefs) : existing.prefs,
      updated_at: now,
    };
    storeState.pushSubscriptions[idx] = updated;
    saveStoreToDisk();
    return { record: updated, isNew: false };
  }

  const created: PushSubscriptionRecord = {
    id: `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: params.user_id || null,
    fcm_token: params.fcm_token,
    device_info: (params.device_info || 'Web Browser').slice(0, 200),
    welcome_sent: false,
    prefs: sanitizePushPrefs(params.prefs, DEFAULT_PUSH_PREFS),
    created_at: now,
    updated_at: now,
  };
  storeState.pushSubscriptions = [created, ...storeState.pushSubscriptions].slice(0, 5000);
  saveStoreToDisk();
  return { record: created, isNew: true };
}

export function updatePushSubscriptionPrefs(
  fcmToken: string,
  prefsPatch: Partial<PushPrefs>,
  userId?: string | null
): PushSubscriptionRecord | null {
  const idx = storeState.pushSubscriptions.findIndex((s) => s.fcm_token === fcmToken);
  if (idx < 0) return null;
  const existing = storeState.pushSubscriptions[idx];
  const updated: PushSubscriptionRecord = {
    ...existing,
    user_id: userId !== undefined ? userId : existing.user_id,
    prefs: sanitizePushPrefs(prefsPatch, existing.prefs),
    updated_at: new Date().toISOString(),
  };
  storeState.pushSubscriptions[idx] = updated;
  saveStoreToDisk();
  return updated;
}

export function markPushWelcomeSent(fcmToken: string): void {
  const idx = storeState.pushSubscriptions.findIndex((s) => s.fcm_token === fcmToken);
  if (idx < 0) return;
  storeState.pushSubscriptions[idx] = {
    ...storeState.pushSubscriptions[idx],
    welcome_sent: true,
    updated_at: new Date().toISOString(),
  };
  saveStoreToDisk();
}

export function removeInvalidPushTokens(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const badSet = new Set(tokens);
  const before = storeState.pushSubscriptions.length;
  storeState.pushSubscriptions = storeState.pushSubscriptions.filter((s) => !badSet.has(s.fcm_token));
  const removed = before - storeState.pushSubscriptions.length;
  if (removed > 0) saveStoreToDisk();
  return removed;
}

export function listPushCampaigns(): PushCampaignRecord[] {
  return storeState.pushCampaigns;
}

export function createPushCampaign(campaign: PushCampaignRecord): PushCampaignRecord {
  storeState.pushCampaigns = [campaign, ...storeState.pushCampaigns].slice(0, 200);
  saveStoreToDisk();
  return campaign;
}

export function updatePushCampaign(
  id: string,
  patch: Partial<PushCampaignRecord>
): PushCampaignRecord | null {
  const idx = storeState.pushCampaigns.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  storeState.pushCampaigns[idx] = { ...storeState.pushCampaigns[idx], ...patch };
  saveStoreToDisk();
  return storeState.pushCampaigns[idx];
}

export function deleteScheduledPushCampaign(id: string): boolean {
  const before = storeState.pushCampaigns.length;
  storeState.pushCampaigns = storeState.pushCampaigns.filter(
    (c) => !(c.id === id && c.status === 'scheduled')
  );
  const removed = storeState.pushCampaigns.length < before;
  if (removed) saveStoreToDisk();
  return removed;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

export function getCached<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCached<T>(key: string, data: T, ttlMs: number): void {
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearCache(prefix?: string): number {
  if (!prefix) {
    const count = memoryCache.size;
    memoryCache.clear();
    return count;
  }
  let removed = 0;
  for (const k of memoryCache.keys()) {
    if (k.startsWith(prefix)) {
      memoryCache.delete(k);
      removed++;
    }
  }
  return removed;
}

export function getCacheStats() {
  let activeEntries = 0;
  const now = Date.now();
  for (const [k, v] of memoryCache.entries()) {
    if (v.expiresAt > now) {
      activeEntries++;
    } else {
      memoryCache.delete(k);
    }
  }
  return { activeEntries };
}
