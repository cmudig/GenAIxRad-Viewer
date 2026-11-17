export const rubricVersion = 4;
export const commentPolicyVersion = 2;
export const descriptionDefinition = 'Consider whether the described findings are present or absent, in the correct location, and of the stated severity. Consider findings described but missing from the scan, and additional findings that contradict the description. Assess this separately from whether the scan looks realistic.';
export const clinicalDefinition = 'Consider anatomical and pathological plausibility, including tissue appearance and consistency across slices. Consider if unrealistic features could cause a trainee to misunderstand the anatomy or pathology.';

const option = (value, label) => ({ value, label });
const tissue = () => option('attenuation_or_tissue_appearance', 'Attenuation or tissue appearance');
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const rubric = freeze([
  {
    id: 'description_match',
    text: '1. How well does this generated scan match the displayed description?',
    definition: descriptionDefinition,
    choices: [
      option('matches', 'Matches: The described findings agree with the scan in their presence or absence, location, and severity, with no contradictory findings.'),
      option('partially_matches', 'Partially matches: Some findings match, but others are missing, extra, or inconsistent.'),
      option('does_not_match', 'Does not match: The main described finding is absent, contradicted, or substantially different.'),
    ],
    issueField: 'descriptionIssues',
    issueQuestion: '1.2. What does not match, or makes matching difficult?',
    issueWhen: ['partially_matches', 'does_not_match'],
    issueOptions: [
      option('missing_finding', 'Missing finding'),
      option('extra_finding', 'Extra finding'),
      option('incorrect_location', 'Incorrect location'),
      option('incorrect_severity', 'Incorrect severity'),
      tissue(),
      option('other', 'Other'),
    ],
  },
  {
    id: 'clinical_plausibility',
    text: '2. Is this generated scan clinically plausible for use as a trainee comparison case?',
    definition: clinicalDefinition,
    choices: [
      option('plausible', 'Plausible, without notable unrealistic features.'),
      option('plausible_overall', 'Plausible overall, but with unrealistic features unlikely to cause a trainee to misunderstand the anatomy or pathology.'),
      option('not_plausible_overall', 'Not plausible overall, or contains features likely to cause a trainee to misunderstand the anatomy or pathology.'),
    ],
    issueField: 'realismIssues',
    issueQuestion: '2.2. What realism concerns did you notice?',
    issueWhen: ['plausible_overall', 'not_plausible_overall'],
    issueOptions: [
      option('anatomical_structure', 'Anatomical structure, including airways or vessels'),
      tissue(),
      option('pathological_appearance_or_distribution', 'Pathological appearance or distribution'),
      option('across_slice_consistency', 'Across-slice consistency'),
      option('artifacts_or_image_quality', 'Artifacts or image quality'),
      option('other', 'Other'),
    ],
  },
]);

const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Drafts may be blank. Issue tags are optional, but never silently discarded.
export function validateRubricAnswers(body) {
  if (!body || !['draft', 'final'].includes(body.status)) invalid('Invalid status');
  const { answers, comments } = body;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.entries(answers).some(([id, value]) => !rubric.find(item => item.id === id)?.choices.some(choice => choice.value === value))) invalid('Invalid rubric response');
  if (typeof comments !== 'string' || comments.length > 10000) invalid('Comments must be at most 10,000 characters');
  const result = { answers: { ...answers } };
  for (const item of rubric) {
    const issues = body[item.issueField] === undefined ? [] : body[item.issueField];
    if (!Array.isArray(issues) || new Set(issues).size !== issues.length || issues.some(value => !item.issueOptions.some(choice => choice.value === value))) invalid(`Invalid ${item.issueField}`);
    if (issues.length && !item.issueWhen.includes(answers[item.id])) invalid(`${item.issueField} requires a non-positive parent answer`);
    result[item.issueField] = [...issues];
  }
  if (body.status === 'final') {
    if (rubric.some(item => !Object.hasOwn(answers, item.id))) invalid('Answer every rubric item; no answers are automatically filled');
    if ((answers.description_match !== 'matches' || answers.clinical_plausibility !== 'plausible') && !comments.replace(/\bSlice\s+\d+\s*:/gi, '').trim()) invalid('Comment required unless question 1 is Matches and question 2 is Plausible, without notable unrealistic features. Please say what is missing, extra, inconsistent, or unrealistic.');
  }
  return result;
}

const previousFields = [
  'rubricVersion', 'revision', 'status', 'answers', 'comments', 'references', 'savedAt',
  'clinicalDefinition', 'descriptionDefinition', 'definitions', 'rubricSnapshot',
  'commentPolicyVersion', 'confirmed',
];

// Accept only the server-loaded previous record, never the incoming request body.
export function getPreviousAssessment(previous) {
  const source = previous?.rubricVersion === rubricVersion ? previous.previousAssessment : previous;
  if (!source || typeof source !== 'object') return null;
  return structuredClone(Object.fromEntries(previousFields.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]])));
}

export function createRubricAssessment(body, previous) {
  const fields = validateRubricAnswers(body);
  const previousAssessment = getPreviousAssessment(previous);
  return {
    ...fields, rubricVersion, clinicalDefinition, descriptionDefinition,
    commentPolicyVersion, rubricSnapshot: structuredClone(rubric),
    ...(previousAssessment ? { previousAssessment } : {}),
  };
}

export function publicReview(record) {
  if (!record) return null;
  if (record.rubricVersion === rubricVersion) return structuredClone(record);
  return {
    revision: record.revision, rubricVersion: record.rubricVersion, status: 'legacy',
    answers: {}, comments: '', references: [], evidence: structuredClone(record.evidence),
    previousAssessment: getPreviousAssessment(record),
  };
}
