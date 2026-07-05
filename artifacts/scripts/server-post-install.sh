#!/usr/bin/env bash
set -Eeuo pipefail

# LeadVirt Ubuntu 24.04 post-install bootstrap.
# Run as root on a fresh server:
#   HOSTNAME=leadvirt-staging-01 DEPLOY_USER=deploy PUBLIC_SSH_KEY='ssh-ed25519 ...' bash server-post-install.sh
#
# The script prepares the host for Docker Compose deployments. It does not deploy
# LeadVirt and does not write application secrets.

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SERVER_HOSTNAME="${HOSTNAME:-leadvirt-staging-01}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
PUBLIC_SSH_KEY="${PUBLIC_SSH_KEY:-}"
SSH_PORT="${SSH_PORT:-22}"

log() {
  printf '\n== %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This script must be run as root." >&2
    exit 1
  fi
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

configure_hostname() {
  log "Configuring hostname: ${SERVER_HOSTNAME}"
  hostnamectl set-hostname "${SERVER_HOSTNAME}"
  if ! grep -qE "127\.0\.1\.1\s+${SERVER_HOSTNAME}$" /etc/hosts; then
    sed -i '/^127\.0\.1\.1\s/d' /etc/hosts
    printf '127.0.1.1 %s\n' "${SERVER_HOSTNAME}" >> /etc/hosts
  fi
}

create_deploy_user() {
  log "Ensuring deploy user: ${DEPLOY_USER}"
  if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "${DEPLOY_USER}"
  fi
  usermod -aG sudo "${DEPLOY_USER}"

  install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

  if [[ -n "${PUBLIC_SSH_KEY}" ]] && ! grep -qxF "${PUBLIC_SSH_KEY}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"; then
    printf '%s\n' "${PUBLIC_SSH_KEY}" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  elif [[ -z "${PUBLIC_SSH_KEY}" && -f /root/.ssh/authorized_keys ]]; then
    while IFS= read -r key; do
      [[ -z "${key}" ]] && continue
      grep -qxF "${key}" "/home/${DEPLOY_USER}/.ssh/authorized_keys" || printf '%s\n' "${key}" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    done < /root/.ssh/authorized_keys
  fi

  cat > "/etc/sudoers.d/90-${DEPLOY_USER}" <<EOF
${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL
EOF
  chmod 440 "/etc/sudoers.d/90-${DEPLOY_USER}"
}

configure_ssh() {
  log "Hardening SSH"
  install -d -m 755 /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/99-leadvirt.conf <<EOF
Port ${SSH_PORT}
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

  sshd -t
  systemctl reload ssh || systemctl reload sshd
}

install_base_packages() {
  log "Installing base packages"
  apt-get update
  apt_install \
    ca-certificates \
    curl \
    gnupg \
    git \
    jq \
    htop \
    unzip \
    ufw \
    fail2ban \
    unattended-upgrades \
    apt-transport-https
}

install_docker() {
  log "Installing Docker Engine"
  apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc >/dev/null 2>&1 || true

  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  local codename
  codename="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME}")"
  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable
EOF

  apt-get update
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  install -d -m 0755 /etc/docker
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true
}
EOF

  systemctl enable docker
  systemctl restart docker
  usermod -aG docker "${DEPLOY_USER}"
}

configure_firewall() {
  log "Configuring firewall"
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "${SSH_PORT}/tcp"
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
}

configure_fail2ban() {
  log "Configuring fail2ban"
  cat > /etc/fail2ban/jail.d/leadvirt-sshd.local <<EOF
[sshd]
enabled = true
port = ${SSH_PORT}
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl enable fail2ban
  systemctl restart fail2ban
}

configure_unattended_upgrades() {
  log "Configuring unattended security upgrades"
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  systemctl enable unattended-upgrades
  systemctl restart unattended-upgrades || true
}

configure_swap() {
  if swapon --show=NAME | grep -qx "/swapfile"; then
    log "Swapfile already enabled"
    return
  fi

  log "Creating swapfile: ${SWAP_SIZE}"
  fallocate -l "${SWAP_SIZE}" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
}

create_app_directories() {
  log "Creating application directories"
  install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/leadvirt
  install -d -m 750 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/leadvirt/secrets
  install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /opt/leadvirt/backups
  install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /var/log/leadvirt
}

print_summary() {
  log "Post-install summary"
  docker --version
  docker compose version
  ufw status verbose
  printf '\nDeploy user: %s\n' "${DEPLOY_USER}"
  printf 'Hostname: %s\n' "${SERVER_HOSTNAME}"
  printf 'SSH port: %s\n' "${SSH_PORT}"
  printf '\nNext: reconnect as %s@<server-ip>, then deploy LeadVirt into /opt/leadvirt.\n' "${DEPLOY_USER}"
}

main() {
  require_root
  configure_hostname
  install_base_packages
  create_deploy_user
  configure_ssh
  install_docker
  configure_firewall
  configure_fail2ban
  configure_unattended_upgrades
  configure_swap
  create_app_directories
  print_summary
}

main "$@"
