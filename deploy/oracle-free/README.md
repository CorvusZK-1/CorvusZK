# Deploy the "Run it live" server on Oracle Cloud Always Free

Why this host: the server needs about **2.2 GB RAM while a run is proving** (measured 12 Nov 2026: proof server 1.5 GB + live server 0.65 GB), so plan for 3 GB or more. Oracle's Always Free Ampere A1 shape gives up to 4 OCPU / 24 GB at $0. The free tiers of Render and Koyeb (512 MB) are too small, and Hugging Face now needs a paid PRO plan for Docker Spaces.

## Sign-up (owner does this once)
1. Create an account at https://signup.cloud.oracle.com (email, phone, home region; pick one with A1 capacity, e.g. US West Phoenix or San Jose).
2. Oracle asks for a **credit or debit card for identity verification**. Always Free resources are not charged; stay on "Always Free" and do not click "Upgrade to Pay As You Go".
3. No GitHub login is needed for Oracle.

## Steps
1. Compute → Instances → Create: image Ubuntu 24.04, shape **VM.Standard.A1.Flex, 2 OCPU / 12 GB** (Always Free eligible). Add your SSH key.
2. Networking: open TCP 80 and 443 in the subnet's security list (and `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT` on Ubuntu images).
3. DNS: add an A record `live.corvuszk.com` → the instance's public IP.
4. On the VM:
   ```bash
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
   git clone https://github.com/CorvusZK-1/CorvusZK && cd CorvusZK/deploy/oracle-free
   mkdir -p wallet && chmod 700 wallet   # copy the Preview test wallet file in as wallet/.wallets.preview.json, chmod 600
   sudo LIVE_HOST=live.corvuszk.com docker compose up -d --build
   curl https://live.corvuszk.com/api/health
   ```
5. Set `<meta name="corvus-api" content="https://live.corvuszk.com">` in `docs/app/index.html` and push.

## Wallet
Use a dedicated Preview test wallet funded from the Preview faucet with tNIGHT registered for DUST. Never a real wallet. Each run spends a few tDUST; the limits (6 runs/hour, 2 per visitor) keep it inside what the wallet regenerates.
