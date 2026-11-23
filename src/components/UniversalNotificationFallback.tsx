import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import {
  FALLBACK_NOTIFICATION_EVENT,
  type FallbackNotificationDetail,
} from '../lib/pushNotifications';

function getSafeExternalUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

/**
 * Renders ONLY on browsers that physically lack the native window.Notification API
 * (e.g. iOS Safari regular tab outside Home Screen, or in-app WebViews like WhatsApp/Instagram).
 * Browsers with native Notification support always deliver directly to the device OS tray.
 */
export function UniversalNotificationFallback() {
  const [item, setItem] = useState<FallbackNotificationDetail | null>(null);

  useEffect(() => {
    let dismissTimer: number | null = null;

    const handleEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<FallbackNotificationDetail>).detail;
      if (!detail || (!detail.title && !detail.body)) return;
      setItem(detail);
      if (dismissTimer) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => {
        setItem(null);
      }, 6000);
    };

    window.addEventListener(FALLBACK_NOTIFICATION_EVENT, handleEvent);
    return () => {
      window.removeEventListener(FALLBACK_NOTIFICATION_EVENT, handleEvent);
      if (dismissTimer) window.clearTimeout(dismissTimer);
    };
  }, []);

  if (!item) return null;

  const externalHref = getSafeExternalUrl(item.targetUrl);

  const handleOpenInternal = () => {
    const target = item.targetUrl;
    setItem(null);
    if (target && target.startsWith('#/')) {
      window.location.hash = target;
    } else if (target && target.startsWith('/') && !target.startsWith('//')) {
      window.location.assign(target);
    }
  };

  const innerContent = (
    <>
      {item.imageUrl ? (
        <div className="h-11 w-11 rounded-xl overflow-hidden bg-[#07090F] border border-white/10 shrink-0 mt-0.5">
          <img
            src={item.imageUrl}
            alt={item.title}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="h-9 w-9 rounded-xl bg-[#E5B85A]/15 border border-[#E5B85A]/30 flex items-center justify-center shrink-0 mt-0.5">
          <Bell className="h-4 w-4 text-[#F3C669]" aria-hidden="true" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[#F6F7FB] truncate">{item.title}</p>
          <span className="text-[10px] text-[#8D97AF] shrink-0">agora</span>
        </div>
        {item.body && (
          <p className="mt-0.5 text-[11px] leading-snug text-[#C4CCE0] line-clamp-2">
            {item.body}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[120] w-[calc(100%-24px)] max-w-sm pointer-events-auto"
    >
      <div className="flex items-start gap-2 rounded-2xl bg-[#0D111C]/94 backdrop-blur-xl border border-white/15 px-3.5 py-3 shadow-[0_14px_38px_rgba(0,0,0,0.65)]">
        {externalHref ? (
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setItem(null)}
            className="flex flex-1 items-start gap-3 min-w-0 cursor-pointer"
          >
            {innerContent}
          </a>
        ) : (
          <button
            type="button"
            onClick={handleOpenInternal}
            className="flex flex-1 items-start gap-3 min-w-0 text-left cursor-pointer"
          >
            {innerContent}
          </button>
        )}
        <button
          type="button"
          onClick={() => setItem(null)}
          aria-label="Fechar notificação"
          className="p-1 text-[#8D97AF] hover:text-white transition-colors shrink-0 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
