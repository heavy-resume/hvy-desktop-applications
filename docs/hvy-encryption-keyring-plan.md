# HVY Encryption Keyring Implementation

## Status and scope

The Heavy File Format encryption implementation is present, and HVY Galaxy now implements the first production key-host slice. Heavy supplies Fernet encryption, UUID key IDs, whole-document envelopes, encrypted component attachments, async encryption-aware serialization, key rotation, and opt-in component controls. Galaxy now discovers referenced key IDs, loads only those keys into a session keyring, uses encryption-aware open/save/mount paths, persists generated keys, enables component encryption controls, and imports or exports portable `.hvykey` files through explicit dialogs.

This plan records the implementation boundary and develops phase 1: a shared Galaxy document-key service for the Electron and Tauri hosts on macOS and Windows. Linux is discussed as a future target because the current release scripts build macOS and Windows hosts, and the current Tauri keyring features do not configure a production Linux credential store.

## Existing implementation

Heavy File Format already provides:

- Fernet key generation, authenticated encryption, decryption, and UUID key identifiers.
- Whole-document encrypted envelopes.
- Per-component encryption using opaque attachments.
- Async deserialization and serialization that accept a host-supplied keyring.
- `onKeyGenerated` and `onKeyRemoved` host callbacks.
- Component controls for generating a key, changing a key, and removing encryption. These controls are disabled unless the host opts in.
- A reference-only keyring stored in the current tab's `sessionStorage`.

Galaxy already provides:

- Async mounted-document save paths.
- Revision projection that excludes decrypted encrypted-component runtime state.
- A policy that does not create local document history for whole-document-encrypted documents.
- OS-protected secret-storage building blocks for the integration vault: Electron `safeStorage`, Tauri's `keyring` crate, AES-256-GCM vault encryption, and atomic file writes.

The integration vault is an architectural precedent, not a document-key store. Its service names, master key, file, reset behavior, and lifecycle must remain separate from the document keyring.

## Implemented in phase 1

1. A dedicated AES-256-GCM document-key vault with an OS-protected wrapping key in both Electron and Tauri.
2. Narrow shared commands to store keys and load exact requested IDs without renderer-side vault enumeration.
3. Encryption-aware async deserialization, standalone serialization, mounted serialization, and Heavy mounts.
4. A serialized generated-key persistence queue that every Galaxy save path flushes before writing document bytes.
5. Heavy's component encryption controls, backed by the Galaxy keyring.
6. File-menu entries in both hosts, an explicit key-file review modal, a key manager, and plaintext `.hvykey` import/export.
7. Validation for UUIDs, Fernet key length, format version, file size, duplicate IDs, and conflicting key material, plus display fingerprints.
8. Whole-document encryption and removal commands in both hosts, with explicit Galaxy confirmation modals and dirty/save integration.
9. A metadata-only vault listing for the key manager, including persisted key counts, labels, origin, creation dates, and explicit per-key export without bulk secret loading.
10. Encrypted-folder discovery: both native scanners surface `.hvy-folder` ciphertext, and the shared renderer resolves logical names with exact-ID key loading while containing missing, invalid, and incomplete folders.
11. Empty encrypted-folder creation from workspace actions and folder context menus. Galaxy persists the generated folder key before either native host atomically publishes the opaque folder directory and encrypted manifest.
12. New HVY documents can be created inside unlocked encrypted folders. Galaxy encrypts the document with the folder key, assigns an opaque physical ID, and commits the document before an optimistic, expected-version manifest update in both native hosts.
13. Distinct vault diagnostics for ready, first-run empty, unavailable OS storage, denied/locked OS storage, incomplete key/file pairs, corrupt vaults, and a requested key ID that is absent from a healthy vault.
14. Restart-persistence tests for both native vault implementations. The Electron test reopens the encrypted vault and uses its recovered Fernet key to decrypt document data; the Tauri test independently reopens its encrypted vault file and verifies the recovered key.
15. An encrypted-document plaintext policy enforced across AI, embedding sidecars, hot-reload state, recovery drafts, history, and PDF export.
16. Optional bundle-level labels in `.hvykey` files, retained as non-secret per-key provenance metadata. Re-importing identical material merges bundle labels; conflicting material for an existing ID remains a hard error.
17. Explicit **Remove from This Device** behavior in the key manager. It is blocked while an open document references the key, removes both the native-vault and session copies, and clearly states that it is not revocation.
18. Nested encrypted-folder creation using the parent folder key. Galaxy stages the opaque child directory and its encrypted manifest before a compare-and-swap parent-manifest update, and removes the child if the parent changed or the manifest commit fails.
19. Logical rename for encrypted-folder documents. Rename updates only the authenticated parent manifest, keeps the opaque physical ID and path stable, rejects duplicate logical names, and uses expected manifest bytes to detect concurrent changes.
20. Logical rename for root and nested encrypted folders through an explicit Galaxy modal. Root names update their own encrypted manifest; nested names update the authoritative parent entry. Physical directory IDs remain unchanged and stale writes are rejected.
21. Encrypted-folder import through the existing import experience, file picker, and drag/drop. Existing encrypted documents are authenticated and rewrapped with the destination folder key; source logical names never become physical paths.
22. Encrypted-document archive/restore using the existing workspace experience, plus permanent document and nested-folder deletion. Destructive native mutations stage the opaque entry, compare-and-swap the encrypted manifest, and restore the staged entry if the manifest changed or could not be written. Workspace scanning also restores a deletion staging entry left by process interruption; if the manifest had already committed, the restored orphan is surfaced as an integrity condition rather than silently discarded.
23. Document moves into and across encrypted folders rewrap the document with the destination key. Moves out preserve whole-document encryption. The destination is durably published before the source is removed, so an interrupted cross-folder move can leave a duplicate but does not discard the only copy.
24. Startup key access on macOS/Tauri is non-interactive. Galaxy silently restores encrypted folders and recent or homepage documents only when Keychain already authorizes access; otherwise they remain locked until an explicit open. A successful wrapping-key read is cached in process memory so one user-approved access serves the rest of the application session.

## Remaining product work

1. Add staged conversion of an already-populated plaintext folder into an encrypted folder and whole-tree key rotation. These are administrative migrations rather than ordinary content mutations and require resumable journals plus explicit recovery UX.
2. Add packaged-host integration coverage for real OS-store denial/lock prompts, save/recovery, rotation, and bundle updates. Unit tests cover native encrypted-vault restart; OS credential UI behavior still requires per-platform integration runs.
3. Promote `.hvykey` into a normative companion specification if interoperability with non-Galaxy clients is required.

## Phase 1: shared document-key service

### Native storage recommendation

Use an encrypted vault with one OS-protected wrapping key:

```text
Heavy key ID in the HVY file
          |
          v
Galaxy renderer keyring (keys needed by open documents only)
          |
          v
Narrow async desktop API
          |
          v
AES-256-GCM document-key vault in the app data directory
          |
          v
One random 256-bit wrapping key protected by the OS credential system
```

The OS store should contain only the random wrapping key. The encrypted vault file should contain the UUID-to-Fernet-key records. This is preferable to one OS credential per HVY key because it:

- Avoids credential-store enumeration differences.
- Avoids creating a large number of user-visible Keychain or Credential Manager entries.
- Keeps well below Windows Credential Manager's 2,560-byte generic credential blob limit.
- Gives Electron and Tauri the same versioned vault schema and encryption behavior.
- Makes atomic updates, metadata changes, migrations, and integrity validation explicit.
- Reuses the integration vault's AES-GCM and atomic-write approach without coupling the two vaults.

This native-storage design provides automatic local unlock. It is not equivalent to a password manager's independent vault password. Whether automatic local unlock is sufficient is a product security decision described under **Unlock policy decision** below.

The vault should be distinct and versioned:

```ts
interface DocumentKeyVaultV1 {
  version: 1;
  keys: Record<string, {
    key: string;
    createdAt: string;
    source: 'generated' | 'imported';
    label?: string;
    bundleLabels?: string[];
  }>;
}
```

The complete JSON payload, including metadata and key IDs, should be encrypted. The on-disk envelope should contain only its version, algorithm, nonce, and ciphertext. Use a document-key-specific AAD value such as `hvy-galaxy-document-key-vault-v1` so ciphertext cannot be substituted between Galaxy vault types.

### Shared frontend contract

The renderer needs key material because Heavy performs Web Crypto operations there and displays decrypted content there. It should receive only keys requested for the documents being opened, rather than the complete persisted keyring.

```ts
interface DocumentKeyService {
  status(): Promise<DocumentKeyServiceStatus>;
  load(keyIds: string[]): Promise<Record<string, string>>;
  listMetadata(): Promise<Array<{ keyId: string; createdAt: string; source: 'generated' | 'imported'; label?: string }>>;
  store(entries: Array<{ keyId: string; key: string; source: 'generated' | 'imported' }>): Promise<void>;
}
```

The shared frontend implementation belongs in `src/backend.ts` and must use the existing `invokeDesktop` boundary. Electron and Tauri must expose the same commands and response shapes. The metadata listing must never include key material. Key values must not appear in settings, logs, debug timings, errors, menus, recent-file state, or document metadata.

`load` should accept exact key IDs. A whole-document envelope exposes its key ID in the envelope header, while component key IDs are present in encrypted component directives. Galaxy can therefore discover required IDs before mounting without asking the backend to enumerate or return every secret.

The in-memory keyring should live at the Galaxy application/session layer, not inside one mount. Open documents, inactive tabs, recovery serialization, and background operations must share the same loaded key objects. It should be cleared when the application exits; normal document close does not need to delete persisted keys.

### Persistence ordering

Generated keys must be durably stored before Galaxy reports that encryption succeeded or permits the encrypted document to be saved. The current Heavy callbacks return `void`, while both desktop command boundaries are asynchronous. Updating the renderer keyring immediately and scheduling a backend write creates a crash window in which the document can reference a key that never reached durable storage.

The preferred solution is to make Heavy's generated/removed key callbacks awaitable and await them from component and document encryption operations. If that contract cannot change, Galaxy needs one explicit persistence queue and every save, recovery write, tab handoff, and successful-encryption status must await its flush. The awaitable callback is the simpler invariant.

Key-service writes must also be serialized in the native host so two renderer requests cannot read, modify, and overwrite the vault out of order. Write the new encrypted envelope atomically before acknowledging the operation.

### Key lifecycle semantics

The reference app deletes a key from `sessionStorage` when Heavy invokes `onKeyRemoved`. A production global keyring cannot interpret that event as permission to destroy the persisted key:

- A rotated component's old key may still be required by a recovery draft or external copy of the document.
- The same key ID may have been deliberately imported for more than one file.
- Saved versions and backups may outlive the active component.

For phase 1, `onKeyRemoved` should remove the key from the active mount's working keyring only. The secure vault should retain it. Permanent deletion should be a later explicit user operation backed by a key-usage/recovery policy; it must not be an automatic side effect of removing or rotating encryption in one document.

Storing an existing key ID with different key material is an error. Re-storing the same key ID and identical key is idempotent.

### Native-host layout

Use dedicated identifiers, separate from the integration vault:

- Service: `com.heavyresume.hvy-galaxy.document-keys`
- Account: `vault-wrapping-key-v1`
- Vault file: `document-key-vault-v1.json`
- AAD: `hvy-galaxy-document-key-vault-v1`

Electron stores a `safeStorage`-encrypted wrapping-key blob in the app data directory and uses the decrypted wrapping key to read the AES-GCM vault. Electron's `safeStorage` encrypt/decrypt calls are synchronous, so vault commands run in the main process and should remain small; the renderer contract remains asynchronous. Tauri stores the wrapping key as a binary secret in a `keyring::Entry` and uses it to read the same AES-GCM vault shape.

Electron and Tauri currently have different native storage mechanisms and may use different app data locations. Sharing keys between an Electron installation and a Tauri installation on the same computer is not automatic. If both distributions are expected to coexist as one product identity, phase 1 must also standardize the app-data location and provide a one-time host migration. Otherwise, cross-host movement should use the later explicit key export/import workflow.

## Encrypted folders

Encrypted folders are a Galaxy filesystem feature built on the same keyring. They provide application-level encryption for both document contents and the logical names of files and subfolders. This is separate from operating-system full-disk or folder encryption: outside Galaxy, the directory remains visible but its meaningful names and document contents do not.

An encrypted folder uses one Fernet key ID for the folder tree. That key is provisioned through the same local vault and `.hvykey` workflows as document keys. Galaxy uses it for:

- Every encrypted name manifest in the folder tree.
- Every HVY document stored within the encrypted folder.
- New documents created in the folder and existing documents moved into it.
- Renames and hierarchy changes recorded in encrypted folder metadata.

### Filesystem representation

Physical filesystem names are opaque, stable ID codes rather than logical names. Encrypted directory names use the explicit `hvy-encrypted-folder-` label so a person viewing a synced workspace can recognize them as app-managed encrypted storage rather than unexplained UUID folders. The full UUID remains in the physical name to preserve globally unique identity; Galaxy shows only a short ID when the logical name cannot be decrypted. Existing UUID-only directories remain supported. A representative directory could look like:

```text
hvy-encrypted-folder-0195cbb8-52da-7e44-8db2-13007ec38a8f/
  .hvy-folder
  0195cbb8-5c2d-7d4d-a274-6bf833dbcf13.hvy
  0195cbb8-6ee0-72d6-b558-647420ca1e55.hvy
  hvy-encrypted-folder-0195cbb8-72c4-7917-b132-0aeea9e917f4/
    .hvy-folder
    0195cbb8-79df-747d-8a24-05964d28bc12.hvy
```

The ID is an opaque entry identity, not a hash of the original name. Renaming an item therefore updates encrypted metadata without renaming the physical entry. A fixed suffix may identify the storage kind needed by Galaxy, but the original extension and logical name belong in encrypted metadata.

Each `.hvy-folder` file has a small plaintext envelope containing only format/version information, the folder key ID, and encrypted payload bytes. Its decrypted manifest maps each direct child ID to its logical metadata:

