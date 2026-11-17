"""Private manifest builder and allowlisted pixel worker. Never serves DICOM files."""

import base64
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import sys
import warnings

import numpy as np
import pydicom
from pydicom.pixels import apply_modality_lut

warnings.filterwarnings("ignore", category=UserWarning, module="pydicom")
ALLOWED = {"678543127898756", "620043239794181"}
ROOTS = [(Path.home() / "Downloads" / f"{uid} Generated Patient {uid}").resolve() for uid in sorted(ALLOWED)]


def safe_path(value):
    file = Path(value).resolve(strict=True)
    if not any(file.is_relative_to(root) for root in ROOTS) or not file.is_file() or file.suffix.lower() != ".dcm":
        raise ValueError("File outside local DICOM allowlist")
    return file


def build_index(private):
    frozen = json.loads((private / "targets.json").read_text())
    wanted = {(c["studyUID"], c["seriesUID"]): c for c in frozen["cases"]}
    if len(wanted) != 28 or any(k[0] not in ALLOWED for k in wanted):
        raise ValueError("Invalid target allowlist")
    groups = {k: [] for k in wanted}
    seen_sop = set()
    tags = ["StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID", "InstanceNumber", "ImagePositionPatient", "ImageOrientationPatient", "NumberOfFrames"]
    for root in ROOTS:
        if not root.is_dir():
            raise ValueError("Required source folder missing")
        for file in sorted(root.rglob("*")):
            if not file.is_file() or file.suffix.lower() != ".dcm":
                continue
            ds = pydicom.dcmread(safe_path(file), stop_before_pixels=True, specific_tags=tags)
            key = (str(ds.get("StudyInstanceUID", "")), str(ds.get("SeriesInstanceUID", "")))
            if key not in wanted:
                continue
            sop = str(ds.get("SOPInstanceUID", ""))
            if not sop or sop in seen_sop:
                raise ValueError("Missing or duplicate SOP instance in selected sources")
            seen_sop.add(sop)
            orientation = [float(x) for x in ds.get("ImageOrientationPatient", [])]
            position = [float(x) for x in ds.get("ImagePositionPatient", [])]
            location = float(np.dot(np.cross(orientation[:3], orientation[3:]), position)) if len(orientation) == 6 and len(position) == 3 else None
            groups[key].append({"path": str(file.resolve()), "sop": sop, "location": location, "instance": int(ds.get("InstanceNumber", 0)), "frames": int(ds.get("NumberOfFrames", 1)), "orientation": orientation})
    cases = []
    for key, case in wanted.items():
        files = groups[key]
        if len(files) != case["expectedFiles"] or not files:
            raise ValueError("Local file count differs from frozen index")
        geometric = all(f["location"] is not None and np.allclose(f["orientation"], files[0]["orientation"], atol=0.001) for f in files)
        files.sort(key=lambda f: (f["location"] if geometric else f["instance"], f["sop"]))
        frames = [{"path": f["path"], "frame": i, "sop": f["sop"]} for f in files for i in range(f["frames"])]
        cases.append({**case, "ordering": "patient-plane-position" if geometric else "instance-number-fallback", "frames": frames})
    manifest = {"version": 1, "provenance": frozen, "cases": cases}
    output = private / "manifest.json"
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(manifest, stream, indent=2)
    print(json.dumps({"cases": len(cases), "frames": sum(len(c["frames"]) for c in cases), "orderingFallbacks": sum(c["ordering"] != "patient-plane-position" for c in cases)}))


@lru_cache(maxsize=4)
def read_pixels(file):
    ds = pydicom.dcmread(safe_path(file))
    if "PerFrameFunctionalGroupsSequence" in ds or "SharedFunctionalGroupsSequence" in ds:
        raise ValueError("Enhanced per-frame transforms are unsupported")
    if str(ds.get("PhotometricInterpretation", "")) not in ("MONOCHROME1", "MONOCHROME2") or int(ds.get("SamplesPerPixel", 1)) != 1:
        raise ValueError("Unsupported non-monochrome pixel format")
    pixels = ds.pixel_array
    return ds, pixels


def render(case, index):
    frame = case["frames"][index]
    ds, pixels = read_pixels(frame["path"])
    if str(ds.StudyInstanceUID) != case["studyUID"] or str(ds.SeriesInstanceUID) != case["seriesUID"] or str(ds.SOPInstanceUID) != frame["sop"]:
        raise ValueError("Source identity changed after manifest freeze")
    image = pixels[frame["frame"]] if int(ds.get("NumberOfFrames", 1)) > 1 else pixels
    values = np.asarray(apply_modality_lut(image, ds), dtype="<f4")
    if values.ndim != 2 or not np.isfinite(values).all():
        raise ValueError("Invalid pixel dimensions or non-finite values")
    low, high = float(values.min()), float(values.max())

    def first_number(tag, fallback):
        value = ds.get(tag, fallback)
        if not isinstance(value, (str, float, int)):
            value = value[0]
        number = float(value)
        return number if math.isfinite(number) else fallback

    spacing = [float(v) for v in ds.get("PixelSpacing", [1, 1])]
    if len(spacing) != 2 or any(not math.isfinite(v) or v <= 0 for v in spacing):
        spacing = [1, 1]
    metadata = {"rows": values.shape[0], "columns": values.shape[1], "center": first_number("WindowCenter", (low + high) / 2), "width": max(1, first_number("WindowWidth", high - low)), "invert": str(ds.PhotometricInterpretation) == "MONOCHROME1", "spacing": spacing, "minimum": low, "maximum": high}
    return values, metadata


def main():
    mode, directory = sys.argv[1:3]
    private = Path(directory).resolve()
    if mode == "--index":
        build_index(private)
        return
    manifest = json.loads((private / "manifest.json").read_text())
    cases = {c["id"]: c for c in manifest["cases"]}
    if mode == "--validate":
        total = errors = 0
        for case in cases.values():
            failures = 0
            for i in range(len(case["frames"])):
                try:
                    render(case, i)
                except Exception:
                    failures += 1
                total += 1
            errors += failures
            print(json.dumps({"case": case["id"], "frames": len(case["frames"]), "decodeErrors": failures}), flush=True)
        print(json.dumps({"totalFrames": total, "decodeErrors": errors}))
        sys.exit(1 if errors else 0)
    if mode != "--worker":
        raise ValueError("Unknown mode")
    for line in sys.stdin:
        try:
            request = json.loads(line)
            case = cases[request["case"]]
            index = request["index"]
            if type(index) is not int or not 0 <= index < len(case["frames"]):
                raise ValueError("Unknown frame")
            values, metadata = render(case, index)
            result = {"ok": True, "metadata": metadata, "pixels": base64.b64encode(values.tobytes()).decode("ascii")}
        except Exception:
            # Never return filesystem paths or DICOM tags to the browser.
            result = {"ok": False, "error": "Local image decode failed. Source may be unsupported, missing, or changed."}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
