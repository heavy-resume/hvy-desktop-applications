# HVY Galaxy Integrations Plan

## Objective

Allow a user to open a web application in HVY Galaxy, use its normal interface, extract structured data with deterministic scripts, and insert reviewed results into an HVY document.

Google Workspace is the first provider, initially covering Gmail and Google Calendar, followed by Drive. The architecture must remain provider-neutral so future mods can add integrations without receiving unrestricted desktop access.

## Product experience

### Integration tabs

Integrations participate in Galaxy's existing tab model. An integration tab contains trusted Galaxy controls around an isolated native webview:

- Profile selector
- Back, forward, and reload
- Provider destinations such as Gmail, Calendar, and Drive
- User-defined web pages
- Inspect data
- Run extractor
- Close tab

The remote page must not replace the main Galaxy renderer or inject controls into the provider's DOM. Electron should host it in a `WebContentsView`; Tauri should use a child webview positioned within the document content area. Switching tabs hides or shows the corresponding native webview and keeps its bounds synchronized with the trusted container.

### Pages and integrations

An integration owns one or more pages and action scripts. Gmail and Google Calendar are bundled starting integrations, but they use the same records as pages added by a user.

```ts
interface IntegrationDefinition {
  id: string;
  name: string;
  profileProviderId: string;
  pages: IntegrationPageDefinition[];
  actions: IntegrationActionDefinition[];
}

interface IntegrationPageDefinition {
  id: string;
  name: string;
  url: string;
  allowedOrigins: string[];
}
```

The UI must support adding, editing, and removing user-defined pages. Adding a page requires a name and HTTPS URL. Galaxy derives the initial allowed origin from that URL and displays it for review. Additional origins require an explicit edit because authentication and content may span related domains.

### Integration profiles

An integration profile represents one independent signed-in identity. Apps belonging to the same provider may share a profile, while work and personal accounts remain separate.

```ts
interface IntegrationProfile {
  id: string;
  name: string;
  providerId: string;
  browserStoreId: string;
  createdAt: string;
  lastUsedAt: string;
}
```

Users can create, rename, switch, reset, and delete profiles. Reset and deletion use explicit Galaxy modals and remove the complete browser store for only the selected profile.

Each open profile owns an independent native webview instance. Multiple profiles for the same provider may remain open concurrently, allowing use cases such as separate personal and work Gmail accounts without switching the active login inside Google.

## Architecture

### Shared browser-host contract

The frontend uses one runtime-independent interface:

```ts
interface IntegrationBrowserHost {
  open(profileId: string, destination: IntegrationDestination): Promise<void>;
  navigate(profileId: string, command: 'back' | 'forward' | 'reload'): Promise<void>;
  beginInspection(profileId: string): Promise<void>;
  executeExtractor(request: ExtractorExecutionRequest): Promise<ExtractionResult>;
  close(profileId: string): Promise<void>;
  resetProfile(profileId: string): Promise<void>;
}
```

The shared frontend must not branch on Tauri versus Electron. Runtime adapters own webview construction, profile storage, navigation policy, script execution, and result transport.

### Runtime profile storage

Tauri on supported macOS versions should use one stable named `WKWebsiteDataStore` per integration profile. WebKit should persist cookies, local storage, IndexedDB, caches, and service workers as one browser profile. Resetting a profile deletes its named store through WebKit.

Electron should use one browser session per integration profile. Session data must be isolated by profile and restored before navigating to the provider. Authentication storage persisted outside Chromium must be encrypted with AES-256-GCM using a key protected by Electron `safeStorage`.

Profile metadata is not secret, but authentication and browser storage must never be placed in an HVY document or made available to mods.

## Inspection

Inspection is an explicit user mode:

1. The user selects **Inspect data** in trusted Galaxy controls.
2. Hovering highlights a meaningful visible element.
3. Clicking displays a short candidate list containing the selected element and useful related elements.
4. The user chooses the intended text, control, record, or image.
5. Galaxy receives a bounded structured snapshot.
6. Escape cancels inspection and restores normal page interaction.

Normal context menus remain available outside inspection mode.

### Candidate discovery

Candidate discovery must support ordinary DOM, open shadow DOM, clickable overlays, and images that are siblings of the hit-tested element. It should combine:

- The event's composed path
- The browser's hit-test stack
- Meaningful ancestors
- Bounded searches for visually underlying images

Do not show every DOM node. Text and controls should be deduplicated using semantic content. Images should be identified using their resolved URLs. A diagnostics view should expose hit testing, composed paths, image rectangles, and final candidates when a provider's markup needs investigation.

### Inspection result

```ts
interface InspectedElement {
  tag: string;
  role: string | null;
  directText: string;
  accessibleName: string;
  descendantText: string;
  cssPath: string;
  attributes: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
  image: null | {
    url: string;
    alt: string | null;
    naturalWidth: number;
    naturalHeight: number;
  };
}
```

Selector generation should prefer evidence in this order:

1. Accessible roles and names
2. Stable attributes
3. Structural relationships
4. Bounded text patterns
5. Positional CSS paths

Full DOM paths are useful diagnostic evidence but should not be the only selector because vendor markup changes frequently.

## Deterministic extractors

An extractor is versioned JavaScript that runs inside a matching remote page and returns JSON.

```ts
interface IntegrationExtractor {
  id: string;
  version: number;
  origins: string[];
  pathPatterns: string[];
  script: string;
  resultSchema: JsonSchema;
  permissions: Array<'dom:read' | 'image:read'>;
}

interface ExtractionResult<T = unknown> {
  profileId: string;
  extractorId: string;
  page: {
    origin: string;
    pathname: string;
  };
  value: T;
}
```

Extractor scripts receive DOM access only. Results must be JSON-serializable, size-limited, and validated against the declared schema. The native host supplies the actual profile ID and page origin; page JavaScript cannot assert either value.

Inspection snapshots are inputs for authoring extractors. AI may propose a script from selected examples, but the saved artifact is deterministic, reviewable JavaScript with a schema and explicit permissions.

## Action builder

Each integration has its own action scripts. An action can read the current page, return structured JSON, and later map that result into an HVY document.

```ts
interface IntegrationActionDefinition {
  id: string;
  integrationId: string;
  name: string;
  description: string;
  pageIds: string[];
  script: string;
  resultSchema: JsonSchema;
  permissions: Array<'dom:read' | 'image:read'>;
  version: number;
}
```

Action authoring follows this workflow:

1. Choose **Add action** beside one of the integration's pages. Galaxy opens that page directly in inspection mode.
2. Select the smallest parent containing one complete item and all data that belongs to it.
3. Set the action's minimum confidence, then expand the primary example and define its named fields.
4. Choose additional instances of the same parent when the record shape varies. Already accepted records and their passing subfields remain marked in green; below-threshold records and failed or overlapping subfields are identified separately so a new example can target a concrete variation.
5. Show the same named field rows inside every expandable example. Prepopulate each row with its best structural match and let the user replace a weak or missing selection for only that example. These selections become alternate structural signatures for one output field, not duplicate fields.
6. Fields are optional by default. Use compact list and required controls where needed. Within an example, **Doesn't exist** explicitly marks an absent field; a mistaken automatic match becomes negative structural evidence for that field, and missing optional structures return an empty value without rejecting the record.
7. Run the matcher and adjust confidence from the live page overlay. Highlights update without changing window focus. The integration browser retains that value for example selection and extraction, then extraction returns it to the builder when focus is intentionally restored.
8. Review ordinary grouped records rather than raw JSON.
9. Name and save the action after the preview groups every field with the correct parent.
10. Run the saved action later through the selected page and browser profile.

The first deterministic action format does not require an LLM. A later script-generation layer may add repeatable page-preparation steps, transformations, or provider-specific behavior, but it consumes the same reviewed record examples and must not replace the structural action contract.

The builder should make selected text prominent rather than burying it inside raw DOM metadata. Present a focused content preview and readable information fields first. Selector, attribute, geometry, diagnostics, and raw JSON belong in collapsed technical disclosures rather than the primary workflow.

While selection is active, wheel input must continue to scroll the page. A temporary **Navigate page** mode releases pointer input to the site so the user can expand, paginate, or otherwise prepare dynamic content, then **Resume picking** without losing the action draft.

A click is evidence, not the saved selector. A content pattern records parent samples, labeled targets, negative examples, and their structural relationships. Each structural signature should include nesting, element roles, child and descendant shapes, relative target paths, normalized geometry, and normalized container treatment such as border presence, radius, padding, background presence, and shadow presence without storing literal colors or private text values. Matching ranks all field/element pairs together and assigns the strongest fits first. The same element cannot serve two fields. Ancestor/descendant matches may coexist only when the examples teach that those fields are nested; otherwise a missing field cannot borrow a region claimed by another field. The matcher then verifies that the complete labeled target set fits inside the proposed parent. Positional paths remain diagnostic and fast-path evidence, not durable identity. Optional anchors may be reconsidered after parent/target matching demonstrates a concrete ambiguity they solve.

### Privacy and stored patterns

Extraction previews remain local to Galaxy and are not sent to an LLM. Saved actions retain field labels, cardinality, structural signatures, and relative paths. They do not retain the selected text, accessible name, surrounding page content, image URL, or diagnostic attribute values.

Privacy transformations apply only when a future script-generation workflow explicitly prepares an LLM request.

Raw inspection data remains local unless the user explicitly continues to script generation. Only explicitly selected targets and samples may contribute human-readable page text. Parent samples, ancestors, siblings, and repeated-record context must be represented as structural shape rather than copied values. Every reviewable selected value supports:

- **Keep**: include the value as written.
- **Label**: replace the value with a descriptive placeholder such as `{{PERSON_NAME}}`, `{{EMAIL_ADDRESS}}`, or a user-entered label.
- **Remove**: omit the selected property or array item from the LLM example.

Labels describe the semantic role without preserving the original value. The builder stores transformations as JSON paths separately from the raw snapshot and applies them when producing the sanitized example.

```ts
interface InspectionPrivacyRule {
  path: string;
  action: 'label' | 'remove';
  label?: string;
}

interface SanitizedInspectionExample {
  selectedContent: string;
  snapshot: unknown;
  appliedRules: InspectionPrivacyRule[];
}
```

Parent rules apply recursively. Removing a parent removes its entire subtree; labeling a parent replaces the subtree with one placeholder. The final LLM request must be generated only from the sanitized copy, never by mutating or serializing the raw snapshot accidentally. The user must be able to inspect the exact outbound JSON before generation.

### Result transport

Tauri and Electron each provide a dedicated integration result handler. It accepts only inspection or extractor results and remains physically separate from Galaxy's general command bridges.

The remote page must never receive filesystem, workspace, plugin, HVY document, or general desktop commands. Communication is one-way from the integration page to validated result handling until a separately reviewed capability requires otherwise.

### Images

DOM extraction initially returns a resolved image URL and metadata. An extractor with `image:read` may request image bytes through the authenticated browser session. The host enforces MIME-type and size limits before returning those bytes to trusted Galaxy UI.

When an image is accepted into an HVY document, Galaxy copies the bytes into document storage. It must not retain an authenticated or expiring remote URL as the document's only image source.

## HVY insertion

Extraction and insertion are separate operations. Galaxy shows the structured result for review before applying a mapping to a selected document.

```ts
interface HvyIntegrationMapping {
  id: string;
  extractorId: string;
  targetDocumentType: string;
  apply(result: unknown, document: unknown): HvyPatch;
}
```

Begin with inserting a reviewed text result into the active HVY document. Add images after byte transfer is established. Any synchronization feature must define identity, conflicts, deletion behavior, and provenance before supporting updates to existing records.

Inserted data should retain source provenance where appropriate:

- Provider and profile
- Source origin and path
- Extractor ID and version
- Extraction time

## Mod interface

An integration mod may contribute:

- Provider metadata and icons
- Allowed origins and destinations
- Extractor definitions and result schemas
- HVY mappings
- Optional image access

User-defined pages and actions use the same manifest shapes as bundled and mod-provided integrations. Ownership metadata determines whether an entry is editable, but execution and security policy remain identical.

Mods do not construct privileged webviews or call desktop APIs directly. The browser host enforces origins and permissions, executes scripts, validates results, and attributes results to a profile and extractor version.

The mod API should not be declared stable until it has been used for Google Workspace and at least one unrelated provider.

## Security requirements

