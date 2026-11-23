import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  Clock,
  Edit3,
  ExternalLink,
  Eye,
  Film,
  Loader2,
  Megaphone,
  Monitor,
  Pause,
  Play,
  Plus,
  Save,
  Smartphone,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { resolveAdDestination } from '../../lib/adDestination';
import { admApi } from '../../lib/admApi';
import { setAdVideoMuted, startAdVideoWithSound } from '../../lib/adVideoAudio';
import {
  cloudAdToCampaignFallback,
  deleteCloudPublicAd,
  fetchCloudPublicAds,
  fetchCloudSystemConfig,
  isVerifiedFirebaseAdmin,
  removeLocalCloudActiveAdCache,
  syncLocalCloudActiveAdCache,
  upsertCloudPublicAd,
  upsertCloudSystemConfig,
} from '../../lib/firebase';
import {
  AD_FORMAT_OPTIONS,
  AD_PLACEMENT_OPTIONS,
  DEFAULT_AD_PACING,
  type AdCampaign,
  type AdDeviceTarget,
  type AdFormatType,
  type AdPacingConfig,
  type AdPlacement,
  type AdStatsResponse,
  type AdStatus,
} from '../../types/adm';
import { AdmAreaChart, AdmDonutChart } from '../components/AdmCharts';
import { MediaUploadField } from '../components/MediaUploadField';

interface AdsStudioSectionProps {
  token: string;
  mode: 'ads' | 'campaigns' | 'ad_stats';
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPublicDataChanged: () => void;
}

function createEmptyCampaign(): Partial<AdCampaign> {
  return {
    name: '',
    title: '',
    description: '',
    format: 'banner_horizontal',
    mediaKind: 'image',
    imageUrl: '',
    videoUrl: '',
    destinationUrl: '',
    ctaText: 'Saiba mais',
    startDate: '',
    endDate: '',
    status: 'active',
    priority: 10,
    placements: ['home', 'categories_page', 'between_movies'],
    frequencyPerSession: 3,
    maxImpressions: null,
    targetAudience: 'Todos os visitantes',
    countries: [],
    devices: ['all'],
    autoplay: true,
    startMuted: false,
    skippable: true,
    skipAfterSeconds: 5,
    durationSeconds: 15,
  };
}

const STATUS_BADGE: Record<AdStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  scheduled: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  expired: 'bg-red-500/15 text-red-300 border-red-500/25',
  draft: 'bg-white/10 text-[#A0A6B8] border-white/15',
};

const STATUS_LABEL: Record<AdStatus, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  scheduled: 'Agendado',
  expired: 'Expirado',
  draft: 'Rascunho',
};

