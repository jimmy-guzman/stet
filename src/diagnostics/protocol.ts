/**
 * LSP wire types for diagnostics and the mapping onto sideye's domain `Diagnostic` shape. Pure: the
 * caller relativizes the absolute path later (via `stateForResolvedChecker`), mirroring how the tsc
 * parser emits absolute paths today.
 */
import { fileURLToPath } from "node:url";

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  /** 1 Error, 2 Warning, 3 Information, 4 Hint; omitted means the client decides. */
  severity?: number;
  message: string;
  source?: string;
  code?: number | string;
}

export interface MappedDiagnostic {
  path: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
}

function mapSeverity(severity: number | undefined): "error" | "warning" | "info" {
  if (severity === 2) {
    return "warning";
  }
  if (severity === 3 || severity === 4) {
    return "info";
  }
  // Error (1) and an omitted severity both surface as an error.
  return "error";
}

export function mapLspDiagnostic(diagnostic: LspDiagnostic, uri: string): MappedDiagnostic {
  return {
    line: diagnostic.range.start.line + 1,
    message: diagnostic.message,
    path: fileURLToPath(uri),
    severity: mapSeverity(diagnostic.severity),
    source: diagnostic.source,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Narrows an item from a diagnostic report to the fields the mapping reads. */
export function isLspDiagnostic(value: unknown): value is LspDiagnostic {
  if (!isObject(value) || typeof value.message !== "string" || !isObject(value.range)) {
    return false;
  }
  return isObject(value.range.start) && typeof value.range.start.line === "number";
}
