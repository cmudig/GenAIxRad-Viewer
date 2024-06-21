import nibabel as nib
import pydicom
import numpy as np
import os
from pydicom.dataset import Dataset, FileDataset
from datetime import datetime
from pydicom.uid import generate_uid
import matplotlib.pyplot as plt
import requests
import simple_orthanc
import json




def delete_series(series_to_delete, orthanc_url='http://localhost:8042'):
    series_url = f"{orthanc_url}/series/"
    params = {}
    params['expand'] = 1
    params['requestedTags'] = "SeriesInstanceUID"
    
    series_response = requests.get(series_url, params)

    series_id = [entry['ID'] for entry in series_response.json() if entry.get('RequestedTags', {}).get('SeriesInstanceUID') == series_to_delete]
    for serie_id in series_id:
        serie_response = requests.delete(f"{orthanc_url}/series/"+serie_id)
        if serie_response.status_code != 200:
            print(f"Failed to retrieve patient information. Status code: {serie_response.status_code}")
            print(f"Response: {serie_response.text}")
            return
        print(f"Deleted Study: {serie_id}")


def upload_dicom_folder(dicom_folder):
    # Initialize the Orthanc client
    print("Uploading DICOM folder to Orthanc...")
    orthanc = simple_orthanc.Orthanc()

    
    orthanc.upload_folder(dicom_folder, test_dicom=False, recursive=False)





def nifti_to_dicom(nifti_file,
    series_description,
    series_instance_uid, # should be different for each image
    reference_dicom_file = "../data/dicom/real/extensive-consolidation-v2-sampl/image.0001.dcm",
    modality='CT',
    study_instance_uid = '1', # should be the same for each study (for AI/non-AI)
    study_id='1', # should be the same for AI/non-AI
    patient_name="Generative AI Patient",
    patient_id="MedSyn",
    description="",

    ):
    output_folder = nifti_file.split(".nii.gz")[0] # stores in folder with same name as input file
    print(f"Store DICOM files in Folder: {output_folder}")
    rotate=""
    
    
    if modality=='AI':
        rotate="counterclockwise"
        apply_mirror = False
    else:
        rotate="clockwise"
        apply_mirror = True



    # Load the NIfTI file
    img = nib.load(nifti_file)
    data = img.get_fdata()
    affine = img.affine

    # Ensure output folder exists
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    # Initialize common dataset attributes
    ds = pydicom.dcmread(reference_dicom_file)
    ds.PatientName = patient_name
    ds.PatientID = patient_id
    ds.AccessionNumber = study_instance_uid
    ds.StudyInstanceUID = study_instance_uid
    ds.SeriesInstanceUID = series_instance_uid
    ds.SeriesDescription= series_description
    ds.Modality = modality
    ds.SeriesNumber = 1
    ds.StudyID = study_id
    ds.StudyDescription = description
    ds.Manufacturer = "PythonDicomConversion"
    ds.Rows, ds.Columns = data.shape[:2]
    ds.SliceThickness = float(affine[2, 2])

    ds.SamplesPerPixel = 1
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1  # 1 means signed integers




    # Set additional metadata
    ds.ContentDate = str(datetime.now().date()).replace('-', '')
    ds.ContentTime = datetime.now().strftime("%H%M")

    ds.StudyDate = ds.ContentDate
    ds.StudyTime = ds.ContentTime
    ds.PatientSex = "O"
    ds.PatientBirthDate = "19000101"

    

    # Scale pixel data if necessary (e.g., to avoid issues with pixel value ranges)
    #data = data - np.min(data)
    #data = data / np.max(data) * (3000)
    
    # norm the HUE data between -2000, and 2000
    data = (data - np.min(data)) / (np.max(data) - np.min(data)) * 4000 - 2000
    data = data.astype('int16')

    # reverse in 3rd axis
    #data = data[:,:,::-1]
    # Rotate each slice to the left (90 degrees counterclockwise)
    if rotate == "counterclockwise":
        data = np.rot90(data, k=1, axes=(0, 1))
    elif rotate == "clockwise":
        data = np.rot90(data, k=3, axes=(0, 1))
    
    

    
    #print(data)
    # Iterate over each slice and update the dataset
    for i in range(data.shape[2]):
        slice_data = data[:, :, -(i+1)]

        if apply_mirror:
            slice_data = np.fliplr(slice_data)

        # Update slice-specific attributes
        ds.SOPInstanceUID= generate_uid()
        ds.InstanceNumber = i + 1
        ds.ImagePositionPatient = [0,0,-i] 
        ds.SliceLocation = i * ds.SliceThickness



        # Convert pixel data to the appropriate type and flatten the array
        ds.PixelData = slice_data.tobytes()

        # Visualize the slice
        # plt.imshow(slice_data, cmap='gray')
        # plt.title(f'Slice {i}')
        # plt.show()

        # Save the DICOM file
        dicom_filename = os.path.join(output_folder, f"slice_{i:03d}.dcm")
        ds.save_as(dicom_filename)

    print(f"Conversion complete. DICOM files are saved in {output_folder}")

    # delete if there is already a study for this patient
    delete_series(series_to_delete=series_instance_uid)
    
    upload_dicom_folder(output_folder)
    print("Files Uploaded to Orthanc Server Localhost")




