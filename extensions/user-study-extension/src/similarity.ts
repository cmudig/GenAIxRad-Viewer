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

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'for',
  'to',
  'with',
  'in',
  'on',
  'by',
  'at',
  'from',
  'signs',
  'finding',
  'findings',
]);

const SYNONYMS: Record<string, string[]> = {
  // Customize for your domain
  'pleural effusion': ['effusion', 'pleural fluid'],
  left: ['lt', 'left-sided', 'lhs'],
  right: ['rt', 'right-sided', 'rhs'],
  bilateral: ['both sides', 'left and right', 'right and left', 'left', 'right'],
  severe: ['marked', 'high', 'grade 3', '3', 'significant'],
  moderate: ['intermediate', 'grade 2', '2'],
  mild: ['low', 'slight', 'grade 1', '1', 'small', 'mild', 'minimal'],
  ct: ['computed tomography'],
  mr: ['mri', 'magnetic resonance'],
  xray: ['radiograph', 'xr'],
};

const normalize = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function tokenize(key: string): string[] {
  return normalize(key)
    .split(' ')
    .filter(t => t && !STOPWORDS.has(t));
}

function expandTokens(tokens: string[]): Set<string> {
  const out = new Set<string>(tokens);
  const joined = tokens.join(' ');
  // multi-word expansions first
  for (const [k, vals] of Object.entries(SYNONYMS)) {
    const kTok = normalize(k);
    if (joined.includes(kTok)) {
      out.add(kTok);
      vals.forEach(v => out.add(normalize(v)));
    }
  }
  // per-token expansions
  for (const t of tokens) {
    for (const [k, vals] of Object.entries(SYNONYMS)) {
      if (t === normalize(k)) {
        vals.forEach(v => out.add(normalize(v)));
      }
      if (vals.includes(t)) {
        out.add(normalize(k));
      }
    }
  }
  return out;
}

// Numeric tokens can be important (e.g., severity "3")
const numTokens = (tokens: Iterable<string>) => new Set([...tokens].filter(t => /^\d+$/.test(t)));

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) {
      inter++;
    }
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Levenshtein on token sets (cheap approximation via dice on character bags)
function tokenSetDice(a: Set<string>, b: Set<string>): number {
  const A = [...a].join(' ');
  const B = [...b].join(' ');
  if (!A || !B) {
    return 0;
  }
  const bigrams = (s: string) => {
    const arr: string[] = [];
    for (let i = 0; i < s.length - 1; i++) {
      arr.push(s.slice(i, i + 2));
    }
    return arr;
  };
  const a2 = bigrams(A),
    b2 = bigrams(B);
  const b2Map = new Map<string, number>();
  b2.forEach(x => b2Map.set(x, (b2Map.get(x) || 0) + 1));
  let inter = 0;
  for (const x of a2) {
    const c = b2Map.get(x) || 0;
    if (c > 0) {
      inter++;
      b2Map.set(x, c - 1);
    }
  }
  return (2 * inter) / (a2.length + b2.length || 1);
}

function buildSeriesKey(ds: SeriesLike): string {
  // Pull common DICOM-ish fields; add any custom metadata you store (e.g., SeriesPrompt)
  const parts: Array<string | number | undefined> = [
    ds.SeriesDescription,
    ds.ProtocolName,
    ds.BodyPartExamined,
    ds.Modality,
    ds.SeriesNumber,
    ds.getAttribute?.('SeriesPrompt'), // if you saved one
    ds.getAttribute?.('SeriesPromptChanged') === 'true' ? 'changed' : undefined,
  ];

  return normalize(parts.filter(Boolean).join(' '));
}

function scoreCandidate(
  promptKey: string,
  ds: SeriesLike,
  promptContext?: { modality?: string; bodyPart?: string }
): number {
  const pTokens = expandTokens(tokenize(promptKey));
  const sKey = buildSeriesKey(ds);
  const sTokens = expandTokens(tokenize(sKey));

  const baseJ = jaccard(pTokens, sTokens); // 0..1
  const baseD = tokenSetDice(pTokens, sTokens); // 0..1
  const base = 0.65 * baseD + 0.35 * baseJ; // smooth + order-insensitive

  // Numeric alignment bonus (e.g., severity grades)
  const pNums = numTokens(pTokens);
  const sNums = numTokens(sTokens);
  let numBonus = 0;
  for (const n of pNums) {
    if (sNums.has(n)) {
      numBonus += 0.05;
    }
  } // small but meaningful
  numBonus = Math.min(numBonus, 0.15);

  // Domain hints (if you pass context, otherwise inferred from ds)
  const modality = promptContext?.modality?.toLowerCase();
  const body = promptContext?.bodyPart?.toLowerCase();
  let hint = 0;
  if (modality && normalize(ds.Modality || '').includes(modality)) {
    hint += 0.05;
  }
  if (body && normalize(ds.BodyPartExamined || '').includes(body)) {
    hint += 0.05;
  }

  // Prefer more specific series (longer key) slightly to break ties
  const specificity = Math.min(buildSeriesKey(ds).length / 80, 0.08);

  return Math.max(0, Math.min(1, base + numBonus + hint + specificity));
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
