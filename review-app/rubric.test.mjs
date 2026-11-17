import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rubricVersion, commentPolicyVersion, rubric, clinicalDefinition, descriptionDefinition,
  validateRubricAnswers, getPreviousAssessment, createRubricAssessment, publicReview,
} from './rubric.mjs';

const draft = (overrides = {}) => ({ status: 'draft', answers: {}, comments: '', ...overrides });
const final = (answers, comments = '') => ({ status: 'final', answers, comments });
const rejects = (body, message = /./) => assert.throws(() => validateRubricAnswers(body), error => error.status === 400 && message.test(error.message));

test('v4 publishes exact questions, definitions, per-item choices and conditional optional groups', () => {
  assert.equal(rubricVersion, 4);
  assert.equal(commentPolicyVersion, 2);
  assert.equal(rubric.length, 2);
  assert.deepEqual(rubric.map(item => item.id), ['description_match', 'clinical_plausibility']);
  assert.equal(rubric[0].text, '1. How well does this generated scan match the displayed description?');
  assert.equal(descriptionDefinition, 'Consider whether the described findings are present or absent, in the correct location, and of the stated severity. Consider findings described but missing from the scan, and additional findings that contradict the description. Assess this separately from whether the scan looks realistic.');
  assert.equal(rubric[0].definition, descriptionDefinition);
  assert.equal(rubric[1].text, '2. Is this generated scan clinically plausible for use as a trainee comparison case?');
  assert.equal(clinicalDefinition, 'Consider anatomical and pathological plausibility, including tissue appearance and consistency across slices. Consider if unrealistic features could cause a trainee to misunderstand the anatomy or pathology.');
  assert.equal(rubric[1].definition, clinicalDefinition);
  assert.deepEqual(rubric.map(item => item.choices), [
    [
      { value: 'matches', label: 'Matches: The described findings agree with the scan in their presence or absence, location, and severity, with no contradictory findings.' },
      { value: 'partially_matches', label: 'Partially matches: Some findings match, but others are missing, extra, or inconsistent.' },
      { value: 'does_not_match', label: 'Does not match: The main described finding is absent, contradicted, or substantially different.' },
    ],
    [
      { value: 'plausible', label: 'Plausible, without notable unrealistic features.' },
      { value: 'plausible_overall', label: 'Plausible overall, but with unrealistic features unlikely to cause a trainee to misunderstand the anatomy or pathology.' },
      { value: 'not_plausible_overall', label: 'Not plausible overall, or contains features likely to cause a trainee to misunderstand the anatomy or pathology.' },
    ],
  ]);
  assert.deepEqual(rubric.map(item => item.issueField), ['descriptionIssues', 'realismIssues']);
  assert.match(rubric[0].issueQuestion, /^1\.2\./);
  assert.match(rubric[1].issueQuestion, /^2\.2\./);
  assert.deepEqual(rubric.map(item => item.issueWhen), [['partially_matches', 'does_not_match'], ['plausible_overall', 'not_plausible_overall']]);
  assert.deepEqual(rubric[0].issueOptions.map(option => option.label), ['Missing finding', 'Extra finding', 'Incorrect location', 'Incorrect severity', 'Attenuation or tissue appearance', 'Other']);
  assert.deepEqual(rubric[1].issueOptions.map(option => option.label), ['Anatomical structure, including airways or vessels', 'Attenuation or tissue appearance', 'Pathological appearance or distribution', 'Across-slice consistency', 'Artifacts or image quality', 'Other']);
  for (const item of rubric) {
    assert.equal(new Set(item.issueOptions.map(option => option.value)).size, item.issueOptions.length);
    assert.ok(Object.isFrozen(item.choices));
    assert.ok(item.issueOptions.every(option => typeof option.value === 'string' && typeof option.label === 'string'));
  }
});

for (const q1 of ['matches', 'partially_matches', 'does_not_match']) {
  for (const q2 of ['plausible', 'plausible_overall', 'not_plausible_overall']) {
    test(`final comment policy: ${q1} + ${q2}`, () => {
      const answers = { description_match: q1, clinical_plausibility: q2 };
      const positive = q1 === 'matches' && q2 === 'plausible';
      for (const comment of ['', ' \n\t ', 'Slice 1:', ' Slice 1: \n sLiCe 22 :  ']) {
        if (positive) assert.deepEqual(validateRubricAnswers(final(answers, comment)).answers, answers);
        else rejects(final(answers, comment), /Comment required/);
      }
      assert.deepEqual(validateRubricAnswers(final(answers, 'Slice 2: Tissue appearance is inconsistent.')).answers, answers);
      assert.deepEqual(validateRubricAnswers(draft({ answers })).answers, answers);
    });
  }
}

test('blank/partial drafts allowed; finals require both independently answered items', () => {
  assert.deepEqual(validateRubricAnswers(draft()), { answers: {}, descriptionIssues: [], realismIssues: [] });
  for (const answers of [{}, { description_match: 'matches' }, { clinical_plausibility: 'plausible' }]) {
    assert.deepEqual(validateRubricAnswers(draft({ answers })).answers, answers);
    rejects(final(answers, 'Explanation'), /Answer every/);
  }
  rejects(draft({ status: 'legacy' }), /Invalid status/);
  rejects(draft({ comments: null }), /Comments/);
  rejects(draft({ comments: 'x'.repeat(10001) }), /Comments/);
});

