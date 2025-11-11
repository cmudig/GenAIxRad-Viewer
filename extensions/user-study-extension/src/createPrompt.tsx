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
    const findings = answerList['Findings'] || '';
    const location = answerList['Location'] || '';
    const severity = answerList['Severity'] || ''; // could be number
    const assocRaw = answerList['Associated Findings'] || '';
    const assoc = typeof assocRaw === 'string' ? assocRaw.trim() : '';
    const hasAssoc = assoc && assoc.toLowerCase() !== 'none';

    // Build pretty text with only present parts
    const parts = [findings].filter(Boolean);
    const severityText = severity ? `${severity} pleural effusion` : 'pleural effusion';
    const locationText = location
      ? location.toLowerCase() === 'bilateral'
        ? 'left and right lungs'
        : `the ${location.toLowerCase()} lung${location.toLowerCase() === 'left' || location.toLowerCase() === 'right' ? '' : 's'}`
      : '';

    let text = `${parts.join(' ')} ${severityText}`.trim();
    if (locationText) {
      text = `${text} in ${locationText}`.trim();
    }

    if (hasAssoc) {
      text = `${text} with signs of ${assoc}`.trim();
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
