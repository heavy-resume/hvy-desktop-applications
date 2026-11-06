(() => {
  if (window.top !== window || window.__hvyGalaxyInspector) return;
  // Every message to Galaxy carries the browser's token, which the host puts here when it injects this script (as a
  // CSRF token): hosts take only messages with it, so a frame the page embeds cannot speak for the inspector. The page's
  // own scripts can see it, so hosts take only what the page says this way, never what they report themselves.
  const MESSAGE_TOKEN = '__HVY_GALAXY_MESSAGE_TOKEN__';
  const messageUrl = (path) => `hvy-integration://${path}?t=${MESSAGE_TOKEN}`;

  const ids = ['hvy-galaxy-inspector-shield', 'hvy-galaxy-existing-matches', 'hvy-galaxy-inspector-scope', 'hvy-galaxy-inspector-highlight', 'hvy-galaxy-inspector-picker', 'hvy-galaxy-inspector-status', 'hvy-galaxy-pattern-matches', 'hvy-galaxy-ready-check-matches'];
  let active = false;
  let pickingPaused = false;
  // While picking: the timer that looks for a check that you're human, and whether picking paused for the one showing.
  let humanCheckTimer = null;
  let humanCheckPaused = false;
  let inspectionKind = 'target';
  let highlighted = null;
  let lastDiagnostics = null;
  let scopeSelector = null;
  let scopeElement = null;
  let scopeSnapshot = null;
  let scopeAnchorElement = null;
  let inspectionPattern = null;
  let liveMinimumConfidence = null;
  let matchOverlayCleanup = null;
  let selectionOverlayCleanup = null;
  let targetCollection = null;
  // While picking fields: takes back the last one picked (Escape).
  let undoLastPick = null;
  let commandRecorder = null;
  let commandRecordElements = null;
  // Picking one of a pattern's records (a site setup's example item: a row of the list): its matches, boxed, and what
  // to say when a pick is outside them.
  let recordChoice = null;
  // A range field being picked: where it starts, and whether the start is part of it. The next pick is where it ends.
  let rangeStart = null;
  let rangeStatus = null;
  // Changing one boundary of a range field picked before: the end it keeps while its start is picked again.
  let rangeKeptEnd = null;
  let rangeEditing = false;
  let toolbarControl = null;
  let inspectionContext = null;
  let captureSequence = 0;
  const host = window.__hvyGalaxyHost || {};
  const capturedElements = new Map();
  // The page's own requests (fetch and XMLHttpRequest), as the browser times them, for the APIs it reads: those from
  // before this was here, and each one after, as the browser's buffer of them fills (250). Each with its type where the
  // browser reports one (Chromium). Nothing of the page's is replaced to see them.
  const timedRequests = new Map();
  const timeRequests = (entries) => entries.forEach((entry) => {
    if (['fetch', 'xmlhttprequest'].includes(entry.initiatorType)) timedRequests.set(entry.name, entry.contentType || '');
  });
  timeRequests(performance.getEntriesByType('resource'));
  new PerformanceObserver((list) => timeRequests(list.getEntries())).observe({ type: 'resource' });

  const composedParent = (element) => {
    if (element?.parentElement) return element.parentElement;
    const root = element?.getRootNode?.();
    return root instanceof ShadowRoot ? root.host : null;
  };

  const composedContains = (ancestor, element) => {
    for (let node = element; node instanceof Element; node = composedParent(node)) {
      if (node === ancestor) return true;
    }
    return false;
  };

  const removeUi = () => {
    matchOverlayCleanup?.();
    matchOverlayCleanup = null;
    selectionOverlayCleanup?.();
    selectionOverlayCleanup = null;
    ids.forEach((id) => document.getElementById(id)?.remove());
    highlighted = null;
  };

  const pseudoEvidence = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    const content = style.content || '';
    const rendered = style.display !== 'none' && style.visibility !== 'hidden' && !['none', 'normal'].includes(content);
    const text = rendered && content !== '""' && content !== "''"
      ? content.replace(/^(['"])(.*)\1$/, '$2').replace(/\\(["'])/g, '$1').trim()
      : '';
    return {
      rendered,
      text,
      display: style.display,
      position: style.position,
      fontSize: Number.parseFloat(style.fontSize) || 0,
      fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
      hasBackground: style.backgroundColor !== 'transparent' || style.backgroundImage !== 'none',
    };
  };

  const pseudoElements = (element) => ({ before: pseudoEvidence(element, '::before'), after: pseudoEvidence(element, '::after') });

  const meaningfulText = (element) => {
    const nodeText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pseudo = pseudoElements(element);
    const directText = nodeText || [pseudo.before.text, pseudo.after.text].filter(Boolean).join(' ');
    const accessibleName = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || (element instanceof HTMLInputElement ? element.value : '')
      || '';
    return { directText, accessibleName: accessibleName.trim() };
  };

  // Ported from the Heavy Resume extension's description picker (src/content/dom.ts visible / extractDescription), so
  // a field picked as a container reads the way the extension reads a job description.
  const renderedVisibly = (element) => {
    for (let current = element; current; current = current.parentElement ?? current.getRootNode?.().host ?? null) {
      const style = getComputedStyle(current);
      if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };

  /**
   * Visible text only, keeping paragraph, list, and heading breaks; no scripts, hidden sections, or form controls. With a
   * range, only the text inside it: a range field reads everything between its start and end, in page order.
   */
  const readableText = (element, range = null) => {
    const parts = [];
    const visit = (node) => {
      if (range && !range.intersectsNode(node)) return;
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? '');
        return;
      }
      if (!(node instanceof Element) || !renderedVisibly(node) || node.matches('script,style,noscript,input,textarea,select,button,svg')) return;
      if (/^(P|DIV|SECTION|ARTICLE|LI|H[1-6]|BR)$/.test(node.tagName)) parts.push('\n');
      node.childNodes.forEach(visit);
      if (/^(P|DIV|SECTION|ARTICLE|LI|H[1-6])$/.test(node.tagName)) parts.push('\n');
    };
    visit(range ? range.commonAncestorContainer : element);
    return parts.join('').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 40000);
  };

  // A range field's boundaries: the end comes after the start and is not inside it, so whatever is between them is read.
  const followsStart = (start, element) => {
    const position = start.compareDocumentPosition(element);
    return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING) && !(position & Node.DOCUMENT_POSITION_CONTAINED_BY);
  };
  const textRangeBetween = (start, end, includeStart, includeEnd) => {
    const range = document.createRange();
    if (includeStart) range.setStartBefore(start);
    else range.setStartAfter(start);
    if (includeEnd) range.setEndAfter(end);
    else range.setEndBefore(end);
    return range;
  };

  const previewText = (text, fromEnd = false) => {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= 120) return compact;
    return fromEnd ? `…${compact.slice(-119)}` : `${compact.slice(0, 119)}…`;
  };

  const visibleText = (element) => {
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const pseudo = pseudoElements(element);
    return [pseudo.before.text, pseudo.after.text].filter(Boolean).join(' ');
  };

  // How a range field reads in the record type builder: 'Starts after "Job description" · Ends before "Apply now" · 3,812 characters'.
  const boundaryLabel = (element) => {
    const text = visibleText(element);
    return text.length > 40 ? `${text.slice(0, 39)}…` : text || element.tagName.toLowerCase();
  };
  const rangeSummary = (start, end, includeStart, includeEnd, text) => `${includeStart ? 'Starts at' : 'Starts after'} “${boundaryLabel(start)}” · ${includeEnd ? 'Ends at' : 'Ends before'} “${boundaryLabel(end)}” · ${text.length.toLocaleString()} characters`;

  const imageFor = (element) => {
    const image = element.matches('img') ? element : element.querySelector('img');
    if (image instanceof HTMLImageElement) {
      return {
        url: (image.currentSrc || image.src).slice(0, 4000),
        alt: image.alt || null,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    }
    const backgroundImage = getComputedStyle(element).backgroundImage;
    const backgroundUrl = backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!backgroundUrl) return null;
    return {
      url: new URL(backgroundUrl, location.href).href.slice(0, 4000),
      alt: element.getAttribute('aria-label') || element.getAttribute('title') || null,
      naturalWidth: 0,
      naturalHeight: 0,
    };
  };

  const isMeaningful = (element) => {
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status, #hvy-galaxy-inspector-shield, #hvy-galaxy-inspector-scope')) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const { directText, accessibleName } = meaningfulText(element);
    const pseudo = pseudoElements(element);
    return Boolean(directText || accessibleName || pseudo.before.rendered || pseudo.after.rendered || imageFor(element) || element.matches('button,a,input,textarea,select,[role],[contenteditable="true"]'));
  };

  const isParentCandidate = (element) => {
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status, #hvy-galaxy-inspector-shield, #hvy-galaxy-inspector-scope')) return false;
    if (element.matches('html,body,script,style,link,meta')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width >= 4
      && rect.height >= 4
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.contentVisibility !== 'hidden'
      && !element.closest('[hidden]');
  };

  const countTags = (elements) => elements.reduce((counts, element) => {
    const tag = element.tagName.toLowerCase();
    counts[tag] = (counts[tag] || 0) + 1;
    return counts;
  }, {});

  const tagFamily = (tag, role = null) => {
    if (role) return `role:${role}`;
    if (['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'li'].includes(tag)) return 'container';
    if (['span', 'p', 'strong', 'em', 'small', 'label', 'time'].includes(tag)) return 'text';
    if (tag === 'a') return 'link';
    if (['button', 'input', 'textarea', 'select', 'option'].includes(tag)) return 'control';
    if (['img', 'picture', 'svg', 'canvas', 'video'].includes(tag)) return 'media';
    return tag;
  };

  const tokenHash = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const structuralTokens = (element) => {
    const tokens = [...element.classList]
      .filter((value) => /^[a-z][a-z-]{1,48}$/i.test(value))
      .map((value) => `class:${value}`);
    for (const name of ['data-component', 'data-hvy-virtual-section', 'data-reader-action', 'aria-expanded']) {
      if (element.hasAttribute(name)) tokens.push(`${name}:${element.getAttribute(name)}`);
    }
    return [...new Set(tokens)].sort().map(tokenHash);
  };

  const semanticLineageTokens = (element) => {
    const tokens = [];
    for (let node = composedParent(element); node && tokens.length < 8; node = composedParent(node)) {
      const role = node.getAttribute('role');
      const component = node.getAttribute('data-component');
      if (role) tokens.push(`role:${role}`);
      if (component) tokens.push(`component:${component}`);
      if (node.matches('ul,ol,dl,table')) tokens.push(`landmark:${node.tagName.toLowerCase()}`);
    }
    return [...new Set(tokens)].sort().map(tokenHash);
  };

  const semanticIdentityTokens = (element) => {
    const tokens = [];
    const role = element.getAttribute('role');
    const component = element.getAttribute('data-component');
    const linkKind = element.getAttribute('data-hvy-link-kind');
    if (role) tokens.push(`role:${role}`);
    if (component) tokens.push(`component:${component}`);
    if (linkKind) tokens.push(`link-kind:${linkKind}`);
    return tokens.sort().map(tokenHash);
  };

  const identityHash = (kind, value) => {
    const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160) : '';
    return normalized ? tokenHash(`${kind}:${normalized}`) : null;
  };

  const controlIdentitySignature = (element) => {
    const labels = [];
    const addLabel = (kind, value) => {
      const hash = identityHash(kind, value);
      if (hash) labels.push(hash);
    };
    addLabel('aria-label', element.getAttribute('aria-label'));
    (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).forEach((id) => addLabel('labelled-by', document.getElementById(id)?.textContent || ''));
    if ('labels' in element && element.labels) [...element.labels].forEach((label) => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input,select,textarea,button,[role="combobox"]').forEach((control) => control.remove());
      addLabel('label', copy.textContent || '');
    });
    return {
      labels: [...new Set(labels)].sort(),
      formName: identityHash('name', element.getAttribute('name')),
      testId: identityHash('test-id', element.getAttribute('data-testid')),
      id: identityHash('id', element.id),
    };
  };

  const colorSignature = (value = '') => {
    const channels = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i);
    if (!channels) return { hue: 0, saturation: 0, lightness: 0, alpha: value === 'transparent' ? 0 : 1 };
    const [red, green, blue] = channels.slice(1, 4).map((channel) => Number.parseFloat(channel) / 255);
    const alpha = channels[4]?.endsWith('%') ? Number.parseFloat(channels[4]) / 100 : Number.parseFloat(channels[4] ?? '1');
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    const lightness = (maximum + minimum) / 2;
    const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
    let hue = 0;
    if (delta) {
      if (maximum === red) hue = ((green - blue) / delta) % 6;
      else if (maximum === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue = ((hue * 60 + 360) % 360) / 360;
    }
    return { hue, saturation, lightness, alpha };
  };

  const visualSignature = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const parentRect = composedParent(element)?.getBoundingClientRect();
    const fontSize = Number.parseFloat(style.fontSize) || 0;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2 || 1;
    const fontWeight = Number.parseInt(style.fontWeight, 10) || ({ normal: 400, bold: 700 }[style.fontWeight] || 400);
    const text = meaningfulText(element).directText;
    const borderWidths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map((value) => Number.parseFloat(value) || 0);
    const borderWidth = Math.max(...borderWidths);
    const radius = Math.max(...[style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map((value) => Number.parseFloat(value) || 0));
    const backgroundAlpha = style.backgroundColor === 'transparent'
      ? 0
      : Number.parseFloat(style.backgroundColor.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([\d.]+))?\)/)?.[1] ?? '1');
    const pseudo = pseudoElements(element);
    return {
      display: style.display.replace(/^inline-/, ''),
      position: style.position,
      flexDirection: style.flexDirection,
      textAlign: style.textAlign,
      fontSize,
      fontWeight: Math.round(fontWeight / 100) * 100,
      lineCount: text ? Math.max(1, Math.round(rect.height / lineHeight)) : 0,
      textLengthBucket: text.length < 24 ? 'short' : text.length < 80 ? 'medium' : 'long',
      truncated: style.textOverflow === 'ellipsis'
        || ((style.overflowX === 'hidden' || style.overflow === 'hidden') && element.scrollWidth > element.clientWidth),
      wraps: !['nowrap', 'pre'].includes(style.whiteSpace),
      widthRatio: parentRect?.width ? rect.width / parentRect.width : 1,
      heightRatio: parentRect?.height ? rect.height / parentRect.height : 1,
      xRatio: parentRect?.width ? (rect.left - parentRect.left) / parentRect.width : 0,
      yRatio: parentRect?.height ? (rect.top - parentRect.top) / parentRect.height : 0,
      viewportWidthRatio: innerWidth ? rect.width / innerWidth : 0,
      viewportHeightRatio: innerHeight ? rect.height / innerHeight : 0,
      viewportXRatio: innerWidth ? rect.left / innerWidth : 0,
      viewportYRatio: innerHeight ? rect.top / innerHeight : 0,
      bordered: borderWidth > 0 && [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle].some((value) => value !== 'none'),
      borderWidth,
      borderRadiusRatio: Math.min(1, radius / Math.max(1, Math.min(rect.width, rect.height))),
      hasBackground: backgroundAlpha > 0.05 || style.backgroundImage !== 'none',
      backgroundColor: colorSignature(style.backgroundColor),
      borderColor: colorSignature(style.borderTopColor),
      textColor: colorSignature(style.color),
      pseudoBefore: pseudo.before,
      pseudoAfter: pseudo.after,
      hasShadow: style.boxShadow !== 'none',
      paddingXRatio: ((Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)) / Math.max(1, rect.width),
      paddingYRatio: ((Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)) / Math.max(1, rect.height),
    };
  };

  const deepElements = (root, limit = Infinity) => {
    const initial = root instanceof Document
      ? [root.documentElement]
      : [...root.children, ...(root.shadowRoot ? [...root.shadowRoot.children] : [])];
    const pending = [...initial].reverse();
    const elements = [];
    while (pending.length && elements.length < limit) {
      const element = pending.pop();
      if (!(element instanceof Element)) continue;
      elements.push(element);
      const children = [...element.children];
      if (element.shadowRoot) children.push(...element.shadowRoot.children);
      pending.push(...children.reverse());
    }
    return elements;
  };

  // While a pattern is matched, each element's shape is taken once: matching compares every candidate box, and every
  // element inside each, and nested boxes share what is inside them, so on a large page the same elements were measured
  // over and over (seconds, in WebKit, on a board's results page). The page does not change while it is matched.
  let matchingShapes = null;
  const shapeSignature = (element) => {
    const known = matchingShapes?.get(element);
    if (known) return known;
    const shape = measureShape(element);
    matchingShapes?.set(element, shape);
    return shape;
  };
  const measureShape = (element) => {
    const descendants = deepElements(element, 300);
    const children = [...element.children];
    const ancestors = [];
    for (let node = composedParent(element); node && ancestors.length < 5; node = composedParent(node)) {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role');
      ancestors.push({ tag, role, family: tagFamily(tag, role), tokens: structuralTokens(node) });
    }
    let fullDepth = 0;
    for (let node = composedParent(element); node; node = composedParent(node)) fullDepth += 1;
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      family: tagFamily(element.tagName.toLowerCase(), element.getAttribute('role')),
      tokens: structuralTokens(element),
      semanticIdentity: semanticIdentityTokens(element),
      controlIdentity: controlIdentitySignature(element),
      semanticLineage: semanticLineageTokens(element),
      depth: fullDepth,
      childCount: children.length,
      descendantCount: descendants.length,
      childTags: countTags(children),
      descendantTags: countTags(descendants),
      textLeaves: descendants.filter((candidate) => meaningfulText(candidate).directText).length,
      imageCount: descendants.filter((candidate) => candidate.matches('img')).length,
      linkCount: descendants.filter((candidate) => candidate.matches('a')).length,
      controlCount: descendants.filter((candidate) => candidate.matches('button,input,textarea,select,[role="button"]')).length,
      ancestors,
      visual: visualSignature(element),
    };
  };

  const normalizedIdentityText = (value = '') => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160) : '';

  const scopeIdentity = (element, anchor = null) => {
    const values = [];
    const add = (kind, value) => {
      const normalized = normalizedIdentityText(value);
      if (normalized) values.push({ kind, value: normalized, label: String(value).replace(/\s+/g, ' ').trim().slice(0, 160) });
    };
    add('aria-label', element.getAttribute('aria-label'));
    add('title', element.getAttribute('title'));
    const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    labelledBy.forEach((id) => add('aria-labelledby', document.getElementById(id)?.textContent || ''));
    const anchorTop = anchor?.getBoundingClientRect().top ?? Infinity;
    const contextualText = deepElements(element, 100)
      .filter((candidate) => candidate !== anchor && (!anchor || !composedContains(anchor, candidate)))
      .map((candidate) => {
        const text = meaningfulText(candidate).directText;
        const rect = candidate.getBoundingClientRect();
        const role = candidate.getAttribute('role');
        const heading = /^h[1-6]$/i.test(candidate.tagName) || role === 'heading';
        const style = getComputedStyle(candidate);
        return { text, rect, heading, fontWeight: Number.parseInt(style.fontWeight, 10) || 400 };
      })
      .filter((candidate) => candidate.text && candidate.text.length <= 160 && candidate.rect.width > 0 && candidate.rect.height > 0 && candidate.rect.top <= anchorTop + 2)
      .sort((left, right) => Number(right.heading) - Number(left.heading) || left.rect.top - right.rect.top || Number(right.fontWeight >= 500) - Number(left.fontWeight >= 500));
    contextualText.slice(0, 1).forEach((candidate) => add(candidate.heading ? 'heading' : 'context', candidate.text));
    const unique = [...new Map(values.map((entry) => [`${entry.kind}:${entry.value}`, entry])).values()];
    return {
      label: unique[0]?.label || '',
      tokens: unique.map((entry) => tokenHash(`${entry.kind}:${entry.value}`)).sort(),
    };
  };

  const scopeShapeSignature = (element, anchor = null) => {
    const shape = shapeSignature(element);
    const identity = scopeIdentity(element, anchor);
    return { ...shape, scopeIdentity: identity.tokens };
  };

  const pathWithin = (element, parent) => {
    const path = [];
    for (let node = element; node instanceof Element && node !== parent; node = composedParent(node)) {
      const root = node.parentElement || (node.getRootNode() instanceof ShadowRoot ? node.getRootNode() : null);
      const siblings = root ? [...root.children].filter((candidate) => candidate.tagName === node.tagName) : [];
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role');
      path.push({ tag, role, family: tagFamily(tag, role), sameTagIndex: siblings.indexOf(node), sameTagCount: siblings.length });
    }
    return path;
  };

  const ratio = (left, right) => left === right ? 1 : Math.min(left, right) / Math.max(1, left, right);
  const histogramSimilarity = (left = {}, right = {}) => {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    if (!keys.length) return null;
    const dot = keys.reduce((sum, key) => sum + (left[key] || 0) * (right[key] || 0), 0);
    const leftLength = Math.sqrt(keys.reduce((sum, key) => sum + (left[key] || 0) ** 2, 0));
    const rightLength = Math.sqrt(keys.reduce((sum, key) => sum + (right[key] || 0) ** 2, 0));
    return leftLength && rightLength ? dot / (leftLength * rightLength) : 0;
  };
  const proximity = (left = 0, right = 0, scale = 1) => Math.max(0, 1 - Math.abs(left - right) / scale);
  const tagSimilarity = (left, right) => left === right ? 1 : tagFamily(left) === tagFamily(right) ? 0.72 : 0;
  const enumSimilarity = (left, right) => left === null || left === undefined || left === '' || right === null || right === undefined || right === ''
    ? null
    : left === right ? 1 : 0;
  const tokenSimilarity = (left = [], right = []) => {
    const leftSet = new Set(Array.isArray(left) ? left : []);
    const rightSet = new Set(Array.isArray(right) ? right : []);
    const union = new Set([...leftSet, ...rightSet]);
    if (!union.size) return null;
    return [...leftSet].filter((value) => rightSet.has(value)).length / union.size;
  };
  const identityValueSimilarity = (left, right) => {
    if (!left || !right) return null;
    return left === right ? 1 : 0;
  };
  const identityLabelSimilarity = (left = [], right = []) => {
    if (!left.length || !right.length) return null;
    const rightSet = new Set(right);
    return left.some((value) => rightSet.has(value)) ? 1 : 0;
  };
  const controlIdentitySimilarity = (left = {}, right = {}) => {
    const parts = [
      [identityLabelSimilarity(left.labels, right.labels), 0.55],
      [identityValueSimilarity(left.formName, right.formName), 0.30],
      [identityValueSimilarity(left.testId, right.testId), 0.10],
      [identityValueSimilarity(left.id, right.id), 0.05],
    ];
    return parts.some((part) => typeof part[0] === 'number') ? weightedSimilarity(parts) : null;
  };
  const weightedSimilarity = (parts) => {
    const evidence = parts.filter((part) => typeof part[0] === 'number' && Number.isFinite(part[0]));
    const weight = evidence.reduce((sum, part) => sum + part[1], 0);
    return weight ? evidence.reduce((sum, part) => sum + part[0] * part[1], 0) / weight : 0;
  };
  const colorSimilarity = (left = {}, right = {}) => {
    if ((left.alpha ?? 0) <= 0.05 && (right.alpha ?? 0) <= 0.05) return 1;
    if ((left.alpha ?? 0) <= 0.05 || (right.alpha ?? 0) <= 0.05) return 0;
    const hueDistance = Math.abs((left.hue ?? 0) - (right.hue ?? 0));
    const hueSimilarity = (left.saturation ?? 0) > 0.08 && (right.saturation ?? 0) > 0.08
      ? Math.max(0, 1 - Math.min(hueDistance, 1 - hueDistance) / 0.25)
      : 1;
    return weightedSimilarity([
      [hueSimilarity, 0.45],
      [proximity(left.saturation, right.saturation, 0.6), 0.2],
      [proximity(left.lightness, right.lightness, 0.6), 0.25],
      [proximity(left.alpha, right.alpha, 1), 0.1],
    ]);
  };
  const pseudoSimilarity = (left = {}, right = {}) => {
    if (!left.rendered && !right.rendered) return null;
    if (!left.rendered || !right.rendered) return 0;
    return weightedSimilarity([
      [enumSimilarity(left.display, right.display), 0.2],
      [enumSimilarity(left.position, right.position), 0.2],
      [proximity(left.fontSize, right.fontSize, 8), 0.2],
      [proximity(left.fontWeight, right.fontWeight, 500), 0.15],
      [enumSimilarity(left.hasBackground, right.hasBackground), 0.25],
    ]);
  };
  const visualSimilarity = (left = {}, right = {}) => weightedSimilarity([
    [enumSimilarity(left.display, right.display), 0.12],
    [enumSimilarity(left.position, right.position), 0.04],
    [enumSimilarity(left.flexDirection, right.flexDirection), 0.04],
    [enumSimilarity(left.textAlign, right.textAlign), 0.05],
    [proximity(left.fontSize, right.fontSize, 8), 0.14],
    [proximity(left.fontWeight, right.fontWeight, 500), 0.10],
    [proximity(left.lineCount, right.lineCount, 4), 0.09],
    [enumSimilarity(left.textLengthBucket, right.textLengthBucket), 0.05],
    [enumSimilarity(left.truncated, right.truncated), 0.09],
    [enumSimilarity(left.wraps, right.wraps), 0.05],
    [proximity(left.widthRatio, right.widthRatio, 0.75), 0.10],
    [proximity(left.heightRatio, right.heightRatio, 0.75), 0.05],
    [proximity(left.xRatio, right.xRatio, 0.75), 0.04],
    [proximity(left.yRatio, right.yRatio, 0.75), 0.04],
    [proximity(left.viewportWidthRatio, right.viewportWidthRatio, 0.75), 0.035],
    [proximity(left.viewportHeightRatio, right.viewportHeightRatio, 0.75), 0.025],
    [proximity(left.viewportXRatio, right.viewportXRatio, 0.75), 0.015],
    [proximity(left.viewportYRatio, right.viewportYRatio, 1), 0.005],
    [enumSimilarity(left.bordered, right.bordered), 0.08],
    [proximity(left.borderWidth, right.borderWidth, 3), 0.035],
    [proximity(left.borderRadiusRatio, right.borderRadiusRatio, 0.6), 0.07],
    [enumSimilarity(left.hasBackground, right.hasBackground), 0.06],
    [colorSimilarity(left.backgroundColor, right.backgroundColor), 0.10],
    [colorSimilarity(left.borderColor, right.borderColor), 0.04],
    [colorSimilarity(left.textColor, right.textColor), 0.03],
    [pseudoSimilarity(left.pseudoBefore, right.pseudoBefore), 0.06],
    [pseudoSimilarity(left.pseudoAfter, right.pseudoAfter), 0.04],
    [enumSimilarity(left.hasShadow, right.hasShadow), 0.035],
    [proximity(left.paddingXRatio, right.paddingXRatio, 0.5), 0.06],
    [proximity(left.paddingYRatio, right.paddingYRatio, 0.5), 0.06],
  ]);
  const shapeSimilarity = (left, right) => {
    if (!left || !right) return 0;
    const ancestorEvidence = (left.ancestors || []).slice(0, 5).flatMap((item, index) => {
      const other = right.ancestors?.[index];
      if (!other) return [];
      return [weightedSimilarity([
        [tagSimilarity(item.tag, other.tag), 0.2],
        [enumSimilarity(item.family, other.family), 0.15],
        [enumSimilarity(item.role, other.role), 0.1],
        [tokenSimilarity(item.tokens, other.tokens), 0.55],
      ])];
    });
    const ancestorMatches = ancestorEvidence.length
      ? ancestorEvidence.reduce((sum, score) => sum + score, 0) / ancestorEvidence.length
      : null;
    return weightedSimilarity([
      [tagSimilarity(left.tag, right.tag), 0.06],
      [enumSimilarity(left.family, right.family), 0.05],
      [enumSimilarity(left.role, right.role), 0.03],
      [histogramSimilarity(left.childTags, right.childTags), 0.06],
      [histogramSimilarity(left.descendantTags, right.descendantTags), 0.06],
      [ratio(left.childCount, right.childCount), 0.04],
      [ratio(left.descendantCount, right.descendantCount), 0.04],
      [ratio(left.textLeaves, right.textLeaves), 0.02],
      [ratio(left.imageCount, right.imageCount), 0.02],
      [ratio(left.linkCount, right.linkCount), 0.02],
      [ratio(left.controlCount, right.controlCount), 0.02],
      [ratio(left.depth, right.depth), 0.01],
      [tokenSimilarity(left.tokens, right.tokens), 0.03],
      [ancestorMatches, 0.10],
      [controlIdentitySimilarity(left.controlIdentity, right.controlIdentity), 0.18],
      [tokenSimilarity(left.semanticIdentity, right.semanticIdentity), 0.15],
      [tokenSimilarity(left.semanticLineage, right.semanticLineage), 0.19],
      [visualSimilarity(left.visual, right.visual), 0.10],
    ]);
  };
  const scopeSimilarity = (left, right) => {
    if (!left || !right) return 0;
    return weightedSimilarity([
      [tagSimilarity(left.tag, right.tag), 0.08],
      [enumSimilarity(left.family, right.family), 0.06],
      [enumSimilarity(left.role, right.role), 0.08],
      [tokenSimilarity(left.tokens, right.tokens), 0.10],
      [tokenSimilarity(left.semanticIdentity, right.semanticIdentity), 0.10],
      [tokenSimilarity(left.semanticLineage, right.semanticLineage), 0.10],
      [tokenSimilarity(left.scopeIdentity, right.scopeIdentity), 0.38],
      [visualSimilarity(left.visual, right.visual), 0.10],
    ]);
  };
  const resolvedScope = () => {
    if (scopeElement?.isConnected) return scopeElement;
    const exact = scopeSelector ? document.querySelector(scopeSelector) : null;
    if (exact) {
      scopeElement = exact;
      return exact;
    }
    const expectedShape = scopeSnapshot?.selected?.shape;
    if (!expectedShape) return null;
    const replacement = deepElements(document)
      .filter(isParentCandidate)
      .map((element) => ({ element, score: shapeSimilarity(expectedShape, shapeSignature(element)) }))
      .sort((left, right) => right.score - left.score)[0]?.element || null;
    scopeElement = replacement;
    return replacement;
  };
  const pathSimilarity = (left = [], right = []) => {
    left = Array.isArray(left) ? left : [];
    right = Array.isArray(right) ? right : [];
    if (!left.length && !right.length) return 1;
    const scores = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const leftNode = left[leftIndex - 1];
        const rightNode = right[rightIndex - 1];
        const nodeScore = weightedSimilarity([
          [tagSimilarity(leftNode.tag, rightNode.tag), 0.56],
          [enumSimilarity(leftNode.family, rightNode.family), 0.20],
          [enumSimilarity(leftNode.role, rightNode.role), 0.14],
          [ratio(leftNode.sameTagIndex, rightNode.sameTagIndex), 0.05],
          [ratio(leftNode.sameTagCount, rightNode.sameTagCount), 0.05],
        ]);
        scores[leftIndex][rightIndex] = Math.max(
          scores[leftIndex - 1][rightIndex],
          scores[leftIndex][rightIndex - 1],
          scores[leftIndex - 1][rightIndex - 1] + nodeScore,
        );
      }
    }
    return scores[left.length][right.length] / Math.max(left.length, right.length, 1);
  };
  const sharedAncestorDepth = (paths = []) => {
    if (paths.length < 2) return 0;
    const shortest = Math.min(...paths.map((path) => path.length));
    let shared = 0;
    for (let offset = 1; offset <= shortest; offset += 1) {
      const nodes = paths.map((path) => path[path.length - offset]);
      if (nodes.slice(1).every((node) => tagSimilarity(nodes[0].tag, node.tag) >= 0.72 && nodes[0].role === node.role)) shared += 1;
      else break;
    }
    return shared;
  };
  const sharedElementAncestorDepth = (elements, parent) => {
    const ancestry = elements.map((element) => {
      const ancestors = [];
      for (let node = composedParent(element); node && node !== parent; node = composedParent(node)) ancestors.push(node);
      return ancestors;
    });
    if (ancestry.length < 2) return 0;
    const shortest = Math.min(...ancestry.map((path) => path.length));
    let shared = 0;
    for (let offset = 1; offset <= shortest; offset += 1) {
      const nodes = ancestry.map((path) => path[path.length - offset]);
      if (nodes.slice(1).every((node) => node === nodes[0])) shared += 1;
      else break;
    }
    return shared;
  };
  const targetRelationshipSimilarity = (targets, matchedTargets, parent) => {
    if (targets.length < 2) return 1;
    const expectedPaths = targets.map((target) => target.snapshot.selected.relativePath || []);
    const matchedPaths = matchedTargets.map((target) => pathWithin(target.element, parent));
    const expectedSharedDepth = sharedAncestorDepth(expectedPaths);
    const matchedSharedDepth = sharedElementAncestorDepth(matchedTargets.map((target) => target.element), parent);
    const sharedContainerScore = expectedSharedDepth === 0 ? 1 : Math.min(1, matchedSharedDepth / expectedSharedDepth);
    const expectedDepthSpread = Math.max(...expectedPaths.map((path) => path.length)) - Math.min(...expectedPaths.map((path) => path.length));
    const matchedDepthSpread = Math.max(...matchedPaths.map((path) => path.length)) - Math.min(...matchedPaths.map((path) => path.length));
    return sharedContainerScore * 0.8 + proximity(expectedDepthSpread, matchedDepthSpread, 3) * 0.2;
  };

  // A check that you're human, as sites show them: Cloudflare's (its challenge page and Turnstile), hCaptcha, and reCAPTCHA,
  // when it can be seen (not reCAPTCHA's invisible badge).
  const HUMAN_CHECKS = 'iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="/recaptcha/"], #challenge-form, #challenge-stage, .cf-turnstile, .h-captcha, .g-recaptcha';
  const humanCheckOnPage = () => [...document.querySelectorAll(HUMAN_CHECKS)].some((element) => {
    if (element instanceof HTMLIFrameElement && /[?&]size=invisible\b/.test(element.src)) return false;
    if (element.getAttribute('data-size') === 'invisible') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
  const HUMAN_CHECK_STATUS = 'The page is checking you’re human · finish it, then Resume picking';

  const cssEscape = (value) => window.CSS?.escape ? window.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const cssPath = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${cssEscape(node.id)}`);
        break;
      }
      const sameTag = node.parentElement ? [...node.parentElement.children].filter((candidate) => candidate.tagName === node.tagName) : [];
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };

  const resolveDiagnosticElement = (selector) => {
    if (!selector) return null;
    const roots = [document, ...deepElements(document).map((element) => element.shadowRoot).filter(Boolean)];
    for (const root of roots) {
      try {
        const match = root.querySelector(selector);
        if (match) return match;
      } catch (_) {
        return null;
      }
    }
    return null;
  };

  const resolveCapturedElement = (selected) => {
    if (selected?.captureId) {
      const captured = capturedElements.get(selected.captureId)?.deref();
      return captured?.isConnected ? captured : null;
    }
    return resolveDiagnosticElement(selected?.cssPath);
  };

  const semanticSummary = (element) => {
    const { directText, accessibleName } = meaningfulText(element);
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      hasAccessibleName: Boolean(accessibleName),
      directTextLength: directText.length,
      stableAttributes: Object.fromEntries(['id', 'name', 'type', 'data-testid', 'aria-label']
        .filter((name) => element.hasAttribute(name))
        .map((name) => [name, name === 'aria-label' ? '{{ACCESSIBLE_NAME}}' : (element.getAttribute(name) || '').slice(0, 200)])),
    };
  };

  const semanticAncestry = (element) => {
    const ancestry = [];
    for (let node = element; node instanceof Element && ancestry.length < 8; node = node.parentElement) ancestry.push(semanticSummary(node));
    return ancestry;
  };

  const nearbyFields = (element) => {
    const container = element.parentElement;
    if (!container) return [];
    return [...container.children]
      .filter((candidate) => candidate !== element && isMeaningful(candidate))
      .slice(0, 12)
      .map(semanticSummary);
  };

  const repeatedContext = (element) => {
    for (let container = element.parentElement; container instanceof Element; container = container.parentElement) {
      const siblings = container.parentElement ? [...container.parentElement.children].filter((candidate) => candidate.tagName === container.tagName && candidate.className === container.className) : [];
      if (siblings.length < 2) continue;
      return {
        item: semanticSummary(container),
        itemCount: siblings.length,
        sampleItems: siblings.slice(0, 5).map((item) => ({
          textLength: (item.innerText || '').replace(/\s+/g, ' ').trim().length,
          fields: [...item.children].filter(isMeaningful).slice(0, 10).map(semanticSummary),
        })),
      };
    }
    return null;
  };

  const selectorCandidates = (element) => {
    const candidates = [];
    if (element.id) candidates.push({ kind: 'id', value: element.id });
    for (const name of ['data-testid', 'name', 'aria-label']) {
      if (element.hasAttribute(name)) candidates.push({ kind: 'attribute', name, value: (element.getAttribute(name) || '').slice(0, 300) });
    }
    const { accessibleName } = meaningfulText(element);
    if (element.getAttribute('role') || accessibleName) candidates.push({ kind: 'semantic', role: element.getAttribute('role'), usesAccessibleName: Boolean(accessibleName) });
    candidates.push({ kind: 'cssPath', value: cssPath(element).slice(0, 600) });
    return candidates;
  };

  const snapshot = (element) => {
    const { directText, accessibleName } = meaningfulText(element);
    const rect = element.getBoundingClientRect();
    const usefulAttributes = ['id', 'class', 'name', 'type', 'href', 'title', 'aria-label', 'data-testid'];
    const scope = resolvedScope();
    const captureId = `capture-${++captureSequence}`;
    capturedElements.set(captureId, typeof WeakRef === 'function' ? new WeakRef(element) : { deref: () => element });
    return {
      kind: 'integration-inspection',
      inspectionKind,
      ...(inspectionContext ? { context: inspectionContext } : {}),
      page: { origin: location.origin, pathname: location.pathname, userAgent: navigator.userAgent },
      selected: {
        captureId,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        directText: inspectionKind === 'parent' || inspectionKind === 'scope' ? '' : directText.slice(0, 300),
        accessibleName: inspectionKind === 'parent' || inspectionKind === 'scope' ? '' : accessibleName.slice(0, 300),
        descendantText: inspectionKind === 'parent' || inspectionKind === 'scope' ? '' : (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800),
        ...(inspectionKind === 'scope' ? { scopeLabel: scopeIdentity(element, scopeAnchorElement).label } : {}),
        cssPath: cssPath(element).slice(0, 600),
        attributes: Object.fromEntries(usefulAttributes
          .filter((name) => element.hasAttribute(name))
          .map((name) => [name, (element.getAttribute(name) || '').slice(0, 240)])),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        image: inspectionKind === 'parent' || inspectionKind === 'scope' ? null : imageFor(element),
        semanticAncestry: semanticAncestry(element),
        nearbyFields: inspectionKind === 'parent' || inspectionKind === 'scope' ? [] : nearbyFields(element),
        repeatedContext: inspectionKind === 'parent' || inspectionKind === 'scope' ? null : repeatedContext(element),
        selectorCandidates: selectorCandidates(element),
        shape: inspectionKind === 'scope' ? scopeShapeSignature(element, scopeAnchorElement) : shapeSignature(element),
        relativePath: scope instanceof Element && composedContains(scope, element) ? pathWithin(element, scope) : null,
        pagePath: pathWithin(element, document.documentElement),
        scopeCssPath: scope instanceof Element ? cssPath(scope) : null,
      },
    };
  };

  // A message to Galaxy, through the host's own channel where it gives one (`__hvyGalaxyHost`: Electron's preload, in the
  // isolated world this runs in, out of the page's reach), or else as a navigation carrying the token, which the page
  // can see.
  const sendMessage = (path, value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.location.href = messageUrl(`${path}/${encoded}`);
  };

  const publish = (value) => {
    if (host.publish) host.publish(value);
    else sendMessage('inspection', value);
  };

  // With the browser's own toolbar, what picking says and its buttons are shown there, off the page, so they cover
  // nothing on it: the status panel is built as usual, kept off the page, and copied to the toolbar each time it changes.
  // The toolbar's buttons click the panel's (by `data-toolbar-id`). A step that takes typing (a sample value, a choice
  // of option) shows the panel on the page while it lasts, beside what it is typed into.
  let toolbarSession = 0;
  const mirrorStatusToToolbar = (status, statusText) => {
    const session = ++toolbarSession;
    let pending = 0;
    const sync = () => {
      pending = 0;
      if (!active || session !== toolbarSession) return;
      const takesTyping = Boolean(status.querySelector('textarea,input,select,[data-command-recorder-input]'));
      if (takesTyping && !status.isConnected) document.documentElement.append(status);
      if (!takesTyping && status.isConnected) status.remove();
      publishToolbarState({
        active: true,
        status: statusText.textContent,
        buttons: [...status.querySelectorAll('button[data-toolbar-id]')].filter((button) => !button.hidden).map((button) => ({
          id: button.dataset.toolbarId,
          label: button.textContent,
          primary: button.dataset.toolbarPrimary === 'true',
          disabled: button.disabled,
        })),
      });
    };
    new MutationObserver(() => { if (!pending) pending = setTimeout(sync, 0); })
      .observe(status, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    toolbarControl = (id) => status.querySelector(`button[data-toolbar-id="${CSS.escape(String(id))}"]`)?.click();
    sync();
  };

  const publishToolbarState = (value) => {
    if (host.toolbarState) host.toolbarState(value);
    else sendMessage('toolbar-state', value);
  };

  const snapshotByteLength = (element) => new TextEncoder().encode(JSON.stringify(snapshot(element))).byteLength;

  const highlight = (element, textRange = null) => {
    highlighted = element;
    let box = document.getElementById('hvy-galaxy-inspector-highlight');
    if (!box) {
      box = document.createElement('div');
      box.id = 'hvy-galaxy-inspector-highlight';
      box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e0563f;background:#e0563f2b;box-sizing:border-box;color:#fff;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 0 0 1px #fff8 inset';
      document.documentElement.append(box);
    }
    const rect = textRange ? textRange.getBoundingClientRect() : element.getBoundingClientRect();
    const left = Math.max(2, rect.left);
    const top = Math.max(2, rect.top);
    const right = Math.min(innerWidth - 2, rect.right);
    const bottom = Math.min(innerHeight - 2, rect.bottom);
    Object.assign(box.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.max(2, right - left)}px`,
      height: `${Math.max(2, bottom - top)}px`,
    });
    box.textContent = textRange
      ? `Range · ${readableText(null, textRange).length.toLocaleString()} characters`
      : `${targetCollection ? 'Add field · ' : ''}${element.tagName.toLowerCase()}`;
    box.style.padding = '3px 5px';
  };

  // The elements under a point that hit testing skips (`pointer-events: none`, as a card its title link covers sets on its
  // text, so a click anywhere opens the link): from an element it found, down through the child whose box holds the
  // point (the last such, painted on top), innermost first. Hit testing gives the innermost first, so a walk stops at an
  // element one before it reached (`seen`): an outer element's walk ends at once, rather than measuring the same path again.
  const elementsWithinAt = (element, x, y, seen) => {
    const found = [];
    for (let node = element; node;) {
      node = [...node.children].reverse().find((child) => {
        const rect = child.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) ?? null;
      if (!node || seen.has(node)) break;
      found.unshift(node);
    }
    return found;
  };

  const elementsBehindInspector = (x, y) => {
    const visitedRoots = new Set();
    const seen = new Set();
    const collect = (root) => {
      if (visitedRoots.has(root)) return [];
      visitedRoots.add(root);
      const hits = typeof root.elementsFromPoint === 'function' ? root.elementsFromPoint(x, y) : [];
      const result = [];
      hits.forEach((element) => {
        if (element.shadowRoot) result.push(...collect(element.shadowRoot));
        const within = elementsWithinAt(element, x, y, seen);
        for (const found of [...within, element]) seen.add(found);
        result.push(...within, element);
      });
      return result;
    };
    return [...new Set(collect(document))]
      .filter((element) => !element.closest?.('#hvy-galaxy-inspector-shield, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status, #hvy-galaxy-inspector-picker'));
  };

  const candidatesAt = (x, y, target, composedPath = []) => {
    const hitStack = elementsBehindInspector(x, y);
    const underlyingTarget = hitStack[0] || target;
    const lightDomChain = [];
    for (let node = underlyingTarget; node instanceof Element; node = node.parentElement) lightDomChain.push(node);
    const shadowDomChain = [...hitStack, ...composedPath.filter((node) => node instanceof Element)];
    const chain = [...new Set([...shadowDomChain, ...lightDomChain])];
    if (inspectionKind === 'parent' || inspectionKind === 'scope') {
      const scopeChain = [];
      for (let node = scopeAnchorElement || underlyingTarget; node instanceof Element; node = composedParent(node)) scopeChain.push(node);
      const candidates = [...new Set(inspectionKind === 'scope' ? scopeChain : [...hitStack, ...chain])]
        .filter(isParentCandidate)
        .filter((element) => commandRecordElements === null || commandRecordElements.has(element))
        .filter((element) => inspectionKind !== 'parent' || !scopeElement || composedContains(scopeElement, element))
        .filter((element) => inspectionKind !== 'scope' || !element.matches('html,body'))
        .filter((element) => inspectionKind !== 'scope' || !scopeAnchorElement || (element !== scopeAnchorElement && composedContains(element, scopeAnchorElement)))
        .filter((element) => inspectionKind !== 'scope' || deepElements(element, 3).length >= 2)
        .filter((element, index, all) => all.findIndex((candidate) => candidate === element) === index)
        .slice(0, 12);
      const describeStructure = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].slice(0, 3).map((name) => `.${name}`).join('')}`,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      };
      lastDiagnostics = {
        pointer: { x: Math.round(x), y: Math.round(y) },
        hitStack: hitStack.slice(0, 12).map(describeStructure),
        scannedAncestors: chain.slice(0, 12).map(describeStructure),
        candidates: candidates.map(describeStructure),
        frame: window.top === window ? 'top' : 'child',
      };
      return candidates;
    }
    const examinedImages = new Set();
    const imagesBehindTarget = [];
    if (inspectionKind === 'target') {
      for (const container of chain.slice(0, 10)) {
        for (const image of container.querySelectorAll('img')) {
          examinedImages.add(image);
          const rect = image.getBoundingClientRect();
          if (rect.width && rect.height && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            imagesBehindTarget.push(image);
          }
        }
      }
    }
    const directlyRendersImage = (element) => element.matches('img') || getComputedStyle(element).backgroundImage !== 'none';
    const elementCandidates = [...new Set([...imagesBehindTarget, ...hitStack, ...chain])]
      .filter((element) => inspectionKind === 'parent' ? isParentCandidate(element) : isMeaningful(element))
      .filter((element) => inspectionKind !== 'target' || !(scopeElement || scopeSelector || scopeSnapshot) || composedContains(resolvedScope(), element))
      .sort((left, right) => Number(directlyRendersImage(right)) - Number(directlyRendersImage(left)))
      .filter((element, index, all) => {
        const signatureFor = (candidate) => {
          if (inspectionKind === 'parent') return cssPath(candidate);
          const image = imageFor(candidate);
          if (image?.url) return `image|${image.url}`;
          const text = meaningfulText(candidate);
          return `${candidate.tagName}|${candidate.getAttribute('role')}|${text.directText}|${text.accessibleName}`;
        };
        const signature = signatureFor(element);
        return all.findIndex((candidate) => signatureFor(candidate) === signature) === index;
      })
      .slice(0, 10);
    // A field can also be a section holding its text in children, such as a job description of paragraphs and lists, as
    // the Heavy Resume extension's description picker offers: enclosing elements inside the record, without repeating
    // text already offered.
    const offeredText = new Set(elementCandidates.map((element) => readableText(element).replace(/\s+/g, ' ')));
    const containerCandidates = inspectionKind !== 'target' || commandRecorder ? [] : chain
      .filter((element) => !elementCandidates.includes(element) && !element.matches('html,body,script,style,noscript,svg,iframe,frame,input,textarea,select,button'))
      .filter((element) => !(scopeElement || scopeSelector || scopeSnapshot) || (element !== resolvedScope() && composedContains(resolvedScope(), element)))
      .filter((element) => {
        const text = readableText(element).replace(/\s+/g, ' ');
        if (text.length < 10 || offeredText.has(text)) return false;
        offeredText.add(text);
        return true;
      })
      .slice(0, 4);
    const candidates = [...elementCandidates, ...containerCandidates]
      .filter((element) => !rangeStart || followsStart(rangeStart.element, element))
      .filter((element) => !rangeKeptEnd || followsStart(element, rangeKeptEnd.element));
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].slice(0, 3).map((name) => `.${name}`).join('')}`,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        imageUrl: imageFor(element)?.url || null,
      };
    };
    lastDiagnostics = {
      pointer: { x: Math.round(x), y: Math.round(y) },
      hitStack: hitStack.slice(0, 12).map(describe),
      eventTarget: describe(target),
      composedTarget: shadowDomChain[0] ? describe(shadowDomChain[0]) : null,
      scannedAncestors: chain.slice(0, 10).map(describe),
      examinedImages: [...examinedImages].slice(0, 20).map(describe),
      imagesContainingPointer: imagesBehindTarget.map(describe),
      candidates: candidates.map(describe),
      candidateSnapshotBytes: inspectionKind === 'target' ? candidates.map((element) => ({ element: describe(element).element, bytes: snapshotByteLength(element) })) : [],
      frame: window.top === window ? 'top' : 'child',
    };
    return candidates;
  };

  const showPicker = (event) => {
    document.getElementById('hvy-galaxy-inspector-picker')?.remove();
    const candidates = candidatesAt(event.clientX, event.clientY, event.target, event.composedPath());
    const picker = document.createElement('div');
    picker.id = 'hvy-galaxy-inspector-picker';
    picker.style.cssText = `position:fixed;z-index:2147483647;left:${Math.max(8, Math.min(event.clientX, innerWidth - 428))}px;top:${Math.max(8, Math.min(event.clientY, innerHeight - 348))}px;width:420px;max-height:340px;overflow:auto;padding:6px;border:1px solid #82958b;border-radius:8px;background:#f7f3ea;color:#152223;box-shadow:0 10px 30px #0005;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
    const heading = document.createElement('div');
    heading.textContent = commandRecorder
      ? inspectionKind === 'parent' ? 'Choose the record for this command' : 'Choose the interaction target'
      : inspectionKind === 'scope' ? 'Choose the section that should contain matching items' : inspectionKind === 'parent' ? 'Choose the parent containing one complete item'
        : rangeStart ? candidates.length ? 'Choose where the range ends' : 'Pick something after the start'
          : rangeKeptEnd ? candidates.length ? 'Choose where the range starts' : 'Pick something before the end' : 'Choose data inside the selected parent';
    // A field can be a range: everything from one element to another, for text split across sections with no container
    // of its own. Its start and end are picked from this list too, and apply to the highlighted choice.
    const offersRange = inspectionKind === 'target' && !commandRecorder;
    let chosen = candidates[0] || null;
    const rangeTo = (element, includeEnd) => textRangeBetween(rangeStart.element, element, rangeStart.includeStart, includeEnd);
    heading.style.cssText = 'padding:7px 8px;font-weight:700;border-bottom:1px solid #c5cec8';
    picker.append(heading);
    candidates.forEach((element) => {
      const parentLike = inspectionKind === 'parent' || inspectionKind === 'scope';
      const { directText, accessibleName } = parentLike ? { directText: '', accessibleName: '' } : meaningfulText(element);
      const completeText = parentLike ? '' : visibleText(element);
      const image = parentLike ? null : imageFor(element);
      const choice = document.createElement('button');
      choice.type = 'button';
      const structuralLabel = element.id ? `#${element.id}` : [...element.classList].slice(0, 2).map((name) => `.${name}`).join('') || 'container';
      choice.textContent = parentLike
        ? `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${inspectionKind === 'scope' ? scopeIdentity(element, scopeAnchorElement).label || structuralLabel : structuralLabel}`
        : `${image ? '🖼️ ' : ''}${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${(completeText || directText || accessibleName || (image ? image.alt || 'image' : 'control')).slice(0, 100)}`;
      choice.style.cssText = 'display:block;width:100%;padding:8px;border:0;border-bottom:1px solid #dde3df;background:transparent;color:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer';
      if (!parentLike && !commandRecorder && !isMeaningful(element)) {
        // A section holding its text in children: compare where it starts and ends, as the extension's picker shows.
        const text = readableText(element);
        const lines = [
          [`${element.tagName.toLowerCase()}${structuralLabel === 'container' ? '' : structuralLabel} · ${text.length.toLocaleString()} characters`, 'font-weight:700'],
          [`Starts  ${previewText(text)}`, 'color:#31413e'],
          [`Ends  ${previewText(text, true)}`, 'color:#31413e'],
        ];
        choice.replaceChildren(...lines.map(([line, style]) => {
          const row = document.createElement('span');
          row.textContent = line;
          row.style.cssText = `display:block;overflow:hidden;text-overflow:ellipsis;${style}`;
          return row;
        }));
      }
      choice.dataset.pickerChoice = 'true';
      choice.addEventListener('mouseenter', () => {
        picker.querySelectorAll('[data-picker-choice]').forEach((button) => { button.style.background = 'transparent'; });
        choice.style.background = '#dce8e1';
        chosen = element;
        highlight(element, rangeStart ? rangeTo(element, true) : null);
      });
      choice.addEventListener('click', () => {
        if (rangeStart) {
          finishRange(element, true);
          return;
        }
        if (rangeKeptEnd) {
          beginRange(element, true);
          return;
        }
        if (inspectionKind === 'parent') scopeElement = element;
        const result = snapshot(element);
        if (inspectionKind === 'parent' && inspectionPattern) {
          result.suggestedTargets = suggestTargetsForParent(element, inspectionPattern);
        }
        if (inspectionKind === 'target' && targetCollection) {
          targetCollection.add(element, result);
          picker.remove();
          return;
        }
        if (commandRecorder) {
          picker.remove();
          commandRecorder.select(element, result);
          return;
        }
        publish(result);
        window.__hvyGalaxyInspector.stop();
      });
      picker.append(choice);
    });
    if (offersRange && candidates.length) {
      const rangeActions = document.createElement('div');
      rangeActions.style.cssText = 'display:flex;gap:6px;padding:7px 8px;border-top:1px solid #c5cec8';
      const rangeAction = (label, onChoose) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText = 'flex:1;padding:6px 8px;border:1px solid #9aa9a1;border-radius:6px;background:#fff;color:#31413e;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer';
        button.addEventListener('click', () => { if (chosen) onChoose(chosen); });
        rangeActions.append(button);
      };
      if (rangeStart) {
        rangeAction('End here', (element) => finishRange(element, true));
        rangeAction('End before this', (element) => finishRange(element, false));
      } else {
        rangeAction('Start a range here', (element) => beginRange(element, true));
        rangeAction('Start after this', (element) => beginRange(element, false));
      }
      picker.append(rangeActions);
    }
    const diagnostics = document.createElement('details');
    diagnostics.style.cssText = 'padding:7px 8px;border-top:1px solid #c5cec8';
    const diagnosticsSummary = document.createElement('summary');
    diagnosticsSummary.textContent = 'Inspection diagnostics';
    diagnosticsSummary.style.cssText = 'cursor:pointer;font-weight:600';
    const diagnosticsText = document.createElement('pre');
    diagnosticsText.textContent = JSON.stringify(lastDiagnostics, null, 2);
    diagnosticsText.style.cssText = 'margin:7px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;font:10px ui-monospace,SFMono-Regular,Menlo,monospace';
    diagnostics.append(diagnosticsSummary, diagnosticsText);
    picker.append(diagnostics);
    document.documentElement.append(picker);
    if (candidates[0]) {
      const firstChoice = picker.querySelector('[data-picker-choice]');
      if (firstChoice) firstChoice.style.background = '#dce8e1';
      highlight(candidates[0], rangeStart ? rangeTo(candidates[0], true) : null);
    }
  };

  /**
   * A page with one record (a job's own page, or the pane a list shows it in): its fields are picked with no box first,
   * and the box is the smallest one around them all (a range's end too). The pane, when the job shows in one beside
   * the list: what tells its title from the rows' titles. Each field is then recorded within it, as if it had been
   * picked first.
   */
  const recordAround = (fields) => {
    const elements = fields.flatMap((field) => [field.selected, field.range?.end?.selected]).filter(Boolean).map(resolveCapturedElement).filter(Boolean);
    const containing = [];
    for (let node = elements[0]; node instanceof Element; node = composedParent(node)) {
      if (elements.every((element) => composedContains(node, element))) containing.push(node);
    }
    const box = containing.find(isParentCandidate) || containing[0];
    const within = (selected) => window.__hvyGalaxyInspector.snapshotElement(resolveCapturedElement(selected), box, 'target');
    return {
      parent: window.__hvyGalaxyInspector.snapshotElement(box, box, 'parent'),
      items: fields.map((field) => ({
        ...within(field.selected),
        ...(field.range ? { range: { ...field.range, end: within(field.range.end.selected) } } : {}),
        ...(field.fieldId ? { fieldId: field.fieldId } : {}),
      })),
    };
  };

  const setRangeStatus = (text) => {
    if (rangeStart) rangeStart.status = text;
    rangeStatus?.();
  };

  const beginRange = (element, includeStart) => {
    document.getElementById('hvy-galaxy-inspector-picker')?.remove();
    rangeStart = { element, includeStart, status: '' };
    if (rangeKeptEnd) {
      const { element: end, includeEnd } = rangeKeptEnd;
      rangeKeptEnd = null;
      finishRange(end, includeEnd);
      return;
    }
    setRangeStatus('Pick where the range ends · Esc cancels the range');
  };

  /**
   * Where a boundary of a range picked before is on the page now: the element inside the record that best fits its
   * example, as a field is matched.
   */
  const rangeBoundaryElement = (selected) => {
    const parent = resolvedScope();
    if (!parent || !selected?.shape) return null;
    return structuralTargetsWithin(parent)
      .map((candidate) => ({ element: candidate, score: targetCandidateSimilarity(selected, candidate, parent).score }))
      .sort((left, right) => right.score - left.score)[0]?.element || null;
  };

  // The range becomes one field: its start's example, with where it ends and whether each boundary is part of it.
  const finishRange = (end, includeEnd) => {
    document.getElementById('hvy-galaxy-inspector-picker')?.remove();
    const { element: start, includeStart } = rangeStart;
    rangeStart = null;
    rangeStatus?.();
    const textRange = textRangeBetween(start, end, includeStart, includeEnd);
    const result = snapshot(start);
    result.range = { includeStart, includeEnd, end: snapshot(end), summary: rangeSummary(start, end, includeStart, includeEnd, readableText(null, textRange)) };
    if (targetCollection) {
      targetCollection.add(start, result, textRange);
      return;
    }
    publish(result);
    window.__hvyGalaxyInspector.stop();
  };

  // What the page gets a click on at a point, beneath the inspector: the topmost element there as hit testing finds it
  // (not what it lets clicks through), into shadow roots.
  const pageElementAt = (x, y) => {
    let found = null;
    for (let root = document; root;) {
      const element = root.elementsFromPoint(x, y).find((candidate) => !isInspectorElement(candidate));
      if (!element || element === found) break;
      found = element;
      root = element.shadowRoot;
    }
    return found;
  };

  // Picking a record by what opens it: what a click at the pointer lands on (`opener`), and the record it is in, one of
  // the matches (found again if the page replaced them).
  const recordChoiceAt = (event) => {
    if (recordChoice.matches.some((match) => !match.element.isConnected)) recordChoice.matches = findPatternMatches(inspectionPattern);
    const opener = pageElementAt(event.clientX, event.clientY);
    const match = opener ? recordChoice.matches.find((candidate) => composedContains(candidate.element, opener)) : null;
    return match ? { match, opener } : null;
  };

  // The pointer's moves (pointermove and mousemove, and those a scroll makes under it), handled once a frame: the latest.
  // Where it is, what it is over, and its path are kept as it moves, as the path is gone once the event is over.
  let pendingMove = null;
  let moveFrame = 0;
  const pointerMove = (event) => {
    const path = event.composedPath();
    pendingMove = { clientX: event.clientX, clientY: event.clientY, target: event.target, composedPath: () => path };
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      const move = pendingMove;
      pendingMove = null;
      if (move) pointerMoveNow(move);
    });
  };
  const pointerMoveNow = (event) => {
    if (!active || pickingPaused || !(event.target instanceof Element)) return;
    if (event.target.closest('#hvy-galaxy-inspector-picker')) return;
    if (recordChoice) {
      const choice = recordChoiceAt(event);
      if (choice) highlight(choice.opener);
      else {
        document.getElementById('hvy-galaxy-inspector-highlight')?.remove();
        highlighted = null;
      }
      return;
    }
    const candidate = candidatesAt(event.clientX, event.clientY, event.target, event.composedPath())[0];
    if (rangeStart) {
      if (!candidate) {
        document.getElementById('hvy-galaxy-inspector-highlight')?.remove();
        highlighted = null;
        setRangeStatus('Pick something after the start');
        return;
      }
      if (candidate === highlighted) return;
      const textRange = textRangeBetween(rangeStart.element, candidate, rangeStart.includeStart, true);
      const text = readableText(null, textRange);
      highlight(candidate, textRange);
      setRangeStatus(`Pick where the range ends · Ends ${previewText(text, true)} · ${text.length.toLocaleString()} characters`);
      return;
    }
    if (candidate && candidate !== highlighted) highlight(candidate);
  };
  const click = (event) => {
    if (!active || pickingPaused || event.target instanceof Element && event.target.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-status')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (recordChoice) {
      const choice = recordChoiceAt(event);
      if (!choice) {
        recordChoice.refuse();
        return;
      }
      publish({
        kind: 'integration-record-choice',
        ...(inspectionContext ? { context: inspectionContext } : {}),
        record: serializeMatches([choice.match], true).records[0],
        // Where it is in the record, so it is found in every row, and the link clicking it follows, if any.
        opener: { snapshot: window.__hvyGalaxyInspector.snapshotElement(choice.opener, choice.match.element, 'target'), href: openedHref(choice.opener) },
      });
      window.__hvyGalaxyInspector.stop();
      return;
    }
    showPicker(event);
  };
  const keydown = (event) => {
    // Escape while picking a range's end cancels the range; the fields already picked are kept.
    if (active && rangeStart && !rangeEditing && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      rangeStart = null;
      document.getElementById('hvy-galaxy-inspector-picker')?.remove();
      document.getElementById('hvy-galaxy-inspector-highlight')?.remove();
      highlighted = null;
      rangeStatus?.();
      return;
    }
    // Escape while picking fields takes back the last one picked, as Undo last does; with none picked, it does nothing.
    // It never leaves picking (Done and the toolbar do).
    if (active && undoLastPick && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      undoLastPick();
      return;
    }
    if (active && event.key === 'Escape') {
      if (host.cancel) host.cancel();
      else window.location.href = messageUrl('inspection-cancel');
      window.__hvyGalaxyInspector.stop();
    }
  };

  const isStructuralTargetCandidate = (element) => {
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status, #hvy-galaxy-inspector-shield, #hvy-galaxy-inspector-scope, #hvy-galaxy-pattern-matches')) return false;
    if (element.matches('script,style,link,meta,template')) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.contentVisibility !== 'hidden'
      && !element.closest('[hidden]');
  };

  const structuralTargetsWithin = (root, includeRoot = false) => [
    ...(includeRoot && root instanceof Element ? [root] : []),
    ...deepElements(root),
  ].filter(isStructuralTargetCandidate);

  const elementsOverlap = (left, right) => left === right || composedContains(left, right) || composedContains(right, left);

  const targetSnapshots = (target) => (target.snapshots?.length ? target.snapshots : [target.snapshot]).filter((snapshotValue) => snapshotValue?.selected);
  const learnedNestedRelationship = (leftTarget, rightTarget) => targetSnapshots(leftTarget).some((leftSnapshot) => targetSnapshots(rightTarget).some((rightSnapshot) => {
    const left = leftSnapshot.selected;
    const right = rightSnapshot.selected;
    if (!left.scopeCssPath || left.scopeCssPath !== right.scopeCssPath || !left.cssPath || !right.cssPath || left.cssPath === right.cssPath) return false;
    return left.cssPath.startsWith(`${right.cssPath} > `) || right.cssPath.startsWith(`${left.cssPath} > `);
  }));

  const targetCandidateSimilarity = (expected, candidate, parent) => {
    const shapeScore = shapeSimilarity(expected.shape, shapeSignature(candidate));
    const relativePathScore = pathSimilarity(expected.relativePath, pathWithin(candidate, parent));
    return { shapeScore, relativePathScore, score: shapeScore * 0.74 + relativePathScore * 0.26 };
  };

  /**
   * Where a range field ends in a record: the element after its start that best fits the saved end. When the end appears
   * more than once, such as an Apply button above and below a posting, the first of the closest fits is taken.
   */
  const rangeEndFor = (range, start, parent, minimumTargetConfidence) => {
    const expected = range?.end?.selected;
    if (!expected?.shape) return null;
    const ends = structuralTargetsWithin(parent)
      .filter((candidate) => followsStart(start, candidate))
      .map((candidate) => ({ element: candidate, score: targetCandidateSimilarity(expected, candidate, parent).score }))
      .filter((candidate) => candidate.score >= minimumTargetConfidence);
    if (!ends.length) return null;
    const best = Math.max(...ends.map((candidate) => candidate.score));
    return ends.find((candidate) => best - candidate.score < 0.035);
  };

  /**
   * What opens a row's item (a list's `opener`): the element in the row that best fits the one picked. Not a field, so
   * it may be one's element too (the title link). When it fits more than once, the first of the closest fits is taken.
   */
  const openerWithin = (row, opener, minimumTargetConfidence) => {
    const expected = opener?.selected;
    if (!expected?.shape) return null;
    const fits = structuralTargetsWithin(row, !expected.relativePath?.length)
      .map((candidate) => ({ element: candidate, score: targetCandidateSimilarity(expected, candidate, row).score }))
      .filter((candidate) => candidate.score >= minimumTargetConfidence);
    if (!fits.length) return null;
    const best = Math.max(...fits.map((candidate) => candidate.score));
    return fits.find((candidate) => best - candidate.score < 0.035).element;
  };

  // Whether a matched field is the only one on its element. A range field reads between its boundaries, so it may start
  // at another field (the title it starts after) and is not counted.
  const uniqueTargetElement = (target, matchedTargets) => Boolean(target.textRange)
    || matchedTargets.filter((other) => !other.textRange && other.element === target.element).length === 1;

  const patternScopes = (pattern = {}) => {
    const expected = pattern.scope?.selected?.shape;
    if (!expected) return [{ element: document, score: 1 }];
    const { minimumConfidence } = patternThresholds(pattern);
    return deepElements(document)
      .filter(isParentCandidate)
      .map((element) => ({ element, score: scopeSimilarity(expected, scopeShapeSignature(element)) }))
      .filter((candidate) => candidate.score >= minimumConfidence)
      .sort((left, right) => right.score - left.score)
      .filter((candidate, index, candidates) => !candidates.slice(0, index).some((accepted) => composedContains(accepted.element, candidate.element) || composedContains(candidate.element, accepted.element)));
  };

  const evaluateParentCandidate = (element, parentScore, targets, minimumTargetConfidence = 0.74) => {
    const targetEvaluations = targets.map((target, fieldIndex) => {
      const variants = (target.snapshots?.length ? target.snapshots : [target.snapshot]).filter((variant) => variant?.selected?.shape);
      const negativeVariants = (target.negativeSnapshots || []).filter((variant) => variant?.selected?.shape);
      const includeParent = variants.some((variant) => !variant.selected.relativePath?.length);
      const matches = structuralTargetsWithin(element, includeParent).map((candidate, candidateIndex) => {
        const positive = variants.map((variant, variantIndex) => {
          const expected = variant.selected;
          return { element: candidate, ...targetCandidateSimilarity(expected, candidate, element), variantIndex, matchedSnapshot: variant };
        }).sort((left, right) => right.score - left.score)[0];
        const negativeScore = Math.max(0, ...negativeVariants.map((variant) => {
          return targetCandidateSimilarity(variant.selected, candidate, element).score;
        }));
        const rejectedByNegative = negativeScore >= minimumTargetConfidence && negativeScore >= positive.score - 0.035;
        return { ...positive, fieldIndex, candidateIndex, positiveScore: positive.score, negativeScore, rejectedByNegative, score: rejectedByNegative ? 0 : positive.score };
      }).sort((left, right) => right.score - left.score);
      return { target, fieldIndex, matches };
    });
    const assigned = new Map();
    const occupied = [];
    targetEvaluations
      .flatMap((evaluation) => evaluation.matches)
      .sort((left, right) => right.score - left.score || left.fieldIndex - right.fieldIndex || left.candidateIndex - right.candidateIndex)
      .forEach((match) => {
        if (assigned.has(match.fieldIndex)) return;
        if (match.matchedSnapshot?.range) {
          assigned.set(match.fieldIndex, match);
          return;
        }
        const conflicts = occupied.filter((entry) => elementsOverlap(entry.element, match.element));
        if (conflicts.some((entry) => entry.element === match.element
          || !learnedNestedRelationship(targets[entry.fieldIndex], targets[match.fieldIndex]))) return;
        assigned.set(match.fieldIndex, match);
        occupied.push({ fieldIndex: match.fieldIndex, element: match.element, score: match.score });
      });
    const matchedTargets = targetEvaluations.map(({ target, fieldIndex, matches }) => {
      const best = assigned.get(fieldIndex);
      const cardinality = target.cardinality === 'list' ? 'list' : 'single';
      const optional = target.optional === true;
      const range = best?.matchedSnapshot?.range;
      if (range) {
        // A range field is its start and end: without an end in this record it is missing, not cut short.
        const end = rangeEndFor(range, best.element, element, minimumTargetConfidence);
        if (!end) return { label: target.label, cardinality: 'single', optional, score: 0, elements: [] };
        const score = (best.score + end.score) / 2;
        const textRange = textRangeBetween(best.element, end.element, range.includeStart === true, range.includeEnd === true);
        return { label: target.label, cardinality: 'single', optional, ...best, score, end: end.element, textRange, elements: [{ ...best, score }] };
      }
      const elements = best ? [best] : [];
      if (cardinality === 'list' && best && best.score >= minimumTargetConfidence) {
        matches.forEach((match) => {
          if (match === best || match.score < minimumTargetConfidence || best.score - match.score >= 0.035) return;
          if (occupied.some((entry) => entry.fieldIndex !== fieldIndex && elementsOverlap(entry.element, match.element))) return;
          if (elements.some((entry) => elementsOverlap(entry.element, match.element))) return;
          elements.push(match);
          occupied.push({ fieldIndex, element: match.element, score: match.score });
        });
      }
      return { label: target.label, cardinality, optional, ...best, elements };
    });
    const scoredTargetIndexes = matchedTargets.flatMap((target, index) => !target.optional || target.element && target.score >= minimumTargetConfidence ? [index] : []);
    const scoredTargets = scoredTargetIndexes.map((index) => matchedTargets[index]);
    const scoredDefinitions = scoredTargetIndexes.map((index) => ({ ...targets[index], snapshot: matchedTargets[index].matchedSnapshot }));
    const targetScore = scoredTargets.length ? scoredTargets.reduce((sum, target) => sum + (target.score || 0), 0) / scoredTargets.length : 0;
    const hasRelationships = scoredTargets.length > 1;
    const relationshipScore = hasRelationships && scoredTargets.every((target) => target.element)
      ? targetRelationshipSimilarity(scoredDefinitions, scoredTargets, element)
      : 0;
    return {
      element,
      parentScore,
      matchedTargets,
      relationshipScore,
      score: !scoredTargets.length
        ? parentScore
        : hasRelationships
          ? parentScore * 0.45 + targetScore * 0.45 + relationshipScore * 0.1
          : parentScore * 0.55 + targetScore * 0.45,
    };
  };

  const patternThresholds = (pattern = {}) => {
    const minimumConfidence = typeof pattern.minimumConfidence === 'number' ? Math.max(0.5, Math.min(0.95, pattern.minimumConfidence)) : 0.85;
    return { minimumConfidence, minimumTargetConfidence: Math.max(0.5, minimumConfidence - 0.11) };
  };

  const suggestTargetsForParent = (element, pattern = {}) => {
    const { minimumTargetConfidence } = patternThresholds(pattern);
    const parentShapes = (pattern.parents || []).map((sample) => sample?.selected?.shape).filter(Boolean);
    const parentScore = Math.max(0, ...parentShapes.map((shape) => shapeSimilarity(shape, shapeSignature(element))));
    const targets = (pattern.targets || []).filter((target) => target?.snapshot?.selected?.shape || target?.snapshots?.some((variant) => variant?.selected?.shape));
    const evaluated = evaluateParentCandidate(element, parentScore, targets, minimumTargetConfidence);
    return evaluated.matchedTargets.map((target) => {
      if (!target.element || target.score < minimumTargetConfidence || !uniqueTargetElement(target, evaluated.matchedTargets)) return { label: target.label, score: target.score || 0, snapshot: null };
      const previousKind = inspectionKind;
      const previousScope = scopeElement;
      inspectionKind = 'target';
      scopeElement = element;
      const suggestedSnapshot = (suggested) => {
        const fullSnapshot = snapshot(suggested);
        return {
          kind: fullSnapshot.kind,
          inspectionKind: fullSnapshot.inspectionKind,
          selected: {
            tag: fullSnapshot.selected.tag,
            role: fullSnapshot.selected.role,
            directText: fullSnapshot.selected.directText,
            descendantText: fullSnapshot.selected.descendantText,
            cssPath: fullSnapshot.selected.cssPath,
            shape: fullSnapshot.selected.shape,
            relativePath: fullSnapshot.selected.relativePath,
          },
        };
      };
      const targetSnapshot = suggestedSnapshot(target.element);
      // A range field's example in this record is its start and end here.
      if (target.textRange) {
        const { includeStart, includeEnd } = target.matchedSnapshot.range;
        targetSnapshot.range = { includeStart, includeEnd, end: suggestedSnapshot(target.end), summary: rangeSummary(target.element, target.end, includeStart, includeEnd, readableText(null, target.textRange)) };
      }
      inspectionKind = previousKind;
      scopeElement = previousScope;
      return { label: target.label, score: target.score, snapshot: targetSnapshot };
    });
  };

  // `within`: only elements inside these (elements the page added), not the whole page.
  const evaluatePatternCandidates = (pattern = {}, within = null) => {
    const outermost = matchingShapes === null;
    if (outermost) matchingShapes = new WeakMap();
    try {
      return evaluatePatternCandidatesNow(pattern, within);
    } finally {
      if (outermost) matchingShapes = null;
    }
  };
  const evaluatePatternCandidatesNow = (pattern = {}, within = null) => {
    const { minimumConfidence, minimumTargetConfidence } = patternThresholds(pattern);
    const parentShapes = (pattern.parents || []).map((sample) => sample?.selected?.shape).filter(Boolean);
    const targets = (pattern.targets || []).filter((target) => target?.snapshot?.selected?.shape || target?.snapshots?.some((variant) => variant?.selected?.shape));
    const scopes = patternScopes(pattern);
    const candidates = within
      ? within.flatMap((root) => [root, ...deepElements(root)]).filter((element) => scopes.some((scope) => element !== scope.element && (scope.element === document ? element.isConnected : composedContains(scope.element, element))))
      : scopes.flatMap((scope) => deepElements(scope.element).filter((element) => element !== scope.element));
    return [...new Set(candidates)]
      .filter(isParentCandidate)
      .map((element) => ({ element, parentScore: Math.max(0, ...parentShapes.map((shape) => shapeSimilarity(shape, shapeSignature(element)))) }))
      .filter((candidate) => candidate.parentScore >= Math.max(0.5, minimumConfidence - 0.13))
      .map((candidate) => {
        const evaluated = evaluateParentCandidate(candidate.element, candidate.parentScore, targets, minimumTargetConfidence);
        const presentTargets = evaluated.matchedTargets.filter((target) => !target.textRange && (!target.optional || target.element && target.score >= minimumTargetConfidence));
        const targetElements = presentTargets.map((target) => target.element).filter(Boolean);
        const distinctTargets = new Set(targetElements).size === targetElements.length;
        const targetsPass = evaluated.matchedTargets.every((target) => target.optional || target.element && target.score >= minimumTargetConfidence);
        const hasMatchedTarget = !targets.length || evaluated.matchedTargets.some((target) => target.element && target.score >= minimumTargetConfidence);
        const hasLearnedAbsence = evaluated.matchedTargets.some((target) => target.optional && target.rejectedByNegative);
        const accepted = (hasMatchedTarget || hasLearnedAbsence) && targetsPass && distinctTargets && evaluated.score >= minimumConfidence;
        return {
          ...evaluated,
          distinctTargets,
          targetsPass,
          accepted,
          minimumConfidence,
          minimumTargetConfidence,
          ...(accepted && pattern.opener ? { opener: openerWithin(candidate.element, pattern.opener, minimumTargetConfidence) } : {}),
        };
      });
  };

  const findPatternMatches = (pattern = {}, within = null) => {
    const parentCandidates = evaluatePatternCandidates(pattern, within)
      .filter((candidate) => candidate.accepted)
      .sort((left, right) => right.parentScore - left.parentScore || right.score - left.score);
    const accepted = [];
    for (const candidate of parentCandidates) {
      if (accepted.some((match) => composedContains(match.element, candidate.element) || composedContains(candidate.element, match.element))) continue;
      accepted.push(candidate);
      if (accepted.length >= 50) break;
    }
    return accepted;
  };

  const diagnosticShapeSummary = (shape = {}) => ({
    element: { tag: shape.tag, family: shape.family, role: shape.role },
    structure: {
      depth: shape.depth,
      children: shape.childCount,
      descendants: shape.descendantCount,
      textLeaves: shape.textLeaves,
      images: shape.imageCount,
      links: shape.linkCount,
      controls: shape.controlCount,
      structuralTokens: shape.tokens?.length || 0,
      semanticIdentityTokens: shape.semanticIdentity?.length || 0,
      semanticLineageTokens: shape.semanticLineage?.length || 0,
    },
    visual: shape.visual,
  });

  const diagnosticPathSummary = (path = []) => (Array.isArray(path) ? path : []).map((node) => ({
    tag: node.tag,
    family: node.family,
    role: node.role,
    sameTagIndex: node.sameTagIndex,
    sameTagCount: node.sameTagCount,
  }));

  const comparisonValue = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === 'object' ? item.tag || JSON.stringify(item) : item).join(' › ') : '—';
    if (typeof value === 'object') {
      if ('hue' in value) return `h ${(value.hue * 360).toFixed(0)}° · s ${(value.saturation * 100).toFixed(0)}% · l ${(value.lightness * 100).toFixed(0)}% · a ${value.alpha.toFixed(2)}`;
      return JSON.stringify(value);
    }
    return String(value);
  };

  const renderTraitComparison = (container, diagnostics, reveal) => {
    container.replaceChildren();
    const addSection = (title, scoreText, example, topMatch, field = null, exampleElement = null, topMatchElement = null, exactExampleElementConnected = false) => {
      const section = document.createElement('section');
      section.style.cssText = 'display:grid;gap:7px';
      const heading = document.createElement('div');
      heading.style.cssText = 'display:flex;justify-content:space-between;gap:16px;font:700 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
      const headingTitle = document.createElement('span');
      headingTitle.textContent = title;
      const headingScore = document.createElement('span');
      headingScore.textContent = scoreText;
      const revealButton = document.createElement('button');
      revealButton.type = 'button';
      revealButton.textContent = 'Show on page';
      revealButton.disabled = !exampleElement && !topMatchElement;
      revealButton.style.cssText = 'margin-left:auto;padding:3px 7px;border:1px solid #ffffff66;border-radius:5px;background:#ffffff12;color:#fff;font:700 10px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer';
      revealButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        reveal(title, exampleElement, topMatchElement);
      });
      heading.append(headingTitle, revealButton, headingScore);
      const table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;table-layout:fixed;font:11px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      ['Trait', 'Saved example', 'Top live candidate'].forEach((label, index) => {
        const cell = document.createElement('th');
        cell.textContent = label;
        cell.style.cssText = `width:${index ? '39%' : '22%'};padding:5px 7px;text-align:left;border-bottom:1px solid #ffffff55;color:#fff`;
        headRow.append(cell);
      });
      head.append(headRow);
      const body = document.createElement('tbody');
      const rows = [
        ['Original selection', exactExampleElementConnected ? 'Still connected' : 'Replaced or unavailable', topMatchElement ? 'Located' : 'Not located'],
        ['Element', example?.shape?.element?.tag, topMatch?.shape?.element?.tag],
        ['Family', example?.shape?.element?.family, topMatch?.shape?.element?.family],
        ['Role', example?.shape?.element?.role, topMatch?.shape?.element?.role],
        ['DOM path', example?.path, topMatch?.path],
        ['Depth', example?.shape?.structure?.depth, topMatch?.shape?.structure?.depth],
        ['Children', example?.shape?.structure?.children, topMatch?.shape?.structure?.children],
        ['Descendants', example?.shape?.structure?.descendants, topMatch?.shape?.structure?.descendants],
        ['Text leaves', example?.shape?.structure?.textLeaves, topMatch?.shape?.structure?.textLeaves],
        ['Controls', example?.shape?.structure?.controls, topMatch?.shape?.structure?.controls],
        ['Display', example?.shape?.visual?.display, topMatch?.shape?.visual?.display],
        ['Font size', example?.shape?.visual?.fontSize, topMatch?.shape?.visual?.fontSize],
        ['Font weight', example?.shape?.visual?.fontWeight, topMatch?.shape?.visual?.fontWeight],
        ['Width in parent', example?.shape?.visual?.widthRatio, topMatch?.shape?.visual?.widthRatio],
        ['Height in parent', example?.shape?.visual?.heightRatio, topMatch?.shape?.visual?.heightRatio],
        ['X in parent', example?.shape?.visual?.xRatio, topMatch?.shape?.visual?.xRatio],
        ['Y in parent', example?.shape?.visual?.yRatio, topMatch?.shape?.visual?.yRatio],
        ['Background', example?.shape?.visual?.backgroundColor, topMatch?.shape?.visual?.backgroundColor],
        ['Text color', example?.shape?.visual?.textColor, topMatch?.shape?.visual?.textColor],
        ['Border', example?.shape?.visual?.bordered, topMatch?.shape?.visual?.bordered],
        ['Radius', example?.shape?.visual?.borderRadiusRatio, topMatch?.shape?.visual?.borderRadiusRatio],
        ['::before rendered', example?.shape?.visual?.pseudoBefore?.rendered, topMatch?.shape?.visual?.pseudoBefore?.rendered],
        ['::after rendered', example?.shape?.visual?.pseudoAfter?.rendered, topMatch?.shape?.visual?.pseudoAfter?.rendered],
      ];
      if (field) rows.unshift(['Score components', `Shape ${Math.round(field.shapeScore * 100)}%`, `Path ${Math.round(field.relativePathScore * 100)}%`]);
      rows.forEach(([label, saved, live]) => {
        const row = document.createElement('tr');
        [label, comparisonValue(saved), comparisonValue(live)].forEach((value, index) => {
          const cell = document.createElement(index ? 'td' : 'th');
          cell.textContent = value;
          cell.style.cssText = `padding:5px 7px;text-align:left;vertical-align:top;border-bottom:1px solid #ffffff22;overflow-wrap:anywhere;${index ? 'font-weight:500' : 'font-weight:700;color:#ffffffbb'}`;
          row.append(cell);
        });
        body.append(row);
      });
      table.append(head, body);
      section.append(heading, table);
      container.append(section);
    };
    addSection('Parent', `${Math.round(diagnostics.bestParentScore * 100)}%`, { shape: diagnostics.parentComparison.example, path: [] }, { shape: diagnostics.parentComparison.topMatch, path: [] }, null, diagnostics.parentComparison.exampleElement, diagnostics.parentComparison.topMatchElement, diagnostics.parentComparison.exactExampleElementConnected);
    diagnostics.fields.forEach((field) => addSection(field.label || 'Field', `${Math.round(field.score * 100)}% total`, field.example, field.topMatch, field, field.exampleElement, field.topMatchElement, field.exactExampleElementConnected));
  };

  const diagnosePattern = (pattern = {}) => {
    const { minimumTargetConfidence } = patternThresholds(pattern);
    const parentShapes = (pattern.parents || []).map((sample) => sample?.selected?.shape).filter(Boolean);
    const targets = (pattern.targets || []).filter((target) => target?.snapshot?.selected?.shape || target?.snapshots?.some((variant) => variant?.selected?.shape));
    const rankedParents = deepElements(document)
      .filter(isParentCandidate)
      .map((element) => {
        const shape = shapeSignature(element);
        return { element, shape, score: Math.max(0, ...parentShapes.map((expected) => shapeSimilarity(expected, shape))) };
      })
      .sort((left, right) => right.score - left.score);
    const bestParent = rankedParents[0];
    const evaluated = bestParent ? evaluateParentCandidate(bestParent.element, bestParent.score, targets, minimumTargetConfidence) : null;
    const diagnosticTargetElements = evaluated?.matchedTargets.map((target) => target.element).filter(Boolean) || [];
    const distinctTargets = new Set(diagnosticTargetElements).size === diagnosticTargetElements.length;
    return {
      inspectedElements: rankedParents.length,
      parentExamples: parentShapes.length,
      targetFields: targets.length,
      bestParentScore: bestParent?.score || 0,
      aggregateScore: evaluated?.score || 0,
      relationshipScore: evaluated?.relationshipScore || 0,
      distinctTargets,
      fields: targets.map((target) => {
        const expected = (target.snapshots?.find((variant) => variant?.selected?.shape) || target.snapshot).selected;
        const best = bestParent
          ? structuralTargetsWithin(bestParent.element, !expected.relativePath?.length).map((element) => {
            return {
              element,
              ...targetCandidateSimilarity(expected, element, bestParent.element),
              shape: shapeSignature(element),
              path: pathWithin(element, bestParent.element),
            };
          }).sort((left, right) => right.score - left.score)[0]
          : null;
        return {
          label: target.label,
          score: best?.score || 0,
          shapeScore: best?.shapeScore || 0,
          relativePathScore: best?.relativePathScore || 0,
          example: { shape: diagnosticShapeSummary(expected.shape), path: diagnosticPathSummary(expected.relativePath) },
          topMatch: best ? { shape: diagnosticShapeSummary(best.shape), path: diagnosticPathSummary(best.path) } : null,
          exampleElement: resolveCapturedElement(expected),
          exactExampleElementConnected: Boolean(expected.captureId && capturedElements.get(expected.captureId)?.deref()?.isConnected),
          topMatchElement: best?.element || null,
        };
      }),
      parentComparison: {
        example: diagnosticShapeSummary(parentShapes[0]),
        topMatch: diagnosticShapeSummary(bestParent?.shape),
        exampleElement: resolveCapturedElement(pattern.parents?.[0]?.selected),
        exactExampleElementConnected: Boolean(pattern.parents?.[0]?.selected?.captureId && capturedElements.get(pattern.parents[0].selected.captureId)?.deref()?.isConnected),
        topMatchElement: bestParent?.element || null,
      },
    };
  };

  const linkHref = (element) => {
    const anchor = element.closest?.('a[href]') || element.querySelector?.('a[href]');
    return anchor ? new URL(anchor.getAttribute('href'), location.href).href : null;
  };

  // The link clicking an element follows: its own, or the link it is in. A box with a link somewhere inside it does not
  // follow it when clicked, so it has none (what it opens, it opens by its script).
  const openedHref = (element) => {
    const anchor = element.closest?.('a[href]');
    return anchor ? new URL(anchor.getAttribute('href'), location.href).href : null;
  };

  const extractedValue = (element) => {
    const { directText, accessibleName } = meaningfulText(element);
    // Line breaks kept, so a section of paragraphs and lists reads as it does on the page.
    const completeText = readableText(element) || visibleText(element);
    if (completeText) return completeText;
    if (directText) return directText;
    if (accessibleName) return accessibleName;
    const image = imageFor(element);
    return image ? { imageUrl: image.url, alt: image.alt } : '';
  };

  const normalizedReadyValue = (value) => (typeof value === 'string' ? value : JSON.stringify(value))
    .replace(/\s+/g, ' ')
    .trim();

  const pageReadiness = (checks = {}) => {
    const mode = ['strict-url', 'strict-domain', 'domain-regex'].includes(checks.urlMode) ? checks.urlMode : 'strict-url';
    const expected = typeof checks.urlValue === 'string' ? checks.urlValue.trim() : '';
    let urlReady = false;
    if (mode === 'strict-url') urlReady = location.href === expected;
    if (mode === 'strict-domain') urlReady = location.hostname === expected;
    if (mode === 'domain-regex') {
      try { urlReady = new RegExp(expected).test(location.hostname); } catch (_) { urlReady = false; }
    }
    const results = (Array.isArray(checks.elements) ? checks.elements : []).map((check) => {
      const match = resolveInteractionTarget(document, check.snapshot, 0.8, 'click');
      if (match.status !== 'matched') return { id: check.id, name: check.name, ready: false, reason: 'element_not_found' };
      if (typeof check.expectedValue !== 'string' || !check.expectedValue.trim()) {
        return { id: check.id, name: check.name, ready: true };
      }
      const actual = normalizedReadyValue(extractedValue(match.element));
      return {
        id: check.id,
        name: check.name,
        ready: actual === normalizedReadyValue(check.expectedValue),
        reason: actual === normalizedReadyValue(check.expectedValue) ? undefined : 'value_changed',
      };
    });
    const failed = results.filter((result) => !result.ready);
    const ready = urlReady && failed.length === 0;
    const message = !urlReady
      ? mode === 'strict-url' ? 'The browser is not at the exact configured URL.' : 'The browser is not at the configured domain.'
      : failed.length
        ? failed[0].reason === 'value_changed'
          ? `The ready check value changed: ${failed[0].name || 'Page landmark'}.`
          : `The page is missing the ready check: ${failed[0].name || 'Page landmark'}.`
        : '';
    return { ready, urlReady, elements: results, message };
  };

  const isTextEntryElement = (element) => element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'tel', 'url', 'password'].includes(element.type)
    || element instanceof HTMLElement && element.isContentEditable;

  const isNativeSelectControl = (element) => element instanceof HTMLSelectElement;

  const isDataListControl = (element) => element instanceof HTMLInputElement && element.list instanceof HTMLDataListElement;

  const isPopupSelectControl = (element) => element instanceof Element
    && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox');

  const isSelectControl = (element) => isNativeSelectControl(element)
    || isDataListControl(element)
    || isPopupSelectControl(element);

  // A page number's text in a pager: "3", or nothing when the element shows something else.
  const pageNumberText = (element) => {
    const text = visibleText(element);
    return /^\d+$/.test(text) ? Number(text) : null;
  };

  // With a page number, the target is the one like the recorded one (a link in the same pager) that shows that number:
  // a recorded "2" finds "3" on page 2, as the pager's other numbers are its siblings.
  const resolveInteractionTarget = (scope, snapshotValue, minimumConfidence, gesture, pageNumber = null) => {
    const expected = snapshotValue?.selected;
    if (!expected?.shape) return { status: 'no_match', reason: 'target_pattern_missing' };
    const candidates = structuralTargetsWithin(scope, scope instanceof Element && !expected.relativePath?.length)
      .filter((element) => gesture !== 'type' || isTextEntryElement(element))
      .filter((element) => gesture !== 'select' || isSelectControl(element))
      .filter((element) => pageNumber === null || pageNumberText(element) === pageNumber)
      .map((element) => {
        if (scope instanceof Element) return { element, ...targetCandidateSimilarity(expected, element, scope) };
        const shapeScore = shapeSimilarity(expected.shape, shapeSignature(element));
        const relativePathScore = expected.pagePath ? pathSimilarity(expected.pagePath, pathWithin(element, document.documentElement)) : 1;
        return { element, shapeScore, relativePathScore, score: expected.pagePath ? shapeScore * 0.74 + relativePathScore * 0.26 : shapeScore };
      })
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    if (!best || best.score < minimumConfidence) return { status: 'no_match', reason: 'target_not_found', score: best?.score || 0 };
    const tied = candidates[1] && best.score - candidates[1].score < 0.01;
    if (tied) return { status: 'ambiguous', reason: 'target_tied', score: best.score };
    return { status: 'matched', ...best };
  };

  const dispatchInteraction = (element, gesture) => {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (gesture === 'right-click') {
      const options = { bubbles: true, cancelable: true, composed: true, view: window, button: 2, buttons: 2 };
      if (typeof PointerEvent === 'function') element.dispatchEvent(new PointerEvent('pointerdown', { ...options, pointerType: 'mouse' }));
      element.dispatchEvent(new MouseEvent('mousedown', options));
      if (typeof PointerEvent === 'function') element.dispatchEvent(new PointerEvent('pointerup', { ...options, pointerType: 'mouse', buttons: 0 }));
      element.dispatchEvent(new MouseEvent('mouseup', { ...options, buttons: 0 }));
      return element.dispatchEvent(new MouseEvent('contextmenu', options));
    }
    if (gesture === 'double-click') {
      element.click();
      element.click();
      return element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, view: window, button: 0, detail: 2 }));
    }
    element.click();
    return true;
  };

  const dispatchTextEntry = (element, text) => {
    const isTextInput = element instanceof HTMLInputElement;
    const isTextArea = element instanceof HTMLTextAreaElement;
    const isEditableContent = element instanceof HTMLElement && element.isContentEditable;
    if (!isTextEntryElement(element)) return false;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    element.focus();
    element.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    }));
    if (isTextInput) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, text);
    } else if (isTextArea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, text);
    } else {
      element.textContent = text;
    }
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  };

  const popupOptionElements = (element) => {
    const controlledIds = `${element.getAttribute('aria-controls') || ''} ${element.getAttribute('aria-owns') || ''}`
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const controlledRoots = controlledIds
      .map((id) => document.getElementById(id))
      .filter((candidate) => candidate instanceof Element && isStructuralTargetCandidate(candidate));
    const roots = controlledRoots.length
      ? controlledRoots
      : deepElements(document).filter((candidate) => candidate.getAttribute('role') === 'listbox' && isStructuralTargetCandidate(candidate));
    return roots
      .flatMap((root) => [
        ...(root.getAttribute('role') === 'option' ? [root] : []),
        ...deepElements(root),
      ])
      .filter((candidate) => candidate.getAttribute('role') === 'option' && isStructuralTargetCandidate(candidate));
  };

  const selectionOptions = (element) => {
    if (isNativeSelectControl(element)) {
      return [...element.options]
        .filter((option) => !option.disabled)
        .map((option) => ({ value: option.value, label: option.label || option.textContent?.trim() || option.value }))
        .filter((option) => option.label);
    }
    if (isDataListControl(element)) {
      return [...element.list.options]
        .map((option) => ({ value: option.value, label: option.label || option.value }))
        .filter((option) => option.label);
    }
    return popupOptionElements(element)
      .map((option) => {
        const label = meaningfulText(option).accessibleName || visibleText(option);
        return { value: option.getAttribute('data-value') || label, label, element: option };
      })
      .filter((option) => option.label)
      .filter((option, index, options) => options.findIndex((candidate) => candidate.value === option.value && candidate.label === option.label) === index);
  };

  const optionLabelTokens = (value = '') => [...new Set(String(value).toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => !/^\p{N}+$/u.test(token)) || [])];

  const optionLabelSimilarity = (left, right) => {
    const leftTokens = new Set(optionLabelTokens(left));
    const rightTokens = new Set(optionLabelTokens(right));
    const union = new Set([...leftTokens, ...rightTokens]);
    if (!union.size) return 0;
    return [...leftTokens].filter((token) => rightTokens.has(token)).length / union.size;
  };

  const matchingSelectionOption = (options, value, label) => {
    const exactValue = options.find((option) => option.value === value);
    const exactLabel = options.find((option) => option.label === label);
    if (exactLabel) return exactLabel;
    const ranked = options.map((option) => ({ option, score: optionLabelSimilarity(label || value, option.label) }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    const uniqueLabelMatch = best?.score >= 0.7 && (!runnerUp || best.score - runnerUp.score >= 0.15) ? best.option : null;
    if (!exactValue) return uniqueLabelMatch;
    if (!optionLabelTokens(label).length || optionLabelSimilarity(label, exactValue.label) >= 0.7) return exactValue;
    return uniqueLabelMatch || exactValue;
  };

  const dispatchSelection = async (element, value, label = value) => {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    element.focus();
    if (isNativeSelectControl(element)) {
      const choices = [...element.options].map((option) => ({ option, value: option.value, label: option.label || option.textContent?.trim() || option.value }));
      const choice = matchingSelectionOption(choices, value, label);
      if (!choice) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, choice.option.value);
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return element.value === choice.option.value;
    }
    if (isDataListControl(element)) return dispatchTextEntry(element, value);
    if (isPopupSelectControl(element)) {
      let option = matchingSelectionOption(selectionOptions(element), value, label);
      if (!option?.element) dispatchInteraction(element, 'click');
      const deadline = Date.now() + 2000;
      while (!option?.element && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        option = matchingSelectionOption(selectionOptions(element), value, label);
      }
      if (!option?.element) return isTextEntryElement(element) && dispatchTextEntry(element, value);
      dispatchInteraction(option.element, 'click');
      return true;
    }
    if (isTextEntryElement(element)) return dispatchTextEntry(element, value);
    return false;
  };

  const waitForInteractionTarget = async (scopeForStep, step, minimumConfidence) => {
    const deadline = Date.now() + 5000;
    let result = { status: 'no_match', reason: 'target_not_found' };
    do {
      const scope = scopeForStep();
      if (scope) {
        result = resolveInteractionTarget(scope, step.target, minimumConfidence, step.gesture);
        if (result.status === 'matched') return result;
      } else {
        result = { status: 'no_match', reason: 'record_not_found' };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    return result;
  };

  const waitForInteractionSettled = async () => {
    const startedAt = Date.now();
    let lastMutationAt = startedAt;
    const observer = new MutationObserver(() => { lastMutationAt = Date.now(); });
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    const nextRender = () => document.visibilityState === 'visible' && typeof requestAnimationFrame === 'function'
      ? new Promise((resolve) => requestAnimationFrame(() => resolve()))
      : new Promise((resolve) => setTimeout(resolve, 16));
    await nextRender();
    await nextRender();
    try {
      while (Date.now() - startedAt < 2000) {
        const activeAnimations = typeof document.getAnimations === 'function' && document.getAnimations().some((animation) => {
          const iterations = animation.effect?.getTiming().iterations;
          return animation.playState === 'running' && iterations !== Infinity;
        });
        if (Date.now() - startedAt >= 200 && Date.now() - lastMutationAt >= 120 && !activeAnimations) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    } finally {
      observer.disconnect();
    }
  };

  const waitForPageReadiness = async (checks) => {
    const deadline = Date.now() + 5000;
    let readiness;
    do {
      readiness = pageReadiness(checks);
      if (readiness.ready) return readiness;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    return readiness;
  };

  const watchRecordAfterInteraction = (element, pattern, baselineParent) => {
    const baselineMatch = findPatternMatches(pattern).find((candidate) => candidate.element === element);
    const baselineRecord = baselineMatch ? serializeMatches([baselineMatch], true).records[0] : null;
    const baselineIdentity = baselineRecord ? recordContentIdentity(baselineRecord) : null;
    let settleTimer = null;
    let timeoutTimer = null;
    let observer = null;
    let resolveChange;
    const finish = (change) => {
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      observer?.disconnect();
      resolveChange(change);
    };
    const inspect = () => {
      settleTimer = null;
      if (!element.isConnected) {
        finish({ status: 'removed', previousParent: baselineParent });
        return;
      }
      const match = findPatternMatches(pattern).find((candidate) => candidate.element === element);
      if (!match) {
        finish({ status: 'removed', previousParent: baselineParent });
        return;
      }
      const record = serializeMatches([match], true).records[0];
      if (recordContentIdentity(record) !== baselineIdentity) {
        finish({ status: 'changed', previousParent: baselineParent, record });
      }
    };
    const change = new Promise((resolve) => { resolveChange = resolve; });
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => mutation.target === element
        || ((mutation.target instanceof Element ? mutation.target : mutation.target.parentElement) instanceof Element
          && composedContains(element, mutation.target instanceof Element ? mutation.target : mutation.target.parentElement))
        || [...mutation.removedNodes].some((node) => node === element
          || (node instanceof Element && composedContains(node, element))));
      if (!relevant) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(inspect, 150);
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    if (element.shadowRoot) observer.observe(element.shadowRoot, { subtree: true, childList: true, characterData: true, attributes: true });
    deepElements(element).forEach((descendant) => {
      if (descendant.shadowRoot) observer.observe(descendant.shadowRoot, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    timeoutTimer = setTimeout(() => finish(null), 10_000);
    return change;
  };

  const executeCommand = async (payload = {}) => {
    window.__hvyGalaxyInspector.stop();
    const readiness = await waitForPageReadiness(payload.readyChecks || { urlMode: 'strict-url', urlValue: location.href, elements: [] });
    if (!readiness.ready) return { status: 'not-ready', reason: 'page_not_ready', message: readiness.message, readiness, stepIndex: 0, stepsExecuted: 0 };
    const command = payload.command;
    const steps = command?.steps;
    const commandInputs = Array.isArray(command?.inputs) ? command.inputs : [];
    const commandInputIds = new Set(commandInputs.map((input) => input?.id).filter((id) => typeof id === 'string' && id));
    if (!command || !Array.isArray(steps) || !steps.length || steps.some((step) => !step || !['click', 'double-click', 'right-click', 'type', 'select'].includes(step.gesture)
      || (step.gesture === 'type' && (typeof step.inputId !== 'string' || !commandInputIds.has(step.inputId)))
      || (step.gesture === 'select' && typeof step.value !== 'string' && (typeof step.inputId !== 'string' || !commandInputIds.has(step.inputId))))) return { status: 'no_match', reason: 'command_invalid', stepIndex: 0, stepsExecuted: 0 };
    const { minimumTargetConfidence } = patternThresholds(payload.pattern);
    let record = null;
    const scopeForStep = () => {
      if (command.scope !== 'record') return document;
      if (record?.element?.isConnected) return record.element;
      const records = findPatternMatches(payload.pattern);
      if (payload.recordIdentity) {
        const identityMatches = records.filter((candidate) => {
          const serialized = serializeMatches([candidate], true).records[0];
          return recordContentIdentity(serialized) === payload.recordIdentity;
        });
        record = identityMatches.length === 1 ? identityMatches[0] : null;
      } else {
        record = payload.recordParent
          ? records.find((candidate) => cssPath(candidate.element) === payload.recordParent)
          : records[0];
      }
      return record?.element || null;
    };
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      const textInput = step.gesture === 'type' ? payload.inputs?.[step.inputId] : undefined;
      const selectionInput = step.gesture === 'select' ? (step.inputId ? payload.inputs?.[step.inputId] : step.value) : undefined;
      if (step.gesture === 'type' && typeof textInput !== 'string') return { status: 'no_match', reason: 'command_input_missing', inputId: step.inputId, stepIndex, stepsExecuted: stepIndex };
      if (step.gesture === 'select' && typeof selectionInput !== 'string') return { status: 'no_match', reason: 'command_input_missing', inputId: step.inputId, stepIndex, stepsExecuted: stepIndex };
      const initialScope = stepIndex === 0 && command.scope !== 'record' ? scopeForStep() : null;
      const resolved = stepIndex === 0 && command.scope !== 'record'
        ? initialScope ? resolveInteractionTarget(initialScope, step.target, minimumTargetConfidence, step.gesture, command.pagination === 'page-number' ? payload.pageNumber ?? null : null) : { status: 'no_match', reason: 'target_not_found' }
        : await waitForInteractionTarget(scopeForStep, step, minimumTargetConfidence);
      if (resolved.status !== 'matched') return { ...resolved, stepIndex, stepsExecuted: stepIndex };
      if (payload.watchRecord && command.scope === 'record' && stepIndex === steps.length - 1 && record?.element) {
        void watchRecordAfterInteraction(record.element, payload.pattern, payload.recordParent || cssPath(record.element)).then((recordChange) => {
          if (recordChange) publish({
            kind: 'integration-record-watch-result',
            requestId: payload.requestId,
            commandId: command.id,
            recordChange,
          });
        });
      }
      if (step.gesture === 'type') {
        if (!dispatchTextEntry(resolved.element, textInput)) return { status: 'no_match', reason: 'target_not_text_editable', score: resolved.score, stepIndex, stepsExecuted: stepIndex };
      } else if (step.gesture === 'select') {
        const input = commandInputs.find((candidate) => candidate.id === step.inputId);
        const label = input?.options?.find((option) => option.value === selectionInput)?.label || step.valueLabel || selectionInput;
        if (!await dispatchSelection(resolved.element, selectionInput, label)) return { status: 'no_match', reason: 'option_not_found', score: resolved.score, stepIndex, stepsExecuted: stepIndex };
      } else {
        dispatchInteraction(resolved.element, step.gesture);
      }
      if (stepIndex < steps.length - 1) await waitForInteractionSettled();
    }
    return {
      status: 'executed',
      commandId: command.id,
      gesture: steps.at(-1).gesture,
      stepsExecuted: steps.length,
      record: record ? cssPath(record.element) : null,
    };
  };

  const serializeMatches = (matches, includeValues = false) => ({
    matches: matches.length,
    records: matches.map((match) => ({
      parent: cssPath(match.element),
      score: match.score,
      parentScore: match.parentScore,
      relationshipScore: match.relationshipScore,
      targets: match.matchedTargets.map((target) => {
        const missing = target.optional && (!target.element || target.score < match.minimumTargetConfidence);
        return {
          label: target.label,
          cardinality: target.cardinality,
          optional: target.optional,
          element: missing ? null : cssPath(target.element),
          score: target.score || 0,
          shapeScore: target.shapeScore || 0,
          relativePathScore: target.relativePathScore || 0,
          ...(includeValues ? {
            value: missing
              ? target.cardinality === 'list' ? [] : null
              : target.textRange
                ? readableText(null, target.textRange)
                : target.cardinality === 'list'
                  ? target.elements.map((item) => extractedValue(item.element))
                  : extractedValue(target.element),
            // The link a field points at, such as a job title linking to its posting.
            href: missing || target.cardinality === 'list' || target.textRange ? null : linkHref(target.element),
          } : {}),
        };
      }),
      // What opens the row's item, for a list whose pattern has one: where it is, and the link clicking it follows.
      ...(includeValues && match.opener !== undefined ? { opener: match.opener ? { element: cssPath(match.opener), href: openedHref(match.opener) } : null } : {}),
    })),
  });

  const recordContentIdentity = (record) => JSON.stringify(record.targets.map((target) => [target.label, target.value]));

  const collectedRecordsOverlap = (left, right) => {
    if (left.element !== right.element) {
      return composedContains(left.element, right.element) || composedContains(right.element, left.element);
    }
    const positionTolerance = Math.max(8, Math.min(left.height, right.height) * 0.25);
    return Math.abs(left.pageTop - right.pageTop) <= positionTolerance
      && Math.abs(left.pageLeft - right.pageLeft) <= positionTolerance;
  };

  let extractionRun = 0;

  const extractAcrossPage = async (pattern = {}, runId = extractionRun, checkPage = () => ({ ready: true })) => {
    let pageFailure = null;
    window.__hvyGalaxyInspector.stop();
    const effectivePattern = { ...pattern, ...(liveMinimumConfidence === null ? {} : { minimumConfidence: liveMinimumConfidence }) };
    const recordLimit = Number.isFinite(pattern.recordLimit)
      ? Math.max(1, Math.min(100, Math.floor(pattern.recordLimit)))
      : 100;
    const scrollables = deepElements(document)
      .filter((element) => element.scrollHeight > element.clientHeight + 40 && element.clientHeight > 120)
      .sort((left, right) => ((right.scrollHeight - right.clientHeight) * right.clientWidth) - ((left.scrollHeight - left.clientHeight) * left.clientWidth));
    const initialCandidates = evaluatePatternCandidates(effectivePattern)
      .sort((left, right) => Number(right.accepted) - Number(left.accepted) || right.score - left.score || right.parentScore - left.parentScore);
    let owningScroller = null;
    for (let node = initialCandidates[0]?.element?.parentElement; node instanceof Element; node = node.parentElement) {
      if (scrollables.includes(node)) {
        owningScroller = node;
        break;
      }
    }
    const scroller = owningScroller || scrollables[0] || document.scrollingElement;
    const originalTop = scroller?.scrollTop || 0;
    const records = new Map();
    const structuralRecords = [];
    const viewportSignature = () => {
      const bounds = scroller instanceof Element
        ? scroller.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const root = scroller instanceof Element ? scroller : document;
      return deepElements(root)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom >= bounds.top && rect.top <= bounds.bottom;
        })
        .slice(0, 240)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return `${element.tagName}:${Math.round(rect.top)}:${Math.round(rect.height)}:${tokenHash(visibleText(element).slice(0, 256))}`;
        })
        .join('|');
    };
    const settle = async () => {
      if (document.visibilityState === 'visible') {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }
      let previous = '';
      let stableSamples = 0;
      for (let sample = 0; sample < 10 && stableSamples < 2; sample += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        const current = viewportSignature();
        stableSamples = current === previous ? stableSamples + 1 : 0;
        previous = current;
      }
    };
    const collect = () => {
      const readiness = checkPage();
      if (!readiness.ready) { pageFailure = readiness; return; }
      const matches = findPatternMatches(effectivePattern);
      const serialized = serializeMatches(matches, true).records;
      for (let index = 0; index < serialized.length; index += 1) {
        const record = serialized[index];
        const element = matches[index].element;
        const key = recordContentIdentity(record);
        const previous = records.get(key);
        const rect = element.getBoundingClientRect();
        const scrollBounds = scroller instanceof Element ? scroller.getBoundingClientRect() : { top: 0, left: 0 };
        const entry = {
          key,
          element,
          record,
          pageTop: (scroller ? scroller.scrollTop : window.scrollY) + rect.top - scrollBounds.top,
          pageLeft: rect.left - scrollBounds.left,
          height: rect.height,
        };
        const overlapping = structuralRecords.find((candidate) => candidate !== previous && collectedRecordsOverlap(candidate, entry));
        if ((previous && previous.record.score >= record.score)
          || (overlapping && overlapping.record.score >= record.score)) continue;
        if (overlapping) {
          records.delete(overlapping.key);
          structuralRecords.splice(structuralRecords.indexOf(overlapping), 1);
        }
        if (previous && previous !== overlapping) structuralRecords.splice(structuralRecords.indexOf(previous), 1);
        records.set(key, entry);
        structuralRecords.push(entry);
      }
    };
    if (scroller && pattern.scrollPage !== false) {
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(240, scroller.clientHeight * 0.9);
      const positions = [];
      for (let top = 0; top < maximum && positions.length < 60; top += step) positions.push(top);
      positions.push(maximum);
      for (const top of positions) {
        if (runId !== extractionRun) break;
        scroller.scrollTop = top;
        await settle();
        if (runId !== extractionRun) break;
        collect();
        if (pageFailure || records.size >= recordLimit) break;
      }
      if (scroller.scrollTop !== originalTop) {
        scroller.scrollTop = originalTop;
        await settle();
      }
    } else {
      collect();
    }
    if (pageFailure) return { status: 'not-ready', message: pageFailure.message, readiness: pageFailure, matches: 0, records: [] };
    const selected = [...records.values()]
      .sort((left, right) => left.pageTop - right.pageTop || left.pageLeft - right.pageLeft || right.record.score - left.record.score)
      .slice(0, recordLimit)
      .map((entry) => entry.record);
    return {
      matches: selected.length,
      records: selected,
      diagnostics: selected.length ? null : diagnosePattern(effectivePattern),
      minimumConfidence: patternThresholds(effectivePattern).minimumConfidence,
    };
  };

  // The pattern as one saved example alone: its parent, and each field as that example had it.
  const examplePattern = (pattern, exampleIndex) => {
    const targets = (pattern.targets || []).map((target) => {
      const hasPositionalSnapshot = Array.isArray(target.exampleSnapshots) && exampleIndex < target.exampleSnapshots.length;
      const exampleSnapshot = hasPositionalSnapshot
        ? target.exampleSnapshots[exampleIndex]
        : target.snapshots?.[exampleIndex] ?? target.snapshot ?? null;
      return {
        ...target,
        snapshot: exampleSnapshot,
        snapshots: exampleSnapshot ? [exampleSnapshot] : [],
      };
    });
    return { ...pattern, parents: [pattern.parents[exampleIndex]], targets };
  };

  const extractLiveExamples = async (pattern = {}, runId = extractionRun) => {
    const usedRecords = new Set();
    const records = [];
    for (let exampleIndex = 0; exampleIndex < (pattern.parents || []).length; exampleIndex += 1) {
      const extraction = await extractAcrossPage(examplePattern(pattern, exampleIndex), runId);
      if (runId !== extractionRun) break;
      const available = extraction.records.find((record) => {
        const identity = recordContentIdentity(record);
        return !usedRecords.has(identity);
      });
      if (!available) {
        records.push(null);
        continue;
      }
      usedRecords.add(recordContentIdentity(available));
      records.push(available);
    }
    return { matches: records.filter(Boolean).length, records, diagnostics: null, minimumConfidence: patternThresholds(pattern).minimumConfidence };
  };

  // After the live examples check, each saved example it did not find is looked for again in what the page adds (a list
  // loading more as it is scrolled), not the whole page again: an element the page has, anywhere in it, was already
  // looked at. It stops once all are found, the page navigates, or another extraction starts. Each find is published
  // with the example records as they now are; Galaxy keeps the best fit for each.
  let liveExampleWatch = null;
  const stopLiveExampleWatch = () => {
    if (!liveExampleWatch) return;
    liveExampleWatch.observer.disconnect();
    document.removeEventListener('scroll', liveExampleWatch.scrolled, true);
    clearTimeout(liveExampleWatch.timer);
    liveExampleWatch = null;
  };
  // What the inspector draws in the page is not the page.
  const isInspectorElement = (element) => Boolean(element.closest('[id^="hvy-galaxy-"], [data-collection-selection]'));
  const watchLiveExamples = (pattern, records, context) => {
    stopLiveExampleWatch();
    if (!records.some((record) => record === null)) return;
    const pageUrl = location.href;
    const runId = extractionRun;
    let added = [];
    const evaluate = () => {
      if (!liveExampleWatch) return;
      liveExampleWatch.timer = null;
      if (location.href !== pageUrl || runId !== extractionRun) {
        stopLiveExampleWatch();
        return;
      }
      // The outermost of what was added, still in the page: those with nothing else added above them.
      const addedSet = new Set(added);
      const roots = [...addedSet].filter((element) => {
        if (!element.isConnected) return false;
        for (let node = composedParent(element); node; node = composedParent(node)) if (addedSet.has(node)) return false;
        return true;
      });
      added = [];
      if (!roots.length) return;
      const used = new Set(records.filter(Boolean).map(recordContentIdentity));
      let found = false;
      records.forEach((record, exampleIndex) => {
        if (record) return;
        const available = serializeMatches(findPatternMatches(examplePattern(pattern, exampleIndex), roots), true).records
          .find((candidate) => !used.has(recordContentIdentity(candidate)));
        if (!available) return;
        used.add(recordContentIdentity(available));
        records[exampleIndex] = available;
        found = true;
      });
      if (found) publish({ kind: 'integration-live-examples', context, page: { origin: location.origin, pathname: location.pathname }, records: [...records] });
      if (!records.some((record) => record === null)) stopLiveExampleWatch();
    };
    // Additions come in bursts as a list loads, and as it scrolls: evaluated once both pause, so not while scrolling.
    const wait = () => {
      if (!added.length || !liveExampleWatch) return;
      clearTimeout(liveExampleWatch.timer);
      liveExampleWatch.timer = setTimeout(evaluate, 400);
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) if (node instanceof Element && !isInspectorElement(node)) added.push(node);
      }
      wait();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('scroll', wait, true);
    liveExampleWatch = { observer, scrolled: wait, timer: null };
  };

  window.__hvyGalaxyInspector = {
    // A result found by another of Galaxy's scripts in the page (a WebMCP request's, integration-webmcp-bridge.js), sent as
    // this sends its own, where the host does not wait for that script's own result (Tauri on Windows and Linux).
    publish(value) {
      publish(value);
    },
    discoverStructuredSources() {
      const sources = [];
      document.querySelectorAll('link[rel~="alternate"][href]').forEach((link) => {
        const type = (link.getAttribute('type') || '').toLowerCase();
        const kind = type.includes('json') ? 'json-feed' : type.includes('atom') ? 'atom' : type.includes('rss') || type.includes('xml') ? 'rss' : null;
        if (!kind) return;
        sources.push({ kind, url: new URL(link.href, location.href).href, title: link.getAttribute('title') || `${kind.toUpperCase()} feed`, authenticated: false, discoveredBy: 'link' });
      });
      timedRequests.forEach((contentType, name) => {
        let url;
        try { url = new URL(name, location.href); } catch (_) { return; }
        if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
        const type = contentType.toLowerCase();
        const kind = type.includes('json') ? 'json-api' : type.includes('atom') ? 'atom' : type.includes('rss') || type.includes('xml') ? 'rss'
          : /\.json(?:$|\?)|[?&](?:format|output)=json(?:&|$)/i.test(url.href) ? 'json-api' : null;
        if (kind) sources.push({ kind, url: url.href, title: `${url.pathname}${url.search}`, authenticated: true, discoveredBy: 'network' });
      });
      return [...new Map(sources.map((source) => [`${source.kind}|${source.url}`, source])).values()];
    },
    async fetchStructuredSource(source) {
      const url = new URL(source.url, location.href);
      if (source.kind === 'json-api' && url.origin !== location.origin) throw new Error('Authenticated API retrieval must remain on the page origin.');
      const response = await fetch(url.href, {
        method: 'GET',
        credentials: url.origin === location.origin ? 'include' : 'omit',
        headers: { Accept: source.kind === 'json-api' || source.kind === 'json-feed' ? 'application/json' : 'application/atom+xml, application/rss+xml, application/xml, text/xml' },
      });
      if (!response.ok) throw new Error(`Structured source returned HTTP ${response.status}.`);
      if (source.kind === 'json-api' || source.kind === 'json-feed') return { source, contentType: response.headers.get('content-type') || '', value: await response.json() };
      const xml = await response.text();
      const decodeXml = (value = '') => value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code[0].toLowerCase() === 'x' ? code.slice(1) : code, code[0].toLowerCase() === 'x' ? 16 : 10)))
        .replace(/&(amp|lt|gt|quot|apos);/g, (_match, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]);
      const field = (entry, names) => {
        for (const name of names) {
          const attribute = name === 'link' ? entry.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1] : null;
          const content = entry.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1];
          if (attribute || content) return decodeXml(attribute || content).replace(/<[^>]+>/g, '').trim();
        }
        return '';
      };
      const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => {
        const entry = match[2];
        return {
          title: field(entry, ['title']),
          url: field(entry, ['link']),
          id: field(entry, ['guid', 'id']),
          published: field(entry, ['pubDate', 'published', 'updated']),
          summary: field(entry, ['description', 'summary', 'content']),
        };
      });
      return { source, contentType: response.headers.get('content-type') || '', value: entries };
    },
    discoverStructuredSourcesAndPublish(context = {}) {
      const sources = this.discoverStructuredSources();
      publish({ kind: 'integration-source-discovery', context, sources });
      return sources;
    },
    async fetchStructuredSourceAndPublish(source, context = {}) {
      try {
        const result = await this.fetchStructuredSource(source);
        publish({ kind: 'integration-structured-result', context, ...result });
        return result;
      } catch (error) {
        publish({ kind: 'integration-structured-error', context, message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    start(kind = 'target', options = {}) {
      inspectionKind = options.scopeSelection ? 'scope' : kind === 'parent' ? 'parent' : 'target';
      inspectionContext = options.context && typeof options.context === 'object' ? options.context : null;
      scopeElement = options.selectionScope
        ? patternScopes({ scope: options.selectionScope, minimumConfidence: options.minimumConfidence }).at(0)?.element || null
        : null;
      scopeSelector = options.parentCssPath || null;
      scopeSnapshot = options.parentSnapshot || null;
      scopeAnchorElement = inspectionKind === 'scope'
        ? resolveCapturedElement(options.scopeParentSnapshot?.selected) || null
        : null;
      inspectionPattern = options.existingPattern
        ? { ...options.existingPattern, ...(liveMinimumConfidence === null ? {} : { minimumConfidence: liveMinimumConfidence }) }
        : null;
      active = true;
      pickingPaused = false;
      removeUi();
      const shield = document.createElement('div');
      shield.id = 'hvy-galaxy-inspector-shield';
      shield.style.cssText = 'position:fixed;inset:0;z-index:2147483644;background:transparent;cursor:crosshair;pointer-events:auto';
      document.documentElement.append(shield);
      // The shield takes the wheel. Over a page that scrolls as a whole, the browser scrolls it (the shield is fixed over
      // it), as smoothly as ever. Only a box that scrolls within the page is scrolled here, as the browser does not reach
      // it through the shield: found once a gesture (the wheel's events until they pause), and by whole pixels, as the
      // page keeps (scrollTop drops a fraction), with what is left over kept for the next, as a touchpad scrolled slowly
      // moves less than a pixel an event.
      let wheelScroller = null;
      let wheelPause = 0;
      let wheelRest = { x: 0, y: 0 };
      shield.addEventListener('wheel', (event) => {
        if (!wheelScroller) {
          const chains = elementsBehindInspector(event.clientX, event.clientY).flatMap((element) => {
            const ancestors = [];
            for (let node = element; node instanceof Element; node = node.parentElement) ancestors.push(node);
            return ancestors;
          });
          wheelScroller = [...new Set(chains)].find((element) => {
            const style = getComputedStyle(element);
            return element.scrollHeight > element.clientHeight + 2 && /(auto|scroll)/.test(style.overflowY);
          }) || document.scrollingElement;
        }
        clearTimeout(wheelPause);
        wheelPause = setTimeout(() => {
          wheelScroller = null;
          wheelRest = { x: 0, y: 0 };
        }, 150);
        if (!wheelScroller || wheelScroller === document.scrollingElement) return;
        event.preventDefault();
        wheelRest = { x: wheelRest.x + event.deltaX, y: wheelRest.y + event.deltaY };
        const step = { x: Math.trunc(wheelRest.x), y: Math.trunc(wheelRest.y) };
        wheelRest = { x: wheelRest.x - step.x, y: wheelRest.y - step.y };
        if (step.y) wheelScroller.scrollTop += step.y;
        if (step.x) wheelScroller.scrollLeft += step.x;
      }, { passive: false });
      const trackedBoxes = [];
      targetCollection = null;
      undoLastPick = null;
      toolbarControl = null;
      commandRecordElements = options.commandRecorder?.scope === 'record'
        ? new Set(inspectionPattern ? findPatternMatches(inspectionPattern).map((match) => match.element) : [])
        : null;
      if (inspectionPattern) {
        const existingLayer = document.createElement('div');
        existingLayer.id = 'hvy-galaxy-existing-matches';
        existingLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none';
        const { minimumConfidence } = patternThresholds(inspectionPattern);
        const rankedCandidates = evaluatePatternCandidates(inspectionPattern)
          .filter((candidate) => candidate.parentScore >= Math.max(0.5, minimumConfidence - 0.13))
          .sort((left, right) => right.parentScore - left.parentScore || right.score - left.score);
        const diagnosticCandidates = [];
        for (const candidate of rankedCandidates) {
          if (diagnosticCandidates.some((record) => composedContains(record.element, candidate.element) || composedContains(candidate.element, record.element))) continue;
          diagnosticCandidates.push(candidate);
          if (diagnosticCandidates.length >= 50) break;
        }
        diagnosticCandidates.sort((left, right) => left.element.getBoundingClientRect().top - right.element.getBoundingClientRect().top);
        diagnosticCandidates.forEach((match, index) => {
          const parentColor = match.accepted ? '#27865f' : '#c56a25';
          const box = document.createElement('div');
          box.dataset.existingMatchKind = 'parent';
          box.dataset.existingMatchStatus = match.accepted ? 'pass' : 'fail';
          box.style.cssText = `position:fixed;border:2px solid ${parentColor};box-sizing:border-box;background:${parentColor}12;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
          const caption = document.createElement('span');
          const failedFields = match.matchedTargets.filter((target) => !target.optional && (!target.element || target.score < match.minimumTargetConfidence)).map((target) => target.label);
          const absentOptionalFields = match.matchedTargets.filter((target) => target.optional && (!target.element || target.score < match.minimumTargetConfidence)).map((target) => target.label);
          caption.textContent = match.accepted
            ? `Matches ${index + 1} · ${Math.round(match.score * 100)}%${absentOptionalFields.length ? ` · ${absentOptionalFields.join(', ')} absent` : ''}`
            : `Needs example · ${Math.round(match.score * 100)}%${failedFields.length ? ` · ${failedFields.join(', ')} failed` : ''}${!match.distinctTargets ? ' · fields overlap' : ''}`;
          caption.style.cssText = `display:inline-block;padding:2px 5px;background:${parentColor};color:#fff`;
          box.append(caption);
          existingLayer.append(box);
          trackedBoxes.push({ element: match.element, box });

          if (!match.accepted) return;
          match.matchedTargets.forEach((target) => {
            const passes = Boolean(target.element) && target.score >= match.minimumTargetConfidence && uniqueTargetElement(target, match.matchedTargets);
            if (target.optional && !passes) return;
            const targetColor = passes ? '#27865f' : '#d33f49';
            const targetElements = target.cardinality === 'list' && target.elements.length ? target.elements.map((item) => item.element) : target.element ? [target.element] : [];
            targetElements.forEach((element, targetIndex) => {
              const targetBox = document.createElement('div');
              targetBox.dataset.existingMatchKind = 'target';
              targetBox.dataset.existingMatchStatus = passes ? 'pass' : 'fail';
              targetBox.dataset.existingMatchLabel = target.label;
              targetBox.style.cssText = `position:fixed;border:2px ${passes ? 'solid' : 'dashed'} ${targetColor};box-sizing:border-box;background:${targetColor}18;color:#fff;font:10px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
              const targetCaption = document.createElement('span');
              targetCaption.textContent = `${target.label}${target.cardinality === 'list' ? ` ${targetIndex + 1}` : ''}${target.textRange ? ` · ${readableText(null, target.textRange).length.toLocaleString()} characters` : ''} · ${Math.round((target.score || 0) * 100)}%`;
              targetCaption.style.cssText = `display:inline-block;padding:1px 4px;background:${targetColor};color:#fff`;
              targetBox.append(targetCaption);
              existingLayer.append(targetBox);
              trackedBoxes.push({ element, box: targetBox, ...(target.textRange ? { rect: () => target.textRange.getBoundingClientRect() } : {}) });
            });
          });
        });
        document.documentElement.append(existingLayer);
      }
      const scope = inspectionKind === 'target' ? resolvedScope() : null;
      const scopeBox = scope ? document.createElement('div') : null;
      if (scopeBox) {
        scopeBox.id = 'hvy-galaxy-inspector-scope';
        scopeBox.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border:2px solid #3478d4;background:#3478d40d;box-sizing:border-box;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
        scopeBox.textContent = 'Selected parent';
        scopeBox.style.padding = '3px 5px';
        document.documentElement.append(scopeBox);
      }
      let selectionFrame = 0;
      const updateSelectionBoxes = () => {
        selectionFrame = 0;
        trackedBoxes.forEach(({ element, box, rect: rangeRect }) => {
          if (!element.isConnected) {
            box.style.display = 'none';
            return;
          }
          const rect = rangeRect ? rangeRect() : element.getBoundingClientRect();
          Object.assign(box.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        });
        if (scopeBox && scope?.isConnected) {
          const rect = scope.getBoundingClientRect();
          Object.assign(scopeBox.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        } else if (scopeBox) scopeBox.style.display = 'none';
        if (highlighted?.isConnected) highlight(highlighted);
      };
      const scheduleSelectionUpdate = () => {
        if (!selectionFrame) selectionFrame = requestAnimationFrame(updateSelectionBoxes);
      };
      // While the page scrolls, the boxes are hidden rather than moved each frame (each move measures the page again), and
      // drawn where they are once it pauses.
      let scrollPause = 0;
      const hideSelectionWhileScrolling = (event) => {
        if (event.target instanceof Element && isInspectorElement(event.target)) return;
        if (!scrollPause) {
          trackedBoxes.forEach(({ box }) => { box.style.display = 'none'; });
          if (scopeBox) scopeBox.style.display = 'none';
          document.getElementById('hvy-galaxy-inspector-highlight')?.remove();
        }
        clearTimeout(scrollPause);
        scrollPause = setTimeout(() => {
          scrollPause = 0;
          scheduleSelectionUpdate();
        }, 150);
      };
      updateSelectionBoxes();
      document.addEventListener('scroll', hideSelectionWhileScrolling, true);
      window.addEventListener('resize', scheduleSelectionUpdate);
      selectionOverlayCleanup = () => {
        document.removeEventListener('scroll', hideSelectionWhileScrolling, true);
        window.removeEventListener('resize', scheduleSelectionUpdate);
        clearTimeout(scrollPause);
        if (selectionFrame) cancelAnimationFrame(selectionFrame);
        document.querySelectorAll('[data-collection-selection="true"]').forEach((element) => element.remove());
      };
      const externalToolbar = options.externalToolbar === true;
      const status = document.createElement('div');
      status.id = 'hvy-galaxy-inspector-status';
      status.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border-radius:999px;background:#e0563f;color:#fff;box-shadow:0 4px 18px #0006;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;pointer-events:auto';
      const statusText = document.createElement('span');
      statusText.dataset.inspectorStatusText = 'true';
      statusText.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      // What is being picked: said by whoever asked (a site setup says "the box around one job"), or in general terms.
      const activeStatusText = options.prompt || (inspectionKind === 'scope'
        ? 'Choose an optional page section'
        : inspectionKind === 'parent'
          ? options.existingPattern ? 'Add an example · green passes · orange or red needs attention' : 'Select the box around one record'
          : 'Select the data to read');
      statusText.textContent = activeStatusText;
      rangeStart = null;
      rangeKeptEnd = null;
      rangeEditing = false;
      rangeStatus = () => { statusText.textContent = rangeStart?.status || activeStatusText; };
      recordChoice = options.recordChoice && inspectionPattern
        ? { matches: findPatternMatches(inspectionPattern), refuse: () => { statusText.textContent = options.recordChoice.refuse || 'Pick one of the records boxed in green.'; } }
        : null;
      const rangeEdit = inspectionKind === 'target' && options.rangeEdit?.snapshot?.range ? options.rangeEdit : null;
      if (rangeEdit) {
        const { snapshot: edited, boundary } = rangeEdit;
        const kept = rangeBoundaryElement(boundary === 'end' ? edited.selected : edited.range.end.selected);
        if (!kept) {
          statusText.textContent = `The range's ${boundary === 'end' ? 'start' : 'end'} is not in this item · pick the field again`;
        } else if (boundary === 'end') {
          rangeEditing = true;
          rangeStart = { element: kept, includeStart: edited.range.includeStart === true, status: 'Pick where the range ends' };
          statusText.textContent = rangeStart.status;
        } else {
          rangeEditing = true;
          rangeKeptEnd = { element: kept, includeEnd: edited.range.includeEnd === true };
          statusText.textContent = 'Pick where the range starts';
        }
      }
      const navigationButton = document.createElement('button');
      navigationButton.type = 'button';
      navigationButton.textContent = 'Navigate page';
      navigationButton.dataset.toolbarId = 'navigate';
      navigationButton.style.cssText = 'height:36px;padding:0 10px;border:1px solid #ff806d;border-radius:7px;background:#5f2922;color:#fff;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer;white-space:nowrap';
      navigationButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pickingPaused = !pickingPaused;
        shield.style.pointerEvents = pickingPaused ? 'none' : 'auto';
        navigationButton.textContent = pickingPaused ? 'Resume picking' : 'Navigate page';
        statusText.textContent = pickingPaused
          ? 'Page navigation enabled'
          : activeStatusText;
        if (pickingPaused) {
          document.getElementById('hvy-galaxy-inspector-picker')?.remove();
          document.getElementById('hvy-galaxy-inspector-highlight')?.remove();
          highlighted = null;
        }
      });
      if (options.commandRecorder) {
        status.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;width:min(460px,calc(100vw - 24px));display:grid;gap:10px;padding:14px;border:1px solid #f08c7c;border-radius:12px;background:#20232a;color:#fff;box-shadow:0 10px 32px #0008;font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;pointer-events:auto';
        statusText.style.cssText = 'display:block;white-space:normal;font-weight:650;line-height:1.4';
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
        const steps = [];
        let recordSnapshot = null;
        let currentGesture = null;
        let currentTarget = null;
        let currentResolution = null;
        let parameterStepCount = 0;
        let currentSelection = null;
        let recorderButtonCount = 0;
        const recorderButton = (label, primary = false) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.dataset.toolbarId = `recorder-${++recorderButtonCount}`;
          if (primary) button.dataset.toolbarPrimary = 'true';
          button.style.cssText = `min-height:34px;padding:6px 10px;border:1px solid ${primary ? '#ff8d79' : '#626974'};border-radius:7px;background:${primary ? '#d95640' : '#30343d'};color:#fff;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer`;
          return button;
        };
        const clearRecorderInput = () => status.querySelectorAll('[data-command-recorder-input]').forEach((element) => element.remove());
        const setRecorderPicking = (enabled) => {
          pickingPaused = !enabled;
          shield.style.pointerEvents = 'auto';
          document.getElementById('hvy-galaxy-inspector-picker')?.remove();
          if (!enabled) {
            document.getElementById('hvy-galaxy-inspector-highlight')?.remove();
            highlighted = null;
          }
        };
        const showCancel = () => {
          const cancel = recorderButton('Cancel');
          cancel.addEventListener('click', () => {
            publish({ kind: 'integration-command-recording-cancelled' });
            window.__hvyGalaxyInspector.stop();
          });
          controls.append(cancel);
        };
        const renderChooseGesture = () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          statusText.textContent = `Step ${steps.length + 1}: choose an interaction.`;
          currentSelection = null;
          const gestures = [['click', 'Click'], ['double-click', 'Double click'], ['right-click', 'Right click'], ['type', 'Enter text'], ['select', 'Choose option']];
          gestures.forEach(([gesture, label]) => {
            const button = recorderButton(label, gesture === 'click');
            button.addEventListener('click', () => startPicking(gesture, `Step ${steps.length + 1}: select the ${gesture === 'type' ? 'text field' : gesture === 'select' ? 'dropdown or combobox' : `${label.toLocaleLowerCase()} target`}.`));
            controls.append(button);
          });
          showCancel();
        };
        const startPicking = (gesture, prompt) => {
          currentGesture = gesture;
          inspectionKind = 'target';
          setRecorderPicking(true);
          controls.replaceChildren();
          statusText.textContent = prompt;
          const pause = recorderButton('Pause to navigate');
          let navigating = false;
          pause.addEventListener('click', () => {
            navigating = !navigating;
            if (navigating) {
              pickingPaused = true;
              shield.style.pointerEvents = 'none';
              pause.textContent = 'Resume selecting';
              statusText.textContent = 'Page navigation is enabled. Resume when the target is visible.';
            } else {
              setRecorderPicking(true);
              pause.textContent = 'Pause to navigate';
              statusText.textContent = prompt;
            }
          });
          controls.append(pause);
          showCancel();
        };
        // A recording that is one known pick (the site setup's next page): the gesture is given, so there is nothing to
        // choose, and the pick is the whole command. It is not performed: the list stays on its first page.
        // It may first ask which kind of pick it is (a list's next page: its Next link, or its page numbers), from the
        // asker's choices; the recording says which was chosen.
        const pickOptions = options.commandRecorder.pick || null;
        let singlePick = pickOptions && !pickOptions.choices ? pickOptions : null;
        const renderPickChoices = () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          statusText.textContent = pickOptions.question;
          pickOptions.choices.forEach((choice) => {
            const button = recorderButton(choice.label);
            button.addEventListener('click', () => {
              singlePick = choice;
              startSinglePick();
            });
            controls.append(button);
          });
          showCancel();
        };
        const startSinglePick = () => {
          startPicking(singlePick.gesture, singlePick.prompt);
          if (!pickOptions.choices) return;
          const back = recorderButton('Back');
          back.addEventListener('click', renderPickChoices);
          controls.prepend(back);
        };
        const renderSinglePickConfirmation = () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          statusText.textContent = currentResolution.status === 'matched'
            ? singlePick.confirm
            : currentResolution.status === 'ambiguous'
              ? 'More than one control looks like this one. Pick another.'
              : singlePick.pageNumber ? 'Pick one of the page numbers, such as 2.' : 'Galaxy could not find this again on the page. Pick another.';
          if (currentResolution.status === 'matched') {
            const use = recorderButton('Use this', true);
            use.addEventListener('click', finishWithoutPerforming);
            controls.append(use);
          }
          const retry = recorderButton('Pick again', currentResolution.status !== 'matched');
          retry.addEventListener('click', startSinglePick);
          controls.append(retry);
          showCancel();
        };
        const renderAfterStep = () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          statusText.textContent = `Step ${steps.length} confirmed and performed successfully.`;
          const add = recorderButton('Add step', true);
          add.addEventListener('click', renderChooseGesture);
          const finish = recorderButton('Finish recording', steps.length > 0);
          finish.addEventListener('click', () => {
            publish({ kind: 'integration-command-recording', steps });
            window.__hvyGalaxyInspector.stop();
          });
          controls.append(add, finish);
          showCancel();
        };
        const appendRecordedStep = () => {
          steps.push({
            gesture: currentGesture,
            target: currentTarget,
            ...(currentGesture === 'type' ? { inputId: `input-${++parameterStepCount}` } : {}),
            ...(currentGesture === 'select' && currentSelection?.askEachRun ? {
              inputId: `input-${++parameterStepCount}`,
              options: currentSelection.options,
              ...(currentSelection.allowCustom ? { allowCustom: true } : {}),
            } : {}),
            ...(currentGesture === 'select' && !currentSelection?.askEachRun ? {
              value: currentSelection?.value,
              valueLabel: currentSelection?.label,
            } : {}),
          });
        };
        const recordConfirmedStep = () => {
          appendRecordedStep();
          void waitForInteractionSettled().then(renderAfterStep);
        };
        const finishWithoutPerforming = () => {
          appendRecordedStep();
          publish({ kind: 'integration-command-recording', steps, ...(singlePick?.pagination ? { pagination: singlePick.pagination } : {}) });
          window.__hvyGalaxyInspector.stop();
        };
        const renderSampleInput = () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          statusText.textContent = `Step ${steps.length + 1}: enter a temporary value to verify text entry.`;
          const input = document.createElement('textarea');
          input.rows = 3;
          input.dataset.commandRecorderInput = 'true';
          input.placeholder = 'Temporary sample value';
          input.style.cssText = 'width:100%;resize:vertical;padding:8px;border:1px solid #747c88;border-radius:7px;background:#111318;color:#fff;font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
          const run = recorderButton('Confirm typing', true);
          run.addEventListener('click', () => {
            if (!input.value) {
              input.focus();
              return;
            }
            if (!dispatchTextEntry(currentResolution.element, input.value)) {
              statusText.textContent = 'This target no longer accepts text. Select it again.';
              return;
            }
            recordConfirmedStep();
          });
          status.insertBefore(input, controls);
          controls.append(run);
          showCancel();
          input.focus();
        };
        const renderSelectInput = async () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          const target = currentResolution.element;
          if (isPopupSelectControl(target) && target.getAttribute('aria-expanded') !== 'true') {
            dispatchInteraction(target, 'click');
            await waitForInteractionSettled();
          }
          const options = selectionOptions(target);
          const allowCustom = isDataListControl(target) || isTextEntryElement(target);
          if (!options.length && !allowCustom) {
            statusText.textContent = 'No selectable options appeared. Record this control as separate click steps instead.';
            const retry = recorderButton('Choose again', true);
            retry.addEventListener('click', renderChooseGesture);
            controls.append(retry);
            showCancel();
            return;
          }
          statusText.textContent = `Step ${steps.length + 1}: choose a value, then save it or ask for it each run.`;
          let input;
          if (allowCustom) {
            input = document.createElement('input');
            input.type = 'text';
            if (options.length) {
              const list = document.createElement('datalist');
              list.id = `hvy-command-recorder-options-${steps.length + 1}`;
              options.forEach((choice) => {
                const option = document.createElement('option');
                option.value = choice.value;
                option.label = choice.label;
                list.appendChild(option);
              });
              input.setAttribute('list', list.id);
              status.insertBefore(list, controls);
              list.dataset.commandRecorderInput = 'true';
            }
          } else {
            input = document.createElement('select');
            options.forEach((choice) => {
              const option = document.createElement('option');
              option.value = choice.value;
              option.textContent = choice.label;
              input.appendChild(option);
            });
          }
          input.dataset.commandRecorderInput = 'true';
          input.style.cssText = 'width:100%;padding:8px;border:1px solid #747c88;border-radius:7px;background:#111318;color:#fff;font:13px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
          const finish = async (askEachRun) => {
            const value = input.value;
            if (!value) {
              input.focus();
              return;
            }
            const label = options.find((choice) => choice.value === value)?.label || value;
            if (!await dispatchSelection(target, value, label)) {
              statusText.textContent = 'Galaxy could not apply that option. Choose another value or select the control again.';
              return;
            }
            currentSelection = {
              value,
              label,
              options: options.map((option) => ({ value: option.value, label: option.label })),
              allowCustom,
              askEachRun,
            };
            recordConfirmedStep();
          };
          const fixed = recorderButton('Use this value', true);
          fixed.addEventListener('click', () => { void finish(false); });
          const parameter = recorderButton('Ask each run');
          parameter.addEventListener('click', () => { void finish(true); });
          status.insertBefore(input, controls);
          controls.append(fixed, parameter);
          showCancel();
          input.focus();
        };
        const renderTargetConfirmation = () => {
          clearRecorderInput();
          setRecorderPicking(false);
          controls.replaceChildren();
          if (currentResolution.status !== 'matched') {
            statusText.textContent = currentResolution.status === 'ambiguous'
              ? `Step ${steps.length + 1}: this target is not unique enough to run safely.`
              : `Step ${steps.length + 1}: Galaxy could not resolve this target cleanly.`;
            const retry = recorderButton('Choose another target', true);
            retry.addEventListener('click', () => {
              setRecorderPicking(true);
              statusText.textContent = `Step ${steps.length + 1}: select a different target.`;
              controls.replaceChildren();
              showCancel();
            });
            controls.append(retry);
            showCancel();
            return;
          }
          statusText.textContent = currentGesture === 'type' || currentGesture === 'select'
            ? `Step ${steps.length + 1}: target resolved uniquely at ${Math.round(currentResolution.score * 100)}% confidence.`
            : `Step ${steps.length + 1}: target resolved uniquely at ${Math.round(currentResolution.score * 100)}% confidence. Choose whether to perform it or finish recording without changing the page.`;
          const confirm = recorderButton(currentGesture === 'type' ? 'Continue to sample' : currentGesture === 'select' ? 'Choose value' : `Perform ${currentGesture}`);
          confirm.addEventListener('click', () => {
            if (currentGesture === 'type') {
              renderSampleInput();
              return;
            }
            if (currentGesture === 'select') {
              void renderSelectInput();
              return;
            }
            dispatchInteraction(currentResolution.element, currentGesture);
            recordConfirmedStep();
          });
          const finish = currentGesture === 'type' || currentGesture === 'select' ? null : recorderButton(`Finish without ${currentGesture === 'click' ? 'clicking' : currentGesture === 'double-click' ? 'double-clicking' : 'right-clicking'}`, true);
          finish?.addEventListener('click', finishWithoutPerforming);
          const retry = recorderButton('Choose again');
          retry.addEventListener('click', () => {
            setRecorderPicking(true);
            statusText.textContent = `Step ${steps.length + 1}: select the target again.`;
            controls.replaceChildren();
            showCancel();
          });
          controls.append(...[finish, confirm, retry].filter(Boolean));
          showCancel();
        };
        commandRecorder = {
          select(element, result) {
            if (!recordSnapshot && options.commandRecorder.scope === 'record') {
              recordSnapshot = result;
              scopeElement = element;
              scopeSnapshot = result;
              const box = document.createElement('div');
              box.dataset.collectionSelection = 'true';
              box.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #27865f;background:#27865f12;box-sizing:border-box;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:3px 5px';
              box.textContent = 'Command record';
              document.documentElement.append(box);
              trackedBoxes.push({ element, box });
              renderChooseGesture();
              return;
            }
            currentTarget = result;
            const scope = options.commandRecorder.scope === 'record' ? resolvedScope() : document;
            const minimumTargetConfidence = patternThresholds(options.commandRecorder.pattern || {}).minimumTargetConfidence;
            // A page number is found again by its number, as runs find the next one.
            const pageNumber = singlePick?.pageNumber ? pageNumberText(element) : null;
            currentResolution = !scope
              ? { status: 'no_match', reason: 'record_not_found' }
              : singlePick?.pageNumber && pageNumber === null
                ? { status: 'no_match', reason: 'not_a_page_number' }
                : resolveInteractionTarget(scope, result, minimumTargetConfidence, currentGesture, pageNumber);
            if (pickOptions) renderSinglePickConfirmation();
            else renderTargetConfirmation();
          },
        };
        if (options.commandRecorder.scope === 'record') {
          setRecorderPicking(true);
          statusText.textContent = 'Select one matching record to scope this command.';
          controls.replaceChildren();
          showCancel();
        } else if (pickOptions?.choices) {
          renderPickChoices();
        } else if (pickOptions) {
          startSinglePick();
        } else {
          renderChooseGesture();
        }
        status.append(statusText, controls);
      } else {
        status.append(statusText, navigationButton);
      }
      if (!options.commandRecorder && inspectionKind === 'target' && options.multiSelect) {
        const selectedItems = [];
        const selectedElements = new Set();
        const doneButton = document.createElement('button');
        doneButton.type = 'button';
        doneButton.textContent = 'Done';
        doneButton.style.cssText = 'padding:5px 9px;border:0;border-radius:999px;background:#fff;color:#8b2d20;font:700 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer';
        const undoButton = document.createElement('button');
        undoButton.type = 'button';
        undoButton.textContent = 'Undo last';
        undoButton.disabled = true;
        undoButton.style.cssText = doneButton.style.cssText;
        // Picking the first example's fields, the box picked just before is the last thing to undo: with no fields
        // picked, Undo last goes back to picking the box.
        const undoesParent = Boolean(options.undoParent);
        // With the fields there are to fill (a site setup's collection: Title, Company, Pay…), each pick is asked which it
        // is, and what is picked and what is left is said as picking goes, so nothing has to be remembered. A pick can be
        // skipped and assigned later, in the builder. The answer goes with the pick (`fieldId`).
        const fieldChoices = Array.isArray(options.fieldChoices) ? options.fieldChoices.filter((choice) => choice?.id && choice?.label) : [];
        const fieldButtons = document.createElement('span');
        fieldButtons.style.cssText = 'display:contents';
        let assigning = null;
        const fieldLabel = (id) => fieldChoices.find((choice) => choice.id === id)?.label || id;
        const updateCollectionStatus = () => {
          const picked = selectedItems.map((item) => item.result.fieldId).filter(Boolean);
          const left = fieldChoices.filter((choice) => !picked.includes(choice.id)).map((choice) => choice.label);
          statusText.textContent = rangeStart?.status || (assigning
            ? `Which field is this? “${(assigning.result.range?.summary || visibleText(assigning.element)).slice(0, 80)}”`
            : fieldChoices.length
              ? selectedItems.length
                ? `Picked: ${picked.map(fieldLabel).join(', ') || 'nothing named yet'}${left.length ? ` · Still to pick: ${left.join(', ')}` : ''} · then Done`
                : `${options.prompt || 'Pick what to read'} · Fields: ${left.join(', ')}`
              : selectedItems.length
                ? `${selectedItems.length} ${selectedItems.length === 1 ? 'field' : 'fields'} selected`
                : options.prompt || (undoesParent ? 'Select fields, or Undo last to pick the box again' : 'Select fields, or choose Done to cancel'));
          undoButton.disabled = selectedItems.length === 0 && !undoesParent;
        };
        const finishAssigning = () => {
          assigning = null;
          fieldButtons.replaceChildren();
          navigationButton.hidden = false;
          doneButton.hidden = false;
          if (wrongPageButton) wrongPageButton.hidden = false;
          pickingPaused = false;
          updateCollectionStatus();
        };
        // The page waits for the answer: picking is paused, and only the fields, Skip, and Undo last are offered.
        const askField = (item) => {
          assigning = item;
          pickingPaused = true;
          document.getElementById('hvy-galaxy-inspector-picker')?.remove();
          navigationButton.hidden = true;
          doneButton.hidden = true;
          if (wrongPageButton) wrongPageButton.hidden = true;
          const taken = new Set(selectedItems.map((selected) => selected.result.fieldId).filter(Boolean));
          const fieldButton = (label, id, fieldId) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.dataset.toolbarId = id;
            button.style.cssText = doneButton.style.cssText;
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (fieldId) item.result.fieldId = fieldId;
              finishAssigning();
            });
            return button;
          };
          fieldButtons.replaceChildren(
            ...fieldChoices.filter((choice) => !taken.has(choice.id)).map((choice, index) => fieldButton(choice.label, `field-${index}`, choice.id)),
            fieldButton('Skip', 'field-skip', null),
          );
          updateCollectionStatus();
        };
        navigationButton.addEventListener('click', () => { if (!pickingPaused) updateCollectionStatus(); });
        rangeStatus = updateCollectionStatus;
        targetCollection = {
          // A range is boxed over its text. It may start at an element already picked as a field (the title it starts after).
          add(element, result, textRange = null) {
            if (!textRange && selectedElements.has(element)) return;
            if (!textRange) selectedElements.add(element);
            const box = document.createElement('div');
            box.dataset.collectionSelection = 'true';
            box.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #27865f;background:#27865f1f;box-sizing:border-box;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
            box.textContent = `${selectedItems.length + 1}`;
            box.style.padding = '3px 5px';
            document.documentElement.append(box);
            const tracked = { element, box, ...(textRange ? { rect: () => textRange.getBoundingClientRect() } : {}) };
            trackedBoxes.push(tracked);
            const item = { element, result, tracked, textRange };
            selectedItems.push(item);
            updateSelectionBoxes();
            if (fieldChoices.length) askField(item);
            else updateCollectionStatus();
          },
        };
        undoLastPick = () => {
          if (selectedItems.length) undoButton.click();
        };
        undoButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const removed = selectedItems.pop();
          if (!removed && undoesParent) {
            publish({ kind: 'integration-target-collection-undo-parent' });
            window.__hvyGalaxyInspector.stop();
            return;
          }
          if (!removed) return;
          if (removed === assigning) finishAssigning();
          if (!removed.textRange) selectedElements.delete(removed.element);
          removed.tracked.box.remove();
          const trackedIndex = trackedBoxes.indexOf(removed.tracked);
          if (trackedIndex >= 0) trackedBoxes.splice(trackedIndex, 1);
          updateCollectionStatus();
        });
        doneButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (options.deriveParent && selectedItems.length) {
            publish({ kind: 'integration-target-collection', ...recordAround(selectedItems.map((item) => item.result)) });
          } else {
            publish({ kind: 'integration-target-collection', items: selectedItems.map((item) => item.result) });
          }
          window.__hvyGalaxyInspector.stop();
        });
        undoButton.dataset.toolbarId = 'undo';
        doneButton.dataset.toolbarId = 'done';
        doneButton.dataset.toolbarPrimary = 'true';
        // An item a site setup just opened from its list may not be the item (a company's page): Wrong page goes back
        // to the list, to click what opens one again.
        const wrongPageButton = options.wrongPage ? document.createElement('button') : null;
        if (wrongPageButton) {
          wrongPageButton.type = 'button';
          wrongPageButton.textContent = 'Wrong page';
          wrongPageButton.dataset.toolbarId = 'wrong-page';
          wrongPageButton.style.cssText = doneButton.style.cssText;
          wrongPageButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            publish({ kind: 'integration-wrong-page' });
            window.__hvyGalaxyInspector.stop();
          });
        }
        status.append(fieldButtons, ...(wrongPageButton ? [wrongPageButton] : []), undoButton, doneButton);
        updateCollectionStatus();
      }
      if (externalToolbar) mirrorStatusToToolbar(status, statusText);
      else document.documentElement.append(status);
      // A check that you're human can come up at any time, and picking takes every click: picking pauses for it, once, so
      // the page takes clicks again, and says why. Passing it usually loads the page again, where picking starts over.
      // Resumed by hand while the check still shows, picking stays resumed until the next check.
      const pauseForHumanCheck = () => {
        if (!active || options.commandRecorder) return;
        if (!humanCheckOnPage()) {
          humanCheckPaused = false;
          return;
        }
        if (humanCheckPaused || pickingPaused) return;
        humanCheckPaused = true;
        navigationButton.click();
        statusText.textContent = HUMAN_CHECK_STATUS;
      };
      humanCheckPaused = false;
      clearInterval(humanCheckTimer);
      humanCheckTimer = setInterval(pauseForHumanCheck, 1000);
      pauseForHumanCheck();
      document.addEventListener('pointermove', pointerMove, true);
      document.addEventListener('mousemove', pointerMove, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', keydown, true);
    },
    stop() {
      active = false;
      clearInterval(humanCheckTimer);
      humanCheckTimer = null;
      rangeStart = null;
      rangeStatus = null;
      rangeKeptEnd = null;
      rangeEditing = false;
      inspectionPattern = null;
      targetCollection = null;
      undoLastPick = null;
      commandRecorder = null;
      commandRecordElements = null;
      recordChoice = null;
      toolbarControl = null;
      inspectionContext = null;
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('mousemove', pointerMove, true);
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pendingMove = null;
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keydown, true);
      removeUi();
    },
    control(action) {
      toolbarControl?.(action);
    },
    snapshotElement(element, parent = null, kind = 'target') {
      const previousKind = inspectionKind;
      const previousScope = scopeElement;
      const previousScopeAnchor = scopeAnchorElement;
      inspectionKind = kind === 'scope' ? 'scope' : kind === 'parent' ? 'parent' : 'target';
      scopeElement = parent;
      scopeAnchorElement = kind === 'scope' ? parent : null;
      const result = snapshot(element);
      inspectionKind = previousKind;
      scopeElement = previousScope;
      scopeAnchorElement = previousScopeAnchor;
      return result;
    },
    suggestTargets(element, pattern = {}) {
      return suggestTargetsForParent(element, pattern);
    },
    extractPattern(pattern = {}) {
      return serializeMatches(findPatternMatches(pattern), true);
    },
    executeCommand(payload = {}) {
      return executeCommand(payload);
    },
    async executeCommandAndReport(payload = {}) {
      const result = await executeCommand(payload);
      publish({ kind: 'integration-command-result', requestId: payload.requestId, commandId: payload.command?.id, ...result });
      return result;
    },
    validateReadyChecksAndPublish(checks = {}, context = {}) {
      window.__hvyGalaxyInspector.stop();
      const readiness = pageReadiness(checks);
      const layer = document.createElement('div');
      layer.id = 'hvy-galaxy-ready-check-matches';
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
      const overlays = [];
      (Array.isArray(checks.elements) ? checks.elements : []).forEach((check) => {
        const checkResult = readiness.elements.find((candidate) => candidate.id === check.id);
        const match = resolveInteractionTarget(document, check.snapshot, 0.8, 'click');
        if (!checkResult || match.status !== 'matched') return;
        const color = checkResult.ready ? '#27865f' : '#b33a3a';
        const box = document.createElement('div');
        box.dataset.readyCheckState = checkResult.ready ? 'ready' : 'value-changed';
        box.style.cssText = `position:fixed;border:3px solid ${color};box-sizing:border-box;background:${color}18;color:#fff;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
        const caption = document.createElement('span');
        caption.textContent = checkResult.ready ? `Ready · ${check.name || 'Page landmark'}` : `Value changed · ${check.name || 'Page landmark'}`;
        caption.style.cssText = `display:inline-block;padding:3px 6px;background:${color};color:#fff`;
        box.append(caption);
        layer.append(box);
        overlays.push({ element: match.element, box });
      });
      document.documentElement.append(layer);
      let updateFrame = 0;
      const updateOverlays = () => {
        updateFrame = 0;
        overlays.forEach(({ element, box }) => {
          if (!element.isConnected) {
            box.style.display = 'none';
            return;
          }
          const rect = element.getBoundingClientRect();
          box.style.display = rect.width && rect.height ? 'block' : 'none';
          Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        });
      };
      const scheduleOverlayUpdate = () => {
        if (!updateFrame) updateFrame = requestAnimationFrame(updateOverlays);
      };
      updateOverlays();
      document.addEventListener('scroll', scheduleOverlayUpdate, true);
      window.addEventListener('resize', scheduleOverlayUpdate);
      matchOverlayCleanup = () => {
        document.removeEventListener('scroll', scheduleOverlayUpdate, true);
        window.removeEventListener('resize', scheduleOverlayUpdate);
        if (updateFrame) cancelAnimationFrame(updateFrame);
      };
      const result = {
        kind: 'integration-ready-check-validation',
        context,
        page: { origin: location.origin, pathname: location.pathname },
        ...readiness,
      };
      publish(result);
      return result;
    },
    checkPageReadyAndPublish(checks = {}, context = {}) {
      const result = { kind: 'integration-page-readiness', context, page: { origin: location.origin, pathname: location.pathname }, ...pageReadiness(checks) };
      publish(result);
      return result;
    },
    async extractAndPublish(pattern = {}, context = {}) {
      const runId = ++extractionRun;
      stopLiveExampleWatch();
      const checks = context.readyChecks || { urlMode: 'strict-url', urlValue: location.href, elements: [] };
      const readiness = await waitForPageReadiness(checks);
      if (runId !== extractionRun) return { status: 'cancelled', matches: 0, records: [] };
      if (!readiness.ready) {
        const result = {
          kind: 'integration-extraction',
          context,
          page: { origin: location.origin, pathname: location.pathname },
          status: 'not-ready',
          message: readiness.message,
          readiness,
          matches: 0,
          records: [],
        };
        publish(result);
        return result;
      }
      const pageUrl = location.href;
      const checkPage = () => location.href === pageUrl
        ? pageReadiness(checks)
        : { ready: false, message: 'The browser page changed while fetching records.' };
      let extraction = context.mode === 'examples'
        ? await extractLiveExamples(pattern, runId)
        : await extractAcrossPage(pattern, runId, checkPage);
      const finalReadiness = checkPage();
      if (!finalReadiness.ready) extraction = { status: 'not-ready', message: finalReadiness.message, readiness: finalReadiness, matches: 0, records: [] };
      if (runId !== extractionRun) return { status: 'cancelled', matches: 0, records: [] };
      publish({
        kind: 'integration-extraction',
        context,
        page: { origin: location.origin, pathname: location.pathname },
        ...extraction,
      });
      // Saved examples not found yet are looked for in what the page adds, told by the record type, not this request.
      if (context.mode === 'examples' && extraction.status !== 'not-ready') watchLiveExamples(pattern, [...extraction.records], { mode: 'live-examples', actionId: context.actionId ?? null });
      return extraction;
    },
    cancelExtraction() {
      extractionRun += 1;
      stopLiveExampleWatch();
    },
    extractAcrossPage(pattern = {}) {
      return extractAcrossPage(pattern);
    },
    extractLiveExamples(pattern = {}) {
      return extractLiveExamples(pattern);
    },
    pageReadiness(checks = {}) {
      return pageReadiness(checks);
    },
    selectBestRecords(records = []) {
      const selected = [...records].sort((left, right) => right.score - left.score).slice(0, 100);
      return { matches: selected.length, records: selected };
    },
    matchAndHighlight(pattern = {}) {
      window.__hvyGalaxyInspector.stop();
      const layer = document.createElement('div');
      layer.id = 'hvy-galaxy-pattern-matches';
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
      document.documentElement.append(layer);
      let overlays = [];
      let updateFrame = 0;
      const updateOverlays = () => {
        updateFrame = 0;
        overlays.forEach(({ element, box, rect: rangeRect }) => {
          if (!element.isConnected) {
            box.style.display = 'none';
            return;
          }
          const rect = rangeRect ? rangeRect() : element.getBoundingClientRect();
          box.style.display = rect.width && rect.height ? 'block' : 'none';
          Object.assign(box.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        });
      };
      const scheduleOverlayUpdate = () => {
        if (!updateFrame) updateFrame = requestAnimationFrame(updateOverlays);
      };
      document.addEventListener('scroll', scheduleOverlayUpdate, true);
      window.addEventListener('resize', scheduleOverlayUpdate);
      matchOverlayCleanup = () => {
        document.removeEventListener('scroll', scheduleOverlayUpdate, true);
        window.removeEventListener('resize', scheduleOverlayUpdate);
        if (updateFrame) cancelAnimationFrame(updateFrame);
      };
      const status = document.createElement('div');
      status.id = 'hvy-galaxy-inspector-status';
      status.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;display:grid;grid-template-columns:minmax(280px,1fr) minmax(150px,240px) auto auto auto;align-items:center;gap:10px;width:min(940px,calc(100vw - 24px));box-sizing:border-box;padding:8px 12px;border-radius:8px;background:#e0563f;color:#fff;box-shadow:0 4px 18px #0006;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;pointer-events:auto';
      const statusText = document.createElement('span');
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '50';
      slider.max = '95';
      slider.step = '1';
      slider.value = String(Math.round(patternThresholds(pattern).minimumConfidence * 100));
      slider.setAttribute('aria-label', 'Minimum match confidence');
      const confidenceOutput = document.createElement('output');
      const scopeButton = document.createElement('button');
      scopeButton.type = 'button';
      scopeButton.textContent = pattern.scope ? 'Change section' : 'Limit to section';
      scopeButton.style.cssText = 'padding:5px 9px;border:0;border-radius:6px;background:#fff;color:#8b2d20;font:700 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer';
      scopeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        publish({ kind: 'integration-scope-selection-request' });
      });
      const compareButton = document.createElement('button');
      compareButton.type = 'button';
      compareButton.textContent = 'Compare traits';
      compareButton.style.cssText = 'display:none;padding:5px 9px;border:0;border-radius:6px;background:#fff;color:#8b2d20;font:700 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer';
      const comparison = document.createElement('div');
      let comparisonOpen = false;
      comparison.style.cssText = 'grid-column:1/-1;display:none;gap:18px;max-height:min(62vh,620px);max-width:780px;overflow:auto;margin:0;padding:12px;border-radius:6px;background:#17191d;color:#f2f3f5;user-select:text';
      compareButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        comparisonOpen = !comparisonOpen;
        comparison.style.display = comparisonOpen ? 'grid' : 'none';
        compareButton.textContent = comparisonOpen ? 'Hide comparison' : 'Compare traits';
      });
      let currentPattern = { ...pattern, minimumConfidence: Number(slider.value) / 100 };
      liveMinimumConfidence = currentPattern.minimumConfidence;
      let currentAccepted = [];
      const renderMatches = () => {
        layer.replaceChildren();
        overlays = [];
        currentAccepted = findPatternMatches(currentPattern);
        const diagnostics = diagnosePattern(currentPattern);
        const visualMatches = [...currentAccepted].sort((left, right) => {
          const leftRect = left.element.getBoundingClientRect();
          const rightRect = right.element.getBoundingClientRect();
          if (Math.abs(leftRect.top - rightRect.top) > 1) return leftRect.top - rightRect.top;
          if (Math.abs(leftRect.left - rightRect.left) > 1) return leftRect.left - rightRect.left;
          const position = left.element.compareDocumentPosition(right.element);
          return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
        });
        const addBox = (element, color, label, width, kind, recordIndex, textRange = null) => {
          const box = document.createElement('div');
          box.dataset.matchKind = kind;
          box.dataset.matchIndex = String(recordIndex + 1);
          box.style.cssText = `position:fixed;border:${width}px solid ${color};box-sizing:border-box;color:#fff;background:${color}18;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
          const caption = document.createElement('span');
          caption.textContent = label;
          caption.style.cssText = `display:inline-block;padding:2px 5px;background:${color};color:#fff`;
          box.append(caption);
          layer.append(box);
          overlays.push({ element, box, ...(textRange ? { rect: () => textRange.getBoundingClientRect() } : {}) });
          return box;
        };
        visualMatches.forEach((match, recordIndex) => {
          addBox(match.element, '#3478d4', `Match ${recordIndex + 1} · ${Math.round(match.score * 100)}%`, 2, 'parent', recordIndex);
          match.matchedTargets
            .filter((target) => target.element && target.score >= match.minimumTargetConfidence)
            .forEach((target) => target.textRange
              // A range field is one box over its text, with its length, so a range that swallowed the footer stands out.
              ? addBox(target.element, '#e0563f', `${target.label || 'Unlabeled target'} · ${readableText(null, target.textRange).length.toLocaleString()} characters`, 3, 'target', recordIndex, target.textRange)
              : target.elements.forEach((item) => addBox(item.element, '#e0563f', target.label || 'Unlabeled target', 3, 'target', recordIndex)));
        });
        confidenceOutput.textContent = `${slider.value}%`;
        statusText.textContent = currentAccepted.length
          ? `${currentAccepted.length} matching ${currentAccepted.length === 1 ? 'item' : 'items'}`
          : (() => {
            const requiredFieldScores = diagnostics.fields
              .filter((_, index) => currentPattern.targets?.[index]?.optional !== true)
              .map((field) => field.score);
            const lowestRequiredField = requiredFieldScores.length ? Math.min(...requiredFieldScores) : null;
            return `No matches · closest record ${Math.round(diagnostics.aggregateScore * 100)}% · parent ${Math.round(diagnostics.bestParentScore * 100)}%${lowestRequiredField === null ? '' : ` · lowest field ${Math.round(lowestRequiredField * 100)}%`}`;
          })();
        compareButton.style.display = 'inline-block';
        renderTraitComparison(comparison, diagnostics, (label, exampleElement, topMatchElement) => {
          comparisonOpen = false;
          comparison.style.display = 'none';
          compareButton.textContent = 'Compare traits';
          layer.querySelectorAll('[data-match-kind="diagnostic-comparison"]').forEach((box) => box.remove());
          overlays = overlays.filter(({ box }) => box.dataset.matchKind !== 'diagnostic-comparison');
          const savedAvailable = Boolean(exampleElement?.isConnected);
          const candidateAvailable = Boolean(topMatchElement?.isConnected);
          if (savedAvailable && candidateAvailable && exampleElement === topMatchElement) {
            addBox(exampleElement, '#ffd166', `Saved + top candidate ${label} · same element`, 4, 'diagnostic-comparison', 0);
            statusText.textContent = `${label}: saved selection and top live candidate are the same element`;
          } else {
            if (savedAvailable) {
              const savedBox = addBox(exampleElement, '#2fbf71', `Saved ${label}`, 3, 'diagnostic-comparison', 0);
              savedBox.style.borderStyle = 'dashed';
            }
            if (candidateAvailable) {
              const candidateBox = addBox(topMatchElement, '#b66cff', `Top candidate ${label}`, 3, 'diagnostic-comparison', 1);
              candidateBox.style.outline = '2px solid #fff';
              candidateBox.style.outlineOffset = '2px';
            }
            statusText.textContent = !savedAvailable
              ? `Saved ${label} was replaced by the page · purple is the top live candidate`
              : !candidateAvailable
                ? `${label}: saved selection is green · no live candidate was located`
                : `${label}: saved selection is dashed green · top live candidate is outlined purple`;
          }
          (topMatchElement?.isConnected ? topMatchElement : exampleElement)?.scrollIntoView({ block: 'center', inline: 'nearest' });
          updateOverlays();
        });
        comparison.style.display = comparisonOpen ? 'grid' : 'none';
        updateOverlays();
      };
      slider.addEventListener('input', () => {
        currentPattern = { ...currentPattern, minimumConfidence: Number(slider.value) / 100 };
        liveMinimumConfidence = currentPattern.minimumConfidence;
        renderMatches();
      });
      status.append(statusText, slider, confidenceOutput, scopeButton, compareButton, comparison);
      document.documentElement.append(status);
      renderMatches();
      const result = serializeMatches(currentAccepted);
      return { matches: result.matches, details: result.records, diagnostics: currentAccepted.length ? null : diagnosePattern(currentPattern) };
    },
  };
})();
