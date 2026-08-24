export function showBootError(root: HTMLElement | null, message: string): void {
  if (!root) {
    return;
  }

  root.textContent = '';
  const paragraph = document.createElement('p');
  paragraph.style.padding = '12px';
  paragraph.style.color = 'var(--vscode-errorForeground, #f88)';
  paragraph.style.fontFamily = 'var(--vscode-font-family, sans-serif)';
  paragraph.textContent = message;
  root.appendChild(paragraph);
}
