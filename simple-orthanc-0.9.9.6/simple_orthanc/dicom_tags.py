from simple_orthanc.constants import UNKNOWN
import pydicom
#from dataclasses import dataclass
from pydicom import Dataset
from dateutil import parser
from datetime import datetime, timedelta
    


class DicomLevel:
    _HIARCHY = ['Patients', 'Studies', 'Series', 'Instances']
    
    _PLURAL_TO_SINGULAR = {'Patients':  'Patient',
                          'Studies':   'Study',
                          'Series':    'Series',
                          'Instances': 'Instance'}
    
    _SINGULAR_TO_PLURAL = {'Patient':  'Patients',
                          'Study':   'Studies',
                         ' Serie':    'Series',
                          'Instance': 'Instances'}
    
    def __init__(self, level):
        self._level = level
    
    @property
    def level(self):
        return self._level
    
    @level.setter
    def level(self, value):
        self._level = value
    
    
    @property
    def levels(self):
        return [DicomLevel(level) for level in self._HIARCHY]
    
    @property
    def child_level(self):
        level_num = int(self) + 1
        if level_num >= len(self.levels):
            return None
        else:
            return self.levels[level_num]
    @property
    def parent_level(self):
        level_num = int(self) - 1
        if level_num < 0:
            return None
        else:
            return self.levels[level_num]
    @property
    def parent_levels(self):
        return [level for level in self.levels if int(level) < int(self)]    

    @property
    def child_levels(self):
        return [level for level in self.levels if int(level) > int(self)]    
        
    def _format_other(self, other):
        if isinstance(other, DicomLevel):
            pass
        elif isinstance(other, str):
            other = DicomLevel(other)
        else:
            raise TypeError()
        return other
    
    def __hash__(self):
        return str(self).__hash__()
    
    def __gt__(self, other):
        other = self._format_other(other)
        return int(self) < int(other)
    
    def __ge__(self, other):
        other = self._format_other(other)
        return int(self) <= int(other)
    
    
    def __lt__(self, other):
        other = self._format_other(other)
        return int(self) > int(other)
    
    def __le__(self, other):
        other = self._format_other(other)
        return int(self) >= int(other)
    
    def __int__(self):
        return [str(self) == level for level in self._HIARCHY].index(True)
    
    def __eq__(self, other):        
        return int(self) == int(self._format_other(other))
    
    def __str__(self):
        return self._plural_level_name
    
    def __repr__(self):
        return self.__str__()
    
    @property
    def _plural_level_name(self):
        if self.level in self._PLURAL_TO_SINGULAR.keys():
            return self.level
        else:
            return self._SINGULAR_TO_PLURAL[self.level]
        
    @property
    def singular(self):
        if self.level in self._SINGULAR_TO_PLURAL.keys():
            return self.level
        else:
            return self._PLURAL_TO_SINGULAR[self.level]
        
    # @property
    # def tags(self):
    #     factory = lambda tagnames: [OrthancDicomTag(name) for name in tagnames]
    #     if self == PATIENT_LEVEL:
    #         return factory(MAIN_PATIENT_TAGS)
    #     elif self == STUDY_LEVEL:
    #         return factory(MAIN_STUDY_TAGS)
    #     elif self==SERIES_LEVEL:
    #         return factory(MAIN_SERIES_TAGS)
    #     elif self==INSTANCE_LEVEL:
    #         return factory(MAIN_INSTANCE_TAGS)
    #     else:
    #         raise KeyError()
        
    @staticmethod
    def lowest_child_level(levels):
        return [level for level in levels if int(level) == max([int(li) for li in levels])][0]
    
    @staticmethod
    def highest_parent_level(levels):
        return [level for level in levels if int(level) == min([int(li) for li in levels])][0]

PATIENT_LEVEL = DicomLevel('Patient')
STUDY_LEVEL = DicomLevel('Study')
SERIES_LEVEL = DicomLevel('Series')
INSTANCE_LEVEL = DicomLevel('Instance')

