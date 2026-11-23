import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CloudDownload, Film, Heart, Loader2, Play, Share2, Tv, User, WifiOff } from 'lucide-react';
import { MediaPosterCard } from '../components/MediaPosterCard';
import { MovixAdSlot } from '../components/MovixAdSlot';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { admApi } from '../lib/admApi';
import { movixApi } from '../lib/api';
import { isSavedOffline, removeOfflineItem, saveItemForOffline } from '../lib/offlineCache';
import { getWatchProgress } from '../lib/storage';
import type {
  AppRoute,
  EpisodeItem,
  MediaSummary,
  MovieDetails,
  PlaybackRequest,
  SeasonDetails,
  SeriesDetails,
} from '../types/movix';

interface DetailPageProps {
  mediaType: 'movie' | 'tv';
  id: number;
  autoPlay?: { season?: number; episode?: number } | null;
  onAutoPlayConsumed?: () => void;
  onNavigate: (route: AppRoute) => void;
  onGoBack: () => void;
  onPlay: (req: PlaybackRequest) => void;
  onQuickPlay?: (item: MediaSummary) => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (item: MediaSummary) => void;
}

function formatRuntime(mins: number): string {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function DetailPage({
  mediaType,
  id,
  autoPlay,
  onAutoPlayConsumed,
  onNavigate,
  onGoBack,
  onPlay,
  onQuickPlay,
  favoriteKeys,
  onToggleFavorite,
}: DetailPageProps) {
  const { t, language } = useAuth();
  const [movie, setMovie] = useState<MovieDetails | null>(null);
  const [series, setSeries] = useState<SeriesDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(autoPlay?.season || 1);
  const [seasonData, setSeasonData] = useState<SeasonDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [startingPlayback, setStartingPlayback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(() => isSavedOffline(mediaType, id));
  const [savingOffline, setSavingOffline] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const autoPlayedRef = useRef<string | null>(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    setSavedOffline(isSavedOffline(mediaType, id));
    setOfflineNotice(null);
    setShareCopied(false);
    if (autoPlay?.season) {
      setSelectedSeason(autoPlay.season);
    }
  }, [mediaType, id, autoPlay?.season]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setMovie(null);
      setSeries(null);
      setSeasonData(null);
      try {
        if (mediaType === 'movie') {
          const data = await movixApi.getMovieDetails(id);
          if (!cancelled) {
            setMovie(data);
            document.title = `${data.title} (${data.year || 'Filme'}) – MOVIX`;
          }
        } else {
          const data = await movixApi.getSeriesDetails(id);
          if (!cancelled) {
            setSeries(data);
            document.title = `${data.title} (${data.year || 'Série'}) – MOVIX`;
            const firstSeason = autoPlay?.season || data.seasons[0]?.seasonNumber || 1;
            setSelectedSeason(firstSeason);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mediaType, id, language]);

  useEffect(() => {
    if (mediaType !== 'tv' || !series) return;
    let cancelled = false;
    async function loadSeason() {
      setLoadingSeason(true);
      try {
        const s = await movixApi.getSeriesSeason(id, selectedSeason);
        if (!cancelled) setSeasonData(s);
      } catch {
        if (!cancelled) setSeasonData(null);
      } finally {
        if (!cancelled) setLoadingSeason(false);
      }
    }
    void loadSeason();
    return () => {
      cancelled = true;
    };
  }, [mediaType, id, series, selectedSeason, language]);

  const current = mediaType === 'movie' ? movie : series;

  const handlePlayMovie = async (trailerOnly = false) => {
    if (!movie) return;
    const trailerKey = movie.trailers[0]?.key || null;

    if (trailerOnly) {
      onPlay({
        mediaType: 'movie',
        tmdbId: movie.id,
        title: movie.title,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.backdropUrl,
        trailerKey,
      });
      return;
    }

    setStartingPlayback(true);
    try {
      const [match, customMovieRes] = await Promise.all([
        movixApi.matchMegambd({
          mediaType: 'movie',
          title: movie.title,
          originalTitle: movie.originalTitle,
          tmdbId: movie.id,
        }),
        admApi.getCustomMovie(movie.id).catch(() => null),
      ]);

      const customServers = (customMovieRes?.movie?.servers || []).filter((s) => s.active && s.url);
      const customStream = customServers.find((s) => s.type === 'stream')?.url || null;
      const customEmbedMirrors = customServers
        .filter((s) => s.type === 'embed')
        .map((s) => ({ label: s.name, url: s.url }));
      const mergedMirrors = [
        ...customEmbedMirrors,
        ...(match.matched && match.embedMirrors ? match.embedMirrors : []),
      ];
      const finalStream = customStream || (match.matched ? match.streamUrl || null : null);
      const finalEmbed = customEmbedMirrors[0]?.url || (match.matched ? match.embedUrl || null : null);

      const hasSource = Boolean(finalStream || finalEmbed);
      onPlay({
        mediaType: 'movie',
        tmdbId: movie.id,
        title: movie.title,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.backdropUrl,
        megambdStreamUrl: finalStream,
        embedUrl: finalEmbed,
        embedMirrors: mergedMirrors.length > 0 ? mergedMirrors : undefined,
        megambdError: hasSource ? null : match.message || null,
        trailerKey,
      });
    } catch (err) {
      onPlay({
        mediaType: 'movie',
        tmdbId: movie.id,
        title: movie.title,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.backdropUrl,
        megambdStreamUrl: null,
        megambdError: err instanceof Error ? err.message : 'Erro ao consultar MegamBD.',
        trailerKey,
      });
    } finally {
      setStartingPlayback(false);
    }
  };

  const handlePlayEpisode = async (ep: EpisodeItem, trailerOnly = false) => {
    if (!series) return;
    const trailerKey = series.trailers[0]?.key || null;

    if (trailerOnly) {
      onPlay({
        mediaType: 'tv',
        tmdbId: series.id,
        title: series.title,
        posterUrl: series.posterUrl,
        backdropUrl: series.backdropUrl,
        trailerKey,
      });
      return;
    }

    const episodesList = seasonData?.episodes || [];
    const currentIdx = episodesList.findIndex((e) => e.episodeNumber === ep.episodeNumber);
    const nextEp = currentIdx >= 0 && currentIdx + 1 < episodesList.length ? episodesList[currentIdx + 1] : null;

    setStartingPlayback(true);
    try {
      const match = await movixApi.matchMegambd({
        mediaType: 'tv',
        title: series.title,
        originalTitle: series.originalTitle,
        tmdbId: series.id,
        season: ep.seasonNumber,
        episode: ep.episodeNumber,
      });

      let streamUrl: string | null = match.matched ? match.streamUrl || null : null;
      let nextStreamUrl: string | null = null;
      const embedUrl: string | null = match.matched ? match.embedUrl || null : null;
      const embedMirrors = match.matched ? match.embedMirrors : undefined;

      const seasonEps = match.seriesInfo?.episodes?.[String(ep.seasonNumber)] || [];
      const foundEp = seasonEps.find((x) => Number(x.episode_num) === ep.episodeNumber);
      if (foundEp) {
        const ext = (foundEp.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
        streamUrl = `/api/stream/series/${foundEp.id}?ext=${encodeURIComponent(ext)}`;
      }
      if (nextEp) {
        const foundNext = seasonEps.find((x) => Number(x.episode_num) === nextEp.episodeNumber);
        if (foundNext) {
          const ext = (foundNext.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
          nextStreamUrl = `/api/stream/series/${foundNext.id}?ext=${encodeURIComponent(ext)}`;
        }
      }

      const hasSource = Boolean(streamUrl || embedUrl);

      onPlay({
        mediaType: 'tv',
        tmdbId: series.id,
        title: series.title,
        posterUrl: series.posterUrl,
        backdropUrl: series.backdropUrl,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        episodeTitle: ep.name,
        megambdStreamUrl: streamUrl,
        embedUrl,
        embedMirrors,
        megambdError: hasSource ? null : match.message || 'Episódio ainda não associado no catálogo MegamBD.',
        trailerKey,
        nextEpisode: nextEp
          ? {
              seasonNumber: nextEp.seasonNumber,
              episodeNumber: nextEp.episodeNumber,
              episodeTitle: nextEp.name,
              megambdStreamUrl: nextStreamUrl,
            }
          : null,
      });
    } catch (err) {
      onPlay({
        mediaType: 'tv',
        tmdbId: series.id,
        title: series.title,
        posterUrl: series.posterUrl,
        backdropUrl: series.backdropUrl,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
        episodeTitle: ep.name,
        megambdStreamUrl: null,
        megambdError: err instanceof Error ? err.message : 'Erro ao consultar MegamBD.',
        trailerKey,
      });
    } finally {
      setStartingPlayback(false);
    }
  };

  // Trigger instant playback when arriving via a shared direct play link (?play=1)
  useEffect(() => {
    if (!autoPlay || loading) return;
    const key = `${mediaType}:${id}:${autoPlay.season || 0}:${autoPlay.episode || 0}`;
    if (autoPlayedRef.current === key) return;

    if (mediaType === 'movie' && movie) {
      autoPlayedRef.current = key;
      onAutoPlayConsumed?.();
      void handlePlayMovie(false);
    } else if (mediaType === 'tv' && series && seasonData) {
      autoPlayedRef.current = key;
      onAutoPlayConsumed?.();
      const targetEp =
        seasonData.episodes.find((ep) => ep.episodeNumber === (autoPlay.episode || 1)) ||
        seasonData.episodes[0] || {
          id: 0,
          episodeNumber: autoPlay.episode || 1,
          seasonNumber: autoPlay.season || selectedSeason || 1,
          name: `Episódio ${autoPlay.episode || 1}`,
          overview: '',
          stillUrl: null,
          runtime: 0,
          airDate: '',
          rating: 0,
        };
      void handlePlayEpisode(targetEp, false);
    }
  }, [autoPlay, loading, mediaType, id, movie, series, seasonData, selectedSeason, onAutoPlayConsumed]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-3 text-sm text-[#B8C0D4]">
        <Loader2 className="h-5 w-5 animate-spin text-[#F3C669]" />
        <span>A carregar informações...</span>
      </div>
    );
  }

  if (error || !current) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <p className="text-base text-rose-400">{error || 'Conteúdo não encontrado.'}</p>
        <button
          type="button"
          onClick={onGoBack}
          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-sm font-semibold cursor-pointer"
        >
          Voltar
        </button>
      </div>
    );
  }

  const isFav = favoriteKeys.has(`${current.mediaType}:${current.id}`);
  const summaryForFav: MediaSummary = {
    id: current.id,
    mediaType: current.mediaType,
    title: current.title,
    originalTitle: current.originalTitle,
    overview: current.overview,
    posterUrl: current.posterUrl,
    backdropUrl: current.backdropUrl,
    year: current.year,
    releaseDate: current.releaseDate,
    rating: current.rating,
    voteCount: current.voteCount,
    genreIds: current.genres.map((g) => g.id),
    popularity: 0,
  };

  const handleToggleOffline = async () => {
    const key = `${current.mediaType}:${current.id}`;
    setSavingOffline(true);
    setOfflineNotice(null);
    try {
      if (savedOffline) {
        await removeOfflineItem(key);
        setSavedOffline(false);
        setOfflineNotice('Removido do armazenamento offline.');
      } else {
        if (!isFav) {
          onToggleFavorite(summaryForFav);
        }
        await saveItemForOffline({
          mediaType: current.mediaType,
          tmdbId: current.id,
          title: current.title,
          posterUrl: current.posterUrl,
          backdropUrl: current.backdropUrl,
          year: current.year,
          rating: current.rating,
          details: current,
        });
        setSavedOffline(true);
        setOfflineNotice('Metadados e capas salvos no cache offline por 7 dias.');
      }
    } catch {
      setOfflineNotice('Não foi possível atualizar o cache offline neste dispositivo.');
    } finally {
      setSavingOffline(false);
    }
  };

  const handleShareDirectLink = async () => {
    const shareUrl = `${window.location.origin}/${current.mediaType === 'tv' ? 'serie' : 'filme'}/${current.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${current.title} · MOVIX`,
          text: `Assistir ${current.title} no MOVIX`,
          url: shareUrl,
        });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareCopied(true);
        setOfflineNotice(t.directLinkCopied);
        setTimeout(() => setShareCopied(false), 2600);
      }
    } catch {
      // User cancelled share
    }
  };

  return (
    <div className="pb-16">
      {/* Panoramic Backdrop Banner */}
      <section className="relative w-full overflow-hidden border-b border-white/[0.08]">
        {current.backdropUrl && (
          <img
            src={current.backdropUrl}
            alt={current.title}
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover object-center opacity-45"
          />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/85 to-[#06070B]/48"
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <button
            type="button"
            onClick={onGoBack}
            className="inline-flex items-center gap-2 text-xs sm:text-sm text-[#B8C0D4] hover:text-[#F3C669] mb-6 cursor-pointer transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Voltar</span>
          </button>

          <div className="flex flex-col md:flex-row gap-8 items-start">
            {/* Poster */}
            <div className="w-44 sm:w-56 lg:w-64 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden bg-[#0F131E] border border-white/15 shadow-2xl">
              {current.posterUrl ? (
                <img
                  src={current.posterUrl}
                  alt={`Poster de ${current.title}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {mediaType === 'tv' ? (
                    <Tv className="h-10 w-10 text-[#F3C669]/65" />
                  ) : (
                    <Film className="h-10 w-10 text-[#F3C669]/65" />
                  )}
                </div>
              )}
            </div>

            {/* Metadata & Actions */}
            <div className="flex-1 min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#C8D0E2] tabular-nums">
                <span>{mediaType === 'tv' ? 'Série' : 'Filme'}</span>
                {current.year && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{current.year}</span>
                  </>
                )}
                {mediaType === 'movie' && movie && movie.runtime > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatRuntime(movie.runtime)}</span>
                  </>
                )}
                {mediaType === 'tv' && series && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {series.numberOfSeasons}{' '}
                      {series.numberOfSeasons === 1 ? 'Temporada' : 'Temporadas'}
                    </span>
                  </>
                )}
                {current.certification && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{current.certification}</span>
                  </>
                )}
                {current.rating > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#F3C669] font-semibold">★ {current.rating.toFixed(1)}</span>
                  </>
                )}
              </div>

              <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-[#F6F7FB] text-balance">
                {current.title}
              </h1>

              {current.genres.length > 0 && (
                <p className="text-sm text-[#95A0B8]">
                  {current.genres.map((g) => g.name).join(' · ')}
                </p>
              )}

              {current.overview && (
                <p className="text-sm sm:text-base text-[#D1D7E6] leading-relaxed max-w-3xl">
                  {current.overview}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-3">
                <button
                  type="button"
                  disabled={startingPlayback}
                  onClick={() => {
                    if (mediaType === 'movie') {
                      void handlePlayMovie(false);
                    } else if (seasonData?.episodes[0]) {
                      void handlePlayEpisode(seasonData.episodes[0], false);
                    } else {
                      void handlePlayEpisode(
                        {
                          id: 0,
                          episodeNumber: 1,
                          seasonNumber: selectedSeason || 1,
                          name: 'Episódio 1',
                          overview: '',
                          stillUrl: null,
                          runtime: 0,
                          airDate: '',
                          rating: 0,
                        },
                        false
                      );
                    }
                  }}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] hover:brightness-105 text-[#07080C] text-sm font-semibold shadow-[0_6px_22px_rgba(229,184,90,0.3)] transition-all cursor-pointer disabled:opacity-60"
                >
                  {startingPlayback ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  <span>{t.watchNow}</span>
                </button>

                {current.trailers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (mediaType === 'movie') void handlePlayMovie(true);
                      else if (seasonData?.episodes[0]) void handlePlayEpisode(seasonData.episodes[0], true);
                    }}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#0F131E]/85 hover:bg-[#151A28] border border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB] text-sm font-medium transition-colors cursor-pointer"
                  >
                    <Film className="h-4 w-4 text-[#F3C669]" />
                    <span>{t.watchTrailer}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onToggleFavorite(summaryForFav)}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-[#07090F]/80 hover:bg-[#151A28] border border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB] text-sm font-medium transition-colors cursor-pointer"
                >
                  <Heart className={`h-4 w-4 ${isFav ? 'fill-[#F3C669] text-[#F3C669]' : ''}`} />
                  <span>{isFav ? t.inMyList : t.addToList}</span>
                </button>

                <button
                  type="button"
                  disabled={savingOffline}
                  onClick={() => void handleToggleOffline()}
                  className={`inline-flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 ${
                    savedOffline
                      ? 'bg-[#E5B85A]/15 border-[#E5B85A]/45 text-[#F3C669] hover:bg-[#E5B85A]/20'
                      : 'bg-[#07090F]/80 hover:bg-[#151A28] border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB]'
                  }`}
                >
                  {savingOffline ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#F3C669]" />
                  ) : savedOffline ? (
                    <Check className="h-4 w-4 text-[#F3C669]" />
                  ) : (
                    <CloudDownload className="h-4 w-4 text-[#F3C669]" />
                  )}
                  <span>{savedOffline ? t.savedOffline : t.watchOffline}</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleShareDirectLink()}
                  className={`inline-flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                    shareCopied
                      ? 'bg-[#E5B85A]/15 border-[#E5B85A]/45 text-[#F3C669]'
                      : 'bg-[#07090F]/80 hover:bg-[#151A28] border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB]'
                  }`}
                >
                  {shareCopied ? (
                    <Check className="h-4 w-4 text-[#F3C669]" />
                  ) : (
                    <Share2 className="h-4 w-4 text-[#F3C669]" />
                  )}
                  <span>{shareCopied ? t.copied : t.share}</span>
                </button>
              </div>

              {(!isOnline || offlineNotice) && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  {!isOnline && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F131E] border border-[#E5B85A]/35 text-[#F3C669]">
                      <WifiOff className="h-3.5 w-3.5" />
                      <span>Modo Offline: exibindo metadados e capas salvos em cache.</span>
                    </span>
                  )}
                  {offlineNotice && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F131E] border border-white/10 text-[#C8D0E2]">
                      {offlineNotice}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 mt-10 space-y-12">
        {/* MOVIX ADS — Movie or Series detail placement */}
        <MovixAdSlot placement={mediaType === 'movie' ? 'movie_detail' : 'series_detail'} />

        {/* Seasons & Episodes for Series */}
        {mediaType === 'tv' && series && (
          <section className="space-y-6">
            <MovixAdSlot placement="seasons_page" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="font-display text-2xl font-semibold text-[#F6F7FB]">
                Temporadas e Episódios
              </h2>

              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none p-1 rounded-lg bg-[#0F131E] border border-white/[0.08]">
                {series.seasons.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSeason(s.seasonNumber)}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                      selectedSeason === s.seasonNumber
                        ? 'bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] shadow-sm'
                        : 'text-[#95A0B8] hover:text-[#F6F7FB]'
                    }`}
                  >
                    Temporada {s.seasonNumber}
                  </button>
                ))}
              </div>
            </div>

            {loadingSeason ? (
              <div className="py-10 flex items-center gap-3 text-sm text-[#B8C0D4]">
                <Loader2 className="h-4 w-4 animate-spin text-[#F3C669]" />
                <span>A carregar episódios...</span>
              </div>
            ) : seasonData && seasonData.episodes.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seasonData.episodes.map((ep) => {
                  const prog = getWatchProgress('tv', series.id, ep.seasonNumber, ep.episodeNumber);
                  const pct =
                    prog && prog.duration > 0 ? Math.round((prog.currentTime / prog.duration) * 100) : 0;

                  return (
                    <article
                      key={ep.id}
                      className="flex flex-col sm:flex-row gap-4 p-4 rounded-xl bg-[#0F131E] border border-white/[0.08] hover:border-[#E5B85A]/35 transition-colors"
                    >
                      <div className="relative w-full sm:w-44 aspect-video shrink-0 rounded-lg overflow-hidden bg-[#06070B] flex items-center justify-center">
                        {ep.stillUrl ? (
                          <img
                            src={ep.stillUrl}
                            alt={ep.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Tv className="h-6 w-6 text-[#F3C669]/55" />
                        )}
                        {pct > 0 && (
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                            <div className="h-full bg-gradient-to-r from-[#C89333] to-[#F4CB73]" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-[#F6F7FB] truncate">
                              E{String(ep.episodeNumber).padStart(2, '0')} · {ep.name}
                            </h3>
                            {ep.runtime > 0 && (
                              <span className="text-xs font-mono tabular-nums text-[#95A0B8] shrink-0">
                                {ep.runtime}m
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#95A0B8] line-clamp-2 mt-1.5 leading-relaxed">
                            {ep.overview}
                          </p>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#8E99B2] tabular-nums">
                            {ep.airDate || `Temporada ${ep.seasonNumber}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handlePlayEpisode(ep, false)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-xs font-semibold cursor-pointer"
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                            <span>Assistir</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[#8E99B2]">Nenhum episódio encontrado para esta temporada.</p>
            )}
            <MovixAdSlot placement="episodes_page" />
          </section>
        )}

        {/* Elenco Principal */}
        {current.cast.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#F6F7FB]">Elenco Principal</h2>
            <div className="flex gap-4 overflow-x-auto scrollbar-none pb-2">
              {current.cast.map((actor) => (
                <div key={actor.id} className="w-32 shrink-0 space-y-2">
                  <div className="aspect-square rounded-xl overflow-hidden bg-[#0F131E] border border-white/[0.08] flex items-center justify-center">
                    {actor.profileUrl ? (
                      <img
                        src={actor.profileUrl}
                        alt={actor.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-8 w-8 text-[#7C869E]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#F6F7FB] truncate">{actor.name}</p>
                    <p className="text-xs text-[#8E99B2] truncate">{actor.character}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Relacionados */}
        {current.related.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-[#F6F7FB]">
              {mediaType === 'movie' ? 'Filmes Relacionados' : 'Séries Recomendadas'}
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
              {current.related.map((item) => (
                <MediaPosterCard
                  key={item.id}
                  item={item}
                  onSelect={(selected) =>
                    onNavigate({ page: selected.mediaType === 'tv' ? 'tv' : 'movie', id: selected.id })
                  }
                  onPlay={onQuickPlay}
                  isFavorite={favoriteKeys.has(`${item.mediaType}:${item.id}`)}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
