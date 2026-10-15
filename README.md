# reschanger

A lightweight Windows tray app for quickly switching monitor resolution and refresh rate. Built with Tauri v2 (Rust + WebView2), with automatic updates.

## Requirements

- Windows 10/11 (WebView2 ships with the OS; the installer adds it if missing)
- [Bun](https://bun.sh)
- [Rust](https://rustup.rs) (`stable-x86_64-pc-windows-msvc` toolchain)

In PowerShell with script execution blocked, use `bun.cmd` instead of `bun`.

## Development

```powershell
bun install
bun run dev
```

## Checks

```powershell
bun run check
bun run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

## Local build

The build produces signed updater artifacts, so it needs the private key:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw ~\.tauri\reschanger.key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
bun run build
```

The installer is written to `src-tauri\target\release\bundle\nsis\`.

## Releases and auto-update

1. Bump `version` in `package.json` (Tauri reads the version from there).
2. Commit and tag: `git tag v0.2.1 && git push --tags`.
3. The `.github/workflows/release.yml` workflow builds the NSIS installer, signs it and publishes a release with `latest.json`.

The app checks `https://github.com/igorovh/reschanger/releases/latest/download/latest.json` 15 s after startup and then every 6 hours. You can also check manually from the tray menu or the settings dialog. Updates install in `passive` mode: a progress bar, no UAC prompt, since the app installs per user.

Repository secrets required by CI:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of `~\.tauri\reschanger.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password (empty)

If the private key is lost, installed copies will not accept further updates.

## Project structure

- `src/renderer`: UI (React + Vite)
- `src/shared`: types and translations (`translations.json` is shared with Rust)
- `src-tauri/src`: backend. Monitor WinAPI calls (`display.rs`), process detection and system helpers (`system.rs`), preset logic (`core.rs`), tray, updater

## Local data

Settings and presets (same format as the Electron version):

```text
%APPDATA%\reschanger\settings.json
```
