import React from 'react';
import PropTypes from 'prop-types';

const StudyMetadataDisplay = ({
    impressions,
    description,
    onClick,
    onDoubleClick,
 }) => {
  if (impressions === undefined) return (
    <div className="group mb-8 flex flex-1 cursor-pointer flex-col px-3 outline-none"
      onClick={onClick}
      onDoubleClick={onDoubleClick}>
      <span className="text-primary-main font-bold select-none mb-1">{'Original Image'}</span>
      <div className="break-all text-base text-blue-300 mb-1">{description}</div>
      
  </div>
  );

  return (
    <div className="group mb-8 flex flex-1 cursor-pointer flex-col px-3 outline-none"
          onClick={onClick}
          onDoubleClick={onDoubleClick}>
      <span className="text-primary-main font-bold select-none mb-1">{'Generated Image'}</span>
      <div className="break-all text-base text-blue-300 mb-1">{description}</div>
      <div className="break-words text-base text-white">
        {impressions ? impressions : ''}
      </div>
    </div>
  );
};

StudyMetadataDisplay.propTypes = {
  impressions: PropTypes.string,
};

export default StudyMetadataDisplay;
