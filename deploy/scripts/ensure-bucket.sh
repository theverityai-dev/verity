#!/usr/bin/env bash
# Makes sure the object-store bucket exists (drill finding F5).
#
# Idempotent and safe to re-run: an existing bucket is never changed. It only
# creates a bucket that is missing, and only when VERITY_STORAGE_CREATE_BUCKET is
# true (the default). With false the customer owns the bucket, and this fails,
# creating nothing, if it does not exist. It has nothing to do, and exits 0, when
# the deployment does not use the S3 driver.
#
# Run by install.sh after the object store is started and before the final
# readiness check, because readiness fails without the bucket. Runs in the tools
# image like migrate.sh: the application itself never creates a bucket.

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_docker
require_env_file

log "ensuring the object-store bucket"
compose --profile tools run --rm --entrypoint "" tools node prisma/run-seed.cjs ensure-storage-bucket.ts
