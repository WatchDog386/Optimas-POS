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
sleep 2
curl -s http://localhost:8787/api/health || echo "server not answering yet — check: pm2 logs optimas-pos --lines 30"
echo
if curl -s http://localhost:8787/api/auth/status | grep -q '"setup":true'; then
  echo "==> No staff registered on the server yet."
  echo "    On the shop till: sign in as the owner, open Settings → Security → Shop server"
  echo "    and enter this setup code: $(grep '^SETUP_CODE=' .env | cut -d= -f2-)"
fi
echo "==> Done: https://pos.optimaswifi.co.ke"
