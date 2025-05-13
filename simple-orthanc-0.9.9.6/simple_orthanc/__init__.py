# -*- coding: utf-8 -*-

#import constants


    
from simple_orthanc.constants import (ASCENDING, DESCENDING)



import simple_orthanc.logger
import simple_orthanc.constants
import simple_orthanc.dicom_tags
#from SimpleOrthanc.dicom_tags import MainDicomTags
from simple_orthanc.api import OrthancAPI
from simple_orthanc.interface import DicomLevels, OrthancInterface
from simple_orthanc.orthanc import Orthanc
from simple_orthanc.image import OrthancImage