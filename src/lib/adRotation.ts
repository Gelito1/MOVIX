import type { AdPlacement, PublicAdItem } from '../types/adm';

export type RotationPlacement = AdPlacement | 'hero';

interface AdExposureRecord {
  count: number;
  lastShownAt: number;
  lastPlacement: RotationPlacement | null;
}

interface SlotClaim {
  slotId: string;
  adId: string;
  placement: RotationPlacement;
  priority: number;
  claimedAt: number;
}

const STORAGE_KEY = 'movix_ad_rotation_v3';

// Slot priority hierarchy:
// Top header and active video player overlays have highest priority;
// lower page slots yield cleanly so the exact same ad NEVER shows in two places at once.
const PLACEMENT_PRIORITY: Record<RotationPlacement, number> = {
  before_player: 100,
  during_playback: 100,
  after_playback: 100,
  header: 90,
  hero: 75,
  home: 60,
  movie_detail: 60,
  series_detail: 60,
  search_page: 55,
  between_movies: 50,
  seasons_page: 48,
  episodes_page: 46,
  categories_page: 44,
  sidebar: 40,
  footer: 30,
};

// Tracks which ad is currently displayed in each mounted slot on screen.
// Invariant: an `adId` is NEVER claimed by more than one slot at the same time.
const activeSlotClaims = new Map<string, SlotClaim>();
const assignmentListeners = new Set<() => void>();
let slotCounter = 0;
let notifyScheduled = false;

// Fallback in-memory exposure state if sessionStorage is restricted
const memoryExposures = new Map<string, AdExposureRecord>();

function getPlacementPriority(placement: RotationPlacement): number {
  return PLACEMENT_PRIORITY[placement] ?? 40;
}

function scheduleNotifyListeners(): void {
  if (notifyScheduled || assignmentListeners.size === 0) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    // Randomize listener notification order so when a slot releases an ad,
    // waiting lower slots pick it up in a varied, organized way instead of always the same slot.
    const listeners = shuffleArray(Array.from(assignmentListeners));
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Ignore subscriber errors
      }
    }
  });
}

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function readExposureMap(): Record<string, AdExposureRecord> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, AdExposureRecord>;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // fallback to memory map
  }
  const obj: Record<string, AdExposureRecord> = {};
  for (const [k, v] of memoryExposures.entries()) {
    obj[k] = v;
  }
  return obj;
}

function writeExposureMap(map: Record<string, AdExposureRecord>): void {
  memoryExposures.clear();
  for (const [k, v] of Object.entries(map)) {
    memoryExposures.set(k, v);
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage limits
  }
}

export function subscribeAdAssignments(listener: () => void): () => void {
  assignmentListeners.add(listener);
  return () => {
    assignmentListeners.delete(listener);
  };
}

export function createAdSlotId(placement: RotationPlacement): { id: string; staggerMs: number } {
  slotCounter += 1;
  const idx = slotCounter;
  // Add small random jitter + index stagger so slots on the same page change at different moments
  const randomJitter = Math.floor(Math.random() * 1800);
  return {
    id: `${placement}_${idx}`,
    staggerMs: ((idx - 1) % 5) * 2400 + randomJitter,
  };
}

export function getSlotClaimedAdId(slotId: string): string | null {
  return activeSlotClaims.get(slotId)?.adId ?? null;
}

export function isAdOccupiedByOtherSlot(slotId: string, adId: string): boolean {
  for (const claim of activeSlotClaims.values()) {
    if (claim.slotId !== slotId && claim.adId === adId) {
      return true;
    }
  }
  return false;
}

export function getOccupiedAdIds(excludeSlotId?: string): Set<string> {
  const occupied = new Set<string>();
  for (const claim of activeSlotClaims.values()) {
    if (!excludeSlotId || claim.slotId !== excludeSlotId) {
      occupied.add(claim.adId);
    }
  }
  return occupied;
}

/**
 * Claims an ad exclusively for `slotId`.
 * - If another slot currently holds the same `adId`:
 *   - If `slotId` has strictly higher priority (or `forceTakeover` is true), the other slot is evicted.
 *   - Otherwise the claim is rejected (`false`) so two slots NEVER display the same ad simultaneously.
 */
