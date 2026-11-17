# Direct home-hosted HTTPS (no ngrok required)

Squarespace remains the registrar and DNS provider. A Caddy container handles
HTTPS and username/password authentication; Orthanc's existing volume and
localhost port are unchanged. Orthanc stays read-only; a separate authenticated
`/api/` route now connects the Firebase review frontend to the Mac backend.
The verified hostname is **orthanc.katelyncmorrison.com**, including the middle
initial `c`. The previously discussed spelling without `c` returns NXDOMAIN.

## First-time setup

1. Run `node review-app/orthanc/setup-https.mjs`. It generates a random 192-bit
   password and username `reviewer`, saves them owner-only in the ignored
   review-app/.private/orthanc/https/credentials.json, and stores an Argon2id
   password hash separately. Existing credentials are never silently replaced.
   View the credentials locally; never paste them into chat or commit them.
2. Validate Caddy and test authentication on loopback before starting publicly.
3. Configure only the Squarespace `orthanc` A record to your current **public
   IPv4**, never the private 10.0.0.138. Remove conflicting `orthanc` CNAME
   records; remove an obsolete AAAA record if not intentionally serving IPv6.
   Preserve all other records. A residential public IP can change; when it does,
   update the A record. A four-hour TTL can delay visibility of corrections.
4. The router reserves 10.0.0.138 for the Mac and forwards **TCP 443** to it.
   Do not forward 8043, 4242, 4318, or Caddy's admin port. Port 80 is not needed:
   Caddy uses the TLS-ALPN challenge over 443 and automatic certificate renewal.
5. Start with `docker compose -f review-app/orthanc/compose.https.yaml up -d`.
   Caddy contacts an ACME certificate authority and accepts its subscriber terms.
   TLS must validate normally before entering a password; never bypass a
   certificate warning on the public site.

## Restrictions and verification

- Every proxied path requires a valid username/password over HTTPS.
- Only GET/HEAD reach Orthanc. POST searches, uploads, changes and DELETE are
  intentionally denied; some built-in Orthanc viewer functions may not work.
- Exception: the explicitly allowlisted review API supports GET sessions/frames
  and PUT assessments, requiring Basic authentication, the exact Firebase origin,
  a private edge-to-backend token, plus the existing CSRF/revision validation.
  CORS preflight returns no private data and does not require credentials.
- Remote users can read/download all studies in this isolated Orthanc. Do not
  add unrelated images without reviewing access. This is not a full security or
  regulatory compliance certification.
- Plaintext credentials are not mounted into any container. Proxy admin API and
  configuration persistence are disabled, and Basic authorization headers are
  removed before forwarding. HTTP access logging is not enabled.
- Check unauthenticated and wrong-password requests return 401; authenticated
  reads succeed; authenticated write methods on a nonexistent path return 403.
  Check DICOMweb and image-file endpoints, not just the landing page.
- Verify access from a phone on cellular (Wi-Fi off). A same-network request
  cannot prove the ISP/router accepts outside connections.
- The computer must remain awake; Docker Desktop must be running. Compose
  restarts the proxy when Docker restarts, not before macOS user login.
- Basic authentication has no reliable browser logout; close the browser or use
  a separate private session. Use a password manager and share credentials only
  with approved reviewers. Add separate accounts if individual revocation is needed.

## Stop safely

`docker compose -f review-app/orthanc/compose.https.yaml stop` stops public
access without touching Orthanc or image data. Do not delete the Orthanc volume.
Keep certificate storage private; it contains private keys. Do not run `down -v`
unless explicitly retiring the proxy and its certificates.

## Firebase review frontend

Live frontend: https://genai-radiology-verify.web.app/ (same `reviewer` login).
The original OHIF Hosting site and its root Firebase configuration are unchanged.
Only three public assets are deployed; no images, private manifests, passwords,
or assessment journals are uploaded to Hosting.

