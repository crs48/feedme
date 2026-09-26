#!/bin/sh
set -eu

# Hosts may mount a fresh disk as root, hiding the image's directory ownership.
# Initialize only the data directory, then run the application without root.
if [ "$(id -u)" = '0' ]; then
  data_dir="${DATA_DIR:-/data}"
  mkdir -p "$data_dir"
  chown node:node "$data_dir"
  exec gosu node "$@"
fi

exec "$@"
