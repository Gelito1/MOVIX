import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clapperboard,
  Eye,
  Film,
  Layers,
  Megaphone,
  MousePointerClick,
  RefreshCw,
  Tv,
  Users,
  UserCheck,
  Video,
  TrendingUp,
  Bell,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import type { AdmOverviewResponse } from '../../types/adm';
import { AdmAreaChart, AdmBarListChart, AdmDonutChart } from '../components/AdmCharts';

interface DashboardSectionProps {
  token: string;
  onNavigateSection: (section: string) => void;
}

export function DashboardSection({ token, onNavigateSection }: DashboardSectionProps) {
  const [range, setRange] = useState<'1d' | '7d' | '30d' | '90d' | 'custom'>('30d');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<AdmOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await admApi.getOverview(token, range, fromDate, toDate);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar estatísticas.');
    } finally {
      setLoading(false);
    }
  }, [token, range, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = data?.kpis;
  const daily = data?.dailySeries || [];

  const statCards = [
    { label: 'Total de Filmes', value: kpis?.totalMovies ?? 0, sub: `${kpis?.publishedMovies ?? 0} publicados`, icon: Film, section: 'movies' },
    { label: 'Total de Séries', value: kpis?.totalSeries ?? 0, sub: `${kpis?.publishedSeries ?? 0} publicadas`, icon: Tv, section: 'series' },
    { label: 'Total de Temporadas', value: kpis?.totalSeasons ?? 0, sub: 'Organizadas', icon: Layers, section: 'seasons' },
    { label: 'Total de Episódios', value: kpis?.totalEpisodes ?? 0, sub: 'No catálogo', icon: Clapperboard, section: 'episodes' },
    { label: 'Total de Utilizadores', value: kpis?.totalUsers ?? 0, sub: 'Contas sincronizadas', icon: Users, section: 'users' },
    { label: 'Utilizadores Ativos (7d)', value: kpis?.activeUsers ?? 0, sub: 'Atividade recente', icon: UserCheck, section: 'users' },
    { label: 'Total de Visualizações', value: kpis?.totalViews ?? 0, sub: 'Reproduções reais', icon: Eye, section: 'dashboard' },
    { label: 'Visualizações de Hoje', value: kpis?.todayViews ?? 0, sub: 'Últimas 24h', icon: TrendingUp, section: 'dashboard' },
    { label: 'Anúncios Ativos', value: kpis?.activeAds ?? 0, sub: `de ${kpis?.totalAds ?? 0} campanhas`, icon: Megaphone, section: 'campaigns' },
    { label: 'Impressões Publicitárias', value: kpis?.adImpressions ?? 0, sub: 'Exibições reais', icon: Video, section: 'ad_stats' },
    { label: 'Cliques nos Anúncios', value: kpis?.adClicks ?? 0, sub: `CTR médio ${kpis?.adCtr ?? 0}%`, icon: MousePointerClick, section: 'ad_stats' },
    { label: 'Subscritores Push', value: kpis?.pushSubscribers ?? 0, sub: 'Dispositivos ativos', icon: Bell, section: 'notifications' },
  ];

  const viewsTimeline = daily.map((d) => ({
    label: d.date.slice(5),
    value: d.views,
    secondaryValue: d.movieViews,
  }));

  const usersTimeline = daily.map((d) => ({
    label: d.date.slice(5),
    value: d.activeUsers,
    secondaryValue: d.newUsers,
  }));

  const adsTimeline = daily.map((d) => ({
    label: d.date.slice(5),
    value: d.adImpressions,
    secondaryValue: d.adClicks,
  }));

  const activityTimeline = daily.map((d) => ({
    label: d.date.slice(5),
    value: d.views + d.adImpressions + d.activeUsers,
    secondaryValue: d.seriesViews,
  }));

  return (
    <div className="space-y-6">
      {/* Header & Period Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Dashboard Principal</h1>
          <p className="text-xs sm:text-sm text-[#8D97AF] mt-0.5">
            Visão geral em tempo real do catálogo, utilizadores, visualizações e campanhas MOVIX ADS.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: '1d', label: 'Hoje' },
              { id: '7d', label: '7 Dias' },
              { id: '30d', label: '30 Dias' },
              { id: '90d', label: '90 Dias' },
              { id: 'custom', label: 'Personalizado' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                range === opt.id
                  ? 'bg-[#E5B85A] text-[#06070B] border-[#E5B85A]'
                  : 'bg-[#0B0E17] text-[#A0A6B8] border-white/10 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.05] text-white border border-white/10 hover:bg-white/[0.1] cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl border border-white/10 bg-[#0B0E17]">
          <div>
            <label className="block text-[11px] text-[#8D97AF] mb-1">Data inicial</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#8D97AF] mb-1">Data final</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-1.5 text-xs text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] cursor-pointer"
          >
            Aplicar Período
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onNavigateSection(card.section)}
              className="text-left rounded-xl border border-white/[0.08] bg-[#0B0E17] hover:border-[#E5B85A]/35 p-4 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[#8D97AF]">{card.label}</span>
                <span className="p-1.5 rounded-lg bg-[#E5B85A]/10 text-[#E5B85A] group-hover:bg-[#E5B85A]/20 transition-colors">
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <div className="mt-2.5 text-2xl font-bold text-white tracking-tight">
                {card.value.toLocaleString('pt-PT')}
              </div>
              <div className="mt-1 text-[11px] text-[#6E778E]">{card.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Primary Interactive Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <AdmAreaChart
          title="Visualizações Diárias"
          subtitle="Total de reproduções registadas no MOVIX vs. filmes"
          data={viewsTimeline}
          color="#E5B85A"
          secondaryColor="#38BDF8"
          primaryLabel="Total Views"
          secondaryLabel="Filmes"
        />
        <AdmAreaChart
          title="Crescimento e Atividade de Utilizadores"
          subtitle="Utilizadores ativos e novos registos por dia"
          data={usersTimeline}
          color="#34D399"
          secondaryColor="#A78BFA"
          primaryLabel="Ativos"
          secondaryLabel="Novos"
        />
        <AdmAreaChart
          title="Desempenho dos Anúncios (MOVIX ADS)"
          subtitle="Impressões e cliques reais das campanhas ativas"
          data={adsTimeline}
          color="#F59E0B"
          secondaryColor="#F43F5E"
          primaryLabel="Impressões"
          secondaryLabel="Cliques"
        />
        <AdmAreaChart
          title="Atividade Geral da Plataforma"
          subtitle="Interações combinadas vs. visualizações de séries"
          data={activityTimeline}
          color="#60A5FA"
          secondaryColor="#E5B85A"
          primaryLabel="Atividade Total"
          secondaryLabel="Séries"
        />
      </div>

      {/* Content & Ads Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AdmBarListChart
          title="Filmes Mais Assistidos"
          subtitle="Baseado em reproduções reais"
          color="#E5B85A"
          items={(data?.topMovies || []).map((m) => ({
            label: m.title,
            value: m.views,
            hint: 'views',
          }))}
          emptyText="Ainda sem reproduções de filmes registadas."
        />

        <AdmBarListChart
          title="Séries Mais Assistidas"
          subtitle="Baseado em reproduções reais"
          color="#38BDF8"
          items={(data?.topSeries || []).map((s) => ({
            label: s.title,
            value: s.views,
            hint: 'views',
          }))}
          emptyText="Ainda sem reproduções de séries registadas."
        />

        <AdmDonutChart
          title="Distribuição do Catálogo"
          subtitle="Proporção de conteúdos administrados"
          segments={[
            { label: 'Filmes', value: kpis?.totalMovies ?? 0, color: '#E5B85A' },
            { label: 'Séries', value: kpis?.totalSeries ?? 0, color: '#38BDF8' },
            { label: 'Temporadas', value: kpis?.totalSeasons ?? 0, color: '#A78BFA' },
            { label: 'Episódios', value: kpis?.totalEpisodes ?? 0, color: '#34D399' },
          ]}
        />
      </div>

      {/* Bottom Lists: Recent Additions & Top Ads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Conteúdos Adicionados Recentemente</h3>
              <p className="text-xs text-[#8D97AF]">Últimos filmes e séries geridos no MOVIX ADM</p>
            </div>
            <Activity className="w-4 h-4 text-[#E5B85A]" />
          </div>

          {(data?.recentContent || []).length === 0 ? (
            <p className="text-xs text-[#6E778E] py-6 text-center">
              Nenhum conteúdo adicionado ainda. Importe via TMDB ou crie manualmente em Filmes/Séries.
            </p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {data!.recentContent.map((item) => (
                <div key={`${item.mediaType}-${item.id}`} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {item.posterUrl ? (
                      <img src={item.posterUrl} alt={item.title} className="w-9 h-12 rounded object-cover shrink-0 bg-black" />
                    ) : (
                      <div className="w-9 h-12 rounded bg-white/[0.05] flex items-center justify-center shrink-0 text-[#6E778E]">
                        {item.mediaType === 'tv' ? <Tv className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                      <p className="text-[11px] text-[#8D97AF]">
                        {item.mediaType === 'tv' ? 'Série' : 'Filme'} · {new Date(item.createdAt).toLocaleDateString('pt-PT')}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      item.published ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-[#A0A6B8]'
                    }`}
                  >
                    {item.published ? 'Publicado' : 'Rascunho'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Campanhas em Destaque (MOVIX ADS)</h3>
              <p className="text-xs text-[#8D97AF]">Impressões, cliques e taxa de cliques (CTR)</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateSection('ads')}
              className="text-xs font-medium text-[#E5B85A] hover:underline cursor-pointer"
            >
              Gerir Anúncios
            </button>
          </div>

          {(data?.topAds || []).length === 0 ? (
            <p className="text-xs text-[#6E778E] py-6 text-center">
              Nenhuma campanha criada ainda. Aceda a MOVIX ADS para criar o primeiro anúncio.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[#8D97AF]">
                    <th className="py-2 font-medium">Campanha</th>
                    <th className="py-2 font-medium text-right">Imp.</th>
                    <th className="py-2 font-medium text-right">Cliques</th>
                    <th className="py-2 font-medium text-right">CTR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {data!.topAds.map((ad) => (
                    <tr key={ad.id}>
                      <td className="py-2.5 pr-2 font-medium text-white truncate max-w-[180px]">{ad.name}</td>
                      <td className="py-2.5 text-right text-[#D4D9E6]">{ad.impressions.toLocaleString('pt-PT')}</td>
                      <td className="py-2.5 text-right text-[#D4D9E6]">{ad.clicks.toLocaleString('pt-PT')}</td>
                      <td className="py-2.5 text-right font-semibold text-[#E5B85A]">{ad.ctr}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
