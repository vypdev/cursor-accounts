# Enabled Models Detection — How Cursor Stores Model Picker Toggles

Reference for detecting which models a user has enabled/disabled in the Cursor model picker.

**Last reviewed:** 2026-06-05

**Related:** [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md), [PROXY-MODEL-DETECTION.md](PROXY-MODEL-DETECTION.md), [MODEL-PRICING.md](MODEL-PRICING.md), [RESEARCH.md](RESEARCH.md)

---

## Overview

Cursor stores the **model catalog** and **user preferences** (enabled/disabled toggles) in the profile's `state.vscdb` SQLite database. This document explains how to extract:

1. The **full model catalog** (`availableDefaultModels2`) — all models your plan can use
2. The **enabled/disabled toggles** — which base models are ON in the picker
3. The **currently selected model** — what you're using right now in Composer/Chat

**Key distinction:** The toggle is per **base model** (e.g. `composer-2.5`, `claude-sonnet-4-5`). Variants like **Fast** are parameters, not separate toggles.

---

## Where Models Live in state.vscdb

### Database Location

```
{userDataDir}/User/globalStorage/state.vscdb
```

**Examples:**
- Default profile: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (macOS)
- Custom profile: `~/.cursor-efraespada_gmail_com/User/globalStorage/state.vscdb`

### SQLite Table & Key

| Component | Value |
|-----------|-------|
| **Table** | `ItemTable` |
| **Key** | `src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser` |
| **Constant** | `APPLICATION_USER_KEY` in `src/modelEfficiency/stateDbReader.ts` |

**Value:** JSON-encoded string containing the entire `applicationUser` object (~250KB typical size).

---

## Three Distinct Concepts

Do **not** confuse these three data sources:

| Concept | JSON Field | What It Represents | Who Controls It |
|---------|------------|-------------------|-----------------|
| **1. Full catalog** | `availableDefaultModels2[]` | All models your plan *can* use, with variants | Cursor backend (plan-dependent) |
| **2. Picker toggles** | `aiSettings.modelOverrideEnabled` + `aiSettings.modelOverrideDisabled` + `entry.defaultOn` | Which base models are ON/OFF in the picker | User settings |
| **3. Selected model** | `aiSettings.modelConfig.composer` | The model + parameters you're using *right now* | Current session state |

### 1. Full Model Catalog

**Field:** `availableDefaultModels2`

**Type:** `ModelCatalogEntry[]`

**Contents:** Every base model Cursor makes available to your plan, including:
- Model metadata (`name`, `serverModelName`, `clientDisplayName`)
- Variants (Fast, Thinking, context sizes, effort levels)
- Parameter definitions (what toggles each model supports)
- Display configuration (tooltips, icons, taglines)

**Example structure:**

```json
{
  "availableDefaultModels2": [
    {
      "name": "composer-2.5",
      "defaultOn": true,
      "clientDisplayName": "Composer 2.5",
      "serverModelName": "composer-2.5",
      "parameterDefinitions": [
        {
          "id": "fast",
          "name": "Fast",
          "markdownTooltip": "Significantly faster but consumes more usage"
        }
      ],
      "variants": [
        {
          "parameterValues": [{"id": "fast", "value": "true"}],
          "displayName": "Composer 2.5 <span>Fast</span>",
          "legacySlug": "composer-2.5-fast",
          "variantStringRepresentation": "composer-2.5[fast=true]"
        },
        {
          "parameterValues": [{"id": "fast", "value": "false"}],
          "displayName": "Composer 2.5",
          "legacySlug": "composer-2.5",
          "variantStringRepresentation": "composer-2.5[fast=false]"
        }
      ],
      "supportsAgent": true,
      "supportsThinking": true
    },
    {
      "name": "claude-sonnet-4-5",
      "defaultOn": false,
      "clientDisplayName": "Sonnet 4.5",
      "variants": [...]
    }
  ]
}
```

**Current extension usage:** ✅ Parsed by `parseModelCatalog()` in `modelConfigResolver.ts`.

---

### 2. Model Picker Toggles (Enabled/Disabled State)

**Fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `aiSettings.modelOverrideEnabled` | `string[]` | Models the user **explicitly enabled** (overrides `defaultOn: false`) |
| `aiSettings.modelOverrideDisabled` | `string[]` | Models the user **explicitly disabled** (overrides `defaultOn: true`) |
| `entry.defaultOn` | `boolean` | Per-model default state from Cursor backend |

**Logic to compute enabled state:**

```typescript
function isModelEnabled(
  modelName: string,
  entry: ModelCatalogEntry,
  enabledOverrides: Set<string>,
  disabledOverrides: Set<string>
): boolean {
  const defaultOn = entry.defaultOn ?? false;
  const explicitlyEnabled = enabledOverrides.has(modelName);
  const explicitlyDisabled = disabledOverrides.has(modelName);
  
  return (defaultOn || explicitlyEnabled) && !explicitlyDisabled;
}
```

**Example from real profile:**

```json
{
  "aiSettings": {
    "modelOverrideEnabled": ["claude-sonnet-4-5"],
    "modelOverrideDisabled": ["gpt-5.5", "gpt-5.3-codex", "claude-sonnet-4-6", "claude-opus-4-8"]
  }
}
```

**Enabled base models (applying the logic):**

| Base Model | Reason |
|------------|--------|
| `default` | `defaultOn: true` |
| `composer-2.5` | `defaultOn: true` |
| `claude-sonnet-4-5` | In `modelOverrideEnabled` |

**Disabled models:**
- `gpt-5.5`, `gpt-5.3-codex`, `claude-sonnet-4-6`, `claude-opus-4-8` → in `modelOverrideDisabled`
- Any model with `defaultOn: false` and NOT in `modelOverrideEnabled`

**Variants:** If a base model is enabled, **all its variants** are available (Fast, Thinking, etc.). The variant is selected separately via parameters.

**Current extension usage:** ❌ Not parsed yet. Extension shows all catalog entries in Prices modal regardless of user toggles.

---

### 3. Currently Selected Model

**Field:** `aiSettings.modelConfig.{feature}`

Where `{feature}` is one of:
- `composer` — main Agent/Composer mode
- `cmd-k` — inline edits
- `background-composer` — background tasks
- `plan-execution` — Plan mode
- `spec`, `deep-search`, `quick-agent` — other features

**Structure:**

```json
{
  "aiSettings": {
    "modelConfig": {
      "composer": {
        "modelName": "composer-2.5",
        "maxMode": false,
        "selectedModels": [
          {
            "modelId": "composer-2.5",
            "parameters": [
              {"id": "fast", "value": "true"}
            ]
          }
        ]
      }
    }
  }
}
```

**Interpretation:** User is currently using **Composer 2.5 Fast** (base model `composer-2.5`, parameter `fast=true`).

**Current extension usage:** ✅ Parsed by `ComposerDbPoller` (reads `composerData.modelConfig` from `cursorDiskKV` table) and `resolveModelConfig()`.

---

## Implementation in Extension

### What Works Today

| Feature | Status | Code Location |
|---------|--------|---------------|
| Load full catalog | ✅ Implemented | `StateDbModelCatalogRepository.loadModelCatalog()` |
| Parse `availableDefaultModels2` | ✅ Implemented | `parseModelCatalog()` in `modelConfigResolver.ts` |
| Resolve selected model + variant | ✅ Implemented | `resolveModelConfig()` in `modelConfigResolver.ts` |
| Match variant to pricing | ✅ Implemented | `ModelPricingService.getModelsWithPricing()` |
| Show all models in Prices modal | ✅ Implemented | `PricesModal.tsx` |

### What's Missing

| Feature | Status | Impact |
|---------|--------|--------|
| Parse `modelOverrideEnabled` | ❌ Not implemented | Can't filter to user's enabled models |
| Parse `modelOverrideDisabled` | ❌ Not implemented | Can't hide disabled models in UI |
| Apply toggle logic | ❌ Not implemented | Shows all catalog models, not just enabled ones |
| Surface enabled models in UI | ❌ Not implemented | User can't see "your enabled models" list |

---

## Reading the Data

