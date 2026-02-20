import React from 'react';

const JUDGING_CRITERIA = [
  '(a) False report of a finding: the generated report mentions a finding (e.g., a mass, calcification, asymmetry) that is not in the ground truth report.',
  '(b) Missing a finding: The candidate report omits a finding mentioned in the ground truth report.',
  '(c) Mischaracterization of a finding: A finding is present in both the ground truth and AI-generated report, but its characteristics (e.g., size, margins, stability/interval change) are described incorrectly.',
  '(d) Misidentification of lcoation/laterality: A finding is. correctly identified, but its location (e.g., "upper outer quadrant", retroareolar, depth) or laterality (left/right/bilateral) is wrong.',
  '(e) Incorrect BI-RADS score.'
];

const JudgingCriteriaPanel: React.FC = () => {
  return (
    <div className="shadow-primary-main/10 flex h-full flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg">
      <p className="text-base font-semibold">Criterions of Judging the Original and AI-Generated Report</p>
      <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3">
        <div className="space-y-2 text-sm text-white/90">
          {JUDGING_CRITERIA.map((criterion, index) => (
            <p key={`${criterion}-${index}`}>{`${index + 1}. ${criterion}`}</p>
          ))}
        </div>
      </div>
    </div>
  );
};

export default JudgingCriteriaPanel;
