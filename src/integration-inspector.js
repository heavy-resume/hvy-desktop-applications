(() => {
  if (window.top !== window || window.__hvyGalaxyInspector) return;

  const ids = ['hvy-galaxy-inspector-shield', 'hvy-galaxy-existing-matches', 'hvy-galaxy-inspector-scope', 'hvy-galaxy-inspector-highlight', 'hvy-galaxy-inspector-picker', 'hvy-galaxy-inspector-status', 'hvy-galaxy-pattern-matches'];
  let active = false;
  let pickingPaused = false;
  let inspectionKind = 'target';
  let highlighted = null;
  let lastDiagnostics = null;
  let scopeSelector = null;
  let scopeElement = null;
  let scopeSnapshot = null;
  let inspectionPattern = null;
  let liveMinimumConfidence = null;
  let matchOverlayCleanup = null;
  let selectionOverlayCleanup = null;

  const removeUi = () => {
    matchOverlayCleanup?.();
    matchOverlayCleanup = null;
    selectionOverlayCleanup?.();
    selectionOverlayCleanup = null;
    ids.forEach((id) => document.getElementById(id)?.remove());
    highlighted = null;
  };

  const meaningfulText = (element) => {
    const directText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const accessibleName = element.getAttribute('aria-label')
      || element.getAttribute('alt')
      || (element instanceof HTMLInputElement ? element.value : '')
      || '';
    return { directText, accessibleName: accessibleName.trim() };
  };

  const visibleText = (element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();

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
    return Boolean(directText || accessibleName || imageFor(element) || element.matches('button,a,input,textarea,select,[role],[contenteditable="true"]'));
  };

  const isParentCandidate = (element) => {
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status, #hvy-galaxy-inspector-shield, #hvy-galaxy-inspector-scope')) return false;
    if (element.matches('html,body,script,style,link,meta')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
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
    for (let node = element.parentElement; node && tokens.length < 8; node = node.parentElement) {
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

  const visualSignature = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement?.getBoundingClientRect();
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
      hasShadow: style.boxShadow !== 'none',
      paddingXRatio: ((Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)) / Math.max(1, rect.width),
      paddingYRatio: ((Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)) / Math.max(1, rect.height),
    };
  };

  const deepElements = (root, limit = Infinity) => {
    const initial = root instanceof Document ? [root.documentElement] : [...root.children];
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
    for (let node = element.parentElement; node && ancestors.length < 5; node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role');
      ancestors.push({ tag, role, family: tagFamily(tag, role), tokens: structuralTokens(node) });
    }
    let fullDepth = 0;
    for (let node = element.parentElement; node; node = node.parentElement) fullDepth += 1;
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

  const pathWithin = (element, parent) => {
    const path = [];
    for (let node = element; node instanceof Element && node !== parent; node = node.parentElement) {
      const siblings = node.parentElement ? [...node.parentElement.children].filter((candidate) => candidate.tagName === node.tagName) : [];
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role');
      path.push({ tag, role, family: tagFamily(tag, role), sameTagIndex: siblings.indexOf(node), sameTagCount: siblings.length });
    }
    return path;
  };

  const ratio = (left, right) => left === right ? 1 : Math.min(left, right) / Math.max(1, left, right);
  const histogramSimilarity = (left = {}, right = {}) => {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    if (!keys.length) return 1;
    const dot = keys.reduce((sum, key) => sum + (left[key] || 0) * (right[key] || 0), 0);
    const leftLength = Math.sqrt(keys.reduce((sum, key) => sum + (left[key] || 0) ** 2, 0));
    const rightLength = Math.sqrt(keys.reduce((sum, key) => sum + (right[key] || 0) ** 2, 0));
    return leftLength && rightLength ? dot / (leftLength * rightLength) : 0;
  };
  const proximity = (left = 0, right = 0, scale = 1) => Math.max(0, 1 - Math.abs(left - right) / scale);
  const tagSimilarity = (left, right) => left === right ? 1 : tagFamily(left) === tagFamily(right) ? 0.72 : 0;
  const enumSimilarity = (left, right) => left === right ? 1 : 0;
  const tokenSimilarity = (left = [], right = []) => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const union = new Set([...leftSet, ...rightSet]);
    if (!union.size) return 1;
    return [...leftSet].filter((value) => rightSet.has(value)).length / union.size;
  };
  const weightedSimilarity = (parts) => {
    const weight = parts.reduce((sum, part) => sum + part[1], 0);
    return weight ? parts.reduce((sum, part) => sum + part[0] * part[1], 0) / weight : 0;
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
    [enumSimilarity(left.hasShadow, right.hasShadow), 0.035],
    [proximity(left.paddingXRatio, right.paddingXRatio, 0.5), 0.06],
    [proximity(left.paddingYRatio, right.paddingYRatio, 0.5), 0.06],
  ]);
  const shapeSimilarity = (left, right) => {
    if (!left || !right) return 0;
    const ancestorMatches = (left.ancestors || []).slice(0, 5).reduce((score, item, index) => {
      const other = right.ancestors?.[index];
      if (!other) return score;
      return score + weightedSimilarity([
        [tagSimilarity(item.tag, other.tag), 0.2],
        [enumSimilarity(item.family, other.family), 0.15],
        [enumSimilarity(item.role, other.role), 0.1],
        [tokenSimilarity(item.tokens, other.tokens), 0.55],
      ]);
    }, 0) / 5;
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
      for (let node = element.parentElement; node && node !== parent; node = node.parentElement) ancestors.push(node);
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
    return {
      kind: 'integration-inspection',
      inspectionKind,
      page: { origin: location.origin, pathname: location.pathname, userAgent: navigator.userAgent },
      selected: {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        directText: inspectionKind === 'parent' ? '' : directText.slice(0, 300),
        accessibleName: inspectionKind === 'parent' ? '' : accessibleName.slice(0, 300),
        descendantText: inspectionKind === 'parent' ? '' : (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800),
        cssPath: cssPath(element).slice(0, 600),
        attributes: Object.fromEntries(usefulAttributes
          .filter((name) => element.hasAttribute(name))
          .map((name) => [name, (element.getAttribute(name) || '').slice(0, 240)])),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        image: inspectionKind === 'parent' ? null : imageFor(element),
        semanticAncestry: semanticAncestry(element),
        nearbyFields: inspectionKind === 'parent' ? [] : nearbyFields(element),
        repeatedContext: inspectionKind === 'parent' ? null : repeatedContext(element),
        selectorCandidates: selectorCandidates(element),
        shape: shapeSignature(element),
        relativePath: scope instanceof Element && scope.contains(element) ? pathWithin(element, scope) : null,
        scopeCssPath: scope instanceof Element ? cssPath(scope) : null,
      },
    };
  };

  const publish = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    window.location.href = `hvy-integration://inspection/${encoded}`;
  };

  const snapshotByteLength = (element) => new TextEncoder().encode(JSON.stringify(snapshot(element))).byteLength;

  const highlight = (element) => {
    highlighted = element;
    let box = document.getElementById('hvy-galaxy-inspector-highlight');
    if (!box) {
      box = document.createElement('div');
      box.id = 'hvy-galaxy-inspector-highlight';
      box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #e0563f;background:#e0563f1f;box-sizing:border-box;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif';
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
    box.textContent = element.tagName.toLowerCase();
    box.style.padding = '3px 5px';
  };

  const elementsBehindInspector = (x, y) => {
    const shield = document.getElementById('hvy-galaxy-inspector-shield');
    if (shield) shield.style.pointerEvents = 'none';
    const collect = (root) => {
      const hits = typeof root.elementsFromPoint === 'function' ? root.elementsFromPoint(x, y) : [];
      const result = [];
      hits.forEach((element) => {
        if (element.shadowRoot) result.push(...collect(element.shadowRoot));
        result.push(element);
      });
      return result;
    };
    const hits = [...new Set(collect(document))];
    if (shield) shield.style.pointerEvents = 'auto';
    return hits;
  };

  const candidatesAt = (x, y, target, composedPath = []) => {
    const hitStack = elementsBehindInspector(x, y);
    const underlyingTarget = hitStack[0] || target;
    const lightDomChain = [];
    for (let node = underlyingTarget; node instanceof Element; node = node.parentElement) lightDomChain.push(node);
    const shadowDomChain = [...hitStack, ...composedPath.filter((node) => node instanceof Element)];
    const chain = [...new Set([...shadowDomChain, ...lightDomChain])];
    if (inspectionKind === 'parent') {
      const candidates = [...new Set([...hitStack, ...chain])]
        .filter(isParentCandidate)
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
      .filter((element) => inspectionKind !== 'target' || !(scopeElement || scopeSelector || scopeSnapshot) || resolvedScope()?.contains(element))
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
    heading.textContent = inspectionKind === 'parent' ? 'Choose the parent containing one complete item' : 'Choose data inside the selected parent';
    heading.style.cssText = 'padding:7px 8px;font-weight:700;border-bottom:1px solid #c5cec8';
    picker.append(heading);
    candidates.forEach((element) => {
      const { directText, accessibleName } = inspectionKind === 'parent' ? { directText: '', accessibleName: '' } : meaningfulText(element);
      const completeText = inspectionKind === 'parent' ? '' : visibleText(element);
      const image = inspectionKind === 'parent' ? null : imageFor(element);
      const choice = document.createElement('button');
      choice.type = 'button';
      const structuralLabel = element.id ? `#${element.id}` : [...element.classList].slice(0, 2).map((name) => `.${name}`).join('') || 'container';
      choice.textContent = inspectionKind === 'parent'
        ? `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${structuralLabel}`
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
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };

  const elementsOverlap = (left, right) => left === right || left.contains(right) || right.contains(left);

  const targetSnapshots = (target) => (target.snapshots?.length ? target.snapshots : [target.snapshot]).filter((snapshotValue) => snapshotValue?.selected);
  const learnedNestedRelationship = (leftTarget, rightTarget) => targetSnapshots(leftTarget).some((leftSnapshot) => targetSnapshots(rightTarget).some((rightSnapshot) => {
    const left = leftSnapshot.selected;
    const right = rightSnapshot.selected;
    if (!left.scopeCssPath || left.scopeCssPath !== right.scopeCssPath || !left.cssPath || !right.cssPath || left.cssPath === right.cssPath) return false;
    return left.cssPath.startsWith(`${right.cssPath} > `) || right.cssPath.startsWith(`${left.cssPath} > `);
  }));

  const evaluateParentCandidate = (element, parentScore, targets, minimumTargetConfidence = 0.74) => {
    const targetEvaluations = targets.map((target, fieldIndex) => {
      const variants = (target.snapshots?.length ? target.snapshots : [target.snapshot]).filter((variant) => variant?.selected?.shape);
      const negativeVariants = (target.negativeSnapshots || []).filter((variant) => variant?.selected?.shape);
      const matches = deepElements(element).filter(isStructuralTargetCandidate).map((candidate, candidateIndex) => {
        const positive = variants.map((variant, variantIndex) => {
          const expected = variant.selected;
          const shapeScore = shapeSimilarity(expected.shape, shapeSignature(candidate));
          const relativePathScore = pathSimilarity(expected.relativePath, pathWithin(candidate, element));
          return { element: candidate, shapeScore, relativePathScore, score: shapeScore * 0.74 + relativePathScore * 0.26, variantIndex, matchedSnapshot: variant };
        }).sort((left, right) => right.score - left.score)[0];
        const negativeScore = Math.max(0, ...negativeVariants.map((variant) => {
          const expected = variant.selected;
          const shapeScore = shapeSimilarity(expected.shape, shapeSignature(candidate));
          const relativePathScore = pathSimilarity(expected.relativePath, pathWithin(candidate, element));
          return shapeScore * 0.74 + relativePathScore * 0.26;
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
    const minimumConfidence = typeof pattern.minimumConfidence === 'number' ? Math.max(0.7, Math.min(0.95, pattern.minimumConfidence)) : 0.85;
    return { minimumConfidence, minimumTargetConfidence: Math.max(0.65, minimumConfidence - 0.11) };
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
    return deepElements(document)
      .filter(isParentCandidate)
      .map((element) => ({ element, parentScore: Math.max(0, ...parentShapes.map((shape) => shapeSimilarity(shape, shapeSignature(element)))) }))
      .filter((candidate) => candidate.parentScore >= 0.62)
      .map((candidate) => {
        const evaluated = evaluateParentCandidate(candidate.element, candidate.parentScore, targets, minimumTargetConfidence);
        const presentTargets = evaluated.matchedTargets.filter((target) => !target.optional || target.element && target.score >= minimumTargetConfidence);
        const targetElements = presentTargets.map((target) => target.element).filter(Boolean);
        const distinctTargets = new Set(targetElements).size === targetElements.length;
        const targetsPass = evaluated.matchedTargets.every((target) => target.optional || target.element && target.score >= minimumTargetConfidence);
        return {
          ...evaluated,
          distinctTargets,
          targetsPass,
          accepted: targetsPass && distinctTargets && evaluated.score >= minimumConfidence,
          minimumConfidence,
          minimumTargetConfidence,
        };
      });
  };

  const findPatternMatches = (pattern = {}) => {
    const parentCandidates = evaluatePatternCandidates(pattern)
      .filter((candidate) => candidate.accepted)
      .sort((left, right) => right.score - left.score);
    const accepted = [];
    for (const candidate of parentCandidates) {
      if (accepted.some((match) => match.element.contains(candidate.element) || candidate.element.contains(match.element))) continue;
      accepted.push(candidate);
      if (accepted.length >= 50) break;
    }
    return accepted;
  };

  const diagnosePattern = (pattern = {}) => {
    const parentShapes = (pattern.parents || []).map((sample) => sample?.selected?.shape).filter(Boolean);
    const targets = (pattern.targets || []).filter((target) => target?.snapshot?.selected?.shape || target?.snapshots?.some((variant) => variant?.selected?.shape));
    const rankedParents = deepElements(document)
      .filter(isParentCandidate)
      .map((element) => ({ element, score: Math.max(0, ...parentShapes.map((shape) => shapeSimilarity(shape, shapeSignature(element)))) }))
      .sort((left, right) => right.score - left.score);
    const bestParent = rankedParents[0];
    const evaluated = bestParent ? evaluateParentCandidate(bestParent.element, bestParent.score, targets) : null;
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
          ? deepElements(bestParent.element).filter(isStructuralTargetCandidate).map((element) => {
            const shapeScore = shapeSimilarity(expected.shape, shapeSignature(element));
            const relativePathScore = pathSimilarity(expected.relativePath, pathWithin(element, bestParent.element));
            return { shapeScore, relativePathScore, score: shapeScore * 0.74 + relativePathScore * 0.26 };
          }).sort((left, right) => right.score - left.score)[0]
          : null;
        return { label: target.label, score: best?.score || 0, shapeScore: best?.shapeScore || 0, relativePathScore: best?.relativePathScore || 0 };
      }),
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

  const resolveInteractionTarget = (scope, snapshotValue, minimumConfidence) => {
    const expected = snapshotValue?.selected;
    if (!expected?.shape) return { status: 'no_match', reason: 'target_pattern_missing' };
    const candidates = deepElements(scope)
      .filter(isStructuralTargetCandidate)
      .map((element) => {
        const shapeScore = shapeSimilarity(expected.shape, shapeSignature(element));
        const relativePathScore = scope instanceof Element && expected.relativePath
          ? pathSimilarity(expected.relativePath, pathWithin(element, scope))
          : 1;
        const score = scope instanceof Element ? shapeScore * 0.74 + relativePathScore * 0.26 : shapeScore;
        return { element, shapeScore, relativePathScore, score };
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
    element.click();
    return true;
  };

  const executeCommand = (payload = {}) => {
    window.__hvyGalaxyInspector.stop();
    const command = payload.command;
    const step = command?.steps?.[0];
    if (!command || !step || !['click', 'right-click'].includes(step.gesture)) return { status: 'no_match', reason: 'command_invalid' };
    const { minimumTargetConfidence } = patternThresholds(payload.pattern);
    let scope = document;
    let record = null;
    if (command.scope === 'record') {
      const records = findPatternMatches(payload.pattern);
      record = payload.recordParent
        ? records.find((candidate) => cssPath(candidate.element) === payload.recordParent)
        : records[0];
      if (!record) return { status: 'no_match', reason: 'record_not_found' };
      scope = record.element;
    }
    const resolved = resolveInteractionTarget(scope, step.target, minimumTargetConfidence);
    if (resolved.status !== 'matched') return resolved;
    dispatchInteraction(resolved.element, step.gesture);
    return {
      status: 'executed',
      commandId: command.id,
      gesture: step.gesture,
      record: record ? cssPath(record.element) : null,
      target: cssPath(resolved.element),
      score: resolved.score,
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
    const settle = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 40));
    };
    const collect = () => {
      for (const record of serializeMatches(findPatternMatches(effectivePattern), true).records) {
        const key = JSON.stringify(record.targets.map((target) => [target.label, target.value]));
        const previous = records.get(key);
        if (!previous || record.score > previous.score) records.set(key, record);
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
    const selected = [...records.values()].sort((left, right) => right.score - left.score).slice(0, 100);
    return {
      matches: selected.length,
      records: selected,
      diagnostics: selected.length ? null : diagnosePattern(effectivePattern),
      minimumConfidence: patternThresholds(effectivePattern).minimumConfidence,
    };
  };

  window.__hvyGalaxyInspector = {
    start(kind = 'target', options = {}) {
      inspectionKind = kind === 'parent' ? 'parent' : 'target';
      scopeElement = null;
      scopeSelector = options.parentCssPath || null;
      scopeSnapshot = options.parentSnapshot || null;
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
      if (inspectionPattern) {
        const existingLayer = document.createElement('div');
        existingLayer.id = 'hvy-galaxy-existing-matches';
        existingLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none';
        const { minimumConfidence } = patternThresholds(inspectionPattern);
        const rankedCandidates = evaluatePatternCandidates(inspectionPattern)
          .filter((candidate) => candidate.parentScore >= Math.max(0.7, minimumConfidence - 0.13))
          .sort((left, right) => right.parentScore - left.parentScore || right.score - left.score);
        const diagnosticCandidates = [];
        for (const candidate of rankedCandidates) {
          if (diagnosticCandidates.some((record) => record.element.contains(candidate.element) || candidate.element.contains(record.element))) continue;
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
      };
      const status = document.createElement('div');
      status.id = 'hvy-galaxy-inspector-status';
      status.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;display:flex;align-items:center;gap:10px;padding:6px 8px 6px 12px;border-radius:999px;background:#e0563f;color:#fff;box-shadow:0 4px 18px #0006;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;pointer-events:auto';
      const statusText = document.createElement('span');
      statusText.dataset.inspectorStatusText = 'true';
      const activeStatusText = inspectionKind === 'parent'
        ? options.existingPattern ? 'Galaxy: add example · green passes · orange/red needs attention' : 'Galaxy: select a parent'
        : 'Galaxy: select target data';
      statusText.textContent = activeStatusText;
      const navigationButton = document.createElement('button');
      navigationButton.type = 'button';
      navigationButton.textContent = 'Navigate page';
      navigationButton.style.cssText = 'padding:5px 9px;border:0;border-radius:999px;background:#fff;color:#8b2d20;font:600 11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer';
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
      status.append(statusText, navigationButton);
      document.documentElement.append(status);
      document.addEventListener('pointermove', pointerMove, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', keydown, true);
    },
    stop() {
      active = false;
      inspectionPattern = null;
      document.removeEventListener('pointermove', pointerMove, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', keydown, true);
      removeUi();
    },
    snapshotElement(element, parent = null, kind = 'target') {
      const previousKind = inspectionKind;
      const previousScope = scopeElement;
      inspectionKind = kind === 'parent' ? 'parent' : 'target';
      scopeElement = parent;
      const result = snapshot(element);
      inspectionKind = previousKind;
      scopeElement = previousScope;
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
    executeCommandAndReport(payload = {}) {
      const result = executeCommand(payload);
      if (result.status !== 'executed') publish({ kind: 'integration-command-result', commandId: payload.command?.id, ...result });
      return result;
    },
    async extractAndPublish(pattern = {}, context = {}) {
      const extraction = await extractAcrossPage(pattern);
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
      status.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;display:grid;grid-template-columns:auto minmax(150px,240px) auto;align-items:center;gap:10px;max-width:min(720px,calc(100vw - 24px));padding:8px 12px;border-radius:8px;background:#e0563f;color:#fff;box-shadow:0 4px 18px #0006;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;pointer-events:auto';
      const statusText = document.createElement('span');
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '70';
      slider.max = '95';
      slider.step = '1';
      slider.value = String(Math.round(patternThresholds(pattern).minimumConfidence * 100));
      slider.setAttribute('aria-label', 'Minimum match confidence');
      const confidenceOutput = document.createElement('output');
      let currentPattern = { ...pattern, minimumConfidence: Number(slider.value) / 100 };
      liveMinimumConfidence = currentPattern.minimumConfidence;
      let currentAccepted = [];
      const renderMatches = () => {
        layer.replaceChildren();
        overlays = [];
        currentAccepted = findPatternMatches(currentPattern);
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
            const diagnostics = diagnosePattern(currentPattern);
            return `No matches · closest record ${Math.round(diagnostics.aggregateScore * 100)}%`;
          })();
        updateOverlays();
      };
      slider.addEventListener('input', () => {
        currentPattern = { ...currentPattern, minimumConfidence: Number(slider.value) / 100 };
        liveMinimumConfidence = currentPattern.minimumConfidence;
        renderMatches();
      });
      status.append(statusText, slider, confidenceOutput);
      document.documentElement.append(status);
      renderMatches();
      const result = serializeMatches(currentAccepted);
      return { matches: result.matches, details: result.records, diagnostics: currentAccepted.length ? null : diagnosePattern(currentPattern) };
    },
  };
})();
