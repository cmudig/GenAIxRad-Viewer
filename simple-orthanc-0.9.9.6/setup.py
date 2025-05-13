

from setuptools import setup, find_packages
README = 'README.md'

DESCRIPTION = 'Pythonic interface to access DICOM data on an Orthanc Server'
NAME = 'simple-orthanc'

VERSION = "0.9.9.6"

from pathlib import Path
this_directory = Path(__file__).parent


setup(name=NAME,
      version=VERSION,
      description=DESCRIPTION,
      long_description_content_type='text/markdown',
      classifiers=[
        'Development Status :: 3 - Alpha',
        'License :: OSI Approved :: MIT License',
        'Programming Language :: Python :: 3.6',
        'Topic :: Scientific/Engineering :: Medical Science Apps.',
        'Intended Audience :: Science/Research',
        'Natural Language :: English'
      ],
      keywords='image images orthanc simpleitk medical dicom',
      url='',
      author='M. Segbers',
      author_email='msegbers@gmail.com',
      license='MIT',
      packages=find_packages(),
      install_requires=[
          'pydicom',
          'pyyaml',
          'numpy',
          'requests',
          'python-dateutil',
          'tqdm',        
      ],
      extras_require={
          'SimpleITK': ['SimpleITK',
                        'sitktools @ git+https://gitlab.com/radiology/medical-physics/sitktools.git'
                        ],
          'Viewer': ['SimpleITK', 'simple-slice-viewer @ git+https://gitlab.com/radiology/medical-physics/simple-slice-viewer.git']
          },
         
      include_package_data=True,
      zip_safe=False)