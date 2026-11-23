import { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import { movixApi } from '../../lib/api';
import {
  applyCloudConfigToSiteConfig,
  fetchCloudCatalogList,
  fetchCloudSystemConfig,
  upsertCloudCatalogList,
  upsertCloudSystemConfig,
  type SupportedLanguage,
} from '../../lib/firebase';
import type { SiteIdentityConfig } from '../../types/adm';
import type { BannerItem, HighlightItem, MediaSummary } from '../../types/movix';
import { MediaUploadField } from '../components/MediaUploadField';

interface PagesIdentitySectionProps {
  token: string;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPublicDataChanged: () => void;
}

export function PagesIdentitySection({ token, onNotify, onPublicDataChanged }: PagesIdentitySectionProps) {
  const [subTab, setSubTab] = useState<'identity' | 'banners' | 'highlights' | 'legal' | 'seo'>('identity');
  const [siteConfig, setSiteConfig] = useState<SiteIdentityConfig | null>(null);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // TMDB quick picker for banners/highlights
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<MediaSummary[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, dashRes, cloudCfg, cloudBanners, cloudHighlights] = await Promise.all([
        admApi.getSiteConfig(token),
        movixApi.getAdminDashboard(token),
        fetchCloudSystemConfig(),
        fetchCloudCatalogList<BannerItem>('banners').catch(() => null),
        fetchCloudCatalogList<HighlightItem>('highlights').catch(() => null),
      ]);
      setSiteConfig(
        cloudCfg ? applyCloudConfigToSiteConfig(cfgRes.siteConfig, cloudCfg) : cfgRes.siteConfig
      );
      setBanners(cloudBanners && cloudBanners.length > 0 ? cloudBanners : dashRes.banners);
      setHighlights(cloudHighlights && cloudHighlights.length > 0 ? cloudHighlights : dashRes.highlights);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar páginas e identidade.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaveSiteConfig = async () => {
    if (!siteConfig) return;
    setSaving(true);
    try {
      const res = await admApi.saveSiteConfig(token, siteConfig);
      const synced = await upsertCloudSystemConfig(
        {
          platformName: res.siteConfig.platformName,
          logoUrl: res.siteConfig.logoUrl,
          faviconUrl: res.siteConfig.faviconUrl,
          primaryColor: res.siteConfig.primaryColor,
          heroTagline: res.siteConfig.heroTagline,
          seoTitle: res.siteConfig.seoTitle,
          seoDescription: res.siteConfig.seoDescription,
          seoKeywords: res.siteConfig.seoKeywords,
          aboutUs: res.siteConfig.aboutUs,
          privacyPolicy: res.siteConfig.privacyPolicy,
          termsOfUse: res.siteConfig.termsOfUse,
          contactEmail: res.siteConfig.contactEmail,
          contactPhone: res.siteConfig.contactPhone,
          socialInstagram: res.siteConfig.socialInstagram,
          socialYoutube: res.siteConfig.socialYoutube,
          socialTelegram: res.siteConfig.socialTelegram,
          socialTwitter: res.siteConfig.socialTwitter,
          defaultLanguage: res.siteConfig.defaultLanguage as SupportedLanguage,
          maintenanceMode: res.siteConfig.maintenanceMode,
          adsGlobalEnabled: res.siteConfig.adsGlobalEnabled,
        },
        res.siteConfig
      );
      setSiteConfig(res.siteConfig);
      onNotify(
        synced
          ? 'Identidade, páginas e SEO guardados permanentemente na nuvem!'
          : 'Identidade guardada localmente. Ative o Backup Permanente no topo para guardar na nuvem.'
      );
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar configurações do site.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBanners = async () => {
    setSaving(true);
    try {
      const res = await movixApi.saveAdminBanners(token, banners.map((b, i) => ({ ...b, order: i + 1 })));
      const synced = await upsertCloudCatalogList('banners', res.banners);
      setBanners(res.banners);
      onNotify(
        synced
          ? 'Banners principais guardados permanentemente na nuvem!'
          : 'Banners principais guardados localmente.'
      );
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar banners.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveHighlights = async () => {
    setSaving(true);
    try {
      const res = await movixApi.saveAdminHighlights(token, highlights.map((h, i) => ({ ...h, order: i + 1 })));
      const synced = await upsertCloudCatalogList('highlights', res.highlights);
      setHighlights(res.highlights);
      onNotify(
        synced
          ? 'Destaques guardados permanentemente na nuvem!'
          : 'Destaques da página inicial guardados localmente.'
      );
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar destaques.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const searchTmdb = async () => {
    if (!pickerQuery.trim()) return;
    setSearching(true);
    try {
      const res = await movixApi.search(pickerQuery.trim(), 'multi', 1);
      setPickerResults(res.results.slice(0, 6));
    } catch {
      onNotify('Falha ao pesquisar no TMDB.', 'error');
    } finally {
      setSearching(false);
    }
  };

  if (loading || !siteConfig) {
    return (
      <div className="py-16 flex items-center justify-center gap-2 text-xs text-[#8D97AF]">
        <Loader2 className="w-4 h-4 animate-spin text-[#E5B85A]" /> A carregar páginas e identidade...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Páginas, Identidade e SEO</h1>
          <p className="text-xs sm:text-sm text-[#8D97AF]">
            Personalize logotipo, favicon, cor principal, banners, destaques, páginas institucionais e metadados do MOVIX.
          </p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'identity', label: 'Identidade Visual', icon: Sparkles },
            { id: 'banners', label: `Banners Iniciais (${banners.length})`, icon: ImageIcon },
            { id: 'highlights', label: `Destaques (${highlights.length})`, icon: Sparkles },
            { id: 'legal', label: 'Páginas & Contactos', icon: FileText },
            { id: 'seo', label: 'SEO & Metadados', icon: Globe },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                subTab === t.id
                  ? 'bg-[#E5B85A] text-[#06070B] border-[#E5B85A]'
                  : 'bg-[#0B0E17] text-[#A0A6B8] border-white/10 hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* 1. Identity */}
      {subTab === 'identity' && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Nome da Plataforma</label>
              <input
                type="text"
                value={siteConfig.platformName}
                onChange={(e) => setSiteConfig({ ...siteConfig, platformName: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Cor Principal de Destaque</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={siteConfig.primaryColor}
                  onChange={(e) => setSiteConfig({ ...siteConfig, primaryColor: e.target.value })}
                  className="h-9 w-12 rounded bg-transparent border border-white/10 cursor-pointer"
                />
                <input
                  type="text"
                  value={siteConfig.primaryColor}
                  onChange={(e) => setSiteConfig({ ...siteConfig, primaryColor: e.target.value })}
                  className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Slogan / Subtítulo da Plataforma</label>
            <input
              type="text"
              value={siteConfig.heroTagline}
              onChange={(e) => setSiteConfig({ ...siteConfig, heroTagline: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MediaUploadField
              token={token}
              label="Logotipo da Plataforma (PNG/WEBP transparente)"
              value={siteConfig.logoUrl}
              onChange={(url) => setSiteConfig({ ...siteConfig, logoUrl: url })}
              folder="branding"
              kind="image"
            />
            <MediaUploadField
              token={token}
              label="Favicon do Site"
              value={siteConfig.faviconUrl}
              onChange={(url) => setSiteConfig({ ...siteConfig, faviconUrl: url })}
              folder="branding"
              kind="image"
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveSiteConfig()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Guardar Identidade
            </button>
          </div>
        </div>
      )}

      {/* 2. Banners */}
      {subTab === 'banners' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">Adicionar Banner via TMDB ou Manualmente</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setBanners((prev) => [
                      ...prev,
                      {
                        id: `banner-${Date.now().toString(36)}`,
                        title: 'Novo Banner',
                        subtitle: '',
                        tmdbId: null,
                        mediaType: 'movie',
                        backdropUrl: '',
                        posterUrl: '',
                        year: String(new Date().getFullYear()),
                        rating: 8.5,
                        genres: [],
                        active: true,
                        order: prev.length + 1,
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/10 text-white cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Banner Manual
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveBanners()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" /> Guardar Banners
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void searchTmdb()}
                placeholder="Pesquisar filme ou série no TMDB para adicionar aos banners..."
                className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                disabled={searching}
                onClick={() => void searchTmdb()}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>

            {pickerResults.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {pickerResults.map((item) => (
                  <button
                    key={`${item.mediaType}-${item.id}`}
                    type="button"
                    onClick={() => {
                      setBanners((prev) => [
                        ...prev,
                        {
                          id: `banner-${Date.now().toString(36)}-${item.id}`,
                          title: item.title,
                          subtitle: item.overview.slice(0, 180),
                          tmdbId: item.id,
                          mediaType: item.mediaType,
                          backdropUrl: item.backdropUrl || '',
                          posterUrl: item.posterUrl || '',
                          year: item.year,
                          rating: item.rating,
                          genres: [],
                          active: true,
                          order: prev.length + 1,
                        },
                      ]);
                      onNotify(`"${item.title}" adicionado à lista de banners (clique em Guardar Banners).`);
                    }}
                    className="flex items-center gap-2 p-2 rounded-lg bg-[#07090F] border border-white/10 hover:border-[#E5B85A]/40 text-left cursor-pointer"
                  >
                    {item.posterUrl && <img src={item.posterUrl} alt={item.title} className="w-8 h-11 rounded object-cover" />}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                      <p className="text-[10px] text-[#E5B85A]">+ Adicionar Banner</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            {banners.map((b, idx) => (
              <div key={b.id} className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                  <input
                    type="text"
                    value={b.title}
                    onChange={(e) => setBanners((prev) => prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                    placeholder="Título do Banner"
                    className="sm:col-span-4 rounded-lg bg-[#07090F] border border-white/10 px-3 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={b.subtitle}
                    onChange={(e) => setBanners((prev) => prev.map((x, i) => (i === idx ? { ...x, subtitle: e.target.value } : x)))}
                    placeholder="Subtítulo / Sinopse"
                    className="sm:col-span-5 rounded-lg bg-[#07090F] border border-white/10 px-3 py-1.5 text-xs text-white"
                  />
                  <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-xs text-white">
                    <input
                      type="checkbox"
                      checked={b.active}
                      onChange={(e) => setBanners((prev) => prev.map((x, i) => (i === idx ? { ...x, active: e.target.checked } : x)))}
                      className="accent-[#E5B85A]"
                    />
                    Ativo
                  </label>
                  <div className="sm:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setBanners((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 rounded bg-red-500/10 text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <MediaUploadField
                  token={token}
                  label="Imagem de Fundo do Banner"
                  value={b.backdropUrl}
                  onChange={(url) => setBanners((prev) => prev.map((x, i) => (i === idx ? { ...x, backdropUrl: url } : x)))}
                  folder="backdrops"
                  kind="image"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Highlights */}
      {subTab === 'highlights' && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white">Destaques Curados da Página Inicial</span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveHighlights()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> Guardar Destaques
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void searchTmdb()}
              placeholder="Pesquisar título no TMDB para adicionar aos destaques..."
              className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <button type="button" onClick={() => void searchTmdb()} className="px-3.5 py-2 rounded-lg text-xs bg-white/10 text-white cursor-pointer">
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {pickerResults.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {pickerResults.map((item) => (
                <button
                  key={`${item.mediaType}-${item.id}`}
                  type="button"
                  onClick={() => {
                    setHighlights((prev) => [
                      ...prev,
                      {
                        id: `hl-${Date.now().toString(36)}-${item.id}`,
                        tmdbId: item.id,
                        mediaType: item.mediaType,
                        title: item.title,
                        posterUrl: item.posterUrl || '',
                        backdropUrl: item.backdropUrl || '',
                        year: item.year,
                        rating: item.rating,
                        label: 'Destaque MOVIX',
                        active: true,
                        order: prev.length + 1,
                      },
                    ]);
                  }}
                  className="flex items-center gap-2 p-2 rounded-lg bg-[#07090F] border border-white/10 hover:border-[#E5B85A]/40 text-left cursor-pointer"
                >
                  {item.posterUrl && <img src={item.posterUrl} alt={item.title} className="w-8 h-11 rounded object-cover" />}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                    <p className="text-[10px] text-[#E5B85A]">+ Adicionar aos Destaques</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {highlights.map((h, idx) => (
              <div key={h.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#07090F] border border-white/[0.06]">
                <div className="flex items-center gap-3 min-w-0">
                  {h.posterUrl && <img src={h.posterUrl} alt={h.title} className="w-8 h-11 rounded object-cover" />}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{h.title}</p>
                    <p className="text-[10px] text-[#8D97AF]">{h.year} · ★ {h.rating.toFixed(1)}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHighlights((prev) => prev.filter((_, i) => i !== idx))}
                  className="p-1.5 rounded bg-red-500/10 text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Legal Pages & Contacts */}
      {subTab === 'legal' && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-4">
          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Sobre Nós</label>
            <textarea
              rows={3}
              value={siteConfig.aboutUs}
              onChange={(e) => setSiteConfig({ ...siteConfig, aboutUs: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Política de Privacidade</label>
            <textarea
              rows={4}
              value={siteConfig.privacyPolicy}
              onChange={(e) => setSiteConfig({ ...siteConfig, privacyPolicy: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Termos de Uso</label>
            <textarea
              rows={4}
              value={siteConfig.termsOfUse}
              onChange={(e) => setSiteConfig({ ...siteConfig, termsOfUse: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">E-mail de Contacto</label>
              <input
                type="email"
                value={siteConfig.contactEmail}
                onChange={(e) => setSiteConfig({ ...siteConfig, contactEmail: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Telefone / WhatsApp</label>
              <input
                type="text"
                value={siteConfig.contactPhone}
                onChange={(e) => setSiteConfig({ ...siteConfig, contactPhone: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Instagram (URL)</label>
              <input
                type="url"
                value={siteConfig.socialInstagram}
                onChange={(e) => setSiteConfig({ ...siteConfig, socialInstagram: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">YouTube (URL)</label>
              <input
                type="url"
                value={siteConfig.socialYoutube}
                onChange={(e) => setSiteConfig({ ...siteConfig, socialYoutube: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Telegram (URL)</label>
              <input
                type="url"
                value={siteConfig.socialTelegram}
                onChange={(e) => setSiteConfig({ ...siteConfig, socialTelegram: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">X / Twitter (URL)</label>
              <input
                type="url"
                value={siteConfig.socialTwitter}
                onChange={(e) => setSiteConfig({ ...siteConfig, socialTwitter: e.target.value })}
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveSiteConfig()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> Guardar Páginas e Contactos
            </button>
          </div>
        </div>
      )}

      {/* 5. SEO & Metadata */}
      {subTab === 'seo' && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-4">
          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Título SEO (Meta Title)</label>
            <input
              type="text"
              value={siteConfig.seoTitle}
              onChange={(e) => setSiteConfig({ ...siteConfig, seoTitle: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Descrição SEO (Meta Description)</label>
            <textarea
              rows={3}
              value={siteConfig.seoDescription}
              onChange={(e) => setSiteConfig({ ...siteConfig, seoDescription: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-[#D4D9E6] mb-1">Palavras-chave SEO</label>
            <input
              type="text"
              value={siteConfig.seoKeywords}
              onChange={(e) => setSiteConfig({ ...siteConfig, seoKeywords: e.target.value })}
              className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveSiteConfig()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> Guardar SEO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
