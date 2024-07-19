import React, { useState, useEffect } from 'react';
import { ActionButtons, InputText, Input } from '@ohif/ui';
import { useNavigate } from 'react-router-dom';
import { DicomMetadataStore, DisplaySetService } from '@ohif/core';
import TextArea from './components/TextArea';
import WrappedPreviewStudyBrowser from './components/WrappedPreviewStudyBrowser';

function ReportSidePanelComponent({ commandsManager, extensionManager, servicesManager }) {


    return (
        <div className="ohif-scrollbar invisible-scrollbar flex flex-col">
            <TextArea 
                servicesManager={servicesManager}
                commandsManager={commandsManager}
            />
            {/* dif line */}
            <div className="border border-primary-main"> </div>
            <WrappedPreviewStudyBrowser 
                commandsManager={commandsManager}
                extensionManager={extensionManager}
                servicesManager={servicesManager}
                activatedTabName="original"
            />
        </div>       
    );
}

export default ReportSidePanelComponent;
