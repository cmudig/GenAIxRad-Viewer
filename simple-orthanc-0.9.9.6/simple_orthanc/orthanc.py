
import tempfile
import shutil
import pydicom
import os
import warnings
import uuid


from simple_orthanc.dicom_tags import INSTANCE_LEVEL, SERIES_LEVEL, STUDY_LEVEL, PATIENT_LEVEL, OrthancDicomTag, dict_to_pydicom, safe_parse_dicom_value
from simple_orthanc import OrthancAPI, OrthancInterface
from simple_orthanc.logger import Logger
from simple_orthanc.helpers import show_progress
from simple_orthanc.constants import LOG_LEVEL, PRIVATE, ASCENDING, DESCENDING




class Orthanc(Logger):
    """
    Pythonic interface to communicate with an Orthanc Server. Selections can
    be made using dicom queries. Selection can be downloaded, deleted or read
    to numpy array.
    """
    _LOG_LEVEL = LOG_LEVEL
    warning_count = 1000
    _selection = None
    __tag_names = None

    def __init__(self, host='127.0.0.1', port=8042,
                 username=None, password=None, selection=None,
                 ipaddress=None):
        """
        Pythonic interface for an Orthanc PACS (https://www.orthanc-server.com)

        Parameters
        ----------
        host : String, optional
            host name of the orthanc server. The default is '127.0.0.1'.
        port : int, optional
            Port number of the orthanc server. The default is 8042.
        username : String, optional
            Username to connect to the orthanc server. The default is None.
        password : String, optional
            Password to connect to the orthanc server. The default is None.
        selection : TYPE, optional
            Apply a selection to the orthanc database, see the selection method
            for details. The default is None.


        Returns
        -------
        Orthanc object

        """
        Logger.__init__(self)


        if ipaddress is not None:
            warnings.warn('Use host to set set ipadress', DeprecationWarning)


        self.api = OrthancAPI(host=host,
                              port=port,
                              username=username,
                              password=password)
        

        
        self.interface = OrthancInterface(api=self.api)

        self._clear_temp()

    def __len__(self):
        return self.series_count

    def __dir__(self):
        # add dicom tag names
        
        return self._tag_names + super().__dir__()
    
    def __getattr__(self, attr):
        # return a dicom tag as attribute
        if attr in OrthancDicomTag.PYDICOM_TAGNAMES or attr.startswith(PRIVATE):
            values = self.get_dicom_tag(OrthancDicomTag(attr))
            return values
        raise AttributeError("%r object has no attribute %r" %
                              (self.__class__.__name__, attr))
        
    @property
    def _tag_names(self):
       
        if self.__tag_names is not None:
            return self.__tag_names
        
        tags = self.interface.main_dicom_tags.tolist()
        
        
        if self.patient_count == 1:
             tags += self.get_all_dicom_tags()
             
        tags = [str(tag) for tag in tags]
         
        self.__tag_names = sorted(list(set(tags)))

        return self.__tag_names

    def get_all_dicom_tags(self, include_private=True):
        """
        Returns all dicom attributes that are available for 
        the current selection as a list. 
        
        When a large number of instances are selected this may take some time.

        Returns
        -------
        TYPE
            list of strings.

        """
        
        tags = []
        for oid in self.interface.selected.Series:
           data = self.api.json_for_oid(oid=oid, level='Series')
           instance_oid = data['Instances'][0]
           tag_request = self.api.request_available_tags(instance_oid)
           available_tags = self.api.get_json(tag_request)
           
           tags += [OrthancDicomTag.from_orthanc_tag(tag)\
                    for tag in available_tags if tag not in tags]
               
        tags = [tag for tag in tags\
               if '' != str(tag) and ' ' not in str(tag)]
           
        if not include_private:
           tags = [tag for tag in tags if not str(tag).startswith(PRIVATE)]
        return tags
    
    
    def sort_by(self, tag, order=ASCENDING):
        """
         Sort the instances in the current selection based on the value of 
         the specified dicom tag. Order can be 'ascending' or 'descending'

        After sorting each successive property that is accessed will be in the
        sorted order. e.g. get_headers(), the order of the file list that is
        returned after download. 

        Parameters
        ----------
        **kwargs : dict
            dicom tag names and values that will be used to select the
            dicom images.

        Returns
        -------
        TYPE
            Orthanc Object

        """
        
        if isinstance(tag, str):
            tag = OrthancDicomTag(tag)
            
        self.raise_single_series()
            
        values = self.get_dicom_tag(tag, unique=False)
        
    
        if not isinstance(values[0], (str, float, int)):
            msg = (f'Cannot sort {tag.tagname} with values of type '
                   '{type(values[0])}')
            raise TypeError(msg)
        
        oids = self.interface.selected.Instances
        oids = [oid for _, oid in zip(values, oids)]
        
        if order == DESCENDING:
            order = oids[::-1]
        
        self.interface.selected.Instances = oids
        return self
        
    
        
    def select(self, **kwargs):
        """
         Perform a dicom query by applying a selection. Example:
            orthanc.select(PatientID='123456')
            orthanc.sekect(PatientID='123456', SeriesDescription='MyDescr')

        Parameters
        ----------
        **kwargs : dict
            dicom tag names and values that will be used to select the
            dicom images.

        Returns
        -------
        TYPE
            Orthanc Object

        """

        self.selection.update(**kwargs)

    
        self.interface.query(query=self.selection, select=True)

        self.logger.debug('Selection set %s', str(self.selection))
        
        if self.instance_count == 0:
            msg = 'No instances found for selection {0}'
            warnings.warn(msg.format(self.selection))
        
        self.__tag_names = None
        
        return self

    def refresh(self):
        """
        Refresh the local content of the orthanc server. Needed when for
        example new studies were added. SimpleOrthanc will not automatically detect
        changes on the server.

        Returns
        -------
        Orthanc.

        """
        
        self.interface.refresh()
        self.reset()
        if self.selection:
            self.select(**self.selection)
        return self

    def reset(self, tag=None):
        """
        Reset the current selection.

        Parameters
        ----------
        tag : String, optional
            If specified only this dicom tag will be removed from the current
            selection. The default is None.

        Returns
        -------
        TYPE
            DESCRIPTION.

        """

        self.logger.debug('Reset')
        if tag:
            if tag in self.selection.keys():
                self.selection.pop(tag)
                self.interface.reset()
                self.select(**self.selection)

        else:
            self._selection = None
            self.interface.reset()

        self.__tag_names = None
        return self


    @property
    def selection(self):
        """

        Current selection of items stored on the Orthanc Server.


        Returns
        -------
        dict
            Dictionary with keys the dicom tag names and values the dicom tag
            values of the current selection. e.g. {'PatientName': 'MyPatient'}.

        """

        if self._selection is None:
            self._selection = {}
        return self._selection

    @selection.setter
    def selection(self, selection):
        if selection is None:
            self.reset()
        else:
            self.select(**selection)

    
            
    def _level_count(self, level):
        return len(getattr(self.interface.selected, str(level)))
        
    @property
    def instance_count(self):
        """

        Returns
        -------
        int
            Number of instances in the current selection.

        """
        return self._level_count(INSTANCE_LEVEL)

    @property
    def series_count(self):
        """

        Returns
        -------
        int
            Number of series in the current selection.

        """
        return self._level_count(SERIES_LEVEL)

    @property
    def study_count(self):
        """

        Returns
        -------
        int
            Number of studies in the current selection.

        """
        return self._level_count(STUDY_LEVEL)

    @property
    def patient_count(self):
        """

        Returns
        -------
        int
            Number of patients in the current selection.

        """
        return self._level_count(PATIENT_LEVEL)


    def get_dicom_tag(self, tag, unique=True):
        """

        Get all dicom tag values in current selection. It may take some time
        if tag is not a main dicom tag. For non main dicom tags all dicom
        files header have to be read by the server. Main dicom tags are
        quickly obtained form the databas. 

        Parameters
        ----------
        tag : String
            Dicom tag name.
       
        unique : TYPE, optional
            Return only  unique values. The default is True. If unique is set 
            to True, the order of the values will be the same for each dicom 
            tag.

        Raises
        ------
        IndexError
            Tag not in current selection.

        Returns
        -------
        values : list, str
            List of values for each instance in the current selection. If
            unique is True, a single unique entry is reduced to a string.

        """
        
        if isinstance(tag, str):
             tag = OrthancDicomTag(tag)
        

        if self.series_count > 1 or unique:
             values = self.interface.get_dicom_tag(tag, unique=True)
        else:       
            values = self.interface.get_dicom_tag(tag, unique=False)
            
        values = [safe_parse_dicom_value(value, tag.vr, tag.vm) for value in values]
             
        return values




