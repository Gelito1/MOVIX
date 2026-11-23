import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { MediaSummary } from '../types/movix';
import { MediaPosterCard } from './MediaPosterCard';

interface MediaRowProps {
  title: string;
  items: MediaSummary[];
  onSelect: (item: MediaSummary) => void;
  onPlay?: (item: MediaSummary) => void;
  onViewAll?: () => void;
  isFavoriteFn?: (item: MediaSummary) => boolean;
  onToggleFavorite?: (item: MediaSummary) => void;
}

export function MediaRow({
  title,
  items,
  onSelect,
  onPlay,
  onViewAll,
  isFavoriteFn,
  onToggleFavorite,
}: MediaRowProps) {
  const { t } = useAuth();
  const trackRef = useRef<HTMLDivElement>(null);

  if (items.length === 0) return null;

  const scrollByAmount = (direction: -1 | 1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(320, el.clientWidth * 0.75), behavior: 'smooth' });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#F6F7FB]">
          {title}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-xs sm:text-sm font-medium text-[#95A0B8] hover:text-[#F3C669] transition-colors mr-1 cursor-pointer whitespace-nowrap"
            >
              {t.viewAll}
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => scrollByAmount(-1)}
              aria-label={`Deslocar ${title} para a esquerda`}
              className="h-9 w-9 rounded-lg border border-white/10 bg-[#0F131E] hover:bg-[#151A28] hover:border-[#E5B85A]/40 hover:text-[#F3C669] text-[#D1D7E6] flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollByAmount(1)}
              aria-label={`Deslocar ${title} para a direita`}
              className="h-9 w-9 rounded-lg border border-white/10 bg-[#0F131E] hover:bg-[#151A28] hover:border-[#E5B85A]/40 hover:text-[#F3C669] text-[#D1D7E6] flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex gap-4 overflow-x-auto scrollbar-none pb-2 snap-x snap-mandatory"
      >
        {items.map((item) => (
          <div
            key={`${item.mediaType}-${item.id}`}
            className="w-[152px] sm:w-[178px] md:w-[196px] shrink-0 snap-start"
          >
            <MediaPosterCard
              item={item}
              onSelect={onSelect}
              onPlay={onPlay}
              isFavorite={isFavoriteFn ? isFavoriteFn(item) : false}
              onToggleFavorite={onToggleFavorite}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
