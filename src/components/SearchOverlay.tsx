import { useEffect, useRef, useState } from 'react';
import { Film, Loader2, Search, Tv, X } from 'lucide-react';
import { movixApi } from '../lib/api';
import { MovixAdSlot } from './MovixAdSlot';
import type { MediaSummary } from '../types/movix';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelectMedia: (item: MediaSummary) => void;
}

export function SearchOverlay({ open, onClose, onSelectMedia }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'multi' | 'movie' | 'tv'>('multi');
  const [results, setResults] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await movixApi.search(trimmed, filterType, 1);
        setResults(res.results);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro na pesquisa.');
      } finally {
        setLoading(false);
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [query, filterType, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#05060A]/88 backdrop-blur-md flex items-start justify-center p-4 sm:pt-16 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Pesquisar no catálogo MOVIX"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-[#0F131E] border border-white/10 rounded-2xl overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center gap-3">
          <Search className="h-5 w-5 text-[#F3C669] shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar filmes, séries ou títulos originais..."
            className="w-full bg-transparent text-base text-[#F6F7FB] placeholder-[#7C869E] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-[#95A0B8] hover:text-[#F3C669] px-2 py-1 cursor-pointer"
            >
              Limpar
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar pesquisa"
            className="h-10 w-10 rounded-lg border border-white/10 flex items-center justify-center text-[#95A0B8] hover:text-[#F6F7FB] hover:border-[#E5B85A]/40 hover:bg-white/5 cursor-pointer shrink-0 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 sm:px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-4 bg-[#0B0E17]">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#06070B] border border-white/[0.08]">
            {(
              [
                { id: 'multi', label: 'Tudo' },
                { id: 'movie', label: 'Filmes' },
                { id: 'tv', label: 'Séries' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                  filterType === tab.id
                    ? 'bg-gradient-to-r from-[#D9A441] to-[#F3C669] text-[#07080C] shadow-sm'
                    : 'text-[#95A0B8] hover:text-[#F6F7FB]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-[#8E99B2] tabular-nums">
            {results.length > 0 ? `${results.length} resultados` : 'TMDB em tempo real'}
          </span>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-4 sm:p-5">
          {loading && (
            <div className="py-12 flex items-center justify-center gap-3 text-sm text-[#B8C0D4]">
              <Loader2 className="h-5 w-5 animate-spin text-[#F3C669]" />
              <span>A procurar títulos...</span>
            </div>
          )}

          {!loading && error && (
            <div className="py-10 text-center text-sm text-rose-400">{error}</div>
          )}

          {!loading && !error && query.trim().length < 2 && (
            <div className="py-12 text-center text-sm text-[#8E99B2]">
              Escreva pelo menos 2 caracteres para pesquisar filmes e séries no catálogo.
            </div>
          )}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <div className="py-12 text-center text-sm text-[#8E99B2]">
              Nenhum resultado encontrado para "{query}".
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {results.map((item) => (
                <button
                  key={`${item.mediaType}-${item.id}`}
                  type="button"
                  onClick={() => {
                    onSelectMedia(item);
                    onClose();
                  }}
                  className="flex items-start gap-3.5 p-2.5 rounded-xl bg-[#080A10] hover:bg-[#161C2C] border border-white/[0.07] hover:border-[#E5B85A]/30 text-left transition-colors cursor-pointer"
                >
                  <div className="h-20 w-14 rounded-lg overflow-hidden bg-[#151A28] shrink-0 flex items-center justify-center">
                    {item.posterUrl ? (
                      <img
                        src={item.posterUrl}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : item.mediaType === 'tv' ? (
                      <Tv className="h-5 w-5 text-[#F3C669]/75" />
                    ) : (
                      <Film className="h-5 w-5 text-[#F3C669]/75" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 py-0.5">
                    <h4 className="text-sm font-semibold text-[#F6F7FB] truncate">{item.title}</h4>
                    <div className="flex items-center gap-1.5 text-xs text-[#95A0B8] tabular-nums mt-1">
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
                    </div>
                    {item.overview && (
                      <p className="text-xs text-[#8E99B2] line-clamp-2 mt-1.5">{item.overview}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="pt-3 empty:hidden">
            <MovixAdSlot placement="search_page" />
          </div>
        </div>
      </div>
    </div>
  );
}
