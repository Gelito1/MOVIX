import { useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  ChevronRight,
  Compass,
  FileText,
  Globe,
  LogOut,
  MailCheck,
  RefreshCw,
  Shield,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getLanguageLabel } from '../lib/onboarding';
import { getTourUiLabels } from '../lib/tour';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { LegalDocsModal, type LegalTabId } from './LegalDocsModal';

const OWNER_ADMIN_EMAIL = 'gelitontn1@gmail.com';

interface AccountModalProps {
  open: boolean;
  onClose: () => void;
  onReplayTutorial?: () => void;
  onOpenAdminPanel?: () => Promise<void> | void;
}

export function AccountModal({ open, onClose, onReplayTutorial, onOpenAdminPanel }: AccountModalProps) {
  const {
    user,
    onboarding,
    language,
    t,
    setPreferredLanguage,
    toggleNotifications,
    pushPrefs,
    updatePushPrefs,
    resendVerificationEmail,
    refreshAuthUser,
    logout,
  } = useAuth();

  const [langModalOpen, setLangModalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTabId | null>(null);
  const [prefsExpanded, setPrefsExpanded] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open || !user) return null;

  const displayName = user.displayName || user.email?.split('@')[0] || 'MOVIX';
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
  const isGoogle = user.providerData.some((p) => p.providerId === 'google.com');
  const notificationsOn = onboarding.notificationsDecision === 'granted';
  const isOwnerProfile =
    user.authSource === 'firebase' &&
    Boolean(user.email) &&
    user.email!.trim().toLowerCase() === OWNER_ADMIN_EMAIL &&
    Boolean(user.emailVerified);

  const handleVerifyCheck = async () => {
    setBusy(true);
    setStatusNote(null);
    try {
      const verified = await refreshAuthUser();
      setStatusNote(verified ? 'OK!' : t.verifyEmailNotice);
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    setBusy(true);
    setStatusNote(null);
    try {
      await resendVerificationEmail();
      setStatusNote(t.resetLinkSent);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logout();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const pushCategoryItems: Array<{
    key: keyof typeof pushPrefs;
    label: string;
  }> = [
    { key: 'new_movies', label: 'Novos Filmes no Catálogo' },
    { key: 'new_seasons', label: 'Novas Temporadas e Episódios' },
    { key: 'app_updates', label: 'Atualizações do App' },
    { key: 'recommendations', label: 'Recomendações Especiais' },
  ];

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="movix-account-title"
    >
      <div className="w-full max-w-sm rounded-t-3xl sm:rounded-2xl bg-[#0D111C] border border-white/[0.1] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between shrink-0">
          <h2 id="movix-account-title" className="text-base font-bold text-[#F6F7FB]">
            {t.myProfile}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="h-9 w-9 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-[#C8D0E0] flex items-center justify-center cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4 overflow-y-auto">
          {/* Clean Identity Row */}
          <div className="flex items-center gap-3.5">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={displayName}
                referrerPolicy="no-referrer"
                className="h-12 w-12 rounded-full object-cover border border-[#E5B85A]/35 shrink-0"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#D9A441] to-[#8C621B] text-[#090B11] font-bold text-base flex items-center justify-center shrink-0">
                {initials || 'M'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#F6F7FB] truncate">{displayName}</p>
              <p className="text-xs text-[#9BA5BC] truncate">{user.email}</p>
              <p className="text-[11px] text-[#7D88A1] mt-0.5">
                {isGoogle ? t.connectedGoogle : t.connectedEmail}
              </p>
            </div>
          </div>

          {user.authSource === 'firebase' && !user.emailVerified && (
            <div className="rounded-xl bg-[#E5B85A]/10 border border-[#E5B85A]/25 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <MailCheck className="h-4 w-4 text-[#F3C669] shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-[#E8DFC5] leading-relaxed">{t.verifyEmailNotice}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleVerifyCheck()}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#E5B85A] text-[#090B11] text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  <span>{t.verifiedCheckBtn}</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResendVerification()}
                  className="h-7 px-2.5 rounded-lg bg-white/[0.08] text-xs text-[#E5E9F2] cursor-pointer"
                >
                  {t.resendLinkBtn}
                </button>
              </div>
            </div>
          )}

          {statusNote && (
            <div className="rounded-xl bg-emerald-500/12 border border-emerald-500/25 px-3 py-2 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
              <span>{statusNote}</span>
            </div>
          )}

          {/* Clean Settings Rows */}
          <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
            <button
              type="button"
              onClick={() => setLangModalOpen(true)}
              className="w-full min-h-[50px] py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-[#F3C669] shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium text-[#F6F7FB]">{t.language}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#9BA5BC]">
                <span>{getLanguageLabel(language)}</span>
                <ChevronRight className="h-4 w-4 text-[#6E778E]" aria-hidden="true" />
              </div>
            </button>

            {/* Notification Preferences Accordion */}
            <div className="py-1">
              <button
                type="button"
                onClick={() => setPrefsExpanded((v) => !v)}
                className="w-full min-h-[46px] py-2 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  {notificationsOn ? (
                    <Bell className="h-4 w-4 text-[#F3C669] shrink-0" aria-hidden="true" />
                  ) : (
                    <BellOff className="h-4 w-4 text-[#8D97AF] shrink-0" aria-hidden="true" />
                  )}
                  <span className="text-sm font-medium text-[#F6F7FB]">{t.notifications}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-medium ${
                      notificationsOn ? 'text-[#F3C669]' : 'text-[#8D97AF]'
                    }`}
                  >
                    {notificationsOn ? t.active : t.activate}
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 text-[#6E778E] transition-transform ${
                      prefsExpanded ? 'rotate-90' : ''
                    }`}
                    aria-hidden="true"
                  />
                </div>
              </button>

              {prefsExpanded && (
                <div className="pb-3 pt-1 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                    <span className="text-xs font-medium text-[#D5DCEB]">
                      {notificationsOn ? 'Push ativado neste dispositivo' : 'Receber alertas Push'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleNotifications()}
                      className={`h-7 px-3 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                        notificationsOn
                          ? 'bg-white/[0.08] text-[#C8D0E0] hover:bg-white/[0.14]'
                          : 'bg-[#E5B85A] text-[#08090C]'
                      }`}
                    >
                      {notificationsOn ? 'Pausar' : t.activate}
                    </button>
                  </div>

                  {!notificationsOn &&
                    typeof window !== 'undefined' &&
                    'Notification' in window &&
                    Notification.permission === 'denied' && (
                      <p className="text-[11px] leading-relaxed text-[#E8C574]/90 bg-[#E5B85A]/10 border border-[#E5B85A]/20 rounded-xl px-3 py-2">
                        As notificações foram bloqueadas neste navegador. Toque no ícone do cadeado
                        na barra de endereço e permita <strong>Notificações</strong> para o MOVIX.
                      </p>
                    )}

                  <div className="space-y-1.5 pl-1">
                    {pushCategoryItems.map((cat) => {
                      const enabled = pushPrefs[cat.key];
                      return (
                        <button
                          key={cat.key}
                          type="button"
                          onClick={() => void updatePushPrefs({ [cat.key]: !enabled })}
                          className="w-full py-1.5 flex items-center justify-between gap-3 text-left cursor-pointer"
                        >
                          <span className="text-xs text-[#C8D0E2]">{cat.label}</span>
                          <span
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                              enabled ? 'bg-[#E5B85A]' : 'bg-white/15'
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 rounded-full bg-[#08090C] transition-transform ${
                                enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                              }`}
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {onReplayTutorial && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReplayTutorial();
                }}
                className="w-full min-h-[50px] py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Compass className="h-4 w-4 text-[#F3C669] shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="block text-sm font-medium text-[#F6F7FB] truncate">
                      {getTourUiLabels(language).replayTitle}
                    </span>
                    <span className="block text-[11px] text-[#8D97AF] truncate">
                      {getTourUiLabels(language).replaySubtitle}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#6E778E] shrink-0" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setLegalTab('termos')}
              className="w-full min-h-[50px] py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-[#A0ABC2] shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium text-[#F6F7FB]">{t.termsAndPrivacy}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-[#6E778E]" aria-hidden="true" />
            </button>

            {isOwnerProfile && onOpenAdminPanel && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setStatusNote(null);
                  try {
                    await onOpenAdminPanel();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full min-h-[52px] py-2.5 flex items-center justify-between gap-3 text-left hover:bg-[#E5B85A]/[0.08] transition-colors cursor-pointer disabled:opacity-60"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Shield className="h-4 w-4 text-[#E5B85A] shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="block text-sm font-semibold text-[#F4CB73] truncate">
                      MOVIX ADM
                    </span>
                    <span className="block text-[11px] text-[#8D97AF] truncate">
                      Painel de controlo privado sincronizado
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#E5B85A]/80 shrink-0" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleLogout()}
            className="w-full h-11 rounded-xl bg-rose-500/12 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>{t.signOut}</span>
          </button>
        </div>
      </div>

      <LanguageSelectorModal
        open={langModalOpen}
        currentLanguage={language}
        onSelect={(lang) => void setPreferredLanguage(lang)}
        onClose={() => setLangModalOpen(false)}
      />

      <LegalDocsModal
        open={legalTab !== null}
        initialTab={legalTab || 'termos'}
        onClose={() => setLegalTab(null)}
      />
    </div>
  );
}
