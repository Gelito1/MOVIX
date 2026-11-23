import { Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { movixApi } from '../lib/api';
import type { AppRoute, ThematicSection } from '../types/movix';

interface CategoryRibbonProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  adultUnlocked?: boolean;
}

export function CategoryRibbon({ route, onNavigate, adultUnlocked = false }: CategoryRibbonProps) {
  const { t } = useAuth();

  const items: Array<{
    id: string;
    label: string;
    route: AppRoute;
    locked?: boolean;
  }> = [
    { id: 'home', label: t.home, route: { page: 'home' } },
    { id: 'series', label: t.series, route: { page: 'series' } },
    { id: 'movies', label: t.movies, route: { page: 'movies' } },
    { id: 'animes', label: t.animes, route: { page: 'section', section: 'animes' as ThematicSection } },
    { id: 'novelas', label: t.novelas, route: { page: 'section', section: 'novelas' as ThematicSection } },
    { id: 'doramas', label: t.doramas, route: { page: 'section', section: 'doramas' as ThematicSection } },
    { id: 'dramas', label: t.dramas, route: { page: 'section', section: 'dramas' as ThematicSection } },
    { id: 'infantil', label: t.kids, route: { page: 'section', section: 'infantil' as ThematicSection } },
    {
      id: 'documentarios',
      label: t.documentaries,
      route: { page: 'section', section: 'documentarios' as ThematicSection },
    },
    { id: 'adult', label: '+18', route: { page: 'adult' }, locked: true },
  ];

  const isSelected = (item: (typeof items)[number]) => {
    if (item.id === 'home' && route.page === 'home') return true;
    if (item.id === 'movies' && route.page === 'movies') return true;
    if (item.id === 'series' && route.page === 'series') return true;
    if (item.id === 'adult' && route.page === 'adult') return true;
    if (route.page === 'section' && item.route.page === 'section' && route.section === item.route.section) {
      return true;
    }
    return false;
  };

  return (
    <nav
      data-tour="app-categories"
      aria-label="Categorias"
      className="w-full border-b border-white/[0.06] bg-[#07090F]/85 backdrop-blur-md"
    >
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 flex items-center gap-5 sm:gap-7 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const active = isSelected(item);
          return (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => movixApi.prefetchRoute(item.route)}
              onFocus={() => movixApi.prefetchRoute(item.route)}
              onTouchStart={() => movixApi.prefetchRoute(item.route)}
              onClick={() => onNavigate(item.route)}
              className={`relative py-2.5 sm:py-3 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A] ${
                active
                  ? 'text-[17px] sm:text-lg font-bold text-[#F6F7FB]'
                  : 'text-[15px] sm:text-base font-medium text-[#95A0B8] hover:text-[#F6F7FB]'
              }`}
            >
              {item.locked && (
                <Lock
                  className={`h-3.5 w-3.5 ${
                    adultUnlocked ? 'text-emerald-400' : active ? 'text-[#F3C669]' : 'text-[#E5B85A]/80'
                  }`}
                  aria-hidden="true"
                />
              )}
              <span>{item.label}</span>
              {active && (
                <span
                  className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full bg-gradient-to-r from-[#C89333] via-[#F3C669] to-[#C89333] shadow-[0_0_10px_rgba(243,198,105,0.45)]"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
