# Running a scanner for artifact intake

The API speaks clamd's INSTREAM protocol over TCP (`CLAMD_HOST`, `CLAMD_PORT`).
Anything that speaks it will do. Two ways to get one.

## 1. The compose service (intended deployment)

```bash
docker compose -f infra/docker-compose.yml up -d clamav
```

Then set `CLAMD_HOST=127.0.0.1` in `services/api/.env`.

The first start downloads the signature database and takes several minutes.
Until clamd answers, uploads stay `RECEIVED` and analysis refuses them — that
is the correct behaviour, not a failure.

## 2. WSL, when the Docker engine is unavailable

Docker Desktop's engine service needs elevation to start, so on a locked-down
Windows machine this is the faster route to a *real* ClamAV:

```bash
wsl -d Ubuntu -u root -- bash -c "apt-get update && apt-get install -y clamav-daemon clamav-freshclam"
```

The install runs `freshclam` for you. Then set `TCPSocket 3310` and
`TCPAddr 0.0.0.0` in `/etc/clamav/clamd.conf`, raise `StreamMaxLength` to match
`MAX_ARTIFACT_BYTES`, and run the daemon in the foreground:

```bash
wsl -d Ubuntu -u root -- bash -c "mkdir -p /var/run/clamav && chown clamav:clamav /var/run/clamav && clamd --foreground=yes"
```

WSL2 forwards the listener, so Windows reaches it at `127.0.0.1:3310`. The
daemon lives as long as that process does.

## Proving it works

```bash
scripts/smoke_scanner.sh
```

Sends the EICAR test string and a clean rung through INSTREAM and fails loudly
if the scanner does not flag one and pass the other. EICAR is not malware: it
is the string every scanner has agreed to detect, which is exactly what makes
it safe to keep in a repository and in a smoke test.

## What happens when there is no scanner

Nothing silently passes. `CLAMD_HOST` unset, daemon down, timeout, protocol
error — all of it resolves to UNAVAILABLE, the artifact is stored `RECEIVED`,
and analysis refuses to consume it. The API says so at startup:

```
no malware scanner configured (CLAMD_HOST unset): uploads will be stored
as RECEIVED and analysis will refuse them
```

`ALLOW_UNSCANNED_ARTIFACTS=true` overrides that for development only.
