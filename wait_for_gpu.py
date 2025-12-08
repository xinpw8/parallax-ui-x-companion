
import subprocess
import time
import json

def check_status():
    cmd = ["/home/daa/.pyenv/versions/parallax/bin/vastai", "show", "instances", "--raw"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        # Handle the concatenated JSON issue vastai sometimes has
        raw_json = res.stdout.strip()
        # If multiple objects, wrap them in brackets or take the last one? 
        # Usually it returns a list.
        data = json.loads(raw_json)
        for inst in data:
            if inst['id'] == 28600842:
                return inst['cur_state'] # 'running' is what we want
    except Exception:
        pass
    return "unknown"

print("Waiting for instance 28600842 to become ready...")
while True:
    state = check_status()
    print(f"Current state: {state}")
    if state == "running":
        print("Instance is RUNNING!")
        break
    time.sleep(5)
