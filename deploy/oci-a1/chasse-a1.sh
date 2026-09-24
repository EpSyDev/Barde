#!/usr/bin/env bash
# Chasse à la capacité Oracle ARM A1 (Always Free) : retente la création de
# l'instance en boucle jusqu'à ce qu'une place se libère, puis s'arrête.
# Tourne sur la VM actuelle via chasse-a1.service. Config : ~/.oci/chasse-a1.env
#
# Codes de sortie : 0 = instance créée (ou déjà existante) ; 2 = erreur de config
# fatale (systemd ne relance pas) ; 1 = erreur inattendue (systemd relance).
set -uo pipefail

ENV_FILE="${ENV_FILE:-$HOME/.oci/chasse-a1.env}"
# shellcheck source=/dev/null
source "$ENV_FILE" || { echo "config introuvable : $ENV_FILE"; exit 2; }

OCI="${OCI:-$HOME/oci-venv/bin/oci}"
SHAPE="VM.Standard.A1.Flex"
CONFIGS="${CONFIGS:-4:24 2:12}"    # ocpus:mémoire_Go, du plus gros au plus petit
BOOT_GB="${BOOT_GB:-100}"          # 200 Go gratuits au total, VM actuelle incluse
INTERVAL="${INTERVAL:-90}"         # secondes entre deux tours (+ jitter)
NAME="${NAME:-barde-a1}"

log() { echo "[$(date '+%F %T')] $*"; }

notify() {
  [ -n "${DISCORD_WEBHOOK_URL:-}" ] || return 0
  curl -s -H "Content-Type: application/json" \
    -d "{\"content\": \"$1\"}" "$DISCORD_WEBHOOK_URL" > /dev/null
}

# Garde-fou anti-doublon : une A1 existe déjà (hors terminée) → rien à faire.
existing=$("$OCI" compute instance list --compartment-id "$COMPARTMENT_OCID" --all \
  --query "length(data[?shape=='$SHAPE' && \"lifecycle-state\"!='TERMINATED'])" \
  --raw-output 2>&1) || { log "lecture des instances impossible : $existing"; exit 2; }
if [ "$existing" != "0" ]; then
  log "une instance $SHAPE existe déjà — arrêt."
  exit 0
fi

# Résolus une seule fois : domaine de disponibilité (Marseille n'en a qu'un) et
# dernière image Ubuntu 24.04 compatible ARM.
AD=$("$OCI" iam availability-domain list --compartment-id "$TENANCY_OCID" \
  --query 'data[0].name' --raw-output) || { log "AD introuvable"; exit 2; }
IMAGE=$("$OCI" compute image list --compartment-id "$TENANCY_OCID" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --limit 1 \
  --query 'data[0].id' --raw-output) || { log "image introuvable"; exit 2; }
log "AD=$AD image=$IMAGE — début de la chasse ($CONFIGS)"

attempt=0
while true; do
  attempt=$((attempt + 1))
  for cfg in $CONFIGS; do
    ocpus="${cfg%%:*}"
    mem="${cfg##*:}"
    out=$("$OCI" compute instance launch \
      --compartment-id "$COMPARTMENT_OCID" \
      --availability-domain "$AD" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\": $ocpus, \"memoryInGBs\": $mem}" \
      --image-id "$IMAGE" \
      --subnet-id "$SUBNET_OCID" \
      --assign-public-ip true \
      --display-name "$NAME" \
      --boot-volume-size-in-gbs "$BOOT_GB" \
      --ssh-authorized-keys-file "$SSH_PUBKEY_FILE" 2>&1)
    rc=$?

    if [ $rc -eq 0 ]; then
      log "CRÉÉE au tour $attempt : ${ocpus} OCPU / ${mem} Go"
      notify "🎉 Instance Oracle A1 créée (${ocpus} OCPU / ${mem} Go) au tour $attempt. Chasse terminée."
      exit 0
    fi

    case "$out" in
      *"Out of host capacity"*|*InternalError*)
        continue ;;                                   # pas de place : taille suivante
      *TooManyRequests*)
        log "tour $attempt : limité par Oracle, pause longue"
        sleep $((INTERVAL * 3)); continue 2 ;;
      *LimitExceeded*|*NotAuthorized*|*NotAuthenticated*|*InvalidParameter*|*NotAuthorizedOrNotFound*)
        log "erreur fatale : $out"
        notify "⚠️ Chasse A1 arrêtée — erreur de config, voir journalctl -u chasse-a1."
        exit 2 ;;
      *)
        log "erreur inattendue : $out"
        exit 1 ;;
    esac
  done
  [ $((attempt % 40)) -eq 0 ] && log "tour $attempt : toujours pas de place"
  sleep $((INTERVAL + RANDOM % 30))
done
