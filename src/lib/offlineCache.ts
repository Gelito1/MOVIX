import type {
  FavoriteItem,
  MovieDetails,
  OfflineSavedItem,
  SeasonDetails,
  SeriesDetails,
} from '../types/movix';
import { showNativeSystemNotification } from './pushNotifications';

export const OFFLINE_METADATA_CACHE = 'movix-offline-metadata-v1';
export const OFFLINE_IMAGES_CACHE = 'movix-offline-images-v1';
const OFFLINE_INDEX_KEY = 'movix:offline-index:v1';
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_TTL_MS = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;

export function isCacheApiSupported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

function readOfflineIndex(): OfflineSavedItem[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineSavedItem[]) : [];
  } catch {
    return [];
  }
}

function writeOfflineIndex(items: OfflineSavedItem[]): void {
  try {
    window.localStorage.setItem(OFFLINE_INDEX_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('movix:offline-updated'));
  } catch {
    // Ignore storage quota errors
  }
}

export function getOfflineItems(): OfflineSavedItem[] {
  const now = Date.now();
  return readOfflineIndex().filter((item) => new Date(item.expiresAt).getTime() > now);
}

export function getOfflineItemKeys(): Set<string> {
  return new Set(getOfflineItems().map((item) => item.key));
}

export function isSavedOffline(mediaType: 'movie' | 'tv', tmdbId: number): boolean {
  const key = `${mediaType}:${tmdbId}`;
  return getOfflineItemKeys().has(key);
}