# class TagStruct:    
#     def __init__(self, tagnames=None, level=None):
#         if level is None:
#             level = DicomLevel('Instance')
#         if tagnames is None:
#             tagnames = []
        
#         self.level = level
#         self.tags = [OrthancDicomTag(tagname) for tagname in tagnames]
#         super().__init__()
        
#     @property
#     def tagnames(self):
#         return [str(item) for item in self.tags]

#     def __dir__(self):
#         return super().__dir__() + self.tagnames
    
#     def __getattr__(self, attr):
#         if attr in self.tagnames:
#             return [item for item in self.tags if item.tagname==attr][0]
#         else:
#             raise AttributeError(attr)
    
#     def __iter__(self):
#         return self.tagnames.__iter__()
    
#     def __next__(self):
#         return self.tagnames.__next__()
        



class OrthancDicomTag():    
    PYDICOM_TAGNAMES = [value[4] for value in pydicom.datadict.DicomDictionary.values()]

    def __init__(self, tagname=''):
        self.tagname = tagname
    
    def __str__(self):
        return self.tagname
    
    def __repr__(self):
        return self.__str__()
    
    def __hash__(self):
        return self.pydicom_tag.__hash__()
    
    def __gt__(self, other):
        if isinstance(other, str):
            other = OrthancDicomTag(other)
        if isinstance(other, OrthancDicomTag):
            return self.tagname > other.tagname
        else:
            raise TypeError
            
    def __eq__(self, other):
        if isinstance(other, str):
            other = OrthancDicomTag(other)
        if isinstance(other, OrthancDicomTag):
            return self.tagname == other.tagname
        else:
            raise TypeError(type(other))
    
    def __lt__(self, other):
        if isinstance(other, str):
            other = OrthancDicomTag(other)
        if isinstance(other, OrthancDicomTag):
            return self.tagname < other.tagname
        else:
            raise TypeError
    
    @property
    def vr(self):
        return pydicom.datadict.dictionary_VR(self.pydicom_tag)
    
    @property
    def vm(self):
        return pydicom.datadict.dictionary_VM(self.pydicom_tag)
    
    @property
    def is_sequence(self):
        return self.vr == 'SQ'
    
    @property
    def orthanc_tag(self):
        return self.pydicom_to_orthanc_tag(self.pydicom_tag)
        
    @property
    def pydicom_tag(self):
        return pydicom.datadict.tag_for_keyword(self.tagname)
    
    @staticmethod
    def pydicom_to_orthanc_tag(tag):
        ptag = pydicom.tag.BaseTag(tag)
        grp = str(hex(ptag.group)).replace('0x', '')
        elem = str(hex(ptag.elem)).replace('0x', '')
        grp = '0'*(4-len(grp)) + grp
        elem = '0'*(4-len(elem)) + elem
        tag =  grp + '-' + elem
        return tag
    
    @classmethod
    def from_pydicom_tag(cls, tag):
        tagname = pydicom.datadict.keyword_for_tag(tag)
        return cls(tagname)
    
    @classmethod
    def from_orthanc_tag(cls, tag):
        tag = tag.replace('-', '')
        tag = tag.replace(',', '')
        tag = int(tag, 16)
        tagname = pydicom.datadict.keyword_for_tag(tag)
        return cls(tagname=tagname)
    

def _format_tags(json_dict):
    formatted = {}
    for key, value in json_dict.items():
        tag = OrthancDicomTag(key)
        if isinstance(value, list):
            formatted[tag] = [_format_tags(di) for di in value]
        else:
            formatted[tag] = value
    return formatted


def safe_parse_dicom_value(str_value, vr, vm='1'):
    if str_value is UNKNOWN:
        return None
    try:
        return parse_dicom_value(str_value, vr, vm)
    except:
        print(f'Could not parse {str_value} with VR: {vr} and VM: {vm}')
        return None

