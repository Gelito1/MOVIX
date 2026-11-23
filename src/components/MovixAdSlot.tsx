import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { translateAdCtaText } from '../lib/adCtaI18n';
import { resolveAdDestination } from '../lib/adDestination';
import { admApi } from '../lib/admApi';
import {
  checkLargeAdPermission,
  checkPlayerAdPermission,
  dismissLargeAds,
  isAlwaysVisibleHeaderAd,
  normalizeAdPacing,
  recordLargeAdShown,
  recordPlayerAdShown,
  releaseLargeAdWindow,
  subscribeAdPacingChanges,
} from '../lib/adPacing';
import {
  createAdSlotId,
  getSlotClaimedAdId,
  pickNextScheduledAd,
  recordAdExposure,
  releaseAdSlot,
  subscribeAdAssignments,
} from '../lib/adRotation';
import { setAdVideoMuted, startAdVideoWithSound } from '../lib/adVideoAudio';
import { subscribeAdmDataSync } from '../lib/admSync';
import { DEFAULT_AD_PACING, type AdPacingConfig, type AdPlacement, type PublicAdItem } from '../types/adm';

const BASE_IMAGE_ROTATION_MS = 12000;

interface MovixAdSlotProps {
  placement: AdPlacement;
  className?: string;
}

