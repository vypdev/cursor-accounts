# How It Works

Technical overview of how **Cursor Accounts** fetches and displays quota data. For implementation details, see [ARCHITECTURE.md](ARCHITECTURE.md). For API research and constraints, see [RESEARCH.md](RESEARCH.md).

## Data flow

1. Reads the Cursor session from the **active window's** local `state.vscdb` (`cursorAuth/accessToken`, `cursorAuth/refreshToken`) — respects `--user-data-dir` for multi-profile setups.
2. Calls the reverse-engineered IDE endpoint:  
   `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
3. For **enterprise / team** accounts (or when IDE data is empty), also calls the web dashboard endpoint:  
   `GET https://cursor.com/api/usage-summary` (session cookie derived from the same JWT)
4. Refreshes expired tokens via `https://api2.cursor.sh/oauth/token` and stores them in VS Code **Secret Storage** scoped per profile (does not write back to `state.vscdb`).

## Authentication and tokens

### Local session storage

Cursor stores authentication in `state.vscdb` under the user data directory:

- **macOS:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
- Keys: `cursorAuth/accessToken`, `cursorAuth/refreshToken`, `cursorAuth/cachedEmail`

The extension reads this database read-only. When the database is locked, it copies to a temp file using bundled SQLite binaries.

### Token refresh

When the access token expires, the extension refreshes via `POST https://api2.cursor.sh/oauth/token` with the refresh token. New tokens are stored in VS Code **Secret Storage** scoped per user-data directory — they are **not** written back to `state.vscdb`.

## Quota fetching

### Personal accounts

The IDE endpoint returns plan usage percentages (API mode, auto mode, total) and spend fields. The status bar shows an averaged API/auto indicator for personal plans.

### Enterprise / team accounts

When IDE data is empty or for team plans, the extension falls back to the web dashboard `usage-summary` endpoint. **Monthly Usage** spend is shown in the status bar (e.g. `$94.00 / $600.00` with percent).

### Refresh behavior

- Polls on a configurable interval (default 60s, min 30s)
- In-flight guard prevents overlapping requests
- 15s timeout per request with exponential backoff on failures (max 5 minutes)
- Caches last-known quota in `globalState` for instant display on activation

See [RESEARCH.md](RESEARCH.md) for full API field mappings and refresh strategy details.

## Multi-profile token resolution

The status bar reads tokens from the **active window's** `state.vscdb`, not a global default path. This respects `--user-data-dir` for multi-profile setups.

For the Accounts panel, `MultiProfileQuotaService` reads each configured profile's `state.vscdb` independently and fetches quota in parallel. OAuth refresh tokens are stored in Secret Storage **scoped per user-data directory** to avoid mixing accounts across profiles.

See [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) for profile management flows.

## Network boundaries

All network requests go to Cursor endpoints only:

- `api2.cursor.sh` — IDE quota and OAuth
- `cursor.com` — web dashboard usage summary, usage events, and analytics (see [USAGE-EVENTS-API.md](USAGE-EVENTS-API.md) for the per-request usage table)

No third-party servers. See [PRIVACY.md](PRIVACY.md) for privacy details.

## Related documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — extension structure, data flows, design decisions
- [RESEARCH.md](RESEARCH.md) — API research, limitations, account-switching investigation
- [USAGE-EVENTS-API.md](USAGE-EVENTS-API.md) — dashboard usage events (`/dashboard/usage` table)
- [FEATURE-MULTI-PROFILE.md](FEATURE-MULTI-PROFILE.md) — multi-profile product design
- [PLATFORM-SUPPORT.md](PLATFORM-SUPPORT.md) — SQLite binaries for reading `state.vscdb`
