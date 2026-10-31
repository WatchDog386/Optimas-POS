#!/usr/bin/env bash
# Deploy the latest code from GitHub — run this after every push:
#   cd ~/Optimas-POS && bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> git pull"
git pull --ff-only

echo "==> npm install"
npm install

echo "==> npm run build"
npm run build

echo "==> .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    created .env from .env.example"
fi
if ! grep -q '^PAY_ENDPOINT=' .env; then
  echo 'PAY_ENDPOINT=https://optimus.pinnovatech.co.ke/optimus/pay' >> .env
  echo "    added PAY_ENDPOINT to .env"
fi

if ! grep -q '^SETUP_CODE=.\+' .env; then
  # One-time code the owner enters on the first till to register staff with this server.
  sed -i '/^SETUP_CODE=/d' .env
  echo "SETUP_CODE=$(openssl rand -hex 4)-$(openssl rand -hex 4)" >> .env
  echo "    generated SETUP_CODE"
fi

echo "==> database migrations"
npm run db:migrate

echo "==> pm2 restart"
if pm2 list | grep -q "optimas-pos"; then
  pm2 restart optimas-pos --update-env
else
  pm2 start npm --name "optimas-pos" -- run server:start
fi
pm2 save >/dev/null

echo "==> health check"
ok=""
for i in $(seq 1 15); do
  if curl -sf http://localhost:8787/api/health; then ok=1; break; fi
  sleep 2
done
echo
if [ -z "$ok" ]; then
  echo "!!  The app is not answering on port 8787 — the website will show 502 Bad Gateway."
  echo "    Last log lines:"
  pm2 logs optimas-pos --lines 40 --nostream || true
  exit 1
fi
if ! systemctl list-unit-files 2>/dev/null | grep -q '^pm2-'; then
  echo "==> NOTE: pm2 is not set to start at boot — after a server restart the site shows 502."
  echo "    Run once:  pm2 startup   (then run the sudo command it prints)  and then:  pm2 save"
fi
if curl -sf -o /dev/null http://localhost:8787/print-agent/optimas-print-agent.ps1; then
  echo "    print agent installer file: OK"
else
  echo "    print agent file not served — check that dist/print-agent exists after the build"
fi
if curl -s http://localhost:8787/api/auth/status | grep -q '"setup":true'; then
  echo "==> No staff registered on the server yet."
  echo "    On the shop till: sign in as the owner, open Settings → Security → Shop server"
  echo "    and enter this setup code: $(grep '^SETUP_CODE=' .env | cut -d= -f2-)"
fi
echo "==> Done: https://pos.optimaswifi.co.ke"
