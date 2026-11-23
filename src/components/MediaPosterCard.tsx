import { useState } from 'react';
import { Film, Heart, Play, Tv } from 'lucide-react';
import type { MediaSummary } from '../types/movix';

interface MediaPosterCardProps {
  item: MediaSummary;
  onSelect: (item: MediaSummary) => void;
  onPlay?: (item: MediaSummary) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (item: MediaSummary) => void;
  progressPercent?: number;
  subtitleOverride?: string;
}

export function MediaPosterCard({
  item,
  onSelect,
  onPlay,
  isFavorite = false,
  onToggleFavorite,
  progressPercent,
  subtitleOverride,
}: MediaPosterCardProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const handlePosterClick = () => {
    if (onPlay) {
      onPlay(item);
    } else {
      onSelect(item);
    }
  };

  return (
    <article className="group relative flex flex-col gap-2 min-w-0">
      <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden bg-[#0F131E] border border-white/[0.09] group-hover:border-[#E5B85A]/45 shadow-[0_8px_22px_rgba(0,0,0,0.45)] transition-all duration-200 ease-out group-hover:-translate-y-1">
        <button
          type="button"
          onClick={handlePosterClick}
          className="block w-full h-full text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A]"
          aria-label={onPlay ? `Reproduzir ${item.title}` : `Ver detalhes de ${item.title}`}
        >
          {item.posterUrl && !imgFailed ? (
            <img
              src={item.posterUrl}
              alt={`Poster de ${item.title}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="w-full h-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-[#151B2B] via-[#0F131E] to-[#080A10]">
              {item.mediaType === 'tv' ? (
                <Tv className="h-8 w-8 text-[#F3C669]/75 mb-2" aria-hidden="true" />
              ) : (
                <Film className="h-8 w-8 text-[#F3C669]/75 mb-2" aria-hidden="true" />
              )}
              <span className="text-xs font-medium text-[#D1D7E6] line-clamp-3">{item.title}</span>
            </div>
          )}

          {/* Desktop Hover Scrim + Play Indicator */}
          <div
            className="hidden sm:flex absolute inset-0 bg-gradient-to-t from-[#06070B]/92 via-[#06070B]/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center"
            aria-hidden="true"
          >
            <span className="h-12 w-12 rounded-full bg-gradient-to-br from-[#F4CB73] to-[#C89333] text-[#07080C] flex items-center justify-center shadow-[0_8px_24px_rgba(229,184,90,0.45)] transform scale-90 group-hover:scale-100 transition-transform duration-200">
              <Play className="h-5 w-5 fill-current ml-0.5" />
            </span>
          </div>
        </button>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(item);
            }}
            aria-label={isFavorite ? `Remover ${item.title} dos favoritos` : `Adicionar ${item.title} aos favoritos`}
            className={`absolute top-2 right-2 h-8 w-8 rounded-lg flex items-center justify-center border transition-colors duration-150 cursor-pointer ${
              isFavorite
                ? 'bg-gradient-to-br from-[#F4CB73] to-[#C89333] border-[#F3C669] text-[#07080C] shadow-md'
                : 'bg-[#07090F]/80 border-white/15 text-[#F6F7FB] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:border-[#E5B85A]/50 hover:text-[#F3C669]'
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
          </button>
        )}

        {typeof progressPercent === 'number' && progressPercent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15" aria-hidden="true">
            <div
              className="h-full bg-gradient-to-r from-[#C89333] to-[#F4CB73]"
              style={{ width: `${Math.min(100, Math.max(4, progressPercent))}%` }}
            />
          </div>
        )}
      </div>

      <div className="min-w-0 px-0.5">
        <button
          type="button"
          onClick={() => onSelect(item)}
          className="text-left w-full text-xs sm:text-sm font-semibold text-[#F6F7FB] hover:text-[#F3C669] transition-colors truncate block cursor-pointer"
        >
          {item.title}
        </button>
        <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-[#95A0B8] tabular-nums truncate mt-0.5">
          {subtitleOverride ? (
            <span className="truncate">{subtitleOverride}</span>
          ) : (
            <>
              <span>{item.mediaType === 'tv' ? 'Série' : 'Filme'}</span>
              {item.year && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{item.year}</span>
                </>
              )}
              {item.rating > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#F3C669] font-medium">★ {item.rating.toFixed(1)}</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
