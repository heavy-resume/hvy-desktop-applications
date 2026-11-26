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
    const code = caught && typeof caught === 'object' && typeof (caught as { code?: unknown }).code === 'string'
      ? (caught as { code: string }).code
      : null;
    const payload = {
      jobId,
      status: 'failed',
      error: caught instanceof Error ? caught.message : String(caught),
      ...(code ? { code } : {}),
    };
    (callbacks.onError ?? callbacks.onComplete)(payload);
  });
  return { jobId, status: 'queued' };
}
