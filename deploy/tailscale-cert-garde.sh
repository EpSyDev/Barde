#!/usr/bin/env bash
# Garde-fou du certificat HTTPS de Tailscale Funnel (dashboard → bots, hub de la taverne).
# tailscaled renouvelle normalement seul, mais il peut se bloquer : s'il a perdu un renouvellement
# déjà émis par Let's Encrypt, chaque nouvelle demande est refusée (409 alreadyReplaced) jusqu'à expiration.
# Chaque jour : si le certificat servi expire dans moins de SEUIL jours, on repart d'un certificat neuf
# (ancien sauvegardé), puis on vérifie. Installé par tailscale-cert-garde.timer (voir en bas).
set -euo pipefail

HOTE="barde.tail2985e8.ts.net"
PORT=8443
SEUIL=20
DOSSIER=/var/lib/tailscale/certs

fin=$(echo | openssl s_client -connect "$HOTE:$PORT" -servername "$HOTE" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
reste=$(( ($(date -d "$fin" +%s) - $(date +%s)) / 86400 ))
echo "certificat $HOTE : expire le $fin ($reste j)"
[ "$reste" -ge "$SEUIL" ] && exit 0

echo "moins de $SEUIL j : demande d'un certificat neuf"
sauvegarde="/root/certs-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$sauvegarde"
cp -a "$DOSSIER/$HOTE".* "$sauvegarde/" 2>/dev/null || true
rm -f "$DOSSIER/$HOTE.crt" "$DOSSIER/$HOTE.key"
systemctl restart tailscaled
sleep 10
# la première connexion TLS déclenche l'émission
curl -s -o /dev/null -m 90 "https://$HOTE:$PORT/api/health" || true
sleep 5
fin=$(echo | openssl s_client -connect "$HOTE:$PORT" -servername "$HOTE" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
echo "après renouvellement : expire le $fin (sauvegarde : $sauvegarde)"

# Installation (une fois, sur la VM) :
#   sudo cp ~/Barde/deploy/tailscale-cert-garde.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now tailscale-cert-garde.timer
