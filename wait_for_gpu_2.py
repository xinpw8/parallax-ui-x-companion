
import subprocess
import time
import json
import sys

instance_id = 28601048

def check_status():
    cmd = ["/home/daa/.pyenv/versions/parallax/bin/vastai", "show", "instances", "--raw"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True)
        raw_json = res.stdout.strip()
        data = json.loads(raw_json)
        for inst in data:
            if inst['id'] == instance_id:
                return inst
    except Exception:
        pass
    return None

print(f"Waiting for instance {instance_id} to become ready...")
while True:
    inst = check_status()
    if inst:
        state = inst.get('cur_state')
        print(f"Current state: {state}")
        if state == "running":
            print("Instance is RUNNING!")
            # Get SSH details
            print(f"SSH: {inst.get('ssh_host')}:{inst.get('ssh_port')}")
            break
    else:
        print("Instance not found in list yet...")
    
    time.sleep(5)