# =============================================================================
#  File I/O
# =============================================================================

    def upload_folder(self, folder, test_dicom=True, recursive=False):
        """
        Upload all files in a given folder to the orthanc server.

        Parameters
        ----------
        folder : string
            Folder to upload.
        test_dicom : Bool, optional
            If true files are tested if they are dicom before upload by trying
            to read the header with pydicom. Might slow down somewhat.
            The default is True.
        recursive : Bool, optional
            Find files recursively in given folder. The default is False.

        Returns
        -------
        None.

        """
        folder = os.path.abspath(folder)

        if recursive:
            files = [os.path.join(dp, f) for dp, dn, filenames \
                     in os.walk(folder) for f in filenames]
        else:
            files = os.listdir(folder)
            files = [os.path.join(folder, file) for file in files]
            files = [file for file in files if not os.path.isdir(file)]


        self.upload_file(files, test_dicom=test_dicom)

    def upload_pydicom_dataset(self, dataset):
        """
        Upload a pydicom dataset ot the orthanc server

        Parameters
        ----------
        dataset : pydicom Dataset (header and pixel_array) or a list of
        pydicom Datasets
            

        """
        
        type_error = 'Unknown type {0}, pydicom dataset expected!'
        if isinstance(dataset, pydicom.Dataset):
            dataset =[dataset]
        elif isinstance(dataset, (list, tuple)):
            pass
        else:
            raise TypeError(type_error.format(type(dataset)))
        
        folder = tempfile.mkdtemp(suffix='orthanc')
        
        for dsi in show_progress(dataset):
            if not isinstance(dsi, pydicom.Dataset):
                raise TypeError(type_error.format(type(dsi)))

            if hasattr(dsi, 'filename') and dsi.filename not in (None, ''):
                file = dsi.filename
            else:
                file = str(uuid.uuid4()) + '.dcm'
                
            dcm_file = os.path.join(folder, file) 

            pydicom.write_file(dcm_file, dsi)
            self.upload_file(dcm_file, test_dicom=False)
            try:
                os.remove(dcm_file)
            except:
                print('Failed to remove temp file {0}'.format(dcm_file))


    def upload_file(self, file, test_dicom=True, _refresh=True):
        """
        Upload a single for or a list of files to the orthanc server.

        Parameters
        ----------
        file : string or list
            File or list of files to upload.

        test_dicom : Bool, optional
            If true files are tested if they are dicom before upload by trying
            to read the header with pydicom. Might slow down somewhat.

        Returns
        -------
        None.

        """

        if isinstance(file, (list, tuple)):           
            for fi in show_progress(file):
                self.upload_file(fi, test_dicom=test_dicom, _refresh=False)
            if _refresh:
                self.refresh()
            return

        if test_dicom:
            try:
                _ = pydicom.read_file(file, stop_before_pixels=True)
            except:
                self.logger.error('File {0} is not dicom'.format(file))


        self.api.post_file(file)
        
        if _refresh:
            self.refresh()


    def download(self, folder=None):
        """
        Download all files in current selection to a folder.

        Parameters
        ----------
        folder : string, optional
            Folder to download to from orthanc server. If no folder is
            specified, files will be downloaded to a temp folder.
            The default is None.

        Returns
        -------
        files : list
            list of files with complete path that were downloaded.

        """

        if folder is None:
            folder = self._get_new_temp_folder()
        else:
            os.makedirs(folder, exist_ok=True)
        self.logger.info('Will download files to: %s', folder)
        files = []
        
        for instance_oid in show_progress(self.interface.selected.Instances):
            stream = self.api.get_stream_for_instance_oid(instance_oid)
            file = os.path.join(folder, instance_oid) + '.dcm'
            with open(file, 'wb') as out_file:
                self.logger.debug('Downloading %s', file)
                out_file.write(stream)
            files += [file]
        self.logger.info('%s files downloaded to %s', str(len(files)), folder)

        return files