def store_metadata(series_instance_uid, metadata, json_file_path="../data/init_metadata.json"):
    # Load the existing JSON file
    with open(json_file_path, 'r') as json_file:
        data = json.load(json_file)
        
    # Ensure the series_instance_uid exists in the data
    if series_instance_uid not in data:
        data[series_instance_uid] = {}
    # Add or override the entry
    for key, value in metadata.items():
        data[series_instance_uid][key] = value

    # Write the updated data back to the JSON file
    with open(json_file_path, 'w') as json_file:
        json.dump(data, json_file, indent=4)

    print(f"Entry with study_instance_uid {series_instance_uid} added or updated.")



def _get_orthanc_study_id(study_instance_uid):
    try:
        # Parameters to include in the request
        params = {
            'expand': 1,
            'requestedTags': 'StudyInstanceUID'
        }

        # Fetching DICOM studies from the PACS server with query parameters
        response = requests.get('http://localhost/pacs/studies', params=params)
        
        # Check if the response is ok (status code 200-299)
        if response.status_code != 200:
            print(f"Network response was not ok. Status: {response.status_code}")
            return None
        
        # Parse the response as JSON
        data = response.json()

        # Filter the data to find the study with the given StudyInstanceUID
        study = next((item for item in data if item['RequestedTags']['StudyInstanceUID'] == study_instance_uid), None)

        # Check if the study was found
        if study:
            return study['ID']
        else:
            return None
    except requests.exceptions.RequestException as e:
        # Log any errors that occur during the fetch operation
        print(f'There has been a problem with your fetch operation: {e}')
        return None
    
def add_metadata_to_study(study_instance_uid, data, type):
    if not (type == 'Impressions' or  type == 'Findings'):
        print(f"Invalid metadata type: {type}. Must be either 'Impressions' or 'Findings'.")
        return
    study_id = _get_orthanc_study_id(study_instance_uid)
    try:
        url = f'http://localhost/pacs/studies/{study_id}/metadata/{type}'
        headers = {
            'Content-Type': 'text/plain'  # Ensure the server expects text/plain content type
        }
        
        response = requests.put(url, headers=headers, data=data)

        if response.status_code != 200:
            print(f"Response not ok. Status: {response.status_code}, Response text: {response.text}")
            return

    except requests.exceptions.RequestException as e:
        print(f'There was a problem with your fetch operation: {e}')

#add_metadata_to_study('1.1', 'Test', 'Findings')
def _get_orthanc_series_id(series_instance_uid):
    try:
        # Parameters to include in the request
        params = {
            'expand': 1,
            'requestedTags': 'SeriesInstanceUID'
        }

        # Fetching DICOM studies from the PACS server with query parameters
        response = requests.get('http://localhost/pacs/series', params=params)
        
        # Check if the response is ok (status code 200-299)
        if response.status_code != 200:
            print(f"Network response was not ok. Status: {response.status_code}")
            return None
        
        # Parse the response as JSON
        data = response.json()

        # Filter the data to find the study with the given StudyInstanceUID
        study = next((item for item in data if item['RequestedTags']['SeriesInstanceUID'] == series_instance_uid), None)

        # Check if the study was found
        if study:
            return study['ID']
        else:
            return None
    except requests.exceptions.RequestException as e:
        # Log any errors that occur during the fetch operation
        print(f'There has been a problem with your fetch operation: {e}')
        return None
    
def add_metadata_to_series(series_instance_uid, data, type):
    if not (type == 'SeriesPrompt'):
        print(f"Invalid metadata type: {type}.")
        return
    series_id = _get_orthanc_series_id(series_instance_uid)
    print(series_id)
    try:
        url = f'http://localhost/pacs/series/{series_id}/metadata/{type}'
        headers = {
            'Content-Type': 'text/plain'  # Ensure the server expects text/plain content type
        }
        
        response = requests.put(url, headers=headers, data=data)
        if response.status_code != 200:
            print(f"Response not ok. Status: {response.status_code}, Response text: {response.text}")
            return

    except requests.exceptions.RequestException as e:
        print(f'There was a problem with your fetch operation: {e}')