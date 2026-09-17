type DiskVersion = { hash: string; stamp?: string; pending?: boolean };

async function fingerprint(bytes: Uint8Array | number[]): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class DocumentFileChanges {
  private versions = new Map<string, DiskVersion>();

  async remember(path: string, bytes: Uint8Array | number[], replace = true): Promise<void> {
    if (!path || (!replace && this.versions.has(path))) return;
    const version = { hash: await fingerprint(bytes) };
    this.versions.set(path, version);
  }

  relocate(previousPath: string, path: string): void {
    const version = this.versions.get(previousPath);
    if (version && path !== previousPath) {
      this.versions.delete(previousPath);
      this.versions.set(path, { ...version, stamp: undefined });
    }
  }

  dismiss(path: string): void {
    const version = this.versions.get(path);
    if (version) version.pending = false;
  }

  async check(path: string, readStamp: () => Promise<string>, readBytes: () => Promise<Uint8Array>): Promise<boolean> {
    const version = this.versions.get(path);
    if (!version) return false;
    const stamp = await readStamp();
    if (stamp === version.stamp) return version.pending === true;
    const hash = await fingerprint(await readBytes());
    // A save may finish while the disk read is in flight.
    if (this.versions.get(path) !== version) return false;
    version.stamp = stamp;
    if (hash === version.hash) return version.pending === true;
    version.hash = hash;
    version.pending = true;
    return true;
  }
}

export const documentFileChanges = new DocumentFileChanges();
