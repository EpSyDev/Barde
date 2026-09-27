#!/usr/bin/env bash
# Relais TURN (coturn) pour le vocal de proximité de la Taverne 3D.
# Sans lui, le vocal passe en pair-à-pair direct (STUN) : ça marche dans la plupart des cas, pas derrière
# certains pare-feux d'entreprise ou 4G. Avec lui, le son est relayé par la VM quand le direct échoue.
#
# À lancer UNE fois sur la VM :  bash ~/Barde/deploy/coturn-setup.sh
# Pré-requis côté Oracle Cloud (console) : liste de sécurité du sous-réseau, règles entrantes
#   UDP 3478, TCP 3478, UDP 49160-49200 depuis 0.0.0.0/0.
#
# Sécurité : identifiants temporaires signés par le hub (use-auth-secret, jamais de mot de passe fixe),
# relais UDP seulement (no-tcp-relay : impossible d'atteindre les API HTTP internes par rebond),
# adresses privées et locales interdites comme destination (sauf l'adresse de relais de la VM elle-même,
# nécessaire quand les deux voyageurs passent par le relais).
set -euo pipefail

sudo apt-get update -qq
sudo apt-get install -y -qq coturn

PUB=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
PRIV=$(hostname -I | awk '{print $1}')
SECRET=$(openssl rand -hex 32)
echo "IP publique : $PUB — IP privée : $PRIV"

sudo tee /etc/turnserver.conf >/dev/null <<EOF
listening-port=3478
listening-ip=$PRIV
relay-ip=$PRIV
external-ip=$PUB/$PRIV
min-port=49160
max-port=49200
fingerprint
use-auth-secret
static-auth-secret=$SECRET
realm=taverne.myrhaven
total-quota=60
user-quota=12
stale-nonce=600
no-cli
no-tls
no-dtls
no-tcp-relay
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
allowed-peer-ip=$PRIV
log-file=syslog
simple-log
EOF

# démarrage automatique (Debian/Ubuntu livrent coturn désactivé)
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true

# pare-feu de l'image Oracle (iptables) : ouvrir avant la règle REJECT, et garder après redémarrage
for r in "-p udp --dport 3478" "-p tcp --dport 3478" "-p udp --dport 49160:49200"; do
  sudo iptables -C INPUT $r -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 $r -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi

# le hub donne ces serveurs aux voyageurs, avec des identifiants valables 12 h
ENV="$HOME/Barde/.env"
sed -i '/^TURN_URLS=/d;/^TURN_SECRET=/d' "$ENV"
{
  echo "TURN_URLS=turn:$PUB:3478?transport=udp,turn:$PUB:3478?transport=tcp"
  echo "TURN_SECRET=$SECRET"
} >> "$ENV"

sudo systemctl enable --now coturn
sudo systemctl restart coturn taverne-hub
sleep 2
systemctl is-active coturn taverne-hub
echo "Relais TURN en place sur $PUB:3478."
