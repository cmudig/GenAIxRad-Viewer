# Orthanc on this computer, through Squarespace DNS

No Google Cloud VM or router port forwarding is required. The source remains
http://127.0.0.1:8043. Never expose the DICOM TCP port or the unauthenticated
Orthanc HTTP port directly.

## Account and DNS prerequisites

1. Configure your ngrok agent authtoken directly in the terminal. Do not put
   tokens in chat, git, screenshots, or these source files.
2. In https://dashboard.ngrok.com/domains reserve
   `orthanc.katelynmorrison.com`. Current ngrok documentation requires the
   Pay-as-you-go plan for custom domains. Do not purchase a plan automatically.
3. Copy the exact CNAME target ngrok assigns. In Squarespace Domains replace
   only the old `orthanc` A record with a CNAME named `orthanc`, pointing to
   that target. An A and CNAME cannot coexist for the same name. Preserve all
   other DNS and email records. Do not guess the CNAME target.
4. Wait for ngrok's certificate status to be ready. Do not bypass TLS warnings.

## Start and stop

From the repository root, run `node review-app/orthanc/start-ngrok.mjs`.
The launcher always attaches the OAuth policy; do not start a bare unprotected
ngrok tunnel. Ctrl+C stops the endpoint without deleting any images.

The policy allows Google account `katelyncmorrison98@gmail.com` only. No
collaborator address has been supplied yet. Add the approved address explicitly
to the email list in ngrok-policy.json before sharing. Google sign-in by itself
is NOT sufficient; the email allowlist must stay enabled.

External requests are read-only (GET and HEAD). Uploads, deletes, modifications,
and POST searches are denied even to the approved account. Some Orthanc UI
operations will therefore intentionally fail. Local administration stays local.
The account can read all contents of this isolated Orthanc; do not import
unrelated studies without revisiting the access design.

Local ngrok HTTP payload inspection is disabled. This does not claim that
ngrok cloud logging or processing is disabled; review account retention and
institutional data-handling requirements separately. HTTPS terminates at ngrok.

## Verify before sharing

- An unauthenticated GET to `/system`, `/instances`, and `/dicom-web/studies`
  must redirect to authentication or deny access, never return image metadata.
- A signed-in, unapproved Google account must get 403.
- The approved account must be able to browse and retrieve images.
- POST and DELETE must remain denied. Do not test destructive requests against
  a live resource; validate policy denial using a nonexistent path.
- Confirm local Orthanc still has 28 series / 7,168 instances.

The computer must remain powered on and awake; Docker and ngrok must run.
Automatic login/startup is intentionally not installed until account, DNS,
authentication, and denial checks succeed.

## Scope

This publishes Orthanc only. The review UI on port 4318 is still local-only,
is not connected to Orthanc, and has localhost security assumptions. Do not
tunnel that port without a separate remote-access implementation.

References: https://ngrok.com/docs/universal-gateway/custom-domains and
https://ngrok.com/docs/traffic-policy/actions/oauth
