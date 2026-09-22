import { describe, expect, it } from 'vitest';
import { isCustomElementTag } from '../src/is-custom-element-tag.js';
import { Parser } from '../src/parser.js';
import { DiagnosticCode, DiagnosticSeverity } from '../src/types.js';

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

describe('Parser — structure', () => {
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

  it('flags unmatched closing tag', () => {
    const { diagnostics } = parser.parse('</data-table>');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(DiagnosticCode.UnexpectedClosingTag);
    expect(diagnostics[0]?.severity).toBe(DiagnosticSeverity.Warning);
  });

  it('flags missing closing tag', () => {
    const { diagnostics } = parser.parse('<choice-group name="q">');

    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics[0]?.code).toBe(DiagnosticCode.MissingClosingTag);
  });

  it('returns the same singleton instance', () => {
    expect(Parser.getInstance()).toBe(parser);
  });
});

describe('Parser — code suppression', () => {
  it('does not tokenize inside fenced code', () => {
    const source = '```\n<data-table src="x"/>\n```';
    const { document, diagnostics } = parser.parse(source);

    expect(diagnostics).toHaveLength(0);
    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.type).toBe('markdown');
  });

  it('does not tokenize inside inline code', () => {
    const source = 'use the `<data-table src="x"/>` element';
    const { document } = parser.parse(source);

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.type).toBe('markdown');
  });

  it('requires fences to be line-anchored', () => {
    const source = 'text ``` not a fence\n\n<data-table src="/x"/>';
    const { document } = parser.parse(source);

    const element = document.nodes.find((node) => node.type === 'element');
    expect(element).toBeDefined();
  });

  it('handles four-backtick fences quoting three-backtick fences', () => {
    const source = [
      '````',
      '```',
      '<data-table src="/x"/>',
      '```',
      '````',
      '',
      '<image-card src="/real.png" alt="real" width="4" height="3"/>',
    ].join('\n');
    const { document } = parser.parse(source);

    const elements = document.nodes.filter((node) => node.type === 'element');
    expect(elements).toHaveLength(1);
    if (elements[0]?.type === 'element') {
      expect(elements[0].tag).toBe('image-card');
    }
  });

  it('does not let a shorter closing run close a longer fence', () => {
    const source =
      '````\n```\n<data-table src="/x"/>\n````\n\n<chat-message author="agent"></chat-message>';
    const { document } = parser.parse(source);

    const elements = document.nodes.filter((node) => node.type === 'element');
    expect(elements).toHaveLength(1);
    if (elements[0]?.type === 'element') {
      expect(elements[0].tag).toBe('chat-message');
    }
  });

  it('does not let a stray backtick poison the rest of the document', () => {
    const source = 'an unpaired ` backtick\n\n<data-table src="/x"/>';
    const { document } = parser.parse(source);

    const element = document.nodes.find((node) => node.type === 'element');
    expect(element).toBeDefined();
  });

  it('does not pair inline code across a blank line', () => {
    const source = 'one ` here\n\n<data-table src="/x"/>\n\ntwo ` there';
    const { document } = parser.parse(source);

    const element = document.nodes.find((node) => node.type === 'element');
    expect(element).toBeDefined();
  });
});

describe('Parser — fragment raw text', () => {
  it('treats fragment children as raw text, not nested elements', () => {
    const payload = '{"tag":"div","text":"<data-table src=\\"/x\\"/> is not scanned"}';
    const source = `<htmd-fragment kind="card">${payload}</htmd-fragment>`;
    const { document, diagnostics } = parser.parse(source);

    expect(diagnostics).toHaveLength(0);
    expect(document.nodes).toHaveLength(1);
    const fragment = document.nodes[0];
    expect(fragment?.type).toBe('element');
    if (fragment?.type === 'element') {
      expect(fragment.tag).toBe('htmd-fragment');
      expect(fragment.children).toHaveLength(1);
      const child = fragment.children[0];
      expect(child?.type).toBe('markdown');
      if (child?.type === 'markdown') {
        expect(child.source).toBe(payload);
      }
    }
  });

  it('flags a fragment with a missing close tag', () => {
    const { diagnostics } = parser.parse('<htmd-fragment kind="card">{"tag":"div"}');

    expect(diagnostics.some((d) => d.code === DiagnosticCode.MissingClosingTag)).toBe(true);
  });
});

