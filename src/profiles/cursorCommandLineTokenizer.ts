type QuoteCharacter = '"' | "'";

interface TokenizerState {
  current: string;
  quoteChar?: QuoteCharacter;
}

/** Tokenize a process command line while preserving quoted path arguments. */
export function tokenizeCommandLine(command: string): string[] {
  const tokens: string[] = [];
  const state: TokenizerState = { current: '' };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === undefined) {
      continue;
    }

    if (consumeQuote(char, state, tokens)) {
      continue;
    }

    if (state.quoteChar === undefined && /\s/.test(char)) {
      flushToken(state, tokens);
      continue;
    }

    state.current += char;
  }

  flushToken(state, tokens);
  return tokens;
}

function consumeQuote(
  char: string,
  state: TokenizerState,
  tokens: string[]
): boolean {
  if (!isQuoteCharacter(char)) {
    return false;
  }

  if (state.quoteChar === undefined) {
    state.quoteChar = char;
    return true;
  }

  if (state.quoteChar !== char) {
    return false;
  }

  state.quoteChar = undefined;
  flushToken(state, tokens);
  return true;
}

function isQuoteCharacter(char: string): char is QuoteCharacter {
  return char === '"' || char === "'";
}

function flushToken(state: TokenizerState, tokens: string[]): void {
  if (state.current.length === 0) {
    return;
  }

  tokens.push(state.current);
  state.current = '';
}