# =============================================================================
#  Obtain full metadata from server
# =============================================================================

    def get_header(self, index=None, silent=True):
        """
        Return a single dicom header. If multiple instances are selected
        specify by index which header to obtain.

        Parameters
        ----------
        index : TYPE, optional
            
        silent : TYPE, optional
            If False warnings are shown for dicom tags that could not be 
            parsed. The default is True.

        Returns
        -------
        header : pydicom Dataset

        """
        if index is None:
            
            if self.instance_count == 1:
                index = 0
            else:
                self.raise_single_series()
                
        oid = self.interface.selected.Instances[index]
        dict_header = self.interface.get_header(oid)
        header = dict_to_pydicom(dict_header, silent=silent)
        return header

    def get_headers(self, index=None, silent=True):
        """
        Return pydicom headers for all instances in current selection.

        Returns
        -------
        headers : list
            list of pydicom datasets.

        """
        self.logger.info('Will read {0} headers..'.format(self.instance_count))
        
        dict_headers = self.interface.get_selected_headers()
        pydicom_headers = [dict_to_pydicom(dct, silent=silent)\
                           for dct in dict_headers]
        return pydicom_headers


    def delete_selected_patient(self):
        """
        Delete selected patient on orthanc server

        """
        if self.patient_count != 1:
            msg = '{0} Patients in selection, can only delete single patient'
            raise IndexError(msg.format(self.patient_count))
        self.api.delete_oid(oid=self.interface.Patients[0], level=PATIENT_LEVEL)
        
        self.reset()
        self.refresh()
            

    def delete_selected_study(self):
        """
        Delete selected study on orthanc server

        """
        if self.study_count != 1:
            msg = '{0} Studies in selection, can only delete single study'
            raise IndexError(msg.format(self.study_count))

        self.api.delete_oid(oid=self.interface.Studies[0], level=STUDY_LEVEL)
        self.reset()
        self.refresh()
        
    def delete_selected_serie(self):
        """
        Delete selected patient on orthanc server

        """
        if self.series_count > 1:
            msg = '{0} Studies in selection, can only delete single study'
            raise IndexError(msg.format(self.study_count))

        self.api.delete_oid(oid=self.interface.Series[0], level=SERIES_LEVEL)
        self.reset()
        self.refresh()

    @property
    def _temp_folder(self):
        # return root temp folder
        folder = os.path.join(tempfile.gettempdir(), 'SimpleOrthanc')
        os.makedirs(folder, exist_ok=True)
        return folder

    def _clear_temp(self):
        # remove temp folder
        shutil.rmtree(self._temp_folder, ignore_errors=True)

    def _get_new_temp_folder(self):
        # create a new temporary folder to store files
        # folders are numbered from 0
        def make_int(value):
            try:
                value = int(value)
            except ValueError:
                value = 0
            return value


        folder = self._temp_folder

        n = [int(subfolder) for subfolder in os.listdir(folder)]

        if len(n) == 0:
            n = [0]

        n = max(n) + 1

        new_temp_folder =  os.path.join(folder, str(n))

        os.makedirs(new_temp_folder)

        return new_temp_folder

    
    def get_array(self, apply_suv_rescale=True):            
        """
        Get the numpy array from the dicom files in the current selection.
        A single series must be selected. When a series has mulitple slices
        (instances) all slices are read. The array has shape MxN*S*c
        where M and N are the number of pixels, S the number of slices and
        c the number of color channels (1 (GrayScale), 3 (Color))

        Parameters
        ----------
        apply_suv_rescale : Bool, optional
            Use header information to scale the array to SUV values. 
            Works only if modality is PET or NM. The default is True.

       

        Returns
        -------
        arr : numpy.ndarray

        """
        if self.series_count == 0:
            raise IndexError('No series selected!')
            
        if self.series_count > 1:
            raise IndexError('Cannot load multiple series')
        
        if self.instance_count == 1:
            arr = self.interface.get_numpy(self.interface.selected.Instances[0])
        else:
            arr = self.interface.get_numpy(self.interface.selected.Series[0])
            
        return arr
    
    
    def raise_position_information(self):
        all_tags = self.get_all_dicom_tags()
        if 'ImagePositionPatient' not in all_tags:
            raise KeyError('Dicom header does not have the ImagePositionPatient tag')
        if 'ImageOrientationPatient' not in all_tags:
            raise KeyError('Dicom header does not have the ImageOrientationPatient tag')
            
    def raise_single_series(self):
        if self.series_count > 1:
            raise IndexError('Multiple Series selected. Selection should contain a single series')
        if self.series_count == 0:
            raise IndexError('No Series selected. Selection should contain a single series')
            




