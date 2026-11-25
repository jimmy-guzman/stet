export interface CopyReferencePayload {
  path: string;
  line?: number;
  /** The last line of a range; a range of one line reads as that line. */
  endLine?: number;
}

export const formatCopyReference = (payload: CopyReferencePayload) => {
  if (payload.line === undefined) {
    return payload.path;
  }

  if (payload.endLine === undefined || payload.endLine === payload.line) {
    return `${payload.path}:${payload.line}`;
  }

  return `${payload.path}:${payload.line}-${payload.endLine}`;
};
