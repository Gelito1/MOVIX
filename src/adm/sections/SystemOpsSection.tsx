import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  Trash2,
  Wrench,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import { reconcileAllAdmWithCloud } from '../../lib/admCloudSync';
import { movixApi } from '../../lib/api';
import {
  applyCloudConfigToSiteConfig,
  fetchCloudSystemConfig,
  isVerifiedFirebaseAdmin,
  subscribeCloudSystemConfig,
  upsertCloudSystemConfig,
  type SupportedLanguage,
} from '../../lib/firebase';
import {
  ALL_ADMIN_PERMISSIONS,
  PERMISSION_LABELS,
  type AdminAccountSafe,
  type AdminAuditLog,
  type AdminPermission,
  type AdminRole,
  type BackupMeta,
  type SiteIdentityConfig,
  type StoredMediaFile,
} from '../../types/adm';
import type { ApiErrorLog } from '../../types/movix';

interface SystemOpsSectionProps {
  token: string;
  mode: 'admins' | 'logs' | 'backup' | 'settings';
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  onPublicDataChanged: () => void;
  onForceLogout: () => void;
}

export function SystemOpsSection({
  token,
  mode,
  onNotify,
  onPublicDataChanged,
  onForceLogout,
}: SystemOpsSectionProps) {
  const [loading, setLoading] = useState(true);

  // Admins state
  const [admins, setAdmins] = useState<AdminAccountSafe[]>([]);
  const [myEmail, setMyEmail] = useState('gelitontn1@gmail.com');
  const [myNewPassword, setMyNewPassword] = useState('');
  const [savingMyPass, setSavingMyPass] = useState(false);
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<AdminRole>('editor');
  const [newAdminPerms, setNewAdminPerms] = useState<AdminPermission[]>([
    'dashboard',
    'movies',
    'series',
    'seasons',
    'episodes',
  ]);

  // Logs state
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [logFilter, setLogFilter] = useState('');

  // Backup & Media state
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [backupNote, setBackupNote] = useState('');
  const [mediaFiles, setMediaFiles] = useState<StoredMediaFile[]>([]);
  const [mediaTotalBytes, setMediaTotalBytes] = useState(0);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [syncingCloudAll, setSyncingCloudAll] = useState(false);

  // Settings state
  const [siteConfig, setSiteConfig] = useState<SiteIdentityConfig | null>(null);
  const [lastSyncedMaintenance, setLastSyncedMaintenance] = useState<boolean | null>(null);
  const [cacheCount, setCacheCount] = useState(0);
  const [errorLogs, setErrorLogs] = useState<ApiErrorLog[]>([]);
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [tmdbReadToken, setTmdbReadToken] = useState('');
  const [megambdServerUrl, setMegambdServerUrl] = useState('');
  const [megambdEmbedUrl, setMegambdEmbedUrl] = useState('');
  const [megambdUsername, setMegambdUsername] = useState('');
  const [megambdPassword, setMegambdPassword] = useState('');
  const [adultPin, setAdultPin] = useState('');
  const [diagResult, setDiagResult] = useState<{ tmdbOk: boolean; tmdbMsg: string; megaOk: boolean; megaMsg: string } | null>(null);
  const [testingDiag, setTestingDiag] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'admins') {
        const res = await admApi.listAdmins(token);
        setAdmins(res.admins);
      } else if (mode === 'logs') {
        const res = await admApi.listLogs(token);
        setLogs(res.logs);
      } else if (mode === 'backup') {
        const [bRes, mRes] = await Promise.all([admApi.listBackups(token), admApi.listMedia(token)]);
        setBackups(bRes.backups);
        setMediaFiles(mRes.files);
        setMediaTotalBytes(mRes.totalBytes);
      } else if (mode === 'settings') {
        const [cfgRes, dashRes, cloudCfg] = await Promise.all([
          admApi.getSiteConfig(token),
          movixApi.getAdminDashboard(token),
          fetchCloudSystemConfig(),
        ]);
        const mergedConfig = cloudCfg
          ? applyCloudConfigToSiteConfig(cfgRes.siteConfig, cloudCfg)
          : cfgRes.siteConfig;
        setSiteConfig(mergedConfig);
        setLastSyncedMaintenance(Boolean(mergedConfig.maintenanceMode));
        setCacheCount(dashRes.cacheStats.activeEntries);
        setErrorLogs(dashRes.errorLogs);
        setMegambdServerUrl(dashRes.configStatus.megambdServerUrl || '');
        setMegambdEmbedUrl(dashRes.configStatus.megambdEmbedUrl || '');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar dados do sistema.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, mode, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (mode !== 'settings') return;
    return subscribeCloudSystemConfig((cloudCfg) => {
      if (!cloudCfg) return;
      setLastSyncedMaintenance(Boolean(cloudCfg.maintenanceMode));
      setSiteConfig((prev) => (prev ? applyCloudConfigToSiteConfig(prev, cloudCfg) : prev));
    });
  }, [mode]);

  // ===================== ADMINS & RBAC =====================
  if (mode === 'admins') {
    const handleCreateAdmin = async () => {
      try {
        await admApi.createAdmin(token, {
          name: newAdminName,
          email: newAdminEmail,
          password: newAdminPassword,
          role: newAdminRole,
          permissions: newAdminRole === 'super_admin' ? ALL_ADMIN_PERMISSIONS : newAdminPerms,
        });
        onNotify('Novo administrador criado com sucesso.');
        setNewAdminName('');
        setNewAdminEmail('');
        setNewAdminPassword('');
        await load();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao criar administrador.', 'error');
      }
    };

    const handleRevokeAll = async () => {
      if (!window.confirm('Revogar todas as sessões administrativas ativas? Terá de iniciar sessão novamente.')) return;
      try {
        await admApi.revokeAllSessions(token);
        onNotify('Todas as sessões foram revogadas.');
        onForceLogout();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao revogar sessões.', 'error');
      }
    };

    const handleUpdateMyPassword = async () => {
      if (myNewPassword.trim().length < 6) {
        onNotify('A senha deve ter pelo menos 6 caracteres.', 'error');
        return;
      }
      setSavingMyPass(true);
      try {
        await admApi.changeMyPassword(token, {
          email: myEmail.trim() || undefined,
          password: myNewPassword,
        });
        setMyNewPassword('');
        onNotify('E-mail e senha administrativa guardados com sucesso! Já pode iniciar sessão com estas credenciais.');
        await load();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao atualizar senha.', 'error');
      } finally {
        setSavingMyPass(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Administradores e Permissões</h1>
            <p className="text-xs sm:text-sm text-[#8D97AF]">
              Gerencie contas administrativas, níveis de acesso (Super Admin, Editor, Gestor de Anúncios) e sessões ativas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRevokeAll()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Encerrar Todas as Sessões
          </button>
        </div>

        <div className="rounded-xl border border-[#E5B85A]/30 bg-[#0B0E17] p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">
            Definir / Alterar a Minha Senha de Acesso
          </h2>
          <p className="text-[11px] text-[#8D97AF]">
            Defina o e-mail e a senha que deseja usar para iniciar sessão diretamente no MOVIX ADM.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="email"
              value={myEmail}
              onChange={(e) => setMyEmail(e.target.value)}
              placeholder="gelitontn1@gmail.com"
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <input
              type="password"
              value={myNewPassword}
              onChange={(e) => setMyNewPassword(e.target.value)}
              placeholder="Nova senha (mín. 6 caracteres)"
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <button
              type="button"
              disabled={savingMyPass}
              onClick={() => void handleUpdateMyPassword()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] disabled:opacity-50 cursor-pointer"
            >
              {savingMyPass ? 'A guardar...' : 'Guardar E-mail e Senha'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">Adicionar Novo Administrador</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="text"
              value={newAdminName}
              onChange={(e) => setNewAdminName(e.target.value)}
              placeholder="Nome completo"
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <input
              type="email"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              placeholder="E-mail de acesso"
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <input
              type="password"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              placeholder="Senha (mín. 6 caracteres)"
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <select
              value={newAdminRole}
              onChange={(e) => {
                const role = e.target.value as AdminRole;
                setNewAdminRole(role);
                if (role === 'super_admin') setNewAdminPerms([...ALL_ADMIN_PERMISSIONS]);
                else if (role === 'ads_manager') setNewAdminPerms(['dashboard', 'ads', 'campaigns', 'ad_stats']);
                else setNewAdminPerms(['dashboard', 'movies', 'series', 'seasons', 'episodes', 'categories', 'genres', 'servers']);
              }}
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            >
              <option value="super_admin">Administrador Principal</option>
              <option value="editor">Editor de Conteúdo</option>
              <option value="ads_manager">Gestor de Anúncios</option>
            </select>
          </div>

          {newAdminRole !== 'super_admin' && (
            <div className="space-y-2">
              <div className="text-[11px] text-[#8D97AF]">Permissões Granulares:</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {ALL_ADMIN_PERMISSIONS.map((perm) => {
                  const checked = newAdminPerms.includes(perm);
                  return (
                    <label key={perm} className="inline-flex items-center gap-1.5 text-[11px] text-[#D4D9E6] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setNewAdminPerms((prev) => (prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]))
                        }
                        className="accent-[#E5B85A]"
                      />
                      {PERMISSION_LABELS[perm]}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleCreateAdmin()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Criar Administrador
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4">
          {loading ? (
            <div className="py-10 text-center text-xs text-[#8D97AF]">A carregar administradores...</div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {admins.map((a) => (
                <div key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-[#E5B85A]" />
                      <span className="text-xs font-bold text-white">{a.name}</span>
                      <span className="px-2 py-0.5 rounded bg-white/10 text-[10px] text-[#E5B85A] uppercase">
                        {a.role.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8D97AF] mt-0.5">
                      {a.email} · {a.permissions.length} permissões · {a.active ? 'Ativo' : 'Desativado'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await admApi.updateAdmin(token, a.id, { active: !a.active });
                        onNotify(a.active ? 'Conta desativada.' : 'Conta ativada.');
                        await load();
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-[#D4D9E6] hover:text-white cursor-pointer"
                    >
                      {a.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`Eliminar administrador "${a.name}"?`)) return;
                        try {
                          await admApi.deleteAdmin(token, a.id);
                          onNotify('Administrador eliminado.');
                          await load();
                        } catch (err) {
                          onNotify(err instanceof Error ? err.message : 'Erro ao eliminar.', 'error');
                        }
                      }}
                      className="p-1.5 rounded-lg bg-red-500/10 text-red-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===================== AUDIT LOGS =====================
  if (mode === 'logs') {
    const filteredLogs = logs.filter((l) => {
      const q = logFilter.trim().toLowerCase();
      return (
        !q ||
        l.action.toLowerCase().includes(q) ||
        l.adminName.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q)
      );
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">Histórico de Atividades (Auditoria)</h1>
            <p className="text-xs sm:text-sm text-[#8D97AF]">
              Registo completo de alterações, publicações, anúncios, bloqueios e operações administrativas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 text-white border border-white/10 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-4">
          <input
            type="text"
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            placeholder="Filtrar por ação, administrador, filme, anúncio..."
            className="w-full max-w-md rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />

          {loading ? (
            <div className="py-10 text-center text-xs text-[#8D97AF]">A carregar histórico...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#6E778E]">Sem registos de atividade.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[#8D97AF]">
                    <th className="py-2 pr-3">Data / Hora</th>
                    <th className="py-2 px-2">Administrador</th>
                    <th className="py-2 px-2">Ação</th>
                    <th className="py-2 px-2">Detalhes</th>
                    <th className="py-2 pl-2 text-right">Resultado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredLogs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-3 text-[#8D97AF] whitespace-nowrap">
                        {new Date(l.timestamp).toLocaleString('pt-PT')}
                      </td>
                      <td className="py-2.5 px-2 text-white font-medium whitespace-nowrap">{l.adminName}</td>
                      <td className="py-2.5 px-2 text-[#E5B85A] font-medium whitespace-nowrap">{l.action}</td>
                      <td className="py-2.5 px-2 text-[#D4D9E6] max-w-[300px] truncate">{l.details}</td>
                      <td className="py-2.5 pl-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            l.result === 'success' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                          }`}
                        >
                          {l.result === 'success' ? 'Sucesso' : 'Erro'}
                        </span>
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

  // ===================== BACKUP & STORAGE =====================
  if (mode === 'backup') {
    const handleCreateBackup = async () => {
      setCreatingBackup(true);
      try {
        const res = await admApi.createBackup(token, backupNote || 'Backup manual MOVIX ADM');
        setBackups(res.backups);
        setBackupNote('');
        onNotify('Backup criado e guardado no servidor.');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro ao criar backup.', 'error');
      } finally {
        setCreatingBackup(false);
      }
    };

    const handleRestore = async (b: BackupMeta) => {
      if (!window.confirm(`Restaurar o backup "${b.filename}"? Os dados atuais serão substituídos (as suas credenciais de administrador serão preservadas).`)) {
        return;
      }
      try {
        await admApi.restoreBackup(token, b.id);
        if (isVerifiedFirebaseAdmin()) {
          await reconcileAllAdmWithCloud(token, { forcePushLocalToCloud: true });
        }
        onNotify('Backup restaurado e sincronizado com a nuvem permanente!');
        onPublicDataChanged();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Falha ao restaurar backup.', 'error');
      }
    };

    const handleSyncAllCloud = async () => {
      setSyncingCloudAll(true);
      try {
        const res = await reconcileAllAdmWithCloud(token, {
          forcePushLocalToCloud: isVerifiedFirebaseAdmin(),
        });
        onPublicDataChanged();
        await load();
        onNotify(
          res.cloudAuthorized
            ? `Sincronização permanente concluída! (${res.counts.ads} anúncios · ${res.counts.movies} filmes · ${res.counts.series} séries · ${res.counts.banners} banners)`
            : 'Dados da nuvem restaurados para este servidor! Ligue o Google no topo para também gravar novas alterações na nuvem.'
        );
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Falha ao sincronizar com a nuvem.', 'error');
      } finally {
        setSyncingCloudAll(false);
      }
    };

    const handleCleanupMedia = async () => {
      if (!window.confirm('Remover ficheiros de media que já não são referenciados por nenhum filme, série, banner ou anúncio?')) return;
      try {
        const res = await admApi.cleanupMedia(token);
        onNotify(`${res.removedCount} ficheiros limpos (${Math.round(res.freedBytes / 1024)} KB libertados).`);
        await load();
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Erro na limpeza de ficheiros.', 'error');
      }
    };

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Backup, Restauro e Armazenamento</h1>
          <p className="text-xs sm:text-sm text-[#8D97AF]">
            Os seus anúncios, filmes, séries, categorias, banners, imagens e definições ficam guardados permanentemente na nuvem para nunca se perderem ao atualizar o aplicativo.
          </p>
        </div>

        {/* Permanent Cloud Sync Card */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <Cloud className="w-4 h-4" /> Armazenamento Permanente na Nuvem
            </div>
            <p className="text-[11px] text-[#B9C2D4]">
              Restaura automaticamente qualquer dado em falta após uma atualização do app e garante que tudo o que está no painel ADM permaneça guardado até que decida excluir.
            </p>
          </div>
          <button
            type="button"
            disabled={syncingCloudAll}
            onClick={() => void handleSyncAllCloud()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-[#04120B] hover:bg-emerald-400 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            {syncingCloudAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sincronizar Tudo com a Nuvem Agora
          </button>
        </div>

        {/* Create Backup */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#E5B85A]">
            <Archive className="w-4 h-4" /> Criar Novo Backup Completo
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={backupNote}
              onChange={(e) => setBackupNote(e.target.value)}
              placeholder="Nota do backup (ex: Antes de atualizar campanhas)"
              className="flex-1 rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
            />
            <button
              type="button"
              disabled={creatingBackup}
              onClick={() => void handleCreateBackup()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              {creatingBackup ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              Criar Backup Agora
            </button>
          </div>
        </div>

        {/* Backup history */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#E5B85A]" />
            <h3 className="text-sm font-semibold text-white">Histórico de Backups ({backups.length})</h3>
          </div>
          {backups.length === 0 ? (
            <p className="text-xs text-[#6E778E] py-6 text-center">Nenhum backup criado ainda.</p>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {backups.map((b) => (
                <div key={b.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-white">{b.filename}</p>
                    <p className="text-[11px] text-[#8D97AF]">
                      {new Date(b.createdAt).toLocaleString('pt-PT')} · {Math.max(1, Math.round(b.sizeBytes / 1024))} KB · {b.note}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void admApi.downloadBackup(token, b.id, b.filename)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-white hover:bg-white/10 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Baixar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRestore(b)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-[#E5B85A]/15 text-[#F4CB73] border border-[#E5B85A]/30 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Media storage */}
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-[#E5B85A]" />
              <h3 className="text-sm font-semibold text-white">
                Ficheiros Armazenados ({mediaFiles.length} ficheiros · {(mediaTotalBytes / (1024 * 1024)).toFixed(2)} MB)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void handleCleanupMedia()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/15 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Limpar Ficheiros Não Utilizados
            </button>
          </div>
          {mediaFiles.length === 0 ? (
            <p className="text-xs text-[#6E778E] py-4 text-center">Nenhum ficheiro carregado ainda.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[360px] overflow-y-auto">
              {mediaFiles.map((f) => (
                <div key={`${f.folder}/${f.filename}`} className="p-2.5 rounded-lg bg-[#07090F] border border-white/[0.06] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">{f.filename}</p>
                    <p className="text-[10px] text-[#8D97AF]">
                      {f.folder} · {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Remover ${f.filename}?`)) return;
                      await admApi.deleteMedia(token, f.folder, f.filename);
                      onNotify('Ficheiro removido.');
                      await load();
                    }}
                    className="p-1.5 rounded bg-red-500/10 text-red-400 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===================== GENERAL SETTINGS =====================
  const handleSaveGlobalToggles = async () => {
    if (!siteConfig) return;
    try {
      const res = await admApi.saveSiteConfig(token, {
        maintenanceMode: siteConfig.maintenanceMode,
        adsGlobalEnabled: siteConfig.adsGlobalEnabled,
        defaultLanguage: siteConfig.defaultLanguage,
        previousMaintenanceMode:
          lastSyncedMaintenance !== null ? lastSyncedMaintenance : undefined,
      });
      const syncedToCloud = await upsertCloudSystemConfig(
        {
          maintenanceMode: res.siteConfig.maintenanceMode,
          adsGlobalEnabled: res.siteConfig.adsGlobalEnabled,
          defaultLanguage: res.siteConfig.defaultLanguage as SupportedLanguage,
        },
        res.siteConfig
      );
      setSiteConfig(res.siteConfig);
      setLastSyncedMaintenance(Boolean(res.siteConfig.maintenanceMode));
      if (res.notification?.sent && res.notification.mode === 'maintenance_on') {
        onNotify(
          syncedToCloud
            ? 'Modo de manutenção ativado em todos os dispositivos e notificação enviada!'
            : 'Modo de manutenção ativado localmente. Clique em "Sincronizar Nuvem" para aplicar em todos os dispositivos.'
        );
      } else if (res.notification?.sent && res.notification.mode === 'maintenance_off') {
        onNotify(
          syncedToCloud
            ? 'App de volta online em todos os dispositivos! Notificação de retorno enviada.'
            : 'App de volta online localmente. Clique em "Sincronizar Nuvem" para sincronizar todos os dispositivos.'
        );
      } else if (res.notification && !res.notification.sent) {
        onNotify('Configurações guardadas, mas houve falha ao enviar a notificação de manutenção.', 'error');
      } else {
        onNotify(
          syncedToCloud
            ? 'Configurações gerais guardadas e sincronizadas em tempo real na nuvem!'
            : 'Guardado localmente. Clique em "Sincronizar Nuvem" para refletir em todos os ambientes.'
        );
      }
      onPublicDataChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao guardar configurações.', 'error');
    }
  };

  const handleSaveApiCredentials = async () => {
    try {
      await movixApi.saveAdminEnv(token, {
        tmdbApiKey: tmdbApiKey || undefined,
        tmdbReadToken: tmdbReadToken || undefined,
        megambdServerUrl: megambdServerUrl || undefined,
        megambdEmbedUrl: megambdEmbedUrl || undefined,
        megambdUsername: megambdUsername || undefined,
        megambdPassword: megambdPassword || undefined,
      });
      setTmdbApiKey('');
      setTmdbReadToken('');
      setMegambdPassword('');
      onNotify('Credenciais de integração atualizadas com segurança no servidor.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao atualizar credenciais.', 'error');
    }
  };

  const handleRunDiagnostics = async () => {
    setTestingDiag(true);
    try {
      const res = await movixApi.testAdminApis(token);
      setDiagResult({
        tmdbOk: res.tmdb.connected,
        tmdbMsg: res.tmdb.message,
        megaOk: res.megambd.authValid,
        megaMsg: res.megambd.message,
      });
      setErrorLogs(res.errorLogs);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Falha no diagnóstico.', 'error');
    } finally {
      setTestingDiag(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Configurações Gerais do Sistema</h1>
        <p className="text-xs sm:text-sm text-[#8D97AF]">
          Modo de manutenção, controlo global de anúncios, chaves TMDB/MegamBD, PIN +18, cache e diagnóstico.
        </p>
      </div>

      {/* System toggles */}
      {siteConfig && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">
            <Wrench className="w-4 h-4" /> Operação da Plataforma
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex items-center justify-between p-3.5 rounded-xl bg-[#07090F] border border-white/10 cursor-pointer">
              <div>
                <div className="text-xs font-semibold text-white">Sistema MOVIX ADS Global</div>
                <div className="text-[11px] text-[#8D97AF]">Ativar/desativar exibição de anúncios no site</div>
              </div>
              <input
                type="checkbox"
                checked={siteConfig.adsGlobalEnabled}
                onChange={(e) => setSiteConfig({ ...siteConfig, adsGlobalEnabled: e.target.checked })}
                className="accent-[#E5B85A] w-4 h-4"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-xl bg-[#07090F] border border-white/10 cursor-pointer">
              <div>
                <div className="text-xs font-semibold text-white">Modo de Manutenção</div>
                <div className="text-[11px] text-[#8D97AF]">
                  Bloqueia o site público e envia notificação ao ativar e ao voltar
                </div>
              </div>
              <input
                type="checkbox"
                checked={siteConfig.maintenanceMode}
                onChange={(e) => setSiteConfig({ ...siteConfig, maintenanceMode: e.target.checked })}
                className="accent-[#E5B85A] w-4 h-4"
              />
            </label>

            <div className="p-3.5 rounded-xl bg-[#07090F] border border-white/10">
              <label className="block text-xs font-semibold text-white mb-1">Idioma Padrão</label>
              <select
                value={siteConfig.defaultLanguage}
                onChange={(e) => setSiteConfig({ ...siteConfig, defaultLanguage: e.target.value })}
                className="w-full rounded bg-black/40 border border-white/10 px-2.5 py-1.5 text-xs text-white"
              >
                <option value="pt-PT">Português (PT)</option>
                <option value="pt-BR">Português (BR)</option>
                <option value="en">English</option>
                <option value="es-ES">Español</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleSaveGlobalToggles()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> Guardar Configurações Gerais
            </button>
          </div>
        </div>
      )}

      {/* Integrations & Credentials */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#E5B85A]">
            <KeyRound className="w-4 h-4" /> Integrações TMDB e MegamBD
          </div>
          <button
            type="button"
            disabled={testingDiag}
            onClick={() => void handleRunDiagnostics()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white cursor-pointer"
          >
            {testingDiag ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
            Testar Conexões
          </button>
        </div>

        {diagResult && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className={`p-3 rounded-lg border ${diagResult.tmdbOk ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-red-500/10 border-red-500/25 text-red-300'}`}>
              <div className="font-semibold flex items-center gap-1.5">
                {diagResult.tmdbOk ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                TMDB API
              </div>
              <p className="mt-1 opacity-90">{diagResult.tmdbMsg}</p>
            </div>
            <div className={`p-3 rounded-lg border ${diagResult.megaOk ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-amber-500/10 border-amber-500/25 text-amber-300'}`}>
              <div className="font-semibold flex items-center gap-1.5">
                {diagResult.megaOk ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                MegamBD API
              </div>
              <p className="mt-1 opacity-90">{diagResult.megaMsg}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="password"
            value={tmdbApiKey}
            onChange={(e) => setTmdbApiKey(e.target.value)}
            placeholder="Nova TMDB API Key (deixe vazio para manter)"
            className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />
          <input
            type="password"
            value={tmdbReadToken}
            onChange={(e) => setTmdbReadToken(e.target.value)}
            placeholder="Novo TMDB Read Access Token (opcional)"
            className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />
          <input
            type="text"
            value={megambdServerUrl}
            onChange={(e) => setMegambdServerUrl(e.target.value)}
            placeholder="URL do Servidor MegamBD"
            className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />
          <input
            type="text"
            value={megambdEmbedUrl}
            onChange={(e) => setMegambdEmbedUrl(e.target.value)}
            placeholder="URL Embed MegamBD"
            className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />
          <input
            type="text"
            value={megambdUsername}
            onChange={(e) => setMegambdUsername(e.target.value)}
            placeholder="Utilizador MegamBD (opcional)"
            className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />
          <input
            type="password"
            value={megambdPassword}
            onChange={(e) => setMegambdPassword(e.target.value)}
            placeholder="Senha MegamBD (opcional)"
            className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={adultPin}
              onChange={(e) => setAdultPin(e.target.value)}
              placeholder="Novo PIN +18 (mín. 4 dígitos)"
              className="rounded-lg bg-[#07090F] border border-white/10 px-3 py-2 text-xs text-white w-52"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await movixApi.updateAdminAdultPin(token, adultPin);
                  setAdultPin('');
                  onNotify('PIN +18 atualizado.');
                } catch (err) {
                  onNotify(err instanceof Error ? err.message : 'Erro ao atualizar PIN.', 'error');
                }
              }}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white cursor-pointer"
            >
              Alterar PIN +18
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const res = await movixApi.clearAdminCache(token);
                setCacheCount(0);
                onNotify(`Cache limpo (${res.cleared} entradas removidas).`);
              }}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white/10 text-white cursor-pointer"
            >
              Limpar Cache ({cacheCount})
            </button>
            <button
              type="button"
              onClick={() => void handleSaveApiCredentials()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-[#E5B85A] text-[#06070B] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> Guardar Credenciais
            </button>
          </div>
        </div>
      </div>

      {/* API Error Logs */}
      {errorLogs.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Registo de Erros de API ({errorLogs.length})</h3>
            <button
              type="button"
              onClick={async () => {
                await movixApi.clearAdminErrors(token);
                setErrorLogs([]);
                onNotify('Registos de erro limpos.');
              }}
              className="text-xs text-red-400 hover:underline cursor-pointer"
            >
              Limpar Erros
            </button>
          </div>
          <div className="space-y-1.5 max-h-60 overflow-y-auto text-xs">
            {errorLogs.slice(0, 20).map((e) => (
              <div key={e.id} className="p-2 rounded bg-[#07090F] border border-white/[0.05] flex items-center justify-between gap-2">
                <span className="text-red-300 font-medium">[{e.service}] {e.message}</span>
                <span className="text-[10px] text-[#7D879F] shrink-0">{new Date(e.timestamp).toLocaleTimeString('pt-PT')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
