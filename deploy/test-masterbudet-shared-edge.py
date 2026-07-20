from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CONFIGURATION_PATH = ROOT / "deploy" / "nginx.https.conf"
VERIFIER_PATH = ROOT / "deploy" / "verify-masterbudet-shared-edge.py"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "deploy-leadvirt-com.yml"
ENABLE_SCRIPT_PATH = ROOT / "deploy" / "enable-leadvirt-com-https.sh"


def verify(configuration: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(VERIFIER_PATH), "-"],
        input=configuration,
        capture_output=True,
        check=False,
        encoding="utf-8",
    )


def changed(configuration: str, old: str, new: str, label: str) -> str:
    candidate = configuration.replace(old, new, 1)
    if candidate == configuration:
        raise AssertionError(f"mutation did not change the configuration: {label}")
    return candidate


def main() -> int:
    configuration = CONFIGURATION_PATH.read_text(encoding="utf-8")
    valid = verify(configuration)
    if valid.returncode != 0:
        raise AssertionError(valid.stderr)

    mutations = [
        (
            "map hash bucket is reduced",
            changed(
                configuration,
                "map_hash_bucket_size 128;",
                "map_hash_bucket_size 64;",
                "map hash bucket is reduced",
            ),
        ),
        (
            "non-POST method is charged",
            changed(
                configuration,
                'map "$request_method:$uri" $masterbudet_customer_session_auth_key {\n'
                '    default "";',
                'map "$request_method:$uri" $masterbudet_customer_session_auth_key {\n'
                '    default "";\n'
                "    GET:/api/v1/auth/customer/session/refresh/web $binary_remote_addr;",
                "non-POST method is charged",
            ),
        ),
        (
            "query-sensitive request URI is used",
            changed(
                configuration,
                'map "$request_method:$uri" $masterbudet_customer_session_auth_key {',
                'map "$request_method:$request_uri" $masterbudet_customer_session_auth_key {',
                "query-sensitive request URI is used",
            ),
        ),
        (
            "session rate is relaxed",
            changed(configuration, "rate=60r/m;", "rate=600r/m;", "session rate is relaxed"),
        ),
        (
            "session route is widened",
            changed(
                configuration,
                "location = /api/v1/auth/customer/session/refresh/web {",
                "location ^~ /api/v1/auth/customer/session/refresh/web {",
                "session route is widened",
            ),
        ),
        (
            "session burst is relaxed",
            changed(
                configuration,
                "limit_req zone=masterbudet_customer_session_auth burst=20 nodelay;",
                "limit_req zone=masterbudet_customer_session_auth burst=200 nodelay;",
                "session burst is relaxed",
            ),
        ),
        (
            "session handler loses no-store",
            changed(
                configuration,
                "location @masterbudet_customer_session_auth_rate_limited {\n"
                "      default_type application/json;\n"
                '      add_header Cache-Control "no-store" always;',
                "location @masterbudet_customer_session_auth_rate_limited {\n"
                "      default_type application/json;",
                "session handler loses no-store",
            ),
        ),
        (
            "session retry contract changes",
            changed(
                configuration,
                "add_header Retry-After 1 always;",
                "add_header Retry-After 10 always;",
                "session retry contract changes",
            ),
        ),
        (
            "session limiter leaks into the generic proxy",
            changed(
                configuration,
                "    location /api/ {",
                "    location /api/ {\n"
                "      limit_req zone=masterbudet_customer_session_auth burst=20 nodelay;",
                "session limiter leaks into the generic proxy",
            ),
        ),
        (
            "trailing slash is protected",
            changed(
                configuration,
                "location = /api/v1/auth/customer/session/logout/web {",
                "location = /api/v1/auth/customer/session/logout/web/ {",
                "trailing slash is protected",
            ),
        ),
        (
            "mixed-case route is protected",
            changed(
                configuration,
                "location = /api/v1/auth/customer/session/refresh/mobile {",
                "location = /api/v1/auth/customer/session/refresh/Mobile {",
                "mixed-case route is protected",
            ),
        ),
        (
            "canonical session route is duplicated",
            configuration
            + "\nlocation = /api/v1/auth/customer/session/logout/mobile { return 204; }\n",
        ),
        (
            "stale session route is added",
            configuration + "\nlocation = /api/v1/auth/customer/session/refresh { return 204; }\n",
        ),
    ]

    for label, candidate in mutations:
        invalid = verify(candidate)
        if invalid.returncode == 0:
            raise AssertionError(f"semantic verifier accepted mutation: {label}")
        if "Master Budet shared-edge verification failed:" not in invalid.stderr:
            raise AssertionError(f"unexpected verifier failure for {label}: {invalid.stderr}")

    workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
    mutation_test = "python3 deploy/test-masterbudet-shared-edge.py"
    semantic_verifier = (
        "python3 deploy/verify-masterbudet-shared-edge.py deploy/nginx.https.conf"
    )
    if workflow.count(mutation_test) != 1 or workflow.count(semantic_verifier) != 1:
        raise AssertionError("shared-edge mutation test and verifier must each run once in CI")
    if workflow.index(mutation_test) > workflow.index(semantic_verifier):
        raise AssertionError("shared-edge mutation test must run before the deploy verifier")

    enable_script = ENABLE_SCRIPT_PATH.read_text(encoding="utf-8")
    verifier_call = 'python3 "$RELEASE_ROOT/deploy/verify-masterbudet-shared-edge.py"'
    copy_call = 'cp "$RELEASE_ROOT/deploy/nginx.https.conf"'
    syntax_call = "nginx -t -c /tmp/leadvirt-nginx.https.conf"
    if enable_script.count(verifier_call) != 1:
        raise AssertionError("pre-copy shared-edge verifier invocation is missing or duplicated")
    if not enable_script.index(verifier_call) < enable_script.index(copy_call):
        raise AssertionError("shared-edge verifier must run before the active config is copied")
    if enable_script.count(syntax_call) != 1:
        raise AssertionError("nginx syntax preflight is missing or duplicated")

    print(f"Master Budet shared-edge mutation probes passed: {len(mutations)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
