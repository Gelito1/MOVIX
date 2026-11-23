import { ChevronRight } from 'lucide-react';
import { movixApi } from '../lib/api';
import { STREAMING_PLATFORMS } from '../lib/providers';
import type { AppRoute, StreamingPlatformSlug } from '../types/movix';

interface StreamingHubRowProps {
  onNavigate: (route: AppRoute) => void;
}

function PlatformCardArt({ slug }: { slug: StreamingPlatformSlug }) {
  switch (slug) {
    case 'netflix':
      return (
        <div className="w-full h-full bg-[#09090D] flex items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-[#E50914]/15 via-transparent to-transparent" />
          <span className="font-sans font-black tracking-tighter text-xl sm:text-2xl text-[#E50914] drop-shadow">
            NETFLIX
          </span>
        </div>
      );
    case 'disney':
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#061844] via-[#0D2E7A] to-[#081948] flex items-center justify-center relative overflow-hidden">
          <div className="text-center leading-none">
            <div className="w-16 h-3 mx-auto border-t-2 border-[#64B5FF] rounded-t-full -mb-1 opacity-90" />
            <span className="font-display font-bold text-lg sm:text-xl text-white tracking-tight">
              Disney<span className="text-[#64B5FF]">+</span>
            </span>
          </div>
        </div>
      );
    case 'globoplay':
      return (
        <div className="w-full h-full bg-gradient-to-r from-[#FF2A2A] via-[#FF5E14] to-[#FF8A00] flex items-center justify-center">
          <span className="font-sans font-extrabold text-lg sm:text-xl tracking-tight text-white">
            globoplay
          </span>
        </div>
      );
    case 'prime':
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#001A33] via-[#003E7E] to-[#0073E6] flex items-center justify-center">
          <div className="text-center leading-tight">
            <span className="font-sans font-bold text-base sm:text-lg text-white tracking-tight block">
              prime video
            </span>
            <div className="w-12 h-1 mx-auto mt-0.5 rounded-full bg-[#00A8E1]" />
          </div>
        </div>
      );
    case 'max':
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#070E2E] via-[#13297A] to-[#2347C5] flex items-center justify-center">
          <span className="font-sans font-black text-2xl sm:text-3xl tracking-tight text-white">
            max
          </span>
        </div>
      );
    case 'apple':
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#16181E] via-[#232732] to-[#121419] flex items-center justify-center">
          <span className="font-sans font-semibold text-base sm:text-lg tracking-tight text-[#F5F5F7]">
            Apple TV+
          </span>
        </div>
      );
    case 'crunchyroll':
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#CC4B00] via-[#F47521] to-[#FF9436] flex items-center justify-center">
          <span className="font-sans font-extrabold text-sm sm:text-base tracking-tight text-white">
            crunchyroll
          </span>
        </div>
      );
    case 'paramount':
      return (
        <div className="w-full h-full bg-gradient-to-br from-[#001D54] via-[#0045B5] to-[#0066FF] flex items-center justify-center">
          <span className="font-display font-bold text-sm sm:text-base tracking-tight text-white">
            Paramount+
          </span>
        </div>
      );
  }
}

export function StreamingHubRow({ onNavigate }: StreamingHubRowProps) {
  const renderGroup = (isDuplicate: boolean) => (
    <div
      className="flex items-center gap-2.5 sm:gap-3.5 pr-2.5 sm:pr-3.5 shrink-0"
      aria-hidden={isDuplicate ? 'true' : undefined}
    >
      {STREAMING_PLATFORMS.map((platform) => (
        <button
          key={`${isDuplicate ? 'dup' : 'main'}-${platform.slug}`}
          type="button"
          tabIndex={isDuplicate ? -1 : undefined}
          onMouseEnter={() => movixApi.prefetchRoute({ page: 'provider', slug: platform.slug })}
          onFocus={() => movixApi.prefetchRoute({ page: 'provider', slug: platform.slug })}
          onTouchStart={() => movixApi.prefetchRoute({ page: 'provider', slug: platform.slug })}
          onClick={() => onNavigate({ page: 'provider', slug: platform.slug })}
          aria-label={isDuplicate ? undefined : `Explorar catálogo ${platform.name}`}
          className="w-[126px] sm:w-[164px] md:w-[178px] aspect-[16/9] shrink-0 rounded-xl overflow-hidden border border-white/[0.09] ring-1 ring-inset ring-white/[0.06] hover:border-[#E5B85A]/55 hover:ring-[#E5B85A]/45 shadow-[0_6px_18px_rgba(0,0,0,0.48)] transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-[#E5B85A] cursor-pointer"
        >
          <PlatformCardArt slug={platform.slug} />
        </button>
      ))}
    </div>
  );

  return (
    <section className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg sm:text-2xl font-bold tracking-tight text-[#F6F7FB]">
          Streaming
        </h2>
        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[#95A0B8]">
          Explorar por plataforma <ChevronRight className="h-3.5 w-3.5 text-[#F3C669]" aria-hidden="true" />
        </span>
      </div>

      <div
        data-tour="app-streaming"
        className="movix-marquee-viewport relative overflow-hidden py-1"
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-6 sm:w-10 z-10 bg-gradient-to-r from-[#06070B] to-transparent"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-6 sm:w-10 z-10 bg-gradient-to-l from-[#06070B] to-transparent"
          aria-hidden="true"
        />
        <div className="movix-marquee-track">
          {renderGroup(false)}
          {renderGroup(true)}
        </div>
      </div>
    </section>
  );
}