export function getDaysRemaining(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function cacheImageUrl(cache: Cache, url: string): Promise<number> {
  if (!url) return 0;
  try {
    // Prefer CORS fetch so we can measure size and serve clean responses
    const corsRes = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (corsRes.ok) {
      const clone = corsRes.clone();
      const blob = await corsRes.blob();
      await cache.put(url, clone);
      return blob.size || 45_000;
    }
  } catch {
    // Fallback to no-cors opaque response (still served by Service Worker Cache API for <img>)
  }

  try {
    const req = new Request(url, { mode: 'no-cors' });
    const opaqueRes = await fetch(req);
    if (opaqueRes.type === 'opaque' || opaqueRes.ok) {
      await cache.put(req, opaqueRes);
      return 65_000; // Typical TMDB poster/backdrop estimate when opaque
    }
  } catch {
    // Ignore unreachable image
  }
  return 0;
}

export async function saveItemForOffline(input: {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  year?: string;
  rating?: number;
  details?: MovieDetails | SeriesDetails | null;
  ttlDays?: number;
  silentNotification?: boolean;
}): Promise<OfflineSavedItem> {
  const key = `${input.mediaType}:${input.tmdbId}`;
  const metadataUrl =
    input.mediaType === 'movie'
      ? `/api/tmdb/movie/${input.tmdbId}`
      : `/api/tmdb/tv/${input.tmdbId}`;

  let details: MovieDetails | SeriesDetails | null = input.details ?? null;

  if (!details) {
    try {
      const res = await fetch(metadataUrl);
      if (res.ok) {
        details = (await res.json()) as MovieDetails | SeriesDetails;
      }
    } catch {
      // Fallback to minimal metadata if network is temporarily unavailable
    }
  }

  let seasonMetadataUrl: string | null = null;
  let seasonData: SeasonDetails | null = null;
  if (input.mediaType === 'tv') {
    const tvDetails = details as SeriesDetails | null;
    const firstSeasonNum = tvDetails?.seasons?.[0]?.seasonNumber ?? 1;
    seasonMetadataUrl = `/api/tmdb/tv/${input.tmdbId}/season/${firstSeasonNum}`;
    try {
      const sRes = await fetch(seasonMetadataUrl);
      if (sRes.ok) {
        seasonData = (await sRes.json()) as SeasonDetails;
      }
    } catch {
      seasonMetadataUrl = null;
    }
  }

  const now = new Date();
  const ttlMs = (input.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const savedAt = now.toISOString();

  const finalPoster = details?.posterUrl ?? input.posterUrl ?? null;
  const finalBackdrop = details?.backdropUrl ?? input.backdropUrl ?? null;
  const title = details?.title ?? input.title;
  const originalTitle = details?.originalTitle ?? input.title;
  const overview = details?.overview ?? '';
  const year = details?.year ?? input.year ?? '';
  const rating = details?.rating ?? input.rating ?? 0;
  const genres = details?.genres?.map((g) => g.name) ?? [];

  const cachedImageUrls: string[] = [];
  let estimatedBytes = 0;

  if (isCacheApiSupported()) {
    const [metaCache, imgCache] = await Promise.all([
      caches.open(OFFLINE_METADATA_CACHE),
      caches.open(OFFLINE_IMAGES_CACHE),
    ]);

    const payloadToStore =
      details ??
      ({
        id: input.tmdbId,
        mediaType: input.mediaType,
        title,
        originalTitle,
        tagline: '',
        overview,
        posterUrl: finalPoster,
        backdropUrl: finalBackdrop,
        releaseDate: '',
        year,
        rating,
        voteCount: 0,
        certification: '',
        genres: [],
        cast: [],
        trailers: [],
        related: [],
        ...(input.mediaType === 'movie'
          ? { runtime: 0 }
          : { episodeRuntime: 45, numberOfSeasons: 1, numberOfEpisodes: 0, seasons: [] }),
      } as MovieDetails | SeriesDetails);

    const jsonStr = JSON.stringify(payloadToStore);
    estimatedBytes += new Blob([jsonStr]).size;

    const metaHeaders = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'X-Movix-Offline': '1',
      'X-Movix-Saved-At': savedAt,
      'X-Movix-Expires-At': expiresAt,
    });
    await metaCache.put(metadataUrl, new Response(jsonStr, { status: 200, headers: metaHeaders }));

    if (seasonMetadataUrl && seasonData) {
      const seasonStr = JSON.stringify(seasonData);
      estimatedBytes += new Blob([seasonStr]).size;
      await metaCache.put(
        seasonMetadataUrl,
        new Response(seasonStr, {
          status: 200,
          headers: new Headers({
            'Content-Type': 'application/json; charset=utf-8',
            'X-Movix-Offline': '1',
            'X-Movix-Saved-At': savedAt,
            'X-Movix-Expires-At': expiresAt,
          }),
        })
      );
    }

    const urlsToCache = new Set<string>();
    if (finalPoster) urlsToCache.add(finalPoster);
    if (finalBackdrop) urlsToCache.add(finalBackdrop);
    // Also cache the exact poster size used in Favorites / Poster Cards (w500 vs w342)
    if (input.posterUrl && input.posterUrl !== finalPoster) {
      urlsToCache.add(input.posterUrl);
    }
    if (finalPoster && finalPoster.includes('/w342/')) {
      urlsToCache.add(finalPoster.replace('/w342/', '/w500/'));
    } else if (finalPoster && finalPoster.includes('/w500/')) {
      urlsToCache.add(finalPoster.replace('/w500/', '/w342/'));
    }

    const imgResults = await Promise.all(
      Array.from(urlsToCache).map(async (u) => {
        const size = await cacheImageUrl(imgCache, u);
        if (size > 0) cachedImageUrls.push(u);
        return size;
      })
    );
    estimatedBytes += imgResults.reduce((acc, n) => acc + n, 0);
  }

  const record: OfflineSavedItem = {
    key,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    title,
    originalTitle,
    overview,
    posterUrl: finalPoster,
    backdropUrl: finalBackdrop,
    year,
    rating,
    genres,
    runtime: details && details.mediaType === 'movie' ? details.runtime : undefined,
    numberOfSeasons: details && details.mediaType === 'tv' ? details.numberOfSeasons : undefined,
    savedAt,
    expiresAt,
    metadataUrl,
    seasonMetadataUrl,
    cachedImageUrls,
    estimatedBytes,
  };

  const existing = readOfflineIndex().filter((item) => item.key !== key);
  writeOfflineIndex([record, ...existing]);

  if (!input.silentNotification) {
    void showNativeSystemNotification({
      title: 'Guardado para Assistir Offline 📥',
      body: `"${title}" foi guardado no dispositivo para acesso sem internet.`,
      imageUrl: finalPoster || undefined,
      targetUrl: '#/minha-lista/offline',
      tag: `movix-offline-${key}`,
      category: 'app_updates',
    });
  }

  return record;
}

