import { Clock, Search, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { AppRoute } from '../types/movix';
import { BrandMark } from './BrandMark';
import { PWAInstallButton } from './PWAInstallButton';

interface HeaderProps {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onOpenSearch: () => void;
  onOpenAccount: () => void;
}

export function Header({ route, onNavigate, onOpenSearch, onOpenAccount }: HeaderProps) {
  const { user, t } = useAuth();
  const firstName =
    user?.displayName?.trim().split(/\s+/)[0] ||
    user?.email?.split('@')[0] ||
    '';

  return (
    <header className="sticky top-0 z-40 w-full bg-[#07090F]/90 backdrop-blur-xl border-b border-white/[0.07]">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-2.5 sm:gap-5">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => onNavigate({ page: 'home' })}
          className="focus-visible:outline-2 focus-visible:outline-[#E5B85A] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          aria-label="MOVIX"
        >
          <BrandMark size="sm" />
        </button>

        {/* Zone 2: Full-width Interactive Search Pill */}
        <button
          type="button"
          data-tour="app-search"
          onClick={onOpenSearch}
          aria-label={t.searchPlaceholder}
          className="flex-1 max-w-xl h-10 px-3.5 rounded-full bg-[#121622]/95 hover:bg-[#171C2C] border border-white/[0.09] hover:border-[#E5B85A]/35 flex items-center gap-2.5 text-left text-xs sm:text-sm text-[#95A0B8] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#E5B85A] min-w-0"
        >
          <Search className="h-4 w-4 text-[#E5B85A]/85 shrink-0" aria-hidden="true" />
          <span className="truncate">{t.searchPlaceholder}</span>
        </button>

        {/* Zone 3: Install App, Minha Lista & Single Profile Icon */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton />
          <button
            type="button"
            data-tour="app-mylist-desktop"
            onClick={() => onNavigate({ page: 'mylist' })}
            aria-label={t.myList}
            className={`hidden md:inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              route.page === 'mylist'
                ? 'text-[#F3C669] bg-[#E5B85A]/12 border border-[#E5B85A]/25'
                : 'text-[#C8D0E0] hover:text-[#F6F7FB] hover:bg-white/[0.06]'
            }`}
          >
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">{t.myList}</span>
          </button>

          <button
            type="button"
            data-tour="app-profile"
            onClick={onOpenAccount}
            aria-label={t.profile}
            title={firstName || t.profile}
            className={`h-9 w-9 sm:h-10 sm:w-10 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 overflow-hidden focus-visible:outline-2 focus-visible:outline-[#E5B85A] ${
              user
                ? 'bg-[#151B2C] hover:bg-[#1C2438] text-[#F3C669] border border-[#E5B85A]/45'
                : 'bg-white/[0.06] hover:bg-white/[0.12] text-[#C8D0E0] hover:text-[#F6F7FB] border border-white/[0.1]'
            }`}
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={firstName || t.profile}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <User className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
