import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bookmark,
  BookmarkPlus,
  Cast,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  Gauge,
  Hand,
  HelpCircle,
  Layers,
  LayoutGrid,
  Lock,
  Maximize,
  MessageSquareText,
  Monitor,
  PictureInPicture2,
  Play,
  RotateCw,
  Search,
  Share2,
  Subtitles,
  Tv,
  User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getTourUiLabels, type TourIconId, type TourStep } from '../lib/tour';

interface GuidedSpotlightTourProps {
  active: boolean;
  steps: TourStep[];
  onComplete: () => void;
  onSkipAll: () => void;
}

interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function TourStepIcon({ id }: { id: TourIconId }) {
  const cls = 'h-3.5 w-3.5 text-[#07080C]';
  switch (id) {
    case 'search':
      return <Search className={cls} />;
    case 'categories':
      return <LayoutGrid className={cls} />;
    case 'streaming':
      return <Tv className={cls} />;
    case 'list':
      return <Bookmark className={cls} />;
    case 'install':
      return <Download className={cls} />;
    case 'profile':
      return <User className={cls} />;
    case 'nav':
      return <Compass className={cls} />;
    case 'cast':
      return <Cast className={cls} />;
    case 'display':
      return <Monitor className={cls} />;
    case 'lock':
      return <Lock className={cls} />;
    case 'seek':
      return <Play className={cls} />;
    case 'comments':
      return <MessageSquareText className={cls} />;
    case 'speed':
      return <Gauge className={cls} />;
    case 'anthology':
      return <Layers className={cls} />;
    case 'pip':
      return <PictureInPicture2 className={cls} />;
    case 'fullscreen':
      return <Maximize className={cls} />;
    case 'like':
      return <BookmarkPlus className={cls} />;
    case 'download':
      return <Download className={cls} />;
    case 'rotate':
      return <RotateCw className={cls} />;
    case 'feedback':
      return <HelpCircle className={cls} />;
    case 'share':
      return <Share2 className={cls} />;
    case 'audio':
      return <Subtitles className={cls} />;
    case 'gestures':
      return <Hand className={cls} />;
    default:
      return <Compass className={cls} />;
  }
}

