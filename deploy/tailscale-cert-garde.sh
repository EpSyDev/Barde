#!/usr/bin/env bash
# Garde-fou du certificat HTTPS de Tailscale Funnel (dashboard → bots, hub de la taverne).
# tailscaled renouvelle normalement seul, mais il peut se bloquer : s'il a perdu un renouvellement
# déjà émis par Let's Encrypt, chaque demande est refusée (409 alreadyReplaced) jusqu'à expiration,
# et le compte ACME peut rester coincé (« dns-01 challenge not offered »).
# Chaque jour (tailscale-cert-garde.timer) : si le certificat servi expire dans moins de SEUIL jours
# (ou s'il n'y en a plus), on repart d'un certificat ET d'un compte ACME neufs. En cas d'échec, on
# remet la dernière sauvegarde encore valable, pour que le service ne tombe jamais à cause du script.
#   sudo bash ~/Barde/deploy/tailscale-cert-garde.sh              # vérification (seuil)
#   sudo bash ~/Barde/deploy/tailscale-cert-garde.sh --maintenant # renouvellement forcé
set -uo pipefail

HOTE="barde.tail2985e8.ts.net"
PORT=8443
SEUIL=20
DOSSIER=/var/lib/tailscale/certs

jours_restants() {
  local fin
  fin=$(echo | timeout 15 openssl s_client -connect "$HOTE:$PORT" -servername "$HOTE" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -z "$fin" ] && { echo -1; return; }
  echo $(( ($(date -d "$fin" +%s) - $(date +%s)) / 86400 ))
}
# la première connexion TLS déclenche l'émission ; on attend jusqu'à 2 min qu'un certificat soit servi
attendre_certificat() {
  for _ in $(seq 1 12); do
    curl -s -o /dev/null -m 10 "https://$HOTE:$PORT/api/health" || true
    [ "$(jours_restants)" -ge 0 ] && return 0
    sleep 10
  done
  return 1
}

reste=$(jours_restants)
echo "certificat $HOTE : $([ "$reste" -ge 0 ] && echo "$reste j restants" || echo "aucun certificat servi")"
[ "${1:-}" != "--maintenant" ] && [ "$reste" -ge "$SEUIL" ] && exit 0

sauvegarde="/root/certs-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$sauvegarde"
cp -a "$DOSSIER"/. "$sauvegarde/" 2>/dev/null || true
echo "sauvegarde : $sauvegarde ($(ls "$sauvegarde" | tr '\n' ' '))"

echo "renouvellement : certificat et compte ACME neufs"
rm -f "$DOSSIER/$HOTE.crt" "$DOSSIER/$HOTE.key" "$DOSSIER/acme-account.key.pem"
systemctl restart tailscaled
sleep 8
if attendre_certificat; then
  echo "OK : nouveau certificat, $(jours_restants) j restants"
  exit 0
fi

# échec : dernière sauvegarde qui contient un certificat
echo "ÉCHEC du renouvellement — journal de tailscaled :"
journalctl -u tailscaled --since "-3min" --no-pager -o cat | grep -i 'cert(' | grep -v RATELIMIT | tail -5
ancienne=$(ls -dt /root/certs-backup-* 2>/dev/null | while read -r d; do [ -f "$d/$HOTE.crt" ] && { echo "$d"; break; }; done)
if [ -n "$ancienne" ]; then
  echo "restauration de $ancienne"
  cp -a "$ancienne"/. "$DOSSIER/"
  systemctl restart tailscaled
  sleep 8
  attendre_certificat && echo "restauré : $(jours_restants) j restants" || echo "restauration sans effet"
else
  echo "aucune sauvegarde avec certificat"
fi
exit 1

# Installation (une fois, sur la VM) :
#   sudo cp ~/Barde/deploy/tailscale-cert-garde.{service,timer} /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now tailscale-cert-garde.timer
