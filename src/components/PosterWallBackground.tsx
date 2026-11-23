import { useEffect, useMemo, useState } from 'react';
import { Film } from 'lucide-react';
import { movixApi } from '../lib/api';

interface PosterWallBackgroundProps {
  /** Whether the poster mosaic scrolls upward continuously */
  animated?: boolean;
  /** Balanced cinematic dimming level */
  intensity?: 'splash' | 'auth';
}

interface PosterTile {
  id: string;
  title: string;
  posterUrl: string | null;
}

const FALLBACK_TILES: PosterTile[] = [
  { id: 'f1', title: 'MOVIX Cinema', posterUrl: null },
  { id: 'f2', title: 'Lançamentos HD', posterUrl: null },
  { id: 'f3', title: 'Séries Originais', posterUrl: null },
  { id: 'f4', title: 'Ficção Científica', posterUrl: null },
  { id: 'f5', title: 'Ação & Aventura', posterUrl: null },
  { id: 'f6', title: 'Animes & Doramas', posterUrl: null },
  { id: 'f7', title: 'Suspense', posterUrl: null },
  { id: 'f8', title: 'Clássicos', posterUrl: null },
  { id: 'f9', title: 'Documentários', posterUrl: null },
  { id: 'f10', title: 'Estreias', posterUrl: null },
  { id: 'f11', title: 'Comédia', posterUrl: null },
  { id: 'f12', title: 'Drama', posterUrl: null },
  { id: 'f13', title: 'Fantasia', posterUrl: null },
  { id: 'f14', title: 'Aventura', posterUrl: null },
  { id: 'f15', title: 'Premiados', posterUrl: null },
];

const COLUMN_DURATIONS = ['30s', '38s', '33s', '42s', '35s'];
const COLUMN_OFFSETS = ['0px', '36px', '14px', '48px', '22px'];

function collectPostersFromHome(
  data: ReturnType<typeof movixApi.getCachedHomeCatalog>
): PosterTile[] {
  if (!data) return [];
  const seen = new Set<string>();
  const items: PosterTile[] = [];
  const pools = [
    data.nowPlayingMovies || [],
    data.popularMovies || [],
    data.popularSeries || [],
    data.animes || [],
    data.doramas || [],
    data.dramas || [],
  ];

  for (const list of pools) {
    for (const media of list) {
      if (!media.posterUrl) continue;
      const key = `${media.mediaType}:${media.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: key,
        title: media.title,
        posterUrl: media.posterUrl,
      });
      if (items.length >= 40) return items;
    }
  }
  return items;
}

export function PosterWallBackground({
  animated = true,
  intensity = 'auth',
}: PosterWallBackgroundProps) {
  const [tiles, setTiles] = useState<PosterTile[]>(() => {
    const cached = collectPostersFromHome(movixApi.getCachedHomeCatalog());
    return cached.length >= 10 ? cached : FALLBACK_TILES;
  });
  const [brokenIds, setBrokenIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    const cached = collectPostersFromHome(movixApi.getCachedHomeCatalog());
    if (cached.length >= 10) {
      setTiles(cached);
      return;
    }

    movixApi
      .getHomeCatalog()
      .then((home) => {
        if (!active) return;
        const loaded = collectPostersFromHome(home);
        if (loaded.length >= 6) {
          setTiles(loaded);
        }
      })
      .catch(() => {
        // Keep clean fallback tiles
      });

    return () => {
      active = false;
    };
  }, []);

  const columns = useMemo(() => {
    const cols: PosterTile[][] = [[], [], [], [], []];
    const source = tiles.length >= 15 ? tiles : [...tiles, ...tiles, ...tiles].slice(0, 25);
    source.forEach((tile, idx) => {
      cols[idx % 5].push(tile);
    });
    return cols.map((col, colIdx) => {
      const filled = col.length > 0 ? [...col] : [...FALLBACK_TILES.slice(0, 6)];
      while (filled.length < 7) {
        filled.push(source[(filled.length + colIdx) % source.length]);
      }
      return filled;
    });
  }, [tiles]);

  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none select-none bg-[#05060A]"
      aria-hidden="true"
    >
      {/* Multi-column staggered upward-scrolling movie poster showcase */}
      <div className="absolute -inset-x-4 -top-10 -bottom-10 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-3.5">
        {columns.map((col, colIdx) => {
          const visibilityClass =
            colIdx === 3
              ? 'hidden sm:block'
              : colIdx === 4
              ? 'hidden lg:block'
              : 'block';
          const looped = animated ? [...col, ...col] : col;

          return (
            <div
              key={colIdx}
              className={`relative h-full overflow-hidden ${visibilityClass}`}
              style={{ paddingTop: COLUMN_OFFSETS[colIdx] }}
            >
              <div
                className={
                  animated
                    ? 'movix-poster-col-up gap-3 sm:gap-3.5'
                    : 'flex flex-col gap-3 sm:gap-3.5'
                }
                style={
                  animated
                    ? {
                        animationDuration: COLUMN_DURATIONS[colIdx],
                        animationDelay: `${colIdx * -5.5}s`,
                      }
                    : undefined
                }
              >
                {looped.map((tile, itemIdx) => {
                  const uniqueKey = `${colIdx}-${itemIdx}-${tile.id}`;
                  const showImg = Boolean(tile.posterUrl && !brokenIds[tile.id]);
                  return (
                    <div
                      key={uniqueKey}
                      className="relative aspect-[2/3] w-full rounded-2xl overflow-hidden bg-gradient-to-br from-[#161C2E] via-[#0F1422] to-[#080B12] ring-1 ring-white/[0.14] shadow-[0_14px_34px_rgba(0,0,0,0.48)] shrink-0"
                    >
                      {showImg ? (
                        <img
                          src={tile.posterUrl!}
                          alt=""
                          loading="eager"
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenIds((prev) => ({ ...prev, [tile.id]: true }))
                          }
                          className="h-full w-full object-cover brightness-[0.96] contrast-[1.06] saturate-[1.12]"
                        />
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center bg-gradient-to-b from-[#1A2136] to-[#0C101B]">
                          <Film className="h-6 w-6 text-[#E5B85A]/55 mb-2" />
                          <span className="text-[11px] font-medium text-[#A8B4CE]/80 line-clamp-2">
                            {tile.title}
                          </span>
                        </div>
                      )}
                      {/* Subtle cinema specular sheen */}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/25 via-transparent to-white/[0.08]" />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Balanced edge-only cinema scrims so posters stay vivid and luminous */}
      {intensity === 'splash' ? (
        <div className="absolute inset-0 bg-gradient-to-b from-[#05060A]/65 via-[#05060A]/42 to-[#05060A]/78" />
      ) : (
        <>
          {/* Soft uniform ambient cinema tint */}
          <div className="absolute inset-0 bg-[#05060A]/26" />
          {/* Top header legibility vignette */}
          <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-[#05060A]/80 via-[#05060A]/35 to-transparent" />
          {/* Bottom legal links legibility vignette */}
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05060A]/88 via-[#05060A]/40 to-transparent" />
          {/* Subtle Champagne Gold atmospheric halo at top */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 75% 32% at 50% 0%, rgba(229, 184, 90, 0.14), transparent 72%)',
            }}
          />
        </>
      )}
    </div>
  );
}
