import React from 'react';
import QuestionPanel from './QuestionPanel';

function StudyQuestionComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="p-4 bg-primary-dark text-white" data-cy="study-question-component">
      <QuestionPanel
        commandsManager={commandsManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
      />
    </div>
  );
}

export default StudyQuestionComponent;
