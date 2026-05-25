import React from 'react';

export const JUDGING_CRITERIA = [
  {
    metadataKey: 'false_report_finding',
    explanationMetadataKey: 'false_report_finding_explanation',
    title: 'False report of a finding',
    description:
      'the generated report mentions a finding (e.g., a mass, calcification, asymmetry) that is not in the ground truth report.',
  },
  {
    metadataKey: 'missing_finding',
    explanationMetadataKey: 'missing_finding_explanation',
    title: 'Missing a finding',
    description:
      'The candidate report omits a finding mentioned in the ground truth report.',
  },
  {
    metadataKey: 'mischaracterization_finding',
    explanationMetadataKey: 'mischaracterization_finding_explanation',
    title: 'Mischaracterization of a finding',
    description:
      'A finding is present in both the ground truth and AI-generated report, but its characteristics (e.g., size, margins, stability/interval change) are described incorrectly.',
  },
  {
    metadataKey: 'misidentification_finding',
    explanationMetadataKey: 'misidentification_finding_explanation',
    title: 'Misidentification of location/laterality',
    description:
      'A finding is correctly identified, but its location (e.g., "upper outer quadrant", retroareolar, depth) or laterality (left/right/bilateral) is wrong.',
  },
  {
    metadataKey: 'incorrect_birads_assessment_finding',
    explanationMetadataKey: 'incorrect_birads_assessment_finding_explanation',
    title: 'Incorrect BI-RADS score',
    description: '',
  },
  {
    metadataKey: 'breast_denstity_mismatch',
    explanationMetadataKey: 'breast_denstity_mismatch_explanation',
    title: 'Breast density mismatch',
    description: '',
  },
];

const JudgingCriteriaPanel: React.FC = () => {
  return (
    <div className="shadow-primary-main/10 flex h-full flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg">
      <p className="text-base font-semibold">Criteria for Judging the Reports</p>
      <div className="mt-3 rounded-2xl border-2 border-[#facc15] bg-[#1a1330] p-4 shadow-lg shadow-black/30">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#fde68a]">
          Task Instructions
        </p>
        <div className="mt-3 space-y-2 text-sm leading-relaxed text-white">
          <p>
            <span className="font-semibold text-[#fde68a]">Same patient:</span> This is one
            patient case, even if images appear different across views.
          </p>
          <p>
            <span className="font-semibold text-[#fde68a]">Judge these reports:</span> Compare
            Report A (LLM-generated) against Report B (reference report).
          </p>
          <p>
            <span className="font-semibold text-[#fde68a]">Scope:</span> Judge report content only
            in this step.
          </p>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3">
        <div className="space-y-2 text-sm text-white/90">
          {JUDGING_CRITERIA.map((criterion, index) => (
            <p key={`${criterion.title}-${index}`}>
              {`${index + 1}. ${criterion.title}${criterion.description ? `: ${criterion.description}` : '.'}`}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default JudgingCriteriaPanel;
