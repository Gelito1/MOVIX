import type { StreamingPlatformSlug } from '../types/movix';

export interface StreamingPlatformMeta {
  slug: StreamingPlatformSlug;
  providerId: number;
  name: string;
  description: string;
}

export const STREAMING_PLATFORMS: StreamingPlatformMeta[] = [
  {
    slug: 'netflix',
    providerId: 8,
    name: 'Netflix',
    description: 'Séries originais, filmes populares e produções exclusivas disponíveis na Netflix.',
  },
  {
    slug: 'disney',
    providerId: 337,
    name: 'Disney+',
    description: 'Disney, Pixar, Marvel, Star Wars e National Geographic em alta definição.',
  },
  {
    slug: 'globoplay',
    providerId: 307,
    name: 'Globoplay',
    description: 'Novelas, séries nacionais, documentários e sucessos da televisão brasileira.',
  },
  {
    slug: 'prime',
    providerId: 119,
    name: 'Prime Video',
    description: 'Produções Amazon Originals, cinema recente e séries premiadas.',
  },
  {
    slug: 'max',
    providerId: 1899,
    name: 'Max',
    description: 'Catálogo HBO, Warner Bros., DC e grandes sucessos de bilheteira.',
  },
  {
    slug: 'apple',
    providerId: 350,
    name: 'Apple TV+',
    description: 'Séries e filmes originais Apple TV+ aclamados pela crítica.',
  },
  {
    slug: 'crunchyroll',
    providerId: 283,
    name: 'Crunchyroll',
    description: 'Os maiores animes, simulações de temporada e clássicos japoneses.',
  },
  {
    slug: 'paramount',
    providerId: 531,
    name: 'Paramount+',
    description: 'Filmes da Paramount Pictures, séries de ação, dramas e programação infantil.',
  },
];

export function getStreamingPlatformBySlug(slug: StreamingPlatformSlug): StreamingPlatformMeta {
  return STREAMING_PLATFORMS.find((p) => p.slug === slug) || STREAMING_PLATFORMS[0];
}
