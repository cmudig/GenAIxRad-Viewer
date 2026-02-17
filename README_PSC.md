# PSC (Bridges2) Orthanc + OHIF (ngrok) Setup

This guide documents the exact steps we used to run Orthanc on Bridges2 without sudo and expose it to a Firebase-hosted OHIF viewer via ngrok.

## Summary

- Orthanc runs in user space under `/jet/home/morrisok/orthanc/`.
- DICOMweb is provided by the Orthanc DICOMweb plugin.
- Orthanc is bound to `127.0.0.1:8042` (not publicly reachable).
- OHIF should proxy `/pacs/dicom-web` to local Orthanc so Orthanc credentials stay server-side.
- ngrok should expose the OHIF server port (usually `3000`), not Orthanc directly.

## 1) Install Orthanc (no sudo, user space)

```bash
mkdir -p /jet/home/morrisok/orthanc/{bin,plugins,data,index}

# Orthanc server binary (LSB)
curl -L -o /jet/home/morrisok/orthanc/bin/Orthanc \
  https://orthanc.uclouvain.be/downloads/linux-standard-base/orthanc/1.12.1/Orthanc

# DICOMweb plugin (LSB)
curl -L -o /jet/home/morrisok/orthanc/plugins/libOrthancDicomWeb.so \
  https://orthanc.uclouvain.be/downloads/linux-standard-base/orthanc-dicomweb/1.12/libOrthancDicomWeb.so

chmod +x /jet/home/morrisok/orthanc/bin/Orthanc
chmod -R u+rwX /jet/home/morrisok/orthanc/index /jet/home/morrisok/orthanc/data
```

## 2) Create Orthanc config

Create `/jet/home/morrisok/orthanc/orthanc.json` with:

```json
{
  "Name": "GPU-Orthanc",
  "StorageDirectory": "/jet/home/morrisok/orthanc/data",
  "IndexDirectory": "/jet/home/morrisok/orthanc/index",

  "HttpServerEnabled": true,
  "HttpAddress": "127.0.0.1",
  "HttpPort": 8042,

  "RemoteAccessAllowed": false,
  "AuthenticationEnabled": true,
  "RegisteredUsers": {
    "ohif": "YOUR_STRONG_PASSWORD"
  },

  "Plugins": [
    "/jet/home/morrisok/orthanc/plugins/libOrthancDicomWeb.so"
  ],

  "DicomWeb": {
    "Enable": true,
    "Root": "/dicom-web/",
    "EnableWado": true,
    "WadoRoot": "/wado",
    "Host": "localhost:8042",
    "Ssl": false
  }
}
```

## 3) Run Orthanc in the background (optional)

```bash
tmux new -s orthanc
/jet/home/morrisok/orthanc/bin/Orthanc /jet/home/morrisok/orthanc/orthanc.json
# Detach: Ctrl-b then d
```

Reattach later:

```bash
tmux attach -t orthanc
```

## 4) Import DICOMs into Orthanc

```bash
find /media/volume/GenAIxRadViewer/dicom -type f -name "*.dcm" -print0 \
  | xargs -0 -n 1 -P 4 curl -sS -u ohif:YOUR_STRONG_PASSWORD \
    -H "Expect:" -X POST http://127.0.0.1:8042/instances --data-binary @-
```

Verify:

```bash
curl -u ohif:YOUR_STRONG_PASSWORD http://127.0.0.1:8042/dicom-web/studies
```

### If you see "Received an empty DICOM file" / 400 errors

This usually happens when the parallel `xargs` pipeline sends empty input. Use this safer loop:

```bash
DIR="/jet/home/morrisok/AI moderate pleural effusion in the left lung with signs of atelectasis"

find "$DIR" -type f -name "*.dcm" -print0 \
  | while IFS= read -r -d '' f; do
      curl -sS -u ohif:YOUR_STRONG_PASSWORD \
        -H "Expect:" -X POST http://127.0.0.1:8042/instances --data-binary @"$f"
    done
```

You can also test a single file first:

```bash
FILE="/jet/home/morrisok/AI moderate pleural effusion in the left lung with signs of atelectasis/AI000008.dcm"

curl -v -u ohif:YOUR_STRONG_PASSWORD \
  -H "Expect:" -X POST http://127.0.0.1:8042/instances --data-binary @"$FILE"
```

## 5) Start OHIF with server-side proxy auth

From this repository, run OHIF so that it proxies DICOMweb requests to local Orthanc and injects Orthanc Basic Auth on the server side:

```bash
cd /path/to/GenAIxRad-Viewer

# Keep this in your shell only (do not commit it in config files)
export PROXY_BASIC_AUTH='ohif:YOUR_STRONG_PASSWORD'

yarn --cwd platform/app dev:orthanc
```

`dev:orthanc` already sets:
- `APP_CONFIG=config/docker-nginx-orthanc.js`
- browser-facing DICOMweb URLs to `/pacs/dicom-web` (relative path)
- webpack dev proxy from `/pacs/dicom-web` to `http://localhost:8042/dicom-web`

With `PROXY_BASIC_AUTH` set, the browser never sees Orthanc credentials.

## 6) Install and run ngrok on Bridges2 (tunnel OHIF, not Orthanc)

