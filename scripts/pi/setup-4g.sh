#!/usr/bin/env bash
# Modem USB 4G: NetworkManager crea un perfil genérico GSM.
# Ajustá APN según el operador (AR: internet / wap / datos.personal.com / igprs.claro.com.ar).
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Corré este script con sudo."
  exit 1
fi

APN="${1:-internet}"
CON_NAME="${CON_NAME:-alonso-4g}"

echo "Dispositivos USB:"
lsusb || true
echo
echo "Interfaces de red:"
ip -br link || true

if ! command -v nmcli >/dev/null 2>&1; then
  echo "NetworkManager no está instalado."
  exit 1
fi

nmcli radio wwan on || true

if nmcli -t connection show | grep -q "^${CON_NAME}:"; then
  nmcli connection delete "${CON_NAME}" || true
fi

# gsm: NetworkManager detecta el modem (ModemManager). Si el stick aparece como ttyUSB, MM lo toma.
nmcli connection add type gsm ifname "*" con-name "${CON_NAME}" apn "${APN}" \
  connection.autoconnect yes || true

nmcli connection up "${CON_NAME}" || {
  echo
  echo "No subió solo. Pasos manuales:"
  echo "  1) sudo mmcli -L          # ver modem"
  echo "  2) sudo mmcli -m 0        # estado"
  echo "  3) Editar APN: sudo nmcli connection modify ${CON_NAME} gsm.apn TU_APN"
  echo "  4) sudo nmcli connection up ${CON_NAME}"
  echo "  5) ping -c 3 1.1.1.1"
  exit 1
}

echo "4G arriba. Ruta por defecto:"
ip route | head -n 5
curl -fsS --max-time 10 https://ifconfig.me && echo
