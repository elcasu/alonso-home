#!/usr/bin/env bash
# Une la Pi a Tailscale para entrar por SSH desde afuera.
# El 4G está detrás de CGNAT: este túnel sale, no escucha puertos.
#
#   export TAILSCALE_AUTH_KEY='tskey-auth-...'
#   sudo --preserve-env=TAILSCALE_AUTH_KEY bash scripts/pi/setup-tailscale.sh
#
# Después, en la consola de Tailscale: aprobar la ruta 192.168.4.0/24
# y desactivar el vencimiento de la key de alonso-pi.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  echo "  export TAILSCALE_AUTH_KEY='tskey-auth-...'"
  echo "  sudo --preserve-env=TAILSCALE_AUTH_KEY bash scripts/pi/setup-tailscale.sh"
  exit 1
fi

if [[ -z "${TAILSCALE_AUTH_KEY:-}" ]]; then
  echo "Falta TAILSCALE_AUTH_KEY. sudo no hereda el entorno solo:"
  echo "  export TAILSCALE_AUTH_KEY='tskey-auth-...'"
  echo "  sudo --preserve-env=TAILSCALE_AUTH_KEY bash scripts/pi/setup-tailscale.sh"
  exit 1
fi

HOSTNAME="${TAILSCALE_HOSTNAME:-alonso-pi}"
ROUTES="${TAILSCALE_ROUTES:-192.168.4.0/24}"

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

systemctl enable --now tailscaled

sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" >/etc/sysctl.d/99-alonso-ipforward.conf

tailscale up \
  --auth-key="${TAILSCALE_AUTH_KEY}" \
  --hostname="${HOSTNAME}" \
  --ssh \
  --advertise-routes="${ROUTES}" \
  --accept-dns=true

echo
echo "Tailscale arriba como ${HOSTNAME}."
echo "En la consola: aprobá la ruta ${ROUTES} y desactivá el vencimiento de la key."
echo
tailscale status
