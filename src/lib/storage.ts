import type { FavoriteItem, MediaSummary, WatchProgressItem } from '../types/movix';

const FAVORITES_KEY = 'movix:favorites:v1';
const PROGRESS_KEY = 'movix:progress:v1';
const HISTORY_KEY = 'movix:history:v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors
  }
}

export function getFavorites(): FavoriteItem[] {
  return readJson<FavoriteItem[]>(FAVORITES_KEY, []);
}

export function isFavorite(mediaType: 'movie' | 'tv', tmdbId: number): boolean {
  const key = `${mediaType}:${tmdbId}`;
  return getFavorites().some((f) => f.key === key);
}

export function toggleFavorite(item: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterUrl: string | null;
  year: string;
  rating: number;
}): { favorites: FavoriteItem[]; active: boolean } {
  const list = getFavorites();
  const key = `${item.mediaType}:${item.tmdbId}`;
  const exists = list.some((f) => f.key === key);

  let next: FavoriteItem[];
  if (exists) {
    next = list.filter((f) => f.key !== key);
  } else {
    next = [
      {
        key,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        posterUrl: item.posterUrl,
        year: item.year,
        rating: item.rating,
        addedAt: new Date().toISOString(),
      },
      ...list,
    ];
  }
  writeJson(FAVORITES_KEY, next);
  return { favorites: next, active: !exists };
}

export function getWatchProgressList(): WatchProgressItem[] {
  return readJson<WatchProgressItem[]>(PROGRESS_KEY, []);
}

export function getWatchProgress(
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  seasonNumber?: number,
  episodeNumber?: number
): WatchProgressItem | null {
  const key =
    mediaType === 'tv' && seasonNumber !== undefined && episodeNumber !== undefined
      ? `tv:${tmdbId}:s${seasonNumber}:e${episodeNumber}`
      : `movie:${tmdbId}`;
  return getWatchProgressList().find((p) => p.key === key) || null;
}

export function saveWatchProgress(entry: WatchProgressItem): void {
  const list = getWatchProgressList().filter((p) => p.key !== entry.key);
  const updated = [entry, ...list].slice(0, 40);
  writeJson(PROGRESS_KEY, updated);
}

export function removeWatchProgress(key: string): WatchProgressItem[] {
  const next = getWatchProgressList().filter((p) => p.key !== key);
  writeJson(PROGRESS_KEY, next);
  return next;
}

export function getWatchHistory(): WatchProgressItem[] {
  return readJson<WatchProgressItem[]>(HISTORY_KEY, []);
}

export function recordWatchHistory(entry: WatchProgressItem): void {
  const list = getWatchHistory().filter((p) => p.key !== entry.key);
  const updated = [entry, ...list].slice(0, 60);
  writeJson(HISTORY_KEY, updated);
}

export function clearWatchHistory(): void {
  writeJson(HISTORY_KEY, []);
}

export function summaryToFavoritePayload(item: MediaSummary) {
  return {
    tmdbId: item.id,
    mediaType: item.mediaType,
    title: item.title,
    posterUrl: item.posterUrl,
    year: item.year,
    rating: item.rating,
  };
}
