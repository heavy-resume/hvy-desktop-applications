(() => {
  if (window.top !== window || window.__hvyGalaxyInspector) return;

  const ids = ['hvy-galaxy-inspector-highlight', 'hvy-galaxy-inspector-picker', 'hvy-galaxy-inspector-status', 'hvy-galaxy-pattern-matches'];
  let active = false;
  let inspectionKind = 'target';
  let highlighted = null;
  let lastDiagnostics = null;
  let scopeSelector = null;
  let scopeElement = null;

  const removeUi = () => {
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
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status')) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const { directText, accessibleName } = meaningfulText(element);
    return Boolean(directText || accessibleName || imageFor(element) || element.matches('button,a,input,textarea,select,[role],[contenteditable="true"]'));
  };

  const isParentCandidate = (element) => {
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status')) return false;
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
      [tokenSimilarity(left.semanticIdentity, right.semanticIdentity), 0.16],
      [tokenSimilarity(left.semanticLineage, right.semanticLineage), 0.20],
      [visualSimilarity(left.visual, right.visual), 0.08],
    ]);
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
    const scope = scopeElement || (scopeSelector ? document.querySelector(scopeSelector) : null);
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

  const candidatesAt = (x, y, target, composedPath = []) => {
    const lightDomChain = [];
    for (let node = target; node instanceof Element; node = node.parentElement) lightDomChain.push(node);
    const shadowDomChain = composedPath.filter((node) => node instanceof Element);
    const chain = [...new Set([...shadowDomChain, ...lightDomChain])];
    const hitStack = document.elementsFromPoint(x, y);
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
      .filter((element) => inspectionKind !== 'target' || !(scopeElement || scopeSelector) || (scopeElement || document.querySelector(scopeSelector))?.contains(element))
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
      const image = inspectionKind === 'parent' ? null : imageFor(element);
      const choice = document.createElement('button');
      choice.type = 'button';
      const structuralLabel = element.id ? `#${element.id}` : [...element.classList].slice(0, 2).map((name) => `.${name}`).join('') || 'container';
      choice.textContent = inspectionKind === 'parent'
        ? `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${structuralLabel}`
        : `${image ? '🖼️ ' : ''}${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${(directText || accessibleName || (image ? image.alt || 'image' : 'control')).slice(0, 100)}`;
      choice.style.cssText = 'display:block;width:100%;padding:8px;border:0;border-bottom:1px solid #dde3df;background:transparent;color:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer';
      choice.addEventListener('mouseenter', () => {
        picker.querySelectorAll('button').forEach((button) => { button.style.background = 'transparent'; });
        choice.style.background = '#dce8e1';
        highlight(element);
      });
      choice.addEventListener('click', () => {
        if (inspectionKind === 'parent' && !scopeElement) scopeElement = element;
        publish(snapshot(element));
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
    if (!active || !(event.target instanceof Element)) return;
    if (event.target.closest('#hvy-galaxy-inspector-picker')) return;
    const candidate = candidatesAt(event.clientX, event.clientY, event.target, event.composedPath())[0];
    if (candidate && candidate !== highlighted) highlight(candidate);
  };
  const click = (event) => {
    if (!active || event.target instanceof Element && event.target.closest('#hvy-galaxy-inspector-picker')) return;
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
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight, #hvy-galaxy-inspector-status, #hvy-galaxy-pattern-matches')) return false;
    if (element.matches('script,style,link,meta,template')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };

  const findPatternMatches = (pattern = {}) => {
    const parentShapes = (pattern.parents || []).map((sample) => sample?.selected?.shape).filter(Boolean);
    const targets = (pattern.targets || []).filter((target) => target?.snapshot?.selected?.shape);
    const parentCandidates = deepElements(document)
      .filter(isParentCandidate)
      .map((element) => ({ element, parentScore: Math.max(0, ...parentShapes.map((shape) => shapeSimilarity(shape, shapeSignature(element)))) }))
      .filter((candidate) => candidate.parentScore >= 0.62)
      .map((candidate) => {
        const matchedTargets = targets.map((target) => {
          const expected = target.snapshot.selected;
          const matches = deepElements(candidate.element).filter(isStructuralTargetCandidate).map((element) => {
            const shapeScore = shapeSimilarity(expected.shape, shapeSignature(element));
            const relativePathScore = pathSimilarity(expected.relativePath, pathWithin(element, candidate.element));
            return { element, shapeScore, relativePathScore, score: shapeScore * 0.74 + relativePathScore * 0.26 };
          }).sort((left, right) => right.score - left.score);
          return { label: target.label, ...matches[0] };
        });
        const targetScore = matchedTargets.length ? matchedTargets.reduce((sum, target) => sum + (target.score || 0), 0) / matchedTargets.length : 0;
        const hasRelationships = targets.length > 1;
        const relationshipScore = hasRelationships && matchedTargets.every((target) => target.element)
          ? targetRelationshipSimilarity(targets, matchedTargets, candidate.element)
          : 0;
        return {
          ...candidate,
          matchedTargets,
          relationshipScore,
          score: hasRelationships
            ? candidate.parentScore * 0.38 + targetScore * 0.42 + relationshipScore * 0.2
            : candidate.parentScore * 0.55 + targetScore * 0.45,
        };
      })
      .filter((candidate) => {
        const targetElements = candidate.matchedTargets.map((target) => target.element);
        return candidate.matchedTargets.every((target) => target.element && target.score >= 0.74)
          && new Set(targetElements).size === targetElements.length
          && candidate.score >= 0.85;
      })
      .sort((left, right) => right.score - left.score);
    const accepted = [];
    for (const candidate of parentCandidates) {
      if (accepted.some((match) => match.element.contains(candidate.element) || candidate.element.contains(match.element))) continue;
      accepted.push(candidate);
      if (accepted.length >= 50) break;
    }
    return accepted;
  };

  const extractedValue = (element) => {
    const { directText, accessibleName } = meaningfulText(element);
    if (directText) return directText;
    if (accessibleName) return accessibleName;
    const image = imageFor(element);
    return image ? { imageUrl: image.url, alt: image.alt } : '';
  };

  const serializeMatches = (matches, includeValues = false) => ({
    matches: matches.length,
    records: matches.map((match) => ({
      parent: cssPath(match.element),
      score: match.score,
      parentScore: match.parentScore,
      relationshipScore: match.relationshipScore,
      targets: match.matchedTargets.map((target) => ({
        label: target.label,
        element: cssPath(target.element),
        score: target.score,
        shapeScore: target.shapeScore,
        relativePathScore: target.relativePathScore,
        ...(includeValues ? { value: extractedValue(target.element) } : {}),
      })),
    })),
  });

  const selectConfidenceCluster = (records = []) => {
    const ranked = [...records].sort((left, right) => right.score - left.score);
    const confidenceGap = 0.035;
    const splitIndex = ranked.findIndex((record, index) => {
      const next = ranked[index + 1];
      return next && record.score - next.score >= confidenceGap;
    });
    return splitIndex >= 0 ? ranked.slice(0, splitIndex + 1) : ranked;
  };

  window.__hvyGalaxyInspector = {
    start(kind = 'target', options = {}) {
      inspectionKind = kind === 'parent' ? 'parent' : 'target';
      if (inspectionKind === 'parent' && options.primary) scopeElement = null;
      scopeSelector = options.parentCssPath || null;
      active = true;
      removeUi();
      const status = document.createElement('div');
      status.id = 'hvy-galaxy-inspector-status';
      status.textContent = inspectionKind === 'parent' ? 'Galaxy: select a parent' : 'Galaxy: select target data';
      status.style.cssText = 'position:fixed;z-index:2147483647;top:12px;right:12px;padding:8px 12px;border-radius:999px;background:#e0563f;color:#fff;box-shadow:0 4px 18px #0006;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;pointer-events:none';
      document.documentElement.append(status);
      document.addEventListener('pointermove', pointerMove, true);
      document.addEventListener('click', click, true);
      document.addEventListener('keydown', keydown, true);
    },
    stop() {
      active = false;
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
    extractPattern(pattern = {}) {
      return serializeMatches(findPatternMatches(pattern), true);
    },
    selectBestRecords(records = []) {
      const selected = selectConfidenceCluster(records);
      return { matches: selected.length, records: selected };
    },
    matchAndHighlight(pattern = {}) {
      window.__hvyGalaxyInspector.stop();
      const accepted = findPatternMatches(pattern);
      const layer = document.createElement('div');
      layer.id = 'hvy-galaxy-pattern-matches';
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none';
      accepted.forEach((match, recordIndex) => {
        const addBox = (element, color, label, width) => {
          const rect = element.getBoundingClientRect();
          const box = document.createElement('div');
          box.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:${width}px solid ${color};box-sizing:border-box;color:#fff;background:${color}18;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`;
          const caption = document.createElement('span');
          caption.textContent = label;
          caption.style.cssText = `display:inline-block;padding:2px 5px;background:${color};color:#fff`;
          box.append(caption);
          layer.append(box);
        };
        addBox(match.element, '#3478d4', `Match ${recordIndex + 1} · ${Math.round(match.score * 100)}%`, 2);
        match.matchedTargets.forEach((target) => addBox(target.element, '#e0563f', target.label || 'Unlabeled target', 3));
      });
      document.documentElement.append(layer);
      const result = serializeMatches(accepted);
      return { matches: result.matches, details: result.records };
    },
  };
})();