function findVisibleElement(selector: string | null): HTMLElement | null {
  if (!selector || typeof document === 'undefined') return null;
  try {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return el;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function GuidedSpotlightTour({
  active,
  steps,
  onComplete,
  onSkipAll,
}: GuidedSpotlightTourProps) {
  const { language } = useAuth();
  const ui = useMemo(() => getTourUiLabels(language), [language]);

  const [resolvedSteps, setResolvedSteps] = useState<TourStep[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<RectBox | null>(null);
  const [cardSize, setCardSize] = useState<{ width: number; height: number }>({
    width: 246,
    height: 118,
  });
  const cardRef = useRef<HTMLDivElement>(null);

  const recomputeAvailableSteps = useCallback(() => {
    const available = steps.filter((step) => {
      if (step.selector === null) return true;
      return Boolean(findVisibleElement(step.selector));
    });
    setResolvedSteps(available);
    setStepIdx(0);
  }, [steps]);

  useEffect(() => {
    if (!active) return;
    recomputeAvailableSteps();
  }, [active, recomputeAvailableSteps]);

  const currentStep = resolvedSteps[stepIdx] || null;

  const measureCurrentTarget = useCallback(
    (shouldScroll: boolean) => {
      if (!active || !currentStep) {
        setTargetRect(null);
        return;
      }
      if (!currentStep.selector) {
        setTargetRect(null);
        return;
      }
      const el = findVisibleElement(currentStep.selector);
      if (!el) {
        setTargetRect(null);
        return;
      }

      const initialRect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const outOfView =
        initialRect.top < 12 ||
        initialRect.bottom > vh - 12 ||
        initialRect.left < 8 ||
        initialRect.right > vw - 8;

      if (shouldScroll && outOfView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        setTimeout(() => {
          const updated = el.getBoundingClientRect();
          if (updated.width > 0 && updated.height > 0) {
            setTargetRect({
              top: updated.top,
              left: updated.left,
              width: updated.width,
              height: updated.height,
            });
          }
        }, 280);
      }

      setTargetRect({
        top: initialRect.top,
        left: initialRect.left,
        width: initialRect.width,
        height: initialRect.height,
      });
    },
    [active, currentStep]
  );

  useEffect(() => {
    if (!active) return;
    measureCurrentTarget(true);

    const onUpdate = () => measureCurrentTarget(false);
    window.addEventListener('resize', onUpdate);
    window.addEventListener('scroll', onUpdate, true);
    window.addEventListener('orientationchange', onUpdate);

    const settleTimer = setTimeout(onUpdate, 340);

    return () => {
      window.removeEventListener('resize', onUpdate);
      window.removeEventListener('scroll', onUpdate, true);
      window.removeEventListener('orientationchange', onUpdate);
      clearTimeout(settleTimer);
    };
  }, [active, stepIdx, measureCurrentTarget]);

  useLayoutEffect(() => {
    if (!active || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setCardSize((prev) =>
        Math.abs(prev.width - rect.width) > 2 || Math.abs(prev.height - rect.height) > 2
          ? { width: rect.width, height: rect.height }
          : prev
      );
    }
  }, [active, stepIdx, currentStep?.id]);

  const handleNext = useCallback(() => {
    if (stepIdx + 1 >= resolvedSteps.length) {
      onComplete();
    } else {
      setStepIdx((i) => i + 1);
    }
  }, [stepIdx, resolvedSteps.length, onComplete]);

  const handlePrev = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onSkipAll();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        handlePrev();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, onSkipAll, handleNext, handlePrev]);

  if (!active || !currentStep || typeof document === 'undefined') return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = currentStep.padding ?? 4;
  const margin = 10;
  const gap = 10;

  const spot = targetRect
    ? {
        top: Math.max(4, targetRect.top - pad),
        left: Math.max(4, targetRect.left - pad),
        width: Math.min(vw - 8, targetRect.width + pad * 2),
        height: Math.min(vh - 8, targetRect.height + pad * 2),
      }
    : null;

  const cardW = Math.min(248, vw - margin * 2);
  const cardH = Math.min(cardSize.height || 118, vh - margin * 2);

  let cardTop = Math.round((vh - cardH) / 2);
  let cardLeft = Math.round((vw - cardW) / 2);

  if (spot) {
    const spaceBelow = vh - (spot.top + spot.height) - margin;
    const spaceAbove = spot.top - margin;
    const spaceRight = vw - (spot.left + spot.width) - margin;
    const spaceLeft = spot.left - margin;
    const centerX = spot.left + spot.width / 2 - cardW / 2;
    const centerY = spot.top + spot.height / 2 - cardH / 2;

    if (spaceBelow >= cardH + gap) {
      cardTop = spot.top + spot.height + gap;
      cardLeft = centerX;
    } else if (spaceAbove >= cardH + gap) {
      cardTop = spot.top - cardH - gap;
      cardLeft = centerX;
    } else if (spaceRight >= cardW + gap) {
      cardLeft = spot.left + spot.width + gap;
      cardTop = centerY;
    } else if (spaceLeft >= cardW + gap) {
      cardLeft = spot.left - cardW - gap;
      cardTop = centerY;
    } else {
      cardTop = spaceBelow >= spaceAbove ? vh - cardH - margin : margin;
      cardLeft = centerX;
    }
  }

  cardLeft = Math.max(margin, Math.min(vw - cardW - margin, Math.round(cardLeft)));
  cardTop = Math.max(margin, Math.min(vh - cardH - margin, Math.round(cardTop)));

  const isLast = stepIdx >= resolvedSteps.length - 1;
  const portalRoot = (document.fullscreenElement as HTMLElement | null) || document.body;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] select-none"
      role="dialog"
      aria-modal="true"
      aria-label={currentStep.title}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Light translucent backdrop so site & video stay clearly visible */}
      <div
        className={`fixed inset-0 transition-opacity duration-200 ${
          spot ? 'bg-transparent' : 'bg-[#04060C]/45 backdrop-blur-[1.5px]'
        }`}
        aria-hidden="true"
      />

      {/* Slim Luminous Champagne Gold Spotlight Ring */}
      {spot && (
        <div
          aria-hidden="true"
          className="fixed pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{
            top: `${spot.top}px`,
            left: `${spot.left}px`,
            width: `${spot.width}px`,
            height: `${spot.height}px`,
            borderRadius: `${currentStep.borderRadius ?? 10}px`,
            boxShadow:
              '0 0 0 9999px rgba(4, 6, 12, 0.44), 0 0 0 1.5px rgba(244, 203, 115, 0.95), 0 0 20px rgba(229, 184, 90, 0.48)',
          }}
        />
      )}

      {/* Petite Crystal-Transparent Glass Tooltip */}
      <div
        ref={cardRef}
        style={{
          top: `${cardTop}px`,
          left: `${cardLeft}px`,
          width: `${cardW}px`,
        }}
        className="fixed z-10 rounded-2xl bg-gradient-to-b from-[#0A0E1A]/48 via-[#0A0E1A]/40 to-[#080B15]/52 backdrop-blur-md border border-[#F4CB73]/38 p-2.5 shadow-[0_14px_38px_rgba(0,0,0,0.46),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      >
        {/* Header + Micro Description */}
        <div className="flex items-start gap-2">
          <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-[#D9A441] via-[#E8BE63] to-[#F5D07E] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_3px_10px_rgba(229,184,90,0.38)]">
            <TourStepIcon id={currentStep.icon} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1.5">
              <h3 className="font-display text-xs font-bold text-white leading-tight truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)]">
                {currentStep.title}
              </h3>
              <span className="text-[10px] font-mono tabular-nums text-[#F4CB73] shrink-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
                {stepIdx + 1}/{resolvedSteps.length}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-white/92 leading-snug drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
              {currentStep.description}
            </p>
          </div>
        </div>

        {/* Hairline Progress Indicator */}
        <div className="mt-2 flex items-center gap-0.5" aria-hidden="true">
          {resolvedSteps.map((s, idx) => (
            <span
              key={s.id}
              className={`h-[2px] flex-1 rounded-full transition-all duration-300 ${
                idx <= stepIdx
                  ? 'bg-gradient-to-r from-[#D9A441] to-[#F4CB73]'
                  : 'bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* Compact Action Row */}
        <div className="mt-2 flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={onSkipAll}
            className="h-7 px-1.5 -ml-0.5 rounded-lg text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]"
          >
            {ui.skipAll}
          </button>

          <div className="flex items-center gap-1">
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                aria-label={ui.previous}
                className="h-7 w-7 rounded-lg bg-white/12 hover:bg-white/20 border border-white/15 text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="h-7 px-2.5 rounded-lg bg-gradient-to-r from-[#D9A441] via-[#E5B85A] to-[#F4CB73] hover:brightness-105 active:scale-[0.97] text-[#07080C] text-[11px] font-bold inline-flex items-center gap-0.5 shadow-[0_4px_12px_rgba(229,184,90,0.38)] transition-all cursor-pointer"
            >
              <span>{isLast ? ui.finish : ui.next}</span>
              {isLast ? <Check className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    portalRoot
  );
}
