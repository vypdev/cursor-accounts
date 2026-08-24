import { describe, expect, it } from 'vitest';
import { showBootError } from './bootError';

describe('showBootError', () => {
  it('renders hostile error text without interpreting it as markup', () => {
    const root = document.createElement('div');
    showBootError(root, '<script>alert("xss")</script>\nquoted');

    expect(root.textContent).toContain('<script>alert("xss")</script>');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('p')?.textContent).toContain('quoted');
  });
});
