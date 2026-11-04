'use strict';

// A WebMCP request (src/integration-webmcp-bridge.js), run once in the integration browser's page, in the page's world,
// where the page's tools are: its result is the script's, as JSON, so nothing of it stays in the page. The script
// answers its own failures. A page that navigates away while it runs ends it: Electron leaves a script's run waiting
// when its page goes, so the request ends when the page starts to go.

const fs = require('node:fs');
const path = require('node:path');

const WEBMCP = fs.readFileSync(path.join(__dirname, '..', 'src', 'integration-webmcp-bridge.js'), 'utf8');

function runWebMcp(contents, operation, request = {}) {
  const navigated = {
    kind: 'integration-webmcp-error',
    requestId: request.requestId,
    focusMainOnResult: request.focusMainOnResult === true,
    code: 'NavigationError',
    message: 'The page navigated during WebMCP execution.',
  };
  let leaving;
  const left = new Promise((resolve) => {
    leaving = (details) => {
      if (details.isMainFrame && !details.isSameDocument) resolve(navigated);
    };
    contents.on('did-start-navigation', leaving);
  });
  const ran = contents.executeJavaScript(`(${WEBMCP})(${JSON.stringify(operation)}, ${JSON.stringify(request)}).then(JSON.stringify)`)
    .then((text) => JSON.parse(text), () => navigated);
  return Promise.race([ran, left]).finally(() => contents.removeListener('did-start-navigation', leaving));
}

module.exports = { runWebMcp };
