import { ChatMessage } from './chat-message.js';
import { ChoiceGroup } from './choice-group.js';
import { ChoiceItem } from './choice-item.js';
import { CodeBlock } from './code-block.js';
import { DataTable } from './data-table.js';
import { defineOnce } from './define-once.js';
import { FilePreview } from './file-preview.js';
import { HtmdFragment } from './htmd-fragment.js';
import { ImageCard } from './image-card.js';
import { RefinePrompt } from './refine-prompt.js';

/** Tag names for the base element set. */
export enum HtmdElementTag {
  ChatMessage = 'chat-message',
  ChoiceGroup = 'choice-group',
  ChoiceItem = 'choice-item',
  CodeBlock = 'code-block',
  DataTable = 'data-table',
  FilePreview = 'file-preview',
  HtmdFragment = 'htmd-fragment',
  ImageCard = 'image-card',
  RefinePrompt = 'refine-prompt',
}

/**
 * Registers the base element set with the global custom-element registry.
 *
 * Safe to call multiple times (idempotent) and safe to call — or merely
 * import — in Node/SSR, where it is a no-op returning false.
 */
export function registerHtmdElements(): boolean {
  if (typeof customElements === 'undefined') {
    return false;
  }

  defineOnce(HtmdElementTag.ChatMessage, ChatMessage);
  defineOnce(HtmdElementTag.ChoiceGroup, ChoiceGroup);
  defineOnce(HtmdElementTag.ChoiceItem, ChoiceItem);
  defineOnce(HtmdElementTag.CodeBlock, CodeBlock);
  defineOnce(HtmdElementTag.DataTable, DataTable);
  defineOnce(HtmdElementTag.FilePreview, FilePreview);
  defineOnce(HtmdElementTag.HtmdFragment, HtmdFragment);
  defineOnce(HtmdElementTag.ImageCard, ImageCard);
  defineOnce(HtmdElementTag.RefinePrompt, RefinePrompt);

  return true;
}
