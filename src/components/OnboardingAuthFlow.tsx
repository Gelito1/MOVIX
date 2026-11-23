import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Mail,
  User as UserIcon,
  X,
} from 'lucide-react';
import { formatFirebaseAuthError, useAuth } from '../contexts/AuthContext';
import { getLanguageLabel } from '../lib/onboarding';
import { BrandMark } from './BrandMark';
import { LanguageSelectorModal } from './LanguageSelectorModal';
import { LegalDocsModal, type LegalTabId } from './LegalDocsModal';
import { PosterWallBackground } from './PosterWallBackground';
import { PWAInstallButton } from './PWAInstallButton';

type FlowStep = 'terms' | 'auth';
type AuthSubView = 'hub' | 'login' | 'register' | 'reset';

interface OnboardingAuthFlowProps {
  mode: 'onboarding' | 'auth';
  initialAuthView?: AuthSubView;
  onFinished: () => void;
  onClose?: () => void;
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const GLASS_CARD_CLASS =
  'rounded-[28px] bg-gradient-to-b from-white/[0.11] via-[#090D16]/42 to-[#06080F]/58 backdrop-blur-md border border-white/[0.22] shadow-[0_24px_70px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.24)]';

const GLASS_INPUT_CLASS =
  'w-full h-11 px-3.5 rounded-xl bg-black/38 backdrop-blur-md border border-white/[0.2] focus:border-[#F3C669]/80 text-sm text-white placeholder:text-white/55 focus:outline-none transition-colors';

export function OnboardingAuthFlow({
  mode,
  initialAuthView = 'hub',
  onFinished,
  onClose,
}: OnboardingAuthFlowProps) {
  const {
    onboarding,
    language,
    t,
    deviceAccount,
    allowNotifications,
    acceptTerms,
    completeOnboarding,
    setPreferredLanguage,
    signInWithGoogle,
    registerWithEmail,
    signInWithEmail,
    sendPasswordReset,
  } = useAuth();

  const [step, setStep] = useState<FlowStep>(() => {
    if (mode === 'auth') return 'auth';
    return 'terms';
  });

  const [termsChecked, setTermsChecked] = useState(true);
  const [authView, setAuthView] = useState<AuthSubView>(initialAuthView);

  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => deviceAccount?.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [legalModalTab, setLegalModalTab] = useState<LegalTabId | null>(null);
  const [langModalOpen, setLangModalOpen] = useState(false);

  useEffect(() => {
    if (deviceAccount?.email) {
      setEmail(deviceAccount.email);
    }
  }, [deviceAccount]);

  const clearFeedback = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleAgreeTerms = async () => {
    if (!termsChecked) {
      setErrorMsg(t.mustAcceptTerms);
      return;
    }
    clearFeedback();
    const shouldRequestNotifications =
      typeof window !== 'undefined' &&
      (!('Notification' in window) || Notification.permission === 'default');
    if (shouldRequestNotifications) {
      setBusy(true);
      try {
        await allowNotifications();
      } finally {
        setBusy(false);
      }
    }
    acceptTerms();
    setStep('auth');
  };

  const handleGoogleAuth = async () => {
    clearFeedback();
    setBusy(true);
    try {
      await signInWithGoogle();
      onFinished();
    } catch (err) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeviceAccountEnter = async () => {
    if (!deviceAccount) return;
    if (deviceAccount.provider === 'google') {
      await handleGoogleAuth();
      return;
    }
    clearFeedback();
    setEmail(deviceAccount.email);
    setPassword('');
    setAuthView('login');
  };

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      onFinished();
    } catch (err) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailRegister = async (e: FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (deviceAccount) {
      setErrorMsg(t.oneAccountPerDeviceError);
      return;
    }
    if (name.trim().length < 2 || !email.trim().includes('@') || password.length < 6) {
      setErrorMsg('Preencha nome, e-mail válido e senha (mín. 6 caracteres).');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('As senhas não coincidem.');
      return;
    }
    setBusy(true);
    try {
      await registerWithEmail(name, email, password);
      onFinished();
    } catch (err) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!email.trim().includes('@')) return;
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setSuccessMsg(t.resetLinkSent);
    } catch (err) {
      setErrorMsg(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleContinueAsGuest = () => {
    completeOnboarding();
    onFinished();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#05060A] text-[#F6F7FB] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="MOVIX"
    >
      {/* Continuous vivid scrolling movie posters behind both Terms & Auth steps */}
      <PosterWallBackground animated={true} intensity="auth" />

      {/* =================================================================== */}
      {/* STEP 1: TERMOS E CONDIÇÕES (TRANSPARENTE SOBRE FILMES ROLANDO)      */}
      {/* =================================================================== */}
      {step === 'terms' && (
        <div className="relative z-10 min-h-full flex flex-col justify-between px-4 sm:px-6 py-6 sm:py-8">
          <div className="w-full max-w-5xl mx-auto flex items-center justify-between gap-3">
            <BrandMark size="sm" />
            <button
              type="button"
              onClick={() => setLangModalOpen(true)}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-2xl bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/[0.22] text-xs font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors cursor-pointer"
            >
              <Globe className="h-3.5 w-3.5 text-[#F4CB73]" aria-hidden="true" />
              <span>{getLanguageLabel(language)}</span>
            </button>
          </div>

          <div className={`w-full max-w-[400px] mx-auto my-8 p-6 sm:p-7 space-y-5 ${GLASS_CARD_CLASS}`}>
            <h1 className="text-xl sm:text-2xl font-bold text-white text-balance drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
              {t.termsTitle}
            </h1>

            <p className="text-sm text-[#EEF2FB] leading-relaxed drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
              {t.termsBody}
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <button
                type="button"
                onClick={() => setLegalModalTab('termos')}
                className="text-[#F4CB73] font-medium hover:underline cursor-pointer drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]"
              >
                {t.termsOfUse}
              </button>
              <button
                type="button"
                onClick={() => setLegalModalTab('privacidade')}
                className="text-[#F4CB73] font-medium hover:underline cursor-pointer drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]"
              >
                {t.privacyPolicy}
              </button>
              <button
                type="button"
                onClick={() => setLegalModalTab('dmca')}
                className="text-white/85 hover:text-white hover:underline cursor-pointer drop-shadow-[0_1px_6px_rgba(0,0,0,0.7)]"
              >
                {t.legalNotice}
              </button>
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={(e) => {
                  setTermsChecked(e.target.checked);
                  if (e.target.checked) setErrorMsg(null);
                }}
                className="mt-0.5 h-4 w-4 rounded accent-[#E5B85A] cursor-pointer shrink-0"
              />
              <span className="text-xs text-white/90 leading-relaxed drop-shadow-[0_1px_5px_rgba(0,0,0,0.7)]">
                {t.termsCheckboxPrefix} {t.termsOfUse} {t.andWord} {t.privacyPolicy}.
              </span>
            </label>

            {errorMsg && (
              <p
                className="rounded-xl bg-rose-500/20 backdrop-blur-md border border-rose-400/40 px-3 py-2 text-xs text-rose-100"
                role="alert"
              >
                {errorMsg}
              </p>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAgreeTerms()}
              className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#D9A441] via-[#F4CB73] to-[#D9A441] text-[#090B11] font-bold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-[0_12px_30px_rgba(229,184,90,0.34)] cursor-pointer disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <span>{t.agreeAndContinue}</span>
            </button>
          </div>

          <div className="w-full flex flex-col items-center gap-3 pb-1">
            <PWAInstallButton variant="onboarding" />
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STEP 2: CONTA / LOGIN (TRANSPARENTE SOBRE FILMES ROLANDO PRA CIMA)  */}
      {/* =================================================================== */}
      {step === 'auth' && (
        <div className="relative z-10 min-h-full flex flex-col justify-between px-4 sm:px-6 py-6 sm:py-8">
          {/* Minimal Floating Glass Top Bar */}
          <div className="w-full max-w-5xl mx-auto flex items-center justify-between gap-3">
            <BrandMark size="sm" />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLangModalOpen(true)}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-2xl bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/[0.22] text-xs font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors cursor-pointer"
              >
                <Globe className="h-3.5 w-3.5 text-[#F4CB73]" aria-hidden="true" />
                <span>{getLanguageLabel(language)}</span>
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t.close}
                  className="h-10 w-10 rounded-2xl bg-black/35 hover:bg-black/50 backdrop-blur-md border border-white/[0.22] text-white flex items-center justify-center shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Crystal Transparent Floating Auth Card */}
          <div className={`w-full max-w-[388px] mx-auto my-6 p-6 sm:p-7 ${GLASS_CARD_CLASS}`}>
            {/* HUB: DEVICE ALREADY BOUND TO 1 ACCOUNT */}
            {authView === 'hub' && deviceAccount && (
              <div className="space-y-4 text-center">
                <h1 className="text-lg font-bold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                  {t.deviceBoundTitle}
                </h1>

                <div className="rounded-2xl bg-black/35 backdrop-blur-md border border-white/[0.18] px-4 py-3.5 flex items-center gap-3 text-left">
                  {deviceAccount.photoURL ? (
                    <img
                      src={deviceAccount.photoURL}
                      alt={deviceAccount.displayName}
                      referrerPolicy="no-referrer"
                      className="h-10 w-10 rounded-full object-cover shrink-0 border border-[#E5B85A]/45"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-[#E5B85A]/25 text-[#F4CB73] font-bold text-sm flex items-center justify-center shrink-0">
                      {deviceAccount.displayName[0]?.toUpperCase() || 'M'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">
                      {deviceAccount.displayName}
                    </p>
                    <p className="text-xs text-white/75 truncate">{deviceAccount.email}</p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDeviceAccountEnter()}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#D9A441] via-[#F4CB73] to-[#D9A441] text-[#090B11] font-bold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-[0_12px_30px_rgba(229,184,90,0.34)] cursor-pointer disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  <span>{t.enterAccount}</span>
                </button>

                <p className="text-[11px] text-white/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
                  {t.deviceBoundHint}
                </p>
              </div>
            )}

            {/* HUB: NEW DEVICE (NO ACCOUNT BOUND YET) */}
            {authView === 'hub' && !deviceAccount && (
              <div className="space-y-3.5">
                <h1 className="text-xl sm:text-2xl font-bold text-center text-white pb-1 drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                  {t.createOrSignIn}
                </h1>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    clearFeedback();
                    setAuthView('login');
                  }}
                  className="w-full h-12 px-4 rounded-2xl bg-white/[0.12] hover:bg-white/[0.2] backdrop-blur-md border border-white/[0.26] text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-[0_8px_22px_rgba(0,0,0,0.28)] transition-all cursor-pointer disabled:opacity-60"
                >
                  <UserIcon className="h-4 w-4 text-[#F4CB73] shrink-0" aria-hidden="true" />
                  <span>{t.signInButton}</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleGoogleAuth()}
                  className="w-full h-12 px-4 rounded-2xl bg-white/94 hover:bg-white text-[#0B0E17] font-semibold text-sm flex items-center justify-center gap-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.32)] transition-all cursor-pointer disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#0B0E17]" aria-hidden="true" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span>{t.continueWithGoogle}</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    clearFeedback();
                    setAuthView('register');
                  }}
                  className="w-full h-12 px-4 rounded-2xl bg-gradient-to-r from-[#D9A441] via-[#F4CB73] to-[#D9A441] text-[#090B11] font-bold text-sm flex items-center justify-center gap-2.5 hover:brightness-105 shadow-[0_12px_30px_rgba(229,184,90,0.34)] transition-all cursor-pointer disabled:opacity-60"
                >
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t.createWithEmail}</span>
                </button>

                {mode === 'onboarding' && (
                  <div className="pt-1.5 text-center">
                    <button
                      type="button"
                      onClick={handleContinueAsGuest}
                      className="text-xs font-medium text-white/85 hover:text-white transition-colors cursor-pointer py-1.5 px-3 drop-shadow-[0_1px_6px_rgba(0,0,0,0.75)]"
                    >
                      {t.exploreLater}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* EMAIL LOGIN FORM */}
            {authView === 'login' && (
              <form onSubmit={handleEmailLogin} className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setAuthView('hub');
                    }}
                    className="h-9 w-9 rounded-xl bg-white/[0.12] hover:bg-white/[0.2] border border-white/[0.18] flex items-center justify-center text-white cursor-pointer transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <h2 className="text-base font-bold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
                    {t.signInTitle}
                  </h2>
                </div>

                <input
                  type="email"
                  autoComplete="email"
                  required
                  readOnly={Boolean(deviceAccount)}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailLabel}
                  className={`${GLASS_INPUT_CLASS} read-only:opacity-75`}
                />

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.passwordLabel}
                    className={`${GLASS_INPUT_CLASS} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/75 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F4CB73] to-[#D9A441] text-[#090B11] font-bold text-sm flex items-center justify-center gap-2 hover:brightness-105 shadow-[0_10px_26px_rgba(229,184,90,0.32)] cursor-pointer disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  <span>{t.signInButton}</span>
                </button>

                <div className="flex items-center justify-between text-xs pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setAuthView('reset');
                    }}
                    className="text-white/85 hover:text-[#F4CB73] cursor-pointer drop-shadow-[0_1px_5px_rgba(0,0,0,0.75)]"
                  >
                    {t.forgotPassword}
                  </button>
                  {!deviceAccount && (
                    <button
                      type="button"
                      onClick={() => {
                        clearFeedback();
                        setAuthView('register');
                      }}
                      className="text-[#F4CB73] font-semibold hover:underline cursor-pointer drop-shadow-[0_1px_5px_rgba(0,0,0,0.75)]"
                    >
                      {t.createNewAccount}
                    </button>
                  )}
                </div>
              </form>
            )}

            {/* MANUAL EMAIL REGISTRATION FORM */}
            {authView === 'register' && !deviceAccount && (
              <form onSubmit={handleEmailRegister} className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setAuthView('hub');
                    }}
                    className="h-9 w-9 rounded-xl bg-white/[0.12] hover:bg-white/[0.2] border border-white/[0.18] flex items-center justify-center text-white cursor-pointer transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <h2 className="text-base font-bold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
                    {t.createAccountTitle}
                  </h2>
                </div>

                <input
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t.namePlaceholder}
                  className={GLASS_INPUT_CLASS}
                />

                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailLabel}
                  className={GLASS_INPUT_CLASS}
                />

                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.passwordLabel}
                  className={GLASS_INPUT_CLASS}
                />

                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t.confirmPasswordLabel}
                  className={GLASS_INPUT_CLASS}
                />

                <label className="inline-flex items-center gap-2 text-xs text-white/85 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="accent-[#E5B85A] cursor-pointer"
                  />
                  <span>{t.showPasswords}</span>
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F4CB73] to-[#D9A441] text-[#090B11] font-bold text-sm flex items-center justify-center gap-2 hover:brightness-105 shadow-[0_10px_26px_rgba(229,184,90,0.32)] cursor-pointer disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  <span>{t.createAccountTitle}</span>
                </button>

                <p className="text-center text-xs text-white/85 drop-shadow-[0_1px_5px_rgba(0,0,0,0.75)]">
                  {t.alreadyHaveAccount}{' '}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setAuthView('login');
                    }}
                    className="text-[#F4CB73] font-semibold hover:underline cursor-pointer"
                  >
                    {t.signInButton}
                  </button>
                </p>
              </form>
            )}

            {/* FORGOT PASSWORD FORM */}
            {authView === 'reset' && (
              <form onSubmit={handlePasswordReset} className="space-y-3.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setAuthView('login');
                    }}
                    className="h-9 w-9 rounded-xl bg-white/[0.12] hover:bg-white/[0.2] border border-white/[0.18] flex items-center justify-center text-white cursor-pointer transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <h2 className="text-base font-bold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
                    {t.recoverPasswordTitle}
                  </h2>
                </div>

                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.emailLabel}
                  className={GLASS_INPUT_CLASS}
                />

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-[#D9A441] via-[#F4CB73] to-[#D9A441] text-[#090B11] font-bold text-sm flex items-center justify-center gap-2 hover:brightness-105 shadow-[0_10px_26px_rgba(229,184,90,0.32)] cursor-pointer disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  <span>{t.sendResetLink}</span>
                </button>
              </form>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="mt-3.5 rounded-xl bg-rose-500/20 backdrop-blur-md border border-rose-400/40 px-3 py-2 text-xs text-rose-100 leading-relaxed"
              >
                {errorMsg}
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="mt-3.5 rounded-xl bg-emerald-500/20 backdrop-blur-md border border-emerald-400/40 px-3 py-2 text-xs text-emerald-100 flex items-start gap-2"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{successMsg}</span>
              </div>
            )}
          </div>

          {/* Quiet Minimal Legal Line */}
          <div className="w-full max-w-md mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-white/85 drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]">
            <button
              type="button"
              onClick={() => setLegalModalTab('termos')}
              className="hover:text-[#F4CB73] transition-colors cursor-pointer"
            >
              {t.termsOfUse}
            </button>
            <span className="text-white/35" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setLegalModalTab('privacidade')}
              className="hover:text-[#F4CB73] transition-colors cursor-pointer"
            >
              {t.privacyPolicy}
            </button>
            <span className="text-white/35" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => {
                clearFeedback();
                setAuthView('reset');
              }}
              className="hover:text-[#F4CB73] transition-colors cursor-pointer"
            >
              {t.forgotPassword}
            </button>
          </div>
        </div>
      )}

      <LegalDocsModal
        open={legalModalTab !== null}
        initialTab={legalModalTab || 'termos'}
        onClose={() => setLegalModalTab(null)}
        onAccept={step === 'terms' ? () => setTermsChecked(true) : undefined}
      />

      <LanguageSelectorModal
        open={langModalOpen}
        currentLanguage={language}
        onSelect={(lang) => void setPreferredLanguage(lang)}
        onClose={() => setLangModalOpen(false)}
      />
    </div>
  );
}
