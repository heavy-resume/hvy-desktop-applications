const profileQueues = new Map<string, Promise<unknown>>();

export function enqueueWebCapabilityForProfile<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const previous = profileQueues.get(profileId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  profileQueues.set(profileId, current);
  void current.finally(() => {
    if (profileQueues.get(profileId) === current) profileQueues.delete(profileId);
  }).catch(() => undefined);
  return current;
}
