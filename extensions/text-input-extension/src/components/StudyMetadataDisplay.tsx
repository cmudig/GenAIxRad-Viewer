import React from 'react';
import PropTypes from 'prop-types';

const StudyMetadataDisplay = ({
    impressions,
    onClick,
    onDoubleClick,
 }) => {
  if (impressions === undefined) return null;

  return (
    <div className="group mb-8 flex flex-1 cursor-pointer flex-col px-3 outline-none"
          onClick={onClick}
          onDoubleClick={onDoubleClick}>
      <span className="text-primary-main font-bold select-none">{'Text of Image Generation'}</span>
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
