const normalize = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const createPrompt = (tab, answerList) => {
  if (tab === 'variation') {
    // Safe getters
    const findings = answerList['Findings'] || '';
    const location = answerList['Location'] || '';
    const severity = answerList['Severity'] || ''; // could be number
    const assoc = answerList['Associated Findings'] || '';

    // Build pretty text with only present parts
    const parts = [findings, location, severity, 'pleural effusion with signs of', assoc].filter(
      Boolean
    );

    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
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
    //Answer list format: findings, location, severity, associated findings
    return answerList['Severity'] - 1;
  } else if (tab === 'mimic') {
    //Answer list format: type, rarity, select a mimic, explanation complexity
    return answerList['Type:'] === 'Benign' ? 0 : 1;
  }
};

export { createPrompt, displaySetIndex };
