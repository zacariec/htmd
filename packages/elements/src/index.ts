/**
 * `@zacariec/htmd-elements` — base element set for `.htmd`.
 *
 * Importing this module never touches the DOM, so it is safe in Node/SSR.
 * Call `registerHtmdElements()` (a browser no-op guard is built in) to
 * register the custom elements, or use the `@zacariec/htmd` browser entry which does it
 * for you.
 */

export { ChatMessage } from './chat-message.js';
export type { ChatMessageAuthor, ChatMessageStatus } from './chat-message.js';
export { ChoiceGroup } from './choice-group.js';
export { ChoiceItem } from './choice-item.js';
export { CodeBlock } from './code-block.js';
export { DataTable } from './data-table.js';
export { FilePreview } from './file-preview.js';
export { HtmdFragment } from './htmd-fragment.js';
export { ImageCard } from './image-card.js';
export { RefinePrompt } from './refine-prompt.js';

export { defineOnce } from './define-once.js';
export { HtmdElementTag, registerHtmdElements } from './register-htmd-elements.js';

export { HtmdElementEvents } from './events.js';
export type { ChoiceDetail, ChoiceSelectDetail, RefineDetail } from './events.js';

export { setHtmdElementsLogSink } from './internal/logger.js';
export type { HtmdElementsLogSink } from './internal/logger.js';
