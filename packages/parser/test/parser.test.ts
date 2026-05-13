import { describe, expect, it } from 'vitest';
import { isCustomElementTag } from '../src/is-custom-element-tag.js';
import { Parser } from '../src/parser.js';

const parser = Parser.getInstance();

describe('isCustomElementTag', () => {
  it('accepts hyphenated lowercase names', () => {
    expect(isCustomElementTag('chat-message')).toBe(true);
    expect(isCustomElementTag('data-table')).toBe(true);
  });

  it('rejects plain HTML tags', () => {
    expect(isCustomElementTag('div')).toBe(false);
    expect(isCustomElementTag('strong')).toBe(false);
    expect(isCustomElementTag('h1')).toBe(false);
  });

  it('rejects reserved names', () => {
    expect(isCustomElementTag('font-face')).toBe(false);
    expect(isCustomElementTag('annotation-xml')).toBe(false);
  });

  it('rejects empty / leading-hyphen names', () => {
    expect(isCustomElementTag('')).toBe(false);
    expect(isCustomElementTag('-bad')).toBe(false);
    expect(isCustomElementTag('UPPER-CASE')).toBe(false);
  });

  it('rejects trailing or doubled hyphens', () => {
    expect(isCustomElementTag('bad-')).toBe(false);
    expect(isCustomElementTag('bad--name')).toBe(false);
  });
});

describe('Parser', () => {
  it('returns a markdown-only document for plain markdown', () => {
    const { document, diagnostics } = parser.parse('# Hello\n\nSome **bold** text.');

    expect(diagnostics).toHaveLength(0);
    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.type).toBe('markdown');
  });

  it('extracts a self-closing custom element', () => {
    const source = 'Before.\n\n<data-table src="/api/x"/>\n\nAfter.';
    const { document, diagnostics } = parser.parse(source);

    expect(diagnostics).toHaveLength(0);
    expect(document.nodes).toHaveLength(3);

    const [before, element, after] = document.nodes;
    expect(before?.type).toBe('markdown');
    expect(element?.type).toBe('element');
    expect(after?.type).toBe('markdown');

    if (element?.type === 'element') {
      expect(element.tag).toBe('data-table');
      expect(element.attrs).toEqual({ src: '/api/x' });
      expect(element.selfClosing).toBe(true);
    }
  });

  it('parses paired tags with nested children', () => {
    const source =
      '<choice-group name="q1"><choice-item value="a">A</choice-item><choice-item value="b">B</choice-item></choice-group>';
    const { document, diagnostics } = parser.parse(source);

    expect(diagnostics).toHaveLength(0);
    expect(document.nodes).toHaveLength(1);

    const root = document.nodes[0];
    expect(root?.type).toBe('element');
    if (root?.type === 'element') {
      expect(root.tag).toBe('choice-group');
      expect(root.children).toHaveLength(2);
      const firstChoice = root.children[0];
      expect(firstChoice?.type).toBe('element');
      if (firstChoice?.type === 'element') {
        expect(firstChoice.tag).toBe('choice-item');
        expect(firstChoice.attrs).toEqual({ value: 'a' });
      }
    }
  });

  it('treats a boolean attribute as empty-string value', () => {
    const { document, diagnostics } = parser.parse('<refine-prompt disabled target="$.x"/>');

    expect(diagnostics).toHaveLength(0);
    const element = document.nodes[0];
    expect(element?.type).toBe('element');
    if (element?.type === 'element') {
      expect(element.attrs).toEqual({ disabled: '', target: '$.x' });
    }
  });

  it('ignores plain HTML inside markdown', () => {
    const { document } = parser.parse('<div>not a custom element</div>');

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.type).toBe('markdown');
  });

  it('does not tokenize inside fenced code', () => {
    const source = '```\n<data-table src="x"/>\n```';
    const { document } = parser.parse(source);

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.type).toBe('markdown');
  });

  it('does not tokenize inside inline code', () => {
    const source = 'use the `<data-table src="x"/>` element';
    const { document } = parser.parse(source);

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.type).toBe('markdown');
  });

  it('flags unmatched closing tag', () => {
    const { diagnostics } = parser.parse('</data-table>');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  it('flags missing closing tag', () => {
    const { diagnostics } = parser.parse('<choice-group name="q">');

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]?.severity).toBe('warning');
  });

  it('returns the same singleton instance', () => {
    expect(Parser.getInstance()).toBe(parser);
  });
});
