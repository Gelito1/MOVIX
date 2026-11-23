import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Edit3,
  Eye,
  EyeOff,
  Film,
  Loader2,
  Plus,
  Save,
  Search,
  Server,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import { movixApi } from '../../lib/api';
import {
  deleteCloudMovie,
  fetchCloudMovies,
  isVerifiedFirebaseAdmin,
  upsertCloudMovie,
} from '../../lib/firebase';
import type { ManagedMovie, PlaybackServerLink } from '../../types/adm';
import type { MediaSummary } from '../../types/movix';
import { MediaUploadField } from '../components/MediaUploadField';

interface MoviesSectionProps {
  token: string;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPublicDataChanged: () => void;
}

function emptyMovie(): Partial<ManagedMovie> {
  return {
    tmdbId: null,
    title: '',
    originalTitle: '',
    overview: '',
    posterUrl: '',
    backdropUrl: '',
    trailerUrl: '',
    releaseDate: '',
    year: String(new Date().getFullYear()),
    runtime: 100,
    language: 'pt-BR',
    certification: '14',
    rating: 7.5,
    categories: ['Filmes'],
    genres: [],
    servers: [],
    featured: false,
    recommended: false,
    published: true,
  };
}

export function MoviesSection({ token, onNotify, onPublicDataChanged }: MoviesSectionProps) {
  const [movies, setMovies] = useState<ManagedMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft' | 'featured'>('all');

  // TMDB import panel
  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbIdInput, setTmdbIdInput] = useState('');
  const [tmdbResults, setTmdbResults] = useState<MediaSummary[]>([]);
  const [searchingTmdb, setSearchingTmdb] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);

  // Full editor
  const [editing, setEditing] = useState<Partial<ManagedMovie> | null>(null);
  const [saving, setSaving] = useState(false);
  const [genresText, setGenresText] = useState('');
  const [categoriesText, setCategoriesText] = useState('');

  const loadMovies = useCallback(async () => {
    setLoading(true);
    try {
      const [res, cloudMovies] = await Promise.all([
        admApi.listMovies(token),
        fetchCloudMovies(true).catch(() => []),
      ]);
      const byId = new Map<string, ManagedMovie>();
      for (const m of res.movies) byId.set(m.id, m);
      for (const cm of cloudMovies) {
        const local = byId.get(cm.id);
        if (!local || (Date.parse(cm.updatedAt) || 0) >= (Date.parse(local.updatedAt) || 0)) {
          byId.set(cm.id, cm);
        }
      }
      if (cloudMovies.length === 0 && res.movies.length > 0 && isVerifiedFirebaseAdmin()) {
        void Promise.all(res.movies.map((m) => upsertCloudMovie(m)));
      }
      setMovies(Array.from(byId.values()));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar filmes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, onNotify]);

  useEffect(() => {
    void loadMovies();
  }, [loadMovies]);

  const openEditor = (movie: Partial<ManagedMovie>) => {
    setEditing({ ...movie, servers: [...(movie.servers || [])] });
    setGenresText((movie.genres || []).join(', '));
    setCategoriesText((movie.categories || []).join(', '));
  };

  const handleTmdbSearch = async () => {
    if (!tmdbQuery.trim()) return;
    setSearchingTmdb(true);
    try {
      const res = await movixApi.search(tmdbQuery.trim(), 'movie', 1);
      setTmdbResults(res.results.slice(0, 8));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao pesquisar no TMDB.', 'error');
    } finally {
      setSearchingTmdb(false);
    }
  };

  const handleImportById = async (tmdbId: number) => {
    setImportingId(tmdbId);
    try {
      const res = await admApi.importMovieFromTmdb(token, tmdbId);
      await upsertCloudMovie(res.movie);
      onNotify(
        res.alreadyExists
          ? `"${res.movie.title}" já existia no catálogo — aberto para edição.`
          : `"${res.movie.title}" importado do TMDB e guardado na nuvem!`
      );
      await loadMovies();
      onPublicDataChanged();
      openEditor(res.movie);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Falha ao importar filme do TMDB.', 'error');
    } finally {
      setImportingId(null);
    }
  };

  const handleSaveMovie = async () => {
    if (!editing || !editing.title?.trim()) {
      onNotify('O título do filme é obrigatório.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<ManagedMovie> = {
        ...editing,
        genres: genresText.split(',').map((s) => s.trim()).filter(Boolean),
        categories: categoriesText.split(',').map((s) => s.trim()).filter(Boolean),
      };
      let saved: ManagedMovie;
      if (editing.id) {
        try {
          const res = await admApi.updateMovie(token, editing.id, payload);
          saved = res.movie;
        } catch {
          const res = await admApi.createMovie(token, payload);
          saved = { ...res.movie, id: editing.id };
        }
      } else {
        const res = await admApi.createMovie(token, payload);
        saved = res.movie;
      }
      const synced = await upsertCloudMovie(saved);
      onNotify(
        synced
          ? editing.id
            ? 'Filme atualizado permanentemente na nuvem!'
            : 'Filme adicionado e guardado permanentemente na nuvem!'
          : editing.id
            ? 'Filme atualizado localmente.'
            : 'Filme adicionado localmente.'
      );
      setEditing(null);
      await loadMovies();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar filme.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async (movie: ManagedMovie) => {
    try {
      let updated: ManagedMovie = { ...movie, published: !movie.published, updatedAt: new Date().toISOString() };
      try {
        const res = await admApi.updateMovie(token, movie.id, { published: !movie.published });
        updated = res.movie;
      } catch {
        // Cloud-only movie fallback
      }
      await upsertCloudMovie(updated);
      onNotify(movie.published ? 'Filme despublicado.' : 'Filme publicado no MOVIX.');
      await loadMovies();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao atualizar estado.', 'error');
    }
  };

  const handleDelete = async (movie: ManagedMovie) => {
    if (!window.confirm(`Eliminar permanentemente "${movie.title}"?`)) return;
    try {
      await Promise.all([
        admApi.deleteMovie(token, movie.id).catch(() => null),
        deleteCloudMovie(movie.id),
      ]);
      onNotify('Filme eliminado permanentemente.');
      await loadMovies();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao eliminar filme.', 'error');
    }
  };

  const addServerRow = () => {
    if (!editing) return;
    const next: PlaybackServerLink = {
      id: `srv_${Date.now().toString(36)}`,
      name: `Servidor ${(editing.servers?.length || 0) + 1}`,
      url: '',
      language: 'dublado',
      quality: 'Full HD 1080p',
      type: 'embed',
      active: true,
      order: (editing.servers?.length || 0) + 1,
    };
    setEditing({ ...editing, servers: [...(editing.servers || []), next] });
  };

  const updateServerRow = (idx: number, patch: Partial<PlaybackServerLink>) => {
    if (!editing) return;
    const copy = [...(editing.servers || [])];
    copy[idx] = { ...copy[idx], ...patch };
    setEditing({ ...editing, servers: copy });
  };

  const removeServerRow = (idx: number) => {
    if (!editing) return;
    setEditing({ ...editing, servers: (editing.servers || []).filter((_, i) => i !== idx) });
  };

  const filtered = movies.filter((m) => {
    const matchesSearch =
      !searchTerm.trim() ||
      m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(m.tmdbId || '').includes(searchTerm);
    if (!matchesSearch) return false;
    if (statusFilter === 'published') return m.published;
    if (statusFilter === 'draft') return !m.published;
    if (statusFilter === 'featured') return m.featured;
    return true;
  });

  if (editing) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">
              {editing.id ? `Editar Filme: ${editing.title}` : 'Adicionar Novo Filme'}
            </h1>
            <p className="text-xs text-[#8D97AF]">Todas as alterações sincronizam imediatamente com o site MOVIX.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-3.5 py-2 rounded-lg text-xs font-medium bg-white/[0.05] text-[#D4D9E6] border border-white/10 hover:bg-white/10 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveMovie()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar Filme
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4 rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Título *</label>
                <input
                  type="text"
                  value={editing.title || ''}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Título Original</label>
                <input
                  type="text"
                  value={editing.originalTitle || ''}
                  onChange={(e) => setEditing({ ...editing, originalTitle: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Sinopse / Descrição</label>
              <textarea
                rows={4}
                value={editing.overview || ''}
                onChange={(e) => setEditing({ ...editing, overview: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">ID TMDB</label>
                <input
                  type="number"
                  value={editing.tmdbId ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, tmdbId: e.target.value ? Number(e.target.value) : null })
                  }
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Data Lançamento</label>
                <input
                  type="date"
                  value={editing.releaseDate || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, releaseDate: e.target.value, year: e.target.value.slice(0, 4) })
                  }
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Duração (min)</label>
                <input
                  type="number"
                  value={editing.runtime ?? 0}
                  onChange={(e) => setEditing({ ...editing, runtime: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Classificação</label>
                <select
                  value={editing.certification || '14'}
                  onChange={(e) => setEditing({ ...editing, certification: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                >
                  {['L', '10', '12', '14', '16', '18'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Idioma</label>
                <input
                  type="text"
                  value={editing.language || 'pt-BR'}
                  onChange={(e) => setEditing({ ...editing, language: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Nota (0-10)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={10}
                  value={editing.rating ?? 0}
                  onChange={(e) => setEditing({ ...editing, rating: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">URL do Trailer (YouTube)</label>
                <input
                  type="text"
                  value={editing.trailerUrl || ''}
                  onChange={(e) => setEditing({ ...editing, trailerUrl: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Categorias (separadas por vírgula)</label>
                <input
                  type="text"
                  value={categoriesText}
                  onChange={(e) => setCategoriesText(e.target.value)}
                  placeholder="Filmes, Lançamentos, Ação"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Géneros (separados por vírgula)</label>
                <input
                  type="text"
                  value={genresText}
                  onChange={(e) => setGenresText(e.target.value)}
                  placeholder="Ação, Ficção Científica, Drama"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            {/* Playback Servers */}
            <div className="pt-2 border-t border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-[#E5B85A]" />
                  <h3 className="text-xs font-semibold text-white">Servidores de Reprodução</h3>
                </div>
                <button
                  type="button"
                  onClick={addServerRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#E5B85A]/15 text-[#F4CB73] border border-[#E5B85A]/30 hover:bg-[#E5B85A]/25 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar Servidor
                </button>
              </div>

              {(editing.servers || []).length === 0 ? (
                <p className="text-xs text-[#6E778E]">Nenhum servidor manual configurado (usará o player automático MOVIX se possuir ID TMDB).</p>
              ) : (
                <div className="space-y-2.5">
                  {(editing.servers || []).map((srv, idx) => (
                    <div key={srv.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-2.5 rounded-lg bg-[#07090F] border border-white/10">
                      <input
                        type="text"
                        value={srv.name}
                        onChange={(e) => updateServerRow(idx, { name: e.target.value })}
                        placeholder="Nome"
                        className="sm:col-span-3 rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-white"
                      />
                      <input
                        type="text"
                        value={srv.url}
                        onChange={(e) => updateServerRow(idx, { url: e.target.value })}
                        placeholder="https://..."
                        className="sm:col-span-5 rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-white"
                      />
                      <select
                        value={srv.language}
                        onChange={(e) =>
                          updateServerRow(idx, { language: e.target.value as PlaybackServerLink['language'] })
                        }
                        className="sm:col-span-2 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white"
                      >
                        <option value="dublado">Dublado</option>
                        <option value="legendado">Legendado</option>
                        <option value="dual">Dual Áudio</option>
                      </select>
                      <select
                        value={srv.type}
                        onChange={(e) => updateServerRow(idx, { type: e.target.value as 'embed' | 'stream' })}
                        className="sm:col-span-1 rounded bg-black/40 border border-white/10 px-1.5 py-1.5 text-xs text-white"
                      >
                        <option value="embed">Embed</option>
                        <option value="stream">MP4</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeServerRow(idx)}
                        className="sm:col-span-1 flex items-center justify-center rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 p-1.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column: Media & Publish switches */}
          <div className="space-y-4 rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5">
            <MediaUploadField
              token={token}
              label="Poster do Filme"
              value={editing.posterUrl || ''}
              onChange={(url) => setEditing({ ...editing, posterUrl: url })}
              folder="posters"
              kind="image"
            />
            <MediaUploadField
              token={token}
              label="Imagem de Fundo (Backdrop)"
              value={editing.backdropUrl || ''}
              onChange={(url) => setEditing({ ...editing, backdropUrl: url })}
              folder="backdrops"
              kind="image"
            />

            <div className="pt-3 border-t border-white/[0.06] space-y-2.5">
              <label className="flex items-center justify-between text-xs text-white cursor-pointer">
                <span>Publicado no site MOVIX</span>
                <input
                  type="checkbox"
                  checked={editing.published !== false}
                  onChange={(e) => setEditing({ ...editing, published: e.target.checked })}
                  className="accent-[#E5B85A] w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between text-xs text-white cursor-pointer">
                <span>Adicionar aos Destaques</span>
                <input
                  type="checkbox"
                  checked={Boolean(editing.featured)}
                  onChange={(e) => setEditing({ ...editing, featured: e.target.checked })}
                  className="accent-[#E5B85A] w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between text-xs text-white cursor-pointer">
                <span>Marcar como Recomendado</span>
                <input
                  type="checkbox"
                  checked={Boolean(editing.recommended)}
                  onChange={(e) => setEditing({ ...editing, recommended: e.target.checked })}
                  className="accent-[#E5B85A] w-4 h-4"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Gestão de Filmes</h1>
          <p className="text-xs sm:text-sm text-[#8D97AF]">
            Adicione filmes manualmente, importe do TMDB e gira servidores de reprodução.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openEditor(emptyMovie())}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] cursor-pointer self-start"
        >
          <Plus className="w-4 h-4" /> Adicionar Filme Manualmente
        </button>
      </div>

      {/* TMDB Instant Importer */}
      <div className="rounded-xl border border-[#E5B85A]/20 bg-[#0B0E17] p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#F4CB73]">
          <Sparkles className="w-4 h-4" />
          <span>Importação Automática via API TMDB</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
          <div className="md:col-span-7 flex gap-2">
            <input
              type="text"
              value={tmdbQuery}
              onChange={(e) => setTmdbQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleTmdbSearch()}
              placeholder="Pesquisar filme no TMDB pelo nome..."
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
              placeholder="Ou importar por ID TMDB (ex: 550)"
              className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <button
              type="button"
              disabled={!tmdbIdInput || importingId !== null}
              onClick={() => void handleImportById(Number(tmdbIdInput))}
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
                    <Film className="w-4 h-4 text-[#6E778E]" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                  <p className="text-[11px] text-[#8D97AF]">{item.year} · ★ {item.rating.toFixed(1)}</p>
                  <button
                    type="button"
                    disabled={importingId === item.id}
                    onClick={() => void handleImportById(item.id)}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[#E5B85A] hover:underline cursor-pointer"
                  >
                    {importingId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    Importar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters & Table */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#6E778E] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtrar filmes por título ou ID TMDB..."
              className="w-full rounded-lg bg-[#07090F] border border-white/10 pl-9 pr-3 py-2 text-xs text-white"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: `Todos (${movies.length})` },
                { id: 'published', label: 'Publicados' },
                { id: 'draft', label: 'Rascunhos' },
                { id: 'featured', label: 'Destaques' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#E5B85A]/15 text-[#F4CB73] border-[#E5B85A]/35'
                    : 'bg-[#07090F] text-[#8D97AF] border-white/10 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-[#8D97AF]">
            <Loader2 className="w-4 h-4 animate-spin text-[#E5B85A]" /> A carregar filmes...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#6E778E]">
            Nenhum filme encontrado. Importe do TMDB acima ou clique em &ldquo;Adicionar Filme Manualmente&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-white/[0.06] text-[#8D97AF]">
                  <th className="py-2.5 pr-3 font-medium">Filme</th>
                  <th className="py-2.5 px-2 font-medium">Ano / Nota</th>
                  <th className="py-2.5 px-2 font-medium">Servidores</th>
                  <th className="py-2.5 px-2 font-medium">Views</th>
                  <th className="py-2.5 px-2 font-medium">Estado</th>
                  <th className="py-2.5 pl-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-3">
                        {m.posterUrl ? (
                          <img src={m.posterUrl} alt={m.title} className="w-9 h-12 rounded object-cover bg-black shrink-0" />
                        ) : (
                          <div className="w-9 h-12 rounded bg-white/5 flex items-center justify-center shrink-0">
                            <Film className="w-4 h-4 text-[#6E778E]" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <span className="truncate max-w-[220px]">{m.title}</span>
                            {m.featured && <Star className="w-3.5 h-3.5 text-[#E5B85A] fill-[#E5B85A] shrink-0" />}
                          </div>
                          <div className="text-[11px] text-[#7D879F] truncate max-w-[240px]">
                            {m.genres.join(', ') || 'Sem géneros'} {m.tmdbId ? `· TMDB #${m.tmdbId}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-[#D4D9E6] whitespace-nowrap">
                      {m.year || '—'} · ★ {m.rating.toFixed(1)}
                    </td>
                    <td className="py-3 px-2 text-[#D4D9E6]">{m.servers.length}</td>
                    <td className="py-3 px-2 text-[#D4D9E6]">{m.views.toLocaleString('pt-PT')}</td>
                    <td className="py-3 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          m.published ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-[#A0A6B8]'
                        }`}
                      >
                        {m.published ? 'Publicado' : 'Despublicado'}
                      </span>
                    </td>
                    <td className="py-3 pl-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditor(m)}
                          className="p-1.5 rounded-lg bg-white/[0.05] text-[#D4D9E6] hover:text-[#E5B85A] cursor-pointer"
                          title="Editar"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTogglePublish(m)}
                          className="p-1.5 rounded-lg bg-white/[0.05] text-[#D4D9E6] hover:text-emerald-400 cursor-pointer"
                          title={m.published ? 'Despublicar' : 'Publicar'}
                        >
                          {m.published ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(m)}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
