// --- utils/similarity.ts ---
export type SeriesLike = {
  displaySetInstanceUID: string;
  SeriesInstanceUID?: string;
  SeriesDescription?: string;
  ProtocolName?: string;
  Modality?: string;
  BodyPartExamined?: string;
  SeriesNumber?: number | string;
  // Optional custom metadata fetcher (e.g., for OHIF)
  getAttribute?: (name: string) => string | number | undefined;
};

const normalize = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const detectLaterality = (text: string) => {
  const normalized = normalize(text);
  const tokens = new Set(normalized.split(' ').filter(Boolean));
  const hasLeft =
    tokens.has('left') ||
    tokens.has('lt') ||
    normalized.includes('left lung') ||
    normalized.includes('left sided');
  const hasRight =
    tokens.has('right') ||
    tokens.has('rt') ||
    normalized.includes('right lung') ||
    normalized.includes('right sided');
  const hasBilateral =
    tokens.has('bilateral') ||
    normalized.includes('both lungs') ||
    normalized.includes('both sides') ||
    normalized.includes('left and right') ||
    normalized.includes('right and left');

  return { hasLeft, hasRight, hasBilateral };
};

type Severity = 'small' | 'moderate' | 'severe';

const detectSeverity = (text: string): Severity | undefined => {
  const normalized = normalize(text);
  if (
    normalized.includes('small') ||
    normalized.includes('mild') ||
    normalized.includes('minimal') ||
    normalized.includes('slight') ||
    /grade\s*1/.test(normalized)
  ) {
    return 'small';
  }
  if (normalized.includes('moderate') || normalized.includes('intermediate') || /grade\s*2/.test(normalized)) {
    return 'moderate';
  }
  if (
    normalized.includes('severe') ||
    normalized.includes('marked') ||
    normalized.includes('significant') ||
    normalized.includes('large') ||
    /grade\s*3/.test(normalized)
  ) {
    return 'severe';
  }
  return undefined;
};

type BaseAbnormality = 'pleural effusion' | 'consolidation';

type ExtractedAttributes = {
  base?: BaseAbnormality;
  laterality: { hasLeft: boolean; hasRight: boolean; hasBilateral: boolean };
  severity?: Severity;
  associated: Set<string>;
};

const BASE_ABNORMALITY_PHRASES: Record<BaseAbnormality, string[]> = {
  'pleural effusion': ['pleural effusion', 'pleural fluid', 'effusion'],
  consolidation: ['consolidation'],
};

const ASSOCIATED_FINDING_PHRASES: Record<string, string[]> = {
  'pleural effusion': ['pleural effusion', 'pleural fluid', 'effusion'],
  consolidation: ['consolidation'],
  'pleural thickening': ['pleural thickening', 'thickening'],
  'pleural nodularity': ['pleural nodularity', 'nodularity'],
  atelectasis: ['atelectasis'],
};

const isNegated = (normalized: string, matchIndex: number) => {
  const windowStart = Math.max(0, matchIndex - 24);
  const window = normalized.slice(windowStart, matchIndex).trimEnd();
  return /(?:no|without)\s+(?:signs\s+of\s+)?$/.test(window);
};

const findPhraseIndex = (normalized: string, phrase: string): number => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const regex = new RegExp(`\\b${escaped}\\b`);
  const match = normalized.match(regex);
  return match?.index ?? -1;
};

const findEarliestMatch = (normalized: string, phrases: string[]) => {
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const phrase of phrases) {
    const index = findPhraseIndex(normalized, phrase);
    if (index >= 0 && !isNegated(normalized, index) && index < bestIndex) {
      bestIndex = index;
    }
  }
  return Number.isFinite(bestIndex) ? bestIndex : -1;
};

// Only use the first sentence of SeriesDescription to avoid matching on negated findings that follow.
const firstSentence = (text?: string) => {
  if (!text) {
    return text;
  }
  const match = String(text).match(/[^.?!]+/);
  const first = match ? match[0] : text;

  // If the first sentence says there are no abnormalities, keep the entire description
  // so we can match on any additional detail that follows.
  const norm = normalize(first);
  if (norm === 'no sign of any abnormalities' || norm === 'no signs of any abnormalities') {
    return text;
  }

  return first;
};

const getSeriesText = (ds: SeriesLike): string => {
  const parts: Array<string | number | undefined> = [
    firstSentence(ds.SeriesDescription),
    ds.ProtocolName,
    ds.getAttribute?.('SeriesPrompt'),
  ];

  return normalize(parts.filter(Boolean).join(' '));
};

