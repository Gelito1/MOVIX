export interface MediaSummary {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: string;
  releaseDate: string;
  rating: number;
  voteCount: number;
  genreIds: number[];
  popularity: number;
}

export interface GenreItem {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string;
  profileUrl: string | null;
}

export interface VideoTrailer {
  id: string;
  key: string;
  name: string;
  type: string;
  official: boolean;
}

export interface MovieDetails {
  id: number;
  mediaType: 'movie';
  title: string;
  originalTitle: string;
  tagline: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string;
  year: string;
  runtime: number;
  rating: number;
  voteCount: number;
  certification: string;
  genres: GenreItem[];
  cast: CastMember[];
  trailers: VideoTrailer[];
  related: MediaSummary[];
}

export interface SeasonSummary {
  id: number;
  seasonNumber: number;
  name: string;
  overview: string;
  posterUrl: string | null;
  episodeCount: number;
  airDate: string;
}

export interface EpisodeItem {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  name: string;
  overview: string;
  stillUrl: string | null;
  runtime: number;
  airDate: string;
  rating: number;
}

export interface SeasonDetails {
  id: number;
  seasonNumber: number;
  name: string;
  overview: string;
  episodes: EpisodeItem[];
}

export interface SeriesDetails {
  id: number;
  mediaType: 'tv';
  title: string;
  originalTitle: string;
  tagline: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string;
  year: string;
  episodeRuntime: number;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  rating: number;
  voteCount: number;
  certification: string;
  genres: GenreItem[];
  seasons: SeasonSummary[];
  cast: CastMember[];
  trailers: VideoTrailer[];
  related: MediaSummary[];
}

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

export interface MegambdStatusReport {
  configured: boolean;
  serverHost: string;
  authValid: boolean;
  accountStatus: string;
  message: string;
  expDate: string | null;
  activeConnections: string | null;
  maxConnections: string | null;
  serverProtocol: string | null;
  lastChecked: string;
  vodCategoriesCount?: number;
  seriesCategoriesCount?: number;
}

export interface ApiErrorLog {
  id: string;
  timestamp: string;
  service: 'TMDB' | 'MegamBD' | 'Stream' | 'Sistema';
  endpoint: string;
  statusCode: number;
  message: string;
}

export interface EmbedMirror {
  label: string;
  url: string;
}

export interface PlaybackRequest {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  subtitle?: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  megambdStreamUrl?: string | null;
  embedUrl?: string | null;
  embedMirrors?: EmbedMirror[];
  megambdError?: string | null;
  trailerKey?: string | null;
  loadingSource?: boolean;
  nextEpisode?: {
    seasonNumber: number;
    episodeNumber: number;
    episodeTitle: string;
    megambdStreamUrl?: string | null;
    embedUrl?: string | null;
    embedMirrors?: EmbedMirror[];
  } | null;
}

export interface WatchProgressItem {
  key: string; // movie:{id} or tv:{id}:s{s}:e{e}
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  currentTime: number;
  duration: number;
  updatedAt: string;
}

export interface FavoriteItem {
  key: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterUrl: string | null;
  year: string;
  rating: number;
  addedAt: string;
}

export interface OfflineSavedItem {
  key: string; // movie:{id} or tv:{id}
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  overview: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  year: string;
  rating: number;
  genres: string[];
  runtime?: number;
  numberOfSeasons?: number;
  savedAt: string;
  expiresAt: string;
  metadataUrl: string;
  seasonMetadataUrl?: string | null;
  cachedImageUrls: string[];
  estimatedBytes: number;
}

export type ThematicSection =
  | 'novelas'
  | 'doramas'
  | 'dramas'
  | 'animes'
  | 'infantil'
  | 'documentarios';

export type StreamingPlatformSlug =
  | 'netflix'
  | 'disney'
  | 'globoplay'
  | 'prime'
  | 'max'
  | 'apple'
  | 'crunchyroll'
  | 'paramount';

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

export interface PushOverviewResponse {
  fcmConfigured: boolean;
  fcmProjectId: string;
  totalSubscribers: number;
  realFcmTokens: number;
  categoryCounts: {
    new_movies: number;
    new_seasons: number;
    app_updates: number;
    recommendations: number;
  };
  campaigns: PushCampaignRecord[];
}

export type AppRoute =
  | { page: 'home' }
  | { page: 'movies' }
  | { page: 'series' }
  | { page: 'section'; section: ThematicSection }
  | { page: 'provider'; slug: StreamingPlatformSlug }
  | { page: 'adult' }
  | { page: 'movie'; id: number }
  | { page: 'tv'; id: number }
  | { page: 'mylist'; tab?: 'favorites' | 'offline' | 'continue' | 'history' }
  | { page: 'admin'; section?: string; tab?: 'notifications' };

