import React,{useState} from 'react';
import {ActionButtons, InputText, Input} from '@ohif/ui'
import { useNavigate } from 'react-router-dom'
import {DicomMetadataStore, DisplaySetService} from '@ohif/core'
import TextArea from './components/TextArea'

function TextInputSidePanelComponent({ commandsManager, extensionManager, servicesManager }) {

    

    return (
           
        <div className="ohif-scrollbar invisible-scrollbar flex flex-col">
            <TextArea 
                servicesManager={servicesManager}
                commandsManager={commandsManager}
                />
        </div>
        
        
    );
}


export default TextInputSidePanelComponent;