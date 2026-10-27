export interface TmuxRecoveryCandidateInput {
  managedByVeymux: boolean;
  sourceFrontendSessionId: string | null;
  guiDetachedAt: number | null;
  boundFrontendSessionId: string | null;
}

/**
 * A recovery entry is a Veymux GUI session whose frontend record vanished
 * while its tmux process survived. Plain tmux sessions, CLI-created detached
 * sessions, and sessions the user explicitly detached are not recoverable.
 */
export function isTmuxRecoveryCandidate({
  managedByVeymux,
  sourceFrontendSessionId,
  guiDetachedAt,
  boundFrontendSessionId,
}: TmuxRecoveryCandidateInput): boolean {
  return managedByVeymux
    && sourceFrontendSessionId !== null
    && guiDetachedAt === null
    && boundFrontendSessionId === null;
}
