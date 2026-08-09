export type WebCapabilityScriptCallback = (result: Record<string, unknown>) => unknown;

export interface WebCapabilityScriptCallbacks {
  onComplete: WebCapabilityScriptCallback;
  onError: WebCapabilityScriptCallback | null;
}

export function queueWebCapabilityScriptOperation(
  operation: () => Promise<unknown>,
  callbacks: WebCapabilityScriptCallbacks,
): { jobId: string; status: 'queued' } {
  const jobId = crypto.randomUUID();
  void operation().then((result) => {
    callbacks.onComplete({ jobId, status: 'completed', result });
  }).catch((caught: unknown) => {
    const payload = {
      jobId,
      status: 'failed',
      error: caught instanceof Error ? caught.message : String(caught),
    };
    (callbacks.onError ?? callbacks.onComplete)(payload);
  });
  return { jobId, status: 'queued' };
}
