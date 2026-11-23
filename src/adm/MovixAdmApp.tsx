import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Film,
  FolderTree,
  History,
  Layers,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  Radio,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Tag,
  Tv,
  Users,
  X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import { AdminPushCenter } from '../components/AdminPushCenter';
import { formatFirebaseAuthError } from '../contexts/AuthContext';
import { admApi } from '../lib/admApi';
import { reconcileAllAdmWithCloud } from '../lib/admCloudSync';
import {
  auth,
  googleProvider,
  isVerifiedFirebaseAdmin,
} from '../lib/firebase';
import type { AdminAccountSafe, AdminPermission } from '../types/adm';
import { AdsStudioSection } from './sections/AdsStudioSection';
import { CatalogMetaSection } from './sections/CatalogMetaSection';
import { DashboardSection } from './sections/DashboardSection';
import { MoviesSection } from './sections/MoviesSection';
import { PagesIdentitySection } from './sections/PagesIdentitySection';
import { SeriesSection } from './sections/SeriesSection';
import { SystemOpsSection } from './sections/SystemOpsSection';
import { UsersSection } from './sections/UsersSection';

export type AdmSectionId =
  | 'dashboard'
  | 'movies'
  | 'series'
  | 'seasons'
  | 'episodes'
  | 'ads'
  | 'campaigns'
  | 'ad_stats'
  | 'users'
  | 'notifications'
  | 'categories'
  | 'genres'
  | 'servers'
  | 'pages'
  | 'admins'
  | 'logs'
  | 'backup'
  | 'settings';

const SIDEBAR_ITEMS: Array<{
  id: AdmSectionId;
  label: string;
  permission: AdminPermission;
  icon: typeof LayoutDashboard;
  badge?: string;
}> = [
  { id: 'dashboard', label: 'Dashboard', permission: 'dashboard', icon: LayoutDashboard },
  { id: 'movies', label: 'Filmes', permission: 'movies', icon: Film },
  { id: 'series', label: 'Séries', permission: 'series', icon: Tv },
  { id: 'seasons', label: 'Temporadas', permission: 'seasons', icon: Layers },
  { id: 'episodes', label: 'Episódios', permission: 'episodes', icon: Clapperboard },
  { id: 'ads', label: 'MOVIX ADS', permission: 'ads', icon: Megaphone, badge: 'ADS' },
  { id: 'campaigns', label: 'Campanhas', permission: 'campaigns', icon: Radio },
  { id: 'ad_stats', label: 'Estatísticas publicitárias', permission: 'ad_stats', icon: BarChart3 },
  { id: 'users', label: 'Utilizadores', permission: 'users', icon: Users },
  { id: 'notifications', label: 'Notificações', permission: 'notifications', icon: Bell },
  { id: 'categories', label: 'Categorias', permission: 'categories', icon: FolderTree },
  { id: 'genres', label: 'Géneros', permission: 'genres', icon: Tag },
  { id: 'servers', label: 'Servidores', permission: 'servers', icon: Server },
  { id: 'pages', label: 'Páginas', permission: 'pages', icon: FileText },
  { id: 'admins', label: 'Administradores', permission: 'admins', icon: Shield },
  { id: 'logs', label: 'Histórico de atividades', permission: 'logs', icon: History },
  { id: 'backup', label: 'Backup', permission: 'backup', icon: Archive },
  { id: 'settings', label: 'Configurações', permission: 'settings', icon: Settings },
];

interface MovixAdmAppProps {
  initialSection?: string;
  adminToken: string | null;
  onSetAdminToken: (token: string | null) => void;
  onPublicDataChanged: () => void;
  onOpenPublicSite: () => void;
}

function normalizeSection(raw?: string): AdmSectionId {
  const valid = SIDEBAR_ITEMS.map((i) => i.id);
  if (raw && valid.includes(raw as AdmSectionId)) {
    return raw as AdmSectionId;
  }
  return 'dashboard';
}

