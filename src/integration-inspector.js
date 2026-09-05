(() => {
  if (window.top !== window || window.__hvyGalaxyInspector) return;

  const ids = ['hvy-galaxy-inspector-shield', 'hvy-galaxy-existing-matches', 'hvy-galaxy-inspector-scope', 'hvy-galaxy-inspector-highlight', 'hvy-galaxy-inspector-picker', 'hvy-galaxy-inspector-status', 'hvy-galaxy-pattern-matches', 'hvy-galaxy-ready-check-matches'];
  let active = false;
  let pickingPaused = false;
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
  let commandRecorder = null;
  let commandRecordElements = null;
  let toolbarControl = null;
  let inspectionContext = null;
  let captureSequence = 0;
  let browserChromeHost = null;
  const nativePublish = typeof window.__hvyGalaxyPublish === 'function' ? window.__hvyGalaxyPublish : null;
  const capturedElements = new Map();
  const observedStructuredUrls = new Map();
  const xhrStructuredUrls = new WeakMap();

  const observeStructuredUrl = (value, contentType = '') => {
    try {
      const url = new URL(value instanceof Request ? value.url : String(value), location.href);
      if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
      const normalizedType = contentType.toLowerCase();
      const kind = normalizedType.includes('json') ? 'json-api' : normalizedType.includes('atom') ? 'atom' : normalizedType.includes('rss') || normalizedType.includes('xml') ? 'rss' : null;
      if (kind) observedStructuredUrls.set(url.href, kind);
    } catch (_) {}
  };

  const pageFetch = window.fetch.bind(window);
  window.fetch = (input, init) => pageFetch(input, init).then((response) => {
    observeStructuredUrl(response.url || input, response.headers.get('content-type') || '');
    return response;
  });
  const pageXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (String(method).toUpperCase() === 'GET') {
      try { xhrStructuredUrls.set(this, new URL(String(url), location.href).href); } catch (_) {}
    }
    return pageXhrOpen.call(this, method, url, ...rest);
  };
  const pageXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', () => {
      const url = xhrStructuredUrls.get(this);
      if (url) observeStructuredUrl(url, this.getResponseHeader('content-type') || '');
    }, { once: true });
    return pageXhrSend.apply(this, args);
  };

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

  const visibleText = (element) => {
    const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    const pseudo = pseudoElements(element);
    return [pseudo.before.text, pseudo.after.text].filter(Boolean).join(' ');
  };

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

  const shapeSignature = (element) => {
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
        scopeCssPath: scope instanceof Element ? cssPath(scope) : null,
      },
    };
  };

  const publish = (value) => {
    if (nativePublish) {
      nativePublish(value);
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.location.href = `hvy-integration://inspection/${encoded}`;
  };

  const publishToolbarState = (value) => {
    if (typeof window.__hvyGalaxyToolbarPublish === 'function') {
      window.__hvyGalaxyToolbarPublish(value);
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.location.href = `hvy-integration://toolbar-state/${encoded}`;
  };

  const browserChromeNavigate = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    window.location.href = `hvy-integration://navigate/${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  };

  const installBrowserChrome = (options = {}) => {
    if (browserChromeHost) {
      if (!browserChromeHost.isConnected) document.documentElement.append(browserChromeHost);
      return;
    }
    const host = document.createElement('div');
    browserChromeHost = host;
    host.id = 'hvy-galaxy-browser-chrome';
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'all:initial;position:fixed;inset:0 0 auto 0;height:52px;z-index:2147483647;display:block';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{color-scheme:dark}*{box-sizing:border-box}.bar{height:52px;padding:7px 10px;display:flex;align-items:center;gap:7px;background:#17191e;border-bottom:1px solid #555b64;color:#f4f4f5;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 2px 8px #0008}
      button{height:36px;min-width:36px;padding:0 10px;border:1px solid #5b6069;border-radius:7px;background:#23262d;color:inherit;font:inherit;cursor:pointer}button:hover{background:#30343d}button:focus-visible,input:focus-visible{outline:2px solid #ff5d47;outline-offset:1px}.address{height:36px;min-width:0;flex:1;display:flex;align-items:center;gap:8px;padding:0 11px;border:1px solid #5b6069;border-radius:8px;background:#0f1115}.security{display:flex;align-items:center;gap:6px;white-space:nowrap}.security[data-secure="true"]{color:#9fd7b2}.security[data-allowed="false"]{color:#ffb19f}.host{font-weight:650}.url{min-width:0;flex:1;border:0;background:transparent;color:#dadce1;font:inherit;outline:0}.brand{font-weight:700;white-space:nowrap}.close{font-size:20px;line-height:1}slot[name="inspection"]{display:contents}
    </style><div class="bar"><span class="brand">HVY Galaxy</span><button data-command="back" title="Back" aria-label="Back">←</button><button data-command="forward" title="Forward" aria-label="Forward">→</button><button data-command="reload" title="Reload" aria-label="Reload">↻</button><form class="address"><span class="security"><span class="lock"></span><span class="host"></span></span><input class="url" aria-label="Address"></form><slot name="inspection"><button data-command="inspect" title="Inspect data">Inspect</button></slot><button class="close" data-command="close" title="Close" aria-label="Close">×</button></div>`;
    let reservedBody = null;
    let reservedPadding = '';
    const reservePageSpace = () => {
      if (!document.body) return;
      if (reservedBody !== document.body) {
        reservedBody = document.body;
        const originalPadding = getComputedStyle(document.body).paddingTop || '0px';
        reservedPadding = `calc(${originalPadding} + 52px)`;
      }
      document.body.style.setProperty('padding-top', reservedPadding, 'important');
      document.body.style.setProperty('box-sizing', 'border-box', 'important');
    };
    const mount = () => {
      if (!host.isConnected) document.documentElement.append(host);
      if (typeof host.showPopover === 'function') {
        try { host.showPopover(); } catch (_) { host.removeAttribute('popover'); }
      } else {
        host.removeAttribute('popover');
      }
      reservePageSpace();
    };
    mount();
    document.documentElement.style.setProperty('scroll-padding-top', '52px', 'important');
    const allowedOrigins = new Set(options.allowedOrigins || []);
    const update = () => {
      const secure = location.protocol === 'https:';
      const allowed = !allowedOrigins.size || allowedOrigins.has(location.origin);
      const security = shadow.querySelector('.security');
      security.dataset.secure = String(secure);
      security.dataset.allowed = String(allowed);
      shadow.querySelector('.lock').textContent = secure ? '●' : '▲';
      shadow.querySelector('.host').textContent = location.hostname || location.protocol;
      const input = shadow.querySelector('.url');
      if (shadow.activeElement !== input) input.value = location.href;
      security.title = `${secure ? 'Encrypted HTTPS connection' : 'Connection is not encrypted'} · ${allowed ? 'Allowed page origin' : 'Outside configured page origins'}`;
    };
    shadow.addEventListener('click', (event) => {
      const command = event.target.closest?.('[data-command]')?.dataset.command;
      if (command) window.location.href = `hvy-integration://browser/${command}`;
    });
    shadow.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      let value = shadow.querySelector('.url').value.trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
      browserChromeNavigate(value);
    });
    update();
    window.addEventListener('popstate', update);
    setInterval(() => {
      mount();
      update();
    }, 500);
  };

  const snapshotByteLength = (element) => new TextEncoder().encode(JSON.stringify(snapshot(element))).byteLength;

  const highlight = (element) => {
    highlighted = element;
    let box = document.getElementById('hvy-galaxy-inspector-highlight');
    if (!box) {
      box = document.createElement('div');
      box.id = 'hvy-galaxy-inspector-highlight';
      box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e0563f;background:#e0563f2b;box-sizing:border-box;color:#fff;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 0 0 1px #fff8 inset';
      document.documentElement.append(box);
    }
    const rect = element.getBoundingClientRect();
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
    box.textContent = `${targetCollection ? 'Add field · ' : ''}${element.tagName.toLowerCase()}`;
    box.style.padding = '3px 5px';
  };

  const elementsBehindInspector = (x, y) => {
    const visitedRoots = new Set();
    const collect = (root) => {
      if (visitedRoots.has(root)) return [];
      visitedRoots.add(root);
      const hits = typeof root.elementsFromPoint === 'function' ? root.elementsFromPoint(x, y) : [];
      const result = [];
      hits.forEach((element) => {
        if (element.shadowRoot) result.push(...collect(element.shadowRoot));
        result.push(element);
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
    const candidates = [...new Set([...imagesBehindTarget, ...hitStack, ...chain])]
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
      : inspectionKind === 'scope' ? 'Choose the section that should contain matching items' : inspectionKind === 'parent' ? 'Choose the parent containing one complete item' : 'Choose data inside the selected parent';
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
      choice.addEventListener('mouseenter', () => {
        picker.querySelectorAll('button').forEach((button) => { button.style.background = 'transparent'; });
        choice.style.background = '#dce8e1';
        highlight(element);
      });
      choice.addEventListener('click', () => {
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
      const firstChoice = picker.querySelector('button');
      if (firstChoice) firstChoice.style.background = '#dce8e1';
      highlight(candidates[0]);
    }
  };

  const pointerMove = (event) => {
    if (!active || pickingPaused || !(event.target instanceof Element)) return;
    if (event.target.closest('#hvy-galaxy-inspector-picker')) return;
    const candidate = candidatesAt(event.clientX, event.clientY, event.target, event.composedPath())[0];
    if (candidate && candidate !== highlighted) highlight(candidate);
  };
  const click = (event) => {
    if (!active || pickingPaused || event.target instanceof Element && event.target.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-status')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showPicker(event);
  };
  const keydown = (event) => {
    if (active && event.key === 'Escape') {
      window.location.href = 'hvy-integration://inspection-cancel';
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
      const unique = evaluated.matchedTargets.filter((other) => other.element === target.element).length === 1;
      if (!target.element || target.score < minimumTargetConfidence || !unique) return { label: target.label, score: target.score || 0, snapshot: null };
      const previousKind = inspectionKind;
      const previousScope = scopeElement;
      inspectionKind = 'target';
      scopeElement = element;
      const fullSnapshot = snapshot(target.element);
      inspectionKind = previousKind;
      scopeElement = previousScope;
      const targetSnapshot = {
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
      return { label: target.label, score: target.score, snapshot: targetSnapshot };
    });
  };

  const evaluatePatternCandidates = (pattern = {}) => {
    const { minimumConfidence, minimumTargetConfidence } = patternThresholds(pattern);
    const parentShapes = (pattern.parents || []).map((sample) => sample?.selected?.shape).filter(Boolean);
    const targets = (pattern.targets || []).filter((target) => target?.snapshot?.selected?.shape || target?.snapshots?.some((variant) => variant?.selected?.shape));
    const candidates = patternScopes(pattern).flatMap((scope) => deepElements(scope.element).filter((element) => element !== scope.element));
    return [...new Set(candidates)]
      .filter(isParentCandidate)
      .map((element) => ({ element, parentScore: Math.max(0, ...parentShapes.map((shape) => shapeSimilarity(shape, shapeSignature(element)))) }))
      .filter((candidate) => candidate.parentScore >= Math.max(0.5, minimumConfidence - 0.13))
      .map((candidate) => {
        const evaluated = evaluateParentCandidate(candidate.element, candidate.parentScore, targets, minimumTargetConfidence);
        const presentTargets = evaluated.matchedTargets.filter((target) => !target.optional || target.element && target.score >= minimumTargetConfidence);
        const targetElements = presentTargets.map((target) => target.element).filter(Boolean);
        const distinctTargets = new Set(targetElements).size === targetElements.length;
        const targetsPass = evaluated.matchedTargets.every((target) => target.optional || target.element && target.score >= minimumTargetConfidence);
        const hasMatchedTarget = !targets.length || evaluated.matchedTargets.some((target) => target.element && target.score >= minimumTargetConfidence);
        const hasLearnedAbsence = evaluated.matchedTargets.some((target) => target.optional && target.rejectedByNegative);
        return {
          ...evaluated,
          distinctTargets,
          targetsPass,
          accepted: (hasMatchedTarget || hasLearnedAbsence) && targetsPass && distinctTargets && evaluated.score >= minimumConfidence,
          minimumConfidence,
          minimumTargetConfidence,
        };
      });
  };

  const findPatternMatches = (pattern = {}) => {
    const parentCandidates = evaluatePatternCandidates(pattern)
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

  const extractedValue = (element) => {
    const { directText, accessibleName } = meaningfulText(element);
    const completeText = visibleText(element);
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

  const resolveInteractionTarget = (scope, snapshotValue, minimumConfidence, gesture) => {
    const expected = snapshotValue?.selected;
    if (!expected?.shape) return { status: 'no_match', reason: 'target_pattern_missing' };
    const candidates = structuralTargetsWithin(scope, scope instanceof Element && !expected.relativePath?.length)
      .filter((element) => gesture !== 'type' || isTextEntryElement(element))
      .map((element) => {
        if (scope instanceof Element) return { element, ...targetCandidateSimilarity(expected, element, scope) };
        const shapeScore = shapeSimilarity(expected.shape, shapeSignature(element));
        return { element, shapeScore, relativePathScore: 1, score: shapeScore };
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

  const executeCommand = async (payload = {}) => {
    window.__hvyGalaxyInspector.stop();
    const readiness = pageReadiness(payload.readyChecks || { urlMode: 'strict-url', urlValue: location.href, elements: [] });
    if (!readiness.ready) return { status: 'not-ready', reason: 'page_not_ready', message: readiness.message, readiness, stepIndex: 0, stepsExecuted: 0 };
    const command = payload.command;
    const steps = command?.steps;
    const commandInputs = Array.isArray(command?.inputs) ? command.inputs : [];
    const commandInputIds = new Set(commandInputs.map((input) => input?.id).filter((id) => typeof id === 'string' && id));
    if (!command || !Array.isArray(steps) || !steps.length || steps.some((step) => !step || !['click', 'double-click', 'right-click', 'type'].includes(step.gesture) || (step.gesture === 'type' && (typeof step.inputId !== 'string' || !commandInputIds.has(step.inputId))))) return { status: 'no_match', reason: 'command_invalid', stepIndex: 0, stepsExecuted: 0 };
    const { minimumTargetConfidence } = patternThresholds(payload.pattern);
    let record = null;
    const scopeForStep = () => {
      if (command.scope !== 'record') return document;
      if (record?.element?.isConnected) return record.element;
      const records = findPatternMatches(payload.pattern);
      record = payload.recordParent
        ? records.find((candidate) => cssPath(candidate.element) === payload.recordParent)
        : records[0];
      return record?.element || null;
    };
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      const textInput = step.gesture === 'type' ? payload.inputs?.[step.inputId] : undefined;
      if (step.gesture === 'type' && typeof textInput !== 'string') return { status: 'no_match', reason: 'command_input_missing', inputId: step.inputId, stepIndex, stepsExecuted: stepIndex };
      const initialScope = stepIndex === 0 ? scopeForStep() : null;
      const resolved = stepIndex === 0
        ? initialScope ? resolveInteractionTarget(initialScope, step.target, minimumTargetConfidence, step.gesture) : { status: 'no_match', reason: 'record_not_found' }
        : await waitForInteractionTarget(scopeForStep, step, minimumTargetConfidence);
      if (resolved.status !== 'matched') return { ...resolved, stepIndex, stepsExecuted: stepIndex };
      if (step.gesture === 'type') {
        if (!dispatchTextEntry(resolved.element, textInput)) return { status: 'no_match', reason: 'target_not_text_editable', score: resolved.score, stepIndex, stepsExecuted: stepIndex };
      } else {
        dispatchInteraction(resolved.element, step.gesture);
      }
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
              : target.cardinality === 'list'
                ? target.elements.map((item) => extractedValue(item.element))
                : extractedValue(target.element),
          } : {}),
        };
      }),
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

  const extractAcrossPage = async (pattern = {}) => {
    window.__hvyGalaxyInspector.stop();
    const effectivePattern = { ...pattern, ...(liveMinimumConfidence === null ? {} : { minimumConfidence: liveMinimumConfidence }) };
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
    if (scroller) {
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(240, scroller.clientHeight * 0.7);
      const positions = [];
      for (let top = 0; top < maximum && positions.length < 60; top += step) positions.push(top);
      positions.push(maximum);
      for (const top of positions) {
        scroller.scrollTop = top;
        await settle();
        collect();
      }
      scroller.scrollTop = originalTop;
      await settle();
    } else {
      collect();
    }
    const selected = [...records.values()]
      .sort((left, right) => left.pageTop - right.pageTop || left.pageLeft - right.pageLeft || right.record.score - left.record.score)
      .slice(0, 100)
      .map((entry) => entry.record);
    return {
      matches: selected.length,
      records: selected,
      diagnostics: selected.length ? null : diagnosePattern(effectivePattern),
      minimumConfidence: patternThresholds(effectivePattern).minimumConfidence,
    };
  };

  const extractLiveExamples = async (pattern = {}) => {
    const usedRecords = new Set();
    const records = [];
    for (let exampleIndex = 0; exampleIndex < (pattern.parents || []).length; exampleIndex += 1) {
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
      const extraction = await extractAcrossPage({ ...pattern, parents: [pattern.parents[exampleIndex]], targets });
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

  window.__hvyGalaxyInspector = {
    discoverStructuredSources() {
      const sources = [];
      document.querySelectorAll('link[rel~="alternate"][href]').forEach((link) => {
        const type = (link.getAttribute('type') || '').toLowerCase();
        const kind = type.includes('json') ? 'json-feed' : type.includes('atom') ? 'atom' : type.includes('rss') || type.includes('xml') ? 'rss' : null;
        if (!kind) return;
        sources.push({ kind, url: new URL(link.href, location.href).href, title: link.getAttribute('title') || `${kind.toUpperCase()} feed`, authenticated: false, discoveredBy: 'link' });
      });
      performance.getEntriesByType('resource').forEach((entry) => {
        if (!['fetch', 'xmlhttprequest'].includes(entry.initiatorType)) return;
        let url;
        try { url = new URL(entry.name, location.href); } catch (_) { return; }
        if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
        if (!/\.json(?:$|\?)|[?&](?:format|output)=json(?:&|$)/i.test(url.href)) return;
        sources.push({ kind: 'json-api', url: url.href, title: `${url.pathname}${url.search}`, authenticated: true, discoveredBy: 'network' });
      });
      observedStructuredUrls.forEach((kind, value) => {
        const url = new URL(value);
        sources.push({ kind, url: url.href, title: `${url.pathname}${url.search}`, authenticated: true, discoveredBy: 'network' });
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
      shield.addEventListener('wheel', (event) => {
        const chains = elementsBehindInspector(event.clientX, event.clientY).flatMap((element) => {
          const ancestors = [];
          for (let node = element; node instanceof Element; node = node.parentElement) ancestors.push(node);
          return ancestors;
        });
        const scroller = [...new Set(chains)].find((element) => {
          const style = getComputedStyle(element);
          return element.scrollHeight > element.clientHeight + 2 && /(auto|scroll)/.test(style.overflowY);
        }) || document.scrollingElement;
        if (!scroller) return;
        event.preventDefault();
        scroller.scrollTop += event.deltaY;
        scroller.scrollLeft += event.deltaX;
      }, { passive: false });
      const trackedBoxes = [];
      targetCollection = null;
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
            const uniqueTarget = match.matchedTargets.filter((other) => other.element === target.element).length === 1;
            const passes = Boolean(target.element) && target.score >= match.minimumTargetConfidence && uniqueTarget;
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
              targetCaption.textContent = `${target.label}${target.cardinality === 'list' ? ` ${targetIndex + 1}` : ''} · ${Math.round((target.score || 0) * 100)}%`;
              targetCaption.style.cssText = `display:inline-block;padding:1px 4px;background:${targetColor};color:#fff`;
              targetBox.append(targetCaption);
              existingLayer.append(targetBox);
              trackedBoxes.push({ element, box: targetBox });
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
        trackedBoxes.forEach(({ element, box }) => {
          if (!element.isConnected) {
            box.style.display = 'none';
            return;
          }
          const rect = element.getBoundingClientRect();
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
      updateSelectionBoxes();
      document.addEventListener('scroll', scheduleSelectionUpdate, true);
      window.addEventListener('resize', scheduleSelectionUpdate);
      selectionOverlayCleanup = () => {
        document.removeEventListener('scroll', scheduleSelectionUpdate, true);
        window.removeEventListener('resize', scheduleSelectionUpdate);
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
      const activeStatusText = inspectionKind === 'scope'
        ? 'Galaxy: choose an optional page section'
        : inspectionKind === 'parent'
          ? options.existingPattern ? 'Galaxy: add example · green passes · orange/red needs attention' : 'Galaxy: select a parent'
          : 'Galaxy: select target data';
      statusText.textContent = activeStatusText;
      const navigationButton = document.createElement('button');
      navigationButton.type = 'button';
      navigationButton.textContent = 'Navigate page';
      navigationButton.style.cssText = 'height:36px;padding:0 10px;border:1px solid #ff806d;border-radius:7px;background:#5f2922;color:#fff;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer;white-space:nowrap';
      navigationButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pickingPaused = !pickingPaused;
        shield.style.pointerEvents = pickingPaused ? 'none' : 'auto';
        navigationButton.textContent = pickingPaused ? 'Resume picking' : 'Navigate page';
        statusText.textContent = pickingPaused
          ? 'Galaxy: page navigation enabled'
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
        let typeStepCount = 0;
        const recorderButton = (label, primary = false) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
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
          const gestures = [['click', 'Click'], ['double-click', 'Double click'], ['right-click', 'Right click'], ['type', 'Enter text']];
          gestures.forEach(([gesture, label]) => {
            const button = recorderButton(label, gesture === 'click');
            button.addEventListener('click', () => {
              currentGesture = gesture;
              inspectionKind = 'target';
              setRecorderPicking(true);
              controls.replaceChildren();
              statusText.textContent = `Step ${steps.length + 1}: select the ${gesture === 'type' ? 'text field' : `${label.toLocaleLowerCase()} target`}.`;
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
                  statusText.textContent = `Step ${steps.length + 1}: select the target.`;
                }
              });
              controls.append(pause);
              showCancel();
            });
            controls.append(button);
          });
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
            ...(currentGesture === 'type' ? { inputId: `input-${++typeStepCount}` } : {}),
          });
        };
        const recordConfirmedStep = () => {
          appendRecordedStep();
          setTimeout(renderAfterStep, 150);
        };
        const finishWithoutPerforming = () => {
          appendRecordedStep();
          publish({ kind: 'integration-command-recording', steps });
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
          statusText.textContent = currentGesture === 'type'
            ? `Step ${steps.length + 1}: target resolved uniquely at ${Math.round(currentResolution.score * 100)}% confidence.`
            : `Step ${steps.length + 1}: target resolved uniquely at ${Math.round(currentResolution.score * 100)}% confidence. Choose whether to perform it or finish recording without changing the page.`;
          const confirm = recorderButton(currentGesture === 'type' ? 'Continue to sample' : `Perform ${currentGesture}`);
          confirm.addEventListener('click', () => {
            if (currentGesture === 'type') {
              renderSampleInput();
              return;
            }
            dispatchInteraction(currentResolution.element, currentGesture);
            recordConfirmedStep();
          });
          const finish = currentGesture === 'type' ? null : recorderButton(`Finish without ${currentGesture === 'click' ? 'clicking' : currentGesture === 'double-click' ? 'double-clicking' : 'right-clicking'}`, true);
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
            currentResolution = scope
              ? resolveInteractionTarget(scope, result, minimumTargetConfidence, currentGesture)
              : { status: 'no_match', reason: 'record_not_found' };
            renderTargetConfirmation();
          },
        };
        if (options.commandRecorder.scope === 'record') {
          setRecorderPicking(true);
          statusText.textContent = 'Select one matching record to scope this command.';
          controls.replaceChildren();
          showCancel();
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
        const updateCollectionStatus = () => {
          statusText.textContent = selectedItems.length
            ? `Galaxy: ${selectedItems.length} ${selectedItems.length === 1 ? 'field' : 'fields'} selected`
            : 'Galaxy: select fields, or choose Done to cancel';
          undoButton.disabled = selectedItems.length === 0;
          if (externalToolbar) {
            publishToolbarState({
              active: true,
              status: statusText.textContent,
              navigationLabel: pickingPaused ? 'Resume picking' : 'Navigate page',
              canUndo: selectedItems.length > 0,
            });
          }
        };
        targetCollection = {
          add(element, result) {
            if (selectedElements.has(element)) return;
            selectedElements.add(element);
            const box = document.createElement('div');
            box.dataset.collectionSelection = 'true';
            box.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #27865f;background:#27865f1f;box-sizing:border-box;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
            box.textContent = `${selectedItems.length + 1}`;
            box.style.padding = '3px 5px';
            document.documentElement.append(box);
            const tracked = { element, box };
            trackedBoxes.push(tracked);
            selectedItems.push({ element, result, tracked });
            updateSelectionBoxes();
            updateCollectionStatus();
          },
        };
        undoButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const removed = selectedItems.pop();
          if (!removed) return;
          selectedElements.delete(removed.element);
          removed.tracked.box.remove();
          const trackedIndex = trackedBoxes.indexOf(removed.tracked);
          if (trackedIndex >= 0) trackedBoxes.splice(trackedIndex, 1);
          updateCollectionStatus();
        });
        doneButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          publish({ kind: 'integration-target-collection', items: selectedItems.map((item) => item.result) });
          window.__hvyGalaxyInspector.stop();
        });
        toolbarControl = (action) => {
          if (action === 'navigate') navigationButton.click();
          if (action === 'undo') undoButton.click();
          if (action === 'done') doneButton.click();
          if (action === 'navigate') updateCollectionStatus();
        };
        if (!externalToolbar) status.append(undoButton, doneButton);
        updateCollectionStatus();
      }
      if (!externalToolbar || options.commandRecorder || inspectionKind !== 'target' || !options.multiSelect) document.documentElement.append(status);
      document.addEventListener('pointermove', pointerMove, true);
      document.addEventListener('mousemove', pointerMove, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', keydown, true);
    },
    stop() {
      active = false;
      inspectionPattern = null;
      targetCollection = null;
      commandRecorder = null;
      commandRecordElements = null;
      toolbarControl = null;
      inspectionContext = null;
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('mousemove', pointerMove, true);
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
    async extractAndPublish(pattern = {}, context = {}) {
      const readiness = pageReadiness(context.readyChecks || { urlMode: 'strict-url', urlValue: location.href, elements: [] });
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
      const extraction = context.mode === 'examples'
        ? await extractLiveExamples(pattern)
        : await extractAcrossPage(pattern);
      publish({
        kind: 'integration-extraction',
        context,
        page: { origin: location.origin, pathname: location.pathname },
        ...extraction,
      });
      return extraction;
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
        const addBox = (element, color, label, width, kind, recordIndex) => {
          const box = document.createElement('div');
          box.dataset.matchKind = kind;
          box.dataset.matchIndex = String(recordIndex + 1);
          box.style.cssText = `position:fixed;border:${width}px solid ${color};box-sizing:border-box;color:#fff;background:${color}18;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
          const caption = document.createElement('span');
          caption.textContent = label;
          caption.style.cssText = `display:inline-block;padding:2px 5px;background:${color};color:#fff`;
          box.append(caption);
          layer.append(box);
          overlays.push({ element, box });
          return box;
        };
        visualMatches.forEach((match, recordIndex) => {
          addBox(match.element, '#3478d4', `Match ${recordIndex + 1} · ${Math.round(match.score * 100)}%`, 2, 'parent', recordIndex);
          match.matchedTargets
            .filter((target) => target.element && target.score >= match.minimumTargetConfidence)
            .forEach((target) => target.elements.forEach((item) => addBox(item.element, '#e0563f', target.label || 'Unlabeled target', 3, 'target', recordIndex)));
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
