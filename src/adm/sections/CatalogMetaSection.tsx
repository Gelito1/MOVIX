import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FolderTree,
  Loader2,
  Plus,
  Save,
  Server,
  Tag,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import { movixApi } from '../../lib/api';
import {
  fetchCloudCatalogList,
  isVerifiedFirebaseAdmin,
  upsertCloudCatalogList,
} from '../../lib/firebase';
import type { GlobalPlaybackServer, ManagedGenre } from '../../types/adm';
import type { ManagedCategory } from '../../types/movix';
import { MediaUploadField } from '../components/MediaUploadField';

interface CatalogMetaSectionProps {
  token: string;
  mode: 'categories' | 'genres' | 'servers';
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPublicDataChanged: () => void;
}

export function CatalogMetaSection({ token, mode, onNotify, onPublicDataChanged }: CatalogMetaSectionProps) {
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [genres, setGenres] = useState<ManagedGenre[]>([]);
  const [servers, setServers] = useState<GlobalPlaybackServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'categories') {
        const [dash, cloudCats] = await Promise.all([
          movixApi.getAdminDashboard(token),
          fetchCloudCatalogList<ManagedCategory>('categories').catch(() => null),
        ]);
        const effective = cloudCats && cloudCats.length > 0 ? cloudCats : dash.categories;
        if (cloudCats === null && dash.categories.length > 0 && isVerifiedFirebaseAdmin()) {
          void upsertCloudCatalogList('categories', dash.categories);
        }
        setCategories([...effective].sort((a, b) => a.order - b.order));
      } else if (mode === 'genres') {
        const [res, cloudGenres] = await Promise.all([
          admApi.listGenres(token),
          fetchCloudCatalogList<ManagedGenre>('genres').catch(() => null),
        ]);
        const effective = cloudGenres && cloudGenres.length > 0 ? cloudGenres : res.genres;
        if (cloudGenres === null && res.genres.length > 0 && isVerifiedFirebaseAdmin()) {
          void upsertCloudCatalogList('genres', res.genres);
        }
        setGenres([...effective].sort((a, b) => a.order - b.order));
      } else {
        const [res, cloudServers] = await Promise.all([
          admApi.listServers(token),
          fetchCloudCatalogList<GlobalPlaybackServer>('servers').catch(() => null),
        ]);
        const effective = cloudServers && cloudServers.length > 0 ? cloudServers : res.servers;
        if (cloudServers === null && res.servers.length > 0 && isVerifiedFirebaseAdmin()) {
          void upsertCloudCatalogList('servers', res.servers);
        }
        setServers([...effective].sort((a, b) => a.order - b.order));
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar dados.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, mode, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const moveItem = <T extends { order: number }>(list: T[], idx: number, dir: -1 | 1): T[] => {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return list;
    const copy = [...list];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    return copy.map((x, i) => ({ ...x, order: i + 1 }));
  };

  // ===================== CATEGORIES =====================
  if (mode === 'categories') {
    const saveCategories = async () => {
      setSaving(true);
      try {
        const ordered = categories.map((c, i) => ({ ...c, order: i + 1 }));
        await movixApi.saveAdminCategories(token, ordered);
        const synced = await upsertCloudCatalogList('categories', ordered);
        onNotify(
          synced
            ? 'Categorias guardadas permanentemente na nuvem!'
            : 'Categorias guardadas localmente.'
        );
        onPublicDataChanged();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao guardar categorias.', 'error');
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Gestão de Categorias</h1>
            <p className="text-xs sm:text-sm text-[#8D97AF]">
              Crie, ordene, adicione imagem e controle a visibilidade das categorias no site MOVIX.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setCategories((prev) => [
                  ...prev,
                  {
                    id: `cat-${Date.now().toString(36)}`,
                    name: 'Nova Categoria',
                    source: 'tmdb',
                    externalId: 'popular',
                    mediaType: 'movie',
                    imageUrl: '',
                    visible: true,
                    order: prev.length + 1,
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/15 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Nova Categoria
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveCategories()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar Alterações
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-[#8D97AF]">
            <Loader2 className="w-4 h-4 animate-spin text-[#E5B85A]" /> A carregar categorias...
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((cat, idx) => (
              <div key={cat.id} className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] text-[#8D97AF] mb-1">Nome</label>
                    <input
                      type="text"
                      value={cat.name}
                      onChange={(e) =>
                        setCategories((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                      }
                      className="w-full rounded-lg bg-[#07090F] border border-white/10 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] text-[#8D97AF] mb-1">Tipo</label>
                    <select
                      value={cat.mediaType}
                      onChange={(e) =>
                        setCategories((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, mediaType: e.target.value as 'movie' | 'tv' } : x))
                        )
                      }
                      className="w-full rounded-lg bg-[#07090F] border border-white/10 px-2 py-1.5 text-xs text-white"
                    >
                      <option value="movie">Filmes</option>
                      <option value="tv">Séries</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] text-[#8D97AF] mb-1">Slug / ID Externo</label>
                    <input
                      type="text"
                      value={cat.externalId}
                      onChange={(e) =>
                        setCategories((prev) => prev.map((x, i) => (i === idx ? { ...x, externalId: e.target.value } : x)))
                      }
                      className="w-full rounded-lg bg-[#07090F] border border-white/10 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-center gap-2 pt-4">
                    <input
                      type="checkbox"
                      checked={cat.visible}
                      onChange={(e) =>
                        setCategories((prev) => prev.map((x, i) => (i === idx ? { ...x, visible: e.target.checked } : x)))
                      }
                      className="accent-[#E5B85A]"
                    />
                    <span className="text-xs text-white">Visível</span>
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-end gap-1 pt-4">
                    <button
                      type="button"
                      onClick={() => setCategories((prev) => moveItem(prev, idx, -1))}
                      className="p-1.5 rounded bg-white/5 text-[#D4D9E6] hover:text-white cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategories((prev) => moveItem(prev, idx, 1))}
                      className="p-1.5 rounded bg-white/5 text-[#D4D9E6] hover:text-white cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategories((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <MediaUploadField
                  token={token}
                  label="Imagem da Categoria (Opcional)"
                  value={cat.imageUrl || ''}
                  onChange={(url) =>
                    setCategories((prev) => prev.map((x, i) => (i === idx ? { ...x, imageUrl: url } : x)))
                  }
                  folder="categories"
                  kind="image"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===================== GENRES =====================
  if (mode === 'genres') {
    const saveGenres = async () => {
      setSaving(true);
      try {
        const res = await admApi.saveGenres(token, genres.map((g, i) => ({ ...g, order: i + 1 })));
        const synced = await upsertCloudCatalogList('genres', res.genres);
        setGenres(res.genres);
        onNotify(
          synced
            ? 'Géneros guardados permanentemente na nuvem!'
            : 'Géneros atualizados localmente.'
        );
        onPublicDataChanged();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao guardar géneros.', 'error');
      } finally {
        setSaving(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Gestão de Géneros</h1>
            <p className="text-xs sm:text-sm text-[#8D97AF]">
              Organize os géneros disponíveis para filmes e séries no MOVIX.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setGenres((prev) => [
                  ...prev,
                  {
                    id: `gen-${Date.now().toString(36)}`,
                    name: 'Novo Género',
                    slug: `genero-${prev.length + 1}`,
                    mediaType: 'both',
                    active: true,
                    order: prev.length + 1,
                  },
                ])
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Novo Género
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveGenres()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar Géneros
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-2.5">
          {loading ? (
            <div className="py-10 text-center text-xs text-[#8D97AF]">A carregar...</div>
          ) : (
            genres.map((g, idx) => (
              <div key={g.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center p-2.5 rounded-lg bg-[#07090F] border border-white/[0.06]">
                <div className="sm:col-span-4 flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-[#E5B85A] shrink-0" />
                  <input
                    type="text"
                    value={g.name}
                    onChange={(e) =>
                      setGenres((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                    }
                    className="w-full rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <input
                  type="text"
                  value={g.slug}
                  onChange={(e) =>
                    setGenres((prev) => prev.map((x, i) => (i === idx ? { ...x, slug: e.target.value } : x)))
                  }
                  placeholder="slug"
                  className="sm:col-span-3 rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-[#A0A6B8]"
                />
                <select
                  value={g.mediaType}
                  onChange={(e) =>
                    setGenres((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, mediaType: e.target.value as ManagedGenre['mediaType'] } : x))
                    )
                  }
                  className="sm:col-span-2 rounded bg-black/40 border border-white/10 px-2 py-1.5 text-xs text-white"
                >
                  <option value="both">Filmes e Séries</option>
                  <option value="movie">Apenas Filmes</option>
                  <option value="tv">Apenas Séries</option>
                </select>
                <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-xs text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={g.active}
                    onChange={(e) =>
                      setGenres((prev) => prev.map((x, i) => (i === idx ? { ...x, active: e.target.checked } : x)))
                    }
                    className="accent-[#E5B85A]"
                  />
                  Ativo
                </label>
                <div className="sm:col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setGenres((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 rounded bg-red-500/10 text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ===================== PLAYBACK SERVERS =====================
  const saveServers = async () => {
    setSaving(true);
    try {
      const res = await admApi.saveServers(token, servers.map((s, i) => ({ ...s, order: i + 1 })));
      const synced = await upsertCloudCatalogList('servers', res.servers);
      setServers(res.servers);
      onNotify(
        synced
          ? 'Servidores guardados permanentemente na nuvem!'
          : 'Servidores de reprodução guardados localmente.'
      );
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar servidores.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testServer = async (srv: GlobalPlaybackServer) => {
    setTestingId(srv.id);
    try {
      const res = await admApi.testServer(token, srv.id);
      setServers((prev) => prev.map((x) => (x.id === srv.id ? res.server : x)));
      onNotify(`${srv.name}: ${res.message}`, res.online ? 'success' : 'error');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao testar servidor.', 'error');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Servidores de Reprodução</h1>
          <p className="text-xs sm:text-sm text-[#8D97AF]">
            Configure servidores globais de streaming/embed, defina o servidor padrão e teste disponibilidade em tempo real.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setServers((prev) => [
                ...prev,
                {
                  id: `srv-${Date.now().toString(36)}`,
                  name: `Servidor ${prev.length + 1}`,
                  baseUrl: 'https://',
                  kind: 'embed',
                  active: true,
                  isDefault: prev.length === 0,
                  order: prev.length + 1,
                  lastTestedAt: null,
                  lastStatus: 'unknown',
                  lastLatencyMs: null,
                },
              ])
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Novo Servidor
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveServers()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar Servidores
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="py-10 text-center text-xs text-[#8D97AF]">A carregar servidores...</div>
        ) : (
          servers.map((srv, idx) => (
            <div key={srv.id} className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                <div className="sm:col-span-3">
                  <label className="block text-[10px] text-[#8D97AF] mb-1">Nome do Servidor</label>
                  <input
                    type="text"
                    value={srv.name}
                    onChange={(e) =>
                      setServers((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                    }
                    className="w-full rounded-lg bg-[#07090F] border border-white/10 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[10px] text-[#8D97AF] mb-1">URL Base</label>
                  <input
                    type="url"
                    value={srv.baseUrl}
                    onChange={(e) =>
                      setServers((prev) => prev.map((x, i) => (i === idx ? { ...x, baseUrl: e.target.value } : x)))
                    }
                    className="w-full rounded-lg bg-[#07090F] border border-white/10 px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-[#8D97AF] mb-1">Protocolo</label>
                  <select
                    value={srv.kind}
                    onChange={(e) =>
                      setServers((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, kind: e.target.value as GlobalPlaybackServer['kind'] } : x))
                      )
                    }
                    className="w-full rounded-lg bg-[#07090F] border border-white/10 px-2 py-1.5 text-xs text-white"
                  >
                    <option value="embed">Embed</option>
                    <option value="stream">Stream MP4</option>
                    <option value="hls">HLS (.m3u8)</option>
                  </select>
                </div>
                <div className="sm:col-span-3 flex items-center justify-end gap-2 pt-4">
                  <button
                    type="button"
                    disabled={testingId === srv.id}
                    onClick={() => void testServer(srv)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#E5B85A]/15 text-[#F4CB73] border border-[#E5B85A]/30 cursor-pointer"
                  >
                    {testingId === srv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                    Testar
                  </button>
                  <button
                    type="button"
                    onClick={() => setServers((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 rounded-lg bg-red-500/10 text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.06] text-xs">
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={srv.active}
                      onChange={(e) =>
                        setServers((prev) => prev.map((x, i) => (i === idx ? { ...x, active: e.target.checked } : x)))
                      }
                      className="accent-[#E5B85A]"
                    />
                    Ativo
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-white cursor-pointer">
                    <input
                      type="radio"
                      name="defaultServer"
                      checked={srv.isDefault}
                      onChange={() =>
                        setServers((prev) => prev.map((x, i) => ({ ...x, isDefault: i === idx })))
                      }
                      className="accent-[#E5B85A]"
                    />
                    Servidor Padrão
                  </label>
                </div>

                <div className="flex items-center gap-2 text-[11px]">
                  {srv.lastStatus === 'online' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Online ({srv.lastLatencyMs}ms)
                    </span>
                  ) : srv.lastStatus === 'offline' ? (
                    <span className="inline-flex items-center gap-1 text-red-400">
                      <WifiOff className="w-3.5 h-3.5" /> Indisponível
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#7D879F]">
                      <Server className="w-3.5 h-3.5" /> Ainda não testado
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
