import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import StudyItem from '@ohif/ui/src/components/StudyItem';
import LegacyButtonGroup from '@ohif/ui/src/components/LegacyButtonGroup';
import LegacyButton from '@ohif/ui/src/components/LegacyButton';
import { StringNumber } from '@ohif/ui/src/types';
import {metaData} from '@cornerstonejs/core';
import ThumbnailList from './ThumbnailList';


const getTrackedSeries = displaySets => {
  let trackedSeries = 0;
  displaySets.forEach(displaySet => {
    if (displaySet.isTracked) {
      trackedSeries++;
    }
  });

  return trackedSeries;
};


const PreviewStudy = ({
  tabs,
  activeTabName,
  expandedStudyInstanceUIDs,
  onClickTab,
  onClickStudy,
  onClickThumbnail,
  onDoubleClickThumbnail,
  onClickUntrack,
  activeDisplaySetInstanceUIDs,
  servicesManager,
}) => {
  const { t } = useTranslation('StudyBrowser');
  const { customizationService } = servicesManager?.services || {};

  const getTabContent = () => {
    const tabData = tabs.find(tab => tab.name === activeTabName);

    return tabData.studies.map(
      ({ studyInstanceUid, date, description, numInstances, modalities, displaySets }) => {
        const isExpanded = expandedStudyInstanceUIDs.includes(studyInstanceUid);
        
        // get study meta data that is stored in data/init_metadata.json
        const seriesInstanceUID = displaySets?.[0]?.SeriesInstanceUID;
        const studyMetadata = metaData.get('studyMetadata', seriesInstanceUID);
        const impressions = studyMetadata?.impressions;
        
        return (
          <React.Fragment key={seriesInstanceUID}>
            {/*

            // TODO: remove this part if not needed
            
            <StudyItem
              date={date}
              description={description}
              numInstances={numInstances}
              modalities={modalities}
              trackedSeries={getTrackedSeries(displaySets)}
              isActive={isExpanded}
              onClick={() => {
                onClickStudy(studyInstanceUid);
              }}
              data-cy="thumbnail-list"
            /> */}

            <div >{/*//style={{height: '200px' }}*/}
              <ThumbnailList
                thumbnails={displaySets}
                activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
                onThumbnailClick={onClickThumbnail}
                onThumbnailDoubleClick={onDoubleClickThumbnail}
                onClickUntrack={onClickUntrack}
                impressions={impressions}
              />
              </div>

          </React.Fragment>
        );
      }
    );
  };

  return (
    <React.Fragment>
      {
      // removed Buttons for preview selection for now.
      //TODO: remove uncommented part and its function if they are relly not needed

      <div
        className="w-100 border-secondary-light bg-primary-dark flex h-16 flex-row items-center justify-center border-b p-4"
        data-cy={'studyBrowser-panel'}
      >


        <LegacyButtonGroup
          variant="outlined"
          color="secondary"
          splitBorder={false}
        >
          {tabs.map(tab => {
            const { name, label, studies } = tab;
            const isActive = activeTabName === name;
            const isDisabled = !studies.length;
            // Apply the contrasting color for brighter button color visibility
            const classStudyBrowser = customizationService?.getModeCustomization(
              'class:StudyBrowser'
            ) || {
              true: 'default',
              false: 'default',
            };
            const color = classStudyBrowser[`${isActive}`];
            return (
              <LegacyButton
                key={name}
                className={'min-w-18 p-2 text-base text-white'}
                size="initial"
                color={color}
                bgColor={isActive ? 'bg-primary-main' : 'bg-black'}
                onClick={() => {
                  onClickTab(name);
                }}
                disabled={isDisabled}
              >
                {t(label)}
              </LegacyButton>
            );
          })}
        </LegacyButtonGroup>
      </div> }
      <div className="ohif-scrollbar  flex flex-1 flex-col overflow-auto">
        {getTabContent()}
      </div>
    </React.Fragment>
  );
};

PreviewStudy.propTypes = {
  onClickTab: PropTypes.func.isRequired,
  onClickStudy: PropTypes.func,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  activeTabName: PropTypes.string.isRequired,
  expandedStudyInstanceUIDs: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeDisplaySetInstanceUIDs: PropTypes.arrayOf(PropTypes.string),
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      studies: PropTypes.arrayOf(
        PropTypes.shape({
          studyInstanceUid: PropTypes.string.isRequired,
          date: PropTypes.string,
          numInstances: PropTypes.number,
          modalities: PropTypes.string,
          description: PropTypes.string,
          displaySets: PropTypes.arrayOf(
            PropTypes.shape({
              displaySetInstanceUID: PropTypes.string.isRequired,
              imageSrc: PropTypes.string,
              imageAltText: PropTypes.string,
              seriesDate: PropTypes.string,
              seriesNumber: StringNumber,
              numInstances: PropTypes.number,
              description: PropTypes.string,
              componentType: PropTypes.oneOf(['thumbnail', 'thumbnailTracked', 'thumbnailNoImage'])
                .isRequired,
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
        })
      ).isRequired,
    })
  ),
};

const noop = () => {};

PreviewStudy.defaultProps = {
  onClickTab: noop,
  onClickStudy: noop,
  onClickThumbnail: noop,
  onDoubleClickThumbnail: noop,
  onClickUntrack: noop,
};

export default PreviewStudy;
