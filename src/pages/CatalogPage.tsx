import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { buildSlidesFromCatalog, HeroCarousel } from '../components/HeroCarousel';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { MediaPosterCard } from '../components/MediaPosterCard';
import { MovixAdSlot } from '../components/MovixAdSlot';
import { movixApi, type PublicConfigResponse } from '../lib/api';
import type { AppRoute, MediaSummary } from '../types/movix';

interface CatalogPageProps {
  mode: 'movie' | 'tv';
  publicConfig?: PublicConfigResponse | null;
  onNavigate: (route: AppRoute) => void;
  onGoBack: () => void;
  onPlay: (item: MediaSummary) => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (item: MediaSummary) => void;
}

function getInitialCatalog(mode: 'movie' | 'tv') {
  return mode === 'movie'
    ? movixApi.getCachedMovies({ category: 'popular', page: 1 })
    : movixApi.getCachedSeries({ category: 'popular', page: 1 });
}

export function CatalogPage({
  mode,
  publicConfig,
  onNavigate,
  onGoBack,
  onPlay,
  favoriteKeys,
  onToggleFavorite,
}: CatalogPageProps) {
  const initial = getInitialCatalog(mode);
  const [page, setPage] = useState<number>(1);
  const [items, setItems] = useState<MediaSummary[]>(() => initial?.results || []);
  const [totalPages, setTotalPages] = useState<number>(() => initial?.totalPages || 1);
  const [loading, setLoading] = useState<boolean>(() => !initial?.results?.length);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = getInitialCatalog(mode);
    setItems(cached?.results || []);
    setTotalPages(cached?.totalPages || 1);
    setLoading(!cached?.results?.length);
    setError(null);
    setPage(1);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached = page === 1 ? getInitialCatalog(mode) : null;
      if (page === 1 && !cached?.results?.length) {
        setLoading(true);
      } else if (page > 1) {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const fetcher = mode === 'movie' ? movixApi.getMovies : movixApi.getSeries;
        const res = await fetcher({
          category: 'popular',
          page,
        });
        if (!cancelled) {
          setItems((prev) => {
            if (page === 1) return res.results;
            const seen = new Set(prev.map((x) => `${x.mediaType}:${x.id}`));
            return [...prev, ...res.results.filter((x) => !seen.has(`${x.mediaType}:${x.id}`))];
          });
          setTotalPages(res.totalPages);
        }
      } catch (err) {
        if (!cancelled && page === 1 && !cached?.results?.length) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar catálogo.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, page]);

  const mergedItems = useMemo(() => {
    const customItems: MediaSummary[] =
      mode === 'movie'
        ? (publicConfig?.managedMovies || [])
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
              popularity: 9999,
            }))
        : (publicConfig?.managedSeries || [])
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
              popularity: 9999,
            }));

    if (customItems.length === 0) return items;
    const seen = new Set(customItems.map((c) => `${c.mediaType}:${c.id}`));
    return [...customItems, ...items.filter((x) => !seen.has(`${x.mediaType}:${x.id}`))];
  }, [mode, publicConfig?.managedMovies, publicConfig?.managedSeries, items]);

  const heroSlides = useMemo(() => buildSlidesFromCatalog(mergedItems, 6), [mergedItems]);

  return (
    <div>
      {heroSlides.length > 0 ? (
        <HeroCarousel
          slides={heroSlides}
          adPlacements={['categories_page', 'home']}
          onSelectSlide={(slide) =>
            onPlay({
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
      ) : loading ? (
        <div className="h-[220px] sm:h-[360px] lg:h-[440px] bg-[#0B0E17] border-b border-white/[0.06]" />
      ) : null}

      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 pt-4 pb-8 space-y-4">
        <div>
          <button
            type="button"
            onClick={onGoBack}
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-[#95A0B8] hover:text-[#F3C669] cursor-pointer transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Voltar</span>
          </button>
        </div>

        {loading && mergedItems.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-xl bg-[#0F131E] border border-white/[0.05]" />
            ))}
          </div>
        ) : error && mergedItems.length === 0 ? (
          <div className="rounded-2xl bg-[#0F131E] border border-white/10 p-8 max-w-xl mx-auto text-center space-y-4">
            <p className="text-sm text-[#C8D0E2]">
              {error === 'TMDB_NOT_CONFIGURED'
                ? 'O catálogo está temporariamente indisponível neste servidor.'
                : error}
            </p>
            <button
              type="button"
              onClick={onGoBack}
              className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-sm font-semibold cursor-pointer"
            >
              Voltar
            </button>
          </div>
        ) : mergedItems.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#8E99B2]">
            Nenhum título disponível no momento.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
            {mergedItems.map((item, idx) => (
              <Fragment key={`${item.mediaType}-${item.id}`}>
                <MediaPosterCard
                  item={item}
                  onSelect={(selected) =>
                    onNavigate({ page: selected.mediaType === 'tv' ? 'tv' : 'movie', id: selected.id })
                  }
                  onPlay={onPlay}
                  isFavorite={favoriteKeys.has(`${item.mediaType}:${item.id}`)}
                  onToggleFavorite={onToggleFavorite}
                />
                {idx === 5 && <MovixAdSlot placement="between_movies" className="col-span-full my-2" />}
              </Fragment>
            ))}
          </div>
        )}

        {!loading && (
          <div className="pt-2 empty:hidden">
            <MovixAdSlot placement="categories_page" />
          </div>
        )}

        {!loading && (
          <InfiniteScrollSentinel
            hasMore={page < totalPages}
            loadingMore={loadingMore}
            onLoadMore={() => {
              if (!loadingMore && page < totalPages) {
                setPage((p) => p + 1);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
