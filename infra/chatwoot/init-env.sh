#!/usr/bin/env bash
# Tạo .env từ .env.example và sinh các secret ngẫu nhiên. Không ghi đè .env đã có.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  echo ".env đã tồn tại, bỏ qua." >&2
  exit 0
fi

secret_key_base=$(openssl rand -hex 64)
postgres_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)

sed \
  -e "s|^SECRET_KEY_BASE=.*|SECRET_KEY_BASE=${secret_key_base}|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${postgres_password}|" \
  -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${redis_password}|" \
  .env.example > .env
chmod 600 .env
echo "Đã tạo infra/chatwoot/.env"
