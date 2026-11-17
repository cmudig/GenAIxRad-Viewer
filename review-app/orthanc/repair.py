"""Frozen-cohort file-meta repair. Preview by default; never rewrite source files.

Only native Part 10 transfer syntaxes are supported. The complete encoded dataset
is copied verbatim, not serialized by pydicom. Private reports contain paths/UIDs.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import wraps
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import uuid
import warnings

import pydicom
from pydicom.pixels.utils import get_expected_length
from pydicom.uid import UID


HERE = Path(__file__).resolve().parent
NATIVE = {"1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"}
LONG_VR = {b"OB", b"OD", b"OF", b"OL", b"OV", b"OW", b"SQ", b"UC", b"UR", b"UT", b"UN"}
DICOM_LOCK = threading.RLock()


def serialized_dicom(function):
    # catch_warnings changes global state on interpreters without context-aware
    # warnings. Serialize parsing, not network reads, to avoid leaked UID values.
    @wraps(function)
    def wrapped(*args, **kwargs):
        with DICOM_LOCK:
            return function(*args, **kwargs)
    return wrapped


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def meta_elements(raw):
    require(len(raw) > 144 and raw[128:132] == b"DICM", "Not a Part 10 file")
    offset, entries, seen = 132, [], set()
    while offset + 8 <= len(raw) and struct.unpack_from("<H", raw, offset)[0] == 2:
        start = offset
        _, element = struct.unpack_from("<HH", raw, offset)
        vr = raw[offset + 4:offset + 6]
        require(vr.isalpha() and vr.isupper(), "Invalid file-meta VR")
        header = 12 if vr in LONG_VR else 8
        require(offset + header <= len(raw), "Truncated file-meta header")
        size = struct.unpack_from("<I" if header == 12 else "<H", raw, offset + header - (4 if header == 12 else 2))[0]
        offset += header + size
        require(size != 0xFFFFFFFF and offset <= len(raw) and size % 2 == 0, "Truncated or invalid file-meta value")
        require(element not in seen, "Duplicate file-meta element")
        seen.add(element)
        entries.append((element, vr, raw[start:offset], raw[start + header:offset]))
    require(entries and entries[0][0] == 0 and entries[0][1] == b"UL", "Missing file-meta group length")
    require(len(entries[0][3]) == 4 and struct.unpack("<I", entries[0][3])[0] == sum(len(e[2]) for e in entries[1:]), "Invalid file-meta group length")
    require({2, 3, 0x10}.issubset(seen), "Missing file-meta identifiers")
    return entries, offset


@serialized_dicom
def repair_bytes(raw, frozen_identity=None):
    entries, offset = meta_elements(raw)
    # Parse all elements and reject parser warnings (including malformed/truncated
    # data), except the known frozen legacy study UID warning, checked separately.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        ds = pydicom.dcmread(io.BytesIO(raw))
        identity = {k: str(ds.get(k, "")) for k in ("StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID", "SOPClassUID")}
        syntax = str(ds.file_meta.get("TransferSyntaxUID", ""))
        for key in ("SOPInstanceUID", "SOPClassUID"):
            require(identity[key] and UID(identity[key]).is_valid, "Invalid or missing dataset identifier")
        require(identity["StudyInstanceUID"], "Missing dataset study identifier")
        require(identity["SeriesInstanceUID"], "Missing dataset series identifier")
        if frozen_identity is None:
            require(UID(identity["StudyInstanceUID"]).is_valid and UID(identity["SeriesInstanceUID"]).is_valid, "Invalid dataset hierarchy identifier")
        else:
            require((identity["StudyInstanceUID"], identity["SeriesInstanceUID"], identity["SOPInstanceUID"]) == (frozen_identity["studyUID"], frozen_identity["seriesUID"], frozen_identity["sop"]), "Frozen identity mismatch")
        require(syntax in NATIVE, "Unsupported transfer syntax (no transcoding permitted)")
        # Native pixel payload must be complete, including only permitted padding.
        require("PixelData" in ds and isinstance(ds.PixelData, bytes), "Missing pixel payload")
        expected = get_expected_length(ds)
        require(expected > 0 and len(ds.PixelData) == expected + expected % 2, "Truncated or oversized pixel payload")
        require(not ds[0x7FE00010].is_undefined_length, "Unsupported encapsulated pixels")
    for warning in caught:
        message = str(warning.message)
        allowed = {f"Invalid value for VR UI: '{identity[key]}'. Please see <https://dicom.nema.org/medical/dicom/current/output/html/part05.html#table_6.2-1> for allowed values for each VR." for key in ("StudyInstanceUID", "SeriesInstanceUID")} if frozen_identity is not None else set()
        require(message in allowed, "DICOM parser warning; repair refused")
    replacements = {2: identity["SOPClassUID"], 3: identity["SOPInstanceUID"]}
    mismatches = {}
    chunks = []
    for element, vr, encoded, value in entries[1:]:
        if element in replacements:
            require(vr == b"UI", "Incorrect file-meta identifier VR")
            target = replacements[element]
            different = value.rstrip(b"\0 ").decode("ascii") != target
            mismatches["classMismatch" if element == 2 else "instanceMismatch"] = different
            if different:
                payload = target.encode("ascii")
                payload += b"\0" * (len(payload) % 2)
                encoded = struct.pack("<HH2sH", 2, element, b"UI", len(payload)) + payload
        chunks.append(encoded)
    if any(mismatches.values()):
        meta = b"".join(chunks)
        result = raw[:132] + struct.pack("<HH2sHI", 2, 0, b"UL", 4, len(meta)) + meta + raw[offset:]
    else:
        result = raw
    _, new_offset = meta_elements(result)
    require(result[new_offset:] == raw[offset:], "Encoded dataset changed")
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Invalid value for VR UI:.*", category=UserWarning)
        after = pydicom.dcmread(io.BytesIO(result))
        # Comparing whole lazy pydicom datasets converts unrelated legacy values
        # and emits warnings containing private data. Byte equality above is the
        # stronger invariant; explicitly check pixels and syntax as well.
        require(after.PixelData == ds.PixelData and after.file_meta.TransferSyntaxUID == ds.file_meta.TransferSyntaxUID, "Pixels or transfer syntax changed")
        require(after.file_meta.MediaStorageSOPInstanceUID == ds.SOPInstanceUID and after.file_meta.MediaStorageSOPClassUID == ds.SOPClassUID, "File-meta repair failed")
    return result, {**identity, **mismatches, "transferSyntax": syntax, "datasetSHA256": sha(raw[offset:]), "pixelSHA256": sha(ds.PixelData)}


def load_cohort(private):
    # Reuse the importer's sealed-manifest/canonical-path/identity validation.
    code = "import {loadCohort} from './import.mjs'; console.log(JSON.stringify(await loadCohort(process.argv[1])));"
    run = subprocess.run(["node", "--input-type=module", "-e", code, str(private)], cwd=HERE, capture_output=True, check=False)
    require(run.returncode == 0, "Sealed cohort validation failed")
    cohort = json.loads(run.stdout)
    require(len(cohort["files"]) == 7168 and cohort["frames"] == 7168 and all(c["expectedFiles"] == 256 for c in cohort["cases"]), "Not the exact frozen 28 x 256 cohort")
    return cohort


def protected_hashes(private):
    paths = [p for p in private.iterdir() if p.is_file()]
    paths += [p for p in (private / "ratings").rglob("*") if p.is_file()]
    return {str(p.relative_to(private)): sha(p.read_bytes()) for p in sorted(paths)}


def private_write(path, data):
    require(not path.is_symlink(), "Refusing symlink output")
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def ensure_private_dir(path):
    require(not path.is_symlink(), "Refusing symlink directory")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.is_dir() and path.stat().st_mode & 0o077 == 0, "Directory must be owner-only")


def store_copy(path, raw):
    require(not path.is_symlink(), "Refusing symlink copy")
    if path.exists():
        require(path.is_file() and path.read_bytes() == raw and path.stat().st_mode & 0o077 == 0, "Existing copy differs; nothing overwritten")
        return False
    private_write(path, raw)
    require(path.read_bytes() == raw, "Copy readback failed")
    return True


class LocalOrthanc:
    """Fixed loopback only; persistent per-thread connections; no redirects/proxy."""

    def __init__(self):
        self.local = threading.local()

    def request(self, route, body=None, dicom=False):
        headers = {}
        if body is not None:
            headers["Content-Type"] = "application/dicom" if dicom else "application/json"
            if not dicom:
                body = json.dumps(body).encode()
        # Docker/Orthanc can close idle keepalive sockets. Reconnect read-only
        # requests, but never blindly retry a replacement with an unknown result.
        for attempt in range(3):
            if not getattr(self.local, "connection", None):
                self.local.connection = http.client.HTTPConnection("127.0.0.1", 8043, timeout=60)
            connection = self.local.connection
            try:
                connection.request("GET" if body is None else "POST", route, body, headers)
                response = connection.getresponse()
                raw = response.read()
                require(response.status == 200, "Local Orthanc request failed")
                return raw if route.endswith("/file") else json.loads(raw)
            except (OSError, http.client.HTTPException):
                connection.close()
                self.local.connection = None
                if dicom or attempt == 2:
                    raise

    def inventory(self, cohort):
        system = self.request("/system")
        require(system["Name"] == "Frozen 28 review series (local only)", "Wrong local server")
        require(not system["IngestTranscoding"] and system["MaximumStorageSize"] == 0 and system["MaximumPatientCount"] == 0, "Transcoding or recycling configured")
        # Existing importer checks every study/series/SOP relationship + DICOMweb.
        code = "import {loadCohort,apiClient,verifyInventory,verifyDicomWeb} from './import.mjs'; const c=await loadCohort(process.argv[1]); const a=apiClient(); await verifyInventory(a,c,true); await verifyDicomWeb(a,c);"
        run = subprocess.run(["node", "--input-type=module", "-e", code, cohort["private"]], cwd=HERE, capture_output=True, check=False)
        require(run.returncode == 0, "Exact REST/DICOMweb inventory validation failed")
        rows = self.request("/tools/find", {"Level": "Instance", "Query": {}, "Expand": True})
        mapping = {r["MainDicomTags"]["SOPInstanceUID"]: (r["ID"], r["ParentSeries"]) for r in rows}
        require(len(mapping) == len(rows) == len(cohort["files"]) and set(mapping) == {f["sop"] for f in cohort["files"]}, "Orthanc SOP membership changed")
        return system, mapping


def run(args):
    private = Path(os.environ.get("REVIEW_PRIVATE_DIR", HERE.parent / ".private")).resolve(strict=True)
    require(args.apply or not args.replace_orthanc, "Replacement requires --apply")
    require(not os.environ.get("REVIEW_ORTHANC_URL") or os.environ["REVIEW_ORTHANC_URL"] == "http://127.0.0.1:8043", "Repair uses only the dedicated default loopback server")
    before_protected = protected_hashes(private)
    cohort = load_cohort(private)
    cohort["private"] = str(private)
    audit_dir = private / "orthanc"
    ensure_private_dir(audit_dir)
    token = str(uuid.uuid4())
    report_path = audit_dir / f"repair-{token}.json"
    copies = audit_dir / "repaired-dicom"
    backups = audit_dir / "original-backups"
    report = {"status": "failed", "startedAt": datetime.now(timezone.utc).isoformat(), "pydicomVersion": pydicom.__version__, "apply": args.apply, "replaceOrthanc": args.replace_orthanc, "manifestHash": cohort["manifestHash"], "files": [], "protectedBefore": before_protected}
    api = LocalOrthanc()
    try:
        system, mapping = api.inventory(cohort) if args.orthanc or args.replace_orthanc else (None, None)
        if system is not None:
            report["orthancBefore"] = {key: system.get(key) for key in ("Version", "OverwriteInstancesMode", "DatabaseServerIdentifier")}

        def preflight(f):
            raw = Path(f["source"]).read_bytes()
            require(sha(raw) == f["sha256"], "Source changed after sealed preflight")
            repaired, facts = repair_bytes(raw, f)
            require((facts["StudyInstanceUID"], facts["SeriesInstanceUID"], facts["SOPInstanceUID"]) == (f["studyUID"], f["seriesUID"], f["sop"]), "Frozen identity mismatch")
            name = sha(f["sop"].encode()) + ".dcm"
            row = {**f, **facts, "output": str(copies / name), "backup": str(backups / name), "outputSHA256": sha(repaired)}
            if mapping is not None:
                row["orthancId"], row["orthancSeriesId"] = mapping[f["sop"]]
                stored = api.request(f"/instances/{row['orthancId']}/file")
                # Never replace an independently changed file under the same UID.
                require(stored in (raw, repaired), "Stored file differs from source and repaired copy; refusing replacement")
                row["storedBeforeSHA256"] = sha(stored)
                _, stored_facts = repair_bytes(stored, f)
                row["storedInstanceMismatch"] = stored_facts["instanceMismatch"]
                row["storedClassMismatch"] = stored_facts["classMismatch"]
                row["needsReplacement"] = stored != repaired
            return row

        with ThreadPoolExecutor(max_workers=4) as pool:
            # Entire cohort + stored bytes validated before first output/upload.
            report["files"] = list(pool.map(preflight, cohort["files"]))
        rows = report["files"]
        report["summary"] = {"files": len(rows), "instanceMismatches": sum(r["instanceMismatch"] for r in rows), "classMismatches": sum(r["classMismatch"] for r in rows), "copiesCreated": 0, "copiesReused": 0, "orthancReplaced": 0}
        if mapping is not None:
            report["summary"].update(storedInstanceMismatches=sum(r["storedInstanceMismatch"] for r in rows), storedClassMismatches=sum(r["storedClassMismatch"] for r in rows), needsReplacement=sum(r["needsReplacement"] for r in rows))
        print(json.dumps({"preflight": report["summary"]}), flush=True)
        if args.apply:
            ensure_private_dir(copies)
            ensure_private_dir(backups)
            for row in rows:
                raw = Path(row["source"]).read_bytes()
                require(sha(raw) == row["sha256"], "Source changed before copy")
                repaired, _ = repair_bytes(raw, row)
                require(sha(repaired) == row["outputSHA256"], "Repair not reproducible")
                store_copy(Path(row["backup"]), raw)
                created = store_copy(Path(row["output"]), repaired)
                report["summary"]["copiesCreated" if created else "copiesReused"] += 1
                readback, facts = repair_bytes(Path(row["output"]).read_bytes(), row)
                require(sha(readback) == row["outputSHA256"] and not facts["instanceMismatch"] and not facts["classMismatch"], "Copy still mismatched")
                require(facts["datasetSHA256"] == row["datasetSHA256"] and facts["pixelSHA256"] == row["pixelSHA256"], "Copy dataset or pixels changed")
            report["summary"].update(copiesVerified=len(rows), backupsVerified=len(rows), copyRemainingMismatches=0)
            # All copies validated before allowing replacement. Durable private
            # plan plus fsynced journal supports inspection/resume after failure.
            if args.replace_orthanc:
                current = api.request("/system")
                require(current["Version"] == "1.13.0" and current.get("OverwriteInstancesMode") == "IfChanged" and current.get("StoreMD5ForAttachments"), "Temporarily configure Orthanc 1.13 IfChanged overwrite first")
                require(current["DatabaseServerIdentifier"] == system["DatabaseServerIdentifier"], "Local server changed during repair")
                private_write(audit_dir / f"repair-{token}-plan.json", json.dumps(report, indent=2).encode())
                journal_path = audit_dir / f"repair-{token}-uploads.jsonl"
                with os.fdopen(os.open(journal_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as journal:
                    for row in rows:
                        if not row["needsReplacement"]:
                            continue
                        raw = Path(row["output"]).read_bytes()
                        require(sha(raw) == row["outputSHA256"] and sha(Path(row["source"]).read_bytes()) == row["sha256"], "Copy or source changed before replacement")
                        old = api.request(f"/instances/{row['orthancId']}/file")
                        require(sha(old) in (row["storedBeforeSHA256"], row["outputSHA256"]), "Stored file changed since preflight")
                        require(sha(Path(row["backup"]).read_bytes()) == row["sha256"], "Original backup changed")
                        result = api.request("/instances", raw, dicom=True)
                        require(result["Status"] in ("Success", "AlreadyStored") and result["ID"] == row["orthancId"] and result["ParentSeries"] == row["orthancSeriesId"], "Replacement changed Orthanc identity")
                        require(api.request(f"/instances/{row['orthancId']}/file") == raw, "Stored replacement readback failed")
                        report["summary"]["orthancReplaced"] += 1
                        journal.write(json.dumps({"orthancId": row["orthancId"], "beforeSHA256": sha(old), "sha256": row["outputSHA256"], "backup": row["backup"]}) + "\n")
                        journal.flush()
                        os.fsync(journal.fileno())
                        if report["summary"]["orthancReplaced"] % 256 == 0:
                            print(json.dumps({"replaced": report["summary"]["orthancReplaced"]}), flush=True)
                _, after_mapping = api.inventory(cohort)
                require(after_mapping == mapping, "Orthanc mapping changed")
                for row in rows:
                    require(sha(api.request(f"/instances/{row['orthancId']}/file")) == row["outputSHA256"], "Final stored byte verification failed")
                report["summary"]["storedRemainingMismatches"] = 0
        for row in rows:
            require(sha(Path(row["source"]).read_bytes()) == row["sha256"], "Original source hash changed")
        require(protected_hashes(private) == before_protected, "Protected manifest/prompts/ratings changed during run")
        report["originalsUnchanged"] = True
        report["protectedUnchanged"] = True
        report["status"] = "success"
        print(json.dumps({"status": report["status"], **report["summary"], "originalsUnchanged": True, "protectedUnchanged": True}), flush=True)
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        private_write(report_path, json.dumps(report, indent=2).encode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Create/verify private copies and original backups; originals remain untouched")
    mode.add_argument("--dry-run", action="store_true", help="Explicit preview (the default); write audit only")
    parser.add_argument("--orthanc", action="store_true", help="Read and compare every stored file (no server mutation)")
    parser.add_argument("--replace-orthanc", action="store_true", help="Explicitly replace validated stored bytes under unchanged IDs; requires --apply and temporary IfChanged configuration")
    try:
        run(parser.parse_args())
    except Exception:
        # Parser/filesystem exceptions can contain private paths or DICOM values.
        print("Repair failed closed; inspect private audit and local configuration. No originals rewritten.", file=sys.stderr)
        sys.exit(1)
