---
'@htmdjs/core': minor
'@htmdjs/parser': minor
'@htmdjs/elements': minor
'@htmdjs/wire': minor
'@htmdjs/renderer': minor
'@htmdjs/react': minor
---

Initial organization alpha (`0.1.0-alpha.1`). Install `@htmdjs/core@alpha`; the unscoped npm package `htmd` is unrelated. The earlier `v0.1.0-alpha.0` source tag was not published to npm.

- Stream-aware parsing with explicit pending state, buffered incomplete custom-element tags, progressive open-element children, and finalization diagnostics without dropping source text.
- Code-literal handling for backtick/tilde fences, inline code, escaped delimiters, and fragment closing-tag boundaries. Standard Markdown remains provisional; no speculative link destinations or delimiters are added.
- State-preserving DOM reconciliation: streamed appends retain selected choices, focused refinement drafts, loaded table data, and unchanged component instances. Unchanged blocks skip redundant rendering.
- Explicit region completion/reopening, document completion, fatal-error termination, supported-version checks, and accepted-sequence replay. Rejected events do not consume sequence numbers.
- Region replacement and ancestor sealing follow actual parentage, including explicit parents with unrelated ID prefixes; parent cycles are rejected.
- React stream status follows protocol completion, including SSE. Truncated sources report interruption; cancellation and source replacement stop late events without closing caller-owned EventSource connections.
- Bench backfill: decode attribute entities exactly once, diagnose encoded unsafe schemes, and preserve decoded values through parser/materializer round-trips. Includes the corresponding regression coverage.
- All six public packages use the `@htmdjs` scope and default to the `alpha` dist-tag. Updated model instructions, lifecycle/security documentation, and an interactive partial-stream playground example.

Limitations: affected region buffers are still reparsed; reconciliation is positional, not keyed movement. Automatic reconnect, persistent event logs, historical external-data snapshots, and Bench-specific editor/import policies are host responsibilities.