```bash
mkdir -p /jet/home/morrisok/bin
cd /jet/home/morrisok/bin
curl -L -o ngrok.tgz https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar -xzf ngrok.tgz

# Authenticate ngrok
Go to https://dashboard.ngrok.com/get-started/setup/linux and copy the line that shows:
./ngrok config add-authtoken YOUR_NGROK_TOKEN

# Start tunnel to OHIF (with Basic Auth at ngrok edge)
tmux new -s ngrok
ngrok http 8080 --basic-auth="viewer:ANOTHER_STRONG_PASSWORD"
# Detach: Ctrl-b then d
```

Reattach later:

```bash
tmux attach -t ngrok
```

ngrok prints a public URL like:

```
https://stanford-nonconceptual-intemperately.ngrok-free.dev
```

That forwards to `http://localhost:3000` on the HPC.


## 7) Frontend config (no plaintext credentials)

Use relative roots (already configured in `config/docker-nginx-orthanc.js`, and now in `config/default.js`):

```js
wadoUriRoot: '/wado',
qidoRoot: '/pacs/dicom-web',
wadoRoot: '/pacs/dicom-web',
```

Notes:
- No Orthanc password is stored in frontend JS.
- ngrok Basic Auth and Orthanc Basic Auth are separate credentials.
- The ngrok URL changes whenever ngrok restarts (free plan), but OHIF API paths stay relative so config usually does not need edits.

## 8) Frontend: Redeploy Firebase hosting

Redeploy your Firebase frontend after updating the config.

## 9) Firebase server-side proxy (required when ngrok uses Basic Auth)

If the frontend is hosted on Firebase and Orthanc/nginx are exposed through ngrok with Basic Auth, route DICOMweb through a Firebase Function so the browser does not call ngrok directly.

The viewer config should use:

```js
wadoUriRoot: '/api/wado',
qidoRoot: '/api/dicom-web',
wadoRoot: '/api/dicom-web',
```

Set Firebase Function secrets:

```bash
firebase functions:secrets:set NGROK_BASE_URL
# value example: https://scarlett-progambling-uneccentrically.ngrok-free.dev

firebase functions:secrets:set NGROK_BASIC_AUTH
# value example: viewer:YOUR_NGROK_PASSWORD

firebase functions:secrets:set STUDY_USERNAME
# value example: studyuser

firebase functions:secrets:set STUDY_PASSWORD
# value example: STRONG_PASSWORD

firebase functions:secrets:set SESSION_SECRET
# value example: a long random string
```

Install function dependencies and deploy:

```bash
cd functions
yarn install
cd ..

firebase deploy --only functions,hosting
```

### Shared login gate for asynchronous studies

`/login` now checks a shared username/password via `/auth/login` in Firebase Functions.
On success, a secure HttpOnly session cookie is set, and `/api/*` requests are allowed only with a valid session.
To revoke all sessions quickly, rotate `SESSION_SECRET`.

## Troubleshooting

- `Inexistent path to plugins`: check `Plugins` path in `orthanc.json` and ensure the file exists.
- `SQLite: Unable to open the database`: ensure `index` and `data` dirs exist and are writable.
- `curl http://<ngrok-url>` fails: make sure ngrok is running and Orthanc is still running.

## Next Session Checklist (Server + Deployed Frontend)

Use this exact order next time you need to bring everything up.

1) SSH to Bridges2:

```bash
ssh morrisok@bridges2.psc.edu
```

2) Start Orthanc:

```bash
/jet/home/morrisok/orthanc/bin/Orthanc /jet/home/morrisok/orthanc/orthanc.json
```

3) Start or reload nginx (user-space build):

```bash
$HOME/nginx/sbin/nginx -p $HOME/nginx -c conf/nginx.conf -t
$HOME/nginx/sbin/nginx -p $HOME/nginx -c conf/nginx.conf
```

If nginx is already running, reload instead:

```bash
$HOME/nginx/sbin/nginx -p $HOME/nginx -c conf/nginx.conf -s reload
```

4) Verify local proxy works without passing auth from curl:

```bash
curl -i http://127.0.0.1:8080/dicom-web/studies
```

5) Start ngrok against nginx (not Orthanc):

```bash
/jet/home/morrisok/bin/ngrok http 8080 --basic-auth="viewer:YOUR_VIEWER_PASSWORD"
```

6) If ngrok URL changes, update Firebase Function secret (frontend config stays `/api/...`):

```bash
firebase functions:secrets:set NGROK_BASE_URL
# value: https://<NEW_NGROK_URL>

firebase deploy --only functions:apiProxy
```

7) From local machine, rebuild + redeploy Firebase hosting:

```bash
cd /Users/katelynmorrison/Documents/GitHub/GenAIxRad-Viewer
yarn --cwd platform/app build:viewer
firebase deploy --only hosting
```

8) Validate deployed app:
- Open deployed site.
- Confirm studies load.
- Confirm network calls to `https://<NEW_NGROK_URL>/dicom-web/...` return `200`.

### Stop Commands

Stop nginx:

```bash
$HOME/nginx/sbin/nginx -p $HOME/nginx -c conf/nginx.conf -s stop
```

Stop ngrok:

```bash
pkill ngrok
```
