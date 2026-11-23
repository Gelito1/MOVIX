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

export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  dashboard: 'Dashboard',
  movies: 'Filmes',
  series: 'Séries',
  seasons: 'Temporadas',
  episodes: 'Episódios',
  ads: 'MOVIX ADS',
  campaigns: 'Campanhas',
  ad_stats: 'Estatísticas publicitárias',
  users: 'Utilizadores',
  notifications: 'Notificações',
  categories: 'Categorias',
  genres: 'Géneros',
  servers: 'Servidores',
  pages: 'Páginas & Identidade',
  admins: 'Administradores',
  logs: 'Histórico de atividades',
  backup: 'Backup & Armazenamento',
  settings: 'Configurações',
};

export interface AdminAccountSafe {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: AdminPermission[];
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

export const AD_FORMAT_OPTIONS: Array<{ value: AdFormatType; label: string; kind: 'image' | 'video'; hint: string }> = [
  { value: 'banner_horizontal', label: 'Banner Horizontal', kind: 'image', hint: 'Ideal para topo, início e rodapé (16:3 / 728x90)' },
  { value: 'banner_vertical', label: 'Banner Vertical', kind: 'image', hint: 'Ideal para barra lateral (2:3 / 300x600)' },
  { value: 'banner_square', label: 'Banner Quadrado', kind: 'image', hint: 'Card quadrado equilibrado (1:1 / 300x300)' },
  { value: 'image_ad', label: 'Anúncio em Imagem', kind: 'image', hint: 'Destaque visual com título e descrição' },
  { value: 'video_ad', label: 'Anúncio em Vídeo', kind: 'video', hint: 'Vídeo promocional MP4/WEBM com controlos' },
  { value: 'promo_video', label: 'Vídeo Promocional', kind: 'video', hint: 'Trailer ou spot publicitário em destaque' },
  { value: 'cta_ad', label: 'Anúncio com Botão de Ação (CTA)', kind: 'image', hint: 'Cartão focado em conversão com botão de destaque' },
  { value: 'external_redirect', label: 'Link Externo / Redirecionamento', kind: 'image', hint: 'Cartão clicável para página de destino externa' },
  { value: 'in_content', label: 'Anúncio Integrado no Conteúdo', kind: 'image', hint: 'Integra-se naturalmente entre secções e listas' },
  { value: 'pre_roll', label: 'Vídeo Antes do Player (Pre-Roll)', kind: 'video', hint: 'Reproduzido antes de iniciar o filme/episódio' },
  { value: 'mid_roll', label: 'Vídeo Durante a Reprodução (Mid-Roll)', kind: 'video', hint: 'Intervalo curto durante o vídeo principal' },
  { value: 'post_roll', label: 'Vídeo Após a Reprodução (Post-Roll)', kind: 'video', hint: 'Apresentado ao concluir a reprodução' },
];

export const AD_PLACEMENT_OPTIONS: Array<{ value: AdPlacement; label: string; group: 'site' | 'player' }> = [
  { value: 'home', label: 'Página Inicial & Carrossel Principal', group: 'site' },
  { value: 'header', label: 'Topo do Site (Faixa Superior)', group: 'site' },
  { value: 'between_movies', label: 'Entre Filmes e Séries (Nos Catálogos)', group: 'site' },
  { value: 'movie_detail', label: 'Página do Filme', group: 'site' },
  { value: 'series_detail', label: 'Página da Série', group: 'site' },
  { value: 'seasons_page', label: 'Secção de Temporadas', group: 'site' },
  { value: 'episodes_page', label: 'Secção de Episódios', group: 'site' },
  { value: 'before_player', label: 'Antes do Player (Pre-Roll)', group: 'player' },
  { value: 'during_playback', label: 'Durante Reprodução (Mid-Roll)', group: 'player' },
  { value: 'after_playback', label: 'Após Reprodução (Post-Roll)', group: 'player' },
  { value: 'sidebar', label: 'Destaque Vertical / Lateral', group: 'site' },
  { value: 'footer', label: 'Rodapé (Footer)', group: 'site' },
  { value: 'search_page', label: 'Página de Pesquisa', group: 'site' },
  { value: 'categories_page', label: 'Catálogos & Carrossel (Filmes, Séries, Animes, Novelas)', group: 'site' },
];

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
  autoplay: boolean;
  startMuted: boolean;
  skippable: boolean;
  skipAfterSeconds: number;
  durationSeconds: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface PublicAdItem {
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
  placements: AdPlacement[];
  frequencyPerSession: number;
  autoplay: boolean;
  startMuted: boolean;
  skippable: boolean;
  skipAfterSeconds: number;
  durationSeconds: number;
  priority: number;
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
  adPacing?: AdPacingConfig;
  defaultLanguage: string;
  updatedAt: string;
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

export interface StoredMediaFile {
  folder: string;
  filename: string;
  url: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface AdmOverviewResponse {
  kpis: {
    totalMovies: number;
    publishedMovies: number;
    totalSeries: number;
    publishedSeries: number;
    totalSeasons: number;
    totalEpisodes: number;
    totalUsers: number;
    activeUsers: number;
    totalViews: number;
    todayViews: number;
    activeAds: number;
    totalAds: number;
    adImpressions: number;
    adClicks: number;
    adCtr: number;
    pushSubscribers: number;
  };
  dailySeries: Array<{
    date: string;
    views: number;
    movieViews: number;
    seriesViews: number;
    newUsers: number;
    activeUsers: number;
    adImpressions: number;
    adClicks: number;
  }>;
  topMovies: Array<{
    key: string;
    mediaType: 'movie';
    id: string;
    title: string;
    posterUrl: string;
    views: number;
    lastViewedAt: string;
  }>;
  topSeries: Array<{
    key: string;
    mediaType: 'tv';
    id: string;
    title: string;
    posterUrl: string;
    views: number;
    lastViewedAt: string;
  }>;
  recentContent: Array<{
    id: string;
    mediaType: 'movie' | 'tv';
    title: string;
    posterUrl: string;
    published: boolean;
    createdAt: string;
  }>;
  topAds: Array<{
    id: string;
    name: string;
    status: AdStatus;
    format: AdFormatType;
    impressions: number;
    clicks: number;
    ctr: number;
  }>;
}

export interface AdStatsResponse {
  summary: {
    totalImpressions: number;
    totalClicks: number;
    ctr: number;
    totalVideoViews: number;
    totalVideoCompletes: number;
    totalVideoPartials: number;
    avgWatchSeconds: number;
    activeCampaigns: number;
  };
  deviceTotals: {
    desktop: { impressions: number; clicks: number };
    mobile: { impressions: number; clicks: number };
    tablet: { impressions: number; clicks: number };
  };
  timeline: Array<{
    date: string;
    impressions: number;
    clicks: number;
    videoViews: number;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    format: AdFormatType;
    mediaKind: 'image' | 'video';
    status: AdStatus;
    impressions: number;
    clicks: number;
    ctr: number;
    videoViews: number;
    videoCompletes: number;
    videoPartials: number;
    avgWatchSeconds: number;
  }>;
}

export interface PublicManagedMovieSummary {
  id: string;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  year: string;
  releaseDate: string;
  rating: number;
  featured: boolean;
  recommended: boolean;
  genres: string[];
  categories: string[];
}

export interface PublicManagedSeriesSummary {
  id: string;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  year: string;
  releaseDate: string;
  rating: number;
  featured: boolean;
  recommended: boolean;
  genres: string[];
  categories: string[];
  seasonsCount: number;
}
