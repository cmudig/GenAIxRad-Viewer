import requests
import urllib3

# ---- CONFIGURATION ----
ORTHANC_BASE = "https://orthanc.katelyncmorrison.com"
STUDY_ID     = "8022c382-9a178579-70170824-d040fc0e-12f6f132"
# your mapping of SeriesDescription -> prompt
PROMPT_MAP = {
    "Bilateral Moderate Pleural Effusion":
      "false",
    "Minimal Left":
      "false",
    "Bilateral minimal pleural effusion with no other associated findings, no cardiomegaly, no ground glass, no atelectasis, no nodules, no consolidation":
      "false",
    "Bilateral Large Pleural Effusion":
      "false",
    "Bilateral Moderate 2":
      "false",
    "Bilateral Moderate 3":
      "false",
    "Generation 4":
      "false",
    "Normal chest with no abnormalities present":
      "false",
}

# disable SSL warnings for -k
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def main():
    # 1) fetch the expanded series list
    url = f"{ORTHANC_BASE}/studies/{STUDY_ID}/series?expand"
    resp = requests.get(url, verify=False)
    resp.raise_for_status()
    series_list = resp.json()

    for series in series_list:
        sid  = series["ID"]
        desc = series.get("MainDicomTags",{}).get("SeriesDescription")
        prompt = PROMPT_MAP.get(desc)
        if not prompt:
            print(f"⚠️  no prompt defined for description: {desc!r}  (series {sid})")
            continue

        # 2) PUT the prompt
        put_url = f"{ORTHANC_BASE}/series/{sid}/metadata/ShowInHistoryFlag"
        p = requests.put(put_url,
                         data=prompt.encode("utf-8"),
                         headers={"Content-Type":"text/plain"},
                         verify=False)
        if p.ok:
            print(f"✅  set flag on {sid!r} → {desc!r}")
        else:
            print(f"❌  failed for {sid!r}: {p.status_code} {p.text}")

if __name__=="__main__":
    main()
