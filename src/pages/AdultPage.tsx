import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { buildSlidesFromCatalog, HeroCarousel } from '../components/HeroCarousel';
import { InfiniteScrollSentinel } from '../components/InfiniteScrollSentinel';
import { MediaPosterCard } from '../components/MediaPosterCard';
import { movixApi } from '../lib/api';
import type { AppRoute, MediaSummary } from '../types/movix';

interface AdultPageProps {
  adultToken: string | null;
  onSetAdultToken: (token: string | null) => void;
  onNavigate: (route: AppRoute) => void;
  onGoBack: () => void;
  onPlay: (item: MediaSummary) => void;
  favoriteKeys: Set<string>;
  onToggleFavorite: (item: MediaSummary) => void;
}

export function AdultPage({
  adultToken,
  onSetAdultToken,
  onNavigate,
  onGoBack,
  onPlay,
  favoriteKeys,
  onToggleFavorite,
}: AdultPageProps) {
  const initialAuth = movixApi.getCachedAdultAuthStatus(adultToken || undefined);
  const initialCatalog =
    adultToken && initialAuth?.unlocked ? movixApi.getCachedAdultCatalog(adultToken, 1) : null;

  const [authStatus, setAuthStatus] = useState<{
    unlocked: boolean;
    requiresSetup: boolean;
    envPinConfigured: boolean;
  } | null>(() => initialAuth);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(() => !initialAuth);

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<MediaSummary[]>(() => initialCatalog?.results || []);
  const [totalPages, setTotalPages] = useState(() => initialCatalog?.totalPages || 1);
  const [megambdAdultCats, setMegambdAdultCats] = useState<
    Array<{ category_id: string; category_name: string }>
  >(() => initialCatalog?.megambdAdultCategories || []);
  const [loadingCatalog, setLoadingCatalog] = useState(() => Boolean(adultToken && initialAuth?.unlocked && !initialCatalog));
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const cached = movixApi.getCachedAdultAuthStatus(adultToken || undefined);
      if (!cached && !authStatus) setChecking(true);
      try {
        const s = await movixApi.getAdultAuthStatus(adultToken || undefined);
        if (!cancelled) {
          setAuthStatus(s);
          if (!s.unlocked && adultToken) onSetAdultToken(null);
        }
      } catch {
        if (!cancelled && !cached && !authStatus) {
          setAuthStatus({ unlocked: false, requiresSetup: false, envPinConfigured: false });
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [adultToken, onSetAdultToken]);

  useEffect(() => {
    if (!adultToken || !authStatus?.unlocked) return;
    let cancelled = false;
    async function load() {
      const cached = page === 1 && adultToken ? movixApi.getCachedAdultCatalog(adultToken, 1) : null;
      if (page === 1 && !cached?.results?.length) {
        setLoadingCatalog(true);
      } else if (page > 1) {
        setLoadingMore(true);
      }
      setCatalogError(null);
      try {
        const res = await movixApi.getAdultCatalog(adultToken!, page);
        if (!cancelled) {
          setItems((prev) => {
            if (page === 1) return res.results;
            const seen = new Set(prev.map((x) => `${x.mediaType}:${x.id}`));
            return [...prev, ...res.results.filter((x) => !seen.has(`${x.mediaType}:${x.id}`))];
          });
          setTotalPages(res.totalPages);
          setMegambdAdultCats(res.megambdAdultCategories || []);
        }
      } catch (err) {
        if (!cancelled && page === 1 && !cached?.results?.length) {
          setCatalogError(err instanceof Error ? err.message : 'Erro ao carregar catálogo +18.');
        }
      } finally {
        if (!cancelled) {
          setLoadingCatalog(false);
          setLoadingMore(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [adultToken, authStatus?.unlocked, page]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authStatus?.requiresSetup) {
        if (pin.trim().length < 4) {
          setAuthError('A senha deve ter pelo menos 4 caracteres ou dígitos.');
          return;
        }
        if (pin !== confirmPin) {
          setAuthError('As senhas não coincidem.');
          return;
        }
        const res = await movixApi.setupAdultPin(pin);
        onSetAdultToken(res.token);
        setAuthStatus({ unlocked: true, requiresSetup: false, envPinConfigured: false });
      } else {
        const res = await movixApi.unlockAdult(pin);
        onSetAdultToken(res.token);
        setAuthStatus((prev) => (prev ? { ...prev, unlocked: true } : null));
      }
      setPin('');
      setConfirmPin('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Falha ao validar senha.');
    }
  };

  const heroSlides = useMemo(() => buildSlidesFromCatalog(items, 6), [items]);

  return (
    <div>
      {checking ? (
        <div className="min-h-[55vh] flex items-center justify-center gap-3 text-sm text-[#B8C0D4]">
          <Loader2 className="h-5 w-5 animate-spin text-[#F3C669]" />
          <span>A verificar proteção +18...</span>
        </div>
      ) : !adultToken || !authStatus?.unlocked ? (
        <div className="max-w-md mx-auto px-4 py-10 sm:py-16 space-y-4">
          <button
            type="button"
            onClick={onGoBack}
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-[#95A0B8] hover:text-[#F3C669] cursor-pointer transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Voltar</span>
          </button>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-[#0F131E] border border-white/10 p-6 sm:p-8 space-y-5 shadow-2xl"
          >
            <div className="h-12 w-12 rounded-xl bg-[#E5B85A]/15 border border-[#E5B85A]/30 flex items-center justify-center text-[#F3C669]">
              {authStatus?.requiresSetup ? <KeyRound className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
            </div>

            <div>
              <h1 className="font-display text-2xl font-bold text-[#F6F7FB]">
                {authStatus?.requiresSetup ? 'Definir Senha +18' : 'Conteúdo Adulto (+18)'}
              </h1>
              <p className="text-sm text-[#95A0B8] mt-1.5 leading-relaxed">
                {authStatus?.requiresSetup
                  ? 'Esta secção mantém o restante catálogo limpo e seguro. Crie uma senha de proteção para desbloquear conteúdos +18.'
                  : 'Área restrita protegida por senha. Introduza a senha configurada para aceder.'}
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
                {authError}
              </div>
            )}

            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#C8D0E2]">Senha de Acesso (+18)</span>
                <input
                  type="password"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  className="w-full h-11 px-3.5 rounded-lg bg-[#06070B] border border-white/10 text-sm text-[#F6F7FB] placeholder-[#7C869E] focus:outline-none focus:border-[#E5B85A]"
                />
              </label>

              {authStatus?.requiresSetup && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[#C8D0E2]">Confirmar Senha</span>
                  <input
                    type="password"
                    required
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    placeholder="Repita a senha"
                    className="w-full h-11 px-3.5 rounded-lg bg-[#06070B] border border-white/10 text-sm text-[#F6F7FB] placeholder-[#7C869E] focus:outline-none focus:border-[#E5B85A]"
                  />
                </label>
              )}
            </div>

            <button
              type="submit"
              className="w-full h-11 rounded-lg bg-gradient-to-r from-[#D9A441] to-[#F3C669] hover:brightness-105 text-[#07080C] text-sm font-semibold transition-all cursor-pointer"
            >
              {authStatus?.requiresSetup ? 'Guardar Senha e Desbloquear' : 'Desbloquear Secção +18'}
            </button>
          </form>
        </div>
      ) : (
        <div>
          {!loadingCatalog && heroSlides.length > 0 && (
            <HeroCarousel
              slides={heroSlides}
              onSelectSlide={(slide) =>
                onPlay({
                  id: slide.id,
                  mediaType: slide.mediaType,
                  title: slide.title,
                  originalTitle: slide.title,
                  overview: '',
                  posterUrl: null,
                  backdropUrl: slide.backdropUrl,
                  year: '',
                  releaseDate: '',
                  rating: slide.rating,
                  voteCount: 0,
                  genreIds: [],
                  popularity: 0,
                })
              }
            />
          )}

          <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-9 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
            <div>
              <button
                type="button"
                onClick={onGoBack}
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-[#95A0B8] hover:text-[#F3C669] mb-2 cursor-pointer transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Voltar</span>
              </button>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 mb-1">
                <ShieldCheck className="h-4 w-4" />
                <span>Sessão +18 desbloqueada</span>
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-[#F6F7FB]">
                Conteúdo Adulto (+18)
              </h1>
            </div>

            <button
              type="button"
              onClick={() => onSetAdultToken(null)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#0F131E] hover:bg-[#151A28] border border-white/15 hover:border-[#E5B85A]/45 text-xs font-semibold text-[#F6F7FB] self-start cursor-pointer transition-colors"
            >
              <Lock className="h-4 w-4 text-[#F3C669]" />
              <span>Bloquear +18</span>
            </button>
          </div>

          {megambdAdultCats.length > 0 && (
            <div className="text-xs text-[#95A0B8]">
              Categorias MegamBD +18 disponíveis:{' '}
              {megambdAdultCats.map((c) => c.category_name).join(' · ')}
            </div>
          )}

          {loadingCatalog ? (
            <div className="py-16 flex items-center justify-center gap-3 text-sm text-[#B8C0D4]">
              <Loader2 className="h-5 w-5 animate-spin text-[#F3C669]" />
              <span>A carregar catálogo +18...</span>
            </div>
          ) : catalogError ? (
            <div className="py-12 text-center text-sm text-rose-400">{catalogError}</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#8E99B2]">
              Nenhum título +18 disponível neste momento.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2.5 sm:gap-4">
              {items.map((item) => (
                <MediaPosterCard
                  key={item.id}
                  item={item}
                  onSelect={(selected) =>
                    onNavigate({ page: selected.mediaType === 'tv' ? 'tv' : 'movie', id: selected.id })
                  }
                  onPlay={onPlay}
                  isFavorite={favoriteKeys.has(`${item.mediaType}:${item.id}`)}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          )}

          {!loadingCatalog && (
            <InfiniteScrollSentinel
              hasMore={page < totalPages}
              loadingMore={loadingMore}
              onLoadMore={() => {
                if (!loadingMore && page < totalPages) {
                  setPage((p) => p + 1);
                }
              }}
            />
          )}
          </div>
        </div>
      )}
    </div>
  );
}
