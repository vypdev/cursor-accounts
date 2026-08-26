import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAccountsPanelHtml } from '../../../ui/presentation/accountsPanelHtml';

describe('accounts panel HTML presentation', () => {
  it('builds the expected CSP and bootstrap shell', () => {
    const html = buildAccountsPanelHtml({
      locale: 'en',
      direction: 'ltr',
      cspSource: 'https://webview.vscode-cdn.net',
      scriptUri: 'https://webview.local/bundle.js',
      styleUri: 'https://webview.local/bundle.css',
      title: 'Cursor Accounts',
      loadingMessage: 'Loading Cursor Accounts',
      scriptLoadFailedMessage: 'The script failed to load.',
    });

    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /script-src https:\/\/webview\.vscode-cdn\.net 'nonce-/);
    assert.match(html, /acquireVsCodeApi/);
    assert.match(html, /waitForServiceWorker/);
    assert.match(html, /postMessage\(\{ type: 'ready' \}\)/);
    assert.equal((html.match(/nonce="[A-Za-z0-9]{32}"/g) ?? []).length, 2);
  });

  it('escapes dynamic markup and inline-script delimiters', () => {
    const html = buildAccountsPanelHtml({
      locale: 'en" onload="alert(1)',
      direction: 'ltr',
      cspSource: 'https://webview.example/" unsafe',
      scriptUri: 'https://webview.example/bundle.js" onerror="alert(1)',
      styleUri: 'https://webview.example/bundle.css" onerror="alert(1)',
      title: '<title>unsafe</title>',
      loadingMessage: '<img src=x onerror=alert(1)>',
      scriptLoadFailedMessage: '</script><script>alert(1)</script>',
    });

    assert.match(html, /lang="en&quot; onload=&quot;alert\(1\)"/);
    assert.match(html, /<title>&lt;title&gt;unsafe&lt;\/title&gt;<\/title>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(
      html,
      /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)\\u003c\/script\\u003e/
    );
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  });
});
