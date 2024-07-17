import os
import requests


# download dicom files from server
def download_dicom_files(server_url, foldername, destination_folder):
    try:
        # Get the list of files in the folder
        list_files_url = f"{server_url}/files/{foldername}"
        response = requests.get(list_files_url)
        
        if response.status_code != 200:
            print(f"Failed to get list of files: {response.text}")
            return
        
        files = response.json()
        
        # Ensure the destination folder exists
        os.makedirs(destination_folder, exist_ok=True)
        
        for filename in files:
            # Download each file
            file_url = f"{server_url}/files/{foldername}/{filename}"
            file_response = requests.get(file_url)
            
            if file_response.status_code == 200:
                file_path = os.path.join(destination_folder, filename)
                with open(file_path, 'wb') as file:
                    file.write(file_response.content)
                print(f"Downloaded {filename}")
            else:
                print(f"Failed to download {filename}: {file_response.text}")
    except Exception as e:
        print(f"An error occurred: {e}")

# run medsyn model on server
def run_medsyn(file_name, prompt, server_url):
  # Define the URL and payload
  url = f"{server_url}/files/{file_name}"
  payload = {
      "prompt": prompt
  }
  headers = {
      "Content-Type": "application/json"
  }

  # Send the POST request
  response = requests.post(url, json=payload, headers=headers)

  # Print the response
  print(f"Status Code: {response.status_code}")
  print(f"Response: {response.json()}")






server_url = "http://149.165.152.221:5000"
file_name = "test" # file name must be unique

# run model on server
run_medsyn(file_name=file_name, prompt="Cardiomegaly, minimal pericardial-pleural effusion.", server_url = server_url)


# Download files from server 
foldername = file_name 
destination_folder = f"./data/from_backend/{foldername}"  

#download_dicom_files(server_url, foldername, destination_folder)