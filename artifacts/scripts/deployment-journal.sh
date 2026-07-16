#!/usr/bin/env bash

set -euo pipefail

die() {
  printf 'DEPLOY_JOURNAL: %s\n' "$*" >&2
  exit 1
}

DEPLOY_ROOT="${DEPLOY_ROOT:-$(cd "$(dirname "$0")" && pwd -P)}"
case "$DEPLOY_ROOT" in
  /*) ;;
  *) die "DEPLOY_ROOT must be absolute." ;;
esac
case "$DEPLOY_ROOT" in
  *[!A-Za-z0-9_./-]*) die "DEPLOY_ROOT contains unsupported characters." ;;
esac

releases_root="$DEPLOY_ROOT/releases"
current_link="$DEPLOY_ROOT/current"
journal_file="$DEPLOY_ROOT/.deployment-journal.v1"
lock_file="$DEPLOY_ROOT/.deploy.lock"

sync_path() {
  sync -f "$1"
}

acquire_lock() {
  mkdir -p "$DEPLOY_ROOT" "$releases_root"
  if [ "${LEADVIRT_DEPLOY_LOCK_HELD:-0}" = "1" ]; then
    return 0
  fi
  exec 9>"$lock_file"
  if ! flock -n 9; then
    printf 'DEPLOY_JOURNAL: deployment lock is busy.\n' >&2
    exit 75
  fi
}

encode_value() {
  printf '%s' "$1" | base64 | tr -d '\n'
}

decode_value() {
  encoded="$1"
  if [ -z "$encoded" ]; then
    printf ''
    return 0
  fi
  decoded="$(printf '%s' "$encoded" | base64 -d 2>/dev/null)" || return 1
  [ "$(encode_value "$decoded")" = "$encoded" ] || return 1
  printf '%s' "$decoded"
}

validate_release_id() {
  case "$1" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-attempt-[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]) return 0 ;;
    *) return 1 ;;
  esac
}

validate_project() {
  case "$1" in
    ""|[!a-z0-9]*|*[!a-z0-9_-]*) return 1 ;;
    *) return 0 ;;
  esac
}

validate_container_id() {
  [ -z "$1" ] || [[ "$1" =~ ^[0-9a-f]{12,64}$ ]]
}

validate_running_flag() {
  [ "$1" = "0" ] || [ "$1" = "1" ]
}

validate_direct_release_dir() {
  local candidate="$1"
  [ -n "$candidate" ] || return 1
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || return 1
  [ "$(dirname "$candidate")" = "$releases_root" ] || return 1
  [ "$(readlink -f -- "$candidate" 2>/dev/null || true)" = "$candidate" ] || return 1
}

validate_env_file() {
  local candidate="$1"
  case "$candidate" in
    /*) ;;
    *) return 1 ;;
  esac
  case "$candidate" in
    *[!A-Za-z0-9_./-]*) return 1 ;;
  esac
  [ -f "$candidate" ] && [ ! -L "$candidate" ] && \
    [ "$(readlink -f -- "$candidate" 2>/dev/null || true)" = "$candidate" ]
}

validate_public_url() {
  [[ "$1" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]
}

verify_container_contract() {
  service="$1"
  container_id="$2"
  compose_project="$3"
  [ -n "$container_id" ] || return 0
  metadata="$(docker inspect \
    --format '{{.Id}}|{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "com.docker.compose.oneoff" }}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.RestartPolicy.MaximumRetryCount}}' \
    "$container_id" 2>/dev/null)" || return 1
  IFS='|' read -r inspected_id inspected_project inspected_service inspected_oneoff restart_name restart_retries <<< "$metadata"
  [ "$inspected_id" = "$container_id" ] && \
    [ "$inspected_project" = "$compose_project" ] && \
    [ "$inspected_service" = "$service" ] && \
    [ "$inspected_oneoff" = "False" ] && \
    [ "$restart_name" = "unless-stopped" ] && \
    [ "$restart_retries" = "0" ]
}

validate_release_artifacts() {
  release_dir="$1"
  release_id="$2"
  release_sha="$3"
  compose_project="$4"
  for marker in .leadvirt-release-sha .leadvirt-image-tag .leadvirt-compose-project; do
    [ -f "$release_dir/$marker" ] && [ ! -L "$release_dir/$marker" ] || return 1
    [ "$(wc -c < "$release_dir/$marker")" -le 128 ] || return 1
  done
  [ "$(cat "$release_dir/.leadvirt-release-sha")" = "$release_sha" ] && \
    [ "$(cat "$release_dir/.leadvirt-image-tag")" = "$release_id" ] && \
    [ "$(cat "$release_dir/.leadvirt-compose-project")" = "$compose_project" ] && \
    [ -f "$release_dir/deploy/docker-compose.staging.yml" ] && \
    [ ! -L "$release_dir/deploy/docker-compose.staging.yml" ]
}

write_journal() {
  phase="$1"
  [ "$phase" = "precommit" ] || [ "$phase" = "committed" ] || die "Invalid journal phase."

  : "${JOURNAL_RELEASE_DIR:?}"
  : "${JOURNAL_RELEASE_ID:?}"
  : "${JOURNAL_RELEASE_SHA:?}"
  : "${JOURNAL_COMPOSE_PROJECT:?}"
  : "${JOURNAL_ENV_FILE:?}"
  : "${JOURNAL_PUBLIC_URL:?}"
  : "${JOURNAL_PREVIOUS_CURRENT_KIND:?}"
  : "${JOURNAL_PREVIOUS_API_RUNNING:?}"
  : "${JOURNAL_PREVIOUS_WORKER_RUNNING:?}"
  : "${JOURNAL_PREVIOUS_WEB_RUNNING:?}"
  : "${JOURNAL_PREVIOUS_NGINX_RUNNING:?}"

  validate_direct_release_dir "$JOURNAL_RELEASE_DIR" || die "Candidate release directory is invalid."
  validate_release_id "$JOURNAL_RELEASE_ID" || die "Candidate release id is invalid."
  [ "$(basename "$JOURNAL_RELEASE_DIR")" = "$JOURNAL_RELEASE_ID" ] || die "Candidate release identity disagrees with its path."
  [[ "$JOURNAL_RELEASE_SHA" =~ ^[0-9a-f]{40,64}$ ]] || die "Candidate release SHA is invalid."
  validate_project "$JOURNAL_COMPOSE_PROJECT" || die "Compose project is invalid."
  validate_env_file "$JOURNAL_ENV_FILE" || die "Deployment env file is invalid."
  validate_public_url "$JOURNAL_PUBLIC_URL" || die "Public URL must be an HTTPS origin."
  case "$JOURNAL_PREVIOUS_CURRENT_KIND" in
    symlink)
      [ -n "${JOURNAL_PREVIOUS_LINK_TARGET:-}" ] || die "Prior symlink target is missing."
      validate_direct_release_dir "${JOURNAL_PREVIOUS_ROOT:-}" || die "Prior symlink root is invalid."
      [ -z "${JOURNAL_PREVIOUS_PATH_IDENTITY:-}" ] && [ -z "${JOURNAL_PREVIOUS_BACKUP_DIR:-}" ] || die "Prior symlink metadata is inconsistent."
      ;;
    path)
      [ -z "${JOURNAL_PREVIOUS_LINK_TARGET:-}" ] || die "Prior path has a symlink target."
      [ "${JOURNAL_PREVIOUS_ROOT:-}" = "$current_link" ] || die "Prior path root is invalid."
      [[ "${JOURNAL_PREVIOUS_PATH_IDENTITY:-}" =~ ^[0-9]+:[0-9]+$ ]] || die "Prior path identity is invalid."
      [ "${JOURNAL_PREVIOUS_BACKUP_DIR:-}" = "$DEPLOY_ROOT/current.backup.$JOURNAL_RELEASE_ID" ] || die "Prior path backup is invalid."
      ;;
    missing)
      [ -z "${JOURNAL_PREVIOUS_LINK_TARGET:-}" ] && \
        [ -z "${JOURNAL_PREVIOUS_ROOT:-}" ] && \
        [ -z "${JOURNAL_PREVIOUS_PATH_IDENTITY:-}" ] && \
        [ -z "${JOURNAL_PREVIOUS_BACKUP_DIR:-}" ] || die "First-deploy journal has prior path metadata."
      ;;
    *) die "Prior current kind is invalid." ;;
  esac
  for container_id in \
    "${JOURNAL_PREVIOUS_API_CONTAINER:-}" \
    "${JOURNAL_PREVIOUS_WORKER_CONTAINER:-}" \
    "${JOURNAL_PREVIOUS_WEB_CONTAINER:-}" \
    "${JOURNAL_PREVIOUS_NGINX_CONTAINER:-}"; do
    validate_container_id "$container_id" || die "Prior container identity is invalid."
  done
  for running_flag in \
    "$JOURNAL_PREVIOUS_API_RUNNING" \
    "$JOURNAL_PREVIOUS_WORKER_RUNNING" \
    "$JOURNAL_PREVIOUS_WEB_RUNNING" \
    "$JOURNAL_PREVIOUS_NGINX_RUNNING"; do
    validate_running_flag "$running_flag" || die "Prior running state is invalid."
  done
  for service in API WORKER WEB NGINX; do
    container_variable="JOURNAL_PREVIOUS_${service}_CONTAINER"
    running_variable="JOURNAL_PREVIOUS_${service}_RUNNING"
    container_id="${!container_variable:-}"
    running_flag="${!running_variable}"
    if [ -z "$container_id" ] && [ "$running_flag" != "0" ]; then
      die "Prior ${service,,} running state has no container."
    fi
    if [ "$JOURNAL_PREVIOUS_CURRENT_KIND" = "missing" ] && { [ -n "$container_id" ] || [ "$running_flag" != "0" ]; }; then
      die "First-deploy journal cannot claim prior app containers."
    fi
  done
  validate_release_artifacts \
    "$JOURNAL_RELEASE_DIR" \
    "$JOURNAL_RELEASE_ID" \
    "$JOURNAL_RELEASE_SHA" \
    "$JOURNAL_COMPOSE_PROJECT" || die "Candidate release artifacts are invalid."
  docker info >/dev/null 2>&1 || die "Docker is unavailable while recording deployment state."
  for service in api worker web nginx; do
    upper_service="${service^^}"
    container_variable="JOURNAL_PREVIOUS_${upper_service}_CONTAINER"
    expected_container="${!container_variable:-}"
    actual_container="$(docker ps -a --no-trunc \
      --filter "label=com.docker.compose.project=$JOURNAL_COMPOSE_PROJECT" \
      --filter "label=com.docker.compose.service=$service" \
      --filter "label=com.docker.compose.oneoff=False" \
      --format '{{.ID}}')" || die "Cannot inspect prior $service container state."
    [ "$actual_container" = "$expected_container" ] || die "Prior $service container identity changed before journal persistence."
    verify_container_contract "$service" "$expected_container" "$JOURNAL_COMPOSE_PROJECT" || \
      die "Prior $service container contract is unsafe for reboot recovery."
  done

  if [ "$phase" = "precommit" ]; then
    [ ! -e "$journal_file" ] && [ ! -L "$journal_file" ] || die "An unresolved deployment journal already exists."
    case "$JOURNAL_PREVIOUS_CURRENT_KIND" in
      symlink)
        [ -L "$current_link" ] && \
          [ "$(readlink "$current_link")" = "$JOURNAL_PREVIOUS_LINK_TARGET" ] && \
          [ "$(readlink -f "$current_link" 2>/dev/null || true)" = "$JOURNAL_PREVIOUS_ROOT" ] || \
          die "Prior current symlink changed before journal persistence."
        ;;
      path)
        [ -e "$current_link" ] && [ ! -L "$current_link" ] && \
          [ "$(stat -Lc '%d:%i' "$current_link" 2>/dev/null || true)" = "$JOURNAL_PREVIOUS_PATH_IDENTITY" ] || \
          die "Prior current path changed before journal persistence."
        ;;
      missing)
        [ ! -e "$current_link" ] && [ ! -L "$current_link" ] || \
          die "Current appeared before first-deployment journal persistence."
        ;;
    esac
  else
    load_journal
    [ "${journal[phase]}" = "precommit" ] || die "Only a precommit journal can transition to committed."
    [ "$journal_release_dir" = "$JOURNAL_RELEASE_DIR" ] && \
      [ "$journal_release_id" = "$JOURNAL_RELEASE_ID" ] && \
      [ "$journal_release_sha" = "$JOURNAL_RELEASE_SHA" ] && \
      [ "$journal_compose_project" = "$JOURNAL_COMPOSE_PROJECT" ] && \
      [ "$journal_env_file" = "$JOURNAL_ENV_FILE" ] && \
      [ "$journal_public_url" = "$JOURNAL_PUBLIC_URL" ] && \
      [ "$journal_previous_current_kind" = "$JOURNAL_PREVIOUS_CURRENT_KIND" ] && \
      [ "$journal_previous_link_target" = "${JOURNAL_PREVIOUS_LINK_TARGET:-}" ] && \
      [ "$journal_previous_root" = "${JOURNAL_PREVIOUS_ROOT:-}" ] && \
      [ "$journal_previous_path_identity" = "${JOURNAL_PREVIOUS_PATH_IDENTITY:-}" ] && \
      [ "$journal_previous_backup_dir" = "${JOURNAL_PREVIOUS_BACKUP_DIR:-}" ] || die "Committed journal identity differs from precommit."
    [ -L "$current_link" ] && \
      [ "$(readlink -f "$current_link" 2>/dev/null || true)" = "$JOURNAL_RELEASE_DIR" ] || \
      die "Current does not point to the candidate at journal commit."
    for service in api worker web nginx; do
      container_key="previous_${service}_container"
      running_key="previous_${service}_running"
      upper_service="${service^^}"
      container_variable="JOURNAL_PREVIOUS_${upper_service}_CONTAINER"
      running_variable="JOURNAL_PREVIOUS_${upper_service}_RUNNING"
      expected_container="${!container_variable:-}"
      expected_running="${!running_variable}"
      [ "${journal[$container_key]}" = "$expected_container" ] && \
        [ "${journal[$running_key]}" = "$expected_running" ] || die "Committed journal $service state differs from precommit."
    done
  fi

  temporary_journal="$DEPLOY_ROOT/.deployment-journal.v1.tmp.$$.$RANDOM"
  umask 077
  {
    printf 'version 1\n'
    printf 'phase %s\n' "$phase"
    printf 'release_dir %s\n' "$(encode_value "$JOURNAL_RELEASE_DIR")"
    printf 'release_id %s\n' "$JOURNAL_RELEASE_ID"
    printf 'release_sha %s\n' "$JOURNAL_RELEASE_SHA"
    printf 'compose_project %s\n' "$JOURNAL_COMPOSE_PROJECT"
    printf 'env_file %s\n' "$(encode_value "$JOURNAL_ENV_FILE")"
    printf 'public_url %s\n' "$(encode_value "$JOURNAL_PUBLIC_URL")"
    printf 'previous_current_kind %s\n' "$JOURNAL_PREVIOUS_CURRENT_KIND"
    printf 'previous_link_target %s\n' "$(encode_value "${JOURNAL_PREVIOUS_LINK_TARGET:-}")"
    printf 'previous_root %s\n' "$(encode_value "${JOURNAL_PREVIOUS_ROOT:-}")"
    printf 'previous_path_identity %s\n' "${JOURNAL_PREVIOUS_PATH_IDENTITY:-}"
    printf 'previous_backup_dir %s\n' "$(encode_value "${JOURNAL_PREVIOUS_BACKUP_DIR:-}")"
    printf 'previous_api_container %s\n' "${JOURNAL_PREVIOUS_API_CONTAINER:-}"
    printf 'previous_api_running %s\n' "$JOURNAL_PREVIOUS_API_RUNNING"
    printf 'previous_worker_container %s\n' "${JOURNAL_PREVIOUS_WORKER_CONTAINER:-}"
    printf 'previous_worker_running %s\n' "$JOURNAL_PREVIOUS_WORKER_RUNNING"
    printf 'previous_web_container %s\n' "${JOURNAL_PREVIOUS_WEB_CONTAINER:-}"
    printf 'previous_web_running %s\n' "$JOURNAL_PREVIOUS_WEB_RUNNING"
    printf 'previous_nginx_container %s\n' "${JOURNAL_PREVIOUS_NGINX_CONTAINER:-}"
    printf 'previous_nginx_running %s\n' "$JOURNAL_PREVIOUS_NGINX_RUNNING"
  } > "$temporary_journal"
  chmod 600 "$temporary_journal"
  sync_path "$temporary_journal"
  mv -Tf -- "$temporary_journal" "$journal_file"
  sync_path "$DEPLOY_ROOT"
  printf 'DEPLOY_JOURNAL: persisted phase=%s release=%s\n' "$phase" "$JOURNAL_RELEASE_ID"
}

clear_journal() {
  if [ -L "$journal_file" ] || { [ -e "$journal_file" ] && [ ! -f "$journal_file" ]; }; then
    die "Refusing to remove an invalid deployment journal."
  fi
  if [ -f "$journal_file" ]; then
    rm -f -- "$journal_file"
    sync_path "$DEPLOY_ROOT"
  fi
}

declare -A journal=()

load_journal() {
  [ -f "$journal_file" ] && [ ! -L "$journal_file" ] || die "Deployment journal is missing or invalid."
  [ "$(wc -c < "$journal_file")" -le 16384 ] || die "Deployment journal is too large."
  journal=()
  while IFS=' ' read -r key value extra || [ -n "${key:-}" ]; do
    [ -n "${key:-}" ] && [ -z "${extra:-}" ] || die "Malformed deployment journal."
    case "$key" in
      version|phase|release_dir|release_id|release_sha|compose_project|env_file|public_url|previous_current_kind|previous_link_target|previous_root|previous_path_identity|previous_backup_dir|previous_api_container|previous_api_running|previous_worker_container|previous_worker_running|previous_web_container|previous_web_running|previous_nginx_container|previous_nginx_running) ;;
      *) die "Unknown deployment journal field." ;;
    esac
    [ -z "${journal[$key]+present}" ] || die "Duplicate deployment journal field."
    journal[$key]="${value:-}"
  done < "$journal_file"

  required_fields=(
    version phase release_dir release_id release_sha compose_project env_file public_url
    previous_current_kind previous_link_target previous_root previous_path_identity
    previous_backup_dir previous_api_container previous_api_running
    previous_worker_container previous_worker_running previous_web_container
    previous_web_running previous_nginx_container previous_nginx_running
  )
  [ "${#journal[@]}" -eq "${#required_fields[@]}" ] || die "Deployment journal field count is invalid."
  for key in "${required_fields[@]}"; do
    [ -n "${journal[$key]+present}" ] || die "Deployment journal field is missing: $key"
  done
  [ "${journal[version]}" = "1" ] || die "Unsupported deployment journal version."
  case "${journal[phase]}" in
    precommit|committed) ;;
    *) die "Deployment journal phase is invalid." ;;
  esac

  journal_release_dir="$(decode_value "${journal[release_dir]}")" || die "Candidate release path encoding is invalid."
  journal_env_file="$(decode_value "${journal[env_file]}")" || die "Deployment env path encoding is invalid."
  journal_public_url="$(decode_value "${journal[public_url]}")" || die "Public URL encoding is invalid."
  journal_previous_link_target="$(decode_value "${journal[previous_link_target]}")" || die "Prior link target encoding is invalid."
  journal_previous_root="$(decode_value "${journal[previous_root]}")" || die "Prior root encoding is invalid."
  journal_previous_backup_dir="$(decode_value "${journal[previous_backup_dir]}")" || die "Prior backup path encoding is invalid."
  journal_release_id="${journal[release_id]}"
  journal_release_sha="${journal[release_sha]}"
  journal_compose_project="${journal[compose_project]}"
  journal_previous_current_kind="${journal[previous_current_kind]}"
  journal_previous_path_identity="${journal[previous_path_identity]}"

  validate_direct_release_dir "$journal_release_dir" || die "Journal candidate release directory is invalid."
  validate_release_id "$journal_release_id" || die "Journal candidate release id is invalid."
  [ "$(basename "$journal_release_dir")" = "$journal_release_id" ] || die "Journal release identity disagrees with its path."
  [[ "$journal_release_sha" =~ ^[0-9a-f]{40,64}$ ]] || die "Journal release SHA is invalid."
  validate_release_artifacts \
    "$journal_release_dir" \
    "$journal_release_id" \
    "$journal_release_sha" \
    "$journal_compose_project" || die "Journal candidate release artifacts are invalid."
  validate_env_file "$journal_env_file" || die "Journal deployment env file is invalid."
  validate_project "$journal_compose_project" || die "Journal Compose project is invalid."
  validate_public_url "$journal_public_url" || die "Journal public URL is invalid."
  case "$journal_previous_current_kind" in
    symlink)
      [ -n "$journal_previous_link_target" ] && [ -n "$journal_previous_root" ] || die "Prior symlink metadata is incomplete."
      validate_direct_release_dir "$journal_previous_root" || die "Prior symlink root is invalid."
      [ -z "$journal_previous_path_identity" ] && [ -z "$journal_previous_backup_dir" ] || die "Prior symlink metadata is inconsistent."
      ;;
    path)
      [ -z "$journal_previous_link_target" ] || die "Prior path has a symlink target."
      [ "$journal_previous_root" = "$current_link" ] || die "Prior path root is invalid."
      [[ "$journal_previous_path_identity" =~ ^[0-9]+:[0-9]+$ ]] || die "Prior path identity is invalid."
      [ "$journal_previous_backup_dir" = "$DEPLOY_ROOT/current.backup.$journal_release_id" ] || die "Prior backup path is invalid."
      ;;
    missing)
      [ -z "$journal_previous_link_target" ] && \
        [ -z "$journal_previous_root" ] && \
        [ -z "$journal_previous_path_identity" ] && \
        [ -z "$journal_previous_backup_dir" ] || die "First-deploy journal has prior path metadata."
      ;;
    *) die "Journal prior current kind is invalid." ;;
  esac

  for service in api worker web nginx; do
    container_key="previous_${service}_container"
    running_key="previous_${service}_running"
    validate_container_id "${journal[$container_key]}" || die "Journal prior $service container identity is invalid."
    validate_running_flag "${journal[$running_key]}" || die "Journal prior $service running state is invalid."
    if [ -z "${journal[$container_key]}" ] && [ "${journal[$running_key]}" != "0" ]; then
      die "Journal prior $service state is inconsistent."
    fi
    if [ "$journal_previous_current_kind" = "missing" ] && { [ -n "${journal[$container_key]}" ] || [ "${journal[$running_key]}" != "0" ]; }; then
      die "First-deploy journal cannot claim prior app containers."
    fi
  done
}

atomic_replace_current_symlink() {
  link_target="$1"
  pending_link="$DEPLOY_ROOT/.current-reconcile.$$.$RANDOM"
  [ ! -e "$pending_link" ] && [ ! -L "$pending_link" ] || return 1
  ln -s -- "$link_target" "$pending_link" || return 1
  if ! mv -Tf -- "$pending_link" "$current_link"; then
    rm -f -- "$pending_link"
    return 1
  fi
  sync_path "$DEPLOY_ROOT"
}

current_resolves_to_candidate() {
  [ -L "$current_link" ] && [ "$(readlink -f "$current_link" 2>/dev/null || true)" = "$journal_release_dir" ]
}

remove_candidate_current() {
  if [ -L "$current_link" ]; then
    current_resolves_to_candidate || return 1
    rm -f -- "$current_link" || return 1
    sync_path "$DEPLOY_ROOT"
  elif [ -e "$current_link" ]; then
    return 1
  fi
}

restore_previous_current() {
  case "$journal_previous_current_kind" in
    symlink)
      if [ -L "$current_link" ] && [ "$(readlink "$current_link")" = "$journal_previous_link_target" ]; then
        return 0
      fi
      if [ -e "$current_link" ] || [ -L "$current_link" ]; then
        current_resolves_to_candidate || return 1
      fi
      atomic_replace_current_symlink "$journal_previous_link_target"
      ;;
    path)
      if [ -e "$current_link" ] && [ ! -L "$current_link" ] && [ "$(stat -Lc '%d:%i' "$current_link" 2>/dev/null || true)" = "$journal_previous_path_identity" ]; then
        return 0
      fi
      if [ -e "$current_link" ] || [ -L "$current_link" ]; then
        remove_candidate_current || return 1
      fi
      [ -e "$journal_previous_backup_dir" ] && [ ! -L "$journal_previous_backup_dir" ] || return 1
      [ "$(stat -Lc '%d:%i' "$journal_previous_backup_dir" 2>/dev/null || true)" = "$journal_previous_path_identity" ] || return 1
      mv -- "$journal_previous_backup_dir" "$current_link" || return 1
      sync_path "$DEPLOY_ROOT"
      ;;
    missing)
      remove_candidate_current
      ;;
  esac
}

project_service_containers() {
  docker ps -a --no-trunc \
    --filter "label=com.docker.compose.project=$journal_compose_project" \
    --filter "label=com.docker.compose.service=$1" \
    --filter "label=com.docker.compose.oneoff=False" \
    --format '{{.ID}}'
}

verify_recorded_container() {
  service="$1"
  container_id="$2"
  verify_container_contract "$service" "$container_id" "$journal_compose_project"
}

container_running() {
  [ "$(docker inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true)" = "true" ]
}

set_container_running() {
  container_id="$1"
  desired="$2"
  [ -n "$container_id" ] || return 0
  if [ "$desired" = "1" ]; then
    container_running "$container_id" || docker start "$container_id" >/dev/null
  elif container_running "$container_id"; then
    docker stop --time 120 "$container_id" >/dev/null
  fi
}

verify_prior_identity() {
  for service in api worker web nginx; do
    container_key="previous_${service}_container"
    expected="${journal[$container_key]}"
    actual="$(project_service_containers "$service")" || return 1
    if [ "$actual" != "$expected" ]; then
      printf 'DEPLOY_RECONCILE: prior %s container identity changed.\n' "$service" >&2
      return 1
    fi
    verify_recorded_container "$service" "$expected" || {
      printf 'DEPLOY_RECONCILE: prior %s container metadata changed.\n' "$service" >&2
      return 1
    }
  done
}

verify_prior_running_state() {
  for service in api worker web nginx; do
    container_key="previous_${service}_container"
    running_key="previous_${service}_running"
    container_id="${journal[$container_key]}"
    desired="${journal[$running_key]}"
    if [ -n "$container_id" ]; then
      actual=0
      container_running "$container_id" && actual=1
      [ "$actual" = "$desired" ] || return 1
    fi
  done
}

remove_candidate_preflights() {
  for service in api worker web; do
    container_name="leadvirt-${service}-preflight-$journal_release_id"
    if docker inspect "$container_name" >/dev/null 2>&1; then
      metadata="$(docker inspect \
        --format '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.service" }}|{{ index .Config.Labels "com.docker.compose.oneoff" }}|{{ index .Config.Labels "com.docker.compose.project.working_dir" }}|{{ index .Config.Labels "com.docker.compose.project.config_files" }}' \
        "$container_name" 2>/dev/null)" || return 1
      IFS='|' read -r candidate_project candidate_service candidate_oneoff candidate_working_dir candidate_config_files <<< "$metadata"
      candidate_owned=0
      case "$candidate_working_dir" in
        "$journal_release_dir"|"$journal_release_dir"/*) candidate_owned=1 ;;
      esac
      IFS=',' read -r -a candidate_config_paths <<< "$candidate_config_files"
      for candidate_config_path in "${candidate_config_paths[@]}"; do
        case "$candidate_config_path" in
          "$journal_release_dir"|"$journal_release_dir"/*) candidate_owned=1 ;;
        esac
      done
      [ "$candidate_project" = "$journal_compose_project" ] && \
        [ "$candidate_service" = "$service" ] && \
        [ "$candidate_oneoff" = "True" ] && \
        [ "$candidate_owned" = "1" ] || return 1
      docker rm -f "$container_name" >/dev/null || return 1
    fi
  done
}

wait_container_http() {
  container_id="$1"
  url="$2"
  expression="$3"
  for attempt in $(seq 1 30); do
    if docker exec "$container_id" node -e "fetch('$url').then(async r=>({ok:r.ok,v:await r.json().catch(()=>({}))})).then(x=>process.exit(x.ok&&($expression)?0:1)).catch(()=>process.exit(1))"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

recover_precommit() {
  printf 'DEPLOY_RECONCILE: restoring exact precommit state release=%s\n' "$journal_release_id"
  remove_candidate_preflights || return 1
  verify_prior_identity || return 1

  nginx_id="${journal[previous_nginx_container]}"
  set_container_running "$nginx_id" 0 || return 1
  restore_previous_current || return 1
  for service in api worker web; do
    container_key="previous_${service}_container"
    running_key="previous_${service}_running"
    set_container_running "${journal[$container_key]}" "${journal[$running_key]}" || return 1
  done

  if [ "${journal[previous_api_running]}" = "1" ]; then
    wait_container_http "${journal[previous_api_container]}" "http://127.0.0.1:4001/health/ready" "true" || return 1
  fi
  if [ "${journal[previous_web_running]}" = "1" ]; then
    for attempt in $(seq 1 30); do
      if docker exec "${journal[previous_web_container]}" node -e "fetch('http://127.0.0.1:3001').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
        break
      fi
      [ "$attempt" != "30" ] || return 1
      sleep 2
    done
  fi
  if [ "${journal[previous_worker_running]}" = "1" ]; then
    wait_container_http \
      "${journal[previous_worker_container]}" \
      "http://127.0.0.1:4002/health/ready" \
      "x.v.ready&&x.v.active" || return 1
  fi

  set_container_running "$nginx_id" "${journal[previous_nginx_running]}" || return 1
  verify_prior_identity || return 1
  verify_prior_running_state || return 1
  if [ "${journal[previous_nginx_running]}" = "1" ]; then
    for attempt in $(seq 1 30); do
      if curl -fsS "$journal_public_url/health/ready" >/dev/null && curl -fsS "$journal_public_url/" >/dev/null; then
        break
      fi
      [ "$attempt" != "30" ] || return 1
      sleep 2
    done
    auth_status="$(curl -sS -o /dev/null -w '%{http_code}' "$journal_public_url/api/auth/me")" || return 1
    [ "$auth_status" = "401" ] || return 1
  fi
  clear_journal
  printf 'DEPLOY_RECONCILE: exact precommit state restored release=%s\n' "$journal_release_id"
}

journal_compose() {
  LEADVIRT_IMAGE_TAG="$journal_release_id" \
  LEADVIRT_ENV_FILE="$journal_env_file" \
    docker compose \
      --project-name "$journal_compose_project" \
      --env-file "$journal_env_file" \
      -f "$journal_release_dir/deploy/docker-compose.staging.yml" \
      "$@" </dev/null
}

journal_compose_paused_worker() {
  LEADVIRT_IMAGE_TAG="$journal_release_id" \
  LEADVIRT_ENV_FILE="$journal_env_file" \
  WORKER_DEPLOYMENT_PAUSED=true \
    docker compose \
      --project-name "$journal_compose_project" \
      --env-file "$journal_env_file" \
      -f "$journal_release_dir/deploy/docker-compose.staging.yml" \
      "$@" </dev/null
}

wait_stateful_dependencies() {
  journal_compose up -d --no-recreate postgres redis qdrant clamav || return 1
  for attempt in $(seq 1 30); do
    if journal_compose exec -T postgres pg_isready -U leadvirt -d leadvirt >/dev/null && \
      [ "$(journal_compose exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ]; then
      break
    fi
    [ "$attempt" != "30" ] || return 1
    sleep 2
  done
  dependency_probe="const net=require('node:net');const tcp=()=>new Promise((resolve,reject)=>{const socket=net.createConnection({host:'clamav',port:3310});const fail=(error)=>{socket.destroy();reject(error)};socket.setTimeout(3000);socket.once('connect',()=>{socket.destroy();resolve()});socket.once('error',fail);socket.once('timeout',()=>fail(new Error('timeout')))});Promise.all([fetch('http://qdrant:6333/healthz',{signal:AbortSignal.timeout(3000)}).then(response=>{if(!response.ok)throw new Error('qdrant')}),tcp()]).then(()=>process.exit(0)).catch(()=>process.exit(1))"
  for attempt in $(seq 1 60); do
    if journal_compose run --rm --no-deps -T api node -e "$dependency_probe"; then
      return 0
    fi
    [ "$attempt" != "60" ] || return 1
    sleep 2
  done
}

stop_project_services() {
  for service in "$@"; do
    running="$(docker ps \
      --filter "label=com.docker.compose.project=$journal_compose_project" \
      --filter "label=com.docker.compose.service=$service" \
      --filter "label=com.docker.compose.oneoff=False" \
      --format '{{.ID}}')" || return 1
    if [ -n "$running" ]; then
      docker stop --time 120 $running >/dev/null || return 1
    fi
  done
}

recover_committed() {
  printf 'DEPLOY_RECONCILE: resuming candidate-only roll-forward release=%s\n' "$journal_release_id"
  [ "$(readlink -f "$current_link" 2>/dev/null || true)" = "$journal_release_dir" ] || return 1
  remove_candidate_preflights || return 1
  stop_project_services api worker nginx || return 1
  wait_stateful_dependencies || return 1
  journal_compose up --no-deps --force-recreate --abort-on-container-exit --exit-code-from migrate migrate || return 1
  journal_compose_paused_worker up -d --no-deps --no-build --force-recreate api worker web || return 1

  for attempt in $(seq 1 30); do
    if journal_compose exec -T api node -e "fetch('http://127.0.0.1:4001/health/ready').then(async r=>({ok:r.ok,v:await r.json()})).then(x=>process.exit(x.ok&&x.v.data?.deploymentPreflight===false?0:1)).catch(()=>process.exit(1))"; then
      break
    fi
    [ "$attempt" != "30" ] || return 1
    sleep 2
  done
  for attempt in $(seq 1 30); do
    if journal_compose exec -T worker node -e "fetch('http://127.0.0.1:4002/health/ready').then(async r=>({ok:r.ok,v:await r.json()})).then(x=>process.exit(x.ok&&x.v.ready&&!x.v.active&&x.v.deploymentPaused?0:1)).catch(()=>process.exit(1))"; then
      break
    fi
    [ "$attempt" != "30" ] || return 1
    sleep 2
  done
  for attempt in $(seq 1 30); do
    if journal_compose exec -T web node -e "fetch('http://127.0.0.1:3001').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
      break
    fi
    [ "$attempt" != "30" ] || return 1
    sleep 2
  done

  journal_compose exec -T api corepack pnpm --filter @leadvirt/api exec tsx ../../artifacts/scripts/knowledge-query-hmac-retained-keys-ready.ts || return 1
  journal_compose run --rm --no-deps -T nginx nginx -t || return 1
  journal_compose kill -s SIGUSR2 worker || return 1
  for attempt in $(seq 1 30); do
    if journal_compose exec -T worker node -e "fetch('http://127.0.0.1:4002/health/ready').then(async r=>({ok:r.ok,v:await r.json()})).then(x=>process.exit(x.ok&&x.v.ready&&x.v.active?0:1)).catch(()=>process.exit(1))"; then
      break
    fi
    [ "$attempt" != "30" ] || return 1
    sleep 2
  done
  journal_compose up -d --no-deps --no-build --force-recreate nginx || return 1
  for attempt in $(seq 1 30); do
    if curl -fsS "$journal_public_url/health/ready" >/dev/null && curl -fsS "$journal_public_url/" >/dev/null; then
      break
    fi
    if [ "$attempt" = "30" ]; then
      stop_project_services nginx || true
      return 1
    fi
    sleep 2
  done
  auth_status="$(curl -sS -o /dev/null -w '%{http_code}' "$journal_public_url/api/auth/me")" || return 1
  if [ "$auth_status" != "401" ]; then
    stop_project_services nginx || true
    return 1
  fi
  clear_journal
  printf 'DEPLOY_RECONCILE: candidate roll-forward complete release=%s\n' "$journal_release_id"
}

reconcile() {
  acquire_lock
  if [ ! -e "$journal_file" ] && [ ! -L "$journal_file" ]; then
    printf 'DEPLOY_RECONCILE: no pending deployment.\n'
    return 0
  fi
  docker info >/dev/null 2>&1 || die "Docker is unavailable; journal retained."
  load_journal
  case "${journal[phase]}" in
    precommit)
      if ! recover_precommit; then
        set_container_running "${journal[previous_nginx_container]}" 0 || true
        die "Precommit restoration failed; journal retained and nginx held stopped."
      fi
      ;;
    committed)
      if ! recover_committed; then
        stop_project_services nginx || true
        die "Candidate roll-forward failed; journal retained and nginx held stopped."
      fi
      ;;
  esac
}

release_is_referenced() {
  local candidate="$1"
  local current_root symlink_paths symlink_path container_references
  local working_dir config_files config_path
  local -a config_paths

  current_root="$(readlink -f "$current_link" 2>/dev/null || true)"
  [ "$current_root" != "$candidate" ] || return 0
  if [ -f "$journal_file" ] && [ ! -L "$journal_file" ]; then
    load_journal
    [ "$journal_release_dir" != "$candidate" ] || return 0
    [ "$journal_previous_root" != "$candidate" ] || return 0
  fi
  symlink_paths="$(find "$DEPLOY_ROOT" -mindepth 1 -maxdepth 1 -type l -print)" || return 0
  while IFS= read -r symlink_path; do
    [ -n "$symlink_path" ] || continue
    [ "$(readlink -f -- "$symlink_path" 2>/dev/null || true)" != "$candidate" ] || return 0
  done <<< "$symlink_paths"
  container_references="$(docker ps -a --no-trunc \
    --format '{{ index .Labels "com.docker.compose.project.working_dir" }}|{{ index .Labels "com.docker.compose.project.config_files" }}')" || return 0
  while IFS='|' read -r working_dir config_files; do
    [ "$(readlink -f -- "$working_dir" 2>/dev/null || true)" != "$candidate" ] || return 0
    IFS=',' read -r -a config_paths <<< "$config_files"
    for config_path in "${config_paths[@]}"; do
      [ "$(readlink -f -- "$config_path" 2>/dev/null || true)" != "$candidate/deploy/docker-compose.staging.yml" ] || return 0
    done
  done <<< "$container_references"
  return 1
}

managed_release() {
  local candidate="$1"
  local marker

  validate_direct_release_dir "$candidate" || return 1
  for marker in .leadvirt-release-sha .leadvirt-image-tag .leadvirt-compose-project; do
    [ -f "$candidate/$marker" ] && [ ! -L "$candidate/$marker" ] || return 1
    [ "$(wc -c < "$candidate/$marker")" -le 128 ] || return 1
  done
  validate_release_id "$(cat "$candidate/.leadvirt-image-tag")" || return 1
  [ "$(cat "$candidate/.leadvirt-image-tag")" = "$(basename "$candidate")" ] || return 1
  [[ "$(cat "$candidate/.leadvirt-release-sha")" =~ ^[0-9a-f]{40,64}$ ]] || return 1
  validate_project "$(cat "$candidate/.leadvirt-compose-project")" || return 1
  [ -f "$candidate/deploy/docker-compose.staging.yml" ] && \
    [ ! -L "$candidate/deploy/docker-compose.staging.yml" ]
}

image_tag_is_referenced() {
  local tag="$1"
  local image_markers marker container_ids container_id container_image

  if [ -f "$journal_file" ] && [ ! -L "$journal_file" ]; then
    load_journal
    [ "$journal_release_id" != "$tag" ] || return 0
  fi
  image_markers="$(find "$releases_root" -mindepth 2 -maxdepth 2 -type f -name .leadvirt-image-tag -print)" || return 0
  while IFS= read -r marker; do
    [ -n "$marker" ] || continue
    [ -f "$marker" ] && [ ! -L "$marker" ] || continue
    [ "$(wc -c < "$marker")" -le 128 ] || continue
    [ "$(cat "$marker")" != "$tag" ] || return 0
  done <<< "$image_markers"
  container_ids="$(docker ps -aq --no-trunc)" || return 0
  while IFS= read -r container_id; do
    [ -n "$container_id" ] || continue
    container_image="$(docker inspect --format '{{.Config.Image}}' "$container_id" 2>/dev/null)" || return 0
    [ "$container_image" != "leadvirt-app:$tag" ] || return 0
  done <<< "$container_ids"
  return 1
}

prune() {
  local retention_count="${1:-5}"
  local release_listing managed_index candidate
  local image_listing repository tag
  local -a releases_by_age

  [[ "$retention_count" =~ ^[0-9]+$ ]] || die "Release retention count is invalid."
  acquire_lock
  docker info >/dev/null 2>&1 || die "Docker is unavailable; pruning skipped."
  [ ! -e "$journal_file" ] && [ ! -L "$journal_file" ] || load_journal

  release_listing="$(
    find "$releases_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-
  )" || die "Release inventory failed; pruning skipped."
  releases_by_age=()
  if [ -n "$release_listing" ]; then
    mapfile -t releases_by_age <<< "$release_listing"
  fi
  managed_index=0
  for candidate in "${releases_by_age[@]}"; do
    managed_release "$candidate" || continue
    managed_index=$((managed_index + 1))
    [ "$managed_index" -gt "$retention_count" ] || continue
    release_is_referenced "$candidate" && continue
    managed_release "$candidate" || die "Release ownership changed during pruning."
    release_is_referenced "$candidate" && continue
    printf 'DEPLOY_PRUNE: removing unreferenced release=%s\n' "$(basename "$candidate")"
    rm -rf -- "$candidate"
    sync_path "$releases_root"
  done

  image_listing="$(docker image ls leadvirt-app --format '{{.Repository}} {{.Tag}}')" || \
    die "Image inventory failed; pruning skipped."
  while IFS=' ' read -r repository tag; do
    [ -n "$repository" ] || continue
    [ "$repository" = "leadvirt-app" ] || continue
    validate_release_id "$tag" || continue
    image_tag_is_referenced "$tag" && continue
    printf 'DEPLOY_PRUNE: removing unreferenced image=leadvirt-app:%s\n' "$tag"
    if ! docker image rm "leadvirt-app:$tag" >/dev/null; then
      printf 'DEPLOY_PRUNE: image retained because Docker rejected removal tag=%s\n' "$tag" >&2
    fi
  done <<< "$image_listing"
}

install_service() {
  [ "$(id -u)" = "0" ] || die "Boot reconciler installation requires root."
  mkdir -p "$DEPLOY_ROOT" "$releases_root"
  installed_script="$DEPLOY_ROOT/.deployment-journal.sh"
  script_temp="$DEPLOY_ROOT/.deployment-journal.sh.tmp.$$"
  install -m 0755 "$0" "$script_temp"
  sync_path "$script_temp"
  mv -Tf -- "$script_temp" "$installed_script"
  sync_path "$DEPLOY_ROOT"

  unit_path="/etc/systemd/system/leadvirt-deployment-reconcile.service"
  unit_temp="/etc/systemd/system/.leadvirt-deployment-reconcile.service.tmp.$$"
  {
    printf '[Unit]\n'
    printf 'Description=Reconcile interrupted LeadVirt deployment\n'
    printf 'After=docker.service network-online.target\n'
    printf 'Wants=docker.service network-online.target\n\n'
    printf '[Service]\n'
    printf 'Type=oneshot\n'
    printf 'ExecStart=/bin/bash %s reconcile\n' "$installed_script"
    printf 'TimeoutStartSec=20min\n'
    printf 'Restart=on-failure\n'
    printf 'RestartSec=15s\n\n'
    printf '[Install]\n'
    printf 'WantedBy=multi-user.target\n'
  } > "$unit_temp"
  chmod 0644 "$unit_temp"
  sync_path "$unit_temp"
  mv -Tf -- "$unit_temp" "$unit_path"
  sync_path /etc/systemd/system
  systemctl daemon-reload
  systemctl enable leadvirt-deployment-reconcile.service >/dev/null
  systemctl is-enabled --quiet leadvirt-deployment-reconcile.service
  sync_path /etc/systemd/system/multi-user.target.wants
}

command="${1:-}"
case "$command" in
  write)
    acquire_lock
    write_journal "${2:-}"
    ;;
  clear)
    die "Manual journal clearing is not supported; reconcile the recorded phase."
    ;;
  reconcile)
    reconcile
    ;;
  prune)
    prune "${2:-5}"
    ;;
  install-service)
    install_service
    ;;
  *)
    die "Usage: deployment-journal.sh {write <precommit|committed>|reconcile|prune [count]|install-service}"
    ;;
esac
