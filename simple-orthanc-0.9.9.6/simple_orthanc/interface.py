import numpy as np
from simple_orthanc.dicom_tags import INSTANCE_LEVEL, SERIES_LEVEL, STUDY_LEVEL, PATIENT_LEVEL, OrthancDicomTag
from simple_orthanc.constants import  UNKNOWN, PARENT, ID
from simple_orthanc.helpers import show_progress
import json
from copy import copy


from itertools import chain
import io


class DicomLevels:    
    def __init__(self, Patients=None, Studies=None, Series=None,
                 Instances=None):
        if Patients is None:
            Patients = []
        if Studies is None:
            Studies = []
        if Series is None:
            Series = []
        if Instances is None:
            Instances = []
            
        self.Patients = Patients
        self.Series = Series
        self.Studies = Studies
        self.Instances = Instances
            
    def __len__(self):
        return len(self.Patients) + len(self.Studies) + len(self.Series)\
            + len(self.Instances)
    
    def __iter__(self):
        return self.tolist().__iter__()
            
    def tolist(self):
        return self.Patients + self.Studies + self.Series + self.Instances
    
    def level(self, item):
        if item in self.Instances:
            return INSTANCE_LEVEL
        elif item in self.Series:
            return SERIES_LEVEL
        elif item in self.Studies:
            return STUDY_LEVEL
        elif item in self.Patients:
            return PATIENT_LEVEL
    def __str__(self):
        msg =\
            """
            Patients: {0}
            Studies: {1}
            Series: {2}
            Instances: {3}
            """
        return msg.format(self.Patients, self.Studies,
                          self.Series, self.Instances)
    
        
    
        
