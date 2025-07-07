const createPrompt = (tab, answerList) => {
  if (tab === 'variation') {
    //Answer list format: findings, location, severity, associated findings
    return `${answerList["Findings"]} ${answerList["Location"]} ${answerList["Severity"]} pleural effusion with signs of ${answerList["Associated Findings"]}`;
  }
  if (tab === 'mimic') {
    //Answer list format: Type:, Rarity:, Select a mimic:, Explanation Complexity:
    return `${answerList["Select a mimic:"]} `;
  }
}

const displaySetIndex = (tab, answerList) => {
  if (tab === 'variation') {
    //Answer list format: findings, location, severity, associated findings
    return answerList["Severity"]-1;
  }

  else if (tab === 'mimic') {
    //Answer list format: type, rarity, select a mimic, explanation complexity
    return answerList["Type:"] === "Benign" ? 0 : 1;
  }
}

export {createPrompt, displaySetIndex};
