#!/usr/bin/env python3
"""Sync Orthanc patients against an allowlist of DICOM PatientIDs.

Default behavior is a dry run. Use --delete to actually remove patients from Orthanc
whose DICOM PatientID is not present in the JSON groups file.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import requests


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description=(
            "Fetch all patients from Orthanc and keep only those whose DICOM PatientID "
            "appears in patient_id_groups.json."
        )
    )
    parser.add_argument(
        "--groups-file",
        default=str(script_dir / "patient_id_groups.json"),
        help="Path to patient ID groups JSON (default: backend/patient_id_groups.json).",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Actually delete non-allowlisted Orthanc patients. Default is dry-run.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP timeout in seconds (default: 30).",
    )
    parser.add_argument(
        "--list-output",
        default=None,
        help="Optional output path for a JSON report.",
    )
    return parser.parse_args()


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def parse_bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def flatten_patient_ids(node: Any) -> set[str]:
    ids: set[str] = set()

    def _walk(value: Any) -> None:
        if isinstance(value, dict):
            for child in value.values():
                _walk(child)
            return
        if isinstance(value, list):
            for child in value:
                _walk(child)
            return
        if isinstance(value, (str, int, float)):
            token = str(value).strip()
            if token:
                ids.add(token)

    _walk(node)
    return ids


def fetch_patients(base_url: str, session: requests.Session, timeout: int) -> list[dict[str, Any]]:
    patients_url = f"{base_url.rstrip('/')}/patients"

    # Prefer expanded response to avoid one request per patient.
    response = session.get(patients_url, params={"expand": "true"}, timeout=timeout)
    response.raise_for_status()
    payload = response.json()

    if isinstance(payload, list) and payload and isinstance(payload[0], dict):
        return payload

    # Fallback: if Orthanc returns only patient UUIDs, fetch each patient record.
    patient_records: list[dict[str, Any]] = []
    for orthanc_id in payload:
        item = session.get(f"{patients_url}/{orthanc_id}", timeout=timeout)
        item.raise_for_status()
        patient_records.append(item.json())

    return patient_records


def extract_patient_id(record: dict[str, Any]) -> str | None:
    tags = record.get("MainDicomTags") or {}
    patient_id = tags.get("PatientID")
    if patient_id is None:
        return None

    text = str(patient_id).strip()
    return text or None


def delete_orthanc_patients(
    base_url: str,
    session: requests.Session,
    orthanc_patient_ids: list[str],
    timeout: int,
) -> tuple[int, list[tuple[str, str]]]:
    patients_url = f"{base_url.rstrip('/')}/patients"
    deleted = 0
    failures: list[tuple[str, str]] = []

    for orthanc_id in orthanc_patient_ids:
        response = session.delete(f"{patients_url}/{orthanc_id}", timeout=timeout)
        if response.ok:
            deleted += 1
        else:
            failures.append((orthanc_id, f"{response.status_code} {response.text}"))

    return deleted, failures


def build_report(
    allowlisted_patient_ids: set[str],
    orthanc_entries: list[dict[str, str | None]],
    to_keep: list[dict[str, str | None]],
    to_delete: list[dict[str, str | None]],
    dry_run: bool,
) -> dict[str, Any]:
    present_ids = sorted({entry["patient_id"] for entry in orthanc_entries if entry["patient_id"]})

    return {
        "mode": "dry-run" if dry_run else "delete",
        "allowlisted_patient_ids_count": len(allowlisted_patient_ids),
        "orthanc_patient_resources_count": len(orthanc_entries),
        "orthanc_distinct_patient_ids_count": len(present_ids),
        "orthanc_patient_ids": present_ids,
        "keep_count": len(to_keep),
        "delete_count": len(to_delete),
        "to_delete": to_delete,
    }


def main() -> int:
    args = parse_args()

    script_dir = Path(__file__).resolve().parent
    load_dotenv(script_dir / ".env")

    base_url = os.getenv("ORTHANC_BASE_URL", "http://localhost:8042").strip()
    username = os.getenv("ORTHANC_USERNAME", "")
    password = os.getenv("ORTHANC_PASSWORD", "")
    verify_ssl = parse_bool_env("ORTHANC_VERIFY_SSL", default=True)

    if not base_url:
        raise RuntimeError("ORTHANC_BASE_URL is empty. Set it in backend/.env or environment.")

    groups_path = Path(args.groups_file).resolve()
    groups_payload = json.loads(groups_path.read_text(encoding="utf-8"))
    allowlisted_patient_ids = flatten_patient_ids(groups_payload)

    session = requests.Session()
    if username or password:
        session.auth = (username, password)
    session.verify = verify_ssl

    orthanc_records = fetch_patients(base_url, session, timeout=args.timeout)

    orthanc_entries: list[dict[str, str | None]] = []
    for record in orthanc_records:
        orthanc_entries.append(
            {
                "orthanc_id": record.get("ID"),
                "patient_id": extract_patient_id(record),
            }
        )

    to_keep: list[dict[str, str | None]] = []
    to_delete: list[dict[str, str | None]] = []

    for entry in orthanc_entries:
        patient_id = entry["patient_id"]
        if patient_id is not None and patient_id in allowlisted_patient_ids:
            to_keep.append(entry)
        else:
            to_delete.append(entry)

    report = build_report(
        allowlisted_patient_ids=allowlisted_patient_ids,
        orthanc_entries=orthanc_entries,
        to_keep=to_keep,
        to_delete=to_delete,
        dry_run=not args.delete,
    )

    print(json.dumps(report, indent=2))

    if args.list_output:
        output_path = Path(args.list_output).resolve()
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nWrote report to: {output_path}")

    if not args.delete:
        print("\nDry-run complete. No Orthanc patients were deleted.")
        return 0

    ids_to_delete = [entry["orthanc_id"] for entry in to_delete if entry["orthanc_id"]]

    if not ids_to_delete:
        print("\nDelete mode: nothing to delete.")
        return 0

    deleted_count, failures = delete_orthanc_patients(
        base_url=base_url,
        session=session,
        orthanc_patient_ids=ids_to_delete,
        timeout=args.timeout,
    )

    print(f"\nDelete mode complete: deleted {deleted_count}/{len(ids_to_delete)} patient resources.")

    if failures:
        print("Failures:")
        for orthanc_id, detail in failures:
            print(f"- {orthanc_id}: {detail}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
