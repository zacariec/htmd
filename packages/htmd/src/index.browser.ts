/**
 * `htmd` browser entry — same public surface as `./index.js` and eagerly
 * registers the base custom elements. Bundlers must not tree-shake this file
 * (see the `sideEffects` allowlist in `package.json`).
 */
import { registerHtmdElements } from '@htmdjs/elements';

registerHtmdElements();

export {
  DiagnosticCode,
  DiagnosticSeverity,
  isCustomElementTag,
  Parser,
} from '@htmdjs/parser';
export type {
  Diagnostic,
  ElementBlock,
  HtmdDocument,
  HtmdNode,
  MarkdownBlock,
  ParseOptions,
  ParseResult,
} from '@htmdjs/parser';

export {
  ChatMessage,
  ChoiceGroup,
  ChoiceItem,
  CodeBlock,
  DataTable,
  defineOnce,
  FilePreview,
  HtmdElementEvents,
  HtmdElementTag,
  HtmdFragment,
  ImageCard,
  RefinePrompt,
  registerHtmdElements,
  setHtmdElementsLogSink,
} from '@htmdjs/elements';
export type {
  ChatMessageAuthor,
  ChatMessageStatus,
  ChoiceDetail,
  ChoiceSelectDetail,
  HtmdElementsLogSink,
  RefineDetail,
} from '@htmdjs/elements';

export {
  DocDoneEvent,
  DocOpenEvent,
  HtmdErrorEvent,
  parseWireEvent,
  parseWireEventJson,
  RegionDoneEvent,
  RegionEvent,
  RegionId,
  RegionReplaceEvent,
  safeParseWireEvent,
  StreamEvent,
  WireEvent,
} from '@htmdjs/wire';

export {
  applySafeAttrs,
  materializeInto,
  RegionTreeRenderer,
  RendererEvents,
  renderHtmdSource,
  renderMarkdown,
} from '@htmdjs/renderer';
export type {
  DocDoneDetail,
  DocOpenDetail,
  RegionCreatedDetail,
  RegionDoneDetail,
  RegionReplacedDetail,
  RegionUpdatedDetail,
  RendererErrorDetail,
} from '@htmdjs/renderer';
