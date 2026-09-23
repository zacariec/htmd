/**
 * `htmd` — meta package. One install, one import, everything wired.
 *
 * This entry is SSR-safe: no DOM access at module load. Consumers targeting a
 * browser (or the `htmd` browser condition) get `./index.browser.js`, which
 * calls `registerHtmdElements()` for you.
 */

export {
  DEFAULT_RAW_TEXT_TAGS,
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
  authorizeComponentUrl,
  baseCatalog,
  baseContracts,
  chatMessageContract,
  ChoiceDetail,
  choiceGroupContract,
  choiceItemContract,
  codeBlockContract,
  ComponentCatalog,
  ComponentEvents,
  ContractDiagnosticCode,
  createHost,
  dataTableContract,
  defaultHost,
  filePreviewContract,
  FragmentNode,
  FragmentState,
  HOST_REQUEST_EVENT,
  htmdFragmentContract,
  imageCardContract,
  MAX_TABLE_ROWS,
  originRegion,
  provideHtmdHost,
  RefineDetail,
  refinePromptContract,
  requestHtmdHost,
  resolveChildren,
  resolveComponent,
  revokeHtmdHost,
  sameOriginMediaPolicy,
  sanitizeUrl,
  TableBatch,
  TablePayload,
  validateNodes,
  VERSION_ATTRIBUTE,
} from '@htmdjs/contracts';
export type {
  AttributeContract,
  AttributeOwnership,
  ChildrenContract,
  ComponentContract,
  ComponentEffect,
  ComponentResolution,
  ContractDiagnostic,
  ContractIssue,
  DataLoader,
  DataRequest,
  EventContract,
  HtmdDiagnostic,
  HtmdHost,
  HtmdHostOptions,
  PartialPolicy,
  ResolveOptions,
  UrlPurpose,
  UrlRequest,
} from '@htmdjs/contracts';

export {
  ChatMessage,
  ChoiceGroup,
  ChoiceItem,
  CodeBlock,
  DataTable,
  defineOnce,
  FilePreview,
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
  DataTableState,
  HtmdElementsLogSink,
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
  SCHEMA_VERSION,
  safeParseWireEvent,
  StreamEvent,
  streamText,
  WireEvent,
  WireWriter,
} from '@htmdjs/wire';
export type { StreamTextOptions, WireErrorOptions, WireRegionOptions } from '@htmdjs/wire';

export {
  applySafeAttrs,
  DEFAULT_RENDER_LIMITS,
  materializeInto,
  RegionTreeRenderer,
  RendererEvents,
  renderHtmdSource,
  renderMarkdown,
} from '@htmdjs/renderer';
export type {
  DocDoneDetail,
  DocOpenDetail,
  MaterializeOptions,
  RegionCreatedDetail,
  RegionDoneDetail,
  RegionReplacedDetail,
  RegionTreeRendererOptions,
  RegionUpdatedDetail,
  RenderLimits,
  RenderResult,
  RendererErrorDetail,
} from '@htmdjs/renderer';