export function claimAdForSlot(
  slotId: string,
  adId: string,
  placement: RotationPlacement = 'home',
  forceTakeover = false
): boolean {
  const priority = getPlacementPriority(placement);
  const existingForThisSlot = activeSlotClaims.get(slotId);
  if (existingForThisSlot && existingForThisSlot.adId === adId) {
    return true;
  }

  let evictedAny = false;
  for (const [otherSlotId, otherClaim] of activeSlotClaims.entries()) {
    if (otherSlotId === slotId || otherClaim.adId !== adId) continue;
    if (forceTakeover || priority > otherClaim.priority) {
      activeSlotClaims.delete(otherSlotId);
      evictedAny = true;
    } else {
      return false;
    }
  }

  const releasedOldAd = Boolean(existingForThisSlot && existingForThisSlot.adId !== adId);
  activeSlotClaims.set(slotId, {
    slotId,
    adId,
    placement,
    priority,
    claimedAt: Date.now(),
  });

  if (evictedAny || releasedOldAd) {
    scheduleNotifyListeners();
  }
  return true;
}

export function releaseAdSlot(slotId: string): void {
  if (activeSlotClaims.delete(slotId)) {
    scheduleNotifyListeners();
  }
}

export function recordAdExposure(adId: string, placement: RotationPlacement): void {
  const map = readExposureMap();
  const prev = map[adId] || { count: 0, lastShownAt: 0, lastPlacement: null };
  map[adId] = {
    count: prev.count + 1,
    lastShownAt: Date.now(),
    lastPlacement: placement,
  };
  writeExposureMap(map);
}

export function getAdExposureCount(adId: string): number {
  const map = readExposureMap();
  return map[adId]?.count || 0;
}

/**
 * Picks a randomized, organized candidate from `candidates` using fair exposure scaling
 * and anti-monopoly placement variety:
 * 1. Filters to the lowest exposure-count tier so every campaign gets fair turns.
 * 2. Within that tier, prefers ads whose last placement was DIFFERENT from `placement`.
 * 3. Randomly picks among the best-scoring tier so ordering is genuinely random and fresh.
 */
function pickRandomOrganizedCandidate(
  candidates: PublicAdItem[],
  placement: RotationPlacement,
  exposures: Record<string, AdExposureRecord>
): PublicAdItem | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // 1. Lowest global session exposure count tier (organized fairness)
  let minCount = Infinity;
  for (const ad of candidates) {
    const count = exposures[ad.id]?.count ?? 0;
    if (count < minCount) minCount = count;
  }
  const fairTier = candidates.filter((ad) => (exposures[ad.id]?.count ?? 0) <= minCount + 1);

  // 2. Prefer ads that were NOT just shown in this exact placement (variety across positions)
  const movedTier = fairTier.filter((ad) => exposures[ad.id]?.lastPlacement !== placement);
  const workingPool = movedTier.length > 0 ? movedTier : fairTier;

  // 3. Within the working pool, prefer the strict minimum count, then choose randomly
  let poolMinCount = Infinity;
  for (const ad of workingPool) {
    const count = exposures[ad.id]?.count ?? 0;
    if (count < poolMinCount) poolMinCount = count;
  }
  const topCandidates = workingPool.filter((ad) => (exposures[ad.id]?.count ?? 0) === poolMinCount);
  const finalPool = topCandidates.length > 0 ? topCandidates : workingPool;

  return finalPool[Math.floor(Math.random() * finalPool.length)] || candidates[0];
}

/**
 * Strictly selects the next ad for a slot with ZERO simultaneous duplicates across the screen:
 * 1. NEVER returns an ad currently displayed in another slot of equal or higher priority.
 * 2. By default (`allowTakeover: false`), NEVER returns ANY ad currently displayed in another slot;
 *    returns `null` if every eligible ad is already visible elsewhere (preventing duplicates).
 * 3. When rotating a higher-priority slot (`allowTakeover: true`, e.g., `header`), may atomically
 *    swap with a strictly lower-priority slot so both top and bottom rotate cleanly without sticking,
 *    and the lower slot immediately yields/picks up the newly freed ad.
 * 4. Organizes turns fairly by exposure count and placement variety, and randomizes among tied ads.
 */
