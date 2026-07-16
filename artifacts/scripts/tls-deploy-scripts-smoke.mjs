import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const enable = read("deploy/enable-leadvirt-com-https.sh");
const renew = read("deploy/renew-leadvirt-certificates.sh");

assert(
  enable.includes('bootstrap_container="leadvirt-acme-bootstrap-$$-$(date +%s)"'),
  "TLS bootstrap container name is not unique.",
);
assert(
  enable.includes("trap cleanup_acme_bootstrap EXIT") &&
    enable.includes("trap 'exit 143' TERM") &&
    enable.includes('docker rm -f "$bootstrap_container"'),
  "TLS bootstrap container is not covered by an exit trap.",
);
assert(
  /if ! challenge_is_reachable; then[\s\S]*?docker run -d[\s\S]*?-p 80:80/.test(enable),
  "TLS bootstrap does not bind a temporary nginx only after routing fails.",
);
assert(
  enable.includes("curl --noproxy '*'"),
  "ACME routing preflight can be diverted through an outbound proxy.",
);
assert(
  enable.indexOf("certbot/certbot certonly") < enable.indexOf("if ! remove_acme_bootstrap; then"),
  "TLS bootstrap is removed before Certbot completes.",
);
assert(
  !/docker (?:stop|restart|kill).*nginx/.test(enable),
  "TLS bootstrap can disrupt an existing nginx container.",
);
assert(
  enable.includes("temporary server could not bind port 80; no existing listener was changed"),
  "Port 80 conflicts do not fail closed.",
);

for (const [name, script] of [
  ["enable", enable],
  ["renew", renew],
]) {
  assert(
    script.includes('marker="$release_root/.leadvirt-compose-project"'),
    `${name} script does not read the release Compose project marker.`,
  );
  assert(
    script.includes('""|[-_]*|*[!a-z0-9_-]*)'),
    `${name} script does not validate Compose project names.`,
  );
  assert(
    script.includes('marker_size="$(wc -c < "$marker"') &&
      script.includes('tail -c 1 "$marker" | od -An -tu1'),
    `${name} script accepts noncanonical Compose project marker bytes.`,
  );
  assert(
    script.includes('--project-name "$') && script.includes("docker compose --env-file"),
    `${name} script does not support marked and legacy Compose projects.`,
  );
}

assert(
  renew.includes('active_root="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"'),
  "Certificate renewal does not resolve the active release.",
);
assert(
  (renew.match(/active_compose exec -T nginx/g) ?? []).length === 2,
  "Certificate renewal does not validate and reload the selected nginx project.",
);
assert(
  renew.includes('exec 9>"$DEPLOY_LOCK_FILE"') &&
    renew.includes('flock -w "$DEPLOY_LOCK_WAIT_SECONDS" 9'),
  "Certificate renewal is not serialized with application deployment.",
);
assert(
  enable.includes("tempfile.mkstemp") &&
    enable.includes("os.fchmod(fd, 0o600)") &&
    enable.includes("os.fsync(temporary_file.fileno())") &&
    enable.includes("os.replace(temporary_name, path)") &&
    enable.includes("os.fsync(directory_fd)"),
  "TLS bootstrap does not replace the secrets env file atomically and durably.",
);

console.log("PASS: TLS bootstrap and active Compose project selection are fail-closed.");
