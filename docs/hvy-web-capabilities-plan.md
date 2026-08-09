# HVY Web Capabilities Plan

## Objective

Allow an HVY document to use the existing web record matcher and saved page or
record commands through interactive components, regular scripting, Power
Scripting, and optionally MCP.

The implementation must keep browser identity local to Galaxy. An HVY document
may describe what page data or command it can use, but merely opening a document
must not grant it access to an authenticated browser profile.

## HVY capability plugins

Add two Galaxy-built-in HVY plugins using ordinary portable plugin blocks:

- `hvy.web-records` fetches a saved record definition, renders its fields, and
  offers the record's item commands.
- `hvy.web-command` renders and executes one saved page command.

The Galaxy built-in plugin catalog must support modules owned by this
application in addition to plugins imported from the reference implementation.
Other HVY hosts can preserve these blocks even if they cannot execute them.

### Stored capability definitions

Each block stores a versioned snapshot containing:

- A stable capability ID, name, and description.
- The HTTPS page URL and allowed origins.
- The structural record pattern, field labels and result schema for a records
  capability.
- The current one-step command definitions: click, double click, or right
  click.
- Optional source registry IDs so Galaxy can offer an explicit refresh from
  the locally saved integration definition.
- Per-capability MCP exposure settings, disabled by default.

The snapshot is copied from an existing integration record type or page
command. Subsequent integration-registry edits do not silently alter the HVY
document. The plugin editor provides an explicit refresh operation that updates
the snapshot and consequently requires web access to be reviewed again.

The HVY source does not store:

- Browser profile IDs or profile names.
- Cookies, login tokens, local storage, IndexedDB, or other session state.
- Extracted page values or inspection text used while teaching a matcher.
- Live DOM nodes, record references, tabs, scroll position, or browser-window
  state.

Fetched results remain ephemeral unless a user or script explicitly writes
selected values into the document.

## Local profile binding and authorization

Profile selection and authorization are separate concepts:

- A **profile binding** determines which local browser identity the capability
  would use.
- An **authorization** permits one exact document capability to use that
  profile.

The plugin editor and reader expose a **Use profile** control populated from the
local integration profiles. Galaxy stores the selection in local application
settings, keyed by document identity and capability ID. Scripts and MCP cannot
provide or override a profile ID.

Rename handling preserves the binding for the same document. Save As creates a
new document identity and requires authorization for the new copy. Unsaved
documents may keep a session-only selection, but cannot expose a capability
through MCP.

### Exact-capability authorization

Persistent authorization is keyed by:

```text
document identity + capability ID + canonical capability hash + profile ID
```

The canonical hash covers the page URL, allowed origins, record matcher,
result schema, and command definitions. MCP exposure preferences are governed
separately and do not grant browser access.

Opening an unapproved document cannot start a web operation. Choosing a profile
does not release previously queued work automatically. The user must authorize
the exact capability/profile pairing through a Galaxy modal. Once authorized,
the unchanged capability may run on later document openings, including from a
regular document-load script.

Changing the page, origins, matcher, schema, commands, profile, or document
identity invalidates the prior authorization. Clearing local authorization or
changing the authorization format also requires review.

Galaxy stores a sanitized summary of the approved definition locally alongside
its hash. This permits a meaningful comparison without retaining extracted
page data.

### Authorization and reauthorization modals

Use explicit Galaxy modals, never native alerts or confirmation boxes.

First authorization identifies the document, capability, requested page,
records or commands, and selected profile. Its actions are **Cancel** and
**Allow with [profile name]**.

When authorization is requested again, the modal must explain why. For example:

> **Review web access again**
>
> You're seeing this again because the "Inbox" capability changed after you
> approved it. Its allowed page origins and "Open message" command were
> modified. Review the updated access before allowing it to use your **Work**
> profile.

The reason is one of:

- The page or allowed origins changed.
- The record matcher, fields, or result schema changed.
- Commands were added, removed, or modified.
- A different browser profile was selected.
- The document is a new copy or has a new identity.
- The previous authorization was cleared.
- The authorization format changed after an application update.

When several categories changed, list all of them in readable terms. Do not
show an unexplained repeat of the original authorization prompt.

## Interactive behavior

In editor mode, the plugins provide source selection, snapshot refresh, local
profile selection, authorization status, and MCP exposure controls.

In reader mode:

- A records block provides an explicit fetch action, displays normalized field
  values, and renders its item-command buttons beside each matched record.
- A page-command block provides an explicit command button.
- Record fetches may run in the background. Interactive commands show and focus
  the integration window before execution.
- A missing profile, missing authorization, invalid definition, no match, or
  ambiguous match is shown as an explicit component state rather than silently
  choosing an alternative target.

Each fetched record receives an opaque, short-lived `recordRef`. It is valid
only for the current profile/page result and allows an item command to resolve
the record again. It is never serialized into the HVY document.

## Shared execution runtime

Refactor the integrations manager and both plugins onto one web-capability
dispatcher. Do not create a second implementation of browser opening,
extraction, or command execution.

The dispatcher must:

- Resolve and validate the portable capability snapshot.
- Resolve the local profile binding and exact-capability authorization.
- Assign a request ID before opening or controlling a browser.
- Echo that request ID through extraction and command results.
- Publish successful command results as well as failures.
- Serialize operations for the same profile while permitting different
  profiles to run concurrently.
- Reject pending work if its document closes, authorization changes, the
  browser closes, launching fails, or the operation times out.

The public result shapes are:

```ts
interface WebRecordsResult {
  page: { origin: string; pathname: string };
  records: Array<{
    recordRef: string;
    values: Record<string, unknown>;
  }>;
}

interface WebCommandResult {
  status: 'executed' | 'no_match' | 'ambiguous';
  reason?: string;
}
```

