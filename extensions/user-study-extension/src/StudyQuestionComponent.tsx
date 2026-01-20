import React from 'react';
import ReportComparisonPanel from './ReportComparisonPanel';

function StudyQuestionComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="h-full" data-cy="study-question-component">
      <ReportComparisonPanel />
    </div>
  );
}

export default StudyQuestionComponent;
