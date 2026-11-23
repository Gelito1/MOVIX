import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface InfiniteScrollSentinelProps {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function InfiniteScrollSentinel({
  hasMore,
  loadingMore,
  onLoadMore,
}: InfiniteScrollSentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          callbackRef.current();
        }
      },
      { rootMargin: '700px 0px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore]);

  if (!hasMore && !loadingMore) return null;

  return (
    <div ref={ref} className="py-8 flex items-center justify-center gap-2.5 text-xs sm:text-sm text-[#95A0B8]">
      {loadingMore && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-[#F3C669]" />
          <span>A carregar mais conteúdos...</span>
        </>
      )}
    </div>
  );
}
