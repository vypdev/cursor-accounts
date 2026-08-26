export interface AccountsPanelHtmlOptions {
  locale: string;
  direction: 'ltr' | 'rtl';
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  title: string;
  loadingMessage: string;
  scriptLoadFailedMessage: string;
}

/** Builds the accounts webview shell without depending on VS Code objects. */
export function buildAccountsPanelHtml(
  options: AccountsPanelHtmlOptions
): string {
  const nonce = getNonce();
  const locale = escapeHtmlAttribute(options.locale);
  const direction = escapeHtmlAttribute(options.direction);
  const cspSource = escapeHtmlAttribute(options.cspSource);
  const scriptUri = escapeHtmlAttribute(options.scriptUri);
  const styleUri = escapeHtmlAttribute(options.styleUri);
  const title = escapeHtmlText(options.title);
  const loadingMessage = escapeHtmlText(options.loadingMessage);
  const scriptLoadFailedMessage = serializeForInlineScript(
    options.scriptLoadFailedMessage
  );

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${direction}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}'; font-src ${cspSource}; img-src ${cspSource} https:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>${title}</title>
</head>
<body>
  <div id="root">
    <p style="padding: 12px; color: var(--vscode-foreground, #ccc); font-family: var(--vscode-font-family, sans-serif);">
      ${loadingMessage}
    </p>
  </div>
  <script nonce="${nonce}">
    window.__cursorAccountsReportScriptError = function() {
      var root = document.getElementById('root');
      if (root) {
        root.textContent = '';
        var error = document.createElement('p');
        error.style.padding = '12px';
        error.style.color = 'var(--vscode-errorForeground, #88)';
        error.textContent = ${scriptLoadFailedMessage};
        root.appendChild(error);
      }
    };
    (function() {
      function reportLog(phase, message, level) {
        try {
          window.__cursorAccountsVscodeApi.postMessage({
            type: 'webviewLog',
            level: level || 'info',
            phase: phase,
            message: message
          });
        } catch (error) {
          console.error('[Webview] reportLog failed', phase, error);
        }
      }

      if (!window.__cursorAccountsVscodeApi) {
        window.__cursorAccountsVscodeApi = acquireVsCodeApi();
      }
      reportLog('bootstrap.api-acquired', 'acquireVsCodeApi completed');

      function waitForServiceWorker() {
        return new Promise(function(resolve) {
          if (!navigator.serviceWorker) {
            reportLog('bootstrap.sw-wait-end', 'no service worker support', 'debug');
            resolve('no-service-worker');
            return;
          }

          reportLog('bootstrap.sw-wait-start', 'waiting for controllerchange or timeout');

          var settled = false;
          function finish(reason) {
            if (settled) {
              return;
            }
            settled = true;
            reportLog('bootstrap.sw-wait-end', reason, 'debug');
            resolve(reason);
          }

          function onControllerChange() {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            finish('controllerchange');
          }

          navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
          window.setTimeout(function() {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
            finish(
              navigator.serviceWorker.controller
                ? 'timeout-with-controller'
                : 'timeout-no-controller'
            );
          }, 2000);
        });
      }

      function sendReady() {
        reportLog('bootstrap.ready-send', 'postMessage ready');
        window.__cursorAccountsVscodeApi.postMessage({ type: 'ready' });
        reportLog('bootstrap.ready-sent', 'ready message sent');
      }

      waitForServiceWorker()
        .then(sendReady)
        .catch(function(error) {
          reportLog('bootstrap.error', String(error), 'info');
          sendReady();
        });
    })();
  </script>
  <script nonce="${nonce}" src="${scriptUri}" onerror="window.__cursorAccountsReportScriptError && window.__cursorAccountsReportScriptError()"></script>
</body>
</html>`;
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      default:
        return '&gt;';
    }
  });
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
