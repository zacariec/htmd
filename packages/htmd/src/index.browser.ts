/**
 * `htmd` browser entry — same public surface as `./index.js` and eagerly
 * registers the base custom elements. Bundlers must not tree-shake this file
 * (see the `sideEffects` allowlist in `package.json`).
 */
import { registerHtmdElements } from '@htmdjs/elements';

registerHtmdElements();

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
  captureInteractionState,
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
  InteractionSnapshot,
  InteractionValue,
  isStatefulComponent,
  MAX_TABLE_ROWS,
  modelInstructions,
  originRegion,
  provideHtmdHost,
  RefineDetail,
  refinePromptContract,
  requestHtmdHost,
  resolveChildren,
  resolveComponent,
  restoreInteractionState,
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
  ModelInstructionsOptions,
  PartialPolicy,
  ResolveOptions,
  StatefulComponent,
  UrlPurpose,
  UrlRequest,
} from '@htmdjs/contracts';

export {
  ChatMessage,
  ChoiceGroup,
  ChoiceItem,
  CodeBlock,
  completeRefine,
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
  CompleteRefineOptions,
  DataTableState,
  HtmdElementsLogSink,
} from '@htmdjs/elements';

export {
  DocDoneEvent,
  DocOpenEvent,
  HtmdErrorEvent,
  parseWireEvent,
  parseWireEventJson,
  readWireEvents,
  RegionDoneEvent,
  RegionEvent,
  RegionId,
  RegionReplaceEvent,
  SCHEMA_VERSION,
  safeParseWireEvent,
  StreamEvent,
  streamText,
  toEventStream,
  WIRE_EVENT_STREAM_HEADERS,
  WireEvent,
  WireWriter,
} from '@htmdjs/wire';
export type {
  ReadWireEventsOptions,
  StreamTextOptions,
  ToEventStreamOptions,
  WireErrorOptions,
  WireRegionOptions,
} from '@htmdjs/wire';

export {
  applySafeAttrs,
  DEFAULT_RENDER_LIMITS,
  materializeInto,
  RegionTreeRenderer,
  RendererEvents,
  renderHtmdSource,
  renderHtmdToString,
  renderMarkdown,
} from '@htmdjs/renderer';
export type {
  DocDoneDetail,
  DocOpenDetail,
  HtmdStringRender,
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
