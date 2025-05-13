import pydicom
import numpy as np
from simple_orthanc import Orthanc

try:
    import SimpleITK as sitk
    import sitktools
except ImportError:
    sitk = None
    
try:
    import simple_slice_viewer as ssv
except ImportError:
    ssv = None
    
# Functions and objects related to correct reading of dicom to a (3D) np array
# or (3D) SimpleITK image. RescaleSlope and Intercept are applied. PET SUV
# scaling when requested. For SimpleITK images the correct geometry is read
# from ImagePositionPatient and ImageOrientationPatient.

# (!) Functions are tested on a limited set of dicom images and modalities.
# Mainly PET, CT and some simple MR images (!)

IMAGEPOSITIONPATIENT = 'ImagePositionPatient'
IMAGEORIENTATIONPATIENT = 'ImageOrientationPatient'

class OrthancImage(Orthanc):
    # extension for the orthanc class to read images directly
    
    
# =============================================================================
#     Obtain image data from server
# =============================================================================
    def __init__(self, *args, **kwargs):
        if sitktools is None or sitk is None:
            raise ImportError('Need sitktools ans SimpleITK package for OrthancImage')
        
        
        super().__init__(*args, **kwargs)
        
    def get_array(self, apply_suv_rescale=True):   
        array = super().get_array()
        if apply_suv_rescale:
            array = self._apply_suv_rescale(array)
        return array
        
    def sort_slices(self):
        """
        Sort instances by slice location. Works when a single series is 
        selected. ImagePositionPatient and ImageOrientation must be in the
        dicom header. 
        
        After sorting each successive property that is accessed will be in the
        sorted order. e.g. get_headers(), the order of the file list that is
        returned after download. 

        Returns
        -------
        TYPE
            Orthanc Object

        """
        
        self.raise_position_information()
        self.raise_single_series()
            
        positions = self.get_dicom_tag(IMAGEPOSITIONPATIENT, unique=False)
        orientation = self.get_dicom_tag(IMAGEORIENTATIONPATIENT)[0]

        _, sequence = sitktools.sitk_from_array.arg_sort_positions(positions, orientation)
                                                
        oids = self.interface.selected.Instances
        sorted_oids = [oids[i] for i in sequence]
        self.interface.selected.Instances = sorted_oids
        return self

    def get_image(self, apply_suv_rescale=True):
        """
        Return sitk image for current selection.

        Raises
        ------
        IndexError
            Raised when multiple series are in current selection.

        Returns
        -------
        image : SimpleITK Image

        """

        if self.series_count != 1:
            msg = 'Can only read a single series, {0} series selected'
            raise IndexError(msg.format(self.series_count))

        if self.interface.supports_numpy:
            image = self.get_image_from_server()
        else:
            image = self.get_image_from_download()

        return image
    
    def _apply_suv_rescale(self, im_array):
        header = self.get_header(index=0)
        if header.Modality != 'PT':
            return im_array
    
        im_array *= sitktools.suv_scale_factor(header)
        
        return im_array
            
    def get_image_from_download(self, apply_suv_rescale=True):        
        files = self.download() 
        image = sitktools.read_files(files, SUV=apply_suv_rescale)
        return image
        
    def get_image_from_server(self, apply_suv_rescale=True):
        arr = self.get_array(apply_suv_rescale=apply_suv_rescale)
            
        all_tags = self.get_all_dicom_tags()
        
        for tag in ('ImagePositionPatient', 'ImageOrientationPatient',
                    'PixelSpacing'):
            if tag not in all_tags:
                raise KeyError(f'Dicom header does not have the {tag} tag')
                
        position    = self.get_dicom_tag('ImagePositionPatient', unique=False)
        orientation = self.ImageOrientationPatient[0]
        spacing     = self.PixelSpacing[0]
        
        image  = sitktools.sitk_from_array.array_to_sitk(arr, position, orientation, spacing)
        return image
    
    def display(self, apply_suv_rescale=True):
        if ssv is None:
            raise ImportError('SimpleSliceViewer not installed!')
        image = self.get_image(apply_suv_rescale=apply_suv_rescale)
        ssv.display(image)



    
