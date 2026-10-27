export class TodoError extends Error {
  constructor(message: string, readonly status = 400, readonly currentRevision?: number, readonly code?: string, readonly activeRunId?: string) { super(message); }
}