export function MovixAdSlot({ placement, className = '' }: MovixAdSlotProps) {
  const { language, t } = useAuth();
  const isHeaderPlacement = placement === 'header';
  const [adPool, setAdPool] = useState<PublicAdItem[]>([]);
  const [ad, setAd] = useState<PublicAdItem | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [muted, setMuted] = useState(() => isHeaderPlacement);
  const [pacing, setPacing] = useState<AdPacingConfig>(DEFAULT_AD_PACING);
  const [pacingAllowed, setPacingAllowed] = useState(() => isHeaderPlacement);
  const [pacingTick, setPacingTick] = useState(0);
  const manuallyMutedRef = useRef(isHeaderPlacement);
  const isHoveredRef = useRef(false);
  const slotMetaRef = useRef<{ id: string; staggerMs: number } | null>(null);
  if (!slotMetaRef.current) {
    slotMetaRef.current = createAdSlotId(placement);
  }
  const slotId = slotMetaRef.current.id;
  const staggerMs = slotMetaRef.current.staggerMs;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const impressionSentForIdRef = useRef<string | null>(null);
  const videoStartSentForIdRef = useRef<string | null>(null);

  const [syncTick, setSyncTick] = useState(0);

  useEffect(() => {
    return () => {
      releaseAdSlot(slotId);
      releaseLargeAdWindow(slotId);
    };
  }, [slotId]);

  useEffect(() => {
    if (dismissed || !pacingAllowed) {
      releaseAdSlot(slotId);
      setAd(null);
    }
  }, [dismissed, pacingAllowed, slotId]);

  useEffect(() => {
    return subscribeAdmDataSync(() => {
      setSyncTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeAdPacingChanges(() => {
      setPacingTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    impressionSentForIdRef.current = null;
    videoStartSentForIdRef.current = null;
    setDismissed(false);

    void admApi
      .getActiveAds(placement, language)
      .then((res) => {
        if (cancelled) return;
        const nextPacing = normalizeAdPacing(res.pacing);
        setPacing(nextPacing);
        if (res.enabled === false || !Array.isArray(res.ads) || res.ads.length === 0) {
          releaseAdSlot(slotId);
          releaseLargeAdWindow(slotId);
          setAdPool([]);
          setAd(null);
          return;
        }
        setAdPool(res.ads);
        const perm = checkLargeAdPermission(slotId, placement, nextPacing);
        if (perm.allowed) {
          setPacingAllowed(true);
          const chosen = pickNextScheduledAd({
            slotId,
            placement,
            ads: res.ads,
            allowTakeover: isHeaderPlacement,
          });
          setAd(chosen);
        } else {
          releaseAdSlot(slotId);
          setPacingAllowed(false);
          setAd(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          releaseAdSlot(slotId);
          releaseLargeAdWindow(slotId);
          setAdPool([]);
          setAd(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [placement, language, syncTick, slotId, isHeaderPlacement]);

  // Enforce large-ad frequency & 30-min dismiss cooldown while keeping compact header ad always visible
  useEffect(() => {
    if (adPool.length === 0) {
      releaseLargeAdWindow(slotId);
      setPacingAllowed(false);
      return;
    }
    const perm = checkLargeAdPermission(slotId, placement, pacing);
    if (!perm.allowed) {
      impressionSentForIdRef.current = null;
      videoStartSentForIdRef.current = null;
      releaseAdSlot(slotId);
      setPacingAllowed(false);
      setAd(null);
      if (perm.retryAfterMs > 0) {
        const timer = window.setTimeout(() => {
          setPacingTick((n) => n + 1);
        }, Math.min(perm.retryAfterMs, 2147483000));
        return () => window.clearTimeout(timer);
      }
      return;
    }

    setPacingAllowed(true);
    setAd((current) => {
      if (
        current &&
        adPool.some((item) => item.id === current.id) &&
        getSlotClaimedAdId(slotId) === current.id
      ) {
        return current;
      }
      return pickNextScheduledAd({
        slotId,
        placement,
        ads: adPool,
        allowTakeover: isHeaderPlacement,
      });
    });
  }, [adPool, pacing, pacingTick, placement, slotId, isHeaderPlacement]);

  // Cross-slot strict anti-duplication coordinator:
  // If another higher-priority slot claims our current ad, yield immediately to a different free ad (or hide).
  // If this slot was waiting (`ad === null`) and another slot frees an ad, smoothly fill it.
  useEffect(() => {
    if (dismissed || !pacingAllowed || adPool.length === 0) return;
    return subscribeAdAssignments(() => {
      setAd((current) => {
        const claimedId = getSlotClaimedAdId(slotId);
        if (current && claimedId === current.id) {
          return current;
        }
        return pickNextScheduledAd({
          slotId,
          placement,
          ads: adPool,
          excludeAdIds: current ? [current.id] : [],
          allowTakeover: false,
        });
      });
    });
  }, [adPool, dismissed, pacingAllowed, placement, slotId]);

  const rotateToNextAd = useCallback(() => {
    setAd((current) => {
      if (adPool.length <= 1) {
        // Still verify exclusive ownership when only 1 ad exists in pool
        if (current && getSlotClaimedAdId(slotId) === current.id) return current;
        return pickNextScheduledAd({
          slotId,
          placement,
          ads: adPool,
          allowTakeover: isHeaderPlacement,
        });
      }
      const next = pickNextScheduledAd({
        slotId,
        placement,
        ads: adPool,
        excludeAdIds: current ? [current.id] : [],
        allowTakeover: isHeaderPlacement,
      });
      if (next) return next;
      // No other free ad right now: keep current ONLY if we still hold exclusive ownership
      if (current && getSlotClaimedAdId(slotId) === current.id) {
        return current;
      }
      return null;
    });
  }, [adPool, placement, slotId, isHeaderPlacement]);

  // Automatic staggered rotation across all active ads so every ad appears at different moments
  useEffect(() => {
    if (!ad || dismissed || !pacingAllowed || adPool.length <= 1) return;
    const isVideo = ad.mediaKind === 'video' && Boolean(ad.videoUrl);
    const delayMs = isHeaderPlacement
      ? isVideo
        ? Math.max(9000, Math.min(20000, (ad.durationSeconds || 12) * 1000))
        : 8500
      : isVideo
        ? Math.max(12000, Math.min(35000, (ad.durationSeconds || 18) * 1000)) + Math.min(staggerMs, 4000)
        : BASE_IMAGE_ROTATION_MS + staggerMs;

    let timerId: number | null = null;
    const schedule = (ms: number) => {
      timerId = window.setTimeout(() => {
        if (document.hidden || isHoveredRef.current) {
          schedule(3500);
          return;
        }
        rotateToNextAd();
      }, ms);
    };

    schedule(delayMs);

    return () => {
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [ad, adPool.length, dismissed, isHeaderPlacement, pacingAllowed, rotateToNextAd, staggerMs]);

  // Top header ad must always appear frequently and never stay gone on cooldown:
  // if temporarily dismissed, automatically restore it on route navigation or shortly afterwards.
  useEffect(() => {
    if (!isHeaderPlacement || !dismissed) return;
    const restore = () => {
      setDismissed(false);
      rotateToNextAd();
    };
    window.addEventListener('hashchange', restore);
    window.addEventListener('popstate', restore);
    const timer = window.setTimeout(restore, 12000);
    return () => {
      window.removeEventListener('hashchange', restore);
      window.removeEventListener('popstate', restore);
      window.clearTimeout(timer);
    };
  }, [isHeaderPlacement, dismissed, adPool.length, rotateToNextAd]);

  useEffect(() => {
    if (!ad || dismissed || !pacingAllowed || !containerRef.current) return;
    if (impressionSentForIdRef.current === ad.id) return;
    const el = containerRef.current;
    const currentAdId = ad.id;

    const triggerImpression = () => {
      if (impressionSentForIdRef.current === currentAdId) return;
      impressionSentForIdRef.current = currentAdId;
      recordAdExposure(currentAdId, placement);
      recordLargeAdShown(slotId, placement, pacing);
      admApi.trackAdEvent(currentAdId, 'impression');
    };

    if (typeof IntersectionObserver === 'undefined') {
      triggerImpression();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
            triggerImpression();
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: [0.45] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ad, dismissed, pacing, pacingAllowed, placement, slotId]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !ad || dismissed || !pacingAllowed || ad.mediaKind !== 'video') return;
    return startAdVideoWithSound(vid, {
      adId: ad.id,
      autoplay: ad.autoplay !== false,
      forceSilent: isHeaderPlacement,
      onMutedStateChange: setMuted,
      isManuallyMuted: () => isHeaderPlacement || manuallyMutedRef.current,
    });
  }, [ad, dismissed, isHeaderPlacement, pacingAllowed]);

  const toggleSlotMuted = () => {
    if (isHeaderPlacement) return;
    setMuted((prev) => {
      const next = !prev;
      manuallyMutedRef.current = next;
      setAdVideoMuted(videoRef.current, next);
      return next;
    });
  };

  const handleDismissAd = () => {
    if (isAlwaysVisibleHeaderAd(placement, pacing)) {
      setDismissed(true);
      return;
    }
    dismissLargeAds(pacing);
    setPacingAllowed(false);
  };

  if (!ad || dismissed || !pacingAllowed) return null;

  const destination = resolveAdDestination(ad.destinationUrl);
  const href = destination?.href ?? null;
  const linkTarget = destination?.isExternal ? '_blank' : undefined;
  const linkRel = destination?.isExternal ? 'noopener noreferrer' : undefined;
  const isVideo = ad.mediaKind === 'video' && Boolean(ad.videoUrl);
  const isVertical = ad.format === 'banner_vertical' || placement === 'sidebar';
  const isSquare = ad.format === 'banner_square';
  const isCompactStrip = placement === 'header' || placement === 'footer';

  const handleClick = () => {
    admApi.trackAdEvent(ad.id, 'click');
  };

  const handleVideoPlay = () => {
    if (videoStartSentForIdRef.current !== ad.id) {
      videoStartSentForIdRef.current = ad.id;
      admApi.trackAdEvent(ad.id, 'video_start');
    }
  };

  const hasMultipleAds = adPool.length > 1;
  const handleVideoEnded = () => {
    if (hasMultipleAds) {
      rotateToNextAd();
    }
  };

  // 1. Sleek Low-Profile Cinema Strip (Header & Footer) — entire banner & media clickable
  if (isCompactStrip) {
    const stripInner = (
      <>
        {isVideo ? (
          <div className="relative w-20 sm:w-28 h-12 sm:h-14 rounded-lg overflow-hidden bg-black shrink-0">
            <video
              key={ad.id}
              ref={videoRef}
              src={ad.videoUrl}
              poster={ad.imageUrl || undefined}
              autoPlay={ad.autoplay !== false}
              muted
              loop={!hasMultipleAds}
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              preload="auto"
              onPlay={handleVideoPlay}
              onEnded={handleVideoEnded}
              className="w-full h-full object-cover"
            />
          </div>
        ) : ad.imageUrl ? (
          <div className="w-20 sm:w-28 h-12 sm:h-14 rounded-lg overflow-hidden bg-[#06070B] shrink-0">
            <img
              key={ad.id}
              src={ad.imageUrl}
              alt={ad.title || ad.name}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>
        ) : null}

        <div className="flex-1 min-w-0">
          <span className="block text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.18em] text-[#E5B85A]">
            {t.sponsored}
          </span>
          <p className="text-xs sm:text-sm font-semibold text-[#F6F7FB] truncate leading-snug">
            {ad.title || ad.name}
          </p>
          {ad.description && (
            <p className="hidden sm:block text-xs text-[#95A0B8] truncate">{ad.description}</p>
          )}
        </div>

        {href && (
          <span className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] group-hover:brightness-105 text-[#07080C] text-[11px] sm:text-xs font-semibold whitespace-nowrap shrink-0 transition-all">
            <span>{translateAdCtaText(ad.ctaText, language, t.learnMore)}</span>
            <ExternalLink className="h-3 w-3" />
          </span>
        )}
      </>
    );

    return (
      <div
        ref={containerRef}
        data-movix-ad-container="true"
        onMouseEnter={() => {
          isHoveredRef.current = true;
        }}
        onMouseLeave={() => {
          isHoveredRef.current = false;
        }}
        aria-label={t.sponsoredAd}
        className={`group relative overflow-hidden rounded-xl bg-[#0B0E17]/95 border border-white/[0.08] hover:border-[#E5B85A]/35 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-colors ${className}`}
      >
        {href ? (
          <a
            href={href}
            target={linkTarget}
            rel={linkRel}
            onClick={handleClick}
            aria-label={`${t.openAd}: ${ad.title || ad.name}`}
            className="flex items-center gap-3 p-2 sm:p-2.5 pr-10 sm:pr-11 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A]"
          >
            {stripInner}
          </a>
        ) : (
          <div className="flex items-center gap-3 p-2 sm:p-2.5 pr-10 sm:pr-11">{stripInner}</div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDismissAd();
          }}
          aria-label={t.closeAd}
          className="absolute top-1/2 -translate-y-1/2 right-1 z-20 min-h-[40px] min-w-[40px] flex items-center justify-center text-[#8D97AF] hover:text-white transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // 2. Vertical Poster / Square Editorial Cinema Card — entire card, image & video clickable
  if (isVertical || isSquare) {
    const verticalContent = (
      <>
        {isVideo ? (
          <video
            key={ad.id}
            ref={videoRef}
            src={ad.videoUrl}
            poster={ad.imageUrl || undefined}
            autoPlay={ad.autoplay !== false}
            muted
            loop={!hasMultipleAds}
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            preload="auto"
            onPlay={handleVideoPlay}
            onEnded={handleVideoEnded}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : ad.imageUrl ? (
          <img
            key={ad.id}
            src={ad.imageUrl}
            alt={ad.title || ad.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#161D2F] via-[#0C101B] to-[#06070B]" />
        )}

        {/* Cinema Scrim */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/60 to-transparent"
          aria-hidden="true"
        />

        {/* Bottom Editorial Content */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-5 flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#F3C669]">
            {t.sponsored}
          </span>
          {(ad.title || ad.name) && (
            <h4 className="font-display text-lg font-bold tracking-tight text-[#F6F7FB] leading-snug line-clamp-2">
              {ad.title || ad.name}
            </h4>
          )}
          {ad.description && (
            <p className="text-xs text-[#C8D0E2]/90 line-clamp-2 leading-relaxed">{ad.description}</p>
          )}
          {href && (
            <span className="mt-1 inline-flex items-center justify-center gap-1.5 w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] group-hover:brightness-105 text-[#07080C] text-xs font-semibold shadow-[0_6px_20px_rgba(229,184,90,0.28)] transition-all">
              <span>{translateAdCtaText(ad.ctaText, language, t.learnMore)}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </>
    );

    return (
      <div
        ref={containerRef}
        data-movix-ad-container="true"
        onMouseEnter={() => {
          isHoveredRef.current = true;
        }}
        onMouseLeave={() => {
          isHoveredRef.current = false;
        }}
        aria-label={t.sponsoredAd}
        className={`group relative overflow-hidden rounded-2xl border border-white/[0.09] hover:border-[#E5B85A]/35 bg-[#0B0E17] shadow-[0_14px_38px_rgba(0,0,0,0.5)] transition-colors ${
          isVertical ? 'w-full max-w-[300px] aspect-[3/4]' : 'w-full max-w-[340px] aspect-square'
        } ${className}`}
      >
        {href ? (
          <a
            href={href}
            target={linkTarget}
            rel={linkRel}
            onClick={handleClick}
            aria-label={`${t.openAd}: ${ad.title || ad.name}`}
            className="block absolute inset-0 w-full h-full cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A]"
          >
            {verticalContent}
          </a>
        ) : (
          <div className="block absolute inset-0 w-full h-full">{verticalContent}</div>
        )}

        {/* Floating Subtle Controls (independent of link click) */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          {isVideo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSlotMuted();
              }}
              aria-label={muted ? t.unmuteAd : t.muteAd}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
            >
              <span className="h-8 w-8 rounded-full bg-[#06070B]/65 backdrop-blur-md border border-white/15 text-white hover:border-[#E5B85A]/45 flex items-center justify-center transition-colors">
                {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDismissAd();
            }}
            aria-label={t.closeAd}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
          >
            <span className="h-8 w-8 rounded-full bg-[#06070B]/65 backdrop-blur-md border border-white/15 text-[#C8D0E2] hover:text-white flex items-center justify-center transition-colors">
              <X className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      </div>
    );
  }

  // 3. Full-Bleed Cinema Showcase Card — entire banner, image & video clickable
  const hasMedia = isVideo || Boolean(ad.imageUrl);

  const showcaseContent = (
    <>
      {/* Full-Bleed Background Visual */}
      {isVideo ? (
        <video
          key={ad.id}
          ref={videoRef}
          src={ad.videoUrl}
          poster={ad.imageUrl || undefined}
          autoPlay={ad.autoplay !== false}
          muted
          loop={!hasMultipleAds}
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          onPlay={handleVideoPlay}
          onEnded={handleVideoEnded}
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
      ) : ad.imageUrl ? (
        <img
          key={ad.id}
          src={ad.imageUrl}
          alt={ad.title || ad.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 group-hover:scale-[1.02]"
        />
      ) : (
        <div
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(229,184,90,0.16),transparent_55%),linear-gradient(135deg,#131828_0%,#0B0E17_55%,#07090F_100%)]"
          aria-hidden="true"
        />
      )}

      {/* Cinema Multi-Stop Scrims for High-Contrast Typography */}
      {hasMedia && (
        <>
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#06070B]/95 via-[#06070B]/74 to-[#06070B]/20"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#06070B]/88 via-transparent to-[#06070B]/25"
            aria-hidden="true"
          />
        </>
      )}

      {/* Editorial Content Layer */}
      <div className="relative z-10 h-full min-h-[inherit] flex flex-col justify-end sm:justify-center p-4 sm:p-6 lg:p-8 pr-14 sm:pr-20">
        <div className="max-w-xl space-y-1.5 sm:space-y-2.5">
          <span className="block text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-[#F3C669] drop-shadow">
            {t.sponsored}
          </span>

          {(ad.title || ad.name) && (
            <h4 className="font-display text-base sm:text-xl lg:text-2xl font-bold tracking-tight text-[#F6F7FB] leading-snug line-clamp-2 drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
              {ad.title || ad.name}
            </h4>
          )}

          {ad.description && (
            <p className="text-xs sm:text-sm text-[#D1D7E6]/90 line-clamp-2 leading-relaxed drop-shadow">
              {ad.description}
            </p>
          )}

          {href && (
            <div className="pt-1 sm:pt-1.5">
              <span className="inline-flex items-center gap-1.5 px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] group-hover:brightness-105 text-[#07080C] text-xs sm:text-sm font-semibold shadow-[0_6px_22px_rgba(229,184,90,0.3)] whitespace-nowrap transition-all">
                <span>{translateAdCtaText(ad.ctaText, language, t.learnMore)}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      ref={containerRef}
      data-movix-ad-container="true"
      onMouseEnter={() => {
        isHoveredRef.current = true;
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
      }}
      aria-label={t.sponsoredAd}
      className={`group relative w-full overflow-hidden rounded-2xl border border-white/[0.09] hover:border-[#E5B85A]/35 bg-[#0B0E17] shadow-[0_14px_38px_rgba(0,0,0,0.5)] transition-colors ${
        hasMedia ? 'min-h-[164px] sm:min-h-[200px] lg:min-h-[224px]' : 'min-h-[132px]'
      } ${className}`}
    >
      {href ? (
        <a
          href={href}
          target={linkTarget}
          rel={linkRel}
          onClick={handleClick}
          aria-label={`${t.openAd}: ${ad.title || ad.name}`}
          className="block relative w-full h-full min-h-[inherit] cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A]"
        >
          {showcaseContent}
        </a>
      ) : (
        <div className="block relative w-full h-full min-h-[inherit]">{showcaseContent}</div>
      )}

      {/* Subtle Floating Top-Right Controls (independent of link click) */}
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-20 flex items-center gap-1">
        {isVideo && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleSlotMuted();
            }}
            aria-label={muted ? t.unmuteAd : t.muteAd}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
          >
            <span className="h-8 w-8 rounded-full bg-[#06070B]/65 backdrop-blur-md border border-white/15 text-white hover:border-[#E5B85A]/45 flex items-center justify-center transition-colors">
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDismissAd();
          }}
          aria-label={t.closeAd}
          className="min-h-[40px] min-w-[40px] flex items-center justify-center cursor-pointer"
        >
          <span className="h-8 w-8 rounded-full bg-[#06070B]/65 backdrop-blur-md border border-white/15 text-[#C8D0E2] hover:text-white flex items-center justify-center transition-colors">
            <X className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    </div>
  );
}

interface MovixPlayerAdOverlayProps {
  placement: 'before_player' | 'during_playback' | 'after_playback';
  onDone: () => void;
}

export function MovixPlayerAdOverlay({ placement, onDone }: MovixPlayerAdOverlayProps) {
  const { language, t } = useAuth();
  const [ad, setAd] = useState<PublicAdItem | null>(null);
  const [checked, setChecked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const manuallyMutedRef = useRef(false);
  const playerVideoRef = useRef<HTMLVideoElement | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const completedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    const playerSlotId = `player_${placement}`;
    void admApi
      .getActiveAds(placement, language)
      .then((res) => {
        if (cancelled) return;
        const nextPacing = normalizeAdPacing(res.pacing);
        if (!checkPlayerAdPermission(nextPacing)) {
          setChecked(true);
          onDoneRef.current();
          return;
        }
        const chosen =
          res.enabled !== false && Array.isArray(res.ads) && res.ads.length > 0
            ? pickNextScheduledAd({
                slotId: playerSlotId,
                placement,
                ads: res.ads,
                claim: true,
                allowTakeover: true,
              })
            : null;
        if (!chosen) {
          releaseAdSlot(playerSlotId);
          setChecked(true);
          onDoneRef.current();
          return;
        }
        recordPlayerAdShown();
        setAd(chosen);
        setChecked(true);
        startedAtRef.current = Date.now();
        recordAdExposure(chosen.id, placement);
        admApi.trackAdEvent(chosen.id, 'impression');
        if (chosen.mediaKind === 'video') {
          admApi.trackAdEvent(chosen.id, 'video_start');
        }
      })
      .catch(() => {
        if (!cancelled) {
          releaseAdSlot(playerSlotId);
          setChecked(true);
          onDoneRef.current();
        }
      });
    return () => {
      cancelled = true;
      releaseAdSlot(playerSlotId);
    };
  }, [placement, language]);

  useEffect(() => {
    const vid = playerVideoRef.current;
    if (!vid || !ad || ad.mediaKind !== 'video') return;
    return startAdVideoWithSound(vid, {
      adId: ad.id,
      autoplay: true,
      isPlayerOverlay: true,
      onMutedStateChange: setMuted,
      isManuallyMuted: () => manuallyMutedRef.current,
    });
  }, [ad]);

  useEffect(() => {
    if (!ad) return;
    const maxSec = Math.max(5, Math.min(60, ad.durationSeconds || 15));
    const timer = window.setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= maxSec) {
          window.clearInterval(timer);
          if (!completedRef.current) {
            completedRef.current = true;
            if (ad.mediaKind === 'video') {
              admApi.trackAdEvent(ad.id, 'video_complete', next);
            }
            onDoneRef.current();
          }
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ad]);

  if (!checked || !ad) return null;

  const skipThreshold = ad.skippable ? Math.max(3, ad.skipAfterSeconds || 5) : Math.max(5, ad.durationSeconds || 15);
  const canSkip = elapsed >= skipThreshold;
  const remainingSkip = Math.max(0, skipThreshold - elapsed);
  const remainingTotal = Math.max(0, Math.max(5, ad.durationSeconds || 15) - elapsed);
  const destination = resolveAdDestination(ad.destinationUrl);
  const href = destination?.href ?? null;
  const linkTarget = destination?.isExternal ? '_blank' : undefined;
  const linkRel = destination?.isExternal ? 'noopener noreferrer' : undefined;

  const finishAd = (complete: boolean) => {
    if (completedRef.current) return;
    completedRef.current = true;
    const watchedSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    if (ad.mediaKind === 'video') {
      admApi.trackAdEvent(ad.id, complete ? 'video_complete' : 'video_partial', watchedSec);
    }
    onDoneRef.current();
  };

  const playerMedia =
    ad.mediaKind === 'video' && ad.videoUrl ? (
      <video
        ref={playerVideoRef}
        src={ad.videoUrl}
        poster={ad.imageUrl || undefined}
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        preload="auto"
        onEnded={() => finishAd(true)}
        onError={() => finishAd(false)}
        className="w-full h-full object-contain bg-black"
      />
    ) : ad.imageUrl ? (
      <img
        src={ad.imageUrl}
        alt={ad.title || ad.name}
        referrerPolicy="no-referrer"
        className="w-full h-full object-contain bg-black"
      />
    ) : (
      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center">
        <h3 className="text-xl font-bold text-white">{ad.title || ad.name}</h3>
        {ad.description && <p className="text-sm text-[#A0A6B8] mt-2 max-w-md">{ad.description}</p>}
      </div>
    );

  return (
    <div
      data-movix-ad-container="true"
      className="absolute inset-0 z-40 bg-[#05060A] flex flex-col items-center justify-center p-4"
    >
      <div className="relative w-full max-w-4xl aspect-video rounded-2xl overflow-hidden border border-[#E5B85A]/25 bg-black shadow-2xl">
        {href ? (
          <a
            href={href}
            target={linkTarget}
            rel={linkRel}
            onClick={() => admApi.trackAdEvent(ad.id, 'click')}
            aria-label={`${t.openAd}: ${ad.title || ad.name}`}
            className="block w-full h-full cursor-pointer"
          >
            {playerMedia}
          </a>
        ) : (
          playerMedia
        )}

        {/* Top bar */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
          <div className="px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-sm border border-white/10 text-[11px] font-medium text-[#E5B85A] tabular-nums">
            {t.sponsored} · {remainingTotal}s
          </div>
          {ad.mediaKind === 'video' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMuted((prev) => {
                  const next = !prev;
                  manuallyMutedRef.current = next;
                  setAdVideoMuted(playerVideoRef.current, next);
                  return next;
                });
              }}
              className="pointer-events-auto p-2 rounded-full bg-black/75 border border-white/10 text-white hover:bg-black cursor-pointer"
              aria-label={muted ? t.unmuteAd : t.muteAd}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex items-center gap-2 min-w-0 pointer-events-auto">
            {href && (
              <a
                href={href}
                target={linkTarget}
                rel={linkRel}
                onClick={(e) => {
                  e.stopPropagation();
                  admApi.trackAdEvent(ad.id, 'click');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#06070B] hover:brightness-105 transition-all"
              >
                <span>{translateAdCtaText(ad.ctaText, language, t.learnMore)}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {ad.title && (
              <span className="hidden sm:inline text-xs font-medium text-white/90 bg-black/70 px-2.5 py-1.5 rounded-md truncate max-w-[260px]">
                {ad.title}
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={!canSkip}
            onClick={(e) => {
              e.stopPropagation();
              finishAd(false);
            }}
            className={`pointer-events-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              canSkip
                ? 'bg-white text-[#06070B] border-white hover:bg-white/90 cursor-pointer'
                : 'bg-black/75 text-white/70 border-white/15 cursor-not-allowed'
            }`}
          >
            <SkipForward className="w-3.5 h-3.5" />
            <span>{canSkip ? t.skipAd : `${t.skipAdIn} ${remainingSkip}s`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
