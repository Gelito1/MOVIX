import fs from 'fs';
import path from 'path';

export type AdminRole = 'super_admin' | 'editor' | 'ads_manager';

export type AdminPermission =
  | 'dashboard'
  | 'movies'
  | 'series'
  | 'seasons'
  | 'episodes'
  | 'ads'
  | 'campaigns'
  | 'ad_stats'
  | 'users'
  | 'notifications'
  | 'categories'
  | 'genres'
  | 'servers'
  | 'pages'
  | 'admins'
  | 'logs'
  | 'backup'
  | 'settings';

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  'dashboard',
  'movies',
  'series',
  'seasons',
  'episodes',
  'ads',
  'campaigns',
  'ad_stats',
  'users',
  'notifications',
  'categories',
  'genres',
  'servers',
  'pages',
  'admins',
  'logs',
  'backup',
  'settings',
];

export const ROLE_DEFAULT_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  super_admin: [...ALL_ADMIN_PERMISSIONS],
  editor: ['dashboard', 'movies', 'series', 'seasons', 'episodes', 'categories', 'genres', 'servers'],
  ads_manager: ['dashboard', 'ads', 'campaigns', 'ad_stats'],
};

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: AdminPermission[];
  passwordHash: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PlaybackServerLink {
  id: string;
  name: string;
  url: string;
  language: 'dublado' | 'legendado' | 'dual';
  quality: string;
  type: 'embed' | 'stream';
  active: boolean;
  order: number;
}

