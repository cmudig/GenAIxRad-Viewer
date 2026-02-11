# PSC (Bridges2) Orthanc + OHIF (ngrok) Setup

This guide documents the exact steps we used to run Orthanc on Bridges2 without sudo and expose it to a Firebase-hosted OHIF viewer via ngrok.

## Summary

- Orthanc runs in user space under `/jet/home/morrisok/orthanc/`.
- DICOMweb is provided by the Orthanc DICOMweb plugin.
- Orthanc is bound to `127.0.0.1:8042` (not publicly reachable).
- ngrok creates a public HTTPS tunnel to `localhost:8042`.
- OHIF points at the ngrok URL and uses Basic Auth.

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

## 5) Install and run ngrok on Bridges2

```bash
mkdir -p /jet/home/morrisok/bin
cd /jet/home/morrisok/bin
curl -L -o ngrok.tgz https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar -xzf ngrok.tgz

# Authenticate ngrok
Go to https://dashboard.ngrok.com/get-started/setup/linux and copy the line that shows:
./ngrok config add-authtoken YOUR_NGROK_TOKEN

# Start tunnel (with Basic Auth)
tmux new -s ngrok
/jet/home/morrisok/bin/ngrok http 8042 --basic-auth="ohif:YOUR_STRONG_PASSWORD"
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

That forwards to `http://localhost:8042` on the HPC.


## 7) Update OHIF to use the ngrok URL

Edit `platform/app/public/config/default.js` and set the DICOMweb roots to the ngrok URL. Example:

```js
wadoUriRoot: 'https://stanford-nonconceptual-intemperately.ngrok-free.dev/wado',
qidoRoot: 'https://stanford-nonconceptual-intemperately.ngrok-free.dev/dicom-web',
wadoRoot: 'https://stanford-nonconceptual-intemperately.ngrok-free.dev/dicom-web',
requestOptions: {
  auth: 'ohif:YOUR_STRONG_PASSWORD',
},
```

Notes:
- The ngrok URL changes whenever ngrok restarts (free plan). Update config accordingly.
- Basic Auth credentials in a static frontend are visible to users. Keep the app restricted if data is sensitive.

## 8) Redeploy Firebase hosting

Redeploy your Firebase frontend after updating the config.

## Troubleshooting

- `Inexistent path to plugins`: check `Plugins` path in `orthanc.json` and ensure the file exists.
- `SQLite: Unable to open the database`: ensure `index` and `data` dirs exist and are writable.
- `curl http://<ngrok-url>` fails: make sure ngrok is running and Orthanc is still running.