### Via Extension Code

**Get the database path for active profile:**

```typescript
import { ProfileDetector } from '../profiles/profileDetector';
import { getProfileStateDbPath } from '../auth/cursorPaths';

const userDataDir = profileDetector.getCurrentUserDataDir();
const dbPath = getProfileStateDbPath(userDataDir);
```

**Read and parse:**

```typescript
import { readItemTableKey, APPLICATION_USER_KEY } from '../modelEfficiency/stateDbReader';
import { parseModelCatalog } from '../modelEfficiency/modelConfigResolver';

// Full catalog
const raw = await readItemTableKey(dbPath, APPLICATION_USER_KEY, extensionPath);
const catalog = parseModelCatalog(raw);

// To get toggles, need to parse full JSON:
const appUser = JSON.parse(raw || '{}');
const enabledOverrides = new Set(appUser.aiSettings?.modelOverrideEnabled ?? []);
const disabledOverrides = new Set(appUser.aiSettings?.modelOverrideDisabled ?? []);

const enabledModels = catalog.filter(entry => {
  const defaultOn = entry.defaultOn ?? false;
  const name = entry.name;
  return (defaultOn || enabledOverrides.has(name)) && !disabledOverrides.has(name);
});
```

### Via SQLite CLI

**Query the key:**

```bash
sqlite3 -readonly ~/.cursor-efraespada_gmail_com/User/globalStorage/state.vscdb \
  "SELECT CAST(value AS TEXT) FROM ItemTable WHERE key='src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser' LIMIT 1;" \
  > /tmp/appuser.json
```

**Parse with Python:**

```python
import json

with open('/tmp/appuser.json') as f:
    raw = f.read().strip()
    if raw.startswith('"'):
        raw = json.loads(raw)  # Strip outer JSON quotes
    data = json.loads(raw)

catalog = data['availableDefaultModels2']
ai = data['aiSettings']
enabled = set(ai.get('modelOverrideEnabled', []))
disabled = set(ai.get('modelOverrideDisabled', []))

for entry in catalog:
    name = entry['name']
    default_on = entry.get('defaultOn', False)
    is_enabled = (default_on or name in enabled) and name not in disabled
    if is_enabled:
        print(f"{entry.get('clientDisplayName', name)}: enabled")
```

---

## Real-World Examples

### Example 1: Personal Profile (efraespada@gmail.com)

**Toggles:**

```json
{
  "modelOverrideEnabled": ["claude-sonnet-4-5"],
  "modelOverrideDisabled": ["gpt-5.5", "gpt-5.3-codex", "claude-sonnet-4-6", "claude-opus-4-8"]
}
```

**Enabled base models:**

1. `default` (Auto) — `defaultOn: true`
2. `composer-2.5` — `defaultOn: true`
3. `claude-sonnet-4-5` — explicitly enabled

**Disabled models:**
- `claude-sonnet-4-6`, `claude-opus-4-8`, `gpt-5.5`, `gpt-5.3-codex` — explicitly disabled

**Selected model in Composer:**

```json
{
  "modelName": "composer-2.5",
  "selectedModels": [
    {"modelId": "composer-2.5", "parameters": [{"id": "fast", "value": "true"}]}
  ]
}
```

→ Currently using **Composer 2.5 Fast**.

### Example 2: Work Profile (efrain.espada@feverup.com)

**Toggles:**

```json
{
  "modelOverrideEnabled": ["claude-sonnet-4-5"],
  "modelOverrideDisabled": ["gpt-5.5", "gpt-5.3-codex", "claude-sonnet-4-6", "claude-opus-4-8"]
}
```

**Same configuration as personal profile** (user likely synced settings manually or uses same preferences).

---

## Implementation Roadmap

### Phase 1: Parse Toggle State

**File:** `src/modelEfficiency/modelConfigResolver.ts`

**New function:**

