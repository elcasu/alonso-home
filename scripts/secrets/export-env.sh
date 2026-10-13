#!/usr/bin/env bash
# Exporta secretos de Infisical a los .env locales (ignorados por git).
#
# Uso:
#   ./scripts/secrets/export-env.sh              # env=dev, todos los targets
#   ./scripts/secrets/export-env.sh prod         # env=prod
#   ./scripts/secrets/export-env.sh dev web      # solo apps/web
#   ./scripts/secrets/export-env.sh prod pi-agent homeassistant
#
# Targets: web | pi-agent | homeassistant | cameras | all
#
# Requiere: infisical CLI logueado + .infisical.json en la raíz del repo
# (infisical login && infisical init).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

ENV_NAME="${1:-${INFISICAL_ENV:-dev}}"
if [[ $# -gt 0 ]]; then
  shift
fi
if [[ $# -eq 0 || ( $# -eq 1 && "$1" == "all" ) ]]; then
  TARGETS=(web pi-agent homeassistant cameras)
else
  TARGETS=("$@")
fi

if ! command -v infisical >/dev/null 2>&1; then
  echo "Falta el CLI de Infisical. macOS: brew install infisical/get-cli/infisical" >&2
  exit 1
fi

if [[ ! -f "${ROOT}/.infisical.json" ]]; then
  echo "No hay .infisical.json. En la raíz del repo: infisical login && infisical init" >&2
  exit 1
fi

# Une dotenv de varios paths: shared primero; el path del target pisa claves repetidas.
# Escribe a un archivo destino (modo 600).
merge_export() {
  local dest="$1"
  shift
  local paths=("$@")
  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '${tmp}'" RETURN

  : >"${tmp}"
  local path
  for path in "${paths[@]}"; do
    # --silent evita tips en stdout (contaminarían el dotenv)
    if ! infisical export --env="${ENV_NAME}" --path="${path}" --format=dotenv --silent >>"${tmp}" 2>/dev/null; then
      # Path vacío o inexistente: aviso y seguimos (útil la primera vez)
      echo "  (aviso) sin secretos en ${path} para env=${ENV_NAME}" >&2
    fi
  done

  # Deduplicar: última definición gana (awk mantiene orden de primera aparición;
  # invertimos, dedupe, reinvertimos).
  local out
  out="$(mktemp)"
  awk -F= '
    /^[[:space:]]*$/ { next }
    /^#/ { next }
    NF < 1 { next }
    {
      key=$1
      # valor puede contener =
      val=substr($0, index($0,"=")+1)
      order[++n]=key
      vals[key]=val
      seen[key]=n
    }
    END {
      # reescribir en orden de última aparición
      delete last
      for (i=1; i<=n; i++) {
        k=order[i]
        last[k]=i
      }
      for (i=1; i<=n; i++) {
        k=order[i]
        if (last[k]==i) print k "=" vals[k]
      }
    }
  ' "${tmp}" >"${out}"

  if [[ ! -s "${out}" ]]; then
    echo "ABORT  ${dest}: Infisical no devolvió secretos (env=${ENV_NAME}). No se escribe el archivo." >&2
    rm -f "${out}"
    return 1
  fi

  mkdir -p "$(dirname "${dest}")"
  install -m 600 "${out}" "${dest}"
  rm -f "${out}"
  echo "OK  ${dest}  (env=${ENV_NAME})"
}

export_web() {
  # Next lee .env.local en desarrollo
  merge_export "${ROOT}/apps/web/.env.local" /shared /web
}

export_pi_agent() {
  merge_export "${ROOT}/apps/pi-agent/.env" /shared /pi-agent
}

export_homeassistant() {
  merge_export "${ROOT}/deploy/homeassistant/.env" /shared /homeassistant
}

export_cameras() {
  merge_export "${ROOT}/deploy/cameras/.env" /shared /cameras
}

for t in "${TARGETS[@]}"; do
  case "${t}" in
    web) export_web ;;
    pi-agent|pi) export_pi_agent ;;
    homeassistant|ha) export_homeassistant ;;
    cameras|frigate) export_cameras ;;
    *)
      echo "Target desconocido: ${t}" >&2
      echo "Usá: web | pi-agent | homeassistant | cameras | all" >&2
      exit 1
      ;;
  esac
done
