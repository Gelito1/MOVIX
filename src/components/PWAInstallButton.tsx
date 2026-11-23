import { useState } from 'react';
import { Check, Copy, Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'onboarding';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { t } = useAuth();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  if (isInstalled) {
    return null;
  }

  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) return;
    }
    setShowGuide(true);
  };

  const handleCopyLink = async () => {
    if (!appOrigin || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(appOrigin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <>
      {variant === 'onboarding' ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          aria-label={t.installApp}
          className="group w-full max-w-[400px] mx-auto rounded-2xl bg-gradient-to-r from-[#0B0F1A]/70 via-[#121829]/62 to-[#0B0F1A]/70 hover:from-[#101626]/82 hover:to-[#101626]/82 backdrop-blur-md border border-[#E5B85A]/45 hover:border-[#F4CB73]/80 px-4 py-3 flex items-center gap-3.5 text-left shadow-[0_16px_42px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.99] transition-all cursor-pointer"
        >
          <img
            src="/pwa-192x192.png"
            alt="MOVIX"
            className="h-10 w-10 rounded-xl object-cover shrink-0 border border-[#E5B85A]/45 shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
          />

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white leading-tight truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
              {t.installApp} MOVIX
            </p>
            <p className="text-[11px] text-[#E9D7AC] mt-0.5 truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.75)]">
              Instale no dispositivo · Acesso rápido e offline
            </p>
          </div>

          <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#D9A441] via-[#F4CB73] to-[#C89232] text-[#090B11] flex items-center justify-center shrink-0 shadow-[0_6px_18px_rgba(229,184,90,0.38)] group-hover:scale-105 transition-transform">
            <Download className="h-4 w-4" aria-hidden="true" />
          </span>
        </button>
      ) : (
        <button
          type="button"
          data-tour="app-install"
          onClick={() => void handleClick()}
          aria-label={t.installApp}
          className="inline-flex items-center gap-1.5 h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] hover:brightness-105 text-[#07080C] text-xs sm:text-sm font-semibold shadow-[0_4px_16px_rgba(229,184,90,0.28)] transition-all cursor-pointer shrink-0 whitespace-nowrap"
        >
          <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" aria-hidden="true" />
          <span>{t.installApp}</span>
        </button>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-[90] bg-[#040509]/88 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Instalar aplicativo MOVIX"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#0F131E] border border-white/15 shadow-2xl p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="Ícone MOVIX"
                  className="h-12 w-12 rounded-xl border border-[#E5B85A]/40 object-cover shrink-0"
                />
                <div>
                  <h3 className="font-display text-lg font-bold text-[#F6F7FB]">
                    Instalar App MOVIX
                  </h3>
                  <p className="text-xs text-[#95A0B8]">
                    Versão aplicativo para ecrã inicial e modo ecrã inteiro
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Fechar janela de instalação"
                className="h-8 w-8 rounded-lg bg-[#161B29] hover:bg-white/15 border border-white/10 flex items-center justify-center text-[#D1D7E6] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="rounded-xl bg-[#07090F] border border-white/[0.08] p-4 space-y-2.5 text-xs sm:text-sm text-[#D1D7E6]">
                <p className="font-semibold text-[#F3C669] flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  <span>Como instalar no iPhone / iPad (Safari):</span>
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-[#B8C0D4]">
                  <li>
                    Toque no botão{' '}
                    <strong className="text-[#F6F7FB] inline-flex items-center gap-1">
                      <Share className="h-3.5 w-3.5 inline" /> Partilhar
                    </strong>{' '}
                    na barra do Safari.
                  </li>
                  <li>
                    Desça e selecione <strong className="text-[#F6F7FB]">Adicionar ao Ecrã Principal</strong>.
                  </li>
                  <li>
                    Toque em <strong className="text-[#F6F7FB]">Adicionar</strong> para abrir o MOVIX como app.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="rounded-xl bg-[#07090F] border border-white/[0.08] p-4 space-y-2.5 text-xs sm:text-sm text-[#D1D7E6]">
                <p className="font-semibold text-[#F3C669] flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  <span>Como instalar no Android, Windows ou Mac:</span>
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-[#B8C0D4]">
                  <li>
                    Abra o link direto do app no <strong className="text-[#F6F7FB]">Chrome</strong> ou{' '}
                    <strong className="text-[#F6F7FB]">Edge</strong> (fora da pré-visualização).
                  </li>
                  <li>
                    Toque no menu <strong className="text-[#F6F7FB]">⋮</strong> e escolha{' '}
                    <strong className="text-[#F6F7FB]">Instalar aplicativo</strong> ou{' '}
                    <strong className="text-[#F6F7FB]">Adicionar ao ecrã inicial</strong>.
                  </li>
                </ol>
              </div>
            )}

            {appOrigin && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#95A0B8]">
                  Link direto do App para abrir ou instalar:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={appOrigin}
                    aria-label="Link direto do aplicativo MOVIX"
                    className="flex-1 h-10 px-3 rounded-lg bg-[#07090F] border border-white/10 text-xs font-mono text-[#D1D7E6] select-all"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] text-xs font-semibold cursor-pointer shrink-0"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator({ onOpenOffline }: { onOpenOffline?: () => void }) {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-5 left-4 z-50 flex items-center gap-2.5 rounded-xl bg-[#0F131E]/95 backdrop-blur-md border border-[#E5B85A]/45 px-3.5 py-2 text-xs font-medium text-[#F3C669] shadow-2xl">
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Modo Offline — Dados em cache local</span>
      {onOpenOffline && (
        <button
          type="button"
          onClick={onOpenOffline}
          className="ml-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] text-[11px] font-semibold cursor-pointer hover:brightness-105 transition-all"
        >
          Ver Offline
        </button>
      )}
    </div>
  );
}
