# Research Summary — Cursor Accounts Extension

This document records how quota data is obtained, refresh behavior, API limits, and account-switching feasibility. Implementation choices follow these findings; undocumented APIs are not assumed.

**Last reviewed:** 2026-06-03

## 1. Quota / usage data

### Official position

Cursor staff (forum, 2026) state there is **no public personal usage API** for individual plans. Supported surfaces:

- **Cursor Settings → Usage** (IDE)
- **cursor.com** dashboard / settings (web)
- **Enterprise:** documented Admin and Analytics APIs at [cursor.com/docs/api](https://cursor.com/docs/api) (`https://api.cursor.com`, API keys, hourly aggregates)

### What this extension uses

| Source | Endpoint | Auth | When |
|--------|----------|------|------|
| IDE backend (Connect RPC) | `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` | Bearer JWT from `cursorAuth/accessToken` | Pro/Ultra; also attempted for enterprise |
| Web dashboard | `GET https://cursor.com/api/usage-summary` | `WorkosCursorSessionToken` cookie (derived from JWT) | Enterprise / team accounts; fallback when IDE data is empty |
| Web dashboard (usage table) | `POST https://cursor.com/api/dashboard/get-filtered-usage-events` | Same session cookie + `Origin: https://cursor.com` | **Not used** by this extension; see [USAGE-EVENTS-API.md](USAGE-EVENTS-API.md) |

**IDE response fields used:**

- `planUsage.totalPercentUsed` — total plan usage %
- `planUsage.apiPercentUsed` — API mode % (status bar average, account listing)
- `planUsage.autoPercentUsed` — Auto mode % (status bar average, account listing)
- Spend fields in **cents**: `totalSpend`, `includedSpend`, `remaining`, `limit`
- `spendLimitUsage` — on-demand / team pool spend (mapped to **Monthly Usage** when present)
- `billingCycleStart` / `billingCycleEnd` (ms strings)
- `displayMessage` (optional)

**Web usage-summary fields used (enterprise parity):**

- `membershipType`, `limitType`
- `individualUsage.onDemand.used` / `.limit` — monthly on-demand spend (cents)
- `teamUsage.onDemand` — team pool spend (cents)
- `billingCycleStart` / `billingCycleEnd` — ISO 8601 timestamps

### Multi-profile token resolution

The status bar reads tokens from the **active window’s** `state.vscdb` (respects `--user-data-dir`), not a global default path. OAuth refresh tokens are stored in VS Code Secret Storage **scoped per user-data directory** to avoid mixing accounts across profiles.

### Authentication discovery path

1. **Settings parity** — Usage UI in Cursor Settings matches dashboard semantics.
2. **Local storage** — `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (macOS), keys `cursorAuth/accessToken`, `cursorAuth/refreshToken`, `cursorAuth/cachedEmail`.
3. **Network inspection** — IDE calls `api2.cursor.sh` with Connect headers when opening Usage.
4. **Community references** — [openusage cursor provider doc](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md), [cursor-usage gist](https://gist.github.com/dmwyatt/1e9359b1862e7cbfe1e754fe4c8db764), extensions `cursor-limits`, `cursor-usage-extension`.

### Alternatives not used as primary

| API | Notes |
|-----|--------|
| `GET api2.cursor.sh/auth/usage` | Legacy GPT-4 request counters |
| Enterprise Admin API (`api.cursor.com`) | Team-wide admin analytics; requires team API keys (out of scope) |

### Refresh strategy

- **No push/subscribe** from Cursor to extensions.
- Extension polls on an interval (default **60s**, min **30s**).
- **In-flight guard** — skip overlapping requests.
- **AbortSignal.timeout(15s)** per request.
- **Exponential backoff** on failures (max 5 minutes).
- **Cache** — `globalState.lastQuota` for instant display on activation.
- **Token refresh** — `POST api2.cursor.sh/oauth/token` with `refresh_token`; new tokens stored in profile-scoped `context.secrets` (not written back to `state.vscdb`).

## 2. VS Code / Cursor extension API limits

| Capability | Supported? |
|------------|------------|
| `createStatusBarItem` + `show()` on activation | Yes |
| `onStartupFinished` activation | Yes |
| Read Cursor quota via official extension API | **No** |
| `vscode.authentication` for Cursor account | **No** (GitHub/Microsoft only) |
| Subscribe to quota change events | **No** |
| Cursor Hooks for billing | **No** (agent lifecycle only) |

**Cursor-specific APIs** (`vscode.cursor.*`) cover MCP/plugins, not billing.

## 3. Account switcher feasibility

### Conclusion: **not feasible via supported APIs**

| Approach | Verdict |
|----------|---------|
| Official in-app multi-account switch | Does not exist for subscription accounts |
| `vscode.authentication.registerAuthenticationProvider` | Not available for Cursor Auth0 session |
| Extension one-click switch | Only via **unsupported** `state.vscdb` snapshot swap (reload required, security/ToS risk) |
| **Recommended:** `--user-data-dir` separate instances | **Supported** (Cursor forum staff guidance) |
| VS Code Profiles | Settings/extensions only; **does not** switch Cursor login |

### Closest viable alternatives

1. Separate Cursor instances per account (`--user-data-dir`).
2. Read-only email in tooltip (`cursorAccounts.statusBar.showAccountEmail`).
3. Document limitations in README (implemented).

This extension **does not** implement SQLite snapshot switching.

## 4. Risks and maintenance

- Reverse-engineered endpoints may change on Cursor updates.
- `state.vscdb` can be large or locked; extension copies to temp when needed.
- Included vs on-demand vs credits pools may not match a single percentage in all plan types.
- Enterprise **Monthly Usage** depends on the undocumented web `usage-summary` endpoint when the IDE API returns empty plan data.
- Team Admin API (`api.cursor.com`) is not used — requires separate admin API keys.

### Analytics leaderboard (enterprise, session cookie)

The dashboard at `cursor.com/dashboard/analytics` loads team AI activity rankings via:

```
GET https://cursor.com/api/v2/analytics/team/leaderboard
  ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&teamId=<id>&pageSize=10
```

Auth: `WorkosCursorSessionToken` cookie (same as usage-summary). Response includes `composer_leaderboard.data[]` with `rank`, `display_name`, `email`, `total_composer_lines_accepted`. This is **usage activity**, not dollar spend. `teamId` comes from `GET /api/dashboard/teams`.

The Accounts panel fetches this for enterprise profiles (30-day window) and shows the top 10 under each profile card.

## 5. GitHub repository metadata (Accounts panel)

### Flow

1. Resolve `owner/repo` from each recent project's local `git` remote (`origin`).
2. Probe visibility: `GET https://api.github.com/repos/{owner}/{repo}` **without** authentication.
3. **Public** (`200`, `private: false`) — fetch commits, branches, open issues, and open pull requests without a token.
4. **Private** (`404` to unauthenticated callers) — show a **Private** label only; no further API calls unless the user configures a token file path on that profile.
5. **Optional token file** — user-selected absolute path; PAT read at request time (not stored in `config.json`). Used only for private repos on that profile.

### Endpoints (public, no token)

| Data | Endpoint |
|------|----------|
| Visibility | `GET /repos/{owner}/{repo}` |
| Commits | `GET /repos/{owner}/{repo}/commits?per_page=5` |
| Branches | `GET /repos/{owner}/{repo}/branches?per_page=30` |
| Issues | `GET /repos/{owner}/{repo}/issues?state=open&per_page=20` |
| Pull requests | `GET /repos/{owner}/{repo}/pulls?state=open&per_page=20` |

### Rate limits

- Unauthenticated: **60 requests/hour** per IP (GitHub REST).
- Authenticated (optional PAT): **5,000 requests/hour** per token.

The extension caps enrichment to **5 recent git projects per profile** per refresh to stay within limits.

### Not used

- Cursor `cursorAuth` JWT (not valid for `api.github.com`)
- `vscode.authentication.getSession('github')` — not required; token file path is explicit opt-in
- Reading encrypted `github.auth` from `state.vscdb`

## 6. Known limitations

- **Unofficial API** — may change without notice when Cursor updates.
- **Enterprise teams** — Monthly Usage uses the web dashboard API; team Admin/Analytics APIs at `api.cursor.com` are not used (admin API keys required).
- **Credits vs included pool** — UI follows combined IDE + web sources; "100% included" in Settings can still allow usage via credits.
- **Cursor-only** — built for Cursor; standard VS Code may lack `state.vscdb` auth keys.
- **No push/subscribe** — quota changes are detected via polling only; there is no official event API for usage updates.
- **GitHub** — unauthenticated callers cannot distinguish private repos from missing repos (both return 404); private repos need an optional PAT file with `repo` scope.

For privacy and data handling, see [PRIVACY.md](PRIVACY.md).

## Agent, Bidi, and live token observation (MITM)

Optional localhost MITM proxy decodes Agent traffic on `api2` (HTTP/1: `RunPoll`, `BidiAppend`) or `agent.api5` (HTTP/2: `Run`, `RunSSE`). Findings:

| Signal | Billing-grade? | Notes |
|--------|----------------|-------|
| `InteractionUpdate.token_delta` | No | Streaming progress counter; often 100×+ below real spend |
| `InteractionUpdate.turn_ended` | Yes when present | Frequently **absent** in long HTTP/1 captures |
| `GetCurrentPeriodUsage.totalSpend` delta | Period cents | Includes all Cursor usage in the window, not one chat |
| Dashboard `chargedCents` | Per request | Not called by extension; best validation source |

Full reference (RPC matrix, decode pipeline, scripts, validation): **[TOKENS-AND-USAGE.md](TOKENS-AND-USAGE.md)**. Setup: [PROXY-SETUP.md](PROXY-SETUP.md).

## Related documentation

- [TOKENS-AND-USAGE.md](TOKENS-AND-USAGE.md) — token signals and billing channels
- [PROXY-SETUP.md](PROXY-SETUP.md) — MITM proxy setup
- [USAGE-EVENTS-API.md](USAGE-EVENTS-API.md) — per-request usage table (`cursor.com/dashboard/usage`)
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) — user-facing technical overview
- [ARCHITECTURE.md](ARCHITECTURE.md) — extension structure and data flows
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — common issues and account-switching guidance
- [PRIVACY.md](PRIVACY.md) — privacy and security

## References

- [Cursor API docs](https://cursor.com/docs/api)
- [Forum: no personal usage API](https://forum.cursor.com/t/usage-api-cli-command/160967)
- [Forum: account switching](https://forum.cursor.com/t/seamless-account-switching-in-cursor/58411)
- [openusage Cursor provider](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md)
