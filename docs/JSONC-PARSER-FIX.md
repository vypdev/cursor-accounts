# Fix: ProfileSettingsManager now handles trailing commas in settings.json

## Problem 1: JSON Parsing (RESOLVED)

The ProfileSettingsManager was failing to read `settings.json` files that contained trailing commas, which are commonly created by VS Code's settings editor. The error manifested as:

```
[Proxy] Failed to apply proxy settings: Failed to read settings at /Users/efrain.espada@feverup.com/.cursor-efrain_espada_feverup_com/User/settings.json
```

This occurred specifically with the profile `efrain.espada@feverup.com` because its `settings.json` file contained trailing commas:

```json
{
  "github.copilot.enable": {
    "*": false,
    "plaintext": false,
    "markdown": false,
    "scminput": false,  // ← Trailing comma
  },
  "git.enableSmartCommit": true,  // ← Trailing comma
}
```

The previous implementation used a custom `stripJsonComments()` method that removed comments but **did not handle trailing commas**, causing `JSON.parse()` to fail since standard JSON doesn't allow trailing commas.

## Problem 2: Extension Bundling Error (RESOLVED)

After adding `jsonc-parser`, the extension failed to activate with the error:

```
Error: Cannot find module './impl/format'
Require stack:
- /Users/efrain.espada@feverup.com/.cursor/extensions/vypdev.cursor-accounts-0.1.34/out/extension-bundle.js
```

This happened because:
- `jsonc-parser` package has both **UMD** (`lib/umd/main.js`) and **ESM** (`lib/esm/main.js`) entry points
- By default, esbuild uses the `main` field (UMD) from `package.json`
- The UMD version uses runtime `require('./impl/format')` calls that cannot be resolved in the bundled code
- The ESM version has proper static imports that esbuild can bundle correctly

## Solution

### 1. Added jsonc-parser dependency

Added `jsonc-parser` - The official VS Code JSON parser that handles:
- Comments (`//` and `/* */`)
- Trailing commas (when `allowTrailingComma: true` is set)
- All other JSONC (JSON with Comments) features

### 2. Updated ProfileSettingsManager

Modified `readSettings()` method in `ProfileSettingsManager`:
- Import `parseJsonc` and `ParseError` from `jsonc-parser`
- Use `parseJsonc(content, errors, { allowTrailingComma: true })`
- Check for parse errors and throw `ProfileSettingsError` if any exist
- Removed the custom `stripJsonComments()` method

### 3. Fixed esbuild Configuration

Updated `scripts/bundle.mjs` to prefer ESM modules over UMD:

```javascript
await esbuild.build({
  // ... other config
  // Prefer ESM modules over UMD to avoid runtime require() issues
  mainFields: ['module', 'main'],
});
```

This tells esbuild to:
1. First try the `module` field (ESM version)
2. Fall back to `main` field (UMD version) if ESM is not available

This prevents runtime errors from dynamic `require()` calls in UMD modules.

## Benefits

- Compatible with VS Code's settings format
- More robust error handling
- Consistent behavior across different profiles
- No runtime bundling errors
- Passes all existing tests

## Files Modified

- `package.json` - Added `jsonc-parser` dependency
- `src/profiles/profileSettingsManager.ts` - Updated JSON parsing logic
- `scripts/bundle.mjs` - Added `mainFields: ['module', 'main']` to prefer ESM

## Testing

All existing tests pass, including:
- Parsing JSON with comments
- Handling invalid JSON (still throws errors)
- Writing settings
- Proxy settings management
- Extension bundling completes successfully

The fix specifically resolves:
1. The issue where `efrain.espada@feverup.com` profile couldn't have proxy settings applied
2. The extension activation failure due to missing `./impl/format` module
