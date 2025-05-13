import React from 'react';

function StudyQuestionComponent({ commandsManager, extensionManager, servicesManager }) {
  return (
    <div className="p-4 bg-primary-dark text-white">
      <h1 className="text-2xl font-bold mb-2">Insert Questions Here</h1>
      <p>Answer choices</p>
    </div>
  );
}

export default StudyQuestionComponent;