test('reject binary, renamed, unknown, unable and malformed answers without conversion', () => {
  for (const answers of [null, [], 'yes', { clinically_accurate: 'yes' }, { unknown: 'matches' }, { descriptionIssues: [] }]) rejects(draft({ answers }), /Invalid rubric response/);
  for (const item of rubric) {
    for (const value of ['yes', 'no', true, false, null, '', 'unable', 'unable_to_assess', 'cannot_judge', 'cannot_make_a_reliable_judgment', [], {}, rubric.find(other => other !== item).choices[0].value]) {
      rejects(draft({ answers: { [item.id]: value } }), /Invalid rubric response/);
    }
  }
});

for (const item of rubric) {
  test(`${item.issueField}: optional, unique, allowlisted, no hidden tags`, () => {
    const all = item.issueOptions.map(option => option.value);
    for (const parent of item.issueWhen) {
      const answers = { [item.id]: parent };
      const input = draft({ answers, [item.issueField]: all });
      const copy = structuredClone(input);
      const result = validateRubricAnswers(input);
      assert.deepEqual(result[item.issueField], all);
      assert.notEqual(result[item.issueField], input[item.issueField]);
      assert.deepEqual(input, copy);
      for (const value of all) assert.deepEqual(validateRubricAnswers(draft({ answers, [item.issueField]: [value] }))[item.issueField], [value]);
      for (const invalid of [null, '', {}, [all[0], all[0]], ['unknown'], [1], [true], [{}], [null]]) rejects(draft({ answers, [item.issueField]: invalid }), new RegExp(item.issueField));
      const other = rubric.find(other => other !== item).issueOptions.find(option => !all.includes(option.value)).value;
      rejects(draft({ answers, [item.issueField]: [other] }), new RegExp(item.issueField));
    }
    for (const answers of [{}, { [item.id]: item.choices[0].value }]) {
      rejects(draft({ answers, [item.issueField]: [all[0]] }), /parent answer/);
      assert.deepEqual(validateRubricAnswers(draft({ answers, [item.issueField]: [] }))[item.issueField], []);
    }
    const complete = final({ description_match: 'partially_matches', clinical_plausibility: 'plausible_overall' }, 'Substantive explanation');
    assert.deepEqual(validateRubricAnswers({ ...complete, [item.issueField]: all })[item.issueField], all);
  });
}

test('records snapshot the full v4 rubric and ignore client metadata and previousAssessment', () => {
  const body = draft({ rubricVersion: 1, rubricSnapshot: ['forged'], commentPolicyVersion: 100, clinicalDefinition: 'forged', previousAssessment: { answers: { forged: true } } });
  const record = createRubricAssessment(body);
  assert.equal(record.rubricVersion, 4);
  assert.equal(record.commentPolicyVersion, 2);
  assert.deepEqual(record.rubricSnapshot, rubric);
  assert.equal(record.clinicalDefinition, clinicalDefinition);
  assert.equal(record.descriptionDefinition, descriptionDefinition);
  assert.equal(Object.hasOwn(record, 'previousAssessment'), false);
  record.rubricSnapshot[0].choices[0].label = 'Changed record';
  assert.notEqual(record.rubricSnapshot[0].choices[0].label, rubric[0].choices[0].label);
  assert.equal(getPreviousAssessment(null), null);
  assert.equal(getPreviousAssessment({ rubricVersion: 4 }), null);
});

for (const version of [1, 2, 3]) {
  test(`legacy v${version} stays separate, whitelisted and preserved across v4 saves`, () => {
    const old = {
      rubricVersion: version, revision: 7, status: 'final',
      answers: { description_match: 'yes', clinically_accurate: 'no' },
      comments: 'Slice 3: Original comment', references: [3], savedAt: '2026-11-01T00:00:00.000Z',
      clinicalDefinition: 'Original clinical definition', descriptionDefinition: 'Original description definition',
      definitions: { original: 'Original wording' }, rubricSnapshot: [{ text: 'Original question', choices: ['yes', 'no'] }],
      commentPolicyVersion: 1, confirmed: true, evidence: { loaded: [2] },
      manifestHash: 'not-public-history', unexpected: 'not-whitelisted',
      previousAssessment: { comments: 'Not the current old assessment' },
    };
    const original = structuredClone(old);
    const expected = Object.fromEntries(Object.entries(old).filter(([key]) => !['evidence', 'manifestHash', 'unexpected', 'previousAssessment'].includes(key)));
    const visible = publicReview(old);
    assert.equal(visible.status, 'legacy');
    assert.equal(visible.revision, 7);
    assert.deepEqual(visible.answers, {});
    assert.equal(visible.comments, '');
    assert.deepEqual(visible.references, []);
    assert.deepEqual(visible.previousAssessment, expected);
    const incoming = draft({ previousAssessment: { comments: 'Forged client history' } });
    const first = { ...createRubricAssessment(incoming, old), revision: 8, status: 'draft' };
    assert.deepEqual(first.answers, {});
    assert.deepEqual(first.previousAssessment, expected);
    const second = { ...createRubricAssessment(final({ description_match: 'matches', clinical_plausibility: 'plausible' }), first), revision: 9, status: 'final' };
    const third = createRubricAssessment(incoming, second);
    assert.deepEqual(second.previousAssessment, expected);
    assert.deepEqual(third.previousAssessment, expected);
    assert.deepEqual(publicReview(second).previousAssessment, expected);
    assert.deepEqual(old, original);
    first.previousAssessment.answers.description_match = 'tampered';
    visible.previousAssessment.references.push(4);
    assert.deepEqual(second.previousAssessment, expected);
    assert.deepEqual(old, original);
  });
}
