# Dashboard Usage Events API

Technical reference for the per-request usage table shown at [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage). This data is **not** used by the Cursor Accounts extension today (quota uses `usage-summary` and `GetCurrentPeriodUsage` instead). Documented here for integrations, debugging, and future features.

**Last reviewed:** 2026-06-03

## Overview

The dashboard usage page lists individual AI requests with:

| Column | Personal account | Enterprise / team |
|--------|------------------|-------------------|
| Date | Yes | Yes |
| User | Hidden (redundant) | Email shown (e.g. `user@company.com`) |
| Type | Yes (e.g. Included) | Yes |
| Model | Yes (e.g. `auto`, `composer-2.5-fast`) | Yes |
| Tokens | Yes (e.g. 16.8k, 1.8m) | Yes |
| Cost | Yes (e.g. US$0.02 Included) | Yes |

Personal and enterprise accounts use the **same** web endpoint. The only UI difference is whether the **User** column is rendered.

## Primary endpoint (web dashboard)

```
POST https://cursor.com/api/dashboard/get-filtered-usage-events
```

**Status:** Undocumented / reverse-engineered. Used by the Cursor web dashboard. May change without notice.

### Authentication

Cookie-based session (same as `GET /api/usage-summary`):

| Cookie | Required | Purpose |
|--------|----------|---------|
| `WorkosCursorSessionToken` | Yes | Session token |

Build the cookie from the IDE JWT (`cursorAuth/accessToken` in `state.vscdb`):

```typescript
// See src/auth/sessionCookie.ts — buildWorkosSessionCookie(accessToken)
WorkosCursorSessionToken=${userId}%3A%3A${accessToken}
```

Where `userId` is the numeric segment after `|` in the JWT `sub` claim (or the full `sub` if no pipe).

**CSRF:** POST requests require `Origin: https://cursor.com`. Without it:

```json
{"error": "Invalid origin for state-changing request"}
```

Unauthenticated requests return `401` with `{"error": "not_authenticated"}`.

### Request body

```json
{
  "teamId": 5989194,
  "userId": 152683922,
  "startDate": "1780272000000",
  "endDate": "1782864000000",
  "page": 1,
  "pageSize": 100
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `teamId` | number | No | Numeric team ID. Use for enterprise/team views. Omit for personal-only events. |
| `userId` | number | No | Numeric user ID. Filter to one user (team admins). |
| `startDate` | string | No | Range start, Unix **milliseconds** as a **string** |
| `endDate` | string | No | Range end, Unix **milliseconds** as a **string** |
| `page` | number | No | 1-based page number (default `1`) |
| `pageSize` | number | No | Events per page (default `100`) |

All fields are optional. `{}` returns the first page of events for the authenticated user.

**Team ID:** `GET https://cursor.com/api/dashboard/teams` returns `teams[].id` for the signed-in user.

### Response

```json
{
  "totalUsageEventsCount": 182,
  "usageEventsDisplay": [
    {
      "timestamp": "1780411395092",
      "model": "composer-2.5-fast",
      "kind": "USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS",
      "requestsCosts": 0.3,
      "usageBasedCosts": "-",
      "isTokenBasedCall": true,
      "tokenUsage": {
        "inputTokens": 13731,
        "outputTokens": 1177,
        "cacheReadTokens": 1856,
        "cacheWriteTokens": 0,
        "totalCents": 1.02
      },
      "owningUser": "166276345",
      "owningTeam": "5989194",
      "cursorTokenFee": 0,
      "isChargeable": true,
      "isHeadless": false,
      "chargedCents": 59.65,
      "serviceAccountId": "null"
    }
  ]
}
```

**Note:** The web response array is `usageEventsDisplay`. The official Admin API uses `usageEvents` instead (see below).

There is **no** separate “totals by model” endpoint. Aggregate by `model` client-side after paginating through all pages.

