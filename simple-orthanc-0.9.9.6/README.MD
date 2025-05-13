# simple-orthanc: Pythonic Interface for Orthanc

## Orthanc

Orthanc is an open source and lightweight dicom server

More on Orthanc:

[orthanc](https://www.orthanc-server.com)

## simple-orthanc

simple-orthanc uses the Orthanc api to communicate with the the Orthanc server.
simple-orthanc and enables the following functionality with justa few lines of
Python code:

- connection to an orthanc server.
- Selecting patients, studies, series, instances
- Downloading of selected dicom patients, studies, series, instances
- Uploading Dicom files to the Orthanc Server
- Introspection dicom tags for selected items.
- Retrieving selected pydicom headers 
- Retrieve pixel array in numpy format for selected series, for multislice data
  this will be a 3D volume.
  
### Connect to an orthanc server

To connect to a orthanc server the ip adress, port, username and password
should usually be specified. A connection is set up as follows:

```
import simple_orthanc

orthanc = simple_orthanc.Orthanc(host='127.0.0.1'
                                port=8042,
                                username='orthanc_user',
                                password='orthanc_password')
                            
```

Note when the Orthanc server runs on the local machine listens to the
default port 8042 and no username and password are setup, the connection can
be initiated like:

`orthanc = simple-orthanc.Orthanc()`


To get information about the number of patients, studies, series, or instances
on the Orthanc server do:

```
orthanc.patient_count
orthanc.study_count
orthanc.series_count
orthanc.instance_count
```

### Retrieving Dicom information

To obatain information of specific dicom tags:

`patient_names = orthanc.PatientNames`

or

`series_descriptions = orthanc.SeriesDescriptions`

Information values for any dicom tag for the entire database can be obtained
using this method.


### Applying a selection

To select data on the Orthanc server the following lines of code can be used:

`orthanc.select(PatientName='JaneDoe', StudyDescription='CT Examination', ...)`

Any dicom tag can be used to select data except for DICOM sequences.
To obtain information about the number of patients, studies, series,
or instances on the Orthanc server do (again):

```
orthanc.patient_count
orthanc.study_count
orthanc.series_count
orthanc.instance_count
```

And to obtain the current selection:

`selection = orthanc.selection`

When a selection is applied and information the value of a dicom tag is asked,
only the values within the current select are returned.

so `orthanc.PatientName` will only return JaneDoe in the above example. And
`orthanc.SeriesDescriptions` will return all dicom SeriesDescriptions for
patient 'JaneDoe' and study with description 'CT Examination'

### Clearing a selection

Use `orthanc.reset()` to clear the current selection. And use
`orthanc.reset('PatientName')` to remove a single dicom tag from the current
selection.

### Downloading and Uploading Dicom Data

To download (all) dicom data to a specific folder for the current selection do:

`files = orthanc.download(folder)`

If no folder is specified the files are downloaded to a system temp folder.
The temp folder is frequently cleared. A complete list of files with full path
is returned.

`orthanc.upload_file(file, test_dicom=True)`

Will upload a single dicom file to the Orthanc Server. Optional a file can be
tested if it is a dicom file prior to upload. If you have a very fast (local)
connection to the Orthanc server this might slow down the upload. If your
connection is very slow (remote internet connection) this may speed up the
upload since a non dicom file is catched before sending.

An entire list of files can be uploaded using the same command:

`orthanc.upload_file(file_list, test_dicom=True)`

And finally an entire directory with files can be uploaded by:

`orthanc.upload_folder(folder, test_dicom=True, recursive=True)`

It can be specified if files are found in the entire folder tree
(recursive=True) or just in the folder itself (recursive=False). Recursive is 
False by default.

For deleting studies from the server use:

`orthanc.delete_selected_patient()`
`orthanc.delete_selected_study()`
`orthanc.delete_selected_series()`

Warning this action cannot be undone. When deleting the selected patient or 
study, series (and instances) of this patient or study that are not in the 
selection will also be deleted!


use `orthanc.refresh()` to refresh the connection with orthanc to make the
newly uploaded visible. Also use refresh after deleting to remove deleted items
from the local cache.


### Obtaining Dicom Headers

The header can be obtained as a pydicom dataset when a single instance is 
selected:

`header = orthanc.get_header()`

If multiple instances are selected:

`headers = orthanc.get_headers()`

Will retrieve a list of all dicom headers. It may take some time to obtain all 
headers for a large number of instances. Specify an index to
obtain a single header when multiple instances are selected:

`headers = orthanc.get_headers(index=0)`

Will retrieve only the first header.

Pydicom headers are (re)created from a json response from the orthanc server. 
A few dicom tags might not convert into the pydicom header. To see which tags 
are excluded set the silent flag to False:

`headers = orthanc.get_headers(index=0, silent=False)`


### Obtaining pixel data 

The Orthanc api offers the possibility to directly get the pydicom pixel data.

`numpy_array = orthanc.get_array()`

Will obtain all pixel data for a single series. If multiple instances are
present in the series, the pixel arrays are sorted by the the orthanc server
into a 3D volume of size M*N*S*C. Where M and N are the number of pixels,
S the number of slices and C the number of color channels (1 for grayscale,
3 for color).


### Sorting data

When a single series is selected, it is possible to sort the instances by the
value of a specific dicom tag. For example:

`orthanc.sort_by('SliceLocation')`

or

`orthanc.sort_by('InstanceNumber', order='descending')`

Sort order is ascending by default. When calling the `get_headers` method, 
the headers will be a list in the sorted order. Same for reading dicom tags:

`orthanc.SliceLocation` will now return a list in the sorted order.

An exception is the `get_array` method which gives the same result regardless 
of the sorting order. 3D arrays are composed by the orthanc
server which always uses a default (slice) sorting order (probably using the
ImagePositionPatient and ImageOrientationPatient dicom tags).

### Dicom Tags

`orthanc.PatientName` will retrieve a list of unique patient names in the
database. It is also possible to obtain the values for each patient.

`orthanc.get_dicom_tag('PatientName', unique=False)`

Will give a list of PatientNames on the orthanc server. PatientNames may have
multiple entries on the server. 

`orthanc.get_all_dicom_tags()`

Will return all Dicom tag names that are available for the current selection.
If multiple series are selected this will return the main dicom tags (see 
below). If a single serie is selected this will return all available tags in
the first instance of the series. 

### Performance

Orthanc is a very light weight and fast dicom server. The API offers little
overhead is is very fast. There are some limitations however. First of all when
there a huge number of instances in your current selection, it may take a while
to obtain tag values / headers etc.

The Orthanc API exposes a subset of dicom tags directly. This subset can is
obtained by:

`fast_tags = orthanc.interface.main_dicom_tags`

Using these tags in selections or obtain values for these tags is really fast.
However for tags at the Patient Level, selections and obtaining values is much
faster than tags at the Instance Level. There are usually far less Patients in
the database than there are Instances.

Tags that are not main_dicom_tags are always queried at Instance Level, since
there is no easy discrimination to which dicom level a specific tag belongs.
Therefor using these tags hamper performance.

### One line code example

PyDicom can be used very efficently in just one line of code. Connecting,
communicating, querying, downloading, slice sorting and reading pixel data 
can be done by:

```
from simple_orthanc import Orthanc
image = Orthanc().select(PatientName='JaneDoe', 
                         SeriesDescription='ct_scan').get_array()
```








