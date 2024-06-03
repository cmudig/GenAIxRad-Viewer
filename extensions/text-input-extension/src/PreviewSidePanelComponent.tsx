import React,{useState} from 'react';
import {ActionButtons, InputText, Input} from '@ohif/ui'
import { useNavigate } from 'react-router-dom'
import {DicomMetadataStore, DisplaySetService} from '@ohif/core'
import WrappedPreviewStudyBrowser from './components/WrappedPreviewStudyBrowser'


function PreviewSidePanelComponent({ commandsManager, extensionManager, servicesManager }) {

    

    return (
           
        <div className="ohif-scrollbar flex flex-col">
            <WrappedPreviewStudyBrowser 
                commandsManager={commandsManager}
                extensionManager={extensionManager}
                servicesManager={servicesManager}

            />
        </div>
        
        
    );
}


export default PreviewSidePanelComponent;