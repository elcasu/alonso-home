#!/usr/bin/env bash
# Aprovisiona AWS IoT Core para el módulo de cámaras:
#   Pi ──MQTT/TLS(8883, cert X.509)──▶ AWS IoT ──regla HTTP──▶ panel /api/device/camera-events
#                                           └──▶ otras apps: suscribirse a  alonso/home/camera/+/+
#
# Uso:
#   AWS_REGION=us-east-2 PANEL_URL=https://tu-app.vercel.app DEVICE_TOKEN=... bash deploy/aws-iot/setup.sh
#
# Requiere AWS CLI v2 con credenciales (aws configure). Es idempotente: si algo ya existe lo reutiliza.
# Deja en deploy/aws-iot/out/ (ignorado por git): device.pem.crt, private.pem.key, AmazonRootCA1.pem y env.snippet.
# Copiá esos tres archivos a apps/pi-agent/certs/ en la Pi y pegá env.snippet en su .env.
set -euo pipefail

REGION="${AWS_REGION:-us-east-2}"
THING="${THING_NAME:-alonso-pi}"
POLICY="${POLICY_NAME:-alonso-pi-camera-publish}"
RULE="${RULE_NAME:-alonso_camera_to_panel}"
PANEL_URL="${PANEL_URL:?Definí PANEL_URL (https://tu-app.vercel.app)}"
DEVICE_TOKEN="${DEVICE_TOKEN:?Definí DEVICE_TOKEN (el mismo que usa el panel)}"
PANEL_URL="${PANEL_URL%/}"
ENDPOINT_URL="${PANEL_URL}/api/device/camera-events"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${HERE}/out"
AWS="aws --region ${REGION}"

[[ "${PANEL_URL}" == https://* ]] || { echo "PANEL_URL debe ser https:// (AWS IoT no entrega a HTTP plano)."; exit 1; }

ACCOUNT="$(${AWS} sts get-caller-identity --query Account --output text)"
mkdir -p "${OUT}"
chmod 700 "${OUT}"
echo "Cuenta ${ACCOUNT}, región ${REGION}"

# 1) Thing
${AWS} iot describe-thing --thing-name "${THING}" >/dev/null 2>&1 \
  || ${AWS} iot create-thing --thing-name "${THING}" >/dev/null
echo "Thing: ${THING}"

# 2) Política (mínimo privilegio: conectarse como ${THING} y publicar solo en alonso/home/camera/*)
POLICY_DOC="$(sed -e "s|__REGION__|${REGION}|g" -e "s|__ACCOUNT__|${ACCOUNT}|g" -e "s|__CLIENT_ID__|${THING}|g" "${HERE}/policy.json")"
if ${AWS} iot get-policy --policy-name "${POLICY}" >/dev/null 2>&1; then
  # IoT admite hasta 5 versiones; borramos las no-default viejas antes de crear otra.
  for v in $(${AWS} iot list-policy-versions --policy-name "${POLICY}" --query 'policyVersions[?!isDefaultVersion].versionId' --output text); do
    ${AWS} iot delete-policy-version --policy-name "${POLICY}" --policy-version-id "${v}" >/dev/null
  done
  ${AWS} iot create-policy-version --policy-name "${POLICY}" --policy-document "${POLICY_DOC}" --set-as-default >/dev/null
else
  ${AWS} iot create-policy --policy-name "${POLICY}" --policy-document "${POLICY_DOC}" >/dev/null
fi
echo "Política: ${POLICY}"

# 3) Certificado del dispositivo (solo si no hay uno ya generado acá)
if [[ ! -f "${OUT}/device.pem.crt" ]]; then
  CERT_ARN="$(${AWS} iot create-keys-and-certificate --set-as-active \
    --certificate-pem-outfile "${OUT}/device.pem.crt" \
    --public-key-outfile "${OUT}/public.pem.key" \
    --private-key-outfile "${OUT}/private.pem.key" \
    --query certificateArn --output text)"
  chmod 600 "${OUT}/private.pem.key"
  ${AWS} iot attach-policy --policy-name "${POLICY}" --target "${CERT_ARN}"
  ${AWS} iot attach-thing-principal --thing-name "${THING}" --principal "${CERT_ARN}"
  echo "Certificado nuevo: ${CERT_ARN}"
else
  echo "Reutilizando certificado de ${OUT}/device.pem.crt"
fi
[[ -f "${OUT}/AmazonRootCA1.pem" ]] \
  || curl -fsSL https://www.amazontrust.com/repository/AmazonRootCA1.pem -o "${OUT}/AmazonRootCA1.pem"

# 4) Destino HTTP de la regla. AWS manda un POST de confirmación al panel; el panel lo contesta solo
#    (ver apps/web/src/lib/iot.ts). Hay que tener el panel desplegado con DEVICE_TOKEN antes de correr esto.
DEST_ARN="$(${AWS} iot list-topic-rule-destinations \
  --query "destinationSummaries[?httpUrlSummary.confirmationUrl=='${ENDPOINT_URL}'].arn | [0]" --output text)"
if [[ "${DEST_ARN}" == "None" || -z "${DEST_ARN}" ]]; then
  DEST_ARN="$(${AWS} iot create-topic-rule-destination \
    --destination-configuration "httpUrlConfiguration={confirmationUrl=${ENDPOINT_URL}}" \
    --query topicRuleDestination.arn --output text)"
  echo "Destino creado: ${DEST_ARN}"
fi
for i in $(seq 1 20); do
  STATUS="$(${AWS} iot get-topic-rule-destination --arn "${DEST_ARN}" --query topicRuleDestination.status --output text)"
  [[ "${STATUS}" == "ENABLED" ]] && break
  echo "  destino ${STATUS}... (${i}/20)"
  sleep 3
done
if [[ "${STATUS}" != "ENABLED" ]]; then
  echo "El destino no quedó ENABLED (${STATUS}). ¿El panel responde en ${ENDPOINT_URL}? Revisá los logs de Vercel y reintentá."
  exit 1
fi

# 5) Regla: todo lo que se publique en alonso/home/camera/<id>/(event|status) va al panel
RULE_FILE="${OUT}/rule.json"
cat >"${RULE_FILE}" <<EOF
{
  "sql": "SELECT * FROM 'alonso/home/camera/+/+'",
  "awsIotSqlVersion": "2016-03-23",
  "ruleDisabled": false,
  "actions": [
    {
      "http": {
        "url": "${ENDPOINT_URL}",
        "confirmationUrl": "${ENDPOINT_URL}",
        "headers": [
          { "key": "authorization", "value": "Bearer ${DEVICE_TOKEN}" },
          { "key": "content-type", "value": "application/json" }
        ]
      }
    }
  ]
}
EOF
chmod 600 "${RULE_FILE}"
if ${AWS} iot get-topic-rule --rule-name "${RULE}" >/dev/null 2>&1; then
  ${AWS} iot replace-topic-rule --rule-name "${RULE}" --topic-rule-payload "file://${RULE_FILE}"
else
  ${AWS} iot create-topic-rule --rule-name "${RULE}" --topic-rule-payload "file://${RULE_FILE}"
fi
echo "Regla: ${RULE}"

IOT_ENDPOINT="$(${AWS} iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)"
cat >"${OUT}/env.snippet" <<EOF
# Pegar en apps/pi-agent/.env (y copiar los .pem/.key a apps/pi-agent/certs/)
IOT_ENDPOINT=${IOT_ENDPOINT}
IOT_CLIENT_ID=${THING}
CAMERA_SINK=iot
CAMERAS=[{"id":"entrada","host":"192.168.100.206","user":"admin","password":""}]
EOF
echo
echo "Listo. Endpoint MQTT: ${IOT_ENDPOINT}"
echo "Archivos en ${OUT}  →  copiá device.pem.crt, private.pem.key y AmazonRootCA1.pem a apps/pi-agent/certs/ en la Pi."
echo "Probá desde la consola AWS IoT > Test > Subscribe a  alonso/home/camera/#"
