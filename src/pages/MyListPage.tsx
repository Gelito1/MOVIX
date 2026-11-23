import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
  CloudDownload,
  CloudOff,
  Film,
  HardDrive,
  Heart,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  Tv,
  WifiOff,
} from 'lucide-react';
import { MediaPosterCard } from '../components/MediaPosterCard';
import { MovixAdSlot } from '../components/MovixAdSlot';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import {
  clearAllOfflineItems,
  formatBytes,
  getDaysRemaining,
  getOfflineCacheStats,
  getOfflineItems,
  pruneExpiredOfflineItems,
  removeOfflineItem,
  saveAllFavoritesOffline,
  saveItemForOffline,
} from '../lib/offlineCache';
import {
  clearWatchHistory,
  getFavorites,
  getWatchHistory,
  getWatchProgressList,
  removeWatchProgress,
} from '../lib/storage';
import type {
  AppRoute,
  FavoriteItem,
  MediaSummary,
  OfflineSavedItem,
  WatchProgressItem,
} from '../types/movix';

interface MyListPageProps {
  initialTab?: 'favorites' | 'offline' | 'continue' | 'history';
  onNavigate: (route: AppRoute) => void;
  onGoBack?: () => void;
  onPlay?: (item: MediaSummary) => void;
  onToggleFavorite: (item: MediaSummary) => void;
}

export function MyListPage({
  initialTab,
  onNavigate,
  onGoBack,
  onPlay,
  onToggleFavorite,
}: MyListPageProps) {
  const isOnline = useOnlineStatus();
  const [tab, setTab] = useState<'favorites' | 'offline' | 'continue' | 'history'>(
    initialTab || (typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'favorites')
  );
  const [favorites, setFavorites] = useState<FavoriteItem[]>(() => getFavorites());
  const [offlineItems, setOfflineItems] = useState<OfflineSavedItem[]>(() => getOfflineItems());
  const [progressList, setProgressList] = useState<WatchProgressItem[]>(() => getWatchProgressList());
  const [historyList, setHistoryList] = useState<WatchProgressItem[]>(() => getWatchHistory());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cacheStats, setCacheStats] = useState<{
    itemCount: number;
    metadataEntries: number;
    imageEntries: number;
    totalEstimatedBytes: number;
    ttlDays: number;
    cacheSupported: boolean;
  } | null>(null);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  const refreshOfflineState = useCallback(async () => {
    await pruneExpiredOfflineItems();
    setOfflineItems(getOfflineItems());
    const stats = await getOfflineCacheStats();
    setCacheStats(stats);
  }, []);

  useEffect(() => {
    void refreshOfflineState();
    const onOfflineChange = () => {
      void refreshOfflineState();
    };
    window.addEventListener('movix:offline-updated', onOfflineChange);
    return () => window.removeEventListener('movix:offline-updated', onOfflineChange);
  }, [refreshOfflineState]);

  const offlineKeySet = new Set(offlineItems.map((item) => item.key));

  const handleToggleFav = (item: MediaSummary) => {
    onToggleFavorite(item);
    setFavorites(getFavorites());
  };

  const handleToggleOfflineForFavorite = async (fav: FavoriteItem) => {
    setSavingKey(fav.key);
    setFeedback(null);
    try {
      if (offlineKeySet.has(fav.key)) {
        await removeOfflineItem(fav.key);
        setFeedback(`"${fav.title}" removido do cache offline.`);
      } else {
        await saveItemForOffline({
          mediaType: fav.mediaType,
          tmdbId: fav.tmdbId,
          title: fav.title,
          posterUrl: fav.posterUrl,
          year: fav.year,
          rating: fav.rating,
        });
        setFeedback(`"${fav.title}" salvo para acesso sem conexão (7 dias).`);
      }
      await refreshOfflineState();
    } catch {
      setFeedback('Não foi possível atualizar o armazenamento offline.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveAllFavorites = async () => {
    if (favorites.length === 0) return;
    setSyncingAll(true);
    setFeedback(null);
    const unsavedCount = favorites.filter((f) => !offlineKeySet.has(f.key)).length;
    if (unsavedCount === 0) {
      setFeedback('Todos os seus favoritos já estão salvos para acesso offline.');
      setSyncingAll(false);
      return;
    }
    setSyncProgress({ done: 0, total: unsavedCount });
    try {
      await saveAllFavoritesOffline(favorites, (done, total) => {
        setSyncProgress({ done, total });
      });
      await refreshOfflineState();
      setFeedback(`${unsavedCount} ${unsavedCount === 1 ? 'título salvo' : 'títulos salvos'} no cache offline com metadados e capas.`);
    } catch {
      setFeedback('Ocorreu um erro ao salvar alguns favoritos no cache offline.');
    } finally {
      setSyncingAll(false);
      setSyncProgress(null);
    }
  };

  const handleClearOffline = async () => {
    await clearAllOfflineItems();
    await refreshOfflineState();
    setFeedback('Cache temporário de Assistir Offline limpo com sucesso.');
  };

  const unsavedFavoritesCount = favorites.filter((f) => !offlineKeySet.has(f.key)).length;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          {onGoBack && (
            <button
              type="button"
              onClick={onGoBack}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-[#95A0B8] hover:text-[#F3C669] mb-2.5 cursor-pointer transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Voltar</span>
            </button>
          )}
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#F6F7FB]">
            Minha Lista
          </h1>
          <p className="text-sm text-[#95A0B8] mt-1.5">
            Os seus favoritos, biblioteca offline temporária, conteúdos em curso e histórico.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0F131E] border border-white/[0.08] self-start overflow-x-auto max-w-full scrollbar-none">
          {(
            [
              { id: 'favorites', label: `Favoritos (${favorites.length})` },
              { id: 'offline', label: `Assistir Offline (${offlineItems.length})` },
              { id: 'continue', label: `Continuar (${progressList.length})` },
              { id: 'history', label: `Histórico (${historyList.length})` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                tab === t.id
                  ? 'bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] shadow-sm'
                  : 'text-[#95A0B8] hover:text-[#F6F7FB]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl bg-[#0F131E] border border-[#E5B85A]/35 px-4 py-3 text-xs sm:text-sm text-[#F3C669] flex items-center justify-between gap-3">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs text-[#95A0B8] hover:text-[#F6F7FB] cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

      {/* TAB 1: FAVORITOS */}
      {tab === 'favorites' && (
        <>
          {favorites.length === 0 ? (
            <div className="rounded-2xl bg-[#0F131E] border border-white/[0.08] p-12 text-center space-y-3">
              <Heart className="h-8 w-8 text-[#F3C669]/75 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-[#F6F7FB]">
                Ainda não tem favoritos guardados
              </h2>
              <p className="text-sm text-[#95A0B8]">
                Adicione filmes e séries aos favoritos para os encontrar aqui e salvar metadados e capas para acesso offline.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-[#0F131E] border border-white/[0.08] p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-[#E5B85A]/12 border border-[#E5B85A]/30 flex items-center justify-center text-[#F3C669] shrink-0">
                    <CloudDownload className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#F6F7FB]">
                      Acesso Offline para Favoritos
                    </p>
                    <p className="text-xs text-[#95A0B8]">
                      Guarde capas e metadados no Cache do Service Worker para consultar sem internet por 7 dias.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={syncingAll || !isOnline || unsavedFavoritesCount === 0}
                  onClick={() => void handleSaveAllFavorites()}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-xs font-semibold cursor-pointer disabled:opacity-55 shrink-0 transition-all"
                >
                  {syncingAll ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        Salvando {syncProgress ? `${syncProgress.done}/${syncProgress.total}` : '...'}
                      </span>
                    </>
                  ) : unsavedFavoritesCount === 0 ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Todos Salvos Offline</span>
                    </>
                  ) : (
                    <>
                      <CloudDownload className="h-4 w-4" />
                      <span>Salvar Favoritos Offline ({unsavedFavoritesCount})</span>
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
                {favorites.map((fav) => {
                  const isCached = offlineKeySet.has(fav.key);
                  const isBusy = savingKey === fav.key;
                  const summary: MediaSummary = {
                    id: fav.tmdbId,
                    mediaType: fav.mediaType,
                    title: fav.title,
                    originalTitle: fav.title,
                    overview: '',
                    posterUrl: fav.posterUrl,
                    backdropUrl: null,
                    year: fav.year,
                    releaseDate: '',
                    rating: fav.rating,
                    voteCount: 0,
                    genreIds: [],
                    popularity: 0,
                  };
                  return (
                    <div key={fav.key} className="flex flex-col gap-2">
                      <MediaPosterCard
                        item={summary}
                        onSelect={(s) => onNavigate({ page: s.mediaType === 'tv' ? 'tv' : 'movie', id: s.id })}
                        onPlay={onPlay}
                        isFavorite
                        onToggleFavorite={handleToggleFav}
                      />
                      <button
                        type="button"
                        disabled={isBusy || (!isOnline && !isCached)}
                        onClick={() => void handleToggleOfflineForFavorite(fav)}
                        className={`w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                          isCached
                            ? 'bg-[#E5B85A]/12 border-[#E5B85A]/35 text-[#F3C669] hover:bg-[#E5B85A]/20'
                            : 'bg-[#0F131E] border-white/[0.09] text-[#B8C0D4] hover:text-[#F6F7FB] hover:border-[#E5B85A]/35'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : isCached ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <CloudDownload className="h-3 w-3" />
                        )}
                        <span>{isCached ? 'Salvo Offline' : 'Salvar Offline'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: ASSISTIR OFFLINE */}
      {tab === 'offline' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-[#0F131E] border border-white/[0.08] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <HardDrive className="h-4 w-4 text-[#F3C669]" />
                <h2 className="font-display text-base sm:text-lg font-semibold text-[#F6F7FB]">
                  Cache Offline do Service Worker
                </h2>
                {!isOnline && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#E5B85A]/15 border border-[#E5B85A]/35 text-[11px] font-semibold text-[#F3C669]">
                    <WifiOff className="h-3 w-3" />
                    Sem Conexão
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-[#95A0B8]">
                Metadados completos, sinopses, episódios e capas dos seus favoritos armazenados temporariamente por{' '}
                <span className="text-[#D1D7E6] font-medium">{cacheStats?.ttlDays ?? 7} dias</span> na API de Cache.
              </p>
              {cacheStats && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-[#8E99B2] font-mono tabular-nums">
                  <span>{cacheStats.itemCount} {cacheStats.itemCount === 1 ? 'título' : 'títulos'}</span>
                  <span>·</span>
                  <span>{cacheStats.imageEntries} capas em cache</span>
                  <span>·</span>
                  <span>{formatBytes(cacheStats.totalEstimatedBytes)} estimados</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {favorites.length > 0 && isOnline && (
                <button
                  type="button"
                  disabled={syncingAll}
                  onClick={() => void handleSaveAllFavorites()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {syncingAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {syncingAll && syncProgress
                      ? `Sincronizando ${syncProgress.done}/${syncProgress.total}`
                      : 'Sincronizar Favoritos'}
                  </span>
                </button>
              )}

              {offlineItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleClearOffline()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/10 hover:border-rose-400/40 text-xs text-[#B8C0D4] hover:text-rose-400 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Limpar Cache</span>
                </button>
              )}
            </div>
          </div>

          {offlineItems.length === 0 ? (
            <div className="rounded-2xl bg-[#0F131E] border border-white/[0.08] p-12 text-center space-y-3">
              <CloudOff className="h-8 w-8 text-[#F3C669]/75 mx-auto" />
              <h3 className="font-display text-lg font-semibold text-[#F6F7FB]">
                Nenhum item salvo para acesso offline
              </h3>
              <p className="text-sm text-[#95A0B8] max-w-md mx-auto">
                Abra qualquer filme ou série e clique em <strong className="text-[#F6F7FB]">Assistir Offline</strong>, ou salve os seus favoritos diretamente na aba Favoritos.
              </p>
              {favorites.length > 0 && isOnline && (
                <button
                  type="button"
                  onClick={() => void handleSaveAllFavorites()}
                  className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] text-xs font-semibold cursor-pointer"
                >
                  <CloudDownload className="h-4 w-4" />
                  <span>Salvar meus {favorites.length} favoritos agora</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {offlineItems.map((item) => {
                const daysLeft = getDaysRemaining(item.expiresAt);
                return (
                  <article
                    key={item.key}
                    className="flex gap-4 p-4 rounded-xl bg-[#0F131E] border border-white/[0.08] hover:border-[#E5B85A]/35 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: item.mediaType === 'tv' ? 'tv' : 'movie', id: item.tmdbId })
                      }
                      className="w-24 sm:w-28 aspect-[2/3] shrink-0 rounded-lg overflow-hidden bg-[#06070B] border border-white/10 cursor-pointer flex items-center justify-center"
                    >
                      {item.posterUrl ? (
                        <img
                          src={item.posterUrl}
                          alt={`Capa de ${item.title}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : item.mediaType === 'tv' ? (
                        <Tv className="h-7 w-7 text-[#F3C669]/60" />
                      ) : (
                        <Film className="h-7 w-7 text-[#F3C669]/60" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-2.5">
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate({ page: item.mediaType === 'tv' ? 'tv' : 'movie', id: item.tmdbId })
                            }
                            className="text-left text-sm sm:text-base font-display font-semibold text-[#F6F7FB] hover:text-[#F3C669] truncate cursor-pointer transition-colors"
                          >
                            {item.title}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await removeOfflineItem(item.key);
                              await refreshOfflineState();
                            }}
                            aria-label={`Remover ${item.title} do cache offline`}
                            className="h-8 w-8 rounded-lg border border-white/10 text-[#95A0B8] hover:text-rose-400 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#95A0B8] tabular-nums">
                          <span>{item.mediaType === 'tv' ? 'Série' : 'Filme'}</span>
                          {item.year && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.year}</span>
                            </>
                          )}
                          {item.rating > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#F3C669] font-semibold">★ {item.rating.toFixed(1)}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="text-[#8E99B2]">
                            Expira em {daysLeft} {daysLeft === 1 ? 'dia' : 'dias'}
                          </span>
                        </div>

                        {item.genres.length > 0 && (
                          <p className="text-[11px] text-[#8E99B2] truncate">
                            {item.genres.slice(0, 3).join(' · ')}
                          </p>
                        )}

                        {item.overview && (
                          <p className="text-xs text-[#B8C0D4] line-clamp-2 leading-relaxed">
                            {item.overview}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate({ page: item.mediaType === 'tv' ? 'tv' : 'movie', id: item.tmdbId })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161B29] hover:bg-[#1E2538] border border-white/10 text-xs font-medium text-[#F6F7FB] cursor-pointer transition-colors"
                        >
                          <span>Abrir Ficha Offline</span>
                        </button>

                        {isOnline && onPlay && (
                          <button
                            type="button"
                            onClick={() =>
                              onPlay({
                                id: item.tmdbId,
                                mediaType: item.mediaType,
                                title: item.title,
                                originalTitle: item.originalTitle || item.title,
                                overview: item.overview,
                                posterUrl: item.posterUrl,
                                backdropUrl: item.backdropUrl,
                                year: item.year,
                                releaseDate: '',
                                rating: item.rating,
                                voteCount: 0,
                                genreIds: [],
                                popularity: 0,
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-xs font-semibold cursor-pointer"
                          >
                            <Play className="h-3 w-3 fill-current" />
                            <span>Assistir</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CONTINUAR */}
      {tab === 'continue' && (
        <>
          {progressList.length === 0 ? (
            <div className="rounded-2xl bg-[#0F131E] border border-white/[0.08] p-12 text-center space-y-3">
              <Play className="h-8 w-8 text-[#F3C669]/75 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-[#F6F7FB]">
                Nenhuma reprodução em curso
              </h2>
              <p className="text-sm text-[#95A0B8]">
                Quando iniciar um filme ou episódio, o seu progresso ficará guardado automaticamente.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {progressList.map((entry) => {
                const pct =
                  entry.duration > 0 ? Math.round((entry.currentTime / entry.duration) * 100) : 0;
                return (
                  <div
                    key={entry.key}
                    className="flex items-center gap-4 p-4 rounded-xl bg-[#0F131E] border border-white/[0.08] hover:border-[#E5B85A]/30 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: entry.mediaType === 'tv' ? 'tv' : 'movie', id: entry.tmdbId })
                      }
                      className="h-20 w-14 rounded-lg overflow-hidden bg-[#06070B] shrink-0 cursor-pointer"
                    >
                      {entry.posterUrl && (
                        <img
                          src={entry.posterUrl}
                          alt={entry.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                    <div className="min-w-0 flex-1 space-y-2">
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate({ page: entry.mediaType === 'tv' ? 'tv' : 'movie', id: entry.tmdbId })
                        }
                        className="text-sm font-semibold text-[#F6F7FB] hover:text-[#F3C669] truncate block text-left w-full cursor-pointer transition-colors"
                      >
                        {entry.title}
                      </button>
                      <p className="text-xs text-[#95A0B8] truncate tabular-nums">
                        {entry.mediaType === 'tv' && entry.seasonNumber
                          ? `Temporada ${entry.seasonNumber} · Episódio ${entry.episodeNumber}`
                          : 'Filme'}{' '}
                        · {pct}% concluído
                      </p>
                      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-[#C89333] to-[#F4CB73]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProgressList(removeWatchProgress(entry.key))}
                      aria-label={`Remover ${entry.title} de continuar assistindo`}
                      className="h-9 w-9 rounded-lg border border-white/10 text-[#95A0B8] hover:text-rose-400 flex items-center justify-center cursor-pointer transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* TAB 4: HISTÓRICO */}
      {tab === 'history' && (
        <>
          {historyList.length === 0 ? (
            <div className="rounded-2xl bg-[#0F131E] border border-white/[0.08] p-12 text-center space-y-3">
              <Clock className="h-8 w-8 text-[#F3C669]/75 mx-auto" />
              <h2 className="font-display text-lg font-semibold text-[#F6F7FB]">Histórico vazio</h2>
              <p className="text-sm text-[#95A0B8]">Os títulos reproduzidos aparecerão listados aqui.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    clearWatchHistory();
                    setHistoryList([]);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/10 text-xs text-[#95A0B8] hover:text-rose-400 cursor-pointer transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Limpar histórico</span>
                </button>
              </div>
              <div className="divide-y divide-white/[0.06] rounded-xl bg-[#0F131E] border border-white/[0.08]">
                {historyList.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.03]"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({ page: entry.mediaType === 'tv' ? 'tv' : 'movie', id: entry.tmdbId })
                      }
                      className="text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <p className="text-sm font-semibold text-[#F6F7FB] hover:text-[#F3C669] truncate transition-colors">
                        {entry.title}
                      </p>
                      <p className="text-xs text-[#95A0B8] mt-0.5">
                        {entry.mediaType === 'tv' && entry.seasonNumber
                          ? `Temporada ${entry.seasonNumber} · Episódio ${entry.episodeNumber}`
                          : 'Filme'}
                      </p>
                    </button>
                    <span className="text-xs font-mono tabular-nums text-[#8E99B2] shrink-0">
                      {new Date(entry.updatedAt).toLocaleDateString('pt-PT')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {isOnline && (
        <div className="pt-2 empty:hidden">
          <MovixAdSlot placement="between_movies" />
        </div>
      )}
    </div>
  );
}
