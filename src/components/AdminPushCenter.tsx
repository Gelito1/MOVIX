import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Film,
  Flame,
  Image as ImageIcon,
  Link2,
  Loader2,
  Monitor,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Smartphone,
  Star,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { movixApi } from '../lib/api';
import type {
  MediaSummary,
  PushCampaignRecord,
  PushCategory,
  PushOverviewResponse,
} from '../types/movix';

interface AdminPushCenterProps {
  adminToken: string;
  onFeedback: (fb: { type: 'ok' | 'err'; text: string } | null) => void;
}

interface QuickTemplate {
  id: Exclude<PushCategory, 'welcome'>;
  label: string;
  shortLabel: string;
  defaultTitle: string;
  defaultBody: string;
  defaultTarget: string;
}

const PUSH_TEMPLATES: QuickTemplate[] = [
  {
    id: 'new_movies',
    label: '🎬 Novo Filme no Catálogo',
    shortLabel: 'Novo Filme',
    defaultTitle: '🎬 Novo Filme no MOVIX!',
    defaultBody: 'Acabou de chegar: [Título]! Assista agora em HD.',
    defaultTarget: '#/filmes',
  },
  {
    id: 'new_seasons',
    label: '🔥 Nova Temporada / Episódios',
    shortLabel: 'Nova Temporada',
    defaultTitle: '🔥 Novos Episódios Disponíveis!',
    defaultBody: 'A espera acabou! A nova temporada de [Série] já está disponível.',
    defaultTarget: '#/series',
  },
  {
    id: 'app_updates',
    label: '🚀 Atualização do App',
    shortLabel: 'Atualização',
    defaultTitle: '🚀 Novidades no MOVIX!',
    defaultBody: 'Novidades no Movix! Confira as melhorias de velocidade e novos recursos.',
    defaultTarget: '#/',
  },
  {
    id: 'recommendations',
    label: '⭐ Recomendação / Maratona',
    shortLabel: 'Recomendação',
    defaultTitle: '⭐ Maratona do Fim de Semana',
    defaultBody: 'Preparamos uma seleção especial de filmes e séries imperdíveis para você assistir hoje.',
    defaultTarget: '#/',
  },
];

const CATEGORY_LABELS: Record<PushCategory, string> = {
  welcome: 'Boas-vindas',
  new_movies: 'Novo Filme',
  new_seasons: 'Nova Temporada',
  app_updates: 'Atualização',
  recommendations: 'Recomendação',
};

function TemplateIcon({ id }: { id: QuickTemplate['id'] }) {
  switch (id) {
    case 'new_movies':
      return <Film className="h-4 w-4 text-[#F3C669]" />;
    case 'new_seasons':
      return <Flame className="h-4 w-4 text-orange-400" />;
    case 'app_updates':
      return <Rocket className="h-4 w-4 text-sky-400" />;
    case 'recommendations':
      return <Star className="h-4 w-4 text-amber-300" />;
  }
}

