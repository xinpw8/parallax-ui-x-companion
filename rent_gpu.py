
import subprocess
import json
import time
import sys

def get_offers():
    cmd = [
        "/home/daa/.pyenv/versions/parallax/bin/vastai", 
        "search", "offers", 
        "gpu_name=RTX_4090 num_gpus=1 geolocation=US reliability > 0.9", 
        "-o", "dph", 
        "--raw"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        # The output might be a list of JSON objects or a single JSON list
        # We need to handle potential parsing errors
        try:
            offers = json.loads(result.stdout)
            return offers
        except json.JSONDecodeError:
            print("Failed to parse JSON directly. Trying to fix common issues.")
            # sometimes vastai returns concatenated jsons or other weirdness
            return []
    except Exception as e:
        print(f"Error getting offers: {e}")
        return []

def rent_instance(offer_id):
    print(f"Attempting to rent offer {offer_id}...")
    cmd = [
        "/home/daa/.pyenv/versions/parallax/bin/vastai", 
        "create", "instance", 
        str(offer_id), 
        "--image", "pytorch/pytorch", 
        "--disk", "60", 
        "--ssh"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if "started" in result.stdout or "'success': True" in result.stdout:
        print(f"Successfully rented instance {offer_id}!")
        print(result.stdout)
        return True
    else:
        print(f"Failed to rent {offer_id}: {result.stdout.strip()}{result.stderr.strip()}")
        return False

def main():
    print("Searching for RTX 4090 offers in US...")
    offers = get_offers()
    print(f"Found {len(offers)} offers.")
    
    # Sort by dph (dollars per hour)
    offers.sort(key=lambda x: x.get('dph', 999))
    
    for offer in offers:
        offer_id = offer.get('id')
        price = offer.get('dph')
        loc = offer.get('geolocation', 'Unknown')
        print(f"Trying offer {offer_id} at ${price}/hr in {loc}")
        
        if rent_instance(offer_id):
            print("SUCCESS! Instance rented.")
            # ID is usually in the output as 'new_contract': ID
            # We'll just exit 0 and let the user check status
            sys.exit(0)
        
        time.sleep(1) # don't spam too hard

    print("Could not rent any instance.")
    sys.exit(1)

if __name__ == "__main__":
    main()
