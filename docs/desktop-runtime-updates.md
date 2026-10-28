# Desktop and service updates

Veymux Desktop connects to independently installed Veymux services.
Each connected service owns its CLI installation and Runtime update lifecycle.
The CLI and service Runtime controls in Settings operate on that connected
service through its encrypted page transport.

The Rust macOS application (macOS 14+, Apple Silicon) uses a build-pinned
Tauri updater manifest and signing key. Application updates are independent of
the connected service version and require the user to accept installation.
See [the release contract](../desktop-rust/RELEASE.md).

Direct connections load the service's web frontend. A saved connection reachable
only through an entry service uses static frontend resources bundled with the
Desktop application; those resources update with the application.

## Deciding whether to rebuild macOS

Run:

```bash
git fetch --tags
npm run release:classify -- <last-desktop-tag>
```

Rust desktop source, signing configuration, and packaging workflow changes
require rebuilding the application. Standalone service changes publish through
npm. If an entry-service connection needs a newer bundled frontend, rebuild the
application with that frontend.

The npm runtime manifest remains available for standalone service client
snapshots.
