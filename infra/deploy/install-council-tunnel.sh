#!/bin/sh
# Install OpenAI's runtime on the current x86-64 VPS. Activation is separate.
set -eu
[ "$(uname -m)" = x86_64 ]
version=v0.0.21
file=tunnel-client-$version-linux-amd64.zip
checksum=9e91a539e3ae1c436d499f216a1d7514b3c86cc7779032f41b2a05821d74b03a
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cd "$dir"
curl --fail --silent --show-error --location --max-time 90 \
  "https://github.com/openai/tunnel-client/releases/download/$version/$file" -o "$file"
printf '%s  %s\n' "$checksum" "$file" | sha256sum --check --status
python3 - "$file" <<'PYZIP'
import shutil
import sys
from pathlib import PurePosixPath
from zipfile import ZipFile

with ZipFile(sys.argv[1]) as archive:
    [binary] = [p for p in archive.namelist() if PurePosixPath(p).name == "tunnel-client"]
    with archive.open(binary) as origin, open("tunnel-client", "wb") as target:
        shutil.copyfileobj(origin, target)
PYZIP
chmod 0755 tunnel-client
./tunnel-client --version
install -o root -g root -m 0755 tunnel-client /opt/council-next/bin/tunnel-client
