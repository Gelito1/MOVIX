import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Volume2, VolumeX, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { translateAdCtaText } from '../lib/adCtaI18n';
import { resolveAdDestination } from '../lib/adDestination';
import { admApi } from '../lib/admApi';
import {
  checkLargeAdPermission,
  dismissLargeAds,
  normalizeAdPacing,
  recordLargeAdShown,
  releaseLargeAdWindow,
  subscribeAdPacingChanges,
} from '../lib/adPacing';
import {
  claimAdForSlot,
  createAdSlotId,
  getOccupiedAdIds,
  orderAdsForFairRotation,
  recordAdExposure,
  releaseAdSlot,
  subscribeAdAssignments,
} from '../lib/adRotation';
import { setAdVideoMuted, startAdVideoWithSound } from '../lib/adVideoAudio';
import { subscribeAdmDataSync } from '../lib/admSync';
import { DEFAULT_AD_PACING, type AdPacingConfig, type AdPlacement, type PublicAdItem } from '../types/adm';
import type { MediaSummary } from '../types/movix';

export interface HeroSlideItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  rating: number;
  backdropUrl: string;
}

type CarouselEntry =
  | { kind: 'media'; slide: HeroSlideItem }
  | { kind: 'ad'; ad: PublicAdItem };

interface HeroCarouselProps {
  slides: HeroSlideItem[];
  onSelectSlide: (slide: HeroSlideItem) => void;
  /** Primary and optional fallback MOVIX ADS placements to weave into this carousel. */
  adPlacements?: AdPlacement[];
}