export function MovixAdmApp({
  initialSection,
  adminToken,
  onSetAdminToken,
  onPublicDataChanged,
  onOpenPublicSite,
}: MovixAdmAppProps) {
  const [section, setSection] = useState<AdmSectionId>(() => normalizeSection(initialSection));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auth state
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState<AdminAccountSafe | null>(null);

  // Login / Setup fields
  const [setupName, setSetupName] = useState('Administrador Principal');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submittingAuth, setSubmittingAuth] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [cloudAuthorized, setCloudAuthorized] = useState<boolean>(() => isVerifiedFirebaseAdmin(auth.currentUser));
  const [linkingCloud, setLinkingCloud] = useState(false);
  const [reconcilingCloud, setReconcilingCloud] = useState(false);
  const [cloudSyncVersion, setCloudSyncVersion] = useState(0);

  const onSetAdminTokenRef = useRef(onSetAdminToken);
  onSetAdminTokenRef.current = onSetAdminToken;
  const onPublicDataChangedRef = useRef(onPublicDataChanged);
  onPublicDataChangedRef.current = onPublicDataChanged;
  const reconciledSessionKeyRef = useRef<string | null>(null);

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    window.setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 3600);
  }, []);

  useEffect(() => {
    document.title = 'MOVIX ADM · Painel Administrativo';
  }, []);

  useEffect(() => {
    if (initialSection) {
      setSection(normalizeSection(initialSection));
    }
  }, [initialSection]);

  useEffect(() => {
    let cancelled = false;
    setCheckingAuth(true);
    void admApi
      .getAuthStatus(adminToken)
      .then((res) => {
        if (cancelled) return;
        setRequiresSetup(res.requiresSetup);
        if (adminToken && res.authenticated && res.admin) {
          setAuthenticated(true);
          setCurrentAdmin(res.admin);
          return;
        }
        if (adminToken) {
          onSetAdminTokenRef.current(null);
        }
        setAuthenticated(false);
        setCurrentAdmin(null);
      })
      .catch(() => {
        if (!cancelled) {
          setAuthenticated(false);
          setCurrentAdmin(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken]);

  useEffect(() => {
    return onAuthStateChanged(auth, (fbUser) => {
      setCloudAuthorized(isVerifiedFirebaseAdmin(fbUser));
    });
  }, []);

  // Automatically rehydrate & reconcile ALL permanent Cloud Firestore datasets AT MOST ONCE per auth/cloud session
  useEffect(() => {
    if (!authenticated || !adminToken) {
      reconciledSessionKeyRef.current = null;
      return;
    }
    const sessionKey = `${adminToken}:${cloudAuthorized ? 'cloud' : 'local'}`;
    if (reconciledSessionKeyRef.current === sessionKey) {
      return;
    }
    reconciledSessionKeyRef.current = sessionKey;

    let cancelled = false;
    setReconcilingCloud(true);
    void reconcileAllAdmWithCloud(adminToken)
      .then((res) => {
        if (cancelled) return;
        if (res.rehydratedToServer) {
          setCloudSyncVersion((v) => v + 1);
          onPublicDataChangedRef.current();
        }
      })
      .catch(() => {
        // Non-blocking
      })
      .finally(() => {
        if (!cancelled) setReconcilingCloud(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, adminToken, cloudAuthorized]);

  const handleLinkCloudSync = async () => {
    setLinkingCloud(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (!isVerifiedFirebaseAdmin(cred.user)) {
        notify('Selecione a conta Google autorizada (gelitontn1@gmail.com) para ativar o backup permanente na nuvem.', 'error');
        return;
      }
      setCloudAuthorized(true);
      if (adminToken) {
        const res = await reconcileAllAdmWithCloud(adminToken, { forcePushLocalToCloud: true });
        setCloudSyncVersion((v) => v + 1);
        notify(
          `Backup Permanente na Nuvem ativo! (${res.counts.ads} anúncios, ${res.counts.movies} filmes, ${res.counts.series} séries sincronizados)`
        );
      } else {
        notify('Backup Permanente na Nuvem ativado!');
      }
      onPublicDataChanged();
    } catch (err) {
      notify(formatFirebaseAuthError(err), 'error');
    } finally {
      setLinkingCloud(false);
    }
  };

  const handleManualCloudSync = async () => {
    if (!adminToken) return;
    setReconcilingCloud(true);
    try {
      const res = await reconcileAllAdmWithCloud(adminToken, { forcePushLocalToCloud: cloudAuthorized });
      setCloudSyncVersion((v) => v + 1);
      onPublicDataChanged();
      notify(
        cloudAuthorized
          ? `Tudo sincronizado na nuvem! (${res.counts.ads} anúncios · ${res.counts.movies} filmes · ${res.counts.series} séries)`
          : 'Dados da nuvem restaurados para este servidor! Ligue o Google para também gravar novas alterações na nuvem.'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao sincronizar com a nuvem.', 'error');
    } finally {
      setReconcilingCloud(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSubmittingAuth(true);
    try {
      const res = await admApi.setupPrincipalAdmin({
        name: setupName.trim() || 'Administrador Principal',
        email: emailInput.trim(),
        password: passwordInput,
      });
      onSetAdminToken(res.token);
      setCurrentAdmin(res.admin);
      setAuthenticated(true);
      setRequiresSetup(false);
      setPasswordInput('');
      notify('Administrador Principal configurado com sucesso!');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Falha na configuração inicial.');
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSubmittingAuth(true);
    try {
      const res = await admApi.login({
        email: emailInput.trim() || undefined,
        password: passwordInput,
      });
      onSetAdminToken(res.token);
      setCurrentAdmin(res.admin);
      setAuthenticated(true);
      setPasswordInput('');
      notify(`Bem-vindo ao MOVIX ADM, ${res.admin.name}.`);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Credenciais inválidas.');
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleGoogleAdminLogin = async () => {
    setAuthError(null);
    setSubmittingAuth(true);
    try {
      const existingUser = auth.currentUser;
      if (existingUser && existingUser.emailVerified) {
        try {
          const freshToken = await existingUser.getIdToken(true);
          const res = await admApi.loginWithFirebase(freshToken);
          onSetAdminToken(res.token);
          setCurrentAdmin(res.admin);
          setAuthenticated(true);
          notify(`Bem-vindo ao MOVIX ADM, ${res.admin.name}.`);
          return;
        } catch {
          // Signed-in account is not authorized as admin; fall through to Google account chooser popup
        }
      }

      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken(true);
      const res = await admApi.loginWithFirebase(idToken);
      onSetAdminToken(res.token);
      setCurrentAdmin(res.admin);
      setAuthenticated(true);
      notify(`Bem-vindo ao MOVIX ADM, ${res.admin.name}.`);
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/popup-blocked') {
        setAuthError(
          `${formatFirebaseAuthError(err)} Se preferir no telemóvel, entre com o seu e-mail e senha acima.`
        );
      } else {
        setAuthError(formatFirebaseAuthError(err));
      }
    } finally {
      setSubmittingAuth(false);
    }
  };

  const handleLogout = () => {
    onSetAdminToken(null);
    setAuthenticated(false);
    setCurrentAdmin(null);
    setMobileMenuOpen(false);
  };

  const hasPermission = (perm: AdminPermission): boolean => {
    if (!currentAdmin) return false;
    if (currentAdmin.role === 'super_admin') return true;
    return currentAdmin.permissions.includes(perm);
  };

  const visibleMenu = SIDEBAR_ITEMS.filter((item) => hasPermission(item.permission));

  const handleSelectSection = (next: AdmSectionId) => {
    setSection(next);
    setMobileMenuOpen(false);
    const nextHash = `#/adm/${next}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  };

  // ===================== AUTH SCREEN (STANDALONE) =====================
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#05060A] text-white flex items-center justify-center gap-3 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-[#E5B85A]" />
        <span className="text-[#A0A6B8]">A iniciar MOVIX ADM...</span>
      </div>
    );
  }

  if (!authenticated || !adminToken || !currentAdmin) {
    return (
      <div className="min-h-screen bg-[#05060A] text-white flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0B0E17] p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-xl bg-[#E5B85A]/15 border border-[#E5B85A]/35 flex items-center justify-center text-[#E5B85A]">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">MOVIX ADM</h1>
            <p className="text-xs text-[#8D97AF]">
              {requiresSetup
                ? 'Configuração inicial — Crie a conta do Administrador Principal.'
                : 'Autenticação obrigatória para aceder ao centro de controlo MOVIX.'}
            </p>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {authError}
            </div>
          )}

          <form onSubmit={requiresSetup ? handleSetup : handleLogin} className="space-y-4">
            {requiresSetup && (
              <div>
                <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Nome do Administrador</label>
                <input
                  type="text"
                  required
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B85A]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#D4D9E6] mb-1">
                E-mail do Administrador
              </label>
              <input
                type="email"
                required
                autoComplete="username"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="admin@movix.com"
                className="w-full rounded-lg bg-[#07090F] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B85A]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D4D9E6] mb-1">Senha Administrativa</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  minLength={requiresSetup ? 6 : 1}
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg bg-[#07090F] border border-white/10 pl-3.5 pr-10 py-2.5 text-sm text-white focus:outline-none focus:border-[#E5B85A]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#8D97AF] hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingAuth}
              className="w-full py-2.5 rounded-lg text-sm font-bold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {submittingAuth && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{requiresSetup ? 'Criar Administrador e Entrar' : 'Entrar no MOVIX ADM'}</span>
            </button>
          </form>

          {!requiresSetup && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[11px] text-[#7F889E]">
                <span className="h-px flex-1 bg-white/[0.08]" />
                <span>ou autenticar com Google</span>
                <span className="h-px flex-1 bg-white/[0.08]" />
              </div>
              <button
                type="button"
                disabled={submittingAuth}
                onClick={() => void handleGoogleAdminLogin()}
                className="w-full py-2.5 px-3 rounded-lg text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.11] text-white border border-white/[0.12] disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Shield className="w-4 h-4 text-[#E5B85A]" />
                <span>Entrar com Google (Backup Permanente na Nuvem)</span>
              </button>
            </div>
          )}

          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs text-[#8D97AF]">
            <span>Ambiente independente</span>
            <button
              type="button"
              onClick={onOpenPublicSite}
              className="inline-flex items-center gap-1 text-[#E5B85A] hover:underline cursor-pointer"
            >
              Ir para o site MOVIX <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===================== AUTHENTICATED MOVIX ADM SHELL =====================
  const renderSidebarNav = (isMobile = false) => (
    <div className="flex flex-col h-full">
      <div className="h-16 px-4 flex items-center justify-between border-b border-white/[0.07] shrink-0">
        {(!sidebarCollapsed || isMobile) && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#E5B85A] text-[#06070B] font-black text-sm flex items-center justify-center shrink-0">
              M
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold tracking-wider text-white truncate">MOVIX ADM</div>
              <div className="text-[10px] text-[#E5B85A] truncate">Centro de Controlo</div>
            </div>
          </div>
        )}
        {isMobile ? (
          <button type="button" onClick={() => setMobileMenuOpen(false)} className="text-[#8D97AF] hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="p-1.5 rounded-lg bg-white/[0.04] text-[#8D97AF] hover:text-white cursor-pointer"
            title={sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2.5 space-y-1">
        {visibleMenu.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectSection(item.id)}
              title={sidebarCollapsed && !isMobile ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? 'bg-[#E5B85A] text-[#06070B] font-bold shadow-sm'
                  : 'text-[#A0A6B8] hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {(!sidebarCollapsed || isMobile) && (
                <>
                  <span className="flex-1 text-left truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        active ? 'bg-[#06070B]/20 text-[#06070B]' : 'bg-[#E5B85A]/15 text-[#E5B85A]'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}

        {/* Item 19: Terminar sessão */}
        <div className="pt-3 mt-3 border-t border-white/[0.07]">
          <button
            type="button"
            onClick={handleLogout}
            title={sidebarCollapsed && !isMobile ? 'Terminar sessão' : undefined}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {(!sidebarCollapsed || isMobile) && <span className="flex-1 text-left">Terminar sessão</span>}
          </button>
        </div>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#05060A] text-[#F6F7FB] flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col border-r border-white/[0.07] bg-[#080B13] shrink-0 transition-all duration-200 sticky top-0 h-screen ${
          sidebarCollapsed ? 'w-[70px]' : 'w-64'
        }`}
      >
        {renderSidebarNav(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-[#080B13] border-r border-white/10 h-full">
            {renderSidebarNav(true)}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="h-16 sticky top-0 z-30 border-b border-white/[0.07] bg-[#080B13]/95 backdrop-blur px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-white/[0.05] text-white cursor-pointer"
              aria-label="Abrir menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">
                {SIDEBAR_ITEMS.find((i) => i.id === section)?.label || 'MOVIX ADM'}
              </div>
              <div className="text-[11px] text-[#7D879F] truncate">
                Sincronizado em tempo real com MOVIX
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {cloudAuthorized ? (
              <button
                type="button"
                disabled={reconcilingCloud}
                onClick={() => void handleManualCloudSync()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-60 cursor-pointer"
                title="Dados guardados permanentemente na nuvem. Clique para sincronizar agora."
              >
                {reconcilingCloud ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">Nuvem Permanente</span>
                <RefreshCw className="w-3 h-3 opacity-75" />
              </button>
            ) : (
              <button
                type="button"
                disabled={linkingCloud}
                onClick={() => void handleLinkCloudSync()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#E5B85A]/15 text-[#F4CB73] border border-[#E5B85A]/35 hover:bg-[#E5B85A]/25 disabled:opacity-50 cursor-pointer"
                title="Ativar gravação permanente na nuvem para não perder dados ao atualizar o app"
              >
                {linkingCloud ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Cloud className="w-3.5 h-3.5" />
                )}
                <span>Ativar Nuvem Permanente</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenPublicSite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.05] text-[#D4D9E6] border border-white/10 hover:text-white cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#E5B85A]" />
              <span className="hidden sm:inline">Abrir Site MOVIX</span>
            </button>

            {currentAdmin && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                <div className="w-6 h-6 rounded-full bg-[#E5B85A]/20 text-[#E5B85A] text-[11px] font-bold flex items-center justify-center">
                  {currentAdmin.name.charAt(0).toUpperCase()}
                </div>
                <div className="text-[11px] leading-tight">
                  <div className="font-semibold text-white">{currentAdmin.name}</div>
                  <div className="text-[10px] text-[#8D97AF] uppercase">{currentAdmin.role.replace('_', ' ')}</div>
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Active Section */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {!cloudAuthorized && (
            <div className="mb-5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-amber-200">
                    Backup Permanente na Nuvem desconectado nesta sessão
                  </div>
                  <p className="text-[11px] text-amber-100/80 mt-0.5">
                    Para que nenhum anúncio, imagem, filme, série ou configuração se perca ao atualizar o aplicativo, ligue a sua conta Google autorizada (<span className="font-semibold">gelitontn1@gmail.com</span>).
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={linkingCloud}
                onClick={() => void handleLinkCloudSync()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#E5B85A] text-[#06070B] hover:bg-[#F4CB73] disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {linkingCloud ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                <span>Ativar Backup Permanente</span>
              </button>
            </div>
          )}

          <div key={cloudSyncVersion}>
          {section === 'dashboard' && (
            <DashboardSection
              token={adminToken}
              onNavigateSection={(sec) => handleSelectSection(normalizeSection(sec))}
            />
          )}

          {section === 'movies' && (
            <MoviesSection
              token={adminToken}
              onNotify={notify}
              onPublicDataChanged={onPublicDataChanged}
            />
          )}

          {(section === 'series' || section === 'seasons' || section === 'episodes') && (
            <SeriesSection
              token={adminToken}
              activeTab={section}
              onNotify={notify}
              onPublicDataChanged={onPublicDataChanged}
            />
          )}

          {(section === 'ads' || section === 'campaigns' || section === 'ad_stats') && (
            <AdsStudioSection
              token={adminToken}
              mode={section}
              onNotify={notify}
              onPublicDataChanged={onPublicDataChanged}
            />
          )}

          {section === 'users' && <UsersSection token={adminToken} onNotify={notify} />}

          {section === 'notifications' && (
            <div className="space-y-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-white">Notificações Push (MOVIX)</h1>
                <p className="text-xs sm:text-sm text-[#8D97AF]">
                  Envie avisos de novos filmes, episódios, comunicados e campanhas agendadas para os utilizadores.
                </p>
              </div>
              <AdminPushCenter
                adminToken={adminToken}
                onFeedback={(fb) => {
                  if (fb) notify(fb.text, fb.type === 'err' ? 'error' : 'success');
                }}
              />
            </div>
          )}

          {(section === 'categories' || section === 'genres' || section === 'servers') && (
            <CatalogMetaSection
              token={adminToken}
              mode={section}
              onNotify={notify}
              onPublicDataChanged={onPublicDataChanged}
            />
          )}

          {section === 'pages' && (
            <PagesIdentitySection
              token={adminToken}
              onNotify={notify}
              onPublicDataChanged={onPublicDataChanged}
            />
          )}

          {(section === 'admins' || section === 'logs' || section === 'backup' || section === 'settings') && (
            <SystemOpsSection
              token={adminToken}
              mode={section}
              onNotify={notify}
              onPublicDataChanged={onPublicDataChanged}
              onForceLogout={handleLogout}
            />
          )}
          </div>
        </main>
      </div>

      {/* Live Feedback Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl border text-xs font-medium shadow-2xl ${
            toast.type === 'error'
              ? 'bg-[#1F0D12] border-red-500/40 text-red-200'
              : 'bg-[#0F1B16] border-emerald-500/40 text-emerald-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
