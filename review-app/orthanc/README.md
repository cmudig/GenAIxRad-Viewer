# Frozen-review Orthanc (local research only)

Separate from the repository's existing Orthanc recipes, deployed servers, and
the running review app. Requires Node 20+ and a running Docker Desktop engine.
No Firebase, cloud DICOM service, sudo, source DICOM rewriting, or folder-wide upload.

## Start and populate

From the repository root:

1. Launch Docker Desktop and wait for its engine to be running.
2. Check local files without network access: `node review-app/orthanc/import.mjs --check`.
3. Validate configuration: `docker compose -f review-app/orthanc/compose.yaml config --quiet`.
4. Start and wait for readiness: `docker compose -f review-app/orthanc/compose.yaml up -d --wait --wait-timeout 180`.
5. Import: `node review-app/orthanc/import.mjs`.
6. Independently reverify: `node review-app/orthanc/import.mjs --verify`.

Orthanc Explorer: **http://127.0.0.1:8043/**.
DICOMweb (QIDO-RS/WADO-RS): **http://127.0.0.1:8043/dicom-web/**.
Project: `frozen-review-orthanc`; service: `orthanc`.
Persistent named volume: `frozen-review-orthanc-data`.
Pinned image: `orthancteam/orthanc:26.11.0`, multi-architecture digest
`sha256:06b8baab0c63cd58de5474a74b64096a82ea3f7eab2aa471e217cc48c9ae11bf`
(Docker Hub metadata checked 2026-11-09). This is a local research setup, not
a security-reviewed or diagnostic production deployment.

Verified locally on 2026-11-09: the healthy ARM64 container runs Orthanc **1.13.0**;
REST and DICOMweb expose exactly **28 frozen series / 7,168 instances**, with
**256 instances in every series**. Data persisted across a container restart.
An idempotent rerun reported **0 newly stored / 7,168 AlreadyStored**, followed by
successful exact inventory verification. All **12 importer regression tests**
passed. Cross-origin probes returned no `Access-Control-Allow-Origin` header.
Private timestamped reports retain run-specific status; this note is a setup-time
observation, not a guarantee about future manual changes to the server.

Stop without deleting data: `docker compose -f review-app/orthanc/compose.yaml stop`.
Start again with the same `up` command. Do **not** remove the volume or use
`down -v`. Do not upload other data using Explorer; verification deliberately
rejects unrelated contents and never deletes anything automatically.

## Exact input and verification

The importer reads the existing SHA-256-sealed private manifest, not a regenerated
cohort. It requires exactly 28 unique matched series from the two approved source
studies, the 29-target/one-unmatched provenance, unique case IDs, canonical paths
inside the existing approved roots, unique source frame references, unique SOPs,
and the frozen per-case file counts. Only files explicitly referenced by that
manifest are read; nothing is mounted from Downloads into Docker.

All source dataset StudyInstanceUID/SeriesInstanceUID/SOPInstanceUID values are
checked against the freeze **before any network request**. A small fail-closed
Part 10 reader supports the transfer syntaxes used by this cohort, not arbitrary
DICOM. Unsupported headers fail explicitly; there is no silent fallback. Some
generated originals have stale file-meta SOP identifiers (6,656 of the current
7,168 files); the importer counts and discloses these without repairing them.
The separate, opt-in private-copy repair below corrects file metadata only.
Dataset identities must match the freeze.
During ordinary import, originals and every byte sent to Orthanc remain unchanged. Source SHA-256
hashes are checked again immediately before upload. This detects changes during
an import, not changes to pixels made before preflight under the same identifiers.

The current freeze has **28 × 256 = 7,168 files/frames**; counts are derived from
the manifest, never manufactured by duplication. Multiframe references are
deduplicated to one HTTP `application/dicom` upload per unique file. Uploads use
four workers, at most three attempts on connection/transient HTTP errors, and
idempotent Orthanc `Success`/`AlreadyStored` results. A failed worker stops new
scheduling and drains in-flight requests. Partial imports remain in the volume;
rerun safely after resolving the error. No rollback/delete or source modification.

