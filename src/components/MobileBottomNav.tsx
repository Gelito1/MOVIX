import { Bookmark, Film, Home, Tv } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { movixApi } from '../lib/api';
import type { AppRoute } from '../types/movix';

interface MobileBottomNavProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

export function MobileBottomNav({ route, onNavigate }: MobileBottomNavProps) {
  const { t } = useAuth();

  const items: Array<{
    id: string;
    label: string;
    icon: typeof Home;
    route: AppRoute;
    active: boolean;
  }> = [
    {
      id: 'home',
      label: t.home,
      icon: Home,
      route: { page: 'home' },
      active: route.page === 'home',
    },
    {
      id: 'series',
      label: t.series,
      icon: Tv,
      route: { page: 'series' },
      active: route.page === 'series' || route.page === 'tv',
    },
    {
      id: 'movies',
      label: t.movies,
      icon: Film,
      route: { page: 'movies' },
      active: route.page === 'movies' || route.page === 'movie',
    },
    {
      id: 'mylist',
      label: t.listShort,
      icon: Bookmark,
      route: { page: 'mylist' },
      active: route.page === 'mylist',
    },
  ];

  return (
    <nav
      data-tour="app-mobile-nav"
      aria-label="Navegação inferior móvel"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#07090F]/92 backdrop-blur-xl border-t border-white/[0.08] h-16 px-2 grid grid-cols-4 items-center"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            data-tour={item.id === 'mylist' ? 'app-mylist-mobile' : undefined}
            onTouchStart={() => movixApi.prefetchRoute(item.route)}
            onMouseEnter={() => movixApi.prefetchRoute(item.route)}
            onClick={() => onNavigate(item.route)}
            className={`relative flex flex-col items-center justify-center gap-1 min-h-[44px] py-1.5 rounded-lg transition-colors cursor-pointer ${
              item.active ? 'text-[#F6F7FB]' : 'text-[#8E99B2] hover:text-[#D1D7E6]'
            }`}
          >
            {item.active && (
              <span
                className="absolute top-0 inset-x-4 h-[2px] rounded-full bg-gradient-to-r from-[#C89333] via-[#F3C669] to-[#C89333]"
                aria-hidden="true"
              />
            )}
            <Icon className={`h-5 w-5 ${item.active ? 'text-[#F3C669]' : ''}`} aria-hidden="true" />
            <span className="text-[11px] font-medium leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