Raw matcher diagnostics and DOM paths do not cross into scripting or MCP
results. The dispatcher enforces the existing bounded record count and a
bounded JSON result size.

## Regular scripting queue

Regular sandboxed scripting remains synchronous. It does not need to suspend a
Brython execution on a JavaScript promise. Instead, add an explicit queued
plugin-call API:

```python
job = doc.plugins.queue(
    "hvy.web-records",
    "fetch",
    request_key="initial-inbox",
    args={"capabilityId": "inbox"},
)

if job["status"] != "completed":
    return

records = job["value"]["records"]
```

Queue behavior is deterministic:

1. The first call returns `queued` and starts the operation after authorization
   has been verified.
2. Calls with the same owner and request key return `pending` without creating
   duplicate work.
3. Completion invokes a host callback that schedules only the originating
   scripting block to run again.
4. The next matching queue call returns `completed` with the value and marks it
   delivered atomically.
5. Later calls return `delivered` and do not enqueue the operation again.
6. A different `request_key` explicitly creates a new generation.
7. Failures use the same one-time delivery behavior with `failed` and an error
   value.
8. `authorization_required` is returned without leaving work waiting to run
   after the user chooses a profile or grants access.

Jobs are keyed by document instance, scripting block ID, plugin ID, method, and
request key. Job state is ephemeral and is discarded when the document unloads.

Do not retain Python callback closures after a script finishes. Re-running the
originating block keeps the existing runtime teardown, tracing, step budgets,
cycle detection, and error reporting intact.

Extend the plugin scripting capability metadata to identify methods that may be
queued. Regular scripts may enqueue only those methods, and the document's
plugin declaration must include the existing `scripting` permission. Power
scripts continue to use the trusted asynchronous path:

```js
const result = await doc.plugins.call('hvy.web-records', 'fetch', {
  capabilityId: 'inbox',
});
```

Both scripting paths support record fetch, item command execution with a
`commandId` and `recordRef`, and page-command execution.

## MCP exposure

Add an independent MCP setting:

```ts
type McpIntegrationAccess = 'off' | 'read' | 'actions';
```

It defaults to `off` and is persisted into the stdio MCP configuration.
Existing workspace/document write access remains a separate setting.

Each records block may independently expose its fetch operation and selected
item commands. Each page-command block may expose its command. All exposure is
off by default. An item command can be exposed only when its records fetch is
also exposed, because MCP needs a current `recordRef`.

Add two stable MCP tools:

```text
web_capability_list({ path })
web_capability_invoke({ path, capabilityId, operation, commandId?, recordRef? })
```

`web_capability_list` returns only the document capabilities allowed by their
block settings and the global MCP policy. `web_capability_invoke` resolves the
same local binding and exact-capability authorization used by interactive and
scripted execution. MCP cannot select a profile or authorize a capability.

The existing MCP workspace visibility, hidden-file, archived-file, and path
checks apply. MCP receives normalized record values and command status, not raw
inspection snapshots or matcher diagnostics.

### Running-application broker

Live web operations require Galaxy and its browser profiles to be running. Add
a correlated loopback broker:

- Tauri and Electron native hosts forward requests to the trusted renderer and
  await a response by request ID.
- The stdio MCP process discovers the running instance from a per-session
  connection file in shared application data.
- Tauri's existing HTTP MCP server uses the same dispatcher.
- Electron continues to expose these capabilities through stdio; Electron HTTP
  hosting is not part of this change.

If Galaxy is unavailable, return a clear unavailable error and never launch it
implicitly. MCP's global policy, block-level exposure, and exact document
authorization are the required opt-ins; an already authorized MCP action does
not add another per-invocation confirmation modal.

## Testing and acceptance criteria

### Capability and privacy tests

- Plugin configurations round-trip through HVY serialization.
- Snapshots retain the structural matcher and commands but not profiles,
  inspection text, extracted values, record references, or session state.
- Registry changes do not affect a block until explicit refresh.
- Local profile bindings survive rename, behave correctly for Save As, and are
  absent on another installation.

### Authorization tests

- Opening an unapproved document does not open or control an integration
  browser.
- Selecting a profile alone does not release queued work.
- Exact unchanged capabilities reuse a local authorization on later opens.
- Page, origin, matcher, schema, command, profile, and document-identity changes
  invalidate authorization.
- Reauthorization modals state the correct reason and changed categories.
- No raw page values are stored in authorization summaries.

### Runtime and scripting tests

- Request correlation routes results to the correct caller.
- Same-profile operations are serialized; different profiles may run in
  parallel.
- Successful, missing, ambiguous, closed-browser, launch-failure, and timeout
  results settle correctly.
- Regular-script jobs deduplicate, re-enter only their owner, deliver once,
  support new request generations, and stop on unload.
- Queued calls require the scripting permission and queueable-method metadata.
- Power scripts can await the equivalent operations directly.
- The existing script-cycle coordinator catches a document mutation loop after
  a queued result.

### MCP and desktop parity tests

- MCP tools are absent when integration access is off.
- Read access cannot execute commands, and actions access cannot override a
  block that did not expose its command.
- MCP cannot provide a profile or bypass document authorization.
- The stdio configuration carries the integration-access setting.
- A missing broker returns the documented unavailable result.
- Electron and Tauri broker adapters satisfy the same request/result contract.

Run the frontend unit suite, integration-inspector regressions, TypeScript/Vite
build, Rust tests, and Electron/Tauri broker smoke coverage.

## Deferred work

This first version does not add structured-source retrieval, text or form input,
multi-step workflows, automatic refresh, persistent fetched results, HVY result
insertion mappings, image-byte transfer, or background monitoring.