describe('Parser — forbidden constructs', () => {
  it('flags <script> in markdown spans', () => {
    const { diagnostics } = parser.parse('hello <script>alert(1)</script> world');

    const errors = diagnostics.filter((d) => d.code === DiagnosticCode.ForbiddenTag);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('flags every forbidden tag', () => {
    for (const tag of ['style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form']) {
      const { diagnostics } = parser.parse(`<${tag}>`);
      expect(
        diagnostics.some((d) => d.code === DiagnosticCode.ForbiddenTag),
        `expected <${tag}> to be flagged`,
      ).toBe(true);
    }
  });

  it('does not flag forbidden tags inside code', () => {
    const { diagnostics } = parser.parse('```\n<script>alert(1)</script>\n```');

    expect(diagnostics).toHaveLength(0);
  });

  it('flags on* attributes on custom elements', () => {
    const { diagnostics, document } = parser.parse('<image-card onerror="x()" src="/a.png"/>');

    expect(diagnostics.some((d) => d.code === DiagnosticCode.ForbiddenAttribute)).toBe(true);
    const element = document.nodes[0];
    if (element?.type === 'element') {
      expect(element.attrs['onerror']).toBe('x()');
    }
  });

  it('flags javascript: URLs in attribute values', () => {
    const { diagnostics } = parser.parse('<file-preview href="javascript:alert(1)" name="x"/>');

    expect(diagnostics.some((d) => d.code === DiagnosticCode.ForbiddenUrlScheme)).toBe(true);
  });

  it('flags javascript: URLs in markdown spans', () => {
    const { diagnostics } = parser.parse('[click](javascript:alert(1))');

    expect(diagnostics.some((d) => d.code === DiagnosticCode.ForbiddenUrlScheme)).toBe(true);
  });

  it('does not flag javascript: inside code spans', () => {
    const { diagnostics } = parser.parse('never use `javascript:` URLs');

    expect(diagnostics).toHaveLength(0);
  });

  it('flags an entity-encoded javascript: URL using raw source offsets', () => {
    const source = '<file-preview href="&#106;avascript:alert(1)" name="x"/>';
    const { diagnostics } = parser.parse(source);
    const diagnostic = diagnostics.find((d) => d.code === DiagnosticCode.ForbiddenUrlScheme);

    expect(diagnostic?.severity).toBe(DiagnosticSeverity.Error);
    expect(source.slice(diagnostic?.start, diagnostic?.end)).toBe('&#106;avascript:alert(1)');
  });
});

describe('Parser — attribute quoting', () => {
  it('accepts single-quoted attributes with a warning', () => {
    const { document, diagnostics } = parser.parse("<data-table src='/api/x'/>");

    const element = document.nodes[0];
    expect(element?.type).toBe('element');
    if (element?.type === 'element') {
      expect(element.attrs).toEqual({ src: '/api/x' });
    }
    expect(diagnostics.some((d) => d.code === DiagnosticCode.SingleQuotedAttribute)).toBe(true);
    expect(diagnostics.every((d) => d.severity === DiagnosticSeverity.Warning)).toBe(true);
  });

  it('falls back to markdown on an unterminated quote', () => {
    const { document } = parser.parse('<data-table src="/api/x>');

    expect(document.nodes[0]?.type).toBe('markdown');
  });
});

describe('Parser — attribute entity decoding', () => {
  function attrsOf(source: string): Readonly<Record<string, string>> {
    const { document } = parser.parse(source);
    const element = document.nodes[0];
    if (element?.type !== 'element') {
      throw new Error(`expected an element node for: ${source}`);
    }
    return element.attrs;
  }

  it('decodes the named entities the serializer emits', () => {
    expect(attrsOf('<image-card alt="Milk &amp; Honey"/>')['alt']).toBe('Milk & Honey');
    expect(attrsOf('<image-card alt="Tom &quot;Doc&quot;"/>')['alt']).toBe('Tom "Doc"');
    expect(attrsOf('<file-preview name="&lt;draft&gt;.pdf"/>')['name']).toBe('<draft>.pdf');
    expect(attrsOf("<image-card alt='it&apos;s'/>")['alt']).toBe("it's");
  });

  it('decodes decimal and hexadecimal numeric references', () => {
    expect(attrsOf('<image-card alt="Milk &#38; Honey"/>')['alt']).toBe('Milk & Honey');
    expect(attrsOf('<image-card alt="Milk &#x26; Honey"/>')['alt']).toBe('Milk & Honey');
    expect(attrsOf('<image-card alt="&#x1F600;"/>')['alt']).toBe('\u{1F600}');
  });

  it('decodes in a single pass so escaped entity text remains text', () => {
    expect(attrsOf('<image-card alt="&amp;lt;"/>')['alt']).toBe('&lt;');
    expect(attrsOf('<image-card alt="&amp;amp;"/>')['alt']).toBe('&amp;');
  });

  it('passes through everything outside the supported set', () => {
    expect(attrsOf('<image-card alt="a &nbsp; b"/>')['alt']).toBe('a &nbsp; b');
    expect(attrsOf('<image-card alt="&notanentity"/>')['alt']).toBe('&notanentity');
    expect(attrsOf('<image-card alt="Tom & Jerry"/>')['alt']).toBe('Tom & Jerry');
    expect(attrsOf('<image-card alt="100% &"/>')['alt']).toBe('100% &');
    expect(attrsOf('<image-card alt="&constructor;"/>')['alt']).toBe('&constructor;');
  });

  it('keeps decoded quote and markup characters inside their attribute value', () => {
    const result = parser.parse('<image-card alt="&quot; onload=&quot;x&lt;other-card/&gt;"/>');
    expect(result.document.nodes).toHaveLength(1);
    const element = result.document.nodes[0];
    if (element?.type !== 'element') throw new Error('expected image card');
    expect(element.attrs).toEqual({ alt: '" onload="x<other-card/>' });
    expect(result.diagnostics).toEqual([]);
  });

  it('leaves invalid Unicode and malformed numeric references alone', () => {
    expect(attrsOf('<image-card alt="&#xD800;"/>')['alt']).toBe('&#xD800;');
    expect(attrsOf('<image-card alt="&#999999999;"/>')['alt']).toBe('&#999999999;');
    expect(attrsOf('<image-card alt="&#0;"/>')['alt']).toBe('&#0;');
    expect(attrsOf('<image-card alt="&#;"/>')['alt']).toBe('&#;');
  });

  it('does not decode entities in markdown blocks', () => {
    const { document } = parser.parse('Milk &amp; Honey');
    expect(document.nodes).toEqual([
      { type: 'markdown', source: 'Milk &amp; Honey', start: 0, end: 16 },
    ]);
  });
});

describe('Parser — streaming boundaries', () => {
  it('buffers every partial tag boundary and renders open children progressively', () => {
    const opening = '<choice-group title="A &quot;B&quot;">';
    const body = 'Hello';
    const closing = '</choice-group>';
    const source = opening + body + closing;

    for (let end = 1; end <= source.length; end += 1) {
      const prefix = source.slice(0, end);
      const result = parser.parse(prefix, { streaming: true });
      expect(result.document.source).toBe(prefix);
      expect(result.diagnostics).toEqual([]);
      expect(result.pending).toBe(end < source.length);
      if (end < opening.length) {
        expect(result.document.nodes).toEqual([]);
        continue;
      }
      const node = result.document.nodes[0];
      expect(node?.type).toBe('element');
      if (node?.type !== 'element') throw new Error('expected progressive element');
      expect(node.attrs['title']).toBe('A "B"');
      expect(node.children.map((child) => child.source).join('')).toBe(
        body.slice(0, Math.max(0, end - opening.length)),
      );
    }

    expect(parser.parse(source, { streaming: true })).toEqual(parser.parse(source));
  });

  it('flushes buffered suffixes verbatim with diagnostics on finalization', () => {
    for (const suffix of ['<', '</', '<image-', '<image-card src="x>', '</image-card ']) {
      const source = `Before ${suffix}`;
      const streaming = parser.parse(source, { streaming: true });
      expect(streaming.document.nodes.map((node) => node.source).join('')).toBe('Before ');
      expect(streaming.pending).toBe(true);
      expect(streaming.diagnostics).toEqual([]);

      const final = parser.parse(source);
      expect(final.document.nodes.map((node) => node.source).join('')).toBe(source);
      expect(final.pending).toBe(false);
      expect(final.diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.IncompleteTag]);
    }
  });

  it('finalizes nested open elements without dropping children or partial closing text', () => {
    const source = '<outer-box><inner-box>Hello</inner-';
    const streaming = parser.parse(source, { streaming: true });
    expect(streaming.pending).toBe(true);
    expect(streaming.diagnostics).toEqual([]);

    const final = parser.parse(source);
    expect(final.pending).toBe(false);
    expect(
      final.diagnostics.filter((d) => d.code === DiagnosticCode.MissingClosingTag),
    ).toHaveLength(2);
    const outer = final.document.nodes[0];
    expect(outer?.source).toBe(source);
    if (outer?.type !== 'element') throw new Error('expected outer element');
    const inner = outer.children[0];
    if (inner?.type !== 'element') throw new Error('expected inner element');
    expect(inner.children.map((node) => node.source).join('')).toBe('Hello</inner-');
  });

  it('preserves unmatched closing tags as literal text rather than discarding content', () => {
    const source = 'Before </unknown-box> after';
    const final = parser.parse(source);
    expect(final.document.nodes.map((node) => node.source).join('')).toBe(source);
    expect(final.diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.UnexpectedClosingTag]);
  });

  it('only decodes and diagnoses complete attribute values once a tag is complete', () => {
    const source = '<file-preview href="&#x6a;avascript:alert(1)"/>';
    for (let end = 1; end < source.length; end += 1) {
      const result = parser.parse(source.slice(0, end), { streaming: true });
      expect(result.document.nodes).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
    const complete = parser.parse(source, { streaming: true });
    expect(complete.diagnostics.map((d) => d.code)).toEqual([DiagnosticCode.ForbiddenUrlScheme]);
    expect(complete.pending).toBe(false);
  });

  it('keeps code literals inert at every streamed prefix', () => {
    for (const source of [
      'Use `<image-card src="x"/>` here',
      'Use ``<image-card src="x"/> ` literal`` here',
      '```htmd\n<image-card src="x"/>\n```',
      '~~~htmd\n<image-card src="x"/>\n~~~',
      '````\n```\n<image-card src="x"/>\n````',
    ]) {
      for (let end = 1; end <= source.length; end += 1) {
        const prefix = source.slice(0, end);
        const result = parser.parse(prefix, { streaming: true });
        expect(result.document.nodes.every((node) => node.type === 'markdown')).toBe(true);
        expect(result.document.nodes.map((node) => node.source).join('')).toBe(prefix);
        expect(result.diagnostics).toEqual([]);
      }
      expect(parser.parse(source).document.nodes.every((node) => node.type === 'markdown')).toBe(
        true,
      );
    }
  });

  it('does not mistake a different fence marker for the end of a code block', () => {
    const source = '~~~\n```\n<image-card src="x"/>\n~~~';
    expect(parser.parse(source).document.nodes.map((node) => node.source)).toEqual([source]);
  });

  it('resolves an unmatched backtick when its paragraph ends or the source finalizes', () => {
    const source = 'Unpaired `<image-card/>';
    const streaming = parser.parse(`${source}\n`, { streaming: true });
    expect(streaming.pending).toBe(true);
    expect(streaming.document.nodes.every((node) => node.type === 'markdown')).toBe(true);
    expect(parser.parse(source).document.nodes.some((node) => node.type === 'element')).toBe(true);
    const ended = parser.parse(`${source}\n\n`, { streaming: true });
    expect(ended.pending).toBe(false);
    expect(ended.document.nodes.some((node) => node.type === 'element')).toBe(true);
  });

  it('respects escaped backticks and tag delimiters', () => {
    const source = '\\`<image-card/> and \\<other-card/>';
    const result = parser.parse(source, { streaming: true });
    expect(
      result.document.nodes.filter((node) => node.type === 'element').map((node) => node.tag),
    ).toEqual(['image-card']);
    expect(result.pending).toBe(false);
  });

  it('buffers fragment closing prefixes while keeping false close matches raw', () => {
    const opening = '<htmd-fragment>';
    const payload = '{"text":"</htmd-fragment-extra><image-card/>"}';
    const closing = '</htmd-fragment>';
    for (let end = 1; end <= closing.length; end += 1) {
      const result = parser.parse(opening + payload + closing.slice(0, end), { streaming: true });
      const fragment = result.document.nodes[0];
      if (fragment?.type !== 'element') throw new Error('expected fragment');
      expect(fragment.children.map((node) => node.source).join('')).toBe(payload);
      expect(fragment.children.every((node) => node.type === 'markdown')).toBe(true);
      expect(result.pending).toBe(end < closing.length);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('leaves ordinary Markdown verbatim and does not mark complete prose pending', () => {
    const source = '# Hello\n\n**bold** [link](https://example.com)\n\n| a | b |\n| - | - |';
    const result = parser.parse(source, { streaming: true });
    expect(result.document.nodes.map((node) => node.source).join('')).toBe(source);
    expect(result.pending).toBe(false);
    expect(parser.parse('', { streaming: true }).pending).toBe(false);
  });
});
