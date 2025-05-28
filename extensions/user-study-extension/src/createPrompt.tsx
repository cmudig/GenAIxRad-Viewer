const createPrompt = (tab, answerList) => {


  if (tab === 'variation') {
    //Answer list format: findings, location, severity, associated findings
    return `${answerList["Findings"]} ${answerList["Location"]} ${answerList["Severity"]} pleural effusion with signs of ${answerList["Associated Findings"]}`;
  }
}

const displaySetIndex = (tab, answerList) => {


  if (tab === 'variation') {
    //Answer list format: findings, location, severity, associated findings
    return answerList["Severity"]-1;
  }
}

export {createPrompt, displaySetIndex};
