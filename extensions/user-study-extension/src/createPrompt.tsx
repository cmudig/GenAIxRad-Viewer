const normalize = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const createPrompt = (tab, answerList) => {
  if (tab === 'variation') {
    // ⬇️ New: if Normal, force "normal chest CT"
    if (answerList['Normal / Abnormal'] === 'Normal') {
      const text =
        'No signs of any abnormalities. No signs of cardiomegaly. No signs of consolidation. No signs of atelectasis. No signs of ground glass. No signs pleural thickening. No signs of any nodules.';
      const key = normalize(text);
      return { text, key };
    }

    // Existing "Abnormal" behavior
    const baseAbnormality = answerList['Base Abnormality'] || 'Pleural effusion';
    const location = answerList['Location'] || '';
    const severity = answerList['Severity'] || ''; // could be number
    const assocRaw = answerList['Associated Findings'] || '';
    const assoc = typeof assocRaw === 'string' ? assocRaw.trim() : '';
    const normalizedBase = baseAbnormality.toLowerCase();
    const hasAssoc =
      (normalizedBase === 'pleural effusion' || normalizedBase === 'consolidation') &&
      assoc &&
      assoc.toLowerCase() !== 'none';

    const locationNormalized = location.toLowerCase();
    const locationText =
      locationNormalized === 'bilateral'
        ? 'both lungs'
        : locationNormalized
        ? `the ${locationNormalized} lung`
        : '';

    // Consolidation uses a dedicated wording
    if (normalizedBase === 'consolidation') {
      const severityText = severity ? severity.toLowerCase() : '';
      const parts = ['A'];
      if (severityText) {
        parts.push(severityText);
      }
      parts.push('area of dense consolidation');
      if (locationText) {
        parts.push('in', locationText);
      }
      if (hasAssoc) {
        parts.push('with', 'associated', assoc);
      }
      const text = parts.join(' ').trim();
      const key = normalize(text);
      return { text, key };
    }

    // Build pretty text with only present parts
    const severityText = severity ? `${severity} ${normalizedBase}` : normalizedBase;
    let text = `${severityText}`.trim();
    if (locationText) {
      text = `${text} in ${locationText}`.trim();
    }

    if (hasAssoc) {
      text = `${text} with associated ${assoc}`.trim();
    }

    const key = normalize(text);
    return { text, key };
  }

  if (tab === 'mimic') {
    const mimic = answerList['Select a mimic:'] || '';
    const text = mimic.trim();
    const key = normalize(text);
    return { text, key };
  }

  // default
  return { text: '', key: '' };
};

const displaySetIndex = (tab, answerList) => {
  if (tab === 'variation') {
    if (answerList['Normal / Abnormal'] === 'Normal') {
      return 0; // safe default for Normal
    }
    // Answer list format: findings, location, severity, associated findings
    return (answerList['Severity'] ?? 1) - 1;
  } else if (tab === 'mimic') {
    // Answer list format: type, rarity, select a mimic, explanation complexity
    return answerList['Type:'] === 'Benign' ? 0 : 1;
  }
};

export { createPrompt, displaySetIndex };
