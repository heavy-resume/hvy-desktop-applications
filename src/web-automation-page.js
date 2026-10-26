// Web automation's work inside a worker page, shared by the Electron and Tauri
// hosts (src-electron/web-automation-host.cjs, src-tauri/src/web_automation.rs).
// It runs after the integration inspector (integration-inspector.js), which it
// uses to match patterns and run commands.
//
// Electron awaits these functions' promises directly. Tauri's webviews return
// only synchronous values, so there a call is started with `start` and its
// result read later with `take`.
(() => {
  if (window.__hvyGalaxyAutomation) return;
  const results = new Map();

  window.__hvyGalaxyAutomation = {
    /** Runs each pattern's inspector matcher on the page, and reads its frames. */
    async inspect(request) {
      const inspector = window.__hvyGalaxyInspector;
      const matches = {};
      for (const pattern of request.patterns) {
        const extraction = await inspector.extractAcrossPage(pattern.matcher);
        matches[pattern.id] = extraction.records || [];
      }
      return {
        url: location.href,
        ready: document.readyState !== 'loading',
        matches,
        frames: [...document.querySelectorAll('iframe[src]')].map((frame) => ({ src: frame.src })),
      };
    },

    /** A page command (such as Next) or an item command. */
    async runCommand(payload) {
      // Commands run on pages other than the one they were set up on, so the page is only checked to be on its site.
      const readyChecks = { urlMode: 'strict-domain', urlValue: location.hostname, elements: [] };
      const result = await window.__hvyGalaxyInspector.executeCommand({ ...payload, readyChecks });
      return { status: result?.status === 'executed' ? 'executed' : 'no_match' };
    },

    /** Same-origin, credentialed request made from inside the page. */
    async request(hostRequest) {
      const response = await fetch(hostRequest.url, { method: hostRequest.method, headers: hostRequest.headers, body: hostRequest.body, credentials: 'include', redirect: 'manual' });
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      let body = text;
      if (contentType.includes('json')) {
        try {
          body = JSON.parse(text);
        } catch (_) {
          // Not JSON after all: the text is the body.
        }
      }
      return { status: response.status, contentType, body };
    },

    /** Starts a call whose result `take` reads later. */
    start(callId, name, argument) {
      results.set(callId, null);
      Promise.resolve()
        .then(() => window.__hvyGalaxyAutomation[name](argument))
        .then((value) => results.set(callId, { value }), (error) => results.set(callId, { error: String(error?.message || error) }));
      return true;
    },

    /** A started call's result as JSON, once it has one; null while it runs, and "unknown" if this page never started it. */
    take(callId) {
      if (!results.has(callId)) return 'unknown';
      const result = results.get(callId);
      if (!result) return null;
      results.delete(callId);
      return JSON.stringify(result);
    },
  };
})();