const extractAttributes = (text: string): ExtractedAttributes => {
  const normalized = normalize(text);
  const laterality = detectLaterality(text);
  const severity = detectSeverity(text);

  let base: BaseAbnormality | undefined;
  let bestIndex = Number.POSITIVE_INFINITY;
  (Object.keys(BASE_ABNORMALITY_PHRASES) as BaseAbnormality[]).forEach(key => {
    const idx = findEarliestMatch(normalized, BASE_ABNORMALITY_PHRASES[key]);
    if (idx >= 0 && idx < bestIndex) {
      bestIndex = idx;
      base = key;
    }
  });

  const associated = new Set<string>();
  Object.entries(ASSOCIATED_FINDING_PHRASES).forEach(([key, phrases]) => {
    if (key === base) {
      return;
    }
    if (findEarliestMatch(normalized, phrases) >= 0) {
      associated.add(key);
    }
  });

  return {
    base,
    laterality,
    severity,
    associated,
  };
};

function scoreCandidate(
  promptKey: string,
  ds: SeriesLike,
  _promptContext?: { modality?: string; bodyPart?: string }
): number {
  const promptAttrs = extractAttributes(promptKey);
  if (!promptAttrs.base) {
    return 0;
  }

  const seriesText = getSeriesText(ds);
  const seriesAttrs = extractAttributes(seriesText);

  if (!seriesAttrs.base || seriesAttrs.base !== promptAttrs.base) {
    return 0;
  }

  let score = 0.5;

  const pLat = promptAttrs.laterality;
  const sLat = seriesAttrs.laterality;
  const promptHasLaterality = pLat.hasLeft || pLat.hasRight || pLat.hasBilateral;

  if (promptHasLaterality) {
    if (pLat.hasBilateral) {
      score += sLat.hasBilateral ? 0.2 : -0.15;
    } else if (pLat.hasLeft) {
      if (sLat.hasLeft) {
        score += 0.2;
      } else if (sLat.hasRight || sLat.hasBilateral) {
        score -= 0.2;
      } else {
        score -= 0.1;
      }
    } else if (pLat.hasRight) {
      if (sLat.hasRight) {
        score += 0.2;
      } else if (sLat.hasLeft || sLat.hasBilateral) {
        score -= 0.2;
      } else {
        score -= 0.1;
      }
    }
  }

  if (promptAttrs.severity) {
    if (seriesAttrs.severity) {
      score += promptAttrs.severity === seriesAttrs.severity ? 0.2 : -0.2;
    } else {
      score -= 0.1;
    }
  }

  if (promptAttrs.associated.size) {
    promptAttrs.associated.forEach(term => {
      score += seriesAttrs.associated.has(term) ? 0.1 : -0.15;
    });
  } else if (seriesAttrs.associated.size) {
    return 0;
  }

  return Math.max(0, Math.min(0.99, score));
}

export type RankedDisplaySet = {
  displaySet: SeriesLike;
  score: number;
};

export function rankDisplaySetsByPrompt(
  displaySets: SeriesLike[],
  promptKey: string,
  options?: {
    promptContext?: { modality?: string; bodyPart?: string };
  }
): RankedDisplaySet[] {
  if (!promptKey) {
    return [];
  }

  const scored = displaySets.map(ds => ({
    displaySet: ds,
    score: scoreCandidate(promptKey, ds, options?.promptContext),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored;
}

export function findBestMatchingDisplaySet(
  displaySets: SeriesLike[],
  promptKey: string,
  options?: {
    minAcceptScore?: number; // threshold to accept
    preferUnchanged?: boolean; // optionally prefer not-yet-changed series
    promptContext?: { modality?: string; bodyPart?: string };
  }
): { target?: SeriesLike; score: number } {
  if (!promptKey) {
    return { score: 0 };
  }
  const minAccept = options?.minAcceptScore ?? 0.42;

  let best: SeriesLike | undefined;
  let bestScore = 0;

  for (const ds of displaySets) {
    const s = scoreCandidate(promptKey, ds, options?.promptContext);
    if (s > bestScore) {
      best = ds;
      bestScore = s;
    } else if (s === bestScore && best) {
      // tie-breakers: unchanged first, then higher SeriesNumber, then longer description
      const changedBest = best.getAttribute?.('SeriesPromptChanged') === 'true';
      const changedCur = ds.getAttribute?.('SeriesPromptChanged') === 'true';
      const preferUnchanged = options?.preferUnchanged ?? true;

      const tiebreak =
        (preferUnchanged ? Number(changedBest) - Number(changedCur) : 0) ||
        Number(ds.SeriesNumber ?? 0) - Number(best.SeriesNumber ?? 0) ||
        String(ds.SeriesDescription || '').length - String(best.SeriesDescription || '').length;

      if (tiebreak > 0) {
        best = ds;
        bestScore = s;
      }
    }
  }

  if (!best || bestScore < minAccept) {
    return { score: bestScore };
  }
  return { target: best, score: bestScore };
}