export interface ManagedMovie {
  id: string;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  trailerUrl: string;
  releaseDate: string;
  year: string;
  runtime: number;
  language: string;
  certification: string;
  rating: number;
  categories: string[];
  genres: string[];
  servers: PlaybackServerLink[];
  featured: boolean;
  recommended: boolean;
  published: boolean;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  overview: string;
  stillUrl: string;
  duration: number;
  airDate: string;
  servers: PlaybackServerLink[];
  published: boolean;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSeason {
  id: string;
  seasonNumber: number;
  title: string;
  overview: string;
  posterUrl: string;
  published: boolean;
  episodes: ManagedEpisode[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagedSeries {
  id: string;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  trailerUrl: string;
  releaseDate: string;
  year: string;
  language: string;
  certification: string;
  rating: number;
  categories: string[];
  genres: string[];
  featured: boolean;
  recommended: boolean;
  published: boolean;
  views: number;
  seasons: ManagedSeason[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagedGenre {
  id: string;
  name: string;
  slug: string;
  mediaType: 'both' | 'movie' | 'tv';
  active: boolean;
  order: number;
}

export interface GlobalPlaybackServer {
  id: string;
  name: string;
  baseUrl: string;
  kind: 'embed' | 'stream' | 'hls';
  active: boolean;
  isDefault: boolean;
  order: number;
  lastTestedAt: string | null;
  lastStatus: 'online' | 'offline' | 'unknown';
  lastLatencyMs: number | null;
}

export type AdFormatType =
  | 'banner_horizontal'
  | 'banner_vertical'
  | 'banner_square'
  | 'image_ad'
  | 'video_ad'
  | 'promo_video'
  | 'cta_ad'
  | 'external_redirect'
  | 'in_content'
  | 'pre_roll'
  | 'mid_roll'
  | 'post_roll';

export type AdPlacement =
  | 'home'
  | 'header'
  | 'between_movies'
  | 'movie_detail'
  | 'series_detail'
  | 'seasons_page'
  | 'episodes_page'
  | 'before_player'
  | 'during_playback'
  | 'after_playback'
  | 'sidebar'
  | 'footer'
  | 'search_page'
  | 'categories_page';

export type AdStatus = 'active' | 'paused' | 'scheduled' | 'expired' | 'draft';
export type AdDeviceTarget = 'all' | 'desktop' | 'mobile' | 'tablet';

export interface AdDailyStat {
  date: string;
  impressions: number;
  clicks: number;
  videoViews: number;
  videoCompletes: number;
  watchSeconds: number;
}

export interface AdLocalizedTexts {
  name?: string;
  title: string;
  description: string;
  ctaText: string;
  sourceHash: string;
  updatedAt: string;
}

export interface AdCampaign {
  id: string;
  name: string;
  title: string;
  description: string;
  format: AdFormatType;
  mediaKind: 'image' | 'video';
  imageUrl: string;
  videoUrl: string;
  destinationUrl: string;
  ctaText: string;
  translations?: Partial<Record<string, AdLocalizedTexts>>;
  startDate: string;
  endDate: string;
  status: AdStatus;
  priority: number;
  placements: AdPlacement[];
  frequencyPerSession: number;
  maxImpressions: number | null;
  targetAudience: string;
  countries: string[];
  devices: AdDeviceTarget[];
  // Video ad controls
  autoplay: boolean;
  startMuted: boolean;
  skippable: boolean;
  skipAfterSeconds: number;
  durationSeconds: number;
  // Real metrics
  impressions: number;
  clicks: number;
  videoViews: number;
  videoCompletes: number;
  videoPartials: number;
  totalWatchSeconds: number;
  byDevice: {
    desktop: { impressions: number; clicks: number };
    mobile: { impressions: number; clicks: number };
    tablet: { impressions: number; clicks: number };
  };
  dailyStats: AdDailyStat[];
  notifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredUserRecord {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  provider: string;
  preferredLanguage: string;
  status: 'active' | 'blocked';
  role: 'user' | 'vip' | 'moderator';
  favoritesCount: number;
  watchCount: number;
  recentTitles: Array<{ title: string; mediaType: 'movie' | 'tv'; watchedAt: string }>;
  createdAt: string;
  lastActiveAt: string;
}

export interface AdPacingConfig {
  dismissCooldownMinutes: number;
  largeAdIntervalMinutes: number;
  playerAdIntervalMinutes: number;
  headerAdAlwaysVisible: boolean;
}

export const DEFAULT_AD_PACING: AdPacingConfig = {
  dismissCooldownMinutes: 30,
  largeAdIntervalMinutes: 0,
  playerAdIntervalMinutes: 20,
  headerAdAlwaysVisible: true,
};

export interface SiteIdentityConfig {
  platformName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  heroTagline: string;
  aboutUs: string;
  privacyPolicy: string;
  termsOfUse: string;
  contactEmail: string;
  contactPhone: string;
  socialInstagram: string;
  socialYoutube: string;
  socialTelegram: string;
  socialTwitter: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  maintenanceMode: boolean;
  adsGlobalEnabled: boolean;
  adPacing: AdPacingConfig;
  defaultLanguage: string;
  updatedAt: string;
}

export interface DailyAnalyticsBucket {
  date: string; // YYYY-MM-DD
  views: number;
  movieViews: number;
  seriesViews: number;
  newUsers: number;
  activeUserIds: string[];
  adImpressions: number;
  adClicks: number;
}

export interface ContentViewRank {
  key: string; // movie:{id} or tv:{id}
  mediaType: 'movie' | 'tv';
  id: string;
  title: string;
  posterUrl: string;
  views: number;
  lastViewedAt: string;
}

export interface AdminAuditLog {
  id: string;
  timestamp: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  adminRole: AdminRole;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  result: 'success' | 'error';
}

export interface BackupMeta {
  id: string;
  filename: string;
  createdAt: string;
  createdBy: string;
  sizeBytes: number;
  note: string;
}

export interface AdmStoreData {
  admins: AdminAccount[];
  revokedSessionBefore: number;
  movies: ManagedMovie[];
  series: ManagedSeries[];
  genres: ManagedGenre[];
  servers: GlobalPlaybackServer[];
  ads: AdCampaign[];
  users: RegisteredUserRecord[];
  siteConfig: SiteIdentityConfig;
  analytics: {
    totalViews: number;
    daily: DailyAnalyticsBucket[];
    topContent: ContentViewRank[];
  };
  auditLogs: AdminAuditLog[];
  backups: BackupMeta[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ADM_STORE_PATH = path.join(DATA_DIR, 'movix-adm.json');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const DEFAULT_GENRES: ManagedGenre[] = [
  { id: 'gen-acao', name: 'Ação', slug: 'acao', mediaType: 'both', active: true, order: 1 },
  { id: 'gen-aventura', name: 'Aventura', slug: 'aventura', mediaType: 'both', active: true, order: 2 },
  { id: 'gen-comedia', name: 'Comédia', slug: 'comedia', mediaType: 'both', active: true, order: 3 },
  { id: 'gen-drama', name: 'Drama', slug: 'drama', mediaType: 'both', active: true, order: 4 },
  { id: 'gen-ficcao', name: 'Ficção Científica', slug: 'ficcao-cientifica', mediaType: 'both', active: true, order: 5 },
  { id: 'gen-terror', name: 'Terror', slug: 'terror', mediaType: 'both', active: true, order: 6 },
  { id: 'gen-romance', name: 'Romance', slug: 'romance', mediaType: 'both', active: true, order: 7 },
  { id: 'gen-suspense', name: 'Suspense', slug: 'suspense', mediaType: 'both', active: true, order: 8 },
  { id: 'gen-animacao', name: 'Animação', slug: 'animacao', mediaType: 'both', active: true, order: 9 },
  { id: 'gen-documentario', name: 'Documentário', slug: 'documentario', mediaType: 'both', active: true, order: 10 },
];

const DEFAULT_SERVERS: GlobalPlaybackServer[] = [
  {
    id: 'srv-megaembed',
    name: 'MegaEmbed HD Principal',
    baseUrl: 'https://megaembed.com',
    kind: 'embed',
    active: true,
    isDefault: true,
    order: 1,
    lastTestedAt: null,
    lastStatus: 'unknown',
    lastLatencyMs: null,
  },
  {
    id: 'srv-mgeb-stream',
    name: 'MegamBD Stream Direct',
    baseUrl: 'https://mgeb.space',
    kind: 'stream',
    active: true,
    isDefault: false,
    order: 2,
    lastTestedAt: null,
    lastStatus: 'unknown',
    lastLatencyMs: null,
  },
];

const DEFAULT_SITE_CONFIG: SiteIdentityConfig = {
  platformName: 'MOVIX',
  logoUrl: '',
  faviconUrl: '/pwa-192x192.png',
  primaryColor: '#E5B85A',
  heroTagline: 'Cinema, séries e entretenimento em alta definição.',
  aboutUs:
    'O MOVIX é uma plataforma moderna de descoberta e reprodução de filmes, séries, animes, novelas e documentários com experiência cinematográfica em todos os dispositivos.',
  privacyPolicy:
    'Respeitamos a privacidade dos utilizadores em conformidade com a LGPD e GDPR. Dados de conta e preferências são utilizados exclusivamente para sincronizar a sua lista e melhorar a experiência.',
  termsOfUse:
    'O MOVIX organiza e reproduz filmes e séries a partir de fontes externas integradas, sem hospedar arquivos de terceiros. Cada dispositivo aceita apenas uma conta vinculada.',
  contactEmail: 'contato@movix.app',
  contactPhone: '',
  socialInstagram: '',
  socialYoutube: '',
  socialTelegram: '',
  socialTwitter: '',
  seoTitle: 'MOVIX — Filmes e Séries em HD',
  seoDescription: 'Assista a filmes, séries, animes, doramas e novelas no MOVIX com player cinema 360°.',
  seoKeywords: 'filmes, séries, streaming, animes, doramas, movix',
  maintenanceMode: false,
  adsGlobalEnabled: true,
  adPacing: { ...DEFAULT_AD_PACING },
  defaultLanguage: 'pt-BR',
  updatedAt: new Date().toISOString(),
};

let admState: AdmStoreData = {
  admins: [],
  revokedSessionBefore: 0,
  movies: [],
  series: [],
  genres: DEFAULT_GENRES,
  servers: DEFAULT_SERVERS,
  ads: [],
  users: [],
  siteConfig: DEFAULT_SITE_CONFIG,
  analytics: {
    totalViews: 0,
    daily: [],
    topContent: [],
  },
  auditLogs: [],
  backups: [],
};

function ensureDataDirs(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function loadAdmStoreFromDisk(): void {
  try {
    ensureDataDirs();
    if (fs.existsSync(ADM_STORE_PATH)) {
      const raw = fs.readFileSync(ADM_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AdmStoreData>;
      admState = {
        admins: Array.isArray(parsed.admins) ? parsed.admins : [],
        revokedSessionBefore: typeof parsed.revokedSessionBefore === 'number' ? parsed.revokedSessionBefore : 0,
        movies: Array.isArray(parsed.movies) ? parsed.movies : [],
        series: Array.isArray(parsed.series) ? parsed.series : [],
        genres: Array.isArray(parsed.genres) && parsed.genres.length > 0 ? parsed.genres : DEFAULT_GENRES,
        servers: Array.isArray(parsed.servers) && parsed.servers.length > 0 ? parsed.servers : DEFAULT_SERVERS,
        ads: Array.isArray(parsed.ads) ? parsed.ads : [],
        users: Array.isArray(parsed.users) ? parsed.users : [],
        siteConfig: {
          ...DEFAULT_SITE_CONFIG,
          ...(parsed.siteConfig || {}),
          adPacing: {
            ...DEFAULT_AD_PACING,
            ...(parsed.siteConfig?.adPacing || {}),
          },
        },
        analytics: {
          totalViews: typeof parsed.analytics?.totalViews === 'number' ? parsed.analytics.totalViews : 0,
          daily: Array.isArray(parsed.analytics?.daily) ? parsed.analytics.daily.slice(-180) : [],
          topContent: Array.isArray(parsed.analytics?.topContent) ? parsed.analytics.topContent.slice(0, 100) : [],
        },
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs.slice(0, 500) : [],
        backups: Array.isArray(parsed.backups) ? parsed.backups.slice(0, 50) : [],
      };
    }
  } catch {
    // Keep defaults if unreadable
  }
}

export function saveAdmStore(): void {
  try {
    ensureDataDirs();
    fs.writeFileSync(ADM_STORE_PATH, JSON.stringify(admState, null, 2), 'utf-8');
  } catch {
    // Ignore transient disk write failures
  }
}

loadAdmStoreFromDisk();

export function getAdmStore(): AdmStoreData {
  return admState;
}

export function replaceAdmStore(next: AdmStoreData): void {
  admState = next;
  saveAdmStore();
}

export function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getOrCreateDailyBucket(date = todayDateKey()): DailyAnalyticsBucket {
  let bucket = admState.analytics.daily.find((d) => d.date === date);
  if (!bucket) {
    bucket = {
      date,
      views: 0,
      movieViews: 0,
      seriesViews: 0,
      newUsers: 0,
      activeUserIds: [],
      adImpressions: 0,
      adClicks: 0,
    };
    admState.analytics.daily.push(bucket);
    admState.analytics.daily.sort((a, b) => a.date.localeCompare(b.date));
    if (admState.analytics.daily.length > 180) {
      admState.analytics.daily = admState.analytics.daily.slice(-180);
    }
  }
  return bucket;
}

export function recordPlatformView(params: {
  mediaType: 'movie' | 'tv';
  id: string;
  title: string;
  posterUrl?: string;
  userId?: string;
}): void {
  const now = new Date().toISOString();
  const bucket = getOrCreateDailyBucket();
  admState.analytics.totalViews += 1;
  bucket.views += 1;
  if (params.mediaType === 'movie') bucket.movieViews += 1;
  else bucket.seriesViews += 1;

  if (params.userId && !bucket.activeUserIds.includes(params.userId)) {
    bucket.activeUserIds.push(params.userId);
    if (bucket.activeUserIds.length > 5000) bucket.activeUserIds = bucket.activeUserIds.slice(-5000);
  }

  // Update managed movie/series views counter if matched
  if (params.mediaType === 'movie') {
    const mov = admState.movies.find(
      (m) => m.id === params.id || (m.tmdbId !== null && String(m.tmdbId) === params.id)
    );
    if (mov) mov.views += 1;
  } else {
    const ser = admState.series.find(
      (s) => s.id === params.id || (s.tmdbId !== null && String(s.tmdbId) === params.id)
    );
    if (ser) ser.views += 1;
  }

  // Update topContent leaderboard
  const key = `${params.mediaType}:${params.id}`;
  const existing = admState.analytics.topContent.find((c) => c.key === key);
  if (existing) {
    existing.views += 1;
    existing.lastViewedAt = now;
    if (params.title) existing.title = params.title;
    if (params.posterUrl) existing.posterUrl = params.posterUrl;
  } else {
    admState.analytics.topContent.push({
      key,
      mediaType: params.mediaType,
      id: params.id,
      title: params.title.slice(0, 140),
      posterUrl: (params.posterUrl || '').slice(0, 500),
      views: 1,
      lastViewedAt: now,
    });
  }
  admState.analytics.topContent.sort((a, b) => b.views - a.views);
  if (admState.analytics.topContent.length > 100) {
    admState.analytics.topContent = admState.analytics.topContent.slice(0, 100);
  }

  // Update user watch history if known
  if (params.userId) {
    const u = admState.users.find((usr) => usr.uid === params.userId);
    if (u) {
      u.watchCount += 1;
      u.lastActiveAt = now;
      u.recentTitles = [
        { title: params.title.slice(0, 120), mediaType: params.mediaType, watchedAt: now },
        ...u.recentTitles.filter((r) => r.title !== params.title),
      ].slice(0, 20);
    }
  }

  saveAdmStore();
}

export function appendAuditLog(entry: Omit<AdminAuditLog, 'id' | 'timestamp'>): AdminAuditLog {
  const full: AdminAuditLog = {
    id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  admState.auditLogs = [full, ...admState.auditLogs].slice(0, 500);
  saveAdmStore();
  return full;
}

export function refreshAdStatuses(): boolean {
  const nowMs = Date.now();
  let changed = false;
  for (const ad of admState.ads) {
    if (ad.status === 'draft' || ad.status === 'paused') continue;
    const rawStart = (ad.startDate || '').trim();
    const rawEnd = (ad.endDate || '').trim();
    const startMs = rawStart
      ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? `${rawStart}T00:00:00.000Z` : rawStart)
      : NaN;
    const endMs = rawEnd
      ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(rawEnd) ? `${rawEnd}T23:59:59.999Z` : rawEnd)
      : NaN;
    const capped = ad.maxImpressions !== null && ad.maxImpressions > 0 && ad.impressions >= ad.maxImpressions;

    if (capped || (!Number.isNaN(endMs) && nowMs > endMs)) {
      if (ad.status !== 'expired') {
        ad.status = 'expired';
        changed = true;
      }
    } else if (!Number.isNaN(startMs) && nowMs < startMs) {
      if (ad.status !== 'scheduled') {
        ad.status = 'scheduled';
        changed = true;
      }
    } else if (ad.status === 'scheduled' && (Number.isNaN(startMs) || nowMs >= startMs)) {
      ad.status = 'active';
      changed = true;
    }
  }
  if (changed) saveAdmStore();
  return changed;
}