Before uploads, the importer verifies the server's review-specific name and rejects
any existing series, study or SOP outside the allowlist. After uploads it checks
**every exact study+series pair, every dataset SOP, each series's instance count,
global instance count, and DICOMweb's 28 exact study+series pairs**. A count alone
is not considered success. `--verify` performs REST inventory reads (including
read-only POST `/tools/find`) without uploading. An unchanged original under an
already-stored SOP is not a byte-for-byte server-content verification: Orthanc is
configured not to overwrite duplicates, and these checks establish identity/count
membership, not integrity of an independently modified existing server file.

Every CLI invocation records a new timestamped result under the already-ignored
private directory's `orthanc` subdirectory (owner-only directory/files). Errors
exit nonzero; failed runs are not reported as successful imports. Reports can
contain private Orthanc identifiers. No patient names, UIDs, or original source
paths are intentionally printed to the terminal. Ratings and seals are untouched.

## Local-only security and app integration

Only HTTP port **127.0.0.1:8043** is published; the DICOM TCP server is disabled.
The container uses a dedicated bridge network, and no outbound DICOM peers or
cloud plugins are configured. This is not an outbound firewall. Docker Engine 29
does not publish host ports for an `internal: true` bridge, so that option cannot
be used for this host-accessed service. `RemoteAccessAllowed: true` allows bridge traffic to
reach Orthanc inside its container; it does **not** change the host's loopback
binding. Authentication is deliberately disabled for this single-user local
instance. Any local user/process with access to this machine can read or change
the data. The volume and Docker logs may contain identifying medical data and
are not encrypted by this setup. Do not forward the port, change it to `0.0.0.0`,
attach other containers, or use this configuration for shared/network access.

No permissive CORS headers are configured. DICOMweb works same-origin; direct
cross-origin browser fetches from the review UI are intentionally not enabled.
The importer accepts only an HTTP numeric-loopback origin (default port 8043;
optional `REVIEW_ORTHANC_URL`) and refuses redirects, credentials and URL paths.
`REVIEW_PRIVATE_DIR` may select another existing sealed cohort; ensure any custom
private location is excluded from version control.

The existing **http://127.0.0.1:4318** review app still uses its frozen local-file
pixel worker. This setup does **not** switch its data source to Orthanc, change
the cohort/prompts, restart it, or migrate/reset ratings. Orthanc is a separate
local store and Explorer UI; adding an Orthanc-backed review adapter is a separate
change. Neither viewer is certified for diagnosis by this setup.

Tests: `node --test review-app/orthanc/import.test.mjs` (synthetic data and mocked
Orthanc API only). The real-source `--check` does not prove that the Docker service
started; only a completed import and verification against the running service do.

## Non-destructive file-meta repair

[repair.py](repair.py) uses the same sealed manifest and canonical source allowlist
as the importer. It requires the exact **28 series × 256 files = 7,168** cohort.
Dependencies are in [../requirements.txt](../requirements.txt); the actual run used
pydicom 3.0.2 with Python 3.14.3. No new UIDs are generated. Missing/invalid dataset
SOP instance or class identifiers fail closed, even if file-meta IDs are present.

From the repository root, using the configured Python interpreter:

- Preview, no Orthanc access: `python review-app/orthanc/repair.py --dry-run`.
- Preview and inspect **every** stored `/instances/{id}/file`:
	`python review-app/orthanc/repair.py --dry-run --orthanc`.
- Create/verify private copies and backups, inspecting Orthanc without uploading:
	`python review-app/orthanc/repair.py --apply --orthanc`.
- Synthetic regression tests:
	`python -m unittest discover -s review-app/orthanc -p 'test_repair.py' -v`.

