import type { Token } from './tokenizer.js';

/**
 * Token-level cursor over the output of the tokenizer.
 *
 * Same shape as `Cursor` but operates on tokens instead of characters.
 * Encapsulates the parser's index so callers don't have to thread a
 * mutable `{ index: number }` through recursive calls.
 */
export class TokenCursor {
  private pos: number = 0;

  public constructor(private readonly tokens: readonly Token[]) {}

  public eof(): boolean {
    return this.pos >= this.tokens.length;
  }

  public peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  public advance(): void {
    this.pos += 1;
  }

  public position(): number {
    return this.pos;
  }

  /**
   * Source-offset end of the most recently consumed token (the one before
   * the current position). Used by the parser to compute the closing
   * boundary of a paired element.
   */
  public lastConsumedEnd(): number {
    const prior = this.tokens[this.pos - 1];
    if (prior === undefined) {
      return 0;
    }
    return prior.end;
  }
}
