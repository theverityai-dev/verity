#!/usr/bin/env bash
# Proves every digest-pinned container image in this package can still be pulled.
#
# Drill finding F2: the bundled object store's pinned image was withdrawn by its publisher and
# nothing noticed until an operator's install failed. A pin guarantees WHICH bytes run; it cannot
# guarantee those bytes are still published. This finds out in a week instead of at install time.
#
#   ./deploy/scripts/check-image-pins.sh          resolve every pinned reference (needs the network)
#   ./deploy/scripts/check-image-pins.sh --list   print the references and exit (offline)
#
# Run weekly by .github/workflows/image-pins.yml. It only asks the registry whether the manifest
# exists; it pulls nothing.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"

# Every `image: <ref>@sha256:<digest>` in the compose files and every `FROM <ref>@sha256:<digest>`
# in the Dockerfile. Images that are built locally or chosen by the operator carry no digest and
# are not pins, so they are not listed.
pinned_references() {
  {
    sed -n -E 's/^[[:space:]]*image:[[:space:]]+([^[:space:]]+@sha256:[a-f0-9]{64}).*/\1/p' "${COMPOSE_DIR}"/*.yml
    sed -n -E 's/^FROM[[:space:]]+([^[:space:]]+@sha256:[a-f0-9]{64}).*/\1/p' "${REPO_DIR}/Dockerfile"
  } | sort -u
}

REFS="$(pinned_references)"
[ -n "${REFS}" ] || die "found no pinned image references: the extraction is broken, or the pins were removed"

if [ "${1:-}" = "--list" ]; then
  printf '%s\n' "${REFS}"
  exit 0
fi

require_docker

# `docker manifest inspect` cannot verify an OCI image index and reports "manifest verification
# failed" for digests that pull perfectly well, which would raise a false alarm every week. buildx's
# imagetools understands both index formats, so it is used when present and the older command is only
# the fallback.
resolve_reference() {
  if docker buildx version >/dev/null 2>&1; then
    docker buildx imagetools inspect "$1"
  else
    docker manifest inspect "$1"
  fi
}

failed=0
while IFS= read -r ref; do
  ok=0
  for attempt in 1 2 3; do
    if reason="$(resolve_reference "${ref}" 2>&1 >/dev/null)"; then ok=1; break; fi
    [ "${attempt}" -lt 3 ] && sleep 5
  done
  if [ "${ok}" = "1" ]; then
    log "resolves: ${ref}"
  else
    warn "CANNOT BE PULLED: ${ref} ($(printf '%s' "${reason}" | head -n 1))"
    failed=$((failed + 1))
  fi
done <<< "${REFS}"

[ "${failed}" -eq 0 ] || die "${failed} pinned image(s) can no longer be pulled; replace them before the next install"
log "all $(printf '%s\n' "${REFS}" | wc -l | tr -d ' ') pinned images resolve"
