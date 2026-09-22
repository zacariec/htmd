/**
 * Internal logger for `@htmdjs/elements`.
 *
 * Console-backed by default; consumers can swap the sink (test harnesses,
 * production log pipelines) via `setHtmdElementsLogSink`.
 */

export interface HtmdElementsLogSink {
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

const consoleSink: HtmdElementsLogSink = {
  warn(message: string, detail?: unknown): void {
    if (detail === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, detail);
  },
  error(message: string, detail?: unknown): void {
    if (detail === undefined) {
      console.error(message);
      return;
    }
    console.error(message, detail);
  },
};

export class HtmdElementsLogger {
  private static instance: HtmdElementsLogger | undefined;

  private sink: HtmdElementsLogSink = consoleSink;

  private constructor() {}

  public static getInstance(): HtmdElementsLogger {
    if (HtmdElementsLogger.instance === undefined) {
      HtmdElementsLogger.instance = new HtmdElementsLogger();
    }
    return HtmdElementsLogger.instance;
  }

  public setSink(sink: HtmdElementsLogSink): void {
    this.sink = sink;
  }

  public warn(message: string, detail?: unknown): void {
    this.sink.warn(`[htmd/elements] ${message}`, detail);
  }

  public error(message: string, detail?: unknown): void {
    this.sink.error(`[htmd/elements] ${message}`, detail);
  }
}

export function setHtmdElementsLogSink(sink: HtmdElementsLogSink): void {
  HtmdElementsLogger.getInstance().setSink(sink);
}
