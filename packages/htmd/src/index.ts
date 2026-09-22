/**
 * `htmd` — meta package. One install, one import, everything wired.
 *
 * This entry is SSR-safe: no DOM access at module load. Consumers targeting a
 * browser (or the `htmd` browser condition) get `./index.browser.js`, which
 * calls `registerHtmdElements()` for you.
 */

export {
  DiagnosticCode,
  DiagnosticSeverity,
  isCustomElementTag,
  Parser,
} from '@zacariec/htmd-parser';
export type {
  Diagnostic,
  ElementBlock,
  HtmdDocument,
  HtmdNode,
  MarkdownBlock,
  ParseOptions,
  ParseResult,
} from '@zacariec/htmd-parser';

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
} from '@zacariec/htmd-elements';
export type {
  ChatMessageAuthor,
  ChatMessageStatus,
  ChoiceDetail,
  ChoiceSelectDetail,
  HtmdElementsLogSink,
  RefineDetail,
} from '@zacariec/htmd-elements';

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
} from '@zacariec/htmd-wire';

export {
  applySafeAttrs,
  materializeInto,
  RegionTreeRenderer,
  RendererEvents,
  renderHtmdSource,
  renderMarkdown,
} from '@zacariec/htmd-renderer';
export type {
  DocDoneDetail,
  DocOpenDetail,
  RegionCreatedDetail,
  RegionDoneDetail,
  RegionReplacedDetail,
  RegionUpdatedDetail,
  RendererErrorDetail,
} from '@zacariec/htmd-renderer';
