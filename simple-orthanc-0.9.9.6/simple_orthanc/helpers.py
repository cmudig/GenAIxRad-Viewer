import json
from tqdm import tqdm
from simple_orthanc.constants import SHOW_PROGRESS_BAR_COUNT

def show_progress(iterable, count=SHOW_PROGRESS_BAR_COUNT):
    if len(iterable) <= count:
        return iterable
    else:
        return tqdm(iterable)

def deep_equal(item1, item2):
    return json.dumps(item1) == json.dumps(item2)