export function AdminPushCenter({ adminToken, onFeedback }: AdminPushCenterProps) {
  const [overview, setOverview] = useState<PushOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Compose state
  const [category, setCategory] = useState<Exclude<PushCategory, 'welcome'>>('new_movies');
  const [title, setTitle] = useState(PUSH_TEMPLATES[0].defaultTitle);
  const [body, setBody] = useState(PUSH_TEMPLATES[0].defaultBody);
  const [imageUrl, setImageUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState(PUSH_TEMPLATES[0].defaultTarget);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledFor, setScheduledFor] = useState('');

  // Preview device switcher
  const [previewMode, setPreviewMode] = useState<'both' | 'mobile' | 'desktop'>('both');

  // TMDB autofill picker
  const [mediaQuery, setMediaQuery] = useState('');
  const [mediaResults, setMediaResults] = useState<MediaSummary[]>([]);
  const [searchingMedia, setSearchingMedia] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await movixApi.getAdminPushOverview(adminToken);
      setOverview(data);
    } catch (err) {
      onFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar central de notificações.',
      });
    } finally {
      setLoading(false);
    }
  }, [adminToken, onFeedback]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const applyTemplate = (tpl: QuickTemplate) => {
    setCategory(tpl.id);
    setTitle(tpl.defaultTitle);
    setBody(tpl.defaultBody);
    setTargetUrl(tpl.defaultTarget);
  };

  const handleMediaSearch = async () => {
    if (mediaQuery.trim().length < 2) return;
    setSearchingMedia(true);
    try {
      const res = await movixApi.search(mediaQuery.trim(), 'multi', 1);
      setMediaResults(res.results.slice(0, 6));
    } catch {
      setMediaResults([]);
    } finally {
      setSearchingMedia(false);
    }
  };

  const autofillFromMedia = (item: MediaSummary) => {
    const isSeries = item.mediaType === 'tv';
    const nextCat: Exclude<PushCategory, 'welcome'> = isSeries ? 'new_seasons' : 'new_movies';
    setCategory(nextCat);
    setTitle(isSeries ? `🔥 Nova temporada: ${item.title}` : `🎬 Novo no catálogo: ${item.title}`);
    setBody(
      isSeries
        ? `A espera acabou! Os novos episódios de ${item.title} já estão disponíveis em HD.`
        : `Acabou de chegar: ${item.title}! Assista agora em HD no MOVIX.`
    );
    setImageUrl(item.backdropUrl || item.posterUrl || '');
    setTargetUrl(`#/${isSeries ? 'serie' : 'filme'}/${item.id}`);
    setMediaResults([]);
    setMediaQuery('');
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    onFeedback(null);
    if (!title.trim() || !body.trim()) {
      onFeedback({ type: 'err', text: 'Preencha o título e a mensagem da notificação.' });
      return;
    }
    if (scheduleMode === 'scheduled' && !scheduledFor) {
      onFeedback({ type: 'err', text: 'Selecione a data e hora do agendamento.' });
      return;
    }

    setSending(true);
    try {
      const res = await movixApi.sendAdminPushNotification(adminToken, {
        title: title.trim(),
        body: body.trim(),
        image_url: imageUrl.trim(),
        target_url: targetUrl.trim() || '#/',
        category,
        scheduled_for:
          scheduleMode === 'scheduled' && scheduledFor
            ? new Date(scheduledFor).toISOString()
            : null,
      });
      setOverview(res.overview);
      const cmp = res.campaign;
      if (cmp.status === 'scheduled') {
        onFeedback({
          type: 'ok',
          text: `Notificação agendada para ${new Date(cmp.scheduled_for || '').toLocaleString('pt-BR')}.`,
        });
      } else {
        onFeedback({
          type: cmp.failure_count > 0 && cmp.success_count === 0 ? 'err' : 'ok',
          text: cmp.note
            ? `Disparo concluído (${cmp.success_count} sucesso · ${cmp.failure_count} falhas). ${cmp.note}`
            : `Disparo concluído: ${cmp.success_count} enviadas com sucesso, ${cmp.failure_count} falhas.`,
        });
      }
      if (scheduleMode === 'scheduled') {
        setScheduledFor('');
        setScheduleMode('now');
      }
    } catch (err) {
      onFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao disparar notificação.',
      });
    } finally {
      setSending(false);
    }
  };

  const handleCancelScheduled = async (id: string) => {
    try {
      const res = await movixApi.cancelScheduledPush(adminToken, id);
      setOverview(res.overview);
      onFeedback({ type: 'ok', text: 'Notificação agendada cancelada.' });
    } catch (err) {
      onFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao cancelar agendamento.',
      });
    }
  };

  const eligibleCount = overview ? overview.categoryCounts[category] : 0;

  return (
    <div className="space-y-6">
      {/* KPI Header Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl bg-[#111318] border border-white/[0.08] p-4">
          <div className="flex items-center justify-between text-[#8E99B2]">
            <span className="text-xs font-medium">Dispositivos Inscritos</span>
            <Users className="h-4 w-4 text-[#E5B85A]" />
          </div>
          <p className="font-display text-2xl font-bold text-[#F5F5F7] mt-1.5 tabular-nums">
            {overview?.totalSubscribers ?? 0}
          </p>
          <p className="text-[11px] text-[#7D8599] mt-0.5 tabular-nums">
            {overview?.realFcmTokens ?? 0} tokens FCM ativos
          </p>
        </div>

        <div className="rounded-xl bg-[#111318] border border-white/[0.08] p-4">
          <div className="flex items-center justify-between text-[#8E99B2]">
            <span className="text-xs font-medium">Alcance da Categoria</span>
            <Bell className="h-4 w-4 text-[#E5B85A]" />
          </div>
          <p className="font-display text-2xl font-bold text-[#F3C669] mt-1.5 tabular-nums">
            {eligibleCount}
          </p>
          <p className="text-[11px] text-[#7D8599] mt-0.5 truncate">{CATEGORY_LABELS[category]}</p>
        </div>

        <div className="rounded-xl bg-[#111318] border border-white/[0.08] p-4">
          <div className="flex items-center justify-between text-[#8E99B2]">
            <span className="text-xs font-medium">Campanhas Enviadas</span>
            <Send className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="font-display text-2xl font-bold text-[#F5F5F7] mt-1.5 tabular-nums">
            {overview?.campaigns.filter((c) => c.status === 'sent').length ?? 0}
          </p>
          <p className="text-[11px] text-[#7D8599] mt-0.5 tabular-nums">
            {overview?.campaigns.filter((c) => c.status === 'scheduled').length ?? 0} agendadas
          </p>
        </div>

        <div className="rounded-xl bg-[#111318] border border-white/[0.08] p-4">
          <div className="flex items-center justify-between text-[#8E99B2]">
            <span className="text-xs font-medium">FCM HTTP v1</span>
            {overview?.fcmConfigured ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <XCircle className="h-4 w-4 text-amber-400" />
            )}
          </div>
          <p className="text-sm font-semibold text-[#F5F5F7] mt-2 truncate">
            {overview?.fcmConfigured ? 'Service Account Ativa' : 'Aguardando JSON'}
          </p>
          <p className="text-[11px] font-mono text-[#7D8599] mt-0.5 truncate">
            {overview?.fcmProjectId || 'movix-e3099'}
          </p>
        </div>
      </div>

      {/* Main Composer + Real-Time Preview Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT: Composer Form */}
        <form
          onSubmit={handleDispatch}
          className="xl:col-span-7 rounded-2xl bg-[#111318] border border-white/[0.08] p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#F5F5F7]">
                Admin Push Center
              </h2>
              <p className="text-xs text-[#949BAE] mt-0.5">
                Escolha um template rápido ou busque um filme/série do catálogo para preencher automaticamente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadOverview()}
              aria-label="Atualizar métricas"
              className="h-9 w-9 rounded-lg border border-white/10 hover:bg-white/5 text-[#C6CBD8] flex items-center justify-center cursor-pointer shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* 1. Quick Category / Template Selector */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-[#C6CBD8]">
              Categoria & Template Rápido
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PUSH_TEMPLATES.map((tpl) => {
                const active = category === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      active
                        ? 'bg-[#E5B85A]/15 border-[#E5B85A]/55 text-[#F6F7FB]'
                        : 'bg-[#08090C] border-white/[0.08] text-[#A0A6B8] hover:border-white/20 hover:text-[#F6F7FB]'
                    }`}
                  >
                    <TemplateIcon id={tpl.id} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{tpl.label}</p>
                      <p className="text-[11px] text-[#7D8599] tabular-nums">
                        {overview?.categoryCounts[tpl.id] ?? 0} inscritos
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. TMDB Quick Autofill Picker */}
          <div className="rounded-xl bg-[#08090C] border border-white/[0.07] p-3.5 space-y-2.5">
            <span className="text-xs font-medium text-[#949BAE]">
              Preencher com título do catálogo (capa + link automático)
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={mediaQuery}
                onChange={(e) => setMediaQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleMediaSearch();
                  }
                }}
                placeholder="Ex: Duna, Stranger Things, Oppenheimer..."
                className="flex-1 h-9 px-3 rounded-lg bg-[#111318] border border-white/10 text-xs text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
              />
              <button
                type="button"
                onClick={() => void handleMediaSearch()}
                className="px-3.5 h-9 rounded-lg bg-white/10 hover:bg-[#E5B85A] hover:text-[#08090C] text-xs font-semibold text-[#F5F5F7] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                {searchingMedia ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                <span>Buscar</span>
              </button>
            </div>

            {mediaResults.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {mediaResults.map((m) => (
                  <button
                    key={`${m.mediaType}-${m.id}`}
                    type="button"
                    onClick={() => autofillFromMedia(m)}
                    className="flex items-center gap-2.5 p-2 rounded-lg bg-[#111318] hover:bg-[#171B26] border border-white/[0.08] text-left cursor-pointer transition-colors"
                  >
                    {m.posterUrl ? (
                      <img
                        src={m.posterUrl}
                        alt={m.title}
                        referrerPolicy="no-referrer"
                        className="h-10 w-7 rounded object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-7 rounded bg-white/5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#F5F5F7] truncate">{m.title}</p>
                      <p className="text-[11px] text-[#7D8599]">
                        {m.mediaType === 'tv' ? 'Série' : 'Filme'} · {m.year || 'HD'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Notification Fields */}
          <div className="space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#C6CBD8]">Título da Notificação</span>
              <input
                type="text"
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: 🎬 Acabou de chegar no MOVIX!"
                className="w-full h-10 px-3.5 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#C6CBD8]">Mensagem</span>
              <textarea
                required
                rows={3}
                maxLength={320}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escreva uma chamada envolvente para o público..."
                className="w-full p-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A] resize-none"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#C6CBD8] inline-flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-[#E5B85A]" />
                  <span>URL da Imagem (Capa/Banner)</span>
                </span>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://image.tmdb.org/t/p/w780/..."
                  className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-xs font-mono text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#C6CBD8] inline-flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-[#E5B85A]" />
                  <span>Link de Destino</span>
                </span>
                <input
                  type="text"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="#/filme/12345 ou #/series"
                  className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-xs font-mono text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
                />
              </label>
            </div>
          </div>

          {/* 4. Immediate vs Scheduled Toggle */}
          <div className="pt-1 border-t border-white/[0.06] space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setScheduleMode('now')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                  scheduleMode === 'now'
                    ? 'bg-[#E5B85A]/15 border-[#E5B85A]/50 text-[#F3C669]'
                    : 'bg-[#08090C] border-white/10 text-[#949BAE]'
                }`}
              >
                <Send className="h-3.5 w-3.5" />
                <span>Disparar Agora</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode('scheduled')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer border transition-colors ${
                  scheduleMode === 'scheduled'
                    ? 'bg-[#E5B85A]/15 border-[#E5B85A]/50 text-[#F3C669]'
                    : 'bg-[#08090C] border-white/10 text-[#949BAE]'
                }`}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Agendar Envio</span>
              </button>
            </div>

            {scheduleMode === 'scheduled' && (
              <label className="block space-y-1">
                <span className="text-xs text-[#C6CBD8]">Data e Hora do Disparo</span>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="w-full sm:w-72 h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-xs text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
                />
              </label>
            )}

            <button
              type="submit"
              disabled={sending}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 h-11 rounded-xl bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#08090C] text-sm font-bold cursor-pointer disabled:opacity-60 transition-all"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : scheduleMode === 'scheduled' ? (
                <CalendarClock className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span>
                {sending
                  ? 'Enviando...'
                  : scheduleMode === 'scheduled'
                    ? `Agendar para ${eligibleCount} dispositivo(s)`
                    : `Enviar Push para ${eligibleCount} dispositivo(s)`}
              </span>
            </button>
          </div>
        </form>

        {/* RIGHT: Live Mobile & Desktop Notification Previews */}
        <div className="xl:col-span-5 rounded-2xl bg-[#111318] border border-white/[0.08] p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold text-[#F5F5F7]">
              Pré-visualização em Tempo Real
            </h3>
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#08090C] border border-white/[0.08]">
              {(
                [
                  { id: 'both', label: 'Ambos' },
                  { id: 'mobile', label: 'Celular' },
                  { id: 'desktop', label: 'Navegador' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPreviewMode(m.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                    previewMode === m.id
                      ? 'bg-[#E5B85A] text-[#08090C]'
                      : 'text-[#8E99B2] hover:text-[#F5F5F7]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile Lockscreen Preview */}
          {(previewMode === 'both' || previewMode === 'mobile') && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-[#949BAE]">
                <Smartphone className="h-3.5 w-3.5 text-[#E5B85A]" />
                <span>Celular (Tela de Bloqueio / Android & iOS)</span>
              </div>
              <div className="rounded-3xl bg-gradient-to-b from-[#0C101B] to-[#07090F] border border-white/10 p-4 space-y-3 shadow-inner">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#8E99B2] px-1">
                  <span>21:30</span>
                  <span>5G · 94%</span>
                </div>

                <div className="rounded-2xl bg-[#161B29]/95 border border-white/10 overflow-hidden shadow-xl">
                  <div className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <img
                          src="/pwa-192x192.png"
                          alt="MOVIX"
                          className="h-5 w-5 rounded-md object-cover"
                        />
                        <span className="text-[11px] font-semibold text-[#C8D0E2]">
                          MOVIX · agora
                        </span>
                      </div>
                      <span className="text-[10px] text-[#7D88A1]">
                        {CATEGORY_LABELS[category]}
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-[#F6F7FB] leading-snug">
                        {title || 'Título da notificação'}
                      </p>
                      <p className="text-[11px] text-[#B4BDCE] leading-relaxed">
                        {body || 'A mensagem da notificação aparecerá aqui.'}
                      </p>
                    </div>
                  </div>

                  {imageUrl && (
                    <div className="w-full aspect-[16/8.5] bg-[#08090C] overflow-hidden border-t border-white/[0.06]">
                      <img
                        src={imageUrl}
                        alt="Capa da notificação"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Desktop Browser Preview */}
          {(previewMode === 'both' || previewMode === 'desktop') && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-[#949BAE]">
                <Monitor className="h-3.5 w-3.5 text-[#E5B85A]" />
                <span>Navegador Desktop (Chrome / Edge / Safari)</span>
              </div>
              <div className="rounded-xl bg-[#1A1F2E] border border-white/12 shadow-2xl overflow-hidden">
                {imageUrl && (
                  <div className="w-full aspect-[16/7.5] bg-[#08090C] overflow-hidden">
                    <img
                      src={imageUrl}
                      alt="Banner desktop"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-3.5 flex items-start gap-3">
                  <img
                    src="/pwa-192x192.png"
                    alt="MOVIX"
                    className="h-10 w-10 rounded-xl object-cover shrink-0 border border-white/10"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#F6F7FB] truncate">
                        {title || 'Título da notificação'}
                      </p>
                      <span className="text-[10px] text-[#8E99B2] shrink-0">agora</span>
                    </div>
                    <p className="text-xs text-[#B8C0D2] line-clamp-2 leading-relaxed">
                      {body || 'A mensagem da notificação aparecerá aqui.'}
                    </p>
                    <p className="text-[10px] font-mono text-[#7D88A1] truncate pt-1">
                      movix · {targetUrl || '#/'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sent & Scheduled Campaign History */}
      <div className="rounded-2xl bg-[#111318] border border-white/[0.08] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-[#F5F5F7]">
              Histórico de Disparos ({overview?.campaigns.length ?? 0})
            </h3>
            <p className="text-xs text-[#949BAE]">
              Acompanhe entregas, agendamentos e tokens expirados limpos automaticamente.
            </p>
          </div>
        </div>

        {loading && !overview ? (
          <div className="py-10 flex items-center justify-center gap-2 text-xs text-[#949BAE]">
            <Loader2 className="h-4 w-4 animate-spin text-[#E5B85A]" />
            <span>Carregando histórico...</span>
          </div>
        ) : !overview || overview.campaigns.length === 0 ? (
          <div className="py-10 text-center text-sm text-[#7D8599]">
            Nenhuma notificação enviada ainda. Envie sua primeira campanha acima.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-wider text-[#7D88A1]">
                  <th className="py-2.5 pr-4">Notificação</th>
                  <th className="py-2.5 px-3">Categoria</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Entrega</th>
                  <th className="py-2.5 pl-3 text-right">Data / Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-xs">
                {overview.campaigns.map((cmp: PushCampaignRecord) => (
                  <tr key={cmp.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 pr-4 max-w-xs">
                      <div className="flex items-center gap-2.5">
                        {cmp.image_url && (
                          <img
                            src={cmp.image_url}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-9 w-14 rounded object-cover shrink-0 border border-white/10"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-[#F6F7FB] truncate">{cmp.title}</p>
                          <p className="text-[11px] text-[#8E99B2] truncate">{cmp.body}</p>
                          {cmp.note && (
                            <p className="text-[10px] text-amber-300/90 truncate mt-0.5">
                              {cmp.note}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-[#C8D0E2]">
                      {CATEGORY_LABELS[cmp.category]}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      {cmp.status === 'sent' && (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Enviada</span>
                        </span>
                      )}
                      {cmp.status === 'scheduled' && (
                        <span className="inline-flex items-center gap-1 text-[#F3C669] font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Agendada</span>
                        </span>
                      )}
                      {cmp.status === 'failed' && (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Falha</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap tabular-nums">
                      {cmp.status === 'scheduled' ? (
                        <span className="text-[#949BAE]">~{cmp.targeted_count} alvo(s)</span>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="text-emerald-400 font-semibold">
                            {cmp.success_count} ok
                          </span>
                          <span className="text-[#7D88A1]"> · </span>
                          <span className="text-rose-400 font-semibold">
                            {cmp.failure_count} falhas
                          </span>
                          {cmp.cleaned_tokens_count > 0 && (
                            <p className="text-[10px] text-[#8E99B2]">
                              {cmp.cleaned_tokens_count} token(s) limpo(s)
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right whitespace-nowrap tabular-nums text-[#8E99B2]">
                      <div className="inline-flex items-center gap-2">
                        <span>
                          {new Date(
                            cmp.sent_at || cmp.scheduled_for || cmp.created_at
                          ).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {cmp.status === 'scheduled' && (
                          <button
                            type="button"
                            onClick={() => void handleCancelScheduled(cmp.id)}
                            aria-label="Cancelar agendamento"
                            className="h-7 w-7 rounded-md border border-white/10 text-rose-400 hover:bg-rose-500/15 inline-flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
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
