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
  left: ['lt', 'left lung', 'left-sided', 'lhs'],
  right: ['rt', 'right-sided', 'right lung', 'rhs'],
  bilateral: ['both sides', 'both lungs', 'left and right', 'right and left'],
  severe: ['marked', 'high', 'grade 3', '3', 'significant', 'large', 'severe'],
  moderate: ['intermediate', 'grade 2', '2', 'moderate'],
  small: ['low', 'slight', 'grade 1', '1', 'small', 'mild', 'minimal'],
};

const normalize = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const normalizeSentenceExact = (s: string) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');

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

function buildSeriesKey(ds: SeriesLike): string {
  // Pull common DICOM-ish fields; add any custom metadata you store (e.g., SeriesPrompt)
  const parts: Array<string | number | undefined> = [
    firstSentence(ds.SeriesDescription),
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
  const rawPromptTokens = tokenize(promptKey);
  const rawSeriesTokens = tokenize(buildSeriesKey(ds));

  const pTokens = expandTokens(tokenize(promptKey));
  const sKey = buildSeriesKey(ds);
  const sTokens = expandTokens(tokenize(sKey));
  const normalizedPrompt = normalize(promptKey);
  const exactPromptSentence = normalizeSentenceExact(promptKey);
  const exactSeriesFirstSentence = normalizeSentenceExact(
    firstSentence(ds.SeriesDescription) || ''
  );

  // Exact first-sentence match (case-insensitive) should trump everything.
  if (exactPromptSentence && exactPromptSentence === exactSeriesFirstSentence) {
    return 1;
  }

  // If the first sentences differ, note it so we can avoid runaway scores.
  const firstSentenceMismatchPenalty = exactPromptSentence && exactSeriesFirstSentence ? -0.2 : 0;

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

  // Encourage matches on key associated-finding tokens and lightly penalize mismatches
  const assocTerms = ['thickening', 'nodularity', 'consolidation'];
  let assocAdjust = 0;
  assocTerms.forEach(term => {
    const promptHas = pTokens.has(term);
    const seriesHas = sTokens.has(term);
    if (promptHas && seriesHas) {
      assocAdjust += 0.08; // small bonus when the requested associated finding is present
    } else if (promptHas && !seriesHas) {
      assocAdjust -= 0.12; // penalty when the requested associated finding is absent
    }
  });

  // If the prompt is consolidation-focused, also recognize "with associated consolidation" phrasing.
  if (
    normalizedPrompt.includes('consolidation') &&
    !normalizedPrompt.includes('effusion') &&
    sKey.includes('with associated consolidation')
  ) {
    assocAdjust += 0.1;
  }

  // Laterality alignment: reward exact matches, penalize cross/missing
  const promptHasLeft = rawPromptTokens.includes('left');
  const promptHasRight = rawPromptTokens.includes('right');
  const promptHasBilateral = rawPromptTokens.includes('bilateral');
  const seriesHasLeft = rawSeriesTokens.includes('left');
  const seriesHasRight = rawSeriesTokens.includes('right');
  const seriesHasBilateral = rawSeriesTokens.includes('bilateral');

  let lateralityAdjust = 0;
  if (promptHasLeft && seriesHasLeft) {
    lateralityAdjust += 0.16;
  }
  if (promptHasRight && seriesHasRight) {
    lateralityAdjust += 0.16;
  }
  if (promptHasLeft && seriesHasRight) {
    lateralityAdjust -= 0.28;
  }
  if (promptHasRight && seriesHasLeft) {
    lateralityAdjust -= 0.28;
  }
  if (
    (promptHasLeft || promptHasRight) &&
    !seriesHasLeft &&
    !seriesHasRight &&
    !seriesHasBilateral
  ) {
    lateralityAdjust -= 0.2; // requested unilateral but series has no side info
  }
  if (!promptHasBilateral && (promptHasLeft || promptHasRight) && seriesHasBilateral) {
    lateralityAdjust -= 0.2; // prefer unilateral when user asked for unilateral
  }
  if (promptHasBilateral && seriesHasLeft !== seriesHasRight) {
    lateralityAdjust -= 0.08; // prefer bilateral when the request is bilateral
  }

  // Lightly down-rank extra associated findings when none were requested
  const seriesAssocPresent = assocTerms.some(term => rawSeriesTokens.includes(term));
  const promptAssocPresent = assocTerms.some(term => rawPromptTokens.includes(term));
  const extraAssocAdjust = !promptAssocPresent && seriesAssocPresent ? -0.12 : 0;

  return Math.max(
    0,
    Math.min(
      0.99, // keep headroom unless exact-first-sentence match hits
      base +
        numBonus +
        hint +
        specificity +
        assocAdjust +
        lateralityAdjust +
        extraAssocAdjust +
        firstSentenceMismatchPenalty
    )
  );
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