```typescript
export interface ModelToggleState {
  enabledOverrides: Set<string>;
  disabledOverrides: Set<string>;
}

export function parseModelToggleState(raw: string | null): ModelToggleState {
  if (!raw?.trim()) {
    return { enabledOverrides: new Set(), disabledOverrides: new Set() };
  }
  
  try {
    const parsed = JSON.parse(raw) as {
      aiSettings?: {
        modelOverrideEnabled?: string[];
        modelOverrideDisabled?: string[];
      };
    };
    
    return {
      enabledOverrides: new Set(parsed.aiSettings?.modelOverrideEnabled ?? []),
      disabledOverrides: new Set(parsed.aiSettings?.modelOverrideDisabled ?? []),
    };
  } catch {
    return { enabledOverrides: new Set(), disabledOverrides: new Set() };
  }
}
```

### Phase 2: Filter Enabled Models

**Add to `ModelPricingService`:**

```typescript
async getEnabledModelsWithPricing(
  stateDbPath: string,
  extensionPath: string
): Promise<ModelWithPricing[]> {
  const raw = await this.catalogRepository.loadModelCatalogRaw(stateDbPath, extensionPath);
  const catalog = parseModelCatalog(raw);
  const toggles = parseModelToggleState(raw);
  
  const enabledCatalog = catalog.filter(entry => {
    const defaultOn = entry.defaultOn ?? false;
    const name = entry.name;
    return (defaultOn || toggles.enabledOverrides.has(name)) 
           && !toggles.disabledOverrides.has(name);
  });
  
  return this.buildFromCatalog(enabledCatalog);
}
```

**Update repository interface:**

```typescript
export interface IModelCatalogRepository {
  loadModelCatalog(dbPath: string, extensionPath: string): Promise<ModelCatalogEntry[]>;
  loadModelCatalogRaw(dbPath: string, extensionPath: string): Promise<string | null>;
}
```

### Phase 3: UI Filter Option

**Add to `PricesModal.tsx`:**

```typescript
const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);

<div className="filter-toggle">
  <input
    type="checkbox"
    checked={showOnlyEnabled}
    onChange={(e) => setShowOnlyEnabled(e.target.checked)}
  />
  <label>Show only enabled models</label>
</div>
```

---

## Scope & Constraints

### Profile-Level, Not Window-Level

The `state.vscdb` file is **per profile** (`userDataDir`), not per window. If you have:
- Window A: `~/.cursor-efraespada_gmail_com`
- Window B: `~/.cursor-efraespada_gmail_com`

Both windows share the **same** enabled/disabled toggles. The selected model (`modelConfig.composer`) may differ if the two windows are in different states, but the toggles are shared.

### Selected Model vs Enabled Models

| Scenario | Possible? | Explanation |
|----------|-----------|-------------|
| Model selected but not enabled | ❌ No | Cursor enforces picker state |
| Model enabled but not selected | ✅ Yes | User can switch between enabled models |
| Model disabled mid-session | ⚠️ Edge case | If user disables a model while using it, behavior undefined |

### Base Model vs Variant

**Toggle granularity:** Base model only (e.g. `composer-2.5`).

**Variant selection:** Separate parameter choice (e.g. `fast=true`).

**Example:** If `composer-2.5` is enabled:
- ✅ You can use **Composer 2.5** (`fast=false`)
- ✅ You can use **Composer 2.5 Fast** (`fast=true`)

Both variants are available. The toggle doesn't distinguish between them.

---

## Testing Strategy

### Unit Tests

**File:** `src/test/modelEfficiency/modelToggleState.test.ts`

```typescript
import { parseModelToggleState } from '../../modelEfficiency/modelConfigResolver';

it('parses enabled overrides', () => {
  const raw = JSON.stringify({
    aiSettings: {
      modelOverrideEnabled: ['claude-sonnet-4-5'],
      modelOverrideDisabled: ['gpt-5.5']
    }
  });
  
  const toggles = parseModelToggleState(raw);
  
  assert.ok(toggles.enabledOverrides.has('claude-sonnet-4-5'));
  assert.ok(toggles.disabledOverrides.has('gpt-5.5'));
});
```

### Integration Tests

**File:** `src/test/modelPricingIntegration.test.ts`

