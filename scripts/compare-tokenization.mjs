#!/usr/bin/env node
/**
 * Compare character heuristics vs ai-tokenizer.
 *
 * Usage:
 *   node scripts/compare-tokenization.mjs
 *   pnpm run compare:tokenization
 */

import {
  countTextTokens,
  estimateTokensFromChars,
} from './lib/ai-token-estimate.mjs';

const samples = [
  {
    name: 'English prose',
    text: 'The quick brown fox jumps over the lazy dog. This is a sample sentence to test tokenization accuracy.',
    encoding: 'o200k_base',
  },
  {
    name: 'Python code',
    text: `def calculate_tokens(text: str) -> int:
    """Count tokens in text."""
    encoding = tiktoken.encoding_for_model("gpt-4o")
    return len(encoding.encode(text))`,
    encoding: 'o200k_base',
  },
  {
    name: 'JSON data',
    text: JSON.stringify({
      user: { id: 123, name: 'John Doe', email: 'john@example.com' },
      settings: { theme: 'dark', notifications: true, language: 'en' },
      metadata: { created: '2026-06-04', version: '1.2.3' },
    }),
    encoding: 'o200k_base',
  },
  {
    name: 'Chinese text',
    text: '机器学习是人工智能的一个分支，它使计算机能够从数据中学习并改进性能。深度学习是机器学习的一个子集。',
    encoding: 'claude',
  },
  {
    name: 'Arabic text',
    text: 'الذكاء الاصطناعي هو محاكاة العمليات الذكاء البشري بواسطة الآلات وخاصة أنظمة الكمبيوتر.',
    encoding: 'claude',
  },
  {
    name: 'Minified JavaScript',
    text: 'const f=(a,b)=>{return a+b};const g=x=>x*2;const h=[1,2,3].map(g).reduce(f,0);console.log(h);',
    encoding: 'o200k_base',
  },
  {
    name: 'Markdown documentation',
    text: `## Token Counting

Token counting is essential for:
- Cost estimation
- Context window management
- API quota tracking

### Example

\`\`\`javascript
import { count } from 'ai-tokenizer';
const tokens = count('hello world');
\`\`\`
`,
    encoding: 'o200k_base',
  },
  {
    name: 'Tool definition (JSON schema)',
    text: JSON.stringify({
      name: 'get_weather',
      description: 'Get current weather information for a specified location',
      input_schema: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name or coordinates' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' },
          include_forecast: { type: 'boolean', description: 'Include 5-day forecast' },
        },
        required: ['location'],
      },
    }),
    encoding: 'claude',
  },
];

function errorPercent(estimate, actual) {
  if (actual === 0) {
    return estimate === 0 ? 0 : Infinity;
  }
  return ((estimate - actual) / actual) * 100;
}

function formatError(estimate, actual) {
  const error = errorPercent(estimate, actual);
  const sign = error > 0 ? '+' : '';
  const color = Math.abs(error) > 20 ? '❌' : Math.abs(error) > 10 ? '⚠️' : '✅';
  return `${color} ${sign}${error.toFixed(1)}%`;
}

function main() {
  console.log('=== Token Counting: Heuristics vs ai-tokenizer ===\n');
  console.log('Encodings: o200k_base (OpenAI/default), claude (Anthropic/composer)\n');

  /** @type {Array<{ error4: number, errorAi: number }>} */
  const results = [];

  for (const sample of samples) {
    const { name, text, encoding } = sample;
    const charCount = text.length;
    const realTokens = countTextTokens(text, encoding);
    const charsDiv4 = estimateTokensFromChars(charCount).charsDiv4;
    const aiTokens = realTokens;
    const actualRatio = charCount / realTokens;

    results.push({
      error4: errorPercent(charsDiv4, realTokens),
      errorAi: errorPercent(aiTokens, realTokens),
    });

    console.log(`### ${name} [${encoding}]`);
    console.log(`Text: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
    console.log(
      `Chars: ${charCount} | ai-tokenizer: ${realTokens} | ratio: ${actualRatio.toFixed(2)} chars/token`
    );
    console.log('');
    console.log(
      `  chars/4:       ${charsDiv4.toLocaleString().padStart(6)} tokens ${formatError(charsDiv4, realTokens)}`
    );
    console.log(
      `  ai-tokenizer:  ${aiTokens.toLocaleString().padStart(6)} tokens ${formatError(aiTokens, realTokens)}`
    );
    console.log('');
  }

  const avgError4 =
    results.reduce((sum, r) => sum + Math.abs(r.error4), 0) / results.length;
  const avgErrorAi =
    results.reduce((sum, r) => sum + Math.abs(r.errorAi), 0) / results.length;

  console.log('\n=== Summary ===\n');
  console.log(`Average absolute error — chars/4:     ${avgError4.toFixed(1)}%`);
  console.log(`Average absolute error — ai-tokenizer: ${avgErrorAi.toFixed(1)}%`);
  console.log('');
  console.log('✅ ai-tokenizer matches itself (0% error by definition)');
  console.log('❌ chars/4 fails on code, JSON, and non-Latin scripts');
  console.log('');
  console.log('📖 See docs/TOKENIZATION-BEST-PRACTICES.md');
}

main();
