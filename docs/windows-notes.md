# Running this on Windows

Two machine-level policies bit repeatedly during development. Neither is a
defect in this repository and neither exists on the Linux CI runners, but both
look like build failures until you know what they are.

## Smart App Control blocks freshly built test binaries

```
error: could not execute process `target\debug\deps\go001-<hash>.exe`
Caused by: Una directiva de Control de aplicaciones bloqueó este archivo. (os error 4551)
```

Check whether it is enforced:

```powershell
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState
```

`1` is enforced, `2` evaluation, `0` off.

Smart App Control blocks unsigned executables it has no reputation for. Every
`cargo test` build produces a new hash, so test binaries are the ones that get
caught; `target/release/csanalyze.exe` earns a reputation from repeated use and
keeps running. Rebuilding sometimes clears it and sometimes does not, and
`CARGO_TARGET_DIR` elsewhere makes it worse — build scripts get blocked too.

What actually works — WSL, verified:

```bash
wsl -d Ubuntu -- bash -lc "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal"
wsl -d Ubuntu -u root -- bash -c "apt-get install -y build-essential"   # the linker
wsl -d Ubuntu -- bash -lc "cd /mnt/c/laragon/www/controlshift && CARGO_TARGET_DIR=\$HOME/cs-target cargo test"
```

`CARGO_TARGET_DIR` outside `/mnt/c` matters twice: it keeps the Windows MSVC
artifacts intact, and it moves the build off the 9p mount, which is slow.

Same toolchain version, same result: 34 tests pass, `cargo fmt --check` clean,
`cargo clippy -D warnings` clean.

Other options:

- **CI**, where the policy does not apply.
- Or turn Smart App Control off in Windows Security → App & browser control.
  That is a real reduction in the machine's security posture and it cannot be
  turned back on without reinstalling Windows, so it is a decision for whoever
  owns the machine, not something to do casually to get a green build.

The product itself is unaffected: the release binary runs, so the API, the
console and `scripts/e2e_go001.py` all work.

## The Docker engine service needs elevation

`docker compose up` fails with the daemon unreachable, and
`Start-Service com.docker.service` fails without an elevated shell. Docker
Desktop's UI process starts, but the Linux engine behind it never does.

For the malware scanner, `docs/scanner-setup.md` covers running real ClamAV in
WSL instead, which needs no elevation.

## Two smaller ones

- **A production `next build` clobbers a running dev server's `.next`.** Stop
  the dev server first, or the page starts 500ing with
  `Cannot find module './vendor-chunks/next.js'`.
- **Git Bash rewrites `/etc/...` style arguments into Windows paths** when
  invoking `wsl`. Prefix the command with `MSYS_NO_PATHCONV=1`.