Build with `node review-app/build-hosting.mjs`, then deploy with
`firebase deploy --only hosting --config firebase.review.json --project genai-radiology`.

Before starting the remote backend, run
`node review-app/orthanc/setup-review-proxy.mjs`. It creates an owner-only private
proxy token and Caddy upstream include. Never print or commit either.
Start the **single** Node backend with `REVIEW_REMOTE_CONFIG` set to the absolute
path of review-app/.private/orthanc/https/review-proxy.json, using the existing
`node review-app/server.mjs` entry point. It still binds only 127.0.0.1:4318.
Do not run a second backend against the same review cohort. The local UI
remains usable at its original URL; reload stale tabs after a backend restart.

The Docker proxy reaches the loopback Node server through Docker Desktop's
host.docker.internal forwarding. That connectivity was verified on this Mac;
do not change the Node bind address to 0.0.0.0 to work around another platform.

The exact allowed browser origin is https://genai-radiology-verify.web.app.
The alternate firebaseapp.com domain is deliberately not allowed. The frontend
keeps Basic credentials only in tab memory (not local/session storage); refresh
requires another sign-in. Do not edit the live assessment UI during automated
validation. This remains one shared reviewer workflow, not separate user accounts.

### Assessment storage operations

The production CLI defaults to **Firebase Firestore**, project **genai-radiology**,
collection **afrooz-review**, for both hosted and locally served UI sessions.
Images are transmitted over HTTPS from researcher Mac; assessments stored in
Firebase Firestore (afrooz-review). The Mac still handles image decoding and all
server-side assessment writes; Hosting alone cannot serve images or save reviews.
The UI labels storage from the session API, independently of the page origin.
Imported `startServer()` defaults to local storage only for isolated tests.

The Node server obtains and refreshes tokens using
`gcloud auth print-access-token --quiet`. It requires a **valid gcloud login** on
the Mac with Firestore permissions; reauthenticate locally if that login expires
or is revoked. No browser Firebase keys/client SDK or opened Firestore rules are
required. Keep credentials server-side; do not loosen rules to fix IAM failures.

Top-level documents `${manifestHash}--${caseId}` hold the latest assessment;
their `revisions` subcollection retains earlier revisions. The prior local
journal must remain an immutable backup after migration, with **no future writes**
from production Firestore mode. Migration is an explicit operator action, not
automatic: `node review-app/migrate-assessments.mjs --check` validates the sealed
source without cloud access or writes; `node review-app/migrate-assessments.mjs --apply`
migrates it with server credentials, leaving the source unchanged. See
[storage and migration details](../README.md#private-storage-and-audit).
On November 11, 2026, the 13 existing revisions for one case were migrated and
verified. A second migration skipped all 13, with no duplicates or overwrites.

Collection security is deployed through the separate firebase.review-rules.json
configuration and firestore.review.rules. The previous deployed policy allowed
public reads and writes globally. It was privately backed up, then narrowed so
**afrooz-review and every revision subcollection deny all client access** while
other collections retain their prior behavior. Server IAM credentials bypass
client rules. An anonymous read of the migrated assessment was verified as 403.
Do not restore the old catch-all rule: Firestore combines matching allows with OR,
so adding a separate deny block would not protect these assessments.

Verification: `node review-app/orthanc/verify-review-api.mjs` checks live CORS,
authentication, frame metadata and CSRF rejection without saving. Run
`node review-app/verify-hosted.mjs` to check real hosted sign-in and image
navigation; it blocks assessment writes and checks the prior journal is unchanged
(that journal check alone does not verify Firestore state).
The isolated regression tests exercise successful saves/finalization separately.

The Mac must remain awake with **both Docker and the Node review backend running**.
The Node process currently runs in a terminal; it does not auto-start on reboot.
Images are currently decoded from the original frozen local files by the Python
worker, not downloaded from Orthanc. Both use the same frozen 28-case cohort;
there has been no pixel-source migration. Assessment storage is separate from
image hosting; newly saved assessments never append to the local journal.
