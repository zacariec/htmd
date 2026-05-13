/**
 * Character-level cursor over a source string.
 *
 * Encapsulates position state so the tokenizer can walk linearly without
 * tracking indices by hand. `save()` / `restore(checkpoint)` give cheap
 * try-and-rollback semantics for speculative tag parsing.
 *
 * The source is held by reference — `slice(start, end)` returns a substring
 * but the cursor never copies the source.
 */

export class Cursor {
  private pos: number = 0;

  public constructor(private readonly source: string) {}

  public eof(): boolean {
    return this.pos >= this.source.length;
  }

  public peek(offset: number = 0): string | undefined {
    return this.source[this.pos + offset];
  }

  public advance(count: number = 1): void {
    this.pos += count;
  }

  public position(): number {
    return this.pos;
  }

  public save(): number {
    return this.pos;
  }

  public restore(checkpoint: number): void {
    this.pos = checkpoint;
  }

  public startsWith(literal: string): boolean {
    return this.source.startsWith(literal, this.pos);
  }

  public slice(start: number, end: number): string {
    return this.source.slice(start, end);
  }

  public sourceLength(): number {
    return this.source.length;
  }
}
