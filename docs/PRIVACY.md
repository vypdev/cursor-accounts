# Privacy and Security

How **Cursor Accounts** handles your data.

## What data is accessed

- **Auth tokens** — read from your local Cursor install's `state.vscdb` (`cursorAuth/accessToken`, `cursorAuth/refreshToken`, `cursorAuth/cachedEmail`). This is the same data the IDE already uses for authentication.
- **Composer data** — when model efficiency analysis is enabled, the extension reads Composer message metadata from the active profile's `state.vscdb` to detect new prompts and selected models.
- **Profile configuration** — metadata stored in `~/.cursor-accounts/config.json` (email, display name, user data directory paths). **GitHub PATs are never stored in this file** — only an optional path to a token file you choose.
- **Git remotes** — when the Accounts panel loads, the extension reads `origin` URLs from local `.git/config` under recent project folders to resolve GitHub repository names.
- **Optional GitHub token file** — if you configure a token file path per profile, the extension reads that file locally to fetch metadata for **private** repositories. This is opt-in and not required.

## Where data is sent

Network requests go to:

- `api2.cursor.sh` — quota fetching and OAuth token refresh
- `cursor.com` — web dashboard usage summary and enterprise analytics
- `api.github.com` — **optional** repository metadata for recent projects (public repos without a token; private repos only when you configure a token file path)

Public GitHub data uses unauthenticated API requests (rate-limited per GitHub policy). Authenticated requests are sent only when you explicitly set a token file path for a profile.

## What is stored locally

| Data | Location | Notes |
|------|----------|-------|
| Refreshed OAuth tokens | VS Code Secret Storage (per profile) | Not written back to `state.vscdb` |
| Last-known quota | Extension `globalState` | Cached for instant display on startup |
| Profile metadata | `~/.cursor-accounts/config.json` | No tokens; optional `githubTokenPath` (file path only) |
| Model efficiency API key | VS Code Secret Storage (active window) | Created when efficiency analysis is enabled |

## Token handling and security

- **Read-only** access to each profile's `state.vscdb` — the extension does not modify Cursor's authentication database
- **No SQLite snapshot swapping** between accounts — this extension does not implement unsupported account-switching techniques
- **Path validation** before reading or launching under a profile directory (`validateUserDataPath`)
- **Process isolation** — each profile runs as a separate Cursor instance with its own user data directory

Be aware that extensions installed in a profile can access that profile's tokens (CursorJacking awareness). See [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) for security notes.

## Related documentation

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) — authentication and token refresh flow
- [RESEARCH.md](RESEARCH.md) — API endpoints and account-switching constraints
- [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) — profile isolation and security