class OrthancInterface():
    """
    Class that keeps a cache of all orthanc oids and can interface a subset
    of oids (selection).
    """
    _index = None
    _selected = None
    _supports_numpy = None
    def __init__(self, api,  Patients=None, Studies=None,
                             Series=None, Instances=None):

        self.api = api
        self._generate_index()
        self.main_dicom_tags = self.get_main_dicom_tags()

    @property
    def supports_numpy(self):
        return self.api.version > '1.1.1'
    
    def get_main_dicom_tags(self):
        main_dicom_tags = DicomLevels()
        for level in (INSTANCE_LEVEL, SERIES_LEVEL, STUDY_LEVEL, PATIENT_LEVEL):
            tags = self.api.main_dicom_tags[level.singular].split(';')
            tags = [OrthancDicomTag.from_orthanc_tag(tag) for tag in tags]
            setattr(main_dicom_tags, str(level), tags)
        return main_dicom_tags
    
    def leveL_for_tag(self, tag):
        if tag in self.main_dicom_tags:
            return self.main_dicom_tags.level(tag)
        else:
            return INSTANCE_LEVEL
        
            
    def refresh(self):
        self._index = None
        self.reset()
    
    def reset(self):
        self._selected = None
        
    @property
    def index(self):
        # collection of all orthanc identifiers (oids) that are available
        # in Orthanc
        if self._index is None:
            self._generate_index()    
        return self._index
    
    def _generate_index(self):
        self._index = DicomLevels(**self.api.get_all_oids())
        
    @property
    def selected(self):
        # collection of orthanc identifiers that are selected by the user
        # property is set in the query method.
        if self._selected is None:
            # nothing selected all oids are in selection
            self._selected = copy(self.index)
        return self._selected

            
    def get_dicom_tag(self, tag, unique=True):
        # Return all values for a specific dicom tag for all selected 
        # Patients/Series/Studies/Instances on orthanc
        level = self.leveL_for_tag(tag)
        
        if isinstance(tag, str):
            tag = OrthancDicomTag(tag)
        
        if tag.is_sequence:
            values = self._get_dicom_sequence(tag, unique=unique)
            
        elif tag in self.main_dicom_tags and unique and level > INSTANCE_LEVEL:
            # limited set of tags that can be retrieved faster
            values = self._get_main_dicom_tag(tag)        
        else:
            # last resort get tag value for each instance
            values = self._get_instance_tag(tag)
            
        if unique:
            # Instances that do not have the tag will yield a UKNOWN value. When
            # unique is False keep the UKNOWN value to keep the 1-1 
            # correspondence between instances and values. If unique remove
            # UNKNOWN values.
            values = [value for value in values if value is not UNKNOWN]
            
        if not tag.is_sequence and unique:
            # preserve order when number of values won't change
            unique_values = list(set(values))
            if len(unique_values) < len(values):
                values = unique_values
        return values
    
    def _get_dicom_sequence(self, tag, unique=True):
        # Very Slow
        values = []

        for oid in show_progress(self.selected.Instances):
            all_tags = self.api.get_simplified_tags(oid)
            if str(tag) not in all_tags.keys():
                msg = 'Instance doesnt have Tag {0}'
                raise IndexError(msg.format(tag))
            values += [all_tags[str(tag)]]
        
        if unique:
            # convert sequences to json strings to select unique values
            values = list(set([json.dumps(value) for value in values]))
            values = [json.loads(value) for value in values]
        
        return values
    
    def _get_instance_tag(self, tag):
        values = []
        for oid in show_progress(self.selected.Instances):
            value = self.api.get_tag(instance_oid=oid, tag=str(tag))
            values += [value]
        return values
    
    def _get_main_dicom_tag(self, tag):
        level = self.leveL_for_tag(tag)
        oids = getattr(self.selected, str(level))
        
        values = []
        
        for oid in show_progress(oids):
            # requests are made for the specific dicom level. So
            # for PatientName there is no need to request the value of each
            # Instance
            request = self.api.request_oid(oid, level=str(level))
            response = self.api.get_json(request)
            if str(tag) in response[self.api.MAIN_DICOM_TAGS]:
                values += [response[self.api.MAIN_DICOM_TAGS][str(tag)]]
            else:
                values += [UNKNOWN]
        return values
    
    
    def get_header(self, instance_oid):
        request = self.api.request_simplified_tags(instance_oid)
        return self.api.get_json(request)
        
    def get_selected_headers(self):
        return [self.get_header(oid)\
                for oid in show_progress(self.selected.Instances)]
    
    def get_numpy(self, oid):
        if oid in self.index.Instances:
            level=str(INSTANCE_LEVEL)
        elif oid in self.index.Series:
            level=str(SERIES_LEVEL)
            
        request = self.api.request_numpy(oid, level=level)
        response = self.api.get(request)
        response.raise_for_status()
        image = np.load(io.BytesIO(response.content))
        return image
        
    
    def query(self, query=None, expand=True, select=True):
        # retrieve oids for a query and a specified level
        levels = [self.leveL_for_tag(tagname) for tagname in query.keys()]
        
        level = sorted(levels)[0]
        
    
        if level == PATIENT_LEVEL:
            level = STUDY_LEVEL
    
        data = {"Level": str(level), "Query": query, "Expand": expand}
    
        data = json.dumps(data)
        request = self.api.request_query()
        response = self.api.post_json(request, data)
        
        oids = self.decode_response(level, response)
        
        if select:
            self._selected = oids
        
        return oids
        
    
    def decode_response(self, level, response):
        oids = DicomLevels()
        if len(response) == 0:
            return oids
        if isinstance(response, list):
            if isinstance(response[0], dict):
                level_oids = [item[ID] for item in response]
            else:
                level_oids = response
                
            setattr(oids, str(level), level_oids)
    
        if level != PATIENT_LEVEL:
            key = level.parent_level.singular
            parent_key = PARENT + key
            
            parent_oids = [item[parent_key] for item in response]
            parent_oids = list(set(parent_oids))
            setattr(oids, str(level.parent_level), parent_oids)
    
        if level != INSTANCE_LEVEL:
            child_oids = []
            for item in response:
                coids = item[str(level.child_level)]
                if isinstance(coids, list):
                    child_oids += coids
                elif isinstance(coids, str):
                    child_oids += [coids]
            setattr(oids, str(level.child_level), child_oids)
            

        if level == INSTANCE_LEVEL:
            oids.Studies = self.get_parent_oids(oids.Series, SERIES_LEVEL)
    
        if level <= SERIES_LEVEL:
            oids.Patients = self.get_parent_oids(oids.Studies, STUDY_LEVEL)
            
        if level >= STUDY_LEVEL:
            oids.Instances = self.get_child_oids(oids.Series, SERIES_LEVEL)
        
        return oids
    
    def get_parent_oids(self, oid, level):
        if isinstance(oid, (list, tuple)):
            oids = [self.get_parent_oids(oii, level=level) for oii in oid]
            return list(set(oids))
        
        request = self.api.request_oid(oid=oid, level=level)
        data = self.api.get_json(request)
        parent_key = PARENT + str(level.parent_level.singular)
        return data[parent_key]
    
    def get_child_oids(self, oid, level):
        if isinstance(oid, (list, tuple)):
            oids = [self.get_child_oids(oii, level=level) for oii in oid]
            return list(set(chain(*oids)))
        
        request = self.api.request_oid(oid=oid, level=str(level))
        data = self.api.get_json(request)
        return data[level.child_level]
    
    


if __name__ == "__main__":
    pass
