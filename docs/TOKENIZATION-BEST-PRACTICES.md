# Token Counting Best Practices

## Executive Summary

The current `chars/4` and `chars/3.5` heuristics are **fundamentally flawed** for accurate token counting:

- **English prose**: 4 chars/token → `chars/4` works (~95% accuracy)
- **Code/JSON**: 2-3 chars/token → `chars/4` **underestimates by 30-50%**
- **Unicode languages** (Chinese, Arabic): 1-2 chars/token → `chars/4` **underestimates by 50-75%**
- **Message overhead**: Roles, formatting, tool definitions add tokens not counted in raw text

**Recommendation**: Use provider-specific tokenizers or APIs instead of character-based heuristics.

---

## Tokenization by Provider

### OpenAI Models (GPT-4, GPT-4o, o1, etc.)

Use **tiktoken**, OpenAI's official BPE tokenizer.

#### JavaScript Libraries

| Library | Use Case | Trade-offs |
|---------|----------|------------|
| **js-tiktoken** | Universal (edge runtimes) | 5.2M weekly downloads, pure JS, works everywhere (Cloudflare Workers, Vercel Edge), ~200KB bundle |
| **gpt-tokenizer** | Small texts, bundle size | Fastest for short inputs (1.05 µs/iter), smallest bundle (~50KB), pure JS |
| **tiktoken** (@dqbd) | Node.js, batch processing | WASM, 3-6× faster for large volumes, requires Node.js/WASM support |

#### Installation

```bash
npm install js-tiktoken
# or
npm install gpt-tokenizer
# or
npm install tiktoken  # WASM version
```

#### Basic Usage

```javascript
import { encoding_for_model } from 'js-tiktoken';

// Simple text
const enc = encoding_for_model('gpt-4o');
const tokens = enc.encode('hello world');
console.log(tokens.length); // 2

// Don't forget to free the encoder when done
enc.free();
```

#### Message Token Counting (with overhead)

Messages include overhead for:
- **3 tokens per message** (role + formatting)
- **1 token per name** (if message has a name field)
- **3 tokens for assistant response** priming

```javascript
function countMessageTokens(messages, model = 'gpt-4o') {
  const enc = encoding_for_model(model);
  const tokensPerMessage = 3;
  const tokensPerName = 1;
  
  let numTokens = 0;
  for (const message of messages) {
    numTokens += tokensPerMessage;
    for (const [key, value] of Object.entries(message)) {
      numTokens += enc.encode(String(value)).length;
      if (key === 'name') {
        numTokens += tokensPerName;
      }
    }
  }
  numTokens += 3; // Assistant response priming
  enc.free();
  return numTokens;
}
```

#### Model-specific Encodings

Different OpenAI models use different encodings:

| Encoding | Models |
|----------|--------|
| **o200k_base** | gpt-4o, gpt-4.1, o1, o3, o4 (newest) |
| **cl100k_base** | gpt-4, gpt-4-32k, gpt-3.5-turbo |
| **p50k_base** | text-davinci-003, text-davinci-002 |
| **r50k_base** | text-davinci-001, davinci |

Use `encoding_for_model(model_name)` instead of hardcoding encodings.

---

### Anthropic Models (Claude)

**Do NOT use local tokenizers** — Anthropic provides a **free, official token counting API**.

#### Count Tokens API Endpoint

```bash
POST https://api.anthropic.com/v1/messages/count_tokens
```