```ts
interface EncryptedFolderManifestV1 {
  version: 1;
  name: string;
  aiAllowed?: boolean;
  entries: Record<string, {
    name: string;
    kind: 'document' | 'folder';
    documentExtension?: '.hvy' | '.thvy' | '.phvy';
    aiAllowed?: boolean;
  }>;
}
```

The implemented format primitive uses AES-256-GCM for the manifest, with the decoded 32-byte Fernet folder key as the AES key. Documents continue to use Fernet. This keeps one distributed key while giving the structured manifest an authenticated binary envelope with a random 96-bit nonce. The envelope identifies `AES-256-GCM` explicitly so the algorithm is not inferred from the key type.

Keeping one encrypted manifest per physical directory allows directory operations to stay local and avoids a single root manifest becoming a synchronization bottleneck. Manifest ciphertext must be authenticated and bound to its folder identity with AAD so one directory's manifest cannot be substituted into another directory.

The filesystem continues to reveal approximate item counts, directory shape, modification timing, file sizes, fixed storage suffixes, and that Galaxy encrypted-folder metadata exists. It does not hide these properties and should not be described as an oblivious filesystem.

### Document behavior

Opening an encrypted folder first loads its exact folder key ID from the local vault, then decrypts the manifest and presents logical names in Galaxy. Filesystem paths, recent-file labels, tabs, search results, and workspace navigation should use logical names in the UI while native reads and writes use opaque physical paths.

Keys loaded while resolving a workspace populate the same renderer-session keyring used by encrypted document creation and folder mutations. Unlocking a folder therefore makes its key immediately available to those operations without a second vault read or prompt.

Every document in the folder is whole-document encrypted with the folder key. Galaxy assigns the folder key ID when a document is created or moved into the folder and uses encryption-aware serialization for every normal save, recovery write, version, and temporary replacement file. Per-component encryption may still use separate keys inside the whole-document envelope.

The existing provisioning model applies when the folder key is unavailable. Galaxy cannot resolve the logical names, so it shows the folder as locked using the existing error/status surface; it does not prompt for a key during navigation. After the key bundle is imported, reopening or refreshing the workspace loads the folder normally.

### Operations and consistency

Folder operations need transaction semantics across the manifest and physical entries:

- Creating an entry writes its encrypted document or child manifest before publishing the name mapping.
- Creating or renaming a sibling uses one case-insensitive logical namespace across plaintext files, plaintext folders, and encrypted folders, even though their physical paths differ.
- Renaming changes only the authenticated manifest entry.
- Deleting removes the manifest mapping and then follows the existing recoverable file-deletion behavior for the opaque entry.
- Moving within the same encrypted tree preserves the entry ID where possible and atomically updates the affected manifests.
- Moving into an encrypted folder assigns an opaque ID and encrypts the document with the folder key before the destination manifest exposes it.
- Moving out preserves whole-document encryption. Removing that encryption remains a separate explicit action using the existing plaintext-warning modal.
- Cross-folder moves publish and verify the destination before removing the source. A failure after destination publication leaves both copies for recovery rather than risking data loss.
- Unknown physical entries and manifest entries with missing files are integrity/recovery conditions, not automatically discarded data.

Enabling encryption on an existing populated folder requires a staged migration rather than in-place best-effort renaming. Galaxy should prepare encrypted copies and manifests, verify them, atomically publish the encrypted representation, and retain a recoverable rollback point until completion. Interrupted migrations must resume or roll back without mixing logical plaintext names with partially encrypted contents.

### Key reuse, rotation, and limits

Using one key for names and documents gives the folder a simple distribution unit and guarantees that possessing the folder key is sufficient to browse and open the tree. It also creates one security boundary: disclosure of that key exposes every name and document protected by it.

Rotation therefore affects the whole tree. A rotation operation must create a new key, re-encrypt every folder manifest and document, tolerate interruption, and keep the old key available until no recovery draft, saved version, or incomplete migration still references it. Removing one document from the folder does not revoke access to copies previously encrypted with the shared folder key.

Plaintext logical names must not leak into unencrypted sidecars, thumbnails, search indexes, recovery filenames, debug logs, recent-file persistence, or temporary filenames. Search and AI behavior must follow the same unlocked-plaintext policy as individually encrypted documents.

Open design decisions before implementation include moving items out of encrypted folders, nested folders with independent keys, non-HVY attachments, conflict resolution for cloud-synchronized manifests, encrypted-folder backup/export, and whether folder-key rotation includes historical versions.

## Platform behavior and limitations

### macOS

Electron `safeStorage` protects its encryption key with macOS Keychain. Tauri's `apple-native` keyring feature maps entries to generic Keychain credentials. Both are appropriate for protecting one small wrapping key.

Considerations:

- Stable code signing, team identity, bundle identity, and Keychain service/account identifiers matter across updates. Electron documents that inconsistent signing can cause repeated Keychain permission prompts.
- Keychain access can block or display an OS prompt. The key-service API must remain asynchronous and the Galaxy UI must tolerate a pending unlock.
- Startup uses a non-interactive Keychain read. If macOS reports that interaction is required, Galaxy leaves encrypted content locked and performs the normal interactive read only after an explicit open.
- A local Keychain item is not a cross-device recovery mechanism. iCloud synchronization should not be assumed or silently enabled.
- Reinstalling an application and deleting its app-data vault are different operations from deleting its Keychain item. Reset/uninstall behavior must treat the wrapping key and vault as one pair.
- Keychain protection is at rest. Once loaded, Fernet keys and decrypted document content exist in Galaxy process memory.

Primary references:

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services)
- [Apple generic password items](https://developer.apple.com/documentation/security/ksecclassgenericpassword)

### Windows

Electron `safeStorage` uses DPAPI. Tauri's `windows-native` keyring feature uses Windows Credential Manager. Both are suitable for a single wrapping key, but they do not have identical security or migration formats.

Considerations:

- Electron describes DPAPI protection as same-user protection, not isolation from other applications running as that user. Malware or another compromised same-user process remains outside the protection boundary.
- DPAPI data is normally tied to the Windows user and machine. It is not a dependable cross-machine backup, and an out-of-band password reset can make protected data unrecoverable.
- Windows generic credentials have a 2,560-byte blob limit. Storing only the 32-byte wrapping key avoids this constraint; storing the entire document keyring in one credential would not.
- Credential persistence and enterprise roaming can vary with Windows account and policy. Galaxy should promise local availability, not roaming.
- Electron-safeStorage ciphertext and a Tauri Credential Manager entry are not mutually readable. Cross-host migration must be intentional.

Primary references:

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Microsoft DPAPI](https://learn.microsoft.com/en-us/windows/win32/seccrypto/example-c-program-using-cryptprotectdata)
- [Windows generic credential limits](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)

### Linux and other Unix desktops

Linux is not currently part of the host build scripts, and it should not be declared supported for document-key persistence yet.

Electron can use GNOME libsecret, KWallet, or other desktop secret stores. Its synchronous API may fall back to the `basic_text` backend when no secret store exists; that fallback uses a hard-coded plaintext password and is not acceptable for document keys. Galaxy must explicitly reject `basic_text`, not merely rely on `isEncryptionAvailable()`.

The Tauri dependency currently enables only `apple-native` and `windows-native`. The `keyring` crate has no default platform store; on an unsupported target it uses its mock store. A Linux release therefore requires an explicit persistent Linux feature such as `linux-native-sync-persistent` or `linux-native-async-persistent`, its D-Bus/Secret Service dependencies, and tests for locked or unavailable desktop keyrings.

Linux credential services can be absent, locked, or require a prompt, especially in headless sessions, minimal window managers, remote desktops, and containers. Galaxy should report secure storage as unavailable rather than silently weaken encryption.

Primary references:

- [Electron safeStorage Linux providers and fallback](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Rust keyring platform features](https://docs.rs/keyring/3.6.3/keyring/)
- [freedesktop Secret Service API](https://specifications.freedesktop.org/secret-service-spec/latest/)

## Security and product limits

OS-backed key persistence provides local at-rest protection. It does not provide:

- Protection after Galaxy has unlocked a document and placed keys/plaintext in memory.
- Protection from a compromised Galaxy renderer or native host.
- Protection from sufficiently privileged malware, debuggers, memory dumps, or a compromised OS account.
- Cross-device recovery, collaboration, or transfer with an HVY file.
- A substitute for an explicit user-owned backup/export mechanism.

The application must distinguish these native states rather than collapse them into “missing key”:

- Vault and wrapping key both present.
- First run: neither present.
- Vault present but OS wrapping key unavailable or denied.
- Wrapping key present but vault missing.
- Vault authentication failure or unsupported version.
- Requested HVY key ID absent from a valid vault.

Only the final state means the particular document key is missing. The other states are native storage, migration, or corruption problems and should not invite the user to overwrite or reset the vault.

### Encrypted-document plaintext policy

Whole-document encryption protects the saved HVY bytes. Once opened, Galaxy necessarily holds the key and plaintext in memory. The first implementation uses this boundary:

| Experience | Policy |
| --- | --- |
| Viewer/editor/raw mode | Allowed in memory while the document is open. Heavy session persistence remains disabled, and Galaxy does not persist raw/editor recovery state for encrypted documents. |
| PDF export | Allowed only as an explicit user export. The Galaxy modal states that the resulting PDF is plaintext and not protected by HVY encryption. |
| AI and workspace chat | Blocked by default. A user may explicitly enable access for an encrypted folder or one document after a warning that decrypted content may be sent to the configured AI provider. Folder permission is inherited by encrypted descendants; a document-level setting can override it. The permission is stored inside the authenticated encrypted-folder manifest. |
| Embedding indexes | Not generated, attached, or read for encrypted documents. Existing plaintext `.emb` sidecars are removed when encryption is enabled or an encrypted file is encountered. |
| Local workspace text search | May decrypt and search in memory after the required key is loaded; results are not persisted as a plaintext index. Semantic/embedding search excludes the document. |
| Recovery drafts | Serialized document bytes retain whole-document encryption. Plaintext editor/view recovery-state JSON is omitted. |
| Saved versions/history | New history is disabled. When encryption is enabled, existing plaintext history for that path is removed and unreferenced attachment objects are pruned. |
| Previews and open tabs | Allowed in memory. Hot-reload persistence retains path/mode/layout metadata but omits plaintext recovery state. |

This policy is represented in shared frontend code so the relevant paths do not define conflicting rules independently. Encrypted-folder documents remain unavailable to AI until the encrypted manifest contains explicit consent. Enabling AI does not enable plaintext embedding sidecars, history, or plaintext recovery state.

## Key exchange and portability

Portable key exchange is an initial product requirement. Organizations should be able to distribute a key through their existing approved channel—for example a file shared in Google Drive, OneDrive, SharePoint, an encrypted email system, removable media, or an enterprise secrets workflow—and recipients should be able to add it to Galaxy.

The OS/password-protected Galaxy vault is the local key cache, not the exchange mechanism. The first implementation does not need a Google Drive or OneDrive API integration: the user downloads the key file through their normal organization-controlled workflow, then explicitly imports that local file into Galaxy. A future service can deliver the same logical key records through a different transport.

### Portable key file

Use a dedicated `.hvykey` UTF-8 JSON format with MIME type `application/vnd.hvy.key+json`. A file may contain one key or a bundle:

```json
{
  "hvy_key_file": 1,
  "label": "Finance planning bundle",
  "keys": [
    {
      "keyId": "00000000-0000-4000-8000-000000000000",
      "algorithm": "fernet",
      "key": "fernet-url-safe-base64-key",
      "label": "Finance planning documents",
      "createdAt": "2026-09-01T00:00:00.000Z"
    }
  ]
}
```

This `.hvykey` representation is a Galaxy design proposal; it is not currently defined by the HVY specification. The draft HVY specification defines Fernet key material, UUID key IDs, references from encrypted documents/components, and the host's responsibility to persist the UUID-to-key mapping. It does not define a key-file extension, media type, serialization schema, import/export workflow, protection envelope, issuer identity, or bundle semantics.

If key files are intended to work across independent HVY clients rather than only Galaxy installations, the portable format should become a normative companion section of the HVY specification. Galaxy can then implement that shared format rather than establish an application-private convention. Local vault storage and OS unlock behavior should remain host-specific and outside the document format specification.

Only `keyId`, `algorithm`, and `key` are security-relevant. The top-level bundle `label`, per-key `label`, and `createdAt` are optional user-facing metadata and must not affect key lookup. Document paths, document titles, workspace names, recipient identities, and cloud URLs should not be included by default because they leak organizational context and become stale when files move.

The key file is a bearer secret: anyone who obtains it can decrypt every encrypted document or component that uses that key ID. The file should begin with an unmistakable format field, use a dedicated extension, and be described in the UI as an encryption key rather than a document or configuration file.

### Import workflow

The initial workflow is bundle provisioning rather than document-time key acquisition. One or more `.hvykey` bundles are shared through an existing channel and imported into Galaxy before the corresponding documents are opened. Updated bundles can be imported later through the same workflow. Key acquisition is not part of the document-opening experience.

Galaxy provides two explicit entry points using the same import implementation:

1. **File → Import Encryption Key…** lets the user select one or more `.hvykey` files and shows a Galaxy review modal listing their labels, key IDs, and fingerprints before import.
2. **File → Manage Encryption Keys… → Import Key File…** provides the same operation from the key-management modal.

Missing keys use the existing non-prompting open flow in this phase:

- A missing whole-document key causes the open operation to fail with the exact required key ID and directs the user to import the matching `.hvykey` file, then reopen the document.
- A missing component key leaves Heavy's existing locked encrypted-component representation in the document.
- Galaxy does not show a key-acquisition prompt, retain a pending document, or automatically retry after import. After importing an updated bundle, the affected document is reopened normally.

Import performs these operations in order:

1. Parse the bounded JSON file and validate its version.
2. Require a supported algorithm and a valid UUID key ID.
3. Decode and validate the Fernet key length.
4. Compute a display fingerprint from the key material, such as a grouped truncated SHA-256 value.
5. Show the user which keys will be added, already exist, or conflict.
6. Unlock the local Galaxy vault if necessary.
7. Persist accepted keys before reporting success.
8. Add them to the application keyring for subsequent document opens.

Importing an identical `keyId` and key is idempotent and records any new bundle label against the stored key. Importing the same `keyId` with different key material is a conflict and never overwrites the local key. Galaxy cannot infer which value is legitimate; the import review explains that conflicting replacements are rejected and the distribution error must be resolved outside Galaxy.

Do not automatically import every `.hvykey` found in Downloads, a sync directory, or beside an HVY file. Import is a trust decision and should always be explicit. Galaxy should not retain the source path or depend on the source file after successfully copying the key into its local vault.

### Export workflow

The key-management modal provides **Export…** for keys loaded in the current session after they have been durably saved. Export uses an explicit save dialog and never places raw key material on the clipboard. A later document-encryption modal should surface the same export operation next to the affected component or whole document, and bundle selection can be added to the manager when organizations need it.

Whole-document encryption is controlled through **File → Encrypt Document…** and **File → Remove Document Encryption…**. Each command opens an explicit Galaxy modal. Enabling encryption generates and durably stores a new key before Galaxy marks the document dirty. Removing encryption retains the key for older versions and copies, preserves any separately encrypted components, and makes subsequent document and recovery serialization plaintext.

Galaxy should support two representations over time:

- **Plain `.hvykey`:** interoperable and easy to distribute through an organization's already-protected channel. The sharing system, its access controls, retention policy, and local downloaded copies protect the bearer secret.
- **Protected key package:** an optional later envelope encrypted to a passphrase or recipient public key. This is useful when the transport channel itself is not trusted, but it creates a second-secret or identity-management workflow.

The initial plaintext key file is consistent with the stated organization-managed sharing model, but the export and import modals must state that the file itself is unencrypted. Galaxy's protected local vault protects the imported copy at rest; it cannot retroactively protect the downloaded source file remaining in the user's Downloads folder or synchronized drive cache.

### Local removal

The key manager calls permanent deletion **Remove from This Device** because deletion from one Galaxy vault is not cryptographic revocation. Galaxy refuses the operation while any open document references the key; otherwise an explicit modal warns that documents, folders, copies, recovery data, and saved versions may require re-importing the key later. Confirmation deletes the native-vault record and the renderer's session copy.

Galaxy does not scan every workspace or synchronized location before removal. Such a scan could still miss offline, renamed, archived, detached, or external copies and would create a misleading claim of safety. The operation therefore remains deliberately explicit and recoverable only by re-importing another copy of the key.

### Sharing and revocation limits

File-based key exchange has deliberate offline semantics:

- Removing a recipient from a Drive or OneDrive share does not revoke a key they already downloaded or imported.
- Deleting a key from Galaxy does not revoke other copies.
- Rotating to a new key protects future ciphertext only. Anyone retaining the old key can continue decrypting old document versions and copies encrypted with it.
- A key file cannot enforce expiry, read-only access, forwarding restrictions, or recipient identity after download.
- Sharing one key across many documents enlarges the impact of disclosure. Per-document keys reduce that blast radius; named group keys make distribution simpler. Galaxy can support both because lookup is by UUID.

Organizations requiring revocation must rotate the affected document/component keys, redistribute the new key to the remaining recipients, and save new encrypted copies. Previously distributed ciphertext cannot be made unreadable after both it and its key have been copied.

Transport permission references:

- [Google Drive sharing controls and their limits](https://support.google.com/a/users/answer/13004062)
- [OneDrive and SharePoint sharing permissions](https://support.microsoft.com/en-us/office/stop-sharing-onedrive-or-sharepoint-files-or-folders-or-change-permissions-0a36470f-d7fe-40a0-bd74-0ac6c1e13323)

### Future service compatibility

A future key service should return the same logical records (`keyId`, algorithm, key material, and optional metadata) through an authenticated delivery protocol. The native vault and Heavy keyring contracts should not know whether a key arrived from `.hvykey`, an enterprise connector, device-to-device transfer, or a hosted Galaxy service.

Service-era features can add organization signatures, recipient encryption, audit trails, rotation notices, directory groups, and policy. A standalone `.hvykey` has no cryptographic issuer identity. Its displayed fingerprint helps people compare values through a second channel but does not prove who created or authorized the key.

## Unlock policy decision

### How 1Password differs

1Password's traditional account model combines an account password, which the user knows, with a random high-entropy Secret Key held by the user's devices. Those inputs derive or unlock the keys that decrypt vault data. The service does not receive either complete secret. This gives the encrypted vault protection that is independent of merely being signed in to the operating-system account.

On a trusted device, 1Password can add a convenience path. Touch ID, Windows Hello, a TPM, Secure Enclave protection, passkeys, or device unlock can release a locally protected unlock secret, depending on platform and user settings. The user therefore does not necessarily type the account password on every access. The account password remains part of the underlying protection and can be required again after a timeout, restart, authentication failure, settings change, or according to the configured policy.

The OS-only Galaxy design above corresponds to this trusted-device convenience path without the independent account-password layer. It protects keys at rest from disk theft and other OS users, but an application running successfully as the same logged-in user may be able to ask the OS to release them without the user entering a Galaxy-specific secret.

Primary references:

- [1Password Security Design white paper](https://1passwordstatic.com/files/security/1password-white-paper.pdf)
- [1Password Secret Key security](https://support.1password.com/secret-key-security/)
- [1Password device-unlock security](https://support.1password.com/device-unlock-security/)
- [1Password Windows Hello security](https://support.1password.com/windows-hello-security/)

### Galaxy policy options

**Automatic local unlock:** Protect the vault wrapping key only with the OS credential store. This has the least friction and matches ordinary local application credential storage. It does not provide a separate “something the user knows” boundary.

**Password-required unlock:** Derive a key-encryption key from a Galaxy vault password using a memory-hard password KDF, and use it to unwrap a random vault key. Do not store the password or derived key. This provides an independent application lock, but users can permanently lose access if they forget the password and have no recovery material.

**Hybrid unlock:** Make the Galaxy vault password the durable root unlock method, then let the user explicitly enable a device convenience method that stores an alternative wrapping of the vault key behind platform authentication. Auto-lock clears the unwrapped vault key and loaded Fernet keys from Galaxy memory. The user can configure when the vault password must be entered again.

If HVY encryption is intended to protect genuinely confidential documents rather than only prevent casual at-rest access, the hybrid model is the recommended target. It gives Galaxy a consistent password-based boundary on macOS and Windows while still permitting Touch ID or Windows Hello convenience later. Generic `safeStorage` or `keyring` access alone should not be described as biometric or user-presence enforcement; requiring a fresh OS authentication prompt needs platform-specific APIs and policy.

Galaxy does not need to copy 1Password's server-oriented Secret Key design for a local-only first version. A random vault key wrapped by a properly derived password key is sufficient for the local architecture. A separate recovery key becomes valuable when Galaxy adds key export, device transfer, synchronization, or account recovery.

The implemented first slice uses automatic local unlock. Moving to the hybrid model later will require vault migration and changes the promises made to existing encrypted-document users, so that decision should be made before encryption is presented as a stable confidentiality boundary.

## Delivery checklist

- [x] Electron and Tauri expose identical status, exact-ID load, metadata-list, store, and key-file-open commands.
- [x] macOS and Windows store only a random 256-bit wrapping key in native protected storage.
- [x] The versioned AES-256-GCM vault is separate from the integration vault and written atomically.
- [x] The renderer requests exact key IDs and does not record key material in settings or logs.
- [x] Every Galaxy async save path waits for generated-key persistence before writing document bytes.
- [x] Repeated identical stores are idempotent and conflicting values for one key ID fail.
- [x] Component rotation/removal does not permanently delete historical keys from the vault or application-level keyring.
- [x] `.hvykey` import validates key IDs, Fernet material, version, and conflicts before persisting accepted keys.
- [x] Key export uses an explicit save dialog and identifies plaintext `.hvykey` files as bearer secrets.
- [x] Whole-document encryption and removal use explicit modals, preserve historical keys, and flow through normal document saving.
- [x] Discover encrypted folders in both native hosts and resolve authenticated logical workspace trees without exposing manifest plaintext to the filesystem.
- [x] Create empty encrypted folders with persisted keys, opaque physical names, and atomically published manifests in both native hosts.
- [x] Label new physical encrypted-folder directories as Galaxy-managed storage, retain full unique IDs, and continue reading UUID-only directories.
- [x] Share workspace-unlock keys with encrypted mutations and reject duplicate logical sibling names across encrypted and plaintext entries.
- [x] Create new encrypted-folder documents with opaque physical names, automatic whole-document encryption, and stale-manifest conflict detection.
- [x] Implement encrypted-folder nested creation, import, rename, archive/restore, move, and delete with optimistic manifest updates and staged rollback for destructive mutations.
- [x] Add native-host restart tests that recover a generated key and decrypt its payload.
- [x] Retain Heavy's existing missing-key error and locked-component behavior without a Galaxy key-acquisition prompt.
- [x] Surface native-store unavailable, denied, incomplete, corrupt, and requested-key-absent states distinctly in the UI.
- [x] Probe macOS/Tauri Keychain access without UI at startup, preserve locked content when interaction is required, and cache one successful wrapping-key read for the application session.
- [ ] Reject Electron's `basic_text` backend before Linux support; configure and test a persistent production keyring feature before enabling Tauri Linux.
