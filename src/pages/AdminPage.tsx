import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { AdminPushCenter } from '../components/AdminPushCenter';
import { movixApi } from '../lib/api';
import type {
  ApiErrorLog,
  BannerItem,
  HighlightItem,
  ManagedCategory,
  MediaSummary,
  MegambdStatusReport,
} from '../types/movix';

interface AdminPageProps {
  adminToken: string | null;
  onSetAdminToken: (token: string | null) => void;
  onConfigUpdated: () => void;
  initialTab?: 'notifications';
}

export function AdminPage({ adminToken, onSetAdminToken, onConfigUpdated, initialTab }: AdminPageProps) {
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    requiresSetup: boolean;
    envPasscodeConfigured: boolean;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [tab, setTab] = useState<'apis' | 'notifications' | 'banners' | 'highlights' | 'categories' | 'env'>(
    initialTab === 'notifications' ? 'notifications' : 'apis'
  );
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (initialTab === 'notifications') {
      setTab('notifications');
    }
  }, [initialTab]);

  // Dashboard state
  const [configStatus, setConfigStatus] = useState<{
    tmdbConfigured: boolean;
    tmdbApiKeySet: boolean;
    tmdbApiKeyMasked: string;
    tmdbReadTokenSet: boolean;
    tmdbReadTokenMasked: string;
    tmdbBaseUrl: string;
    megambdConfigured: boolean;
    megambdServerUrl: string;
    megambdEmbedUrl: string;
    megambdApiKeySet: boolean;
    megambdApiKeyMasked: string;
    megambdUsernameSet: boolean;
    megambdUsernameMasked: string;
    megambdPasswordSet: boolean;
    adminEnvPasscodeSet: boolean;
    fcmServiceAccountSet?: boolean;
    fcmProjectId?: string;
  } | null>(null);

  const [megambdStatus, setMegambdStatus] = useState<MegambdStatusReport | null>(null);
  const [tmdbTestResult, setTmdbTestResult] = useState<{
    configured: boolean;
    connected: boolean;
    authMethod: string;
    message: string;
  } | null>(null);
  const [testingApis, setTestingApis] = useState(false);
  const [cacheEntries, setCacheEntries] = useState<number>(0);

  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [errorLogs, setErrorLogs] = useState<ApiErrorLog[]>([]);

  // TMDB quick picker for banners / highlights
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<MediaSummary[]>([]);
  const [searchingPicker, setSearchingPicker] = useState(false);

  // Runtime environment form
  const [envTmdbKey, setEnvTmdbKey] = useState('');
  const [envTmdbToken, setEnvTmdbToken] = useState('');
  const [envMegambdUrl, setEnvMegambdUrl] = useState('https://mgeb.space/player_api.php');
  const [envMegambdEmbedUrl, setEnvMegambdEmbedUrl] = useState('https://megaembed.com');
  const [envMegambdApiKey, setEnvMegambdApiKey] = useState('');
  const [envMegambdUser, setEnvMegambdUser] = useState('');
  const [envMegambdPass, setEnvMegambdPass] = useState('');
  const [envFirebaseSaJson, setEnvFirebaseSaJson] = useState('');
  const [newAdultPin, setNewAdultPin] = useState('');
  const [savingAdultPin, setSavingAdultPin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      setAuthLoading(true);
      try {
        const s = await movixApi.getAdminAuthStatus(adminToken || undefined);
        if (!cancelled) {
          setAuthStatus(s);
          if (!s.authenticated && adminToken) {
            onSetAdminToken(null);
          }
        }
      } catch {
        if (!cancelled) setAuthStatus({ authenticated: false, requiresSetup: false, envPasscodeConfigured: false });
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    }
    void checkAuth();
    return () => {
      cancelled = true;
    };
  }, [adminToken, onSetAdminToken]);

  const loadDashboard = async (token: string) => {
    setDashboardLoading(true);
    try {
      const data = await movixApi.getAdminDashboard(token);
      setConfigStatus(data.configStatus);
      setMegambdStatus(data.megambdStatus);
      setCacheEntries(data.cacheStats.activeEntries);
      setBanners(data.banners);
      setHighlights(data.highlights);
      setCategories(data.categories);
      setErrorLogs(data.errorLogs);
      setEnvMegambdUrl(data.configStatus.megambdServerUrl || 'https://mgeb.space/player_api.php');
      setEnvMegambdEmbedUrl(data.configStatus.megambdEmbedUrl || 'https://megaembed.com');
      if (!data.configStatus.tmdbConfigured && initialTab !== 'notifications') {
        setTab('env');
      }
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao carregar painel.' });
    } finally {
      setDashboardLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken && authStatus?.authenticated) {
      void loadDashboard(adminToken);
    }
  }, [adminToken, authStatus?.authenticated]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authStatus?.requiresSetup) {
        if (password.length < 6) {
          setAuthError('A senha deve ter pelo menos 6 caracteres.');
          return;
        }
        if (password !== confirmPassword) {
          setAuthError('As senhas não coincidem.');
          return;
        }
        const res = await movixApi.setupAdminPassword(password);
        onSetAdminToken(res.token);
        setAuthStatus({ authenticated: true, requiresSetup: false, envPasscodeConfigured: false });
      } else {
        const res = await movixApi.loginAdmin(password);
        onSetAdminToken(res.token);
        setAuthStatus((prev) => (prev ? { ...prev, authenticated: true } : null));
      }
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Falha na autenticação.');
    }
  };

  const handleTestApis = async () => {
    if (!adminToken) return;
    setTestingApis(true);
    setFeedback(null);
    try {
      const res = await movixApi.testAdminApis(adminToken);
      setTmdbTestResult(res.tmdb);
      setMegambdStatus(res.megambd);
      setErrorLogs(res.errorLogs);
      setFeedback({ type: 'ok', text: 'Diagnóstico em tempo real concluído.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Falha ao testar APIs.' });
    } finally {
      setTestingApis(false);
    }
  };

  const handlePickerSearch = async () => {
    if (pickerQuery.trim().length < 2) return;
    setSearchingPicker(true);
    try {
      const res = await movixApi.search(pickerQuery, 'multi', 1);
      setPickerResults(res.results.slice(0, 6));
    } catch {
      setPickerResults([]);
    } finally {
      setSearchingPicker(false);
    }
  };

  const addBannerFromMedia = (m: MediaSummary) => {
    const next: BannerItem = {
      id: `banner-${Date.now()}`,
      title: m.title,
      subtitle: m.overview || '',
      tmdbId: m.id,
      mediaType: m.mediaType,
      backdropUrl: m.backdropUrl || m.posterUrl || '',
      posterUrl: m.posterUrl || '',
      year: m.year,
      rating: m.rating,
      genres: [],
      active: true,
      order: banners.length + 1,
    };
    setBanners((prev) => [...prev, next]);
  };

  const addHighlightFromMedia = (m: MediaSummary) => {
    const next: HighlightItem = {
      id: `hl-${Date.now()}`,
      tmdbId: m.id,
      mediaType: m.mediaType,
      title: m.title,
      posterUrl: m.posterUrl || '',
      backdropUrl: m.backdropUrl || '',
      year: m.year,
      rating: m.rating,
      label: 'Recomendado',
      active: true,
      order: highlights.length + 1,
    };
    setHighlights((prev) => [...prev, next]);
  };

  const handleSaveBanners = async () => {
    if (!adminToken) return;
    try {
      const res = await movixApi.saveAdminBanners(adminToken, banners);
      setBanners(res.banners);
      onConfigUpdated();
      setFeedback({ type: 'ok', text: 'Banners guardados com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao guardar banners.' });
    }
  };

  const handleSaveHighlights = async () => {
    if (!adminToken) return;
    try {
      const res = await movixApi.saveAdminHighlights(adminToken, highlights);
      setHighlights(res.highlights);
      onConfigUpdated();
      setFeedback({ type: 'ok', text: 'Destaques guardados com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao guardar destaques.' });
    }
  };

  const handleSaveCategories = async () => {
    if (!adminToken) return;
    try {
      const normalized = categories.map((c, idx) => ({ ...c, order: idx + 1 }));
      const res = await movixApi.saveAdminCategories(adminToken, normalized);
      setCategories(res.categories);
      onConfigUpdated();
      setFeedback({ type: 'ok', text: 'Categorias atualizadas com sucesso.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao guardar categorias.' });
    }
  };

  const handleSaveEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setFeedback(null);
    try {
      await movixApi.saveAdminEnv(adminToken, {
        tmdbApiKey: envTmdbKey || undefined,
        tmdbReadToken: envTmdbToken || undefined,
        megambdServerUrl: envMegambdUrl || undefined,
        megambdEmbedUrl: envMegambdEmbedUrl || undefined,
        megambdApiKey: envMegambdApiKey || undefined,
        megambdUsername: envMegambdUser || undefined,
        megambdPassword: envMegambdPass || undefined,
        firebaseServiceAccountJson: envFirebaseSaJson || undefined,
      });
      setEnvTmdbKey('');
      setEnvTmdbToken('');
      setEnvMegambdApiKey('');
      setEnvMegambdUser('');
      setEnvMegambdPass('');
      setEnvFirebaseSaJson('');
      await loadDashboard(adminToken);
      onConfigUpdated();
      setFeedback({
        type: 'ok',
        text: 'Variáveis aplicadas em memória no servidor. Para persistência permanente, configure-as também nos Segredos do ambiente.',
      });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao atualizar variáveis.' });
    }
  };

  const handleSaveAdultPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminToken) return;
    setFeedback(null);
    if (newAdultPin.trim().length < 4) {
      setFeedback({ type: 'err', text: 'A senha +18 deve ter pelo menos 4 caracteres.' });
      return;
    }
    setSavingAdultPin(true);
    try {
      await movixApi.updateAdminAdultPin(adminToken, newAdultPin);
      setNewAdultPin('');
      setFeedback({ type: 'ok', text: 'Senha do Conteúdo Adulto (+18) atualizada com segurança.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao atualizar senha +18.' });
    } finally {
      setSavingAdultPin(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-3 text-sm text-[#A0A6B8]">
        <Loader2 className="h-5 w-5 animate-spin text-[#E5B85A]" />
        <span>A verificar sessão administrativa...</span>
      </div>
    );
  }

  if (!adminToken || !authStatus?.authenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 sm:py-24">
        <form
          onSubmit={handleAuthSubmit}
          className="rounded-2xl bg-[#111318] border border-white/10 p-6 sm:p-8 space-y-5"
        >
          <div className="h-12 w-12 rounded-xl bg-[#E5B85A]/15 border border-[#E5B85A]/30 flex items-center justify-center text-[#E5B85A]">
            {authStatus?.requiresSetup ? <KeyRound className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>

          <div>
            <h1 className="font-display text-2xl font-bold text-[#F5F5F7]">
              {authStatus?.requiresSetup ? 'Configurar Administrador MOVIX' : 'Painel Administrativo'}
            </h1>
            <p className="text-sm text-[#949BAE] mt-1">
              {authStatus?.requiresSetup
                ? 'Primeiro acesso: defina a senha inicial de administrador (armazenada com hash scrypt no servidor).'
                : 'Introduza a senha de administrador para gerir catálogo, banners e estado das APIs.'}
            </p>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
              {authError}
            </div>
          )}

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[#C6CBD8]">Senha de Administrador</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full h-11 px-3.5 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
              />
            </label>

            {authStatus?.requiresSetup && (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#C6CBD8]">Confirmar Senha</span>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  className="w-full h-11 px-3.5 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
                />
              </label>
            )}
          </div>

          <button
            type="submit"
            className="w-full h-11 rounded-lg bg-[#E5B85A] hover:bg-[#ECC672] text-[#08090C] text-sm font-semibold transition-colors cursor-pointer"
          >
            {authStatus?.requiresSetup ? 'Guardar e Entrar' : 'Iniciar Sessão'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#F5F5F7]">
            Painel Administrativo
          </h1>
          <p className="text-sm text-[#949BAE] mt-1">
            Gestão de banners, destaques, categorias, diagnósticos TMDB/MegamBD e variáveis seguras.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onSetAdminToken(null)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/10 text-xs font-medium text-[#D1D5E0] hover:bg-white/5 self-start cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          <span>Terminar Sessão</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-[#111318] border border-white/[0.08] self-start">
        {(
          [
            { id: 'apis', label: 'Estado das APIs' },
            { id: 'notifications', label: 'Notificações Push' },
            { id: 'banners', label: `Banners (${banners.length})` },
            { id: 'highlights', label: `Destaques (${highlights.length})` },
            { id: 'categories', label: 'Categorias' },
            { id: 'env', label: `Ambiente e Erros (${errorLogs.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              tab === t.id ? 'bg-[#E5B85A] text-[#08090C]' : 'text-[#A0A6B8] hover:text-[#F5F5F7]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-4 ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/25 text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-xs underline cursor-pointer">
            Fechar
          </button>
        </div>
      )}

      {dashboardLoading ? (
        <div className="py-16 flex items-center justify-center gap-3 text-sm text-[#A0A6B8]">
          <Loader2 className="h-5 w-5 animate-spin text-[#E5B85A]" />
          <span>A carregar dados administrativos...</span>
        </div>
      ) : (
        <>
          {/* TAB: PUSH NOTIFICATIONS CENTER */}
          {tab === 'notifications' && (
            <AdminPushCenter adminToken={adminToken} onFeedback={setFeedback} />
          )}

          {/* TAB 1: API DIAGNOSTICS */}
          {tab === 'apis' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm text-[#A0A6B8]">
                  Cache ativo em memória: <span className="font-mono tabular-nums text-[#F5F5F7]">{cacheEntries}</span>{' '}
                  entradas
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await movixApi.clearAdminCache(adminToken);
                      setCacheEntries(0);
                      setFeedback({ type: 'ok', text: `Cache limpo (${res.cleared} entradas removidas).` });
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 text-xs font-medium text-[#D1D5E0] hover:bg-white/5 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Limpar Cache</span>
                  </button>
                  <button
                    type="button"
                    disabled={testingApis}
                    onClick={handleTestApis}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5B85A] hover:bg-[#ECC672] text-[#08090C] text-xs font-semibold cursor-pointer disabled:opacity-60"
                  >
                    {testingApis ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span>Testar Conexões TMDB e MegamBD</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* TMDB Card */}
                <div className="rounded-2xl bg-[#111318] border border-white/[0.08] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-semibold text-[#F5F5F7]">API TMDB (v3)</h2>
                    {tmdbTestResult ? (
                      tmdbTestResult.connected ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Conectado ({tmdbTestResult.authMethod})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400">
                          <XCircle className="h-4 w-4" />
                          <span>Erro de Autenticação</span>
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-[#949BAE]">
                        {configStatus?.tmdbConfigured ? 'Configurado' : 'Não configurado'}
                      </span>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-xs border-t border-white/[0.06] pt-4">
                    <div>
                      <dt className="text-[#7D8599]">URL Base</dt>
                      <dd className="font-mono text-[#F5F5F7] mt-0.5 truncate">{configStatus?.tmdbBaseUrl}</dd>
                    </div>
                    <div>
                      <dt className="text-[#7D8599]">Bearer Token</dt>
                      <dd className="font-mono text-[#F5F5F7] mt-0.5">
                        {configStatus?.tmdbReadTokenSet ? configStatus.tmdbReadTokenMasked : 'Não definido'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#7D8599]">API Key</dt>
                      <dd className="font-mono text-[#F5F5F7] mt-0.5">
                        {configStatus?.tmdbApiKeySet ? configStatus.tmdbApiKeyMasked : 'Não definido'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#7D8599]">Idioma</dt>
                      <dd className="font-mono text-[#F5F5F7] mt-0.5">pt-PT (fallback pt-BR)</dd>
                    </div>
                  </dl>

                  {tmdbTestResult && (
                    <p className="text-xs text-[#A0A6B8] border-t border-white/[0.06] pt-3">
                      {tmdbTestResult.message}
                    </p>
                  )}
                </div>

                {/* MegamBD Card */}
                <div className="rounded-2xl bg-[#111318] border border-white/[0.08] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-semibold text-[#F5F5F7]">
                      Servidor MegamBD (mgeb.space)
                    </h2>
                    {megambdStatus?.authValid ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Ativo ({megambdStatus.accountStatus})</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                        <AlertTriangle className="h-4 w-4" />
                        <span>{megambdStatus?.accountStatus || 'Indisponível'}</span>
                      </span>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-xs border-t border-white/[0.06] pt-4">
                    <div>
                      <dt className="text-[#7D8599]">Servidor Exclusivo</dt>
                      <dd className="font-mono text-[#F5F5F7] mt-0.5">{megambdStatus?.serverHost || 'mgeb.space'}</dd>
                    </div>
                    <div>
                      <dt className="text-[#7D8599]">Utilizador</dt>
                      <dd className="font-mono text-[#F5F5F7] mt-0.5">
                        {configStatus?.megambdUsernameSet ? configStatus.megambdUsernameMasked : 'Não definido'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#7D8599]">Conexões</dt>
                      <dd className="font-mono tabular-nums text-[#F5F5F7] mt-0.5">
                        {megambdStatus?.activeConnections ?? '—'} / {megambdStatus?.maxConnections ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#7D8599]">Categorias Carregadas</dt>
                      <dd className="font-mono tabular-nums text-[#F5F5F7] mt-0.5">
                        VOD: {megambdStatus?.vodCategoriesCount ?? 0} · Séries:{' '}
                        {megambdStatus?.seriesCategoriesCount ?? 0}
                      </dd>
                    </div>
                  </dl>

                  {megambdStatus?.message && (
                    <p className="text-xs text-[#A0A6B8] border-t border-white/[0.06] pt-3">
                      {megambdStatus.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: BANNERS */}
          {tab === 'banners' && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-[#111318] border border-white/[0.08] p-5 space-y-4">
                <h2 className="font-display text-base font-semibold text-[#F5F5F7]">
                  Adicionar Banner a partir do Catálogo TMDB
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Pesquisar filme ou série para adicionar ao banner..."
                    className="flex-1 h-10 px-3.5 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                  />
                  <button
                    type="button"
                    onClick={handlePickerSearch}
                    className="px-4 h-10 rounded-lg bg-[#E5B85A] text-[#08090C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {searchingPicker ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    <span>Procurar</span>
                  </button>
                </div>

                {pickerResults.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {pickerResults.map((m) => (
                      <div
                        key={`${m.mediaType}-${m.id}`}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#08090C] border border-white/10"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#F5F5F7] truncate">{m.title}</p>
                          <p className="text-xs text-[#7D8599] tabular-nums">
                            {m.mediaType === 'tv' ? 'Série' : 'Filme'} · {m.year}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addBannerFromMedia(m)}
                          className="px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-[#E5B85A] hover:text-[#08090C] text-xs font-medium shrink-0 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5 inline mr-1" />
                          Banner
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold text-[#F5F5F7]">
                    Banners Configurados ({banners.length})
                  </h3>
                  <button
                    type="button"
                    onClick={handleSaveBanners}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E5B85A] text-[#08090C] text-xs font-semibold cursor-pointer"
                  >
                    <Save className="h-4 w-4" />
                    <span>Guardar Banners</span>
                  </button>
                </div>

                {banners.length === 0 ? (
                  <p className="text-sm text-[#7D8599] py-6">
                    Nenhum banner personalizado definido. A página inicial utiliza automaticamente os destaques do TMDB.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {banners.map((b, idx) => (
                      <div
                        key={b.id}
                        className="p-4 rounded-xl bg-[#111318] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            type="text"
                            value={b.title}
                            onChange={(e) =>
                              setBanners((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x))
                              )
                            }
                            className="w-full h-9 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm font-semibold text-[#F5F5F7]"
                          />
                          <input
                            type="text"
                            value={b.subtitle}
                            onChange={(e) =>
                              setBanners((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, subtitle: e.target.value } : x))
                              )
                            }
                            placeholder="Descrição do banner..."
                            className="w-full h-9 px-3 rounded-lg bg-[#08090C] border border-white/10 text-xs text-[#A0A6B8]"
                          />
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setBanners((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, active: !x.active } : x))
                              )
                            }
                            className={`px-3 py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                              b.active
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                : 'bg-white/5 border-white/10 text-[#949BAE]'
                            }`}
                          >
                            {b.active ? 'Ativo' : 'Oculto'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setBanners((prev) => prev.filter((_, i) => i !== idx))}
                            aria-label="Remover banner"
                            className="h-9 w-9 rounded-lg border border-white/10 text-rose-400 hover:bg-rose-500/10 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: HIGHLIGHTS */}
          {tab === 'highlights' && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-[#111318] border border-white/[0.08] p-5 space-y-4">
                <h2 className="font-display text-base font-semibold text-[#F5F5F7]">
                  Selecionar Títulos para Destaques da Página Inicial
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Pesquisar filme ou série..."
                    className="flex-1 h-10 px-3.5 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                  />
                  <button
                    type="button"
                    onClick={handlePickerSearch}
                    className="px-4 h-10 rounded-lg bg-[#E5B85A] text-[#08090C] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Search className="h-4 w-4" />
                    <span>Procurar</span>
                  </button>
                </div>

                {pickerResults.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {pickerResults.map((m) => (
                      <div
                        key={`${m.mediaType}-${m.id}`}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#08090C] border border-white/10"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#F5F5F7] truncate">{m.title}</p>
                          <p className="text-xs text-[#7D8599] tabular-nums">
                            {m.mediaType === 'tv' ? 'Série' : 'Filme'} · {m.year}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addHighlightFromMedia(m)}
                          className="px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-[#E5B85A] hover:text-[#08090C] text-xs font-medium shrink-0 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5 inline mr-1" />
                          Destacar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-[#F5F5F7]">
                  Destaques ({highlights.length})
                </h3>
                <button
                  type="button"
                  onClick={handleSaveHighlights}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E5B85A] text-[#08090C] text-xs font-semibold cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  <span>Guardar Destaques</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {highlights.map((h, idx) => (
                  <div
                    key={h.id}
                    className="p-3.5 rounded-xl bg-[#111318] border border-white/[0.08] flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#F5F5F7] truncate">{h.title}</p>
                      <p className="text-xs text-[#949BAE] tabular-nums">
                        {h.mediaType === 'tv' ? 'Série' : 'Filme'} · {h.year} · ★ {h.rating.toFixed(1)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setHighlights((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, active: !x.active } : x))
                          )
                        }
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-[#D1D5E0] cursor-pointer"
                      >
                        {h.active ? 'Visível' : 'Oculto'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setHighlights((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Remover destaque"
                        className="h-9 w-9 rounded-lg border border-white/10 text-rose-400 flex items-center justify-center cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: CATEGORIES */}
          {tab === 'categories' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold text-[#F5F5F7]">
                  Secções e Categorias da Página Inicial
                </h2>
                <button
                  type="button"
                  onClick={handleSaveCategories}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#E5B85A] text-[#08090C] text-xs font-semibold cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  <span>Guardar Ordem e Nomes</span>
                </button>
              </div>

              <div className="space-y-2.5">
                {categories.map((cat, idx) => (
                  <div
                    key={cat.id}
                    className="p-3.5 rounded-xl bg-[#111318] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="font-mono tabular-nums text-xs text-[#7D8599] w-6">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <input
                        type="text"
                        value={cat.name}
                        onChange={(e) =>
                          setCategories((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                          )
                        }
                        className="flex-1 h-9 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          if (idx === 0) return;
                          setCategories((prev) => {
                            const copy = [...prev];
                            [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                            return copy;
                          });
                        }}
                        aria-label="Mover para cima"
                        className="h-9 w-9 rounded-lg border border-white/10 text-[#D1D5E0] disabled:opacity-30 flex items-center justify-center cursor-pointer"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === categories.length - 1}
                        onClick={() => {
                          if (idx === categories.length - 1) return;
                          setCategories((prev) => {
                            const copy = [...prev];
                            [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                            return copy;
                          });
                        }}
                        aria-label="Mover para baixo"
                        className="h-9 w-9 rounded-lg border border-white/10 text-[#D1D5E0] disabled:opacity-30 flex items-center justify-center cursor-pointer"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setCategories((prev) =>
                            prev.map((c, i) => (i === idx ? { ...c, visible: !c.visible } : c))
                          )
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer ${
                          cat.visible
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                            : 'bg-white/5 border-white/10 text-[#949BAE]'
                        }`}
                      >
                        {cat.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        <span>{cat.visible ? 'Visível' : 'Oculta'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: ENV VARS & ERROR LOGS */}
          {tab === 'env' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <form
                onSubmit={handleSaveEnv}
                className="rounded-2xl bg-[#111318] border border-white/[0.08] p-6 space-y-4"
              >
                <div>
                  <h2 className="font-display text-lg font-semibold text-[#F5F5F7]">
                    Configurar Variáveis de Ambiente (Backend)
                  </h2>
                  <p className="text-xs text-[#949BAE] mt-1">
                    As credenciais são mantidas exclusivamente no servidor e nunca são expostas no frontend. Para
                    persistência permanente entre reinícios, adicione também os valores em Segredos do projeto.
                  </p>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs text-[#C6CBD8]">
                    TMDB_API_KEY ({configStatus?.tmdbApiKeySet ? configStatus.tmdbApiKeyMasked : 'não definida'})
                  </span>
                  <input
                    type="password"
                    value={envTmdbKey}
                    onChange={(e) => setEnvTmdbKey(e.target.value)}
                    placeholder="Introduza para atualizar em memória"
                    className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-[#C6CBD8]">
                    TMDB_READ_TOKEN ({configStatus?.tmdbReadTokenSet ? configStatus.tmdbReadTokenMasked : 'não definido'})
                  </span>
                  <input
                    type="password"
                    value={envTmdbToken}
                    onChange={(e) => setEnvTmdbToken(e.target.value)}
                    placeholder="Bearer Read Access Token"
                    className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-[#C6CBD8]">
                    MEGAMBD_API_KEY ({configStatus?.megambdApiKeySet ? configStatus.megambdApiKeyMasked : 'não definida'})
                  </span>
                  <input
                    type="password"
                    value={envMegambdApiKey}
                    onChange={(e) => setEnvMegambdApiKey(e.target.value)}
                    placeholder="Chave API MegamBD / MegaEmbed"
                    className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-[#C6CBD8]">MEGAMBD_EMBED_URL (MegaEmbed / MGEB)</span>
                  <input
                    type="url"
                    value={envMegambdEmbedUrl}
                    onChange={(e) => setEnvMegambdEmbedUrl(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 font-mono text-xs text-[#F5F5F7]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-[#C6CBD8]">MEGAMBD_SERVER_URL (exclusivo mgeb.space)</span>
                  <input
                    type="url"
                    value={envMegambdUrl}
                    onChange={(e) => setEnvMegambdUrl(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 font-mono text-xs text-[#F5F5F7]"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs text-[#C6CBD8]">
                      MEGAMBD_USERNAME (
                      {configStatus?.megambdUsernameSet ? configStatus.megambdUsernameMasked : 'não definido'})
                    </span>
                    <input
                      type="text"
                      value={envMegambdUser}
                      onChange={(e) => setEnvMegambdUser(e.target.value)}
                      placeholder="Utilizador MegamBD"
                      className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-[#C6CBD8]">
                      MEGAMBD_PASSWORD ({configStatus?.megambdPasswordSet ? 'definida' : 'não definida'})
                    </span>
                    <input
                      type="password"
                      value={envMegambdPass}
                      onChange={(e) => setEnvMegambdPass(e.target.value)}
                      placeholder="Palavra-passe / API Key"
                      className="w-full h-10 px-3 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7]"
                    />
                  </label>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#C6CBD8]">
                      FIREBASE_SERVICE_ACCOUNT_JSON (
                      {configStatus?.fcmServiceAccountSet
                        ? `configurada · ${configStatus.fcmProjectId}`
                        : 'não configurada'}
                      )
                    </span>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[11px] font-medium text-[#F3C669] cursor-pointer transition-colors shrink-0">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Carregar .json</span>
                      <input
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            const text = typeof reader.result === 'string' ? reader.result : '';
                            try {
                              const parsed = JSON.parse(text) as {
                                project_id?: string;
                                client_email?: string;
                                private_key?: string;
                              };
                              if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
                                setFeedback({
                                  type: 'err',
                                  text: 'O ficheiro JSON não contém project_id, client_email e private_key válidos.',
                                });
                                return;
                              }
                              setEnvFirebaseSaJson(text);
                              setFeedback({
                                type: 'ok',
                                text: `Ficheiro carregado (${parsed.project_id}). Clique em "Aplicar Variáveis no Servidor" para ativar.`,
                              });
                            } catch {
                              setFeedback({ type: 'err', text: 'Ficheiro JSON inválido.' });
                            }
                          };
                          reader.readAsText(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <textarea
                    rows={3}
                    value={envFirebaseSaJson}
                    onChange={(e) => setEnvFirebaseSaJson(e.target.value)}
                    placeholder='Cole ou carregue o ficheiro .json da conta de serviço Firebase (mantido apenas em memória no servidor)'
                    className="w-full p-2.5 rounded-lg bg-[#08090C] border border-white/10 font-mono text-xs text-[#F5F5F7] resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5B85A] hover:bg-[#ECC672] text-[#08090C] text-xs font-semibold cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  <span>Aplicar Variáveis no Servidor</span>
                </button>
              </form>

              <form
                onSubmit={handleSaveAdultPin}
                className="rounded-2xl bg-[#111318] border border-white/[0.08] p-6 space-y-4 lg:col-span-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-[#F5F5F7]">
                      Proteção do Conteúdo Adulto (+18)
                    </h2>
                    <p className="text-xs text-[#949BAE] mt-1">
                      Defina ou redefina a senha necessária para desbloquear a secção Conteúdo Adulto (+18). O restante catálogo permanece sempre limpo.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="password"
                    value={newAdultPin}
                    onChange={(e) => setNewAdultPin(e.target.value)}
                    placeholder="Nova senha +18 (mínimo 4 caracteres)"
                    className="flex-1 h-10 px-3.5 rounded-lg bg-[#08090C] border border-white/10 text-sm text-[#F5F5F7] focus:outline-none focus:border-[#E5B85A]"
                  />
                  <button
                    type="submit"
                    disabled={savingAdultPin}
                    className="inline-flex items-center justify-center gap-2 px-5 h-10 rounded-lg bg-[#E5B85A] hover:bg-[#ECC672] text-[#08090C] text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Lock className="h-4 w-4" />
                    <span>{savingAdultPin ? 'A guardar...' : 'Guardar Senha +18'}</span>
                  </button>
                </div>
              </form>

              {/* Error Logs */}
              <div className="rounded-2xl bg-[#111318] border border-white/[0.08] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-[#E5B85A]" />
                    <h2 className="font-display text-lg font-semibold text-[#F5F5F7]">
                      Registo de Erros ({errorLogs.length})
                    </h2>
                  </div>
                  {errorLogs.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await movixApi.clearAdminErrors(adminToken);
                        setErrorLogs([]);
                      }}
                      className="text-xs text-[#949BAE] hover:text-rose-400 cursor-pointer"
                    >
                      Limpar registo
                    </button>
                  )}
                </div>

                {errorLogs.length === 0 ? (
                  <p className="text-sm text-[#7D8599] py-8 text-center">
                    Sem erros registados nas integrações TMDB ou MegamBD.
                  </p>
                ) : (
                  <div className="max-h-[420px] overflow-y-auto divide-y divide-white/[0.06]">
                    {errorLogs.map((log) => (
                      <div key={log.id} className="py-3 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-amber-400">
                            {log.service} · HTTP {log.statusCode}
                          </span>
                          <span className="font-mono tabular-nums text-[#7D8599]">
                            {new Date(log.timestamp).toLocaleString('pt-PT')}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-[#949BAE] truncate">{log.endpoint}</p>
                        <p className="text-xs text-[#D1D5E0]">{log.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
