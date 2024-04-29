import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
//
import PreviewStudyBrowser from './PreviewStudyBrowser';
import getImageSrcFromImageId from '@ohif/extension-default/src/Panels/getImageSrcFromImageId';
import getStudiesForPatientByMRN from '@ohif/extension-default/src/Panels/getStudiesForPatientByMRN';
import requestDisplaySetCreationForStudy from '@ohif/extension-default/src/Panels/requestDisplaySetCreationForStudy';

/**
 * Wraps the StudyBrowser and provides features afforded by managers/services. 
 * 
 * This is copied from @ohif/extension-default/src/Panels/WrappedPanelStudyBrowser 
 *
 * @param {object} params
 * @param {object} commandsManager
 * @param {object} extensionManager
 */
function WrappedPreviewStudyBrowser({ commandsManager, extensionManager, servicesManager }) {
  // TODO: This should be made available a different way; route should have
  // already determined our datasource
  const dataSource = extensionManager.getDataSources()[0];
  const _getStudiesForPatientByMRN = getStudiesForPatientByMRN.bind(null, dataSource);
  const _getImageSrcFromImageId = useCallback(
    _createGetImageSrcFromImageIdFn(extensionManager),
    []
  );
  const _requestDisplaySetCreationForStudy = requestDisplaySetCreationForStudy.bind(
    null,
    dataSource
  );

  return (
    <PreviewStudyBrowser
      servicesManager={servicesManager}
      dataSource={dataSource}
      getImageSrc={_getImageSrcFromImageId}
      getStudiesForPatientByMRN={_getStudiesForPatientByMRN}
      requestDisplaySetCreationForStudy={_requestDisplaySetCreationForStudy}
    />
  );
}

/**
 * Grabs cornerstone library reference using a dependent command from
 * the @ohif/extension-cornerstone extension. Then creates a helper function
 * that can take an imageId and return an image src.
 *
 * @param {func} getCommand - CommandManager's getCommand method
 * @returns {func} getImageSrcFromImageId - A utility function powered by
 * cornerstone
 */
function _createGetImageSrcFromImageIdFn(extensionManager) {
  const utilities = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.common'
  );

  try {
    const { cornerstone } = utilities.exports.getCornerstoneLibraries();
    return getImageSrcFromImageId.bind(null, cornerstone);
  } catch (ex) {
    throw new Error('Required command not found');
  }
}

WrappedPreviewStudyBrowser.propTypes = {
  commandsManager: PropTypes.object.isRequired,
  extensionManager: PropTypes.object.isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default WrappedPreviewStudyBrowser;