export function pickNextScheduledAd(options: {
  slotId: string;
  placement: RotationPlacement;
  ads: PublicAdItem[];
  excludeAdIds?: string[];
  claim?: boolean;
  allowTakeover?: boolean;
}): PublicAdItem | null {
  const {
    slotId,
    placement,
    ads,
    excludeAdIds = [],
    claim = true,
    allowTakeover = false,
  } = options;
  if (!ads || ads.length === 0) {
    if (claim) releaseAdSlot(slotId);
    return null;
  }

  const myPriority = getPlacementPriority(placement);
  const excludedSet = new Set(excludeAdIds);
  const exposures = readExposureMap();

  // Map every ad currently claimed by another slot -> its claimant's priority
  const otherClaimsByAd = new Map<string, SlotClaim>();
  for (const other of activeSlotClaims.values()) {
    if (other.slotId !== slotId) {
      otherClaimsByAd.set(other.adId, other);
    }
  }

  // First preference: completely FREE ads (not shown in ANY other slot) and not in excludeAdIds
  const freeAll = ads.filter((ad) => !otherClaimsByAd.has(ad.id));
  const freeFresh = freeAll.filter((ad) => !excludedSet.has(ad.id));

  let chosen: PublicAdItem | null = null;
  let needsTakeover = false;

  if (freeFresh.length > 0) {
    chosen = pickRandomOrganizedCandidate(freeFresh, placement, exposures);
  } else if (freeAll.length > 0 && excludedSet.size === 0) {
    chosen = pickRandomOrganizedCandidate(freeAll, placement, exposures);
  } else if (allowTakeover) {
    // Allow higher-priority slot (e.g., header / player) to rotate cleanly by taking over
    // an ad from a strictly lower-priority slot (which will automatically yield & pick the freed ad).
    const takeoverFresh = ads.filter((ad) => {
      if (excludedSet.has(ad.id)) return false;
      const other = otherClaimsByAd.get(ad.id);
      return !other || myPriority > other.priority;
    });
    if (takeoverFresh.length > 0) {
      chosen = pickRandomOrganizedCandidate(takeoverFresh, placement, exposures);
      needsTakeover = Boolean(chosen && otherClaimsByAd.has(chosen.id));
    } else if (freeAll.length > 0) {
      chosen = pickRandomOrganizedCandidate(freeAll, placement, exposures);
    }
  } else if (freeAll.length > 0) {
    // Only one free ad remains (e.g., current slot's own ad when rotating and all others are busy)
    chosen = pickRandomOrganizedCandidate(freeAll, placement, exposures);
  }

  if (!chosen) {
    if (claim) releaseAdSlot(slotId);
    return null;
  }

  if (claim) {
    const claimed = claimAdForSlot(slotId, chosen.id, placement, needsTakeover);
    if (!claimed) {
      releaseAdSlot(slotId);
      return null;
    }
  }

  return chosen;
}

/**
 * Orders an entire pool of ads in a randomized yet organized (fair exposure + placement variety)
 * sequence for Hero Carousel rotation, strictly excluding ads currently shown in other slots.
 */
export function orderAdsForFairRotation(
  slotId: string,
  placement: RotationPlacement,
  ads: PublicAdItem[],
  excludeOccupied = true
): PublicAdItem[] {
  if (!ads || ads.length === 0) return [];

  const occupiedElsewhere = excludeOccupied ? getOccupiedAdIds(slotId) : new Set<string>();
  const available = excludeOccupied
    ? ads.filter((ad) => !occupiedElsewhere.has(ad.id))
    : [...ads];

  if (available.length <= 1) return available;

  const exposures = readExposureMap();
  // Pre-shuffle so ties within the same exposure/placement tier are genuinely randomized
  const randomized = shuffleArray(available);

  return randomized.sort((a, b) => {
    const aRec = exposures[a.id] || { count: 0, lastShownAt: 0, lastPlacement: null };
    const bRec = exposures[b.id] || { count: 0, lastShownAt: 0, lastPlacement: null };

    if (aRec.count !== bRec.count) return aRec.count - bRec.count;

    const aSame = aRec.lastPlacement === placement ? 1 : 0;
    const bSame = bRec.lastPlacement === placement ? 1 : 0;
    if (aSame !== bSame) return aSame - bSame;

    return 0; // preserve Fisher-Yates random order for ties
  });
}
