
import json
import requests
from requests.auth import HTTPBasicAuth
from simple_orthanc.dicom_tags import INSTANCE_LEVEL, SERIES_LEVEL, STUDY_LEVEL, PATIENT_LEVEL
from simple_orthanc.logger import Logger


class OrthancAPI(Logger):
    """
    Construct and execute http requests for a defined orthanc server.
    """
    MAIN_DICOM_TAGS = 'MainDicomTags'
    PARENT = 'Parent'
    VERSION = 'Version'
    
    _LOG_LEVEL = Logger.LEVEL_ERROR
    _version = None
    _main_dicom_tags = None
    def __init__(self, host='127.0.0.1', port=8042,
                 username=None, password=None):
        """
        Specify ipaddress, port, username(optional) and password(optional) for
        an orthanc server.
        """
        super().__init__()

        self.host = host
        self.port = port
        self.server = 'http://{host}:{port}'.format(host=host, port=port)
        self.username = username
        self.password = password
        
        r = self.get_json(self.request_system())
        self.version = r[self.VERSION]
        if self.MAIN_DICOM_TAGS in r.keys():
            self.main_dicom_tags = r[self.MAIN_DICOM_TAGS]
        else:
            self.main_dicom_tags = self._default_main_dicomtags_response()
        
       
    @property
    def headers(self):
        """
        Headers to include in http requests.
        """
        headers = {'content-type' : 'application/dicom'}
        return headers

    @property
    def auth(self):
        """
        Return basic authentication header for set username and password.
        """

        if self.username is not None:
            auth = HTTPBasicAuth(self.username, self.password)
        else:
            auth = None

        return auth

    def request_peers(self):
        return '{server}/peers?expand'.format(server=self.server)

    def request_send(self, peer=''):
        return '{server}/peers/{peer}/store'.format(server=self.server, peer=peer)

    def request_level(self, level=None):
        """
        Construct request for a specific level (Patient, Study, Series, Instance)

        example:
        OrthancAPI().request_level(level='Series')

        Subsequent execution of the request will return all oids for all series
        """
        level = str(level).lower()
        return '{server}/{level}'.format(server=self.server, level=level)

    def request_query(self):
        """
        Construct a http dicom query.

        query: Dictionary with keys valid dicom tags

        example:
        OrthancAPI().request_query(query={'PatientName':' MyPatient'})
        """
        return '{server}/tools/find'.format(server=self.server)

    def request_oid(self, oid=None, level=None):
        """
        Construct a http request to retrieve metadata for a specific oid.

        example:
        OrthancAPI().request_oid(oid=my_oid, level='Series')

        Subsequent execution of the request will return all Dicom meta data for
        the given oid on series level.
        """

        level = str(level).lower()
        return '{server}/{level}/{oid}'.format(server=self.server,
                                               level=level, oid=oid)



    def request_file(self, instance_oid):
        """
        Construct http request to retrieve the contents of a dicom file

        example:
        OrthancAPI().request_file(instance_oid)

        Subsequent execution of the request will return the binary data for
        the dicom file that matches with the instance_oid.
        """
        req = '{server}/instances/{instance_oid}/file'
        return req.format(server=self.server, instance_oid=instance_oid)

    def request_simplified_tags(self, oid):
        """
        Request to obtain main dicom tags.
        """
        req = '{server}/instances/{instance_oid}/simplified-tags'
        return req.format(server=self.server, instance_oid=oid)

    def request_raw_tag(self, oid=None, tag=None):
        """
        Request to obtain a value from any dicom tag.
        """

        request = '{server}/instances/{oid}/content/{tag}/'
        return request.format(server=self.server, oid=oid, tag=tag)

    def request_available_tags(self, instance_oid):
        """
        Request to obtain available dicom tags for a single instance.
        """
        request = '{server}/instances/{oid}/content/'
        return request.format(server=self.server, oid=instance_oid)
    
    def request_numpy(self, oid, level):
        level = level.lower()
        request = '{server}/{level}/{oid}/numpy'
        return request.format(server=self.server, oid=oid, level=level)
    
    def request_system(self):
        return '{server}/system'.format(server=self.server)
    

    def post_file(self, file):
        """
        Upload a dicom file to orthanc.
        """

        with open(file, "rb") as fid:
            content = fid.read()

        self.logger.debug("Uploading %s", file)

        request = self.request_level(level=INSTANCE_LEVEL)

        return self.post(request, content)

    def send_oids(self, request, oids):
        if not isinstance(oids, str):
            oids = json.dumps(oids)
        return self.post(request, data=oids)

    def delete(self, request):
        """
        Execute http delete request for orthanc server.
        """
        msg = 'Executing delete %s.'
        self.logger.debug(msg, request)

        # requests.get(request, headers=self.headers, auth=self.auth,
        #                     data=data)
        r = requests.delete(request, headers=self.headers, auth=self.auth)
        r.raise_for_status()


    def get(self, request, data=None):
        """
        Execute http get request for the orthanc server
        """
        self.logger.debug('Executing get %s', request)
        r = requests.get(request, headers=self.headers, auth=self.auth,
                         data=data)
        r.raise_for_status()
        return r

    def post(self, request, data):
        """
        Execute http post request with data
        """
        msg = 'Executing post %s with data %s'
        self.logger.debug(msg, request, data)
        r = requests.post(request, data=data, headers=self.headers,
                             auth=self.auth)
        r.raise_for_status()
        return r

    def get_json(self, request):
        """
        Execute get request and return response as json.
        """
        return self.get(request).json()

    def post_json(self, request, data):
        """
        Execute post request and return response as json.
        """

        return self.post(request, data).json()

    def get_stream(self, request):
        """
        Execute get request and return binary response.
        """
        return self.get(request).content

    def get_all_oids(self):
        """
        Get all oids on the Orthanc Server.
        """
        result = {}

        for level in [PATIENT_LEVEL, STUDY_LEVEL, SERIES_LEVEL, INSTANCE_LEVEL]:
            request = self.request_level(level)
            result[str(level)] = self.get_json(request)

        return result

    def delete_oid(self, oid, level=None):
        """
        Delete item by oid from Orthanc server.
        """
        request = self.request_oid(oid=oid, level=level)
        return self.delete(request)

    def get_stream_for_instance_oid(self, instance_oid):
        # request file content for a specific instance oid
        request = self.request_file(instance_oid)
        result = self.get_stream(request)
        return result

    def get_simplified_tags(self, instance_oid):
        response = self.get(self.request_simplified_tags(instance_oid))
        return response.json()

    def get_tag(self, instance_oid=None, tag=None):
        request = self.request_raw_tag(oid=instance_oid, tag=tag)
        result = self.get(request).content
        result = self.decode_tag_request(result)
        if result == '':
            if tag not in self.get_simplified_tags(instance_oid).keys():
                raise KeyError('Instance doesn''t have Tag {0}'.format(tag))
        return result

    def json_for_oid(self, level=None, oid=None):
        # return json data for a specific oid and level
        request = self.request_oid(oid=oid, level=level)

        result = self.get_json(request)
        return result
    @staticmethod
    def _default_main_dicomtags_response():
        return {'Instance': ('0008,0012;0008,0013;0008,0018;0020,0012;'
                             '0020,0013;0020,0032;0020,0037;0020,0100;'
                             '0020,4000;0028,0008;0054,1330'),
                'Patient': '0010,0010;0010,0020;0010,0030;0010,0040;0010,1000',
                'Series': ('0008,0021;0008,0031;0008,0060;0008,0070;0008,1010;'
                          '0008,103e;0008,1070;0018,0010;0018,0015;0018,0024;'
                          '0018,1030;0018,1090;0018,1400;0020,000e;0020,0011;'
                          '0020,0037;0020,0105;0020,1002;0040,0254;0054,0081;'
                          '0054,0101;0054,1000'),
                'Study': ('0008,0020;0008,0030;0008,0050;0008,0080;0008,0090;'
                          '0008,1030;0020,000d;0020,0010;0032,1032;0032,1060')}
    @staticmethod
    def decode_tag_request(result):
        if hasattr(result, 'decode'):
            result = result.decode()
        if isinstance(result, str):
            result = result.strip()
        return result
