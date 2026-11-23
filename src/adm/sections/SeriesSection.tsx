import { useCallback, useEffect, useState } from 'react';
import {
  Clapperboard,
  Download,
  Edit3,
  Layers,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import { movixApi } from '../../lib/api';
import {
  deleteCloudSeries,
  fetchCloudSeries,
  isVerifiedFirebaseAdmin,
  upsertCloudSeries,
} from '../../lib/firebase';
import type { ManagedEpisode, ManagedSeason, ManagedSeries, PlaybackServerLink } from '../../types/adm';
import type { MediaSummary } from '../../types/movix';
import { MediaUploadField } from '../components/MediaUploadField';

interface SeriesSectionProps {
  token: string;
  activeTab: 'series' | 'seasons' | 'episodes';
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPublicDataChanged: () => void;
}

export function SeriesSection({ token, activeTab, onNotify, onPublicDataChanged }: SeriesSectionProps) {
  const [seriesList, setSeriesList] = useState<ManagedSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>('');
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');

  // TMDB search/import
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbIdInput, setTmdbIdInput] = useState('');
  const [tmdbResults, setTmdbResults] = useState<MediaSummary[]>([]);
  const [searchingTmdb, setSearchingTmdb] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);

  // Modals / Forms
  const [editingSeries, setEditingSeries] = useState<Partial<ManagedSeries> | null>(null);
  const [editingSeason, setEditingSeason] = useState<Partial<ManagedSeason> | null>(null);
  const [editingEpisode, setEditingEpisode] = useState<Partial<ManagedEpisode> | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSeries = useCallback(async () => {
    setLoading(true);
    try {
      const [res, cloudSeries] = await Promise.all([
        admApi.listSeries(token),
        fetchCloudSeries(true).catch(() => []),
      ]);
      const byId = new Map<string, ManagedSeries>();
      for (const s of res.series) byId.set(s.id, s);
      for (const cs of cloudSeries) {
        const local = byId.get(cs.id);
        if (!local || (Date.parse(cs.updatedAt) || 0) >= (Date.parse(local.updatedAt) || 0)) {
          byId.set(cs.id, cs);
        }
      }
      if (cloudSeries.length === 0 && res.series.length > 0 && isVerifiedFirebaseAdmin()) {
        void Promise.all(res.series.map((s) => upsertCloudSeries(s)));
      }
      const merged = Array.from(byId.values());
      setSeriesList(merged);
      setSelectedSeriesId((prev) => {
        if (prev && merged.some((s) => s.id === prev)) return prev;
        return merged[0]?.id || '';
      });
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar séries.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, onNotify]);

  useEffect(() => {
    void loadSeries();
  }, [loadSeries]);

  const selectedSeries = seriesList.find((s) => s.id === selectedSeriesId) || null;

  useEffect(() => {
    if (!selectedSeries) {
      setSelectedSeasonId('');
      return;
    }
    setSelectedSeasonId((prev) => {
      if (prev && selectedSeries.seasons.some((sea) => sea.id === prev)) return prev;
      return selectedSeries.seasons[0]?.id || '';
    });
  }, [selectedSeries]);

  const selectedSeason = selectedSeries?.seasons.find((sea) => sea.id === selectedSeasonId) || null;

  const handleTmdbSearch = async () => {
    if (!tmdbQuery.trim()) return;
    setSearchingTmdb(true);
    try {
      const res = await movixApi.search(tmdbQuery.trim(), 'tv', 1);
      setTmdbResults(res.results.slice(0, 8));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao pesquisar no TMDB.', 'error');
    } finally {
      setSearchingTmdb(false);
    }
  };

  const handleImportSeries = async (tmdbId: number) => {
    setImportingId(tmdbId);
    try {
      const res = await admApi.importSeriesFromTmdb(token, tmdbId);
      await upsertCloudSeries(res.series);
      onNotify(
        res.alreadyExists
          ? `A série "${res.series.title}" já está registada.`
          : `Série "${res.series.title}" e temporadas importadas e guardadas na nuvem!`
      );
      await loadSeries();
      setSelectedSeriesId(res.series.id);
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Falha ao importar série do TMDB.', 'error');
    } finally {
      setImportingId(null);
    }
  };

  const handleSaveSeries = async () => {
    if (!editingSeries?.title?.trim()) {
      onNotify('O título da série é obrigatório.', 'error');
      return;
    }
    setSaving(true);
    try {
      let saved: ManagedSeries;
      if (editingSeries.id) {
        const res = await admApi.updateSeries(token, editingSeries.id, editingSeries);
        saved = res.series;
      } else {
        const res = await admApi.createSeries(token, editingSeries);
        saved = res.series;
        setSelectedSeriesId(res.series.id);
      }
      const synced = await upsertCloudSeries(saved);
      onNotify(
        synced
          ? editingSeries.id
            ? 'Série atualizada permanentemente na nuvem!'
            : 'Série criada e guardada permanentemente na nuvem!'
          : editingSeries.id
            ? 'Série atualizada localmente.'
            : 'Série criada localmente.'
      );
      setEditingSeries(null);
      await loadSeries();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar série.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSeries = async (series: ManagedSeries) => {
    if (!window.confirm(`Eliminar "${series.title}" e todas as suas temporadas e episódios?`)) return;
    try {
      await Promise.all([
        admApi.deleteSeries(token, series.id).catch(() => null),
        deleteCloudSeries(series.id),
      ]);
      onNotify('Série eliminada permanentemente.');
      await loadSeries();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao eliminar série.', 'error');
    }
  };

  const handleSaveSeason = async () => {
    if (!selectedSeries || !editingSeason) return;
    setSaving(true);
    try {
      let updatedSeries: ManagedSeries;
      if (editingSeason.id) {
        const res = await admApi.updateSeason(token, selectedSeries.id, editingSeason.id, editingSeason);
        updatedSeries = res.series;
        onNotify('Temporada atualizada e guardada na nuvem.');
      } else {
        const res = await admApi.addSeason(token, selectedSeries.id, editingSeason);
        updatedSeries = res.series;
        setSelectedSeasonId(res.season.id);
        onNotify('Temporada adicionada e guardada na nuvem.');
      }
      await upsertCloudSeries(updatedSeries);
      setEditingSeason(null);
      await loadSeries();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar temporada.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSeason = async (season: ManagedSeason) => {
    if (!selectedSeries || !window.confirm(`Eliminar "${season.title}" e os seus episódios?`)) return;
    try {
      const res = await admApi.deleteSeason(token, selectedSeries.id, season.id);
      await upsertCloudSeries(res.series);
      onNotify('Temporada eliminada.');
      await loadSeries();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao eliminar temporada.', 'error');
    }
  };

  const handleSaveEpisode = async () => {
    if (!selectedSeries || !selectedSeason || !editingEpisode) return;
    setSaving(true);
    try {
      let updatedSeries: ManagedSeries;
      if (editingEpisode.id) {
        const res = await admApi.updateEpisode(token, selectedSeries.id, selectedSeason.id, editingEpisode.id, editingEpisode);
        updatedSeries = res.series;
        onNotify('Episódio atualizado e guardado na nuvem.');
      } else {
        const res = await admApi.addEpisode(token, selectedSeries.id, selectedSeason.id, editingEpisode);
        updatedSeries = res.series;
        onNotify('Episódio adicionado e guardado na nuvem.');
      }
      await upsertCloudSeries(updatedSeries);
      setEditingEpisode(null);
      await loadSeries();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar episódio.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEpisode = async (ep: ManagedEpisode) => {
    if (!selectedSeries || !selectedSeason || !window.confirm(`Eliminar Episódio ${ep.episodeNumber}?`)) return;
    try {
      const res = await admApi.deleteEpisode(token, selectedSeries.id, selectedSeason.id, ep.id);
      await upsertCloudSeries(res.series);
      onNotify('Episódio eliminado.');
      await loadSeries();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao eliminar episódio.', 'error');
    }
  };

  const addEpisodeServer = () => {
    if (!editingEpisode) return;
    const next: PlaybackServerLink = {
      id: `ep_srv_${Date.now().toString(36)}`,
      name: `Servidor ${(editingEpisode.servers?.length || 0) + 1}`,
      url: '',
      language: 'dublado',
      quality: 'HD 1080p',
      type: 'embed',
      active: true,
      order: (editingEpisode.servers?.length || 0) + 1,
    };
    setEditingEpisode({ ...editingEpisode, servers: [...(editingEpisode.servers || []), next] });
  };

  const sectionTitle =
    activeTab === 'seasons'
      ? 'Gestão de Temporadas'
      : activeTab === 'episodes'
        ? 'Gestão de Episódios'
        : 'Gestão de Séries';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{sectionTitle}</h1>
          <p className="text-xs sm:text-sm text-[#8D97AF]">
            Estrutura completa Série → Temporadas → Episódios com importação automática do TMDB.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setEditingSeries({
                title: '',
                originalTitle: '',
                overview: '',
                posterUrl: '',
                backdropUrl: '',
                trailerUrl: '',
                year: String(new Date().getFullYear()),
                language: 'pt-BR',
                certification: '14',
                rating: 8,
                categories: ['Séries'],
                genres: [],
                featured: false,
                recommended: false,
                published: true,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nova Série
          </button>
        </div>
      </div>

      {/* TMDB Series Importer */}
      {activeTab === 'series' && (
        <div className="rounded-xl border border-[#E5B85A]/20 bg-[#0B0E17] p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#F4CB73]">
            <Sparkles className="w-4 h-4" />
            <span>Importar Série e Temporadas via API TMDB</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
            <div className="md:col-span-7 flex gap-2">
              <input
                type="text"
                value={tmdbQuery}
                onChange={(e) => setTmdbQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleTmdbSearch()}
                placeholder="Pesquisar série no TMDB pelo nome..."
                className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                disabled={searchingTmdb}
                onClick={() => void handleTmdbSearch()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/15 cursor-pointer"
              >
                {searchingTmdb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Pesquisar
              </button>
            </div>
            <div className="md:col-span-5 flex gap-2">
              <input
                type="number"
                value={tmdbIdInput}
                onChange={(e) => setTmdbIdInput(e.target.value)}
                placeholder="ID TMDB da série (ex: 1399)"
                className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                disabled={!tmdbIdInput || importingId !== null}
                onClick={() => void handleImportSeries(Number(tmdbIdInput))}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] disabled:opacity-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Importar ID
              </button>
            </div>
          </div>

          {tmdbResults.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2">
              {tmdbResults.map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-[#07090F] border border-white/[0.08]">
                  {item.posterUrl ? (
                    <img src={item.posterUrl} alt={item.title} className="w-10 h-14 rounded object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-14 rounded bg-white/5 flex items-center justify-center shrink-0">
                      <Tv className="w-4 h-4 text-[#6E778E]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-[#8D97AF]">{item.year} · ★ {item.rating.toFixed(1)}</p>
                    <button
                      type="button"
                      disabled={importingId === item.id}
                      onClick={() => void handleImportSeries(item.id)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#E5B85A] hover:underline cursor-pointer"
                    >
                      {importingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      Importar Série
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Series selector bar when in seasons/episodes */}
      {(activeTab === 'seasons' || activeTab === 'episodes') && seriesList.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3.5 rounded-xl border border-white/[0.08] bg-[#0B0E17]">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[11px] text-[#8D97AF] mb-1">Selecionar Série</label>
            <select
              value={selectedSeriesId}
              onChange={(e) => setSelectedSeriesId(e.target.value)}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            >
              {seriesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.seasons.length} temporadas)
                </option>
              ))}
            </select>
          </div>
          {activeTab === 'episodes' && selectedSeries && (
            <div className="flex-1 min-w-[220px]">
              <label className="block text-[11px] text-[#8D97AF] mb-1">Selecionar Temporada</label>
              <select
                value={selectedSeasonId}
                onChange={(e) => setSelectedSeasonId(e.target.value)}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              >
                {selectedSeries.seasons.map((sea) => (
                  <option key={sea.id} value={sea.id}>
                    T{sea.seasonNumber} · {sea.title} ({sea.episodes.length} episódios)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs text-[#8D97AF]">
          <Loader2 className="w-4 h-4 animate-spin text-[#E5B85A]" /> A carregar séries...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Series list */}
          {activeTab === 'series' && (
            <div className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8D97AF]">
                Séries ({seriesList.length})
              </h2>
              {seriesList.length === 0 ? (
                <p className="text-xs text-[#6E778E] py-8 text-center">Nenhuma série adicionada ainda.</p>
              ) : (
                <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
                  {seriesList.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setSelectedSeriesId(s.id)}
                      className={`p-2.5 rounded-xl border transition-colors cursor-pointer flex items-center gap-3 ${
                        selectedSeriesId === s.id
                          ? 'bg-[#E5B85A]/10 border-[#E5B85A]/40'
                          : 'bg-[#07090F] border-white/[0.06] hover:border-white/15'
                      }`}
                    >
                      {s.posterUrl ? (
                        <img src={s.posterUrl} alt={s.title} className="w-10 h-14 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-14 rounded bg-white/5 flex items-center justify-center shrink-0">
                          <Tv className="w-4 h-4 text-[#6E778E]" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white truncate">{s.title}</p>
                        <p className="text-[11px] text-[#8D97AF]">
                          {s.seasons.length} temp. · {s.seasons.reduce((a, b) => a + b.episodes.length, 0)} ep.
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSeries(s);
                          }}
                          className="p-1.5 rounded bg-white/5 text-[#D4D9E6] hover:text-[#E5B85A] cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteSeries(s);
                          }}
                          className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right / Main: Seasons & Episodes */}
          <div className={`${activeTab === 'series' ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-4`}>
            {!selectedSeries ? (
              <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-10 text-center text-xs text-[#6E778E]">
                Selecione ou importe uma série para gerir temporadas e episódios.
              </div>
            ) : (
              <>
                {/* Seasons Panel */}
                {(activeTab === 'series' || activeTab === 'seasons') && (
                  <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-[#E5B85A]" />
                        <h3 className="text-sm font-semibold text-white">
                          Temporadas de {selectedSeries.title} ({selectedSeries.seasons.length})
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingSeason({
                            seasonNumber: selectedSeries.seasons.length + 1,
                            title: `Temporada ${selectedSeries.seasons.length + 1}`,
                            overview: '',
                            posterUrl: selectedSeries.posterUrl,
                            published: true,
                          })
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B85A]/15 text-[#F4CB73] border border-[#E5B85A]/30 hover:bg-[#E5B85A]/25 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Nova Temporada
                      </button>
                    </div>

                    {selectedSeries.seasons.length === 0 ? (
                      <p className="text-xs text-[#6E778E] py-4">Sem temporadas registadas.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {selectedSeries.seasons.map((sea) => (
                          <div
                            key={sea.id}
                            onClick={() => setSelectedSeasonId(sea.id)}
                            className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-2 ${
                              selectedSeasonId === sea.id
                                ? 'bg-[#E5B85A]/10 border-[#E5B85A]/40'
                                : 'bg-[#07090F] border-white/[0.07]'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-white truncate">
                                T{sea.seasonNumber} · {sea.title}
                              </p>
                              <p className="text-[11px] text-[#8D97AF]">
                                {sea.episodes.length} episódios · {sea.published ? 'Publicada' : 'Oculta'}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSeason(sea);
                                }}
                                className="p-1.5 rounded bg-white/5 text-[#D4D9E6] hover:text-[#E5B85A] cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteSeason(sea);
                                }}
                                className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Episodes Panel */}
                {selectedSeason && (
                  <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clapperboard className="w-4 h-4 text-[#E5B85A]" />
                        <h3 className="text-sm font-semibold text-white">
                          Episódios — {selectedSeason.title} ({selectedSeason.episodes.length})
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setEditingEpisode({
                            episodeNumber: selectedSeason.episodes.length + 1,
                            title: `Episódio ${selectedSeason.episodes.length + 1}`,
                            overview: '',
                            stillUrl: '',
                            duration: 45,
                            airDate: '',
                            servers: [],
                            published: true,
                          })
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Novo Episódio
                      </button>
                    </div>

                    {selectedSeason.episodes.length === 0 ? (
                      <p className="text-xs text-[#6E778E] py-4">Sem episódios nesta temporada.</p>
                    ) : (
                      <div className="divide-y divide-white/[0.05]">
                        {selectedSeason.episodes.map((ep) => (
                          <div key={ep.id} className="py-2.5 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-8 h-8 rounded-lg bg-[#E5B85A]/15 text-[#F4CB73] text-xs font-bold flex items-center justify-center shrink-0">
                                E{ep.episodeNumber}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate">{ep.title}</p>
                                <p className="text-[11px] text-[#8D97AF]">
                                  {ep.duration} min · {ep.servers.length} servidor(es) · {ep.published ? 'Publicado' : 'Rascunho'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => setEditingEpisode({ ...ep, servers: [...ep.servers] })}
                                className="p-1.5 rounded bg-white/5 text-[#D4D9E6] hover:text-[#E5B85A] cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteEpisode(ep)}
                                className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: Edit Series */}
      {editingSeries && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#0B0E17] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">{editingSeries.id ? 'Editar Série' : 'Nova Série'}</h3>
              <button type="button" onClick={() => setEditingSeries(null)} className="text-[#8D97AF] hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Título *</label>
                <input
                  type="text"
                  value={editingSeries.title || ''}
                  onChange={(e) => setEditingSeries({ ...editingSeries, title: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Ano</label>
                <input
                  type="text"
                  value={editingSeries.year || ''}
                  onChange={(e) => setEditingSeries({ ...editingSeries, year: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Descrição</label>
              <textarea
                rows={3}
                value={editingSeries.overview || ''}
                onChange={(e) => setEditingSeries({ ...editingSeries, overview: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <MediaUploadField
              token={token}
              label="Poster da Série"
              value={editingSeries.posterUrl || ''}
              onChange={(url) => setEditingSeries({ ...editingSeries, posterUrl: url })}
              folder="posters"
              kind="image"
            />
            <MediaUploadField
              token={token}
              label="Backdrop"
              value={editingSeries.backdropUrl || ''}
              onChange={(url) => setEditingSeries({ ...editingSeries, backdropUrl: url })}
              folder="backdrops"
              kind="image"
            />
            <div className="flex flex-wrap gap-5 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingSeries.published !== false}
                  onChange={(e) => setEditingSeries({ ...editingSeries, published: e.target.checked })}
                  className="accent-[#E5B85A]"
                />
                Publicada
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(editingSeries.featured)}
                  onChange={(e) => setEditingSeries({ ...editingSeries, featured: e.target.checked })}
                  className="accent-[#E5B85A]"
                />
                Em Destaque
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingSeries(null)} className="px-3.5 py-2 rounded-lg text-xs bg-white/5 text-white cursor-pointer">
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveSeries()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Season */}
      {editingSeason && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0B0E17] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">{editingSeason.id ? 'Editar Temporada' : 'Nova Temporada'}</h3>
              <button type="button" onClick={() => setEditingSeason(null)} className="text-[#8D97AF] hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Número</label>
                <input
                  type="number"
                  min={1}
                  value={editingSeason.seasonNumber ?? 1}
                  onChange={(e) => setEditingSeason({ ...editingSeason, seasonNumber: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-[#D4D9E6] mb-1">Título</label>
                <input
                  type="text"
                  value={editingSeason.title || ''}
                  onChange={(e) => setEditingSeason({ ...editingSeason, title: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Sinopse</label>
              <textarea
                rows={3}
                value={editingSeason.overview || ''}
                onChange={(e) => setEditingSeason({ ...editingSeason, overview: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={editingSeason.published !== false}
                onChange={(e) => setEditingSeason({ ...editingSeason, published: e.target.checked })}
                className="accent-[#E5B85A]"
              />
              Publicada
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingSeason(null)} className="px-3.5 py-2 rounded-lg text-xs bg-white/5 text-white cursor-pointer">
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveSeason()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Episode */}
      {editingEpisode && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/15 bg-[#0B0E17] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">{editingEpisode.id ? 'Editar Episódio' : 'Novo Episódio'}</h3>
              <button type="button" onClick={() => setEditingEpisode(null)} className="text-[#8D97AF] hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Nº Episódio</label>
                <input
                  type="number"
                  min={1}
                  value={editingEpisode.episodeNumber ?? 1}
                  onChange={(e) => setEditingEpisode({ ...editingEpisode, episodeNumber: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-[#D4D9E6] mb-1">Título</label>
                <input
                  type="text"
                  value={editingEpisode.title || ''}
                  onChange={(e) => setEditingEpisode({ ...editingEpisode, title: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Duração (min)</label>
                <input
                  type="number"
                  value={editingEpisode.duration ?? 45}
                  onChange={(e) => setEditingEpisode({ ...editingEpisode, duration: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Descrição</label>
              <textarea
                rows={2}
                value={editingEpisode.overview || ''}
                onChange={(e) => setEditingEpisode({ ...editingEpisode, overview: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Servidores de Reprodução do Episódio</span>
                <button
                  type="button"
                  onClick={addEpisodeServer}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-[#E5B85A]/15 text-[#F4CB73] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar Link
                </button>
              </div>
              {(editingEpisode.servers || []).map((srv, idx) => (
                <div key={srv.id} className="grid grid-cols-12 gap-2 p-2 rounded-lg bg-[#07090F] border border-white/10">
                  <input
                    type="text"
                    value={srv.name}
                    onChange={(e) => {
                      const next = [...(editingEpisode.servers || [])];
                      next[idx] = { ...next[idx], name: e.target.value };
                      setEditingEpisode({ ...editingEpisode, servers: next });
                    }}
                    placeholder="Nome"
                    className="col-span-3 rounded bg-black/40 border border-white/10 px-2 py-1 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={srv.url}
                    onChange={(e) => {
                      const next = [...(editingEpisode.servers || [])];
                      next[idx] = { ...next[idx], url: e.target.value };
                      setEditingEpisode({ ...editingEpisode, servers: next });
                    }}
                    placeholder="https://..."
                    className="col-span-6 rounded bg-black/40 border border-white/10 px-2 py-1 text-xs text-white"
                  />
                  <select
                    value={srv.type}
                    onChange={(e) => {
                      const next = [...(editingEpisode.servers || [])];
                      next[idx] = { ...next[idx], type: e.target.value as 'embed' | 'stream' };
                      setEditingEpisode({ ...editingEpisode, servers: next });
                    }}
                    className="col-span-2 rounded bg-black/40 border border-white/10 px-1 py-1 text-xs text-white"
                  >
                    <option value="embed">Embed</option>
                    <option value="stream">MP4</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingEpisode({
                        ...editingEpisode,
                        servers: (editingEpisode.servers || []).filter((_, i) => i !== idx),
                      })
                    }
                    className="col-span-1 flex items-center justify-center rounded bg-red-500/10 text-red-400 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditingEpisode(null)} className="px-3.5 py-2 rounded-lg text-xs bg-white/5 text-white cursor-pointer">
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveEpisode()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> Guardar Episódio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
