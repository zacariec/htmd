import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

/**
 * Markdown → HTML for `.htmd` markdown blocks.
 *
 * micromark with GFM (tables, strikethrough, task lists, autolinks). Raw HTML
 * stays escaped (`allowDangerousHtml` is never enabled) and dangerous link
 * protocols are stripped (`allowDangerousProtocol` is never enabled) — this is
 * the safety floor the `.htmd` security model relies on.
 */
export function renderMarkdown(source: string): string {
  return micromark(source, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  });
}
