"""Synthetic regression tests; no private data or running Orthanc needed."""

import io
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stderr
from pathlib import Path
import struct
import tempfile
import unittest
import warnings

import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset

from repair import meta_elements, repair_bytes, sha, store_copy


def synthetic(syntax="1.2.840.10008.1.2", instance="1.9", sop_class=None):
    meta = FileMetaDataset()
    meta.TransferSyntaxUID = syntax
    ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.SOPInstanceUID = "1.2.3.456789"
    ds.StudyInstanceUID = "1.2.3.4"
    ds.SeriesInstanceUID = "1.2.3.5"
    ds.PatientID = "synthetic-only"
    ds.Rows = 2
    ds.Columns = 2
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = bytes(range(8))
    item = Dataset()
    item.ReferencedSOPInstanceUID = "1.2.3.99"
    ds.ReferencedImageSequence = [item]
    ds.add_new((0x7777, 0x0010), "LO", "PRIVATE-TEST")
    ds.add_new((0xFFFC, 0xFFFC), "OB", b"tail")
    output = io.BytesIO()
    pydicom.dcmwrite(output, ds, implicit_vr=syntax == "1.2.840.10008.1.2", little_endian=syntax != "1.2.840.10008.1.2.2", enforce_file_format=True)
    raw = output.getvalue()
    entries, offset = meta_elements(raw)
    chunks = []
    for element, vr, encoded, value in entries[1:]:
        target = instance if element == 3 else sop_class if element == 2 else None
        if target is not None:
            value = target.encode()
            value += b"\0" * (len(value) % 2)
            encoded = struct.pack("<HH2sH", 2, element, b"UI", len(value)) + value
        chunks.append(encoded)
    body = b"".join(chunks)
    return raw[:132] + struct.pack("<HH2sHI", 2, 0, b"UL", 4, len(body)) + body + raw[offset:]


class RepairTests(unittest.TestCase):
    def test_native_syntaxes_preserve_every_dataset_byte_and_pixel(self):
        for syntax in ("1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"):
            with self.subTest(syntax=syntax):
                raw = synthetic(syntax)
                fixed, facts = repair_bytes(raw)
                _, before = meta_elements(raw)
                _, after = meta_elements(fixed)
                self.assertEqual(raw[before:], fixed[after:])
                self.assertEqual(facts["datasetSHA256"], sha(raw[before:]))
                self.assertEqual(facts["pixelSHA256"], sha(bytes(range(8))))
                self.assertTrue(facts["instanceMismatch"])
                self.assertFalse(facts["classMismatch"])
                ds = pydicom.dcmread(io.BytesIO(fixed))
                self.assertEqual(ds.file_meta.MediaStorageSOPInstanceUID, ds.SOPInstanceUID)
                self.assertEqual(str(ds.file_meta.TransferSyntaxUID), syntax)

    def test_matching_is_byte_identical_and_repair_is_idempotent(self):
        raw = synthetic(instance="1.2.3.456789")
        self.assertEqual(repair_bytes(raw)[0], raw)
        fixed, _ = repair_bytes(synthetic())
        again, facts = repair_bytes(fixed)
        self.assertEqual(again, fixed)
        self.assertFalse(facts["instanceMismatch"])

    def test_class_and_instance_mismatches_independent(self):
        for instance in ("1.9", "1.2.3.456789"):
            fixed, facts = repair_bytes(synthetic(instance=instance, sop_class="1.2.3"))
            self.assertTrue(facts["classMismatch"])
            ds = pydicom.dcmread(io.BytesIO(fixed))
            self.assertEqual(ds.file_meta.MediaStorageSOPClassUID, ds.SOPClassUID)

    def test_only_two_meta_identifiers_and_group_length_can_change(self):
        raw = synthetic()
        fixed, _ = repair_bytes(raw)
        old, _ = meta_elements(raw)
        new, _ = meta_elements(fixed)
        self.assertEqual([(e[0], e[2]) for e in old if e[0] not in (0, 2, 3)], [(e[0], e[2]) for e in new if e[0] not in (0, 2, 3)])
        self.assertEqual(raw[:132], fixed[:132])

    def test_missing_invalid_or_duplicate_meta_refused(self):
        raw = synthetic()
        entries, offset = meta_elements(raw)
        for body in (b"".join(e[2] for e in entries[1:] if e[0] != 3), b"".join(e[2] for e in entries[1:]) + entries[2][2]):
            bad = raw[:132] + struct.pack("<HH2sHI", 2, 0, b"UL", 4, len(body)) + body + raw[offset:]
            with self.assertRaises(ValueError):
                repair_bytes(bad)
        with self.assertRaises(ValueError):
            repair_bytes(b"not dicom")
        with self.assertRaises(ValueError):
            repair_bytes(raw[:150])

    def test_missing_or_invalid_dataset_uid_refused(self):
        for value in (b"baduid", b"      "):
            original = synthetic()
            self.assertIn(b"1.2.3.456789", original)
            raw = original.replace(b"1.2.3.456789", value.ljust(12, b" "))
            with self.assertRaises(ValueError):
                repair_bytes(raw)

    def test_truncated_pixels_refused_even_when_pydicom_accepts_short_value(self):
        raw = synthetic()
        pixel_offset = raw.index(bytes(range(8)))
        with self.assertRaises(ValueError):
            repair_bytes(raw[:pixel_offset + 4])

    def test_missing_dataset_class_or_instance_never_invented_from_meta(self):
        for element in (0x16, 0x18):
            raw = synthetic()
            # Change only the dataset tag to an unrelated UI tag, leaving the
            # corresponding file-meta identifier present.
            tag = struct.pack("<HH", 8, element)
            self.assertIn(tag, raw)
            raw = raw.replace(tag, struct.pack("<HH", 8, 0x14), 1)
            with self.assertRaisesRegex(ValueError, "missing dataset identifier"):
                repair_bytes(raw)

    def test_frozen_identity_cannot_authorize_different_dataset(self):
        frozen = {"studyUID": "1.2.3.4", "seriesUID": "1.2.3.5", "sop": "1.2.3.999"}
        with self.assertRaisesRegex(ValueError, "Frozen identity mismatch"):
            repair_bytes(synthetic(), frozen)

    def test_parallel_legacy_hierarchy_warnings_never_escape(self):
        raw = synthetic().replace(b"1.2.3.4\0", b"0000012\0")
        frozen = {"studyUID": "0000012", "seriesUID": "1.2.3.5", "sop": "1.2.3.456789"}
        stderr = io.StringIO()
        with redirect_stderr(stderr), warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            with ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda _: repair_bytes(raw, frozen), range(32)))
        self.assertEqual(len(results), 32)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(caught, [])

    def test_copies_exclusive_private_resumable_and_never_change_original(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "source.dcm", Path(directory) / "fixed.dcm"
            raw = synthetic()
            source.write_bytes(raw)
            before = sha(source.read_bytes())
            fixed, _ = repair_bytes(raw)
            self.assertTrue(store_copy(output, fixed))
            self.assertFalse(store_copy(output, fixed))
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                store_copy(output, b"different")
            link = Path(directory) / "link.dcm"
            link.symlink_to(source)
            with self.assertRaises(ValueError):
                store_copy(link, fixed)
            self.assertEqual(sha(source.read_bytes()), before)


if __name__ == "__main__":
    unittest.main()
