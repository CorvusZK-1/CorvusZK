#!/usr/bin/env bash
# CorvusZK Preprod pipeline checker: idempotent. Re-creates what a box reboot wipes, then resumes the
# deploy (from the saved wallet snapshot) and the XRPL e2e. Safe to run any time. Prints no secrets.
set -u; cd "$(dirname "$0")"; mkdir -p logs; N=/home/box/node22/bin/node
export PATH=/home/box/node22/bin:$PATH
if [ ! -x "$N" ]; then V=$(curl -s https://nodejs.org/dist/index.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).find(x=>x.version.startsWith('v22')).version))" 2>/dev/null || echo v22.23.4)
  curl -sfL https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz -o /tmp/n22.tar.xz && mkdir -p /home/box/node22 && tar -xJf /tmp/n22.tar.xz -C /home/box/node22 --strip-components=1; fi
[ -d node_modules/@midnightntwrk/wallet-sdk ] || npm ci >logs/npm.log 2>&1  # ledger 9 SDK set (Wallet SDK 2.0.0, Midnight.js 5.0.0)
[ -d ../node_modules/xrpl ] || (cd .. && npm ci >midnight/logs/npm-root.log 2>&1)
[ -f ../dist/midnight-config.js ] || (cd .. && npm run build >/dev/null 2>&1)
PS_URL=${MIDNIGHT_PROOF_SERVER:-http://localhost:6300}
if ! curl -s -m3 $PS_URL/version | grep -q "^9\."; then  # ledger 9 needs proof server 9.0.0
  command -v docker >/dev/null || (cd /tmp && curl -sfL https://download.docker.com/linux/static/stable/x86_64/docker-27.3.1.tgz -o d.tgz && tar xzf d.tgz && sudo cp docker/* /usr/local/bin/)
  pgrep dockerd >/dev/null || (sudo nohup dockerd --iptables=false --bridge=none >/tmp/dockerd.log 2>&1 &) ; sleep 6
  sudo docker start ps9 >/dev/null 2>&1 || sudo docker run -d --name ps9 --network host midnightntwrk/proof-server:9.0.0 midnight-proof-server -v >/dev/null; sleep 8; fi
[ -n "${BLOCKFROST_MIDNIGHT_PREPROD:-}" ] || { echo "BLOCKFROST_MIDNIGHT_PREPROD not set"; exit 1; }
done_deploy=$($N -e "try{const d=require('./deployments.preprod.json');process.stdout.write(d.deployments?.condition?.call?.txHash?'yes':'no')}catch{process.stdout.write('no')}")
done_e2e=$($N -e "try{const d=require('./deployments.preprod.json');process.stdout.write(d.e2e?.xrplFinish?'yes':'no')}catch{process.stdout.write('no')}")
if pgrep -f "[n]ode .*deploy[.]mjs" >/dev/null; then echo "deploy running: $(tail -1 logs/deploy.log | cut -c1-160)";
elif [ "$done_deploy" = no ]; then echo "starting deploy (resumes from snapshot if present)"; [ -f logs/deploy.log ] && mv logs/deploy.log logs/deploy.$(date +%s).log
  nohup bash -c 'for i in $(seq 1 300); do '"$N"' --max-old-space-size=8192 deploy.mjs; rc=$?; [ $rc -eq 3 ] || exit $rc; echo "relaunch $i after stall"; sleep 20; done' >> logs/deploy.log 2>&1 &
elif [ "$done_e2e" = no ] && ! pgrep -f "[n]ode .*e2e-escrow" >/dev/null; then echo "running e2e"; nohup $N e2e-escrow.mjs > logs/e2e.log 2>&1 &
else echo "pipeline complete or e2e running"; fi
# chain e2e after deploy finishes
if ! pgrep -f "corvuszk-chain" >/dev/null; then nohup bash -c 'exec -a corvuszk-chain bash -c "while pgrep -f \"[n]ode .*deploy[.]mjs\" >/dev/null; do sleep 60; done; '"$0"'"' >/dev/null 2>&1 & fi
