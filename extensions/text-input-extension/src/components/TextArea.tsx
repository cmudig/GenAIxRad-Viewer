import React,{useState} from 'react';
import {ActionButtons, InputText, Input} from '@ohif/ui'
import { useNavigate } from 'react-router-dom'
import {DicomMetadataStore, DisplaySetService} from '@ohif/core'

/**
 * This Component allows Text input and provides features to send text to backend§ services
 * Its state is not shared with other components.
 * 
 */


function TextArea({}){


    const [textData, setTextData] = useState('');
    const disabled = false;


    const submitText = (event) => {
        console.log(textData);
    }
    const clearText = (event) => {
        setTextData('');
    }
    const handleChange = (event) => {
        setTextData(event.target.value);
    };

    //reload images by reloading webside
    const navigate = useNavigate();
    const reloadPage = () => {
        // test:
        const studyInstanceUID = '1.2.826.0.1.3680043.8.1055.1.20111102150758591.92402465.76095170';
        const study = DicomMetadataStore.getStudy(studyInstanceUID);
        console.log(study);
        
    }
    return (
        <div className="bg-primary-dark">
            <div className="flex justify-center p-4">
                <textarea  
                    rows = {3}
                    label="Enter findings:"
                    labelClassName="text-white text-[14px] leading-[1.2]"
                    className="border-primary-main bg-black align-top sshadow transition duration-300 appearance-none border border-inputfield-main focus:border-inputfield-focus focus:outline-none disabled:border-inputfield-disabled rounded w-full py-2 px-3 text-sm text-white placeholder-inputfield-placeholder leading-tight"
                    type="text"
                    value={textData}
                    onKeyPress={submitText}
                    onChange={handleChange}>
            
                </textarea>
            </div>
            <div className="flex justify-center p-4 bg-primary-dark">
                <ActionButtons
                className="bg-primary-dark"
                actions={[
            
                {
                    label: 'Generate Image',
                    onClick: submitText,
                },
                {
                    label: 'Clear',
                    onClick: clearText,
                },
                {
                    label: 'Reload',
                    onClick: reloadPage,
                },
                ]}
                disabled={disabled}
                />
            </div>
        </div>
    
    );
}

export default TextArea;