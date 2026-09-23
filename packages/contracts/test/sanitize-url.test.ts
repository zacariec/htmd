import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../src/sanitize-url.js';

describe('sanitizeUrl', () => {
  it('allows http and https URLs', () => {
    expect(sanitizeUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(sanitizeUrl('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d');
  });

  it('allows mailto and tel URLs', () => {
    expect(sanitizeUrl('mailto:a@example.com')).toBe('mailto:a@example.com');
    expect(sanitizeUrl('tel:+15551234567')).toBe('tel:+15551234567');
  });

  it('allows relative URLs, fragments, and queries', () => {
    expect(sanitizeUrl('/files/report.pdf')).toBe('/files/report.pdf');
    expect(sanitizeUrl('report.pdf')).toBe('report.pdf');
    expect(sanitizeUrl('../up/one')).toBe('../up/one');
    expect(sanitizeUrl('#section')).toBe('#section');
    expect(sanitizeUrl('?page=2')).toBe('?page=2');
  });

  it('rejects javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('JavaScript:alert(1)')).toBeUndefined();
  });

  it('rejects the tab/newline scheme-split bypass', () => {
    expect(sanitizeUrl('java\tscript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('java\nscript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('java\rscript:alert(1)')).toBeUndefined();
  });

  it('rejects data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(sanitizeUrl('data:image/png;base64,AAAA')).toBeUndefined();
  });

  it('rejects other executable or opaque schemes', () => {
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBeUndefined();
    expect(sanitizeUrl('blob:https://example.com/uuid')).toBeUndefined();
    expect(sanitizeUrl('file:///etc/passwd')).toBeUndefined();
  });

  it('rejects empty and whitespace-only values', () => {
    expect(sanitizeUrl('')).toBeUndefined();
    expect(sanitizeUrl('   ')).toBeUndefined();
    expect(sanitizeUrl('\t\n')).toBeUndefined();
  });

  it('trims surrounding whitespace from allowed URLs', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com');
  });
});
