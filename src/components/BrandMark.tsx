import { useState } from 'react';
import { Film } from 'lucide-react';

interface BrandMarkProps {
  size?: 'sm' | 'md';
}

export function BrandMark({ size = 'md' }: BrandMarkProps) {
  const [imgError, setImgError] = useState(false);
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const textSize = size === 'sm' ? 'text-lg' : 'text-xl sm:text-[22px]';

  return (
    <span className="inline-flex items-center gap-3 whitespace-nowrap shrink-0 select-none">
      <span
        className={`${dim} rounded-lg overflow-hidden bg-black border border-[#E5B85A]/35 shadow-[0_0_16px_rgba(229,184,90,0.18)] inline-flex items-center justify-center shrink-0`}
      >
        {!imgError ? (
          <img
            src="/assets/aistudio/1795251757372_421000f2.jpg"
            alt="Emblema MOVIX"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Film className="h-4 w-4 text-[#E5B85A]" aria-hidden="true" />
        )}
      </span>
      <span
        className={`font-brand ${textSize} font-bold tracking-[0.2em] bg-gradient-to-b from-[#FFF1C1] via-[#E5B85A] to-[#B88428] bg-clip-text text-transparent`}
      >
        MOVIX
      </span>
    </span>
  );
}
