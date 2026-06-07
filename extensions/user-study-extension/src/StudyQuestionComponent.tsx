import React from 'react';
import ReportComparisonPanel from './ReportComparisonPanel';

function StudyQuestionComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-cy="study-question-component">
      <ReportComparisonPanel servicesManager={servicesManager} />
    </div>
  );
}

export default StudyQuestionComponent;
