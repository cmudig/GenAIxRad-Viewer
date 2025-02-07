import React from 'react';
import classnames from 'classnames';
import { applyHeatmapOverlay } from './applyColormap';
import axios from 'axios';

import './ViewportOverlay.css';

// The overlay-top and overlay-bottom classes are explicitly needed to offset
// the overlays (i.e. via absolute positioning) such the ViewportActionCorners
// have space for its child components.
// ToDo: offset the ViewportOverlay automatically via css to account for the
// space needed for ViewportActionCorners.
const classes = {
  topLeft: 'overlay-top left-viewport',
  topRight: 'overlay-top right-viewport-scrollbar',
  bottomRight: 'overlay-bottom right-viewport-scrollbar',
  bottomLeft: 'overlay-bottom left-viewport',
};

const foldername = 'test_rightpleur_noleft';
const sampleNumber = 0;

export type ViewportOverlayProps = {
  topLeft: React.ReactNode;
  topRight: React.ReactNode;
  bottomRight: React.ReactNode;
  bottomLeft: React.ReactNode;
  color?: string;
};
const ViewportOverlay = ({
  topLeft,
  topRight,
  bottomRight,
  bottomLeft,
  color = 'text-primary-light',
}: ViewportOverlayProps) => {
  const overlay = 'absolute pointer-events-none viewport-overlay';

  return (
    <div
      className={classnames(
        color ? color : 'text-aqua-pale',
        'text-[13px]',
        'leading-5',
        'overlay-text'
      )}
    >
      <div
        data-cy={'viewport-overlay-top-left'}
        className={classnames(overlay, classes.topLeft)}
      >
        {topLeft}
      </div>
      <div
        data-cy={'viewport-overlay-top-right'}
        className={classnames(overlay, classes.topRight)}
        style={{ transform: 'translateX(-8px)' }} // shift right side overlays by 4px for better alignment with ViewportActionCorners' icons
      >
        {topRight}

        {/* Add Your Button Here */}
        <button
          style={{
            padding: '5px 10px',
            backgroundColor: '#00bcd4',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            borderRadius: '5px',
            pointerEvents: 'all', // Allow interactions
          }}
          onClick={event => {
            console.log('🟢 Explain button clicked!');

            // 🔍 Find all possible viewport elements
            const allViewports = document.querySelectorAll('.cornerstone-viewport-element'); // 🔹 Use cornerstone-specific class
            console.log('🔍 All Viewports Found:', allViewports);

            // 🔹 Try to find the correct viewport element based on its relationship in the DOM
            let viewportElement = event.currentTarget
              .closest('.viewport-wrapper')
              ?.querySelector('.cornerstone-viewport-element');

            if (!viewportElement) {
              console.warn('❌ No viewport element found! Trying another method...');
              viewportElement = document.querySelector('.cornerstone-viewport-element'); // 🔹 Fallback selector
            }

            console.log('🖼️ Found Viewport Element:', viewportElement);

            if (!viewportElement) {
              console.warn('❌ Still could not find a viewport!');
              return;
            }

            const viewportId = viewportElement.getAttribute('data-viewport-uid');
            console.log('🖼️ Viewport ID:', viewportId);

            console.log('🚀 Calling applyHeatmapOverlay()...');
            applyHeatmapOverlay(viewportId, foldername, sampleNumber);
          }}
        >
          Explain
        </button>
      </div>
      <div
        data-cy={'viewport-overlay-bottom-right'}
        className={classnames(overlay, classes.bottomRight)}
        style={{ transform: 'translateX(-8px)' }} // shift right side overlays by 4px for better alignment with ViewportActionCorners' icons
      >
        {bottomRight}
      </div>
      <div
        data-cy={'viewport-overlay-bottom-left'}
        className={classnames(overlay, classes.bottomLeft)}
      >
        {bottomLeft}
      </div>
    </div>
  );
};

export default ViewportOverlay;