### Event fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | Unix time in **milliseconds** (as string) |
| `model` | string | Model id (e.g. `composer-2.5-fast`, `default` shown as **auto** in UI) |
| `kind` | string | Billing category (see [Type column](#type-column)) |
| `requestsCosts` | number | Cost in plan “request” units |
| `usageBasedCosts` | string | Formatted dollar string for usage-based billing, or `"-"` when included |
| `isTokenBasedCall` | boolean | Token-metered call |
| `tokenUsage` | object | Token breakdown (when token-based) |
| `owningUser` | string | Numeric user ID (string) |
| `owningTeam` | string | Numeric team ID (string) |
| `cursorTokenFee` | number | Cursor markup in cents |
| `isChargeable` | boolean | Whether the event incurred a charge |
| `isHeadless` | boolean | Background / headless agent request |
| `chargedCents` | number | Total charged cents (model + fee); aligns with dashboard cost column |
| `serviceAccountId` | string | Service account id when applicable |

`tokenUsage` object:

| Field | Description |
|-------|-------------|
| `inputTokens` | Input tokens |
| `outputTokens` | Output tokens |
| `cacheReadTokens` | Cache read tokens |
| `cacheWriteTokens` | Cache write tokens |
| `totalCents` | Model cost in cents |

### Mapping API fields to dashboard columns

#### Date

```javascript
new Date(Number(event.timestamp))
```

#### User (enterprise)

- **Admin API:** `userEmail` on each event.
- **Web dashboard (member, non-admin):** `userEmail` is often **omitted** from `usageEventsDisplay`. The UI fills the column with the signed-in user’s email (same as `cursorAuth/cachedEmail` / session).
- **Join fallback:** `owningUser` (numeric) can be mapped via team member APIs when available.

#### Type column

| API `kind` | Dashboard label (typical) |
|------------|---------------------------|
| `USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS` | Included |
| `USAGE_EVENT_KIND_USAGE_BASED` | Usage-based (pay per use) |

Official Admin API uses human-readable strings such as `Included in Business` and `Usage-based`.

#### Model

| API `model` | Dashboard label |
|-------------|-----------------|
| `default` | `auto` |
| Other values | Shown as-is (e.g. `composer-2.5-fast`) |

#### Tokens

Sum token fields, then format like the dashboard (k / m):

```javascript
const tu = event.tokenUsage ?? {};
const total =
  (tu.inputTokens ?? 0) +
  (tu.outputTokens ?? 0) +
  (tu.cacheReadTokens ?? 0) +
  (tu.cacheWriteTokens ?? 0);
// e.g. 16764 → "16.8k", 1795666 → "1.8m"
```

#### Cost

```javascript
const dollars = (event.chargedCents ?? 0) / 100;
// Included rows: append "Included" when kind includes INCLUDED
```

Verified examples (enterprise, Jun 2026): `chargedCents` 2.47 → US$0.02 Included; 59.65 → US$0.60 Included; 150.59 → US$1.51 Included.

## Related web endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/usage-summary` | GET | Billing cycle totals, plan % — **not** per-row usage |
| `/api/dashboard/teams` | GET | Team list and numeric `teamId` |
| `/api/usage?user=<workos_id>` | GET | Legacy GPT-4 counters — vestigial |

## Official alternative (Enterprise Admin API)

For teams with an Admin API key (`https://api.cursor.com`):

```
POST https://api.cursor.com/teams/filtered-usage-events
```

- Auth: HTTP Basic with API key (`curl -u "$API_KEY:"`)
- Response array: `usageEvents` (not `usageEventsDisplay`)
- Includes `userEmail` on events (required in docs; known gaps for removed members)
- Filter by `email`, `userId`, `startDate`, `endDate`, `page`, `pageSize`
- Rate limit: 20 req/min per team; poll at most once per hour (hourly aggregation)

See [Admin API — Get Usage Events Data](https://cursor.com/docs/account/teams/admin-api).

## Example (curl)

```bash
curl -s 'https://cursor.com/api/dashboard/get-filtered-usage-events' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://cursor.com' \
  -H 'Cookie: WorkosCursorSessionToken=USER_ID%3A%3AACCESS_TOKEN' \
  -d '{
    "teamId": 5989194,
    "startDate": "1780272000000",
    "endDate": "1782864000000",
    "page": 1,
    "pageSize": 25
  }'
```

## Example (TypeScript)

```typescript
import { buildWorkosSessionCookie } from '../auth/sessionCookie';

interface UsageEventDisplay {
  timestamp: string;
  model: string;
  kind: string;
  chargedCents?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  userEmail?: string;
}

export async function fetchUsageEvents(
  accessToken: string,
  options: {
    teamId?: number;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  },
  signal?: AbortSignal
): Promise<{ total: number; events: UsageEventDisplay[] }> {
  const response = await fetch(
    'https://cursor.com/api/dashboard/get-filtered-usage-events',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://cursor.com',
        Cookie: buildWorkosSessionCookie(accessToken),
        Accept: 'application/json',
      },
      body: JSON.stringify(options),
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`Usage events API returned ${response.status}`);
  }

  const data = await response.json();
  return {
    total: data.totalUsageEventsCount ?? 0,
    events: data.usageEventsDisplay ?? [],
  };
}
```

## Pagination

```javascript
let page = 1;
const pageSize = 100;
const all = [];

while (true) {
  const { total, events } = await fetchUsageEvents(token, {
    teamId,
    startDate,
    endDate,
    page,
    pageSize,
  });
  all.push(...events);
  if (all.length >= total || events.length === 0) break;
  page += 1;
}
```

## What this extension uses today

| Need | Endpoint used by Cursor Accounts |
|------|----------------------------------|
| Status bar quota / % | `GetCurrentPeriodUsage`, `usage-summary` |
| Per-request usage table | **Not integrated** — this document |

Debug script (quota only, no usage events yet): `node scripts/debug-usage.mjs --email <address>`.

## Risks and limitations

- Undocumented web API; field names and enums may change on Cursor updates.
- No official personal/public API for this table on individual plans.
- CSV export on the dashboard is **client-side** only (no server CSV endpoint).
- Rate limits are unknown; paginate reasonably.
- Enterprise `userEmail` on web events may be missing for non-admin sessions; use session email or Admin API for reliable attribution.

## References

- [Cursor API overview](https://cursor.com/docs/api)
- [Admin API — filtered usage events](https://cursor.com/docs/account/teams/admin-api)
- [Unofficial dashboard API gist (dmwyatt)](https://gist.github.com/dmwyatt/1e9359b1862e7cbfe1e754fe4c8db764)
- [cursor-usage CLI](https://github.com/dmwyatt/cursor-usage)
- [RESEARCH.md](RESEARCH.md) — quota endpoints used by this extension
- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) — auth and session cookie flow
