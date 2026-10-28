# Veymux for macOS

Veymux is a Rust/Tauri client for independently running Veymux services.
It requires macOS 14 or newer on Apple Silicon. The app connects to services
on this Mac, on the local network, or at a public service URL.

## Getting started

The connection center provides **这台 Mac**, **其他电脑**, **桌面偏好**, and
**使用指南**. Each setup step shows its next action, with addresses and logs
available on demand. Remote drafts are preserved when switching panels.

An existing local service is reused. Otherwise the app locates Node.js 22+
and the standalone `veymux` CLI and starts its supervised service. If Node.js
is missing, it offers the official download page. **安装并启动** installs a
missing CLI into `~/.veymux/cli` without sudo and starts it. Installation is
restricted to the trusted connection center and requires an explicit action.
Quitting or updating the app leaves services and terminal sessions running.

Connections and desktop preferences are stored under the application support
directory for `com.jovines.veymux`; on macOS this is
`~/Library/Application Support/com.jovines.veymux/connections.json`.
Each service has an isolated WebView profile and device authorization.
Direct connections load that service's frontend; connections reachable only
through an entry service use the app's bundled frontend.

## Native integration

- Native title bar, traffic lights, menu bar status and optional floating widget.
- `⌘,` opens settings; `⌘T` creates a session and `⌘W` closes the active session.
- `⌘⇧[` / `⌘⇧]` switch sessions; `⌘B` toggles sessions and `⌘⇧B` toggles files.
- Clipboard images, files and native movie data are read on this Mac. The active
  service page uploads bytes through encrypted transport and inserts the
  returned shell-quoted paths. Original paths are reused only when the target
  service identity is confirmed to belong to this Mac.
- Native downloads save bytes fetched by the encrypted page. Cancellation,
  connection changes and failures terminate the transfer.
- Application updates use the pinned public key and signed Tauri manifest at
  `stable-channel/latest.json`, after the user accepts installation.

## Building and distribution

Use Node.js 22+, Rust 1.93+ and the macOS build tools:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix desktop-rust
npm --prefix desktop-rust run verify
npm --prefix desktop-rust run build
```

Public distribution requires Developer ID signing, App and DMG notarization,
staple and Gatekeeper verification. Credentials stay outside the repository.
See [the release contract](../desktop-rust/RELEASE.md) for exact-source
packaging, asset checks and publication. Download the versioned
`Veymux_VERSION_aarch64.dmg` from GitHub Releases.

Connection-center regression coverage is in
`tests/desktopConnectionCenter.test.ts` and
`src/components/services/ConnectionCenterServices.test.tsx`. Browser fixtures
exercise interaction states; actual installation, native permissions and first
launch must also be checked in the signed macOS app.
