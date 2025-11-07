import React from 'react';
import PatientVignette from './PatientVignette';

function StudyQuestionComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="p-4 bg-primary-dark text-white h-full" data-cy="study-question-component">
      <PatientVignette servicesManager={servicesManager} />
    </div>
  );
}

export default StudyQuestionComponent;
