(() => {
  if (window.top !== window || window.__hvyGalaxyInspector) return;

  const ids = ['hvy-galaxy-inspector-highlight', 'hvy-galaxy-inspector-picker'];
  let active = false;
  let inspectionKind = 'target';
  let highlighted = null;
  let lastDiagnostics = null;

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
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight')) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const { directText, accessibleName } = meaningfulText(element);
    return Boolean(directText || accessibleName || imageFor(element) || element.matches('button,a,input,textarea,select,[role],[contenteditable="true"]'));
  };

  const isAnchorCandidate = (element) => {
    if (element.closest('#hvy-galaxy-inspector-picker, #hvy-galaxy-inspector-highlight')) return false;
    if (element.matches('html,body,script,style,link,meta')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 4 && rect.height >= 4;
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
    return {
      kind: 'integration-inspection',
      inspectionKind,
      page: { origin: location.origin, pathname: location.pathname, userAgent: navigator.userAgent },
      selected: {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        directText: inspectionKind === 'anchor' ? '' : directText.slice(0, 300),
        accessibleName: inspectionKind === 'anchor' ? '' : accessibleName.slice(0, 300),
        descendantText: inspectionKind === 'anchor' ? '' : (element.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 800),
        cssPath: cssPath(element).slice(0, 600),
        attributes: Object.fromEntries(usefulAttributes
          .filter((name) => element.hasAttribute(name))
          .map((name) => [name, (element.getAttribute(name) || '').slice(0, 240)])),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        image: inspectionKind === 'anchor' ? null : imageFor(element),
        semanticAncestry: semanticAncestry(element),
        nearbyFields: nearbyFields(element),
        repeatedContext: repeatedContext(element),
        selectorCandidates: selectorCandidates(element),
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
    const examinedImages = new Set();
    const imagesBehindTarget = [];
    for (const container of chain.slice(0, 10)) {
      for (const image of container.querySelectorAll('img')) {
        examinedImages.add(image);
        const rect = image.getBoundingClientRect();
        if (rect.width && rect.height && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          imagesBehindTarget.push(image);
        }
      }
    }
    const directlyRendersImage = (element) => element.matches('img') || getComputedStyle(element).backgroundImage !== 'none';
    const candidates = [...new Set([...imagesBehindTarget, ...hitStack, ...chain])]
      .filter((element) => inspectionKind === 'anchor' ? isAnchorCandidate(element) : isMeaningful(element))
      .sort((left, right) => Number(directlyRendersImage(right)) - Number(directlyRendersImage(left)))
      .filter((element, index, all) => {
        const signatureFor = (candidate) => {
          if (inspectionKind === 'anchor') return cssPath(candidate);
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
      candidateSnapshotBytes: candidates.map((element) => ({ element: describe(element).element, bytes: snapshotByteLength(element) })),
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
    heading.textContent = inspectionKind === 'anchor' ? 'Choose a structural anchor' : 'Choose the text, control, record, or image';
    heading.style.cssText = 'padding:7px 8px;font-weight:700;border-bottom:1px solid #c5cec8';
    picker.append(heading);
    candidates.forEach((element) => {
      const { directText, accessibleName } = meaningfulText(element);
      const image = imageFor(element);
      const choice = document.createElement('button');
      choice.type = 'button';
      const structuralLabel = element.id ? `#${element.id}` : [...element.classList].slice(0, 2).map((name) => `.${name}`).join('') || 'container';
      choice.textContent = inspectionKind === 'anchor'
        ? `${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${structuralLabel}`
        : `${image ? '🖼️ ' : ''}${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[${element.getAttribute('role')}]` : ''} — ${(directText || accessibleName || (image ? image.alt || 'image' : 'control')).slice(0, 100)}`;
      choice.style.cssText = 'display:block;width:100%;padding:8px;border:0;border-bottom:1px solid #dde3df;background:transparent;color:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer';
      choice.addEventListener('mouseenter', () => {
        picker.querySelectorAll('button').forEach((button) => { button.style.background = 'transparent'; });
        choice.style.background = '#dce8e1';
        highlight(element);
      });
      choice.addEventListener('click', () => {
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

  window.__hvyGalaxyInspector = {
    start(kind = 'target') {
      inspectionKind = kind === 'anchor' ? 'anchor' : 'target';
      active = true;
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
  };
})();