export async function removeOfflineItem(key: string): Promise<OfflineSavedItem[]> {
  const all = readOfflineIndex();
  const target = all.find((item) => item.key === key);
  const remaining = all.filter((item) => item.key !== key);

  if (target && isCacheApiSupported()) {
    try {
      const [metaCache, imgCache] = await Promise.all([
        caches.open(OFFLINE_METADATA_CACHE),
        caches.open(OFFLINE_IMAGES_CACHE),
      ]);
      await metaCache.delete(target.metadataUrl);
      if (target.seasonMetadataUrl) {
        await metaCache.delete(target.seasonMetadataUrl);
      }
      // Only remove images not referenced by another offline item
      const stillReferenced = new Set(remaining.flatMap((r) => r.cachedImageUrls));
      await Promise.all(
        target.cachedImageUrls
          .filter((url) => !stillReferenced.has(url))
          .map((url) => imgCache.delete(url))
      );
    } catch {
      // Ignore cache deletion errors
    }
  }

  writeOfflineIndex(remaining);
  return remaining;
}

export async function clearAllOfflineItems(): Promise<void> {
  if (isCacheApiSupported()) {
    try {
      await Promise.all([
        caches.delete(OFFLINE_METADATA_CACHE),
        caches.delete(OFFLINE_IMAGES_CACHE),
      ]);
    } catch {
      // Ignore cache deletion errors
    }
  }
  writeOfflineIndex([]);
}

export async function pruneExpiredOfflineItems(): Promise<number> {
  const all = readOfflineIndex();
  const now = Date.now();
  const expired = all.filter((item) => new Date(item.expiresAt).getTime() <= now);
  if (expired.length === 0) return 0;

  for (const item of expired) {
    await removeOfflineItem(item.key);
  }
  return expired.length;
}

export async function saveAllFavoritesOffline(
  favorites: FavoriteItem[],
  onProgress?: (done: number, total: number) => void
): Promise<OfflineSavedItem[]> {
  const existingKeys = getOfflineItemKeys();
  const toSave = favorites.filter((f) => !existingKeys.has(f.key));
  const total = toSave.length;
  let done = 0;

  for (const fav of toSave) {
    await saveItemForOffline({
      mediaType: fav.mediaType,
      tmdbId: fav.tmdbId,
      title: fav.title,
      posterUrl: fav.posterUrl,
      year: fav.year,
      rating: fav.rating,
      silentNotification: true,
    });
    done += 1;
    onProgress?.(done, total);
  }

  if (done > 0) {
    void showNativeSystemNotification({
      title: 'Favoritos guardados Offline 📥',
      body: `${done} título(s) guardado(s) no dispositivo para acesso sem internet.`,
      targetUrl: '#/minha-lista/offline',
      tag: 'movix-offline-batch',
      category: 'app_updates',
    });
  }

  return getOfflineItems();
}

export async function readCachedMetadata<T>(apiUrl: string): Promise<T | null> {
  if (!isCacheApiSupported()) return null;
  try {
    const cache = await caches.open(OFFLINE_METADATA_CACHE);
    const match = await cache.match(apiUrl);
    if (!match) return null;
    const expiresHeader = match.headers.get('X-Movix-Expires-At');
    if (expiresHeader && new Date(expiresHeader).getTime() <= Date.now()) {
      await cache.delete(apiUrl);
      return null;
    }
    return (await match.json()) as T;
  } catch {
    return null;
  }
}

export async function getOfflineCacheStats(): Promise<{
  itemCount: number;
  metadataEntries: number;
  imageEntries: number;
  totalEstimatedBytes: number;
  ttlDays: number;
  cacheSupported: boolean;
}> {
  const items = getOfflineItems();
  const totalEstimatedBytes = items.reduce((sum, i) => sum + (i.estimatedBytes || 0), 0);

  if (!isCacheApiSupported()) {
    return {
      itemCount: items.length,
      metadataEntries: 0,
      imageEntries: 0,
      totalEstimatedBytes,
      ttlDays: DEFAULT_TTL_DAYS,
      cacheSupported: false,
    };
  }

  try {
    const [metaCache, imgCache] = await Promise.all([
      caches.open(OFFLINE_METADATA_CACHE),
      caches.open(OFFLINE_IMAGES_CACHE),
    ]);
    const [metaKeys, imgKeys] = await Promise.all([metaCache.keys(), imgCache.keys()]);
    return {
      itemCount: items.length,
      metadataEntries: metaKeys.length,
      imageEntries: imgKeys.length,
      totalEstimatedBytes,
      ttlDays: DEFAULT_TTL_DAYS,
      cacheSupported: true,
    };
  } catch {
    return {
      itemCount: items.length,
      metadataEntries: items.length,
      imageEntries: items.reduce((sum, i) => sum + i.cachedImageUrls.length, 0),
      totalEstimatedBytes,
      ttlDays: DEFAULT_TTL_DAYS,
      cacheSupported: true,
    };
  }
}

export { DEFAULT_TTL_MS };