**Advantages:**
- ✅ **Free** (no charge for counting)
- ✅ **Exact** (uses the model's actual tokenizer)
- ✅ **Comprehensive** (counts system prompts, tools, images, PDFs)
- ✅ **Independent rate limits** (doesn't count against message creation quota)

#### API Usage

```bash
curl https://api.anthropic.com/v1/messages/count_tokens \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "system": "You are a helpful assistant.",
    "tools": [
      {
        "name": "get_weather",
        "description": "Get weather for a location",
        "input_schema": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          }
        }
      }
    ],
    "messages": [
      {"role": "user", "content": "What's the weather in Tokyo?"}
    ]
  }'
```

**Response:**
```json
{
  "input_tokens": 2095
}
```

#### JavaScript Integration

```javascript
async function countClaudeTokens(model, system, messages, tools = []) {
  const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      system,
      messages,
      tools,
    }),
  });
  
  const data = await response.json();
  return data.input_tokens;
}
```

#### Important Notes

1. **Model-specific**: Always specify the exact model you'll use (claude-sonnet-4-6, claude-opus-4-8, etc.)
2. **Output tokens**: Cannot be counted in advance (depends on model response)
3. **Cache tokens**: `count_tokens` returns uncached count; actual billing reflects cache hits
4. **Rate limits**: 100-8,000 RPM depending on usage tier (separate from message creation)

---

## What to Tokenize

### Everything Sent to the Model

1. **System prompts**
   - Can add hundreds or thousands of tokens
   - Often static → good candidate for prompt caching

2. **User messages**
   - Content + role overhead (~3 tokens/message)
   - Name field adds +1 token if present

3. **Conversation history**
   - Complete history is resent on each request
   - Major cost driver for long conversations

4. **Tool/function definitions**
   - 50-500 tokens per tool depending on schema complexity
   - Example: Simple tool (short description, 2 params) = ~75 tokens
   - Example: Complex tool (detailed description, 10 params with descriptions) = ~400 tokens

5. **Tool results**
   - Outputs from function calls returned to the model

6. **Images** (multimodal models)
   - OpenAI: ~85-170 tokens per image (depends on size/detail)
   - Claude: Variable based on image dimensions

7. **PDFs** (Claude)
   - ~1 token per 100 bytes of PDF content

8. **Thinking blocks** (Claude extended thinking)
   - Previous assistant thinking is NOT counted in input tokens
   - Current turn thinking IS counted

9. **Cache control markers** (Anthropic prompt caching)
   - Negligible overhead, but marks cache boundaries

### What NOT to Count

- System-added tokens (Anthropic optimizations — you're not billed for these)
- HTTP headers, request metadata
- Token overhead already included in API responses

---

## Common Pitfalls

### 1. System Prompt Duplication

**Problem**: Static system prompts are resent on every request.

**Example**:
- 1,000-token system prompt × 1,000 requests = 1M tokens = $3 USD (at $3/1M input rate)

**Solution**: Use **prompt caching** (Anthropic, OpenAI):
- 90% discount on cached tokens
- Same 1M tokens with caching = $0.30 USD

### 2. Tool Definition Overhead

**Problem**: Tool definitions can be surprisingly large.

**Example**: 5 tools with average 200 tokens each = 1,000 tokens per request

**Solution**:
- Only include tools relevant to the current turn
- Use concise descriptions and schemas
- Cache tool definitions if static

### 3. Underestimating Code Tokens

**Problem**: Code tokenizes worse than prose.

**Actual ratios**:
- English prose: ~4 chars/token
- Python code: ~2.5 chars/token
- JSON: ~2.8 chars/token
- Minified JS: ~2 chars/token

**Solution**: Use real tokenizers, not `chars/4`.

### 4. Unicode Languages

**Problem**: Non-English text tokenizes very differently.

**Actual ratios**:
- Chinese: ~1.5 chars/token
- Arabic: ~2 chars/token
- Japanese: ~1.8 chars/token

**Solution**: Use model-specific tokenizers.

---

## Implementation Strategy

### For cursor-accounts Proxy

1. **OpenAI models** (if we want accurate input estimation):
   ```bash
   npm install js-tiktoken
   ```
   
   - Use `encoding_for_model()` to tokenize proxy-captured text
   - Store tokenized counts alongside proxy insights

2. **Claude models** (recommended approach):
   - **Do NOT tokenize locally**
   - Use `get-filtered-usage-events` dashboard API as source of truth (already implemented)
   - Optional: Call `/v1/messages/count_tokens` endpoint for pre-flight checks

3. **Mixed models**:
   - Detect model from request
   - Route to appropriate tokenizer/API

### Cost Estimates vs Actual Billing

**Pre-flight estimates** (before sending request):
- OpenAI: Use tiktoken
- Claude: Use `/v1/messages/count_tokens` API

**Actual billing** (ground truth):
- OpenAI: Parse `usage` field from API response
- Claude: Use `get-filtered-usage-events` (as currently implemented)

**Never rely on proxy text extraction for billing** — it's fundamentally incomplete:
- Tool calls may not be visible in proxy traffic
- Streaming responses may be truncated
- System optimizations add hidden tokens
- Cache behavior differs per request

---

## Comparison: Heuristics vs Real Tokenizers

| Method | English Prose | Code/JSON | Chinese | Tool Overhead |
|--------|---------------|-----------|---------|---------------|
| **chars/4** | ✅ ~95% accurate | ❌ 30-50% error | ❌ 50-75% error | ❌ Not counted |
| **chars/3.5** | ⚠️ +15% overestimate | ⚠️ Still 20-40% error | ❌ 40-60% error | ❌ Not counted |
| **tiktoken** (OpenAI) | ✅ Exact | ✅ Exact | ✅ Exact | ⚠️ Manual overhead calc |
| **count_tokens API** (Claude) | ✅ Exact | ✅ Exact | ✅ Exact | ✅ Included |

---

## References

- [OpenAI: How to count tokens with tiktoken](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken)
- [Anthropic: Token counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [js-tiktoken npm package](https://www.npmjs.com/package/js-tiktoken)
- [gpt-tokenizer npm package](https://www.npmjs.com/package/gpt-tokenizer)
- [Anthropic: Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
