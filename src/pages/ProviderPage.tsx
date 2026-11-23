import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { buildSlidesFromCatalog, HeroCarousel } from '../components/HeroCarousel';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { MediaPosterCard } from '../components/MediaPosterCard';
import { MovixAdSlot } from '../components/MovixAdSlot';
import { movixApi } from '../lib/api';
import { getStreamingPlatformBySlug } from '../lib/providers';
import type { AppRoute, MediaSummary, StreamingPlatformSlug } from '../types/movix';

interface ProviderPageProps {
  slug: StreamingPlatformSlug;
  onNavigate: (route: AppRoute) => void;
  onGoBack: () => void;
  onPlay: (item: MediaSummary) => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (item: MediaSummary) => void;
}

export function ProviderPage({
  slug,
  onNavigate,
  onGoBack,
  onPlay,
  favoriteKeys,
  onToggleFavorite,
}: ProviderPageProps) {
  const platform = getStreamingPlatformBySlug(slug);
  const [mediaType, setMediaType] = useState<'all' | 'movie' | 'tv'>('all');
  const initial = movixApi.getCachedStreamingProvider(platform.providerId, { mediaType: 'all', page: 1 });
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MediaSummary[]>(() => initial?.results || []);
  const [totalPages, setTotalPages] = useState(() => initial?.totalPages || 1);
  const [loading, setLoading] = useState(() => !initial?.results?.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const plat = getStreamingPlatformBySlug(slug);
    const cached = movixApi.getCachedStreamingProvider(plat.providerId, { mediaType: 'all', page: 1 });
    setMediaType('all');
    setItems(cached?.results || []);
    setTotalPages(cached?.totalPages || 1);
    setLoading(!cached?.results?.length);
    setError(null);
    setPage(1);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const cached =
        page === 1 ? movixApi.getCachedStreamingProvider(platform.providerId, { mediaType, page: 1 }) : null;
      if (page === 1 && !cached?.results?.length) {
        setLoading(true);
      } else if (page > 1) {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const res = await movixApi.getStreamingProvider(platform.providerId, { mediaType, page });
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
          setError(err instanceof Error ? err.message : 'Erro ao carregar catálogo da plataforma.');
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
  }, [platform.providerId, mediaType, page]);

  const heroSlides = useMemo(() => buildSlidesFromCatalog(items, 6), [items]);

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onGoBack}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-[#95A0B8] hover:text-[#F3C669] cursor-pointer transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Voltar</span>
            </button>
            <span className="text-white/20" aria-hidden="true">·</span>
            <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#F6F7FB]">
              {platform.name}
            </h1>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0F131E] border border-white/[0.08] self-start">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'movie', label: 'Filmes' },
                { id: 'tv', label: 'Séries' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  const cached = movixApi.getCachedStreamingProvider(platform.providerId, {
                    mediaType: tab.id,
                    page: 1,
                  });
                  setMediaType(tab.id);
                  setPage(1);
                  if (cached?.results?.length) {
                    setItems(cached.results);
                    setTotalPages(cached.totalPages);
                    setLoading(false);
                  }
                }}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                  mediaType === tab.id
                    ? 'bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] shadow-sm'
                    : 'text-[#95A0B8] hover:text-[#F6F7FB]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading && items.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-xl bg-[#0F131E] border border-white/[0.05]" />
            ))}
          </div>
        ) : error ? (
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
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-[#8E99B2]">
            Nenhum título encontrado para {platform.name} nesta categoria.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
            {items.map((item, idx) => (
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
