#!/usr/bin/env bash
set -euo pipefail

expected_ip="66.163.114.16"
apex_ip="$(dig +short A zktx.tech @1.1.1.1 | tail -n 1)"
www_ip="$(dig +short A www.zktx.tech @1.1.1.1 | tail -n 1)"

if [[ "$apex_ip" != "$expected_ip" || "$www_ip" != "$expected_ip" ]]; then
  exit 0
fi

certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  -d zktx.tech -d www.zktx.tech
