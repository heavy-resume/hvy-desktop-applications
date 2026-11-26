// WebMCP, as Galaxy uses it: what the page's own WebMCP (`document.modelContext`, the browser's or one the site brings)
// has. The host runs this once for each thing it asks, finding the page's tools or calling one, in the page's world,
// where the tools are, and takes its result as the script's (src-electron/main.cjs, src-tauri/src/commands.rs). Nothing
// of it stays in the page.
(operation, request = {}) => {
  const MAX_RESULT_CHARS = 1024 * 1024;
  // The browser's own WebMCP, rather than a polyfill the site brought: it finds tools across origins, and takes a call's
  // arguments as they are, where a polyfill takes them as JSON.
  const pageContext = document.modelContext || navigator.modelContext;
  const native = typeof pageContext?.getTools === 'function' && /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(pageContext.getTools));

  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    return value;
  };

  const descriptor = (tool, origin) => ({
    origin: typeof tool.origin === 'string' ? tool.origin : origin,
    name: String(tool.name || ''),
    ...(tool.title ? { title: String(tool.title) } : {}),
    description: String(tool.description || ''),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
    ...(tool.outputSchema && typeof tool.outputSchema === 'object' ? { outputSchema: tool.outputSchema } : {}),
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint === true,
      untrustedContentHint: tool.annotations?.untrustedContentHint === true,
      consequentialHint: tool.annotations?.consequentialHint === true || tool.annotations?.destructiveHint === true,
    },
  });

  const context = (targetDocument = document) => {
    const modelContext = targetDocument.modelContext || targetDocument.defaultView?.navigator?.modelContext;
    if (!modelContext || typeof modelContext.getTools !== 'function') throw new Error('This page does not provide a WebMCP model context.');
    return modelContext;
  };

  const documents = () => {
    const result = [document];
    const visit = (targetWindow) => {
      for (let index = 0; index < targetWindow.frames.length; index += 1) {
        try {
          const child = targetWindow.frames[index];
          const childDocument = child.document;
          if (childDocument && child.location.origin === location.origin) {
            result.push(childDocument);
            visit(child);
          }
        } catch (_) { /* Cross-origin frames are native-only and intentionally skipped. */ }
      }
    };
    visit(window);
    return result;
  };

  const getTools = async (request = {}) => {
    const entries = [];
    const seenTools = new Set();
    const topContext = context();
    const fromOrigins = Array.isArray(request.fromOrigins) ? request.fromOrigins.filter((origin) => typeof origin === 'string' && origin !== location.origin) : [];
    if (native) {
      for (const tool of await topContext.getTools({ fromOrigins })) {
        if (!seenTools.has(tool)) entries.push({ tool, modelContext: topContext, descriptor: descriptor(tool, tool.origin || location.origin) });
        seenTools.add(tool);
      }
    } else {
      for (const targetDocument of documents()) {
        const modelContext = context(targetDocument);
        const tools = await modelContext.getTools();
        const origin = targetDocument.location?.origin || location.origin;
        for (const tool of tools) {
          if (!seenTools.has(tool)) entries.push({ tool, modelContext, descriptor: descriptor(tool, origin) });
          seenTools.add(tool);
        }
      }
    }
    const identities = new Set();
    for (const entry of entries) {
      const identity = `${entry.descriptor.origin}\0${entry.descriptor.name}`;
      if (identities.has(identity)) throw new Error(`More than one WebMCP tool is published as ${entry.descriptor.name} by ${entry.descriptor.origin}.`);
      identities.add(identity);
    }
    return entries;
  };

  const getToolsForDiscovery = async (request = {}) => {
    if (request.waitForTools !== true) return getTools(request);
    const modelContext = context();
    let finishWaiting;
    const changed = new Promise((resolve) => { finishWaiting = resolve; });
    const onToolChange = () => finishWaiting();
    modelContext.addEventListener('toolchange', onToolChange, { once: true });
    try {
      const tools = await getTools(request);
      if (tools.length) return tools;
      const timeout = setTimeout(finishWaiting, 5_000);
      await changed;
      clearTimeout(timeout);
      return getTools(request);
    } finally {
      modelContext.removeEventListener('toolchange', onToolChange);
    }
  };

  const page = { origin: location.origin, pathname: location.pathname };
  const failure = (error) => ({ kind: 'integration-webmcp-error', requestId: request.requestId, focusMainOnResult: request.focusMainOnResult === true, code: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) });

  const discover = async () => {
    const tools = await getToolsForDiscovery(request);
    return { kind: 'integration-webmcp-tools', requestId: request.requestId, focusMainOnResult: request.focusMainOnResult === true, tools: tools.map((entry) => entry.descriptor), page };
  };

  const invoke = async () => {
    const tools = await getToolsForDiscovery(request);
    const found = tools.find((entry) => entry.descriptor.name === request.name && entry.descriptor.origin === request.origin);
    if (!found) {
      const error = new Error(`WebMCP tool ${String(request.name || '')} is no longer available on this page.`);
      error.name = 'WebMcpDescriptorChangedError';
      throw error;
    }
    if (JSON.stringify(stable(found.descriptor)) !== JSON.stringify(stable(request.descriptor))) {
      const error = new Error('The WebMCP tool changed and must be reviewed again.');
      error.name = 'WebMcpDescriptorChangedError';
      throw error;
    }
    if (typeof found.modelContext.executeTool !== 'function') throw new Error('This WebMCP implementation cannot execute discovered tools.');
    const input = native ? (request.arguments || {}) : JSON.stringify(request.arguments || {});
    const result = await found.modelContext.executeTool(found.tool, input);
    const serialized = typeof result === 'string' ? result : JSON.stringify(result ?? null);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RESULT_CHARS) throw new Error('The WebMCP tool result exceeded the 1 MB limit.');
    let value = result;
    let isJson = typeof result !== 'string';
    if (typeof result === 'string') {
      try { value = JSON.parse(result); isJson = true; } catch (_) { value = result; }
    }
    return { kind: 'integration-webmcp-result', requestId: request.requestId, focusMainOnResult: request.focusMainOnResult === true, value, isJson, descriptor: found.descriptor, page };
  };

  return (operation === 'invoke' ? invoke() : discover()).catch(failure);
}
