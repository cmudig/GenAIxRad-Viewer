import React from 'react';
import PropTypes from 'prop-types';

import Thumbnail from './Thumbnail';
import ThumbnailNoImage from '@ohif/ui/src/components/ThumbnailNoImage';
import ThumbnailTracked from '@ohif/ui/src/components/ThumbnailTracked';
import * as Types from '@ohif/ui/src/types';

import classnames from 'classnames';

import StudyMetadataDisplay from './StudyMetadataDisplay';

/**
 * Copied from @ohif/ui/src/components/ThumbnailList
 * 
 */

const ThumbnailList = ({
  thumbnails,
  onThumbnailClick,
  onThumbnailDoubleClick,
  onClickUntrack,
  impressions,
  activeDisplaySetInstanceUIDs = [],

}) => {
  return (
    <div
      id="ohif-thumbnail-list"
      className="ohif-scrollbar overflow-y-hidden bg-black"
      
    >
      {thumbnails.map(
        ({
          displaySetInstanceUID,
          description,
          dragData,
          seriesNumber,
          numInstances,
          modality,
          componentType,
          seriesDate,
          countIcon,
          isTracked,
          canReject,
          onReject,
          imageSrc,
          messages,
          imageAltText,
          isHydratedForDerivedDisplaySet,
        }) => {
          const isActive = activeDisplaySetInstanceUIDs.includes(displaySetInstanceUID);
          switch (componentType) {
            case 'thumbnail':
              return (
                <div 
                  key={displaySetInstanceUID} 
                  className={classnames(
                    'items-center rounded-md pb-2 pt-2 mb-1 mt-1',
                    isActive
                      ? 'bg-primary-dark'
                      : ''
                  )}
                >
                  <Thumbnail
                    key={displaySetInstanceUID}
                    displaySetInstanceUID={displaySetInstanceUID}
                    dragData={dragData}
                    description={description}
                    seriesNumber={seriesNumber}
                    seriesDate={seriesDate}
                    numInstances={numInstances}
                    countIcon={countIcon}
                    imageSrc={imageSrc}
                    imageAltText={imageAltText}
                    messages={messages}
                    isActive={isActive}
                    onClick={() => onThumbnailClick(displaySetInstanceUID)}
                    onDoubleClick={() => onThumbnailDoubleClick(displaySetInstanceUID)}
                  />
                  <StudyMetadataDisplay 
                  impressions={impressions}
                  description={description}
                  onClick={() => onThumbnailClick(displaySetInstanceUID)}
                  onDoubleClick={() => onThumbnailDoubleClick(displaySetInstanceUID)}
                  />
              </div>
              );
            case 'thumbnailTracked':
              return (
                <ThumbnailTracked
                  key={displaySetInstanceUID}
                  displaySetInstanceUID={displaySetInstanceUID}
                  dragData={dragData}
                  description={description}
                  seriesNumber={seriesNumber}
                  numInstances={numInstances}
                  countIcon={countIcon}
                  imageSrc={imageSrc}
                  imageAltText={imageAltText}
                  messages={messages}
                  isTracked={isTracked}
                  isActive={isActive}
                  onClick={() => onThumbnailClick(displaySetInstanceUID)}
                  onDoubleClick={() => onThumbnailDoubleClick(displaySetInstanceUID)}
                  onClickUntrack={() => onClickUntrack(displaySetInstanceUID)}
                />
              );
            case 'thumbnailNoImage':
              return (
                <ThumbnailNoImage
                  isActive={isActive}
                  key={displaySetInstanceUID}
                  displaySetInstanceUID={displaySetInstanceUID}
                  dragData={dragData}
                  modality={modality}
                  modalityTooltip={_getModalityTooltip(modality)}
                  messages={messages}
                  seriesDate={seriesDate}
                  description={description}
                  canReject={canReject}
                  onReject={onReject}
                  onClick={() => onThumbnailClick(displaySetInstanceUID)}
                  onDoubleClick={() => onThumbnailDoubleClick(displaySetInstanceUID)}
                  isHydratedForDerivedDisplaySet={isHydratedForDerivedDisplaySet}
                />
              );
            default:
              return <></>;
          }
        }

      )}

    </div>
  );
};

ThumbnailList.propTypes = {
  thumbnails: PropTypes.arrayOf(
    PropTypes.shape({
      displaySetInstanceUID: PropTypes.string.isRequired,
      imageSrc: PropTypes.string,
      imageAltText: PropTypes.string,
      seriesDate: PropTypes.string,
      seriesNumber: Types.StringNumber,
      numInstances: PropTypes.number,
      description: PropTypes.string,
      componentType: Types.ThumbnailType.isRequired,
      isTracked: PropTypes.bool,
      /**
       * Data the thumbnail should expose to a receiving drop target. Use a matching
       * `dragData.type` to identify which targets can receive this draggable item.
       * If this is not set, drag-n-drop will be disabled for this thumbnail.
       *
       * Ref: https://react-dnd.github.io/react-dnd/docs/api/use-drag#specification-object-members
       */
      dragData: PropTypes.shape({
        /** Must match the "type" a dropTarget expects */
        type: PropTypes.string.isRequired,
      }),
    })
  ),
  activeDisplaySetInstanceUIDs: PropTypes.arrayOf(PropTypes.string),
  onThumbnailClick: PropTypes.func.isRequired,
  onThumbnailDoubleClick: PropTypes.func.isRequired,
  onClickUntrack: PropTypes.func.isRequired,
};

// TODO: Support "Viewport Identificator"?
function _getModalityTooltip(modality) {
  if (_modalityTooltips.hasOwnProperty(modality)) {
    return _modalityTooltips[modality];
  }

  return 'Unknown';
}

const _modalityTooltips = {
  SR: 'Structured Report',
  SEG: 'Segmentation',
  RTSTRUCT: 'RT Structure Set',
};

export default ThumbnailList;