def parse_dicom_value(str_value, vr, vm='1', parse_date_time=False):
    vr = vr.upper()
    if vm != '1' and '\\' in str_value:
        return [parse_dicom_value(vi, vr, '1') for vi in str_value.split('\\')]
    
    if vr == 'AS':
        if not parse_date_time:
            return str_value
        # AS = 'nnnDWMY' D=days, W=weeks, M=months, Y=years
        # Calculate number of days
        
        dwmy = str_value[-1].upper()
        days_per_year = 365.2425
        if dwmy == 'D':
            mult = 1
        if dwmy == 'W':
            mult = 7
        if dwmy == 'M':
            mult = days_per_year / 12
        if dwmy == 'Y':
            mult = days_per_year
        
        return int(str_value[:-1]) * mult
    elif vr == 'DA':
        if not parse_date_time:
            return str_value
        # DA = 'YYYYMMDD'
        return parser.parse(str_value)
    
    elif vr == 'TM':
        if not parse_date_time:
            return str_value
        if '.' in str_value:
            str_value, frac_seconds = str_value.split('.')
        else:
            frac_seconds = '0'
        
        frac_seconds = float('0.' + frac_seconds)
        
        time = datetime.strptime(str_value, '%H%M%S')
        time += timedelta(seconds=frac_seconds)
        return time.time()

    elif vr == 'DT':
        if not parse_date_time:
            return str_value
        # DT = 'YYYYMMDDHHMMSS.FFFFFF&ZZXX'
        # ignore

        if '.' in str_value:
            dtstr, remainder = str_value.split('.')
            if '+' in remainder:
                frac_seconds, timezone = remainder.split('+')
                timezone = '+' + timezone
            elif '-' in remainder:
                frac_seconds, timezone = remainder.split('-')
                timezone = '-' + timezone
            else:
                frac_seconds = remainder
                timezone = None
        else:
            dtstr = str_value
            frac_seconds = '0'
            timezone = None
        
        frac_seconds = '0.' + frac_seconds

        if timezone is not None:
            hours       = timezone[1:3]
            minutes     = timezone[3:5]
            dtstr       += (timezone[0] + hours + ':' + minutes)
  
       
        dt = parser.parse(dtstr)
        dt += timedelta(seconds=float(frac_seconds))    
        return dt
    
    elif vr in ('AE', 'LT', 'PN', 'LT', 'SH', 'ST', 'UC', 'UI', 'UT', 'LO'):
        # actual strings
        return str_value.strip('\x00')
    elif vr in ('DS', 'FL', 'FD', 'OD', 'OF'):
        return float(str_value)
    elif vr in ('IS', 'OL', 'SL', 'SS', 'UL', 'US'):
        return int(str_value)
    elif vr in ('OB', 'OW', 'SQ', 'UN', 'UR', 'CS'):
        # Don't do anything with these VRs
        return str_value
        # raise TypeError(f'Cannot get a parsed value from VR: {vr}')
        
    else:
        raise TypeError(f'Unknown DICOM VR {vr}')



def dict_to_pydicom(orthanc_dict, ds=None, silent=True):
    if ds is None:
        ds = pydicom.Dataset()
    for key, value in orthanc_dict.items():
        key = OrthancDicomTag(key)
        tag = key.pydicom_tag
        
        
        if tag is None:
            if not silent:
                print(f'Could not parse dicom tag: {key}')
            continue
        
        vr = key.vr
        
        if key.is_sequence:
            nvalues = len(value)
            sq = pydicom.Sequence([Dataset() for i in range(0, nvalues)])
            ds[tag] = pydicom.DataElement(key.pydicom_tag, VR=vr, value=sq)
            for i in range(0, nvalues):
                dict_to_pydicom(value[i], ds=ds[tag][i], silent=silent)
        else:
            ds[tag] = pydicom.DataElement(key.pydicom_tag, vr, value)
    return ds
            
            