import logging

DEFAULT_LOG_LEVEL = logging.ERROR

class Logger():
    _logger = None
    _APP_NAME = 'Application'
    _LOG_FILE = None
    _LOG_LEVEL = DEFAULT_LOG_LEVEL
    _LOG_TO_CONSOLE = True
    _LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

    LEVEL_DEBUG = logging.DEBUG
    LEVEL_INFO  = logging.INFO
    LEVEL_ERROR = logging.ERROR

    def __init__(self, log_level =  None, app_name = None):
        if log_level is not None:
            self._LOG_LEVEL = log_level
        if app_name is not None:
            self._APP_NAME = app_name
        else:
            self._APP_NAME = self.__class__.__name__
        self.logger.setLevel(self._LOG_LEVEL)
    @property
    def logger(self):
        if self._logger is None:
            self._logger = applogger(self._APP_NAME,
                                     fname = self._LOG_FILE,
                                     log_level = self._LOG_LEVEL,
                                     log_to_console = self._LOG_TO_CONSOLE,
                                     log_format = self._LOG_FORMAT)
        return self._logger


def applogger(app_name, fname = None, log_level = DEFAULT_LOG_LEVEL,
                       log_to_console = True, log_format = None):
  """ Create a simple logger object for a specific application name (app_name).
      log_level and log_to_console can be set. Log to file is done when fname
      is a valid filename """
  logger = logging.getLogger(app_name)
  logger.setLevel(log_level)
  logger.handlers = []
  # create file handler which logs even debug messages
  if log_format is None:
      log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
  formatter = logging.Formatter(log_format)

  if not(fname is None):
    fh = logging.FileHandler(fname)
    fh.setLevel(log_level)
    fh.setFormatter(formatter)
    logger.addHandler(fh)

  if log_to_console:
    ch = logging.StreamHandler()
    ch.setLevel(log_level)
    ch.setFormatter(formatter)
    logger.addHandler(ch)

  return logger