- Treat remote pages, extractor scripts, and extractor results as untrusted.
- Keep provider pages in isolated native webviews with no Galaxy bridge.
- Enforce provider navigation and popup allowlists in the native host.
- Show the active profile and origin in trusted Galaxy controls.
- Isolate browser storage by profile.
- Require explicit inspection or extractor execution; do not scrape continuously in the background.
- Keep raw inspection snapshots local and send only the user-reviewed sanitized copy to an LLM.
- Apply privacy rules by JSON path in trusted Galaxy code, outside the remote page and outside generated scripts.
- Bind results to native window and profile state.
- Validate origin, payload size, JSON shape, schema, and requested permissions.
- Provide complete per-profile reset and deletion.
- Sign and notarize releases and use the macOS hardened runtime.
- Complete an App Sandbox and security-scoped workspace bookmark review before production credential storage.
- Explain to users that a signed-in integration grants Galaxy access to the selected site comparable to a browser extension authorized for that site.

## Delivery plan

### Phase 1: Integration tabs

- Add integration tabs to the existing Galaxy tab model.
- Add trusted browser controls outside the remote DOM.
- Embed isolated Electron and Tauri webviews within the selected tab.
- Synchronize webview visibility, focus, and bounds with tab state.
- Preserve runtime-specific session behavior behind the shared profile interface.
- Move diagnostic controls out of the normal user interface.

### Phase 2: Multiple profiles

- Add the profile registry and a default Google profile.
- Add create, rename, switch, reset, and delete flows.
- Create one isolated runtime browser store per profile.
- Make Gmail, Calendar, and Drive share the selected Google profile.

### Phase 3: Pages and action builder

- Store bundled and user-defined pages through one integration registry.
- Add explicit-modal flows to create, edit, and remove custom pages.
- Add per-integration action lists and action metadata.
- Build structural actions from parent examples and labeled single/list target fields.
- Let each action persist a reviewable minimum-confidence threshold, starting at 80%.
- Preview grouped records in a nontechnical review surface.
- Persist content-free matcher snapshots and rerun saved actions through the selected profile.
- Keep sanitized LLM script generation as a separate follow-up workflow.

### Phase 4: Extraction platform

- Add dedicated native result handlers.
- Define extractor manifests, permissions, schemas, and versioning.
- Add structured execution errors and payload limits.
- Add an extractor review and testing surface.
- Retain inspection diagnostics for integration development.

### Phase 5: HVY insertion

- Preview extracted JSON in trusted Galaxy UI.
- Add mappings that insert reviewed text into an active HVY document.
- Add authenticated image-byte transfer and document attachment storage.
- Record source provenance.

### Phase 6: Provider integrations and mods

- Package Gmail and Calendar extractors against the generic interfaces.
- Add Drive workspace operations after read and extraction flows are stable.
- Publish the constrained integration mod manifest and SDK.
- Validate the API with a non-Google provider before stabilizing it.

## Verification

Automated checks should cover:

- Profile registry behavior and migration
- Profile isolation and reset
- Navigation and popup origin enforcement
- Result size, origin, schema, and permission validation
- Integration page and action registry persistence
- JSON-path label and removal transformations, including nested objects and arrays
- Proof that outbound generation requests contain sanitized data and not raw values
- Selector and candidate-discovery helpers
- Runtime compilation and existing non-authenticated tests

Authenticated behavior requires a manual matrix in both Tauri and Electron:

- Login persists across tab closure and application restart.
- Provider applications share the selected profile.
- Two profiles remain isolated.
- Resetting one profile does not affect another.
- Remote pages cannot access Galaxy commands.
- Normal page interaction works outside inspection mode.
- Inspection selects leaf text, meaningful ancestors, shadow-DOM content, overlay-covered images, and ordinary images.
- Extractor results arrive with the correct native profile and origin.
- Custom pages obey their reviewed origin list and have their own actions.
- The action builder emphasizes selected content and previews the exact sanitized example.
- Image bytes can be copied into an HVY document without relying on the remote URL afterward.

## First production milestone

Implement one trusted integration tab backed by the Tauri and Electron browser-host adapters. Complete profile creation and switching next, then build the production extractor boundary before implementing provider-specific extractors.