Omitting both `--apply` and `--dry-run` means preview. Preview writes a new private
audit, but no DICOM copies or uploads. Apply creates the complete cohort under
the already Git-ignored **review-app/.private/orthanc/repaired-dicom/** directory,
and byte-identical originals under **review-app/.private/orthanc/original-backups/**.
Both directories are owner-only (0700); files/audits are 0600. Names are SHA-256
of the existing dataset SOP UID, not patient names. Existing output files are
reused only if bytes and permissions match; differing files are never overwritten.

The script changes only file-meta `MediaStorageSOPInstanceUID` (0002,0003) and
`MediaStorageSOPClassUID` (0002,0002) to match the **existing dataset** identifiers,
recalculating file-meta group length if needed. The preamble, all other file-meta
elements and the **entire encoded dataset** are copied byte-for-byte. This preserves
Study/Series/SOP UIDs, private/sequence elements, pixels and transfer syntax.
Matching files are byte-identical. Native implicit LE, explicit LE and explicit BE
are supported; compressed/deflated syntax, malformed headers, parser warnings
other than the already frozen legacy hierarchy UID warnings, and incomplete native
pixel data fail closed. This is not a general DICOM metadata cleanup or validator.
Legacy unrelated metadata is neither normalized nor printed. Pydicom parsing is
serialized because warning contexts are process-global on the selected interpreter.

Each private `repair-<run-id>.json` audit includes the manifest hash, per-file
original/output/dataset/pixel SHA-256 hashes, backup/output paths, mismatch flags,
and (when inspected) stored-before hashes and Orthanc IDs. All originals are
rehashed at completion; private manifests, seals, prompts, targets and ratings
are hashed before/after without rewriting them. Reports contain private paths/UIDs;
do not commit or publish them. Terminal output contains aggregate counts only.

### Controlled local Orthanc replacement

The default server configuration **remains `OverwriteInstances: false`**. Apply
alone never uploads, enables overwrite, or changes server configuration. Repaired
copies are not automatically used by the original-file importer or the review UI.
With overwrite protection restored, rerunning the importer cannot revert repairs.

Replacement requires explicit `--apply --replace-orthanc` and an already verified
Orthanc 1.13.0 server temporarily running with `OverwriteInstances: "IfChanged"`
and attachment MD5 enabled. **Do not enable this broadly or on a deployed/shared
server.** First verify the dedicated Compose project/service, pinned image,
exclusive named volume, localhost-only 8043 binding, no jobs/remote peers/modalities,
and exact frozen inventory. Keep other local writers/importers stopped during
maintenance. If this isolation cannot be established, leave the server unchanged
and use only the verified private copies; deletion/reset is not a fallback.

The script preflights all sources and stored bytes before mutation, refuses any
stored file that differs from both its original and deterministic repaired copy,
verifies all private backups/copies, and fsyncs a private plan before uploading.
It uploads **only files needing replacement**, never DELETEs or calls reset,
checks unchanged Orthanc instance/series IDs and exact stored readback after each
upload, and fsyncs an upload journal. Ambiguous upload failures are not blindly
retried; inspect the plan/journal and rerun full preflight. There is no automatic
rollback. After replacement, verify every stored hash and exact REST/DICOMweb
inventory, restore `OverwriteInstances: false`, restart only the isolated service,
and repeat read-only verification. Restore overwrite protection even on failure.

### Actual verified repair (2026-11-10)

- Pydicom inspected all **7,168 originals**: **6,656 instance-UID mismatches**,
	**0 class-UID mismatches**; all use native implicit VR little endian.
- Stored-file inspection proved Orthanc had retained the original mismatches,
	rather than silently normalizing them.
- Created and verified **7,168 copies and 7,168 original backups**; **6,656** copies
	corrected, **512** byte-identical. Independent checks verified all original
	hashes, exact encoded datasets and **all 7,168 decoded pixel arrays**.
- Replaced exactly **6,656** stored instances with supported `IfChanged` uploads;
	**0 remaining stored instance/class mismatches**, verified across **all 7,168**
	files after restarting with overwrite mode restored to **Never**.
- REST and DICOMweb still expose exactly **28 series / 7,168 instances**, **256 per
	series**, with unchanged Orthanc mappings. No source, ratings, manifest/seal,
	review-app data-source, cloud or deployed-server changes.
- **11 repair tests + 12 importer tests passed**. Full private replacement audit:
	`repair-7021ba43-42ef-4838-97e5-899b95fb0cfe.json`; independent verification:
	`repair-independent-6a60e40d-bbfe-487b-bd4a-7fdea7877307.json`, both under the
	ignored private Orthanc directory. These are run-specific observations.

The untouched originals still have their historical file-meta mismatches, so the
ordinary importer continues to report its source warning. That warning does not
describe the repaired Orthanc files. Other pre-existing metadata issues are out of
scope; the freeze's dataset identifiers were intentionally not modernized.
