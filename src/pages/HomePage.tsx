import { useCallback, useEffect, useMemo, useState } from 'react';
import { Film } from 'lucide-react';
import { buildSlidesFromCatalog, HeroCarousel } from '../components/HeroCarousel';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { MediaPosterCard } from '../components/MediaPosterCard';
import { MediaRow } from '../components/MediaRow';
import { MovixAdSlot } from '../components/MovixAdSlot';
import { StreamingHubRow } from '../components/StreamingHubRow';
import { useAuth } from '../contexts/AuthContext';
import { movixApi, type HomeCatalogResponse, type PublicConfigResponse } from '../lib/api';
import { getWatchProgressList } from '../lib/storage';
import type { AppRoute, MediaSummary, WatchProgressItem } from '../types/movix';

interface HomePageProps {
  publicConfig: PublicConfigResponse | null;
  onNavigate: (route: AppRoute) => void;
  onQuickPlay: (item: MediaSummary) => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (item: MediaSummary) => void;
}

export function HomePage({
  publicConfig,
  onNavigate,
  onQuickPlay,
  favoriteKeys,
  onToggleFavorite,
}: HomePageProps) {
  const { t, language } = useAuth();
  const [catalog, setCatalog] = useState<HomeCatalogResponse | null>(() =>
    movixApi.getCachedHomeCatalog()
  );
  const [loading, setLoading] = useState(() => !movixApi.getCachedHomeCatalog());
  const [error, setError] = useState<string | null>(null);
  const [needsTmdbConfig, setNeedsTmdbConfig] = useState(false);
  const [continueList, setContinueList] = useState<WatchProgressItem[]>([]);
  const [extraItems, setExtraItems] = useState<MediaSummary[]>([]);
  const [extraPage, setExtraPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreExtra, setHasMoreExtra] = useState(true);

  useEffect(() => {
    setContinueList(getWatchProgressList());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const hasCached = Boolean(movixApi.getCachedHomeCatalog());
      if (!hasCached) setLoading(true);
      setError(null);
      setNeedsTmdbConfig(false);
      try {
        const data = await movixApi.getHomeCatalog();
        if (!cancelled) {
          setCatalog(data);
          movixApi.prefetchBrowseCatalogs();
        }
      } catch (err) {
        if (!cancelled && !hasCached) {
          const e = err as Error & { code?: string };
          if (e.code === 'TMDB_NOT_CONFIGURED' || e.message === 'TMDB_NOT_CONFIGURED') {
            setNeedsTmdbConfig(true);
          } else {
            setError(e.message || 'Erro ao carregar o catálogo inicial.');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Build Hero slides from Admin custom banners first, then top TMDB items
  const heroSlides = useMemo(() => {
    const adminBanners = publicConfig?.banners || [];
    if (adminBanners.length > 0) {
      return adminBanners
        .filter((b) => Boolean(b.backdropUrl || b.posterUrl))
        .map((b) => ({
          id: b.tmdbId || 0,
          mediaType: b.mediaType,
          title: b.title,
          rating: b.rating,
          backdropUrl: b.backdropUrl || b.posterUrl,
        }));
    }

    return buildSlidesFromCatalog(
      [...(catalog?.nowPlayingMovies || []), ...(catalog?.popularSeries || [])],
      6
    );
  }, [publicConfig, catalog]);

  // Build clean "Recomendados para Você" dense grid combining top series & movies
  const recommendedGrid = useMemo(() => {
    const combined: MediaSummary[] = [];
    const seen = new Set<string>();
    const sources = [catalog?.popularSeries || [], catalog?.nowPlayingMovies || [], catalog?.popularMovies || []];
    for (let i = 0; i < 12; i++) {
      for (const list of sources) {
        const item = list[i];
        if (!item) continue;
        const k = `${item.mediaType}:${item.id}`;
        if (!seen.has(k)) {
          seen.add(k);
          combined.push(item);
        }
      }
      if (combined.length >= 12) break;
    }
    return combined.slice(0, 12);
  }, [catalog]);

  const openMedia = (item: MediaSummary) => {
    onNavigate({ page: item.mediaType === 'tv' ? 'tv' : 'movie', id: item.id });
  };

  const loadMoreHomeContent = useCallback(async () => {
    if (loadingMore || !hasMoreExtra || !catalog) return;
    const nextPage = extraPage + 1;
    if (nextPage > 500) {
      setHasMoreExtra(false);
      return;
    }
    setLoadingMore(true);
    try {
      const [moviesRes, seriesRes] = await Promise.all([
        movixApi.getMovies({ category: 'popular', page: nextPage }),
        movixApi.getSeries({ category: 'popular', page: nextPage }),
      ]);
      const interleaved: MediaSummary[] = [];
      const maxLen = Math.max(moviesRes.results.length, seriesRes.results.length);
      for (let i = 0; i < maxLen; i++) {
        if (seriesRes.results[i]) interleaved.push(seriesRes.results[i]);
        if (moviesRes.results[i]) interleaved.push(moviesRes.results[i]);
      }
      setExtraItems((prev) => {
        const seen = new Set(prev.map((x) => `${x.mediaType}:${x.id}`));
        const additions = interleaved.filter((x) => !seen.has(`${x.mediaType}:${x.id}`));
        return [...prev, ...additions];
      });
      setExtraPage(nextPage);
      if (nextPage >= moviesRes.totalPages && nextPage >= seriesRes.totalPages) {
        setHasMoreExtra(false);
      }
    } catch {
      // ignore transient scroll fetch error
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreExtra, catalog, extraPage]);

  const isFav = (item: MediaSummary) => favoriteKeys.has(`${item.mediaType}:${item.id}`);

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 py-5 space-y-8">
        <div className="h-[220px] sm:h-[380px] lg:h-[460px] rounded-2xl bg-[#0F131E] border border-white/[0.06]" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-[126px] sm:w-[164px] aspect-[16/9] shrink-0 rounded-xl bg-[#0F131E]" />
          ))}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-xl bg-[#0F131E] border border-white/[0.05]" />
          ))}
        </div>
      </div>
    );
  }

  if (needsTmdbConfig) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-14 sm:py-20">
        <div className="rounded-2xl bg-[#0F131E] border border-white/10 p-8 sm:p-10 text-center space-y-5 shadow-2xl">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-[#E5B85A]/15 border border-[#E5B85A]/30 flex items-center justify-center text-[#F3C669]">
            <Film className="h-7 w-7" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#F6F7FB] text-balance">
            Catálogo temporariamente indisponível
          </h1>
          <p className="text-sm sm:text-base text-[#95A0B8] leading-relaxed">
            Não foi possível carregar os dados do catálogo neste momento. Tente novamente em instantes.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-sm font-semibold transition-all cursor-pointer"
            >
              <span>Tentar novamente</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <p className="text-base text-rose-400">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-sm font-semibold cursor-pointer"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const categorySectionMap: Record<string, { title: string; items: MediaSummary[]; viewAll: () => void }> = {
    'cat-series': {
      title: t.series,
      items: catalog?.popularSeries || [],
      viewAll: () => onNavigate({ page: 'series' }),
    },
    'cat-filmes': {
      title: t.movies,
      items: catalog?.popularMovies || [],
      viewAll: () => onNavigate({ page: 'movies' }),
    },
    'cat-animes': {
      title: t.animes,
      items: catalog?.animes || [],
      viewAll: () => onNavigate({ page: 'section', section: 'animes' }),
    },
    'cat-novelas': {
      title: t.novelas,
      items: catalog?.novelas || [],
      viewAll: () => onNavigate({ page: 'section', section: 'novelas' }),
    },
    'cat-doramas': {
      title: t.doramas,
      items: catalog?.doramas || [],
      viewAll: () => onNavigate({ page: 'section', section: 'doramas' }),
    },
    'cat-dramas': {
      title: t.dramas,
      items: catalog?.dramas || [],
      viewAll: () => onNavigate({ page: 'section', section: 'dramas' }),
    },
    'cat-infantil': {
      title: t.kids,
      items: catalog?.infantil || [],
      viewAll: () => onNavigate({ page: 'section', section: 'infantil' }),
    },
    'cat-docs': {
      title: t.documentaries,
      items: catalog?.documentarios || [],
      viewAll: () => onNavigate({ page: 'section', section: 'documentarios' }),
    },
    // Legacy compatibility
    'cat-populares': {
      title: t.movies,
      items: catalog?.popularMovies || [],
      viewAll: () => onNavigate({ page: 'movies' }),
    },
    'cat-lancamentos': {
      title: t.latestReleases,
      items: catalog?.nowPlayingMovies || [],
      viewAll: () => onNavigate({ page: 'movies' }),
    },
    'cat-series-pop': {
      title: t.series,
      items: catalog?.popularSeries || [],
      viewAll: () => onNavigate({ page: 'series' }),
    },
  };

  const defaultSectionIds = [
    'cat-series',
    'cat-filmes',
    'cat-animes',
    'cat-novelas',
    'cat-doramas',
    'cat-dramas',
    'cat-infantil',
    'cat-docs',
  ];

  const orderedCategories = (() => {
    const base =
      publicConfig?.categories && publicConfig.categories.length > 0
        ? publicConfig.categories
        : defaultSectionIds.map((id, i) => ({
            id,
            name: categorySectionMap[id].title,
            source: 'tmdb' as const,
            externalId: id,
            mediaType: 'movie' as const,
            visible: true,
            order: i + 1,
          }));
    const existingIds = new Set(base.map((c) => c.id));
    const missingDefaults = defaultSectionIds
      .filter(
        (id) =>
          !existingIds.has(id) &&
          !(id === 'cat-filmes' && existingIds.has('cat-populares')) &&
          !(id === 'cat-series' && existingIds.has('cat-series-pop'))
      )
      .map((id, idx) => ({
        id,
        name: categorySectionMap[id].title,
        source: 'tmdb' as const,
        externalId: id,
        mediaType: 'movie' as const,
        visible: true,
        order: base.length + idx + 1,
      }));
    return [...base, ...missingDefaults];
  })();

  return (
    <div className="pb-12">
      {/* Panoramic Hero Carousel (with native MOVIX ADS integration) */}
      <HeroCarousel
        slides={heroSlides}
        adPlacements={['home']}
        onSelectSlide={(slide) =>
          onQuickPlay({
            id: slide.id,
            mediaType: slide.mediaType,
            title: slide.title,
            originalTitle: slide.title,
            overview: '',
            posterUrl: null,
            backdropUrl: slide.backdropUrl,
            year: '',
            releaseDate: '',
            rating: slide.rating,
            voteCount: 0,
            genreIds: [],
            popularity: 0,
          })
        }
      />

      {/* Main Content Container */}
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-9 sm:space-y-11">
        {/* 1. Streaming Platform Hub Row */}
        <StreamingHubRow onNavigate={onNavigate} />

        {/* MOVIX ADS — Home placement (renders nothing if no active ad) */}
        <MovixAdSlot placement="home" />

        {/* Live-synced MOVIX ADM Published Catalog (Movies & Series added in MOVIX ADM) */}
        {((publicConfig?.managedMovies && publicConfig.managedMovies.length > 0) ||
          (publicConfig?.managedSeries && publicConfig.managedSeries.length > 0)) && (
          <MediaRow
            title="Novidades MOVIX"
            items={[
              ...(publicConfig?.managedMovies || [])
                .filter((m) => m.tmdbId !== null)
                .map((m) => ({
                  id: m.tmdbId as number,
                  mediaType: 'movie' as const,
                  title: m.title,
                  originalTitle: m.originalTitle || m.title,
                  overview: m.overview,
                  posterUrl: m.posterUrl || null,
                  backdropUrl: m.backdropUrl || null,
                  year: m.year,
                  releaseDate: m.releaseDate,
                  rating: m.rating,
                  voteCount: 0,
                  genreIds: [],
                  popularity: 0,
                })),
              ...(publicConfig?.managedSeries || [])
                .filter((s) => s.tmdbId !== null)
                .map((s) => ({
                  id: s.tmdbId as number,
                  mediaType: 'tv' as const,
                  title: s.title,
                  originalTitle: s.originalTitle || s.title,
                  overview: s.overview,
                  posterUrl: s.posterUrl || null,
                  backdropUrl: s.backdropUrl || null,
                  year: s.year,
                  releaseDate: s.releaseDate,
                  rating: s.rating,
                  voteCount: 0,
                  genreIds: [],
                  popularity: 0,
                })),
            ]}
            onSelect={openMedia}
            onPlay={onQuickPlay}
            isFavoriteFn={isFav}
            onToggleFavorite={onToggleFavorite}
          />
        )}

        {/* 2. Recommended Grid */}
        {recommendedGrid.length > 0 && (
          <section className="space-y-3.5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-[#F6F7FB]">
                {t.recommendedForYou}
              </h2>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'movies' })}
                className="text-xs sm:text-sm font-medium text-[#95A0B8] hover:text-[#F3C669] cursor-pointer transition-colors"
              >
                {t.viewAll}
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
              {recommendedGrid.map((item) => (
                <MediaPosterCard
                  key={`rec-${item.mediaType}-${item.id}`}
                  item={item}
                  onSelect={openMedia}
                  onPlay={onQuickPlay}
                  isFavorite={isFav(item)}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}

        {/* 3. Continue Watching */}
        {continueList.length > 0 && (
          <section className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-[#F6F7FB]">
                {t.continueWatching}
              </h2>
              <button
                type="button"
                onClick={() => onNavigate({ page: 'mylist' })}
                className="text-xs sm:text-sm font-medium text-[#95A0B8] hover:text-[#F3C669] cursor-pointer transition-colors"
              >
                {t.manageHistory}
              </button>
            </div>
            <div className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-none pb-2">
              {continueList.slice(0, 10).map((entry) => {
                const pct = entry.duration > 0 ? Math.round((entry.currentTime / entry.duration) * 100) : 10;
                const summary: MediaSummary = {
                  id: entry.tmdbId,
                  mediaType: entry.mediaType,
                  title: entry.title,
                  originalTitle: entry.title,
                  overview: '',
                  posterUrl: entry.posterUrl,
                  backdropUrl: entry.backdropUrl,
                  year: '',
                  releaseDate: '',
                  rating: 0,
                  voteCount: 0,
                  genreIds: [],
                  popularity: 0,
                };
                const sub =
                  entry.mediaType === 'tv' && entry.seasonNumber && entry.episodeNumber
                    ? `T${entry.seasonNumber} E${entry.episodeNumber} · ${pct}% ${t.watchedPct}`
                    : `${pct}% ${t.watchedPct}`;

                return (
                  <div key={entry.key} className="w-[120px] sm:w-[172px] md:w-[190px] shrink-0">
                    <MediaPosterCard
                      item={summary}
                      onSelect={openMedia}
                      onPlay={onQuickPlay}
                      progressPercent={pct}
                      subtitleOverride={sub}
                      isFavorite={isFav(summary)}
                      onToggleFavorite={onToggleFavorite}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 4. Admin Highlights */}
        {publicConfig?.highlights && publicConfig.highlights.length > 0 && (
          <MediaRow
            title={t.featuredHighlights}
            items={publicConfig.highlights.map((h) => ({
              id: h.tmdbId,
              mediaType: h.mediaType,
              title: h.title,
              originalTitle: h.title,
              overview: '',
              posterUrl: h.posterUrl || null,
              backdropUrl: h.backdropUrl || null,
              year: h.year,
              releaseDate: '',
              rating: h.rating,
              voteCount: 0,
              genreIds: [],
              popularity: 0,
            }))}
            onSelect={openMedia}
            onPlay={onQuickPlay}
            isFavoriteFn={isFav}
            onToggleFavorite={onToggleFavorite}
          />
        )}

        {/* 5. Organized Catalog Rows */}
        {orderedCategories.map((cat, idx) => {
          const section = categorySectionMap[cat.id];
          if (!section || !cat.visible) return null;
          return (
            <div key={cat.id} className="space-y-9 sm:space-y-11">
              <MediaRow
                title={section.title || cat.name}
                items={section.items}
                onSelect={openMedia}
                onPlay={onQuickPlay}
                onViewAll={section.viewAll}
                isFavoriteFn={isFav}
                onToggleFavorite={onToggleFavorite}
              />
              {idx === 1 && <MovixAdSlot placement="between_movies" />}
            </div>
          );
        })}

        {/* MOVIX ADS — Sidebar / In-content placement */}
        <div className="flex justify-center empty:hidden">
          <MovixAdSlot placement="sidebar" />
        </div>

        {/* 6. Endless Catalog Stream */}
        <section className="space-y-3.5">
          {extraItems.length > 0 && (
            <>
              <h2 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-[#F6F7FB]">
                {t.exploreMore}
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
                {extraItems.map((item) => (
                  <MediaPosterCard
                    key={`extra-${item.mediaType}-${item.id}`}
                    item={item}
                    onSelect={openMedia}
                    onPlay={onQuickPlay}
                    isFavorite={isFav(item)}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </div>
            </>
          )}

          <InfiniteScrollSentinel
            hasMore={hasMoreExtra}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMoreHomeContent()}
          />
        </section>
      </div>
    </div>
  );
}