```typescript
it('filters to enabled models only', async () => {
  const dbPath = await createFixtureDb({
    catalog: [
      { name: 'composer-2.5', defaultOn: true },
      { name: 'claude-sonnet-4-5', defaultOn: false },
      { name: 'gpt-5.5', defaultOn: true }
    ],
    overrides: {
      enabled: ['claude-sonnet-4-5'],
      disabled: ['gpt-5.5']
    }
  });
  
  const results = await service.getEnabledModelsWithPricing(dbPath, extensionPath);
  
  // Should include: composer-2.5 (defaultOn), claude-sonnet-4-5 (override)
  // Should exclude: gpt-5.5 (disabled override)
  assert.equal(results.filter(m => m.baseModelId === 'composer-2.5').length > 0, true);
  assert.equal(results.filter(m => m.baseModelId === 'claude-sonnet-4-5').length > 0, true);
  assert.equal(results.filter(m => m.baseModelId === 'gpt-5.5').length, 0);
});
```

---

## FAQ

### Why are some models `defaultOn: true` and others `false`?

Cursor's backend sets `defaultOn` based on your **plan tier** and **feature flags**. Free plans have fewer models `defaultOn` by default. Pro/Business plans have more.

### Can I programmatically enable a model?

**Not recommended.** The `state.vscdb` is Cursor's internal storage. Directly modifying it:
- May corrupt the database
- May be overwritten by Cursor
- Violates ToS

If you want to automate model selection, use Cursor's settings sync or API (if available in future).

### What happens if I delete `modelOverrideEnabled`?

The model reverts to its `defaultOn` state. If `defaultOn: false`, the model becomes disabled.

### Does this work for all features (Composer, Cmd+K, etc.)?

**Toggles:** Yes, `modelOverrideEnabled`/`modelOverrideDisabled` apply globally to the picker.

**Selection:** No, each feature has its own `modelConfig` (see `aiSettings.modelConfig.composer`, `aiSettings.modelConfig.cmd-k`, etc.).

### Can I see which model a different profile has enabled?

Yes, by reading that profile's `state.vscdb`. Example:

```typescript
const otherProfileDbPath = getProfileStateDbPath('/Users/me/.cursor-other-profile');
const raw = await readItemTableKey(otherProfileDbPath, APPLICATION_USER_KEY, extensionPath);
const toggles = parseModelToggleState(raw);
```

---

## Related Documentation

| Document | Relation |
|----------|----------|
| [MODEL-EFFICIENCY.md](MODEL-EFFICIENCY.md) | Uses `parseModelCatalog()` to resolve Composer model |
| [MODEL-PRICING.md](MODEL-PRICING.md) | Pricing system that uses the same catalog for matching models to prices |
| [PROXY-MODEL-DETECTION.md](PROXY-MODEL-DETECTION.md) | Detects model from network traffic (runtime, not picker config) |
| [RESEARCH.md](RESEARCH.md) | Documents `state.vscdb` structure and `availableDefaultModels2` |
| [HOW-IT-WORKS.md](HOW-IT-WORKS.md) | General `state.vscdb` authentication flow |
| [FEATURES.md](FEATURES.md) | References model catalog for Prices modal |

**Code references:**
- Parser: `src/modelEfficiency/modelConfigResolver.ts`
- Repository: `src/modelEfficiency/stateDbModelCatalogRepository.ts`
- Reader: `src/modelEfficiency/stateDbReader.ts`
- Service: `src/services/modelPricingService.ts`
- UI: `webview/src/components/PricesModal.tsx`

---

## Next Steps (Backlog)

- [ ] Implement `parseModelToggleState()` in `modelConfigResolver.ts`
- [ ] Add `loadModelCatalogRaw()` to `IModelCatalogRepository`
- [ ] Add `getEnabledModelsWithPricing()` to `ModelPricingService`
- [ ] Add "Show only enabled models" filter to Prices modal
- [ ] Document toggle state in status bar tooltip (when proxy is enabled)
- [ ] Track per-model usage in efficiency analysis (requires enabled-model awareness)
- [ ] Add unit tests for toggle parsing
- [ ] Add integration test with real `state.vscdb` fixture

**Estimated effort:** ~4 hours (parsing + service + UI filter + tests)
