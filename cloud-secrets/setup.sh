#!/usr/bin/env bash
# Back-compat wrapper around the Node vault tool. Decrypts cloud-secrets/vault.enc
# into place using $SECRETS_PASSPHRASE. Pure-Node crypto lives in vault.mjs.
exec node "$(dirname "$0")/vault.mjs" unlock