export function AdsStudioSection({ token, mode, onNotify, onPublicDataChanged }: AdsStudioSectionProps) {
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [stats, setStats] = useState<AdStatsResponse | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | AdStatus>('all');

  // Editor state
  const [form, setForm] = useState<Partial<AdCampaign>>(createEmptyCampaign);
  const [countriesText, setCountriesText] = useState('');
  const [saving, setSaving] = useState(false);
  const [notifyUsersOnPublish, setNotifyUsersOnPublish] = useState(true);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [previewMuted, setPreviewMuted] = useState(false);
  const previewManuallyMutedRef = useRef(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Ad frequency & reappear cooldown settings
  const [pacing, setPacing] = useState<AdPacingConfig>(DEFAULT_AD_PACING);
  const [savingPacing, setSavingPacing] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'ad_stats') {
        const s = await admApi.getAdStats(token, statsPeriod);
        setStats(s);
      } else {
        const [res, pacingRes, cloudCfg, cloudAds] = await Promise.all([
          admApi.listAds(token),
          admApi.getAdPacing(token).catch(() => null),
          fetchCloudSystemConfig().catch(() => null),
          fetchCloudPublicAds(true).catch(() => []),
        ]);

        // Reconcile local + cloud campaigns without letting an older/public-only cloud snapshot overwrite a local pause
        const cloudAdminRead = isVerifiedFirebaseAdmin();
        const mergedById = new Map<string, AdCampaign>();
        for (const localAd of res.ads) {
          mergedById.set(localAd.id, localAd);
        }
        for (const cloudAd of cloudAds) {
          const existingLocal = mergedById.get(cloudAd.id);
          if (existingLocal) {
            const cloudTs = Date.parse(cloudAd.updatedAt) || 0;
            const localTs = Date.parse(existingLocal.updatedAt) || 0;
            const shouldPreferCloud = cloudAdminRead
              ? cloudTs > localTs
              : existingLocal.status === 'active'
                ? cloudTs > localTs
                : cloudTs > localTs + 5000;
            if (shouldPreferCloud) {
              mergedById.set(cloudAd.id, {
                ...existingLocal,
                name: cloudAd.name,
                title: cloudAd.title,
                description: cloudAd.description,
                format: cloudAd.format,
                mediaKind: cloudAd.mediaKind,
                imageUrl: cloudAd.imageUrl,
                videoUrl: cloudAd.videoUrl,
                destinationUrl: cloudAd.destinationUrl,
                ctaText: cloudAd.ctaText,
                status: cloudAd.status,
                priority: cloudAd.priority,
                placements: cloudAd.placements,
                devices: cloudAd.devices,
                autoplay: cloudAd.autoplay,
                startMuted: cloudAd.startMuted,
                skippable: cloudAd.skippable,
                skipAfterSeconds: cloudAd.skipAfterSeconds,
                durationSeconds: cloudAd.durationSeconds,
                frequencyPerSession: cloudAd.frequencyPerSession,
                startDate: cloudAd.startDate || existingLocal.startDate,
                endDate: cloudAd.endDate || existingLocal.endDate,
                maxImpressions: cloudAd.maxImpressions ?? existingLocal.maxImpressions,
                targetAudience: cloudAd.targetAudience || existingLocal.targetAudience,
                countries: cloudAd.countries?.length ? cloudAd.countries : existingLocal.countries,
                impressions: Math.max(existingLocal.impressions || 0, cloudAd.impressions || 0),
                clicks: Math.max(existingLocal.clicks || 0, cloudAd.clicks || 0),
                videoViews: Math.max(existingLocal.videoViews || 0, cloudAd.videoViews || 0),
                videoCompletes: Math.max(existingLocal.videoCompletes || 0, cloudAd.videoCompletes || 0),
                videoPartials: Math.max(existingLocal.videoPartials || 0, cloudAd.videoPartials || 0),
                totalWatchSeconds: Math.max(existingLocal.totalWatchSeconds || 0, cloudAd.totalWatchSeconds || 0),
                updatedAt: cloudAd.updatedAt,
              });
            }
          } else {
            mergedById.set(cloudAd.id, cloudAdToCampaignFallback(cloudAd));
          }
        }

        // Initial seed: if admin has local campaigns and Firestore publicAds is still empty, push them to cloud
        if (cloudAds.length === 0 && res.ads.length > 0 && isVerifiedFirebaseAdmin()) {
          void Promise.all(res.ads.map((ad) => upsertCloudPublicAd(ad)));
        }

        setAds(Array.from(mergedById.values()));

        if (cloudCfg) {
          setPacing({
            dismissCooldownMinutes: cloudCfg.dismissCooldownMinutes,
            largeAdIntervalMinutes: cloudCfg.largeAdIntervalMinutes,
            playerAdIntervalMinutes: cloudCfg.playerAdIntervalMinutes,
            headerAdAlwaysVisible: cloudCfg.headerAdAlwaysVisible,
          });
        } else if (pacingRes?.pacing) {
          setPacing(pacingRes.pacing);
        }
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar dados do MOVIX ADS.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, mode, statsPeriod, onNotify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const vid = previewVideoRef.current;
    if (!vid || form.mediaKind !== 'video' || !form.videoUrl) return;
    return startAdVideoWithSound(vid, {
      adId: form.id,
      autoplay: form.autoplay !== false,
      onMutedStateChange: setPreviewMuted,
      isManuallyMuted: () => previewManuallyMutedRef.current,
    });
  }, [form.id, form.mediaKind, form.videoUrl, form.autoplay]);

  const handleSavePacing = async () => {
    setSavingPacing(true);
    try {
      const res = await admApi.updateAdPacing(token, {
        dismissCooldownMinutes: Math.max(1, Math.min(1440, Math.round(Number(pacing.dismissCooldownMinutes) || 30))),
        largeAdIntervalMinutes: Math.max(0, Math.min(1440, Math.round(Number(pacing.largeAdIntervalMinutes) || 0))),
        playerAdIntervalMinutes: Math.max(0, Math.min(1440, Math.round(Number(pacing.playerAdIntervalMinutes) || 0))),
        headerAdAlwaysVisible: Boolean(pacing.headerAdAlwaysVisible),
      });
      const synced = await upsertCloudSystemConfig({
        dismissCooldownMinutes: res.pacing.dismissCooldownMinutes,
        largeAdIntervalMinutes: res.pacing.largeAdIntervalMinutes,
        playerAdIntervalMinutes: res.pacing.playerAdIntervalMinutes,
        headerAdAlwaysVisible: res.pacing.headerAdAlwaysVisible,
      });
      setPacing(res.pacing);
      onNotify(
        synced
          ? 'Frequência e tempo de reaparição sincronizados em tempo real em todos os dispositivos!'
          : 'Frequência guardada localmente. Clique em "Sincronizar Nuvem" para aplicar em todos os dispositivos.'
      );
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar frequência dos anúncios.', 'error');
    } finally {
      setSavingPacing(false);
    }
  };

  const loadIntoStudio = (ad: AdCampaign) => {
    setForm({ ...ad });
    setCountriesText((ad.countries || []).join(', '));
  };

  const handleFormatChange = (format: AdFormatType) => {
    const info = AD_FORMAT_OPTIONS.find((o) => o.value === format);
    const mediaKind = info?.kind || 'image';
    let placements = form.placements || ['home'];
    if (format === 'pre_roll') placements = ['before_player'];
    if (format === 'mid_roll') placements = ['during_playback'];
    if (format === 'post_roll') placements = ['after_playback'];
    setForm({ ...form, format, mediaKind, placements });
  };

  const togglePlacement = (p: AdPlacement) => {
    const cur = form.placements || [];
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
    setForm({ ...form, placements: next.length > 0 ? next : [p] });
  };

  const toggleDevice = (d: AdDeviceTarget) => {
    if (d === 'all') {
      setForm({ ...form, devices: ['all'] });
      return;
    }
    const cur = (form.devices || []).filter((x) => x !== 'all');
    const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
    setForm({ ...form, devices: next.length > 0 ? next : ['all'] });
  };

  const handleSaveAd = async (publishStatus: 'active' | 'draft' | 'paused') => {
    if (!form.name?.trim()) {
      onNotify('Dê um nome à campanha antes de guardar.', 'error');
      return;
    }
    if (form.mediaKind === 'video' && !form.videoUrl?.trim()) {
      onNotify('Carregue um vídeo (.mp4 ou .webm) ou indique o link do vídeo.', 'error');
      return;
    }
    if (form.mediaKind === 'image' && !form.imageUrl?.trim() && !form.title?.trim()) {
      onNotify('Adicione uma imagem ou um título para o anúncio.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<AdCampaign> & { notifyUsers?: boolean } = {
        ...form,
        status: publishStatus,
        notifyUsers: publishStatus === 'active' ? notifyUsersOnPublish : false,
        countries: countriesText
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
      };
      let savedAd: AdCampaign;
      let notif: {
        sent: boolean;
        campaignId?: string;
        targetedCount: number;
        successCount: number;
        note?: string;
      } | null | undefined = null;

      if (form.id) {
        try {
          const res = await admApi.updateAd(token, form.id, payload);
          savedAd = res.ad;
          notif = res.notification;
        } catch {
          // Campaign may originate from another environment via Firestore; mirror locally keeping the exact same id
          const created = await admApi.createAd(token, { ...payload, id: form.id });
          savedAd = { ...created.ad, id: form.id };
          notif = created.notification;
        }
      } else {
        const res = await admApi.createAd(token, payload);
        savedAd = res.ad;
        notif = res.notification;
      }

      syncLocalCloudActiveAdCache(savedAd);
      const syncedCloud = await upsertCloudPublicAd(savedAd);

      if (publishStatus === 'active') {
        if (notif?.sent) {
          onNotify(
            syncedCloud
              ? notif.targetedCount > 0
                ? `Anúncio publicado na nuvem permanente e notificação enviada (${notif.successCount}/${notif.targetedCount} dispositivos)!`
                : 'Anúncio publicado na nuvem permanente e alerta registado na central de notificações!'
              : 'Anúncio publicado localmente. Clique em "Ativar Backup Permanente" no topo para mantê-lo após atualizações!'
          );
        } else {
          onNotify(
            syncedCloud
              ? form.id
                ? 'Anúncio atualizado e guardado permanentemente na nuvem!'
                : 'Campanha publicada e guardada permanentemente na nuvem!'
              : 'Guardado apenas localmente. Clique em "Ativar Backup Permanente" no topo para não perder após atualizações!'
          );
        }
      } else if (publishStatus === 'paused') {
        onNotify(
          syncedCloud
            ? 'Campanha pausada permanentemente em todos os dispositivos — não será exibida no site.'
            : 'Campanha pausada neste servidor (oculta do site). Ative o Backup Permanente no topo para pausar também na nuvem.'
        );
      } else {
        onNotify(
          syncedCloud
            ? form.id
              ? 'Rascunho guardado permanentemente na nuvem.'
              : 'Rascunho criado e guardado na nuvem.'
            : 'Rascunho guardado localmente. Ative o Backup Permanente no topo para guardar na nuvem.'
        );
      }

      setForm(createEmptyCampaign());
      setCountriesText('');
      await loadAll();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar campanha.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatus = async (ad: AdCampaign, nextStatus: AdStatus) => {
    try {
      let updatedAd: AdCampaign = { ...ad, status: nextStatus, updatedAt: new Date().toISOString() };
      let notif: {
        sent: boolean;
        targetedCount: number;
        successCount: number;
      } | null | undefined = null;

      try {
        const res = await admApi.updateAd(token, ad.id, {
          status: nextStatus,
          notifyUsers: nextStatus === 'active',
        });
        updatedAd = res.ad;
        notif = res.notification;
      } catch {
        // Cloud-synced ad not yet on this container's local disk; create locally with exact same id & status so server also enforces pause
        try {
          const created = await admApi.createAd(token, {
            ...ad,
            id: ad.id,
            status: nextStatus,
            notifyUsers: nextStatus === 'active',
          });
          updatedAd = { ...created.ad, id: ad.id, status: nextStatus };
          notif = created.notification;
        } catch {
          // Proceed with Firestore update
        }
      }

      syncLocalCloudActiveAdCache(updatedAd);
      setAds((prev) => prev.map((item) => (item.id === ad.id ? updatedAd : item)));
      const syncedCloud = await upsertCloudPublicAd(updatedAd);

      if (nextStatus === 'active' && notif?.sent) {
        onNotify(
          notif.targetedCount > 0
            ? `Campanha "${ad.name}" publicada e notificação enviada (${notif.successCount}/${notif.targetedCount} dispositivos)!`
            : `Campanha "${ad.name}" publicada e notificação emitida aos utilizadores!`
        );
      } else if (nextStatus === 'paused') {
        onNotify(
          syncedCloud
            ? `Campanha "${ad.name}" pausada em todos os dispositivos — não aparecerá no site.`
            : `Campanha "${ad.name}" pausada e oculta neste site. Ligue o Backup Permanente no topo para sincronizar na nuvem.`
        );
      } else {
        onNotify(
          syncedCloud
            ? `Campanha "${ad.name}" marcada como ${STATUS_LABEL[nextStatus]} em todos os dispositivos.`
            : `Campanha "${ad.name}" marcada como ${STATUS_LABEL[nextStatus]} localmente.`
        );
      }
      await loadAll();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao alterar estado.', 'error');
    }
  };

  const handleDeleteAd = async (ad: AdCampaign) => {
    if (!window.confirm(`Eliminar permanentemente a campanha "${ad.name}"?`)) return;
    try {
      removeLocalCloudActiveAdCache(ad.id);
      await Promise.all([
        admApi.deleteAd(token, ad.id).catch(() => null),
        deleteCloudPublicAd(ad.id),
      ]);
      onNotify('Campanha eliminada em todos os dispositivos.');
      if (form.id === ad.id) setForm(createEmptyCampaign());
      await loadAll();
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao eliminar campanha.', 'error');
    }
  };

  // ===================== MODE 3: AD STATISTICS =====================
  if (mode === 'ad_stats') {
    const s = stats?.summary;
    const dev = stats?.deviceTotals;
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Estatísticas Publicitárias — MOVIX ADS</h1>
            <p className="text-xs sm:text-sm text-[#8D97AF]">
              Métricas reais de impressões, cliques, CTR, retenção de vídeo e desempenho por dispositivo.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setStatsPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                  statsPeriod === p
                    ? 'bg-[#E5B85A] text-[#06070B] border-[#E5B85A]'
                    : 'bg-[#0B0E17] text-[#A0A6B8] border-white/10'
                }`}
              >
                {p === '7d' ? '7 Dias' : p === '30d' ? '30 Dias' : '90 Dias'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Impressões Totais', value: (s?.totalImpressions ?? 0).toLocaleString('pt-PT') },
            { label: 'Cliques Totais', value: (s?.totalClicks ?? 0).toLocaleString('pt-PT') },
            { label: 'CTR Global', value: `${s?.ctr ?? 0}%` },
            { label: 'Campanhas Ativas', value: String(s?.activeCampaigns ?? 0) },
            { label: 'Views de Vídeo', value: (s?.totalVideoViews ?? 0).toLocaleString('pt-PT') },
            { label: 'Vídeos Completos', value: (s?.totalVideoCompletes ?? 0).toLocaleString('pt-PT') },
            { label: 'Views Parciais', value: (s?.totalVideoPartials ?? 0).toLocaleString('pt-PT') },
            { label: 'Tempo Médio Vídeo', value: `${s?.avgWatchSeconds ?? 0}s` },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4">
              <div className="text-[11px] text-[#8D97AF]">{k.label}</div>
              <div className="text-xl font-bold text-white mt-1.5">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <AdmAreaChart
              title="Impressões vs. Cliques por Dia"
              subtitle="Evolução diária real de entrega publicitária"
              data={(stats?.timeline || []).map((t) => ({
                label: t.date.slice(5),
                value: t.impressions,
                secondaryValue: t.clicks,
              }))}
              color="#E5B85A"
              secondaryColor="#34D399"
              primaryLabel="Impressões"
              secondaryLabel="Cliques"
            />
          </div>
          <AdmDonutChart
            title="Impressões por Dispositivo"
            subtitle="Desktop, Mobile e Tablet"
            segments={[
              { label: 'Mobile', value: dev?.mobile.impressions ?? 0, color: '#E5B85A' },
              { label: 'Desktop', value: dev?.desktop.impressions ?? 0, color: '#38BDF8' },
              { label: 'Tablet', value: dev?.tablet.impressions ?? 0, color: '#A78BFA' },
            ]}
          />
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#E5B85A]" />
            <h3 className="text-sm font-semibold text-white">Desempenho por Campanha</h3>
          </div>
          {(stats?.campaigns || []).length === 0 ? (
            <p className="text-xs text-[#6E778E] py-6 text-center">Sem campanhas registadas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[#8D97AF]">
                    <th className="py-2 pr-3">Campanha</th>
                    <th className="py-2 px-2">Tipo</th>
                    <th className="py-2 px-2">Estado</th>
                    <th className="py-2 px-2 text-right">Impressões</th>
                    <th className="py-2 px-2 text-right">Cliques</th>
                    <th className="py-2 px-2 text-right">CTR</th>
                    <th className="py-2 px-2 text-right">Views Vídeo</th>
                    <th className="py-2 pl-2 text-right">Tempo Médio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {stats!.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 pr-3 font-semibold text-white">{c.name}</td>
                      <td className="py-2.5 px-2 text-[#A0A6B8]">{c.mediaKind === 'video' ? 'Vídeo' : 'Imagem'}</td>
                      <td className="py-2.5 px-2">
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${STATUS_BADGE[c.status]}`}>
                          {STATUS_LABEL[c.status]}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right text-white">{c.impressions.toLocaleString('pt-PT')}</td>
                      <td className="py-2.5 px-2 text-right text-white">{c.clicks.toLocaleString('pt-PT')}</td>
                      <td className="py-2.5 px-2 text-right font-semibold text-[#E5B85A]">{c.ctr}%</td>
                      <td className="py-2.5 px-2 text-right text-[#D4D9E6]">{c.videoViews.toLocaleString('pt-PT')}</td>
                      <td className="py-2.5 pl-2 text-right text-[#D4D9E6]">{c.avgWatchSeconds}s</td>
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

  // ===================== MODE 2: CAMPAIGNS LIST =====================
  const filteredAds = ads.filter((a) => statusFilter === 'all' || a.status === statusFilter);

  const campaignsTable = (
    <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'active', 'paused', 'scheduled', 'draft', 'expired'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                statusFilter === st
                  ? 'bg-[#E5B85A]/15 text-[#F4CB73] border-[#E5B85A]/35'
                  : 'bg-[#07090F] text-[#8D97AF] border-white/10'
              }`}
            >
              {st === 'all' ? `Todas (${ads.length})` : STATUS_LABEL[st]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-xs text-[#8D97AF]">
          <Loader2 className="w-4 h-4 animate-spin text-[#E5B85A]" /> A carregar campanhas...
        </div>
      ) : filteredAds.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6E778E]">
          Nenhuma campanha neste estado. Utilize o estúdio MOVIX ADS para criar anúncios de imagem ou vídeo.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-white/[0.06] text-[#8D97AF]">
                <th className="py-2.5 pr-3">Campanha</th>
                <th className="py-2.5 px-2">Formato / Locais</th>
                <th className="py-2.5 px-2">Estado</th>
                <th className="py-2.5 px-2 text-right">Imp. / Cliques</th>
                <th className="py-2.5 pl-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {filteredAds.map((ad) => (
                <tr key={ad.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-3">
                      {ad.mediaKind === 'video' && ad.videoUrl ? (
                        <div className="w-14 h-10 rounded bg-black border border-white/10 flex items-center justify-center shrink-0">
                          <Film className="w-4 h-4 text-[#E5B85A]" />
                        </div>
                      ) : ad.imageUrl ? (
                        <img src={ad.imageUrl} alt={ad.name} className="w-14 h-10 rounded object-cover bg-black shrink-0" />
                      ) : (
                        <div className="w-14 h-10 rounded bg-white/5 flex items-center justify-center shrink-0">
                          <Megaphone className="w-4 h-4 text-[#6E778E]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate max-w-[200px]">{ad.name}</p>
                        <p className="text-[11px] text-[#8D97AF] truncate max-w-[220px]">{ad.title || 'Sem título público'}</p>
                        {ad.destinationUrl ? (
                          <p className="text-[10px] text-[#E5B85A]/90 truncate max-w-[220px]">{ad.destinationUrl}</p>
                        ) : (
                          <p className="text-[10px] text-amber-400/80">Sem link de destino</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <div className="text-[#D4D9E6]">
                      {AD_FORMAT_OPTIONS.find((f) => f.value === ad.format)?.label || ad.format}
                    </div>
                    <div className="text-[10px] text-[#7D879F] truncate max-w-[200px]">
                      {ad.placements.map((p) => AD_PLACEMENT_OPTIONS.find((o) => o.value === p)?.label || p).join(', ')}
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${STATUS_BADGE[ad.status]}`}>
                      {STATUS_LABEL[ad.status]}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right whitespace-nowrap text-[#D4D9E6]">
                    {ad.impressions.toLocaleString('pt-PT')} / <strong className="text-white">{ad.clicks.toLocaleString('pt-PT')}</strong>
                  </td>
                  <td className="py-3 pl-2 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          loadIntoStudio(ad);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-1.5 rounded-lg bg-white/5 text-[#D4D9E6] hover:text-[#E5B85A] cursor-pointer"
                        title="Editar"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleQuickStatus(ad, ad.status === 'active' ? 'paused' : 'active')}
                        className="p-1.5 rounded-lg bg-white/5 text-[#D4D9E6] hover:text-emerald-400 cursor-pointer"
                        title={ad.status === 'active' ? 'Pausar' : 'Ativar'}
                      >
                        {ad.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAd(ad)}
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
  );

  const pacingControlsCard = (
    <div className="rounded-xl border border-[#E5B85A]/25 bg-[#0B0E17] p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-[#E5B85A]/12 border border-[#E5B85A]/30 flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="w-4 h-4 text-[#E5B85A]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Tempo de Reaparição dos Anúncios</h2>
            <p className="text-[11px] sm:text-xs text-[#8D97AF] mt-0.5">
              Os anúncios aparecem sempre assim que alguém entra no app. Só quando o utilizador remove um anúncio manualmente é que ele aguarda o tempo definido abaixo. O anúncio pequeno do topo aparece sempre com frequência e em silêncio.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={savingPacing}
          onClick={() => void handleSavePacing()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] disabled:opacity-60 cursor-pointer shrink-0 self-start sm:self-center"
        >
          {savingPacing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Guardar Frequência
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {/* 1. Dismiss Cooldown */}
        <div className="rounded-lg bg-[#07090F] border border-white/[0.08] p-3 space-y-2">
          <label className="block text-xs font-medium text-[#D4D9E6]">
            Reaparecer após remover anúncio grande (min)
          </label>
          <input
            type="number"
            min={1}
            max={1440}
            value={pacing.dismissCooldownMinutes}
            onChange={(e) =>
              setPacing((prev) => ({
                ...prev,
                dismissCooldownMinutes: Math.max(1, Number(e.target.value) || 1),
              }))
            }
            className="w-full rounded-lg bg-[#0B0E17] border border-white/10 px-3 py-1.5 text-xs text-white"
          />
          <div className="flex flex-wrap gap-1.5">
            {[15, 30, 60, 120].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => setPacing((prev) => ({ ...prev, dismissCooldownMinutes: min }))}
                className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                  pacing.dismissCooldownMinutes === min
                    ? 'bg-[#E5B85A]/20 border-[#E5B85A]/50 text-[#F4CB73] font-semibold'
                    : 'bg-white/[0.03] border-white/10 text-[#8D97AF] hover:text-white'
                }`}
              >
                {min} min
              </button>
            ))}
          </div>
        </div>

        {/* 2. Large Ad Interval */}
        <div className="rounded-lg bg-[#07090F] border border-white/[0.08] p-3 space-y-2">
          <label className="block text-xs font-medium text-[#D4D9E6]">
            Intervalo entre anúncios grandes (min)
          </label>
          <input
            type="number"
            min={0}
            max={1440}
            value={pacing.largeAdIntervalMinutes}
            onChange={(e) =>
              setPacing((prev) => ({
                ...prev,
                largeAdIntervalMinutes: Math.max(0, Number(e.target.value) || 0),
              }))
            }
            className="w-full rounded-lg bg-[#0B0E17] border border-white/10 px-3 py-1.5 text-xs text-white"
          />
          <div className="flex flex-wrap gap-1.5">
            {[0, 10, 15, 30, 60].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => setPacing((prev) => ({ ...prev, largeAdIntervalMinutes: min }))}
                className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                  pacing.largeAdIntervalMinutes === min
                    ? 'bg-[#E5B85A]/20 border-[#E5B85A]/50 text-[#F4CB73] font-semibold'
                    : 'bg-white/[0.03] border-white/10 text-[#8D97AF] hover:text-white'
                }`}
              >
                {min === 0 ? 'Sem espera' : `${min} min`}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Player Ad Interval */}
        <div className="rounded-lg bg-[#07090F] border border-white/[0.08] p-3 space-y-2">
          <label className="block text-xs font-medium text-[#D4D9E6]">
            Intervalo entre anúncios no Player (min)
          </label>
          <input
            type="number"
            min={0}
            max={1440}
            value={pacing.playerAdIntervalMinutes}
            onChange={(e) =>
              setPacing((prev) => ({
                ...prev,
                playerAdIntervalMinutes: Math.max(0, Number(e.target.value) || 0),
              }))
            }
            className="w-full rounded-lg bg-[#0B0E17] border border-white/10 px-3 py-1.5 text-xs text-white"
          />
          <div className="flex flex-wrap gap-1.5">
            {[0, 10, 20, 45].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => setPacing((prev) => ({ ...prev, playerAdIntervalMinutes: min }))}
                className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                  pacing.playerAdIntervalMinutes === min
                    ? 'bg-[#E5B85A]/20 border-[#E5B85A]/50 text-[#F4CB73] font-semibold'
                    : 'bg-white/[0.03] border-white/10 text-[#8D97AF] hover:text-white'
                }`}
              >
                {min === 0 ? 'Sempre' : `${min} min`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2.5 text-xs text-[#D4D9E6] cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          checked={pacing.headerAdAlwaysVisible}
          onChange={(e) => setPacing((prev) => ({ ...prev, headerAdAlwaysVisible: e.target.checked }))}
          className="accent-[#E5B85A] h-4 w-4 mt-0.5 cursor-pointer shrink-0"
        />
        <span>
          <strong className="text-white font-semibold">Anúncio pequeno do topo sempre visível</strong>
          <span className="block text-[11px] text-[#8D97AF]">
            Quando ativo, o banner compacto do cabeçalho aparece sempre e não entra no tempo de espera — apenas os anúncios grandes e do player aguardam.
          </span>
        </span>
      </label>
    </div>
  );

  if (mode === 'campaigns' && !form.id) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Gestão de Campanhas</h1>
            <p className="text-xs sm:text-sm text-[#8D97AF]">
              Controle campanhas ativas, pausadas, agendadas, rascunhos e expiradas em tempo real.
            </p>
          </div>
        </div>
        {pacingControlsCard}
        {campaignsTable}
      </div>
    );
  }

  // ===================== MODE 1: FULL MOVIX ADS STUDIO =====================
  const isVideoAd = form.mediaKind === 'video';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">
            {form.id ? `MOVIX ADS — Editar: ${form.name}` : 'MOVIX ADS — Estúdio Publicitário'}
          </h1>
          <p className="text-xs sm:text-sm text-[#8D97AF]">
            Crie, carregue imagens ou vídeos, pré-visualize em Desktop e Mobile e publique diretamente no MOVIX.
          </p>
        </div>
        {form.id && (
          <button
            type="button"
            onClick={() => {
              setForm(createEmptyCampaign());
              setCountriesText('');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white/5 text-white border border-white/10 hover:bg-white/10 cursor-pointer self-start"
          >
            <Plus className="w-3.5 h-3.5" /> Nova Campanha
          </button>
        )}
      </div>

      {pacingControlsCard}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: Complete Campaign Form */}
        <div className="xl:col-span-7 space-y-5 rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5">
          {/* Basic Info */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">1. Identificação e Formato</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Nome da Campanha (Interno) *</label>
                <input
                  type="text"
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Campanha Lançamento Verão"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Formato do Anúncio</label>
                <select
                  value={form.format || 'banner_horizontal'}
                  onChange={(e) => handleFormatChange(e.target.value as AdFormatType)}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                >
                  {AD_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Título Público do Anúncio</label>
                <input
                  type="text"
                  value={form.title || ''}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Título exibido ao visitante"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[#D4D9E6] mb-1">Texto do Botão (CTA)</label>
                <input
                  type="text"
                  value={form.ctaText || ''}
                  onChange={(e) => setForm({ ...form, ctaText: e.target.value })}
                  placeholder="Ex: Saiba mais, Visitar oferta"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Descrição</label>
              <textarea
                rows={2}
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Breve descrição persuasiva do anúncio..."
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-[#D4D9E6] mb-1">Link de Destino (clicável na imagem, vídeo e botão)</label>
              <input
                type="text"
                inputMode="url"
                value={form.destinationUrl || ''}
                onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })}
                placeholder="https://exemplo.com/promocao ou www.exemplo.com"
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
              />
              <p className="text-[10px] text-[#7D879F] mt-1">
                Ao tocar na imagem, vídeo ou botão do anúncio, o utilizador será direcionado automaticamente para este link.
              </p>
            </div>
          </div>

          {/* Media Upload */}
          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">2. Criativo (Upload Direto)</h2>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, mediaKind: 'image' })}
                  className={`px-3 py-1 cursor-pointer ${!isVideoAd ? 'bg-[#E5B85A] text-[#06070B] font-semibold' : 'bg-[#07090F] text-[#8D97AF]'}`}
                >
                  Imagem
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, mediaKind: 'video' })}
                  className={`px-3 py-1 cursor-pointer ${isVideoAd ? 'bg-[#E5B85A] text-[#06070B] font-semibold' : 'bg-[#07090F] text-[#8D97AF]'}`}
                >
                  Vídeo
                </button>
              </div>
            </div>

            {isVideoAd ? (
              <>
                <MediaUploadField
                  token={token}
                  label="Ficheiro de Vídeo (MP4 ou WEBM · máx. 50 MB)"
                  value={form.videoUrl || ''}
                  onChange={(url) => setForm({ ...form, videoUrl: url })}
                  folder="ads-videos"
                  kind="video"
                  hint="Suporta reprodução progressiva em streaming (Range 206) em Desktop e Mobile."
                />
                <MediaUploadField
                  token={token}
                  label="Capa / Poster do Vídeo (Opcional)"
                  value={form.imageUrl || ''}
                  onChange={(url) => setForm({ ...form, imageUrl: url })}
                  folder="ads-images"
                  kind="image"
                />
              </>
            ) : (
              <MediaUploadField
                token={token}
                label="Imagem do Anúncio (JPG, JPEG, PNG, WEBP, GIF · máx. 10 MB)"
                value={form.imageUrl || ''}
                onChange={(url) => setForm({ ...form, imageUrl: url })}
                folder="ads-images"
                kind="image"
                hint="A imagem é validada no servidor e otimizada para carregamento rápido no MOVIX."
              />
            )}

            {/* Video Ad Controls */}
            {isVideoAd && (
              <div className="p-3.5 rounded-xl bg-[#07090F] border border-white/10 space-y-3">
                <div className="text-xs font-semibold text-white">Controlos do Anúncio em Vídeo</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-[#D4D9E6] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.autoplay !== false}
                      onChange={(e) => setForm({ ...form, autoplay: e.target.checked })}
                      className="accent-[#E5B85A]"
                    />
                    Autoplay automático
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-[#D4D9E6] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.startMuted === true}
                      onChange={(e) => setForm({ ...form, startMuted: e.target.checked })}
                      className="accent-[#E5B85A]"
                    />
                    Iniciar sem som
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-[#D4D9E6] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.skippable !== false}
                      onChange={(e) => setForm({ ...form, skippable: e.target.checked })}
                      className="accent-[#E5B85A]"
                    />
                    Permitir pular
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[#8D97AF] mb-1">Pular após (segundos)</label>
                    <input
                      type="number"
                      min={3}
                      max={30}
                      value={form.skipAfterSeconds ?? 5}
                      onChange={(e) => setForm({ ...form, skipAfterSeconds: Number(e.target.value) })}
                      className="w-full rounded-lg bg-black/50 border border-white/10 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#8D97AF] mb-1">Duração máxima (segundos)</label>
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={form.durationSeconds ?? 15}
                      onChange={(e) => setForm({ ...form, durationSeconds: Number(e.target.value) })}
                      className="w-full rounded-lg bg-black/50 border border-white/10 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Placements */}
          <div className="pt-4 border-t border-white/[0.06] space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">
              3. Locais de Exibição no MOVIX ({form.placements?.length || 0} selecionados)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AD_PLACEMENT_OPTIONS.map((p) => {
                const selected = (form.placements || []).includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePlacement(p.value)}
                    className={`text-left px-3 py-2 rounded-lg text-xs border transition-colors cursor-pointer flex items-center justify-between ${
                      selected
                        ? 'bg-[#E5B85A]/15 border-[#E5B85A]/45 text-white font-medium'
                        : 'bg-[#07090F] border-white/[0.08] text-[#8D97AF] hover:text-white'
                    }`}
                  >
                    <span>{p.label}</span>
                    {p.group === 'player' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-[#E5B85A]">Player</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Schedule, Targeting & Frequency */}
          <div className="pt-4 border-t border-white/[0.06] space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">4. Agendamento, Segmentação e Limites</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Data de Início (opcional)</label>
                <input
                  type="datetime-local"
                  value={form.startDate || ''}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Data de Término (opcional)</label>
                <input
                  type="datetime-local"
                  value={form.endDate || ''}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Prioridade (1-100)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.priority ?? 10}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Frequência por sessão</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.frequencyPerSession ?? 3}
                  onChange={(e) => setForm({ ...form, frequencyPerSession: Number(e.target.value) })}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Limite de Impressões</label>
                <input
                  type="number"
                  min={0}
                  value={form.maxImpressions ?? ''}
                  onChange={(e) =>
                    setForm({ ...form, maxImpressions: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder="Ilimitado"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Público-alvo</label>
                <input
                  type="text"
                  value={form.targetAudience || ''}
                  onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                  placeholder="Ex: Fãs de ação, Todos"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8D97AF] mb-1">Países (ex: PT, BR, AO — vazio = todos)</label>
                <input
                  type="text"
                  value={countriesText}
                  onChange={(e) => setCountriesText(e.target.value)}
                  placeholder="BR, PT, AO, MZ"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#8D97AF] mb-1.5">Dispositivos Alvo</label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'all', label: 'Todos' },
                    { id: 'desktop', label: 'Desktop' },
                    { id: 'mobile', label: 'Mobile' },
                    { id: 'tablet', label: 'Tablet' },
                  ] as const
                ).map((dev) => {
                  const active = (form.devices || ['all']).includes(dev.id);
                  return (
                    <button
                      key={dev.id}
                      type="button"
                      onClick={() => toggleDevice(dev.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                        active
                          ? 'bg-[#E5B85A]/15 border-[#E5B85A]/45 text-[#F4CB73] font-semibold'
                          : 'bg-[#07090F] border-white/10 text-[#8D97AF]'
                      }`}
                    >
                      {dev.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Publish Actions */}
          <div className="pt-4 border-t border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-[#D4D9E6] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={notifyUsersOnPublish}
                onChange={(e) => setNotifyUsersOnPublish(e.target.checked)}
                className="accent-[#E5B85A] h-4 w-4 cursor-pointer"
              />
              <Bell className="w-3.5 h-3.5 text-[#E5B85A]" />
              <span>Enviar notificação aos utilizadores ao publicar</span>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {form.id && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveAd('paused')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" /> Pausar Anúncio
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveAd('draft')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-white/[0.06] text-white border border-white/15 hover:bg-white/10 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" /> Salvar Rascunho
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveAd('active')}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-xs font-bold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] cursor-pointer"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Megaphone className="w-3.5 h-3.5" />}
                Publicar Anúncio no MOVIX
              </button>
            </div>
          </div>
        </div>

        {/* Right: LIVE PREVIEW (Desktop & Mobile) */}
        <div className="xl:col-span-5 space-y-4">
          <div className="sticky top-6 rounded-xl border border-[#E5B85A]/25 bg-[#0B0E17] p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#E5B85A]" />
                <h2 className="text-sm font-semibold text-white">Pré-visualização em Tempo Real</h2>
              </div>
              <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => setPreviewViewport('desktop')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 cursor-pointer ${
                    previewViewport === 'desktop' ? 'bg-[#E5B85A] text-[#06070B] font-semibold' : 'bg-[#07090F] text-[#8D97AF]'
                  }`}
                >
                  <Monitor className="w-3 h-3" /> Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewport('mobile')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 cursor-pointer ${
                    previewViewport === 'mobile' ? 'bg-[#E5B85A] text-[#06070B] font-semibold' : 'bg-[#07090F] text-[#8D97AF]'
                  }`}
                >
                  <Smartphone className="w-3 h-3" /> Mobile
                </button>
              </div>
            </div>

            <div className="text-[11px] text-[#8D97AF] flex flex-wrap gap-1.5">
              <span>Locais:</span>
              {(form.placements || ['home']).map((p) => (
                <span key={p} className="px-2 py-0.5 rounded bg-white/[0.06] text-[#D4D9E6]">
                  {AD_PLACEMENT_OPTIONS.find((o) => o.value === p)?.label || p}
                </span>
              ))}
            </div>

            {/* Simulated MOVIX page context */}
            <div
              className={`mx-auto rounded-xl border border-white/10 bg-[#06070B] p-3 space-y-3 transition-all ${
                previewViewport === 'mobile' ? 'max-w-[330px]' : 'w-full'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-[#6E778E] pb-1.5 border-b border-white/[0.06]">
                <span className="font-bold tracking-widest text-[#E5B85A]">MOVIX</span>
                <span>Contexto da página ({previewViewport})</span>
              </div>

              {/* Full-bleed Cinema Ad Preview (clickable when destination URL is set) */}
              {(() => {
                const previewDest = resolveAdDestination(form.destinationUrl);
                const previewBody = (
                  <>
                    {isVideoAd && form.videoUrl ? (
                      <video
                        ref={previewVideoRef}
                        src={form.videoUrl}
                        poster={form.imageUrl || undefined}
                        autoPlay={form.autoplay}
                        muted
                        loop
                        playsInline
                        disablePictureInPicture
                        disableRemotePlayback
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : form.imageUrl ? (
                      <img
                        src={form.imageUrl}
                        alt="Prévia do anúncio"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(229,184,90,0.18),transparent_55%),linear-gradient(135deg,#131828_0%,#0B0E17_55%,#07090F_100%)]"
                        aria-hidden="true"
                      />
                    )}

                    <div
                      className="absolute inset-0 bg-gradient-to-r from-[#06070B]/95 via-[#06070B]/72 to-[#06070B]/20"
                      aria-hidden="true"
                    />
                    <div
                      className="absolute inset-0 bg-gradient-to-t from-[#06070B]/90 via-transparent to-transparent"
                      aria-hidden="true"
                    />

                    <div className="relative z-10 h-full min-h-[inherit] flex flex-col justify-end p-4 pr-12 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#F3C669]">
                          Patrocinado
                        </span>
                        {isVideoAd && form.skippable && (
                          <span className="text-[9px] text-[#C8D0E2]/80">· Pular em {form.skipAfterSeconds ?? 5}s</span>
                        )}
                      </div>
                      <h4 className="font-display text-sm sm:text-base font-bold text-[#F6F7FB] leading-snug line-clamp-2">
                        {form.title || form.name || 'Título do seu anúncio'}
                      </h4>
                      <p className="text-[11px] text-[#D1D7E6]/85 line-clamp-2 max-w-md">
                        {form.description || 'A descrição do anúncio aparecerá integrada ao estilo cinema do MOVIX.'}
                      </p>
                      <div className="pt-1">
                        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#06070B] shadow-[0_4px_16px_rgba(229,184,90,0.3)]">
                          {form.ctaText || 'Saiba mais'}
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </>
                );

                return (
                  <div
                    className={`relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0B0E17] shadow-[0_14px_34px_rgba(0,0,0,0.55)] ${
                      previewViewport === 'mobile' ? 'min-h-[168px]' : 'min-h-[196px]'
                    }`}
                  >
                    {previewDest ? (
                      <a
                        href={previewDest.href}
                        target={previewDest.isExternal ? '_blank' : undefined}
                        rel={previewDest.isExternal ? 'noopener noreferrer' : undefined}
                        className="block relative w-full h-full min-h-[inherit] cursor-pointer"
                      >
                        {previewBody}
                      </a>
                    ) : (
                      <div className="block relative w-full h-full min-h-[inherit]">{previewBody}</div>
                    )}

                    {isVideoAd && form.videoUrl && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewMuted((m) => {
                            const next = !m;
                            previewManuallyMutedRef.current = next;
                            setAdVideoMuted(previewVideoRef.current, next);
                            return next;
                          });
                        }}
                        className="absolute top-2.5 right-2.5 z-20 h-7 w-7 rounded-full bg-[#06070B]/70 border border-white/15 text-white flex items-center justify-center cursor-pointer"
                        aria-label={previewMuted ? 'Ativar som' : 'Silenciar'}
                      >
                        {previewMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Subtle page skeleton below */}
              <div className="grid grid-cols-3 gap-2 opacity-30 pointer-events-none">
                <div className="h-14 rounded bg-white/10" />
                <div className="h-14 rounded bg-white/10" />
                <div className="h-14 rounded bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Existing Campaigns below the Studio */}
      {campaignsTable}
    </div>
  );
}
