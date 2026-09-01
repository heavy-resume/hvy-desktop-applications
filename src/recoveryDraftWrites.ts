export class RecoveryDraftWrites {
  private readonly active = new Set<Promise<unknown>>();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const write = operation();
    this.active.add(write);
    try {
      return await write;
    } finally {
      this.active.delete(write);
    }
  }

  async settle(): Promise<void> {
    await Promise.allSettled([...this.active]);
  }
}
