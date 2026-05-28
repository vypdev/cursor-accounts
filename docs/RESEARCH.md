# Research Summary — Cursor Accounts Extension

This document records how quota data is obtained, refresh behavior, API limits, and account-switching feasibility. Implementation choices follow these findings; undocumented APIs are not assumed.

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

**IDE response fields used:**

- `planUsage.totalPercentUsed` — total plan usage %
- `planUsage.apiPercentUsed` — included/API pool % (shown as “included” bar)
- `planUsage.autoPercentUsed` — Auto mode % (tooltip)
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

## References

- [Cursor API docs](https://cursor.com/docs/api)
- [Forum: no personal usage API](https://forum.cursor.com/t/usage-api-cli-command/160967)
- [Forum: account switching](https://forum.cursor.com/t/seamless-account-switching-in-cursor/58411)
- [openusage Cursor provider](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md)