export function buildSlidesFromCatalog(items: MediaSummary[], maxSlides = 6): HeroSlideItem[] {
  const seen = new Set<string>();
  const out: HeroSlideItem[] = [];
  for (const item of items) {
    const img = item.backdropUrl || item.posterUrl;
    if (!img) continue;
    const key = `${item.mediaType}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: item.id,
      mediaType: item.mediaType,
      title: item.title,
      rating: item.rating,
      backdropUrl: img,
    });
    if (out.length >= maxSlides) break;
  }
  return out;
}

export function HeroCarousel({
  slides,
  onSelectSlide,
  adPlacements = ['categories_page', 'home'],
}: HeroCarouselProps) {
  const { language, t } = useAuth();
  const [heroIndex, setHeroIndex] = useState(0);
  const [sponsoredAds, setSponsoredAds] = useState<PublicAdItem[]>([]);
  const [adPacing, setAdPacing] = useState<AdPacingConfig>(DEFAULT_AD_PACING);
  const [heroAdsAllowed, setHeroAdsAllowed] = useState(false);
  const [pacingTick, setPacingTick] = useState(0);
  const [assignmentTick, setAssignmentTick] = useState(0);
  const [rotationCycle, setRotationCycle] = useState(0);
  const [syncTick, setSyncTick] = useState(0);
  const [adMuted, setAdMuted] = useState(false);
  const manuallyMutedRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  const didSwipeRef = useRef(false);
  const adVideoRef = useRef<HTMLVideoElement | null>(null);
  const trackedImpressionsRef = useRef<Set<string>>(new Set());
  const trackedVideoStartsRef = useRef<Set<string>>(new Set());
  const heroSlotMetaRef = useRef<{ id: string; staggerMs: number } | null>(null);
  if (!heroSlotMetaRef.current) {
    heroSlotMetaRef.current = createAdSlotId('hero');
  }
  const heroSlotId = heroSlotMetaRef.current.id;

  const placementKey = adPlacements.join(',');

  useEffect(() => {
    return () => {
      releaseAdSlot(heroSlotId);
      releaseLargeAdWindow(heroSlotId);
    };
  }, [heroSlotId]);

  useEffect(() => {
    return subscribeAdmDataSync(() => {
      trackedImpressionsRef.current.clear();
      trackedVideoStartsRef.current.clear();
      setSyncTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeAdPacingChanges(() => {
      setPacingTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeAdAssignments(() => {
      setAssignmentTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const list = placementKey ? (placementKey.split(',') as AdPlacement[]) : [];
    if (list.length === 0) {
      releaseAdSlot(heroSlotId);
      releaseLargeAdWindow(heroSlotId);
      setSponsoredAds([]);
      return;
    }

    async function loadAds() {
      const mergedById = new Map<string, PublicAdItem>();
      let latestPacing = DEFAULT_AD_PACING;
      for (const placement of list) {
        try {
          const res = await admApi.getActiveAds(placement, language);
          if (cancelled) return;
          if (res.pacing) {
            latestPacing = normalizeAdPacing(res.pacing);
          }
          if (res.enabled === false) {
            releaseAdSlot(heroSlotId);
            releaseLargeAdWindow(heroSlotId);
            setAdPacing(latestPacing);
            setSponsoredAds([]);
            return;
          }
          for (const ad of res.ads || []) {
            const hasVisual = Boolean(ad.imageUrl || (ad.mediaKind === 'video' && ad.videoUrl));
            if (hasVisual && !mergedById.has(ad.id)) {
              mergedById.set(ad.id, ad);
            }
          }
        } catch {
          // try next fallback placement
        }
      }
      if (!cancelled) {
        setAdPacing(latestPacing);
        const ordered = orderAdsForFairRotation(
          heroSlotId,
          'hero',
          Array.from(mergedById.values()),
          false
        );
        if (ordered.length === 0) {
          releaseAdSlot(heroSlotId);
          releaseLargeAdWindow(heroSlotId);
        }
        setSponsoredAds(ordered);
      }
    }

    void loadAds();
    return () => {
      cancelled = true;
    };
  }, [placementKey, language, syncTick, heroSlotId]);

  // Enforce large-ad frequency & 30-min dismiss cooldown on Hero Carousel sponsored slides
  useEffect(() => {
    if (sponsoredAds.length === 0) {
      releaseLargeAdWindow(heroSlotId);
      setHeroAdsAllowed(false);
      return;
    }
    const perm = checkLargeAdPermission(heroSlotId, 'hero', adPacing);
    if (!perm.allowed) {
      releaseAdSlot(heroSlotId);
      setHeroAdsAllowed(false);
      if (perm.retryAfterMs > 0) {
        const timer = window.setTimeout(() => {
          setPacingTick((n) => n + 1);
        }, Math.min(perm.retryAfterMs, 2147483000));
        return () => window.clearTimeout(timer);
      }
      return;
    }
    setHeroAdsAllowed(true);
  }, [sponsoredAds, adPacing, pacingTick, heroSlotId]);

  const safeSlides = useMemo(() => slides.filter((s) => Boolean(s.backdropUrl)), [slides]);

  // Strictly exclude any ad currently visible in another slot (e.g., top header or lower page banners)
  const availableSponsoredAds = useMemo(() => {
    void assignmentTick;
    if (!heroAdsAllowed || sponsoredAds.length === 0) return [];
    const occupiedElsewhere = getOccupiedAdIds(heroSlotId);
    return sponsoredAds.filter((ad) => !occupiedElsewhere.has(ad.id));
  }, [sponsoredAds, heroAdsAllowed, heroSlotId, assignmentTick]);

  // Interleave sponsored slides from the available unique pool, advancing the offset on every full carousel cycle
  const entries = useMemo<CarouselEntry[]>(() => {
    const mediaEntries: CarouselEntry[] = safeSlides.map((slide) => ({ kind: 'media', slide }));
    if (!heroAdsAllowed || availableSponsoredAds.length === 0) return mediaEntries;
    if (mediaEntries.length === 0) {
      return availableSponsoredAds.map((ad) => ({ kind: 'ad', ad }));
    }

    const result: CarouselEntry[] = [...mediaEntries];
    const maxAdSlotsInLoop = Math.min(
      availableSponsoredAds.length,
      Math.max(2, Math.ceil(mediaEntries.length / 2))
    );
    const startOffset = (rotationCycle * maxAdSlotsInLoop) % availableSponsoredAds.length;
    const pickedForCycle: PublicAdItem[] = [];
    for (let i = 0; i < maxAdSlotsInLoop; i++) {
      pickedForCycle.push(availableSponsoredAds[(startOffset + i) % availableSponsoredAds.length]);
    }

    // Spread sponsored slides evenly across the carousel (after slide 1, then every 2-3 slides)
    let inserted = 0;
    pickedForCycle.forEach((ad, idx) => {
      const targetPos = idx === 0 ? Math.min(1, result.length) : Math.min(1 + idx * 3 + inserted - idx, result.length);
      result.splice(targetPos, 0, { kind: 'ad', ad });
      inserted += 1;
    });
    return result;
  }, [safeSlides, availableSponsoredAds, heroAdsAllowed, rotationCycle]);

  useEffect(() => {
    setHeroIndex((prev) => (entries.length === 0 ? 0 : prev >= entries.length ? 0 : prev));
  }, [entries.length]);

  useEffect(() => {
    if (entries.length <= 1) return;
    const current = entries[heroIndex % entries.length];
    const intervalMs =
      current?.kind === 'ad'
        ? current.ad.mediaKind === 'video'
          ? Math.max(9000, Math.min(24000, (current.ad.durationSeconds || 14) * 1000))
          : 8500
        : 7000;
    const timer = window.setTimeout(() => {
      const nextIdx = (heroIndex + 1) % entries.length;
      if (nextIdx === 0 && availableSponsoredAds.length > 2) {
        setRotationCycle((c) => c + 1);
      }
      setHeroIndex(nextIdx);
    }, intervalMs);
    return () => window.clearTimeout(timer);
  }, [entries, heroIndex, availableSponsoredAds.length]);

  const activeEntry = entries.length > 0 ? entries[heroIndex % entries.length] : null;

  // Claim active hero ad exclusively ONLY while an ad slide is visible; release immediately on media slides
  useEffect(() => {
    if (!activeEntry || activeEntry.kind !== 'ad' || !heroAdsAllowed) {
      releaseAdSlot(heroSlotId);
      return;
    }
    const ad = activeEntry.ad;
    const claimed = claimAdForSlot(heroSlotId, ad.id, 'hero', false);
    if (!claimed) {
      // Another higher-priority slot (e.g., header) already holds this ad — advance cleanly
      if (entries.length > 1) {
        setHeroIndex((prev) => (prev + 1) % entries.length);
      }
      return;
    }
    if (!trackedImpressionsRef.current.has(ad.id)) {
      trackedImpressionsRef.current.add(ad.id);
      recordAdExposure(ad.id, 'hero');
      recordLargeAdShown(heroSlotId, 'hero', adPacing);
      admApi.trackAdEvent(ad.id, 'impression');
    }
  }, [activeEntry, entries.length, heroSlotId, heroAdsAllowed, adPacing]);

  useEffect(() => {
    const vid = adVideoRef.current;
    if (!vid || !activeEntry || activeEntry.kind !== 'ad' || activeEntry.ad.mediaKind !== 'video') return;
    return startAdVideoWithSound(vid, {
      adId: activeEntry.ad.id,
      autoplay: activeEntry.ad.autoplay !== false,
      onMutedStateChange: setAdMuted,
      isManuallyMuted: () => manuallyMutedRef.current,
    });
  }, [activeEntry]);

  if (!activeEntry) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    didSwipeRef.current = false;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartXRef.current;
    const endX = e.changedTouches[0]?.clientX ?? null;
    touchStartXRef.current = null;
    if (startX === null || endX === null || entries.length <= 1) return;
    const delta = endX - startX;
    if (Math.abs(delta) > 36) {
      didSwipeRef.current = true;
      if (delta < 0) {
        setHeroIndex((prev) => (prev + 1) % entries.length);
      } else {
        setHeroIndex((prev) => (prev - 1 + entries.length) % entries.length);
      }
    }
  };

  const renderSponsoredSlide = (ad: PublicAdItem) => {
    const destination = resolveAdDestination(ad.destinationUrl);
    const href = destination?.href ?? null;
    const linkTarget = destination?.isExternal ? '_blank' : undefined;
    const linkRel = destination?.isExternal ? 'noopener noreferrer' : undefined;
    const isVideo = ad.mediaKind === 'video' && Boolean(ad.videoUrl);

    const handleAdClick = (e: React.MouseEvent) => {
      if (didSwipeRef.current) {
        didSwipeRef.current = false;
        e.preventDefault();
        return;
      }
      admApi.trackAdEvent(ad.id, 'click');
    };

    const visualContent = (
      <>
        {isVideo ? (
          <video
            ref={adVideoRef}
            key={ad.id}
            src={ad.videoUrl}
            poster={ad.imageUrl || undefined}
            autoPlay={ad.autoplay !== false}
            muted
            loop={entries.length <= 1}
            playsInline
            disablePictureInPicture
            disableRemotePlayback
            preload="auto"
            onPlay={() => {
              if (!trackedVideoStartsRef.current.has(ad.id)) {
                trackedVideoStartsRef.current.add(ad.id);
                admApi.trackAdEvent(ad.id, 'video_start');
              }
            }}
            onEnded={() => {
              if (entries.length > 1) {
                const nextIdx = (heroIndex + 1) % entries.length;
                if (nextIdx === 0 && sponsoredAds.length > 2) {
                  setRotationCycle((c) => c + 1);
                }
                setHeroIndex(nextIdx);
              }
            }}
            className="w-full h-full object-cover object-center"
          />
        ) : ad.imageUrl ? (
          <img
            src={ad.imageUrl}
            alt={ad.title || ad.name}
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center transition-transform duration-700 group-hover:scale-[1.015]"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#141928] via-[#0B0E17] to-[#06070B]" />
        )}

        {/* Cinema Multi-Stop Scrims */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/55 to-transparent"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-[#06070B]/85 via-[#06070B]/35 to-transparent"
          aria-hidden="true"
        />

        {/* Editorial Sponsored Typography & Single Refined CTA */}
        <div className="absolute inset-x-0 bottom-0 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6 pr-24">
          <div className="flex flex-col items-start gap-1.5 sm:gap-2 max-w-2xl">
            <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.2em] text-[#F3C669] drop-shadow">
              {t.sponsored}
            </span>

            <h2 className="font-display text-lg sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#F6F7FB] leading-tight line-clamp-2 drop-shadow-[0_2px_12px_rgba(0,0,0,0.75)]">
              {ad.title || ad.name}
            </h2>

            {ad.description && (
              <p className="hidden sm:block text-xs sm:text-sm text-[#D1D7E6]/90 line-clamp-2 max-w-xl leading-relaxed drop-shadow">
                {ad.description}
              </p>
            )}

            {href && (
              <span className="mt-0.5 sm:mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 sm:px-5 sm:py-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] text-[#07080C] text-xs sm:text-sm font-semibold shadow-[0_6px_22px_rgba(229,184,90,0.3)] whitespace-nowrap">
                <span>{translateAdCtaText(ad.ctaText, language, t.learnMore)}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </div>
      </>
    );

    return (
      <div data-movix-ad-container="true" className="relative w-full h-full group">
        {href ? (
          <a
            href={href}
            target={linkTarget}
            rel={linkRel}
            onClick={handleAdClick}
            aria-label={`${t.sponsoredAd}: ${ad.title || ad.name}`}
            className="block w-full h-full text-left relative cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A]"
          >
            {visualContent}
          </a>
        ) : (
          <div
            role="region"
            aria-label={`${t.sponsoredAd}: ${ad.title || ad.name}`}
            className="block w-full h-full text-left relative"
          >
            {visualContent}
          </div>
        )}

        <div className="absolute top-3 right-3 sm:top-4 sm:right-5 z-20 flex items-center gap-1">
          {isVideo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAdMuted((prev) => {
                  const next = !prev;
                  manuallyMutedRef.current = next;
                  setAdVideoMuted(adVideoRef.current, next);
                  return next;
                });
              }}
              aria-label={adMuted ? t.unmuteAd : t.muteAd}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            >
              <span className="h-9 w-9 rounded-full bg-[#07090F]/70 backdrop-blur-md border border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB] flex items-center justify-center transition-colors">
                {adMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              dismissLargeAds(adPacing);
              setHeroAdsAllowed(false);
              setHeroIndex(0);
            }}
            aria-label={t.closeAd}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          >
            <span className="h-9 w-9 rounded-full bg-[#07090F]/70 backdrop-blur-md border border-white/15 hover:border-[#E5B85A]/45 text-[#C8D0E2] hover:text-white flex items-center justify-center transition-colors">
              <X className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <section
      aria-label="Carrossel de destaques"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="relative w-full h-[220px] sm:h-[360px] lg:h-[440px] overflow-hidden border-b border-white/[0.07] bg-[#06070B]"
    >
      {activeEntry.kind === 'ad' ? (
        renderSponsoredSlide(activeEntry.ad)
      ) : (
        <button
          type="button"
          onClick={() => {
            if (didSwipeRef.current) {
              didSwipeRef.current = false;
              return;
            }
            if (activeEntry.slide.id > 0) onSelectSlide(activeEntry.slide);
          }}
          aria-label={`Abrir ${activeEntry.slide.title}`}
          className="block w-full h-full text-left relative cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A]"
        >
          <img
            src={activeEntry.slide.backdropUrl}
            alt={activeEntry.slide.title}
            decoding="async"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center"
          />

          {/* Cinema Multi-Stop Scrims for Optimal Contrast */}
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#06070B] via-[#06070B]/45 to-transparent"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#06070B]/65 via-transparent to-transparent"
            aria-hidden="true"
          />

          {/* Strictly ONLY Name and Classification */}
          <div className="absolute inset-x-0 bottom-0 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6 pr-24">
            <div className="flex flex-col gap-1 max-w-2xl">
              {activeEntry.slide.rating > 0 && (
                <span className="text-xs sm:text-sm font-semibold text-[#F3C669] drop-shadow tabular-nums">
                  ★ {activeEntry.slide.rating.toFixed(1)}
                </span>
              )}
              <h2 className="font-display text-xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#F6F7FB] leading-tight line-clamp-2 drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                {activeEntry.slide.title}
              </h2>
            </div>
          </div>
        </button>
      )}

      {/* Desktop Left/Right Arrows */}
      {entries.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHeroIndex((prev) => (prev - 1 + entries.length) % entries.length);
            }}
            aria-label="Slide anterior"
            className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-[#07090F]/75 hover:bg-[#0F131E] border border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB] items-center justify-center cursor-pointer transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHeroIndex((prev) => (prev + 1) % entries.length);
            }}
            aria-label="Próximo slide"
            className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full bg-[#07090F]/75 hover:bg-[#0F131E] border border-white/15 hover:border-[#E5B85A]/45 text-[#F6F7FB] items-center justify-center cursor-pointer transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          {/* Bottom-Right Carousel Dots */}
          <div className="absolute right-4 sm:right-8 bottom-4 sm:bottom-6 z-20 flex items-center gap-1.5">
            {entries.map((entry, idx) => {
              const key =
                entry.kind === 'ad'
                  ? `ad-${entry.ad.id}-${idx}`
                  : `${entry.slide.mediaType}-${entry.slide.id}-${idx}`;
              const label =
                entry.kind === 'ad'
                  ? `${t.sponsoredAd}: ${entry.ad.title || entry.ad.name}`
                  : `${idx + 1}: ${entry.slide.title}`;
              const isActive = idx === heroIndex % entries.length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHeroIndex(idx);
                  }}
                  aria-label={label}
                  className={`h-1.5 rounded-sm transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'w-5 bg-gradient-to-r from-[#D9A441] to-[#F4CB73] shadow-[0_0_8px_rgba(244,203,115,0.45)]'
                      : entry.kind === 'ad'
                        ? 'w-1.5 bg-[#E5B85A]/55 hover:bg-[#F4CB73]'
                        : 'w-1.5 bg-white/40 hover:bg-white/75'
                  }`}
                />
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
