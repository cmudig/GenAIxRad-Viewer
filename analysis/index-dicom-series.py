"""Index allowlisted local DICOM headers without reading pixels or patient tags.

Requires pydicom. Output is private local linkage metadata, not anonymized data.
"""

import json
import sys
import warnings
from pathlib import Path

import pydicom


def main():
    downloads = Path.home() / "Downloads"
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else downloads / "trajectory-dicom-series.json"
    allowed = {"620043239794181", "678543127898756"}
    tags = ["StudyInstanceUID", "SeriesInstanceUID", "SeriesDescription", "SeriesNumber", "Modality"]
    groups = {}
    scanned = unreadable = missing_ids = excluded = missing_folders = 0
    # These exports use short numeric UIDs that pydicom warns are non-standard.
    # Preserve the exact strings for linkage; do not normalize or replace them.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="pydicom")
        for expected_uid in sorted(allowed):
            folder = downloads / f"{expected_uid} Generated Patient {expected_uid}"
            if not folder.is_dir():
                missing_folders += 1
                continue
            for file in folder.rglob("*"):
                if not file.is_file() or file.suffix.lower() != ".dcm":
                    continue
                scanned += 1
                try:
                    ds = pydicom.dcmread(file, stop_before_pixels=True, specific_tags=tags)
                    study_uid = str(ds.get("StudyInstanceUID", ""))
                    series_uid = str(ds.get("SeriesInstanceUID", ""))
                    if not study_uid or not series_uid:
                        missing_ids += 1
                        continue
                    if study_uid not in allowed:
                        excluded += 1
                        continue
                    key = (study_uid, series_uid)
                    group = groups.setdefault(key, {
                        "studyUID": study_uid, "seriesUID": series_uid,
                        "descriptions": set(), "modalities": set(), "seriesNumbers": set(),
                        "fileCount": 0,
                    })
                    group["fileCount"] += 1
                    for field, tag in [("descriptions", "SeriesDescription"), ("modalities", "Modality"), ("seriesNumbers", "SeriesNumber")]:
                        value = str(ds.get(tag, "")).strip()
                        if value:
                            group[field].add(value)
                except Exception:
                    unreadable += 1
    series = [{key: sorted(value) if isinstance(value, set) else value for key, value in group.items()}
              for _, group in sorted(groups.items())]
    summary = {"scannedFiles": scanned, "unreadableFiles": unreadable,
               "missingUIDFiles": missing_ids, "excludedStudyFiles": excluded,
               "missingFolders": missing_folders, "indexedSeries": len(series)}
    output.write_text(json.dumps({"summary": summary, "series": series}, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Private series index saved to {output}")


if __name__ == "__main__":
    main()
