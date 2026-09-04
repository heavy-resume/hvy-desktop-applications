(() => {
  if (window.top !== window || window.__hvyGalaxyWebMcp) return;
  const MAX_RESULT_CHARS = 1024 * 1024;
  const active = new Map();
  const nativePublish = typeof window.__hvyGalaxyPublish === 'function' ? window.__hvyGalaxyPublish : null;

  const publish = (value) => {
    if (nativePublish) return nativePublish(value);
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    window.location.href = `hvy-integration://inspection/${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  };

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
    if (window.__hvyGalaxyNativeWebMcp === true) {
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

  window.addEventListener('pagehide', () => {
    for (const [requestId, controller] of active) {
      controller.abort(new DOMException('The page navigated during WebMCP execution.', 'AbortError'));
      publish({ kind: 'integration-webmcp-error', requestId, code: 'NavigationError', message: 'The page navigated during WebMCP execution.' });
    }
    active.clear();
  });

  window.__hvyGalaxyWebMcp = {
    async discover(request = {}) {
      try {
        const tools = await getToolsForDiscovery(request);
        publish({ kind: 'integration-webmcp-tools', requestId: request.requestId, tools: tools.map((entry) => entry.descriptor), page: { origin: location.origin, pathname: location.pathname } });
      } catch (error) {
        publish({ kind: 'integration-webmcp-error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
      }
    },
    async invoke(request = {}) {
      try {
        const tools = await getTools(request);
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
        const modelContext = found.modelContext;
        if (typeof modelContext.executeTool !== 'function') throw new Error('This WebMCP implementation cannot execute discovered tools.');
        const controller = new AbortController();
        active.set(request.requestId, controller);
        const input = window.__hvyGalaxyNativeWebMcp === true ? (request.arguments || {}) : JSON.stringify(request.arguments || {});
        const result = await modelContext.executeTool(found.tool, input, { signal: controller.signal });
        const serialized = typeof result === 'string' ? result : JSON.stringify(result ?? null);
        if (new TextEncoder().encode(serialized).byteLength > MAX_RESULT_CHARS) throw new Error('The WebMCP tool result exceeded the 1 MB limit.');
        let value = result;
        let isJson = typeof result !== 'string';
        if (typeof result === 'string') {
          try { value = JSON.parse(result); isJson = true; } catch (_) { value = result; }
        }
        publish({ kind: 'integration-webmcp-result', requestId: request.requestId, value, isJson, descriptor: found.descriptor, page: { origin: location.origin, pathname: location.pathname } });
      } catch (error) {
        publish({ kind: 'integration-webmcp-error', requestId: request.requestId, code: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) });
      } finally {
        active.delete(request.requestId);
      }
    },
    cancel(requestId) {
      active.get(requestId)?.abort(new DOMException('The WebMCP operation was cancelled.', 'AbortError'));
      active.delete(requestId);
    },
  };
})();
