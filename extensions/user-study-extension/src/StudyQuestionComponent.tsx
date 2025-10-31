import React from 'react';
import SeriesPrompt from './SeriesPrompt';

function StudyQuestionComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="p-4 bg-primary-dark text-white h-full" data-cy="study-question-component">
      <SeriesPrompt servicesManager={servicesManager} />
    </div>
  );
}

export default StudyQuestionComponent;
