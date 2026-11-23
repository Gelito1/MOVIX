import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Eye,
  Loader2,
  Search,
  Shield,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { admApi } from '../../lib/admApi';
import type { RegisteredUserRecord } from '../../types/adm';

interface UsersSectionProps {
  token: string;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export function UsersSection({ token, onNotify }: UsersSectionProps) {
  const [users, setUsers] = useState<RegisteredUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [inspecting, setInspecting] = useState<RegisteredUserRecord | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await admApi.listUsers(token);
      setUsers(res.users);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao carregar utilizadores.', 'error');
    } finally {
      setLoading(false);
    }
  }, [token, onNotify]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleToggleBlock = async (u: RegisteredUserRecord) => {
    const nextStatus = u.status === 'blocked' ? 'active' : 'blocked';
    try {
      const res = await admApi.updateUser(token, u.uid, { status: nextStatus });
      onNotify(nextStatus === 'blocked' ? `Conta de ${u.displayName} bloqueada.` : `Conta de ${u.displayName} desbloqueada.`);
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? res.user : x)));
      if (inspecting?.uid === u.uid) setInspecting(res.user);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao atualizar utilizador.', 'error');
    }
  };

  const handleRoleChange = async (u: RegisteredUserRecord, role: RegisteredUserRecord['role']) => {
    try {
      const res = await admApi.updateUser(token, u.uid, { role });
      onNotify(`Nível de acesso de ${u.displayName} alterado para ${role.toUpperCase()}.`);
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? res.user : x)));
      if (inspecting?.uid === u.uid) setInspecting(res.user);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao alterar permissão.', 'error');
    }
  };

  const handleDeleteUser = async (u: RegisteredUserRecord) => {
    if (!window.confirm(`Remover o registo do utilizador "${u.displayName}" (${u.email})?`)) return;
    try {
      await admApi.deleteUser(token, u.uid);
      onNotify('Registo de utilizador removido.');
      setUsers((prev) => prev.filter((x) => x.uid !== u.uid));
      if (inspecting?.uid === u.uid) setInspecting(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao remover utilizador.', 'error');
    }
  };

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    const matchesQ =
      !q ||
      u.displayName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.uid.toLowerCase().includes(q);
    if (!matchesQ) return false;
    if (statusFilter === 'active') return u.status === 'active';
    if (statusFilter === 'blocked') return u.status === 'blocked';
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-white">Gestão de Utilizadores</h1>
        <p className="text-xs sm:text-sm text-[#8D97AF]">
          Consulte contas registadas no MOVIX, gerencie bloqueios, níveis de acesso e histórico recente. Senhas nunca são armazenadas ou exibidas.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#0B0E17] p-4 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#6E778E] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome, e-mail ou UID..."
              className="w-full rounded-lg bg-[#07090F] border border-white/10 pl-9 pr-3 py-2 text-xs text-white"
            />
          </div>
          <div className="flex gap-1.5">
            {(
              [
                { id: 'all', label: `Todos (${users.length})` },
                { id: 'active', label: 'Ativos' },
                { id: 'blocked', label: 'Bloqueados' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs border cursor-pointer ${
                  statusFilter === f.id
                    ? 'bg-[#E5B85A]/15 text-[#F4CB73] border-[#E5B85A]/35'
                    : 'bg-[#07090F] text-[#8D97AF] border-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs text-[#8D97AF]">
            <Loader2 className="w-4 h-4 animate-spin text-[#E5B85A]" /> A carregar utilizadores...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#6E778E]">
            Nenhum utilizador sincronizado ainda. As contas aparecem automaticamente quando os utilizadores iniciam sessão no MOVIX.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-white/[0.06] text-[#8D97AF]">
                  <th className="py-2.5 pr-3">Utilizador</th>
                  <th className="py-2.5 px-2">Nível</th>
                  <th className="py-2.5 px-2">Atividade</th>
                  <th className="py-2.5 px-2">Estado</th>
                  <th className="py-2.5 pl-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filtered.map((u) => (
                  <tr key={u.uid} className="hover:bg-white/[0.02]">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2.5">
                        {u.photoURL ? (
                          <img src={u.photoURL} alt={u.displayName} className="w-8 h-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 text-[#E5B85A]">
                            <UserIcon className="w-4 h-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate max-w-[200px]">{u.displayName}</p>
                          <p className="text-[11px] text-[#8D97AF] truncate max-w-[220px]">{u.email || u.uid}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <select
                        value={u.role}
                        onChange={(e) => void handleRoleChange(u, e.target.value as RegisteredUserRecord['role'])}
                        className="rounded bg-[#07090F] border border-white/10 px-2 py-1 text-[11px] text-white"
                      >
                        <option value="user">Utilizador</option>
                        <option value="vip">VIP</option>
                        <option value="moderator">Moderador</option>
                      </select>
                    </td>
                    <td className="py-3 px-2 text-[#D4D9E6] whitespace-nowrap">
                      <div>{u.watchCount} views · {u.favoritesCount} fav.</div>
                      <div className="text-[10px] text-[#7D879F]">
                        Visto em {new Date(u.lastActiveAt).toLocaleDateString('pt-PT')}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          u.status === 'active'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {u.status === 'active' ? 'Ativo' : 'Bloqueado'}
                      </span>
                    </td>
                    <td className="py-3 pl-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setInspecting(u)}
                          className="p-1.5 rounded-lg bg-white/5 text-[#D4D9E6] hover:text-[#E5B85A] cursor-pointer"
                          title="Ver perfil e histórico"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleBlock(u)}
                          className={`p-1.5 rounded-lg cursor-pointer ${
                            u.status === 'blocked'
                              ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                              : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                          }`}
                          title={u.status === 'blocked' ? 'Desbloquear' : 'Bloquear'}
                        >
                          {u.status === 'blocked' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteUser(u)}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer"
                          title="Eliminar registo"
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

      {/* User Profile Drawer */}
      {inspecting && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-[#0B0E17] border-l border-white/10 h-full overflow-y-auto p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#E5B85A]" />
                <h3 className="text-sm font-bold text-white">Perfil do Utilizador</h3>
              </div>
              <button type="button" onClick={() => setInspecting(null)} className="text-[#8D97AF] hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-[#07090F] border border-white/[0.07]">
              {inspecting.photoURL ? (
                <img src={inspecting.photoURL} alt={inspecting.displayName} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-[#E5B85A]">
                  <UserIcon className="w-6 h-6" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{inspecting.displayName}</p>
                <p className="text-xs text-[#8D97AF] truncate">{inspecting.email}</p>
                <p className="text-[10px] text-[#6E778E] mt-0.5">
                  Provedor: {inspecting.provider} · Idioma: {inspecting.preferredLanguage}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 rounded-lg bg-[#07090F] border border-white/[0.06]">
                <div className="text-[#8D97AF]">Registo</div>
                <div className="text-white font-semibold mt-1">
                  {new Date(inspecting.createdAt).toLocaleDateString('pt-PT')}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#07090F] border border-white/[0.06]">
                <div className="text-[#8D97AF]">Última Atividade</div>
                <div className="text-white font-semibold mt-1">
                  {new Date(inspecting.lastActiveAt).toLocaleString('pt-PT')}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#07090F] border border-white/[0.06]">
                <div className="text-[#8D97AF]">Favoritos</div>
                <div className="text-white font-semibold mt-1">{inspecting.favoritesCount}</div>
              </div>
              <div className="p-3 rounded-lg bg-[#07090F] border border-white/[0.06]">
                <div className="text-[#8D97AF]">Visualizações</div>
                <div className="text-white font-semibold mt-1">{inspecting.watchCount}</div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[#8D97AF]">Atividade Recente</h4>
              {inspecting.recentTitles.length === 0 ? (
                <p className="text-xs text-[#6E778E]">Sem títulos recentes registados.</p>
              ) : (
                <div className="space-y-1.5">
                  {inspecting.recentTitles.map((item, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-[#07090F] border border-white/[0.06] flex items-center justify-between text-xs">
                      <span className="text-white truncate pr-2">{item.title}</span>
                      <span className="text-[10px] text-[#8D97AF] shrink-0">
                        {new Date(item.watchedAt).toLocaleDateString('pt-PT')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
