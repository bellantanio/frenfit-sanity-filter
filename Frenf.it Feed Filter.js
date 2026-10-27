// ==UserScript==
// @name         frenf:it Toolkit (Feed Filter + Background Picker)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  One movable, resizable gear panel for frenf:it: feed filters (users, rooms, keywords, post age, comment action) and a page background color picker with automatic text contrast.
// @match        *://*.frenf.it/*
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- configuration ---------- */

  // The background picker was written for the early-adopters pages. To offer it on every
  // frenf.it page instead, change this pattern to /./
  const BACKGROUND_PATHS = /^\/earlyadopters(\/|$)/;
  const BG_ON = BACKGROUND_PATHS.test(location.pathname);

  // Same storage keys as the two original scripts, so existing settings carry over.
  const KEY = {
    filterEnabled: 'frenfFilterEnabled',
    users: 'frenfBlockedUsers',
    rooms: 'frenfBlockedRooms',
    keywords: 'frenfBlockedKeywords',
    commentAction: 'frenfCommentAction',
    peperonataEnabled: 'frenfPeperonataEnabled',
    peperonataDays: 'frenfPeperonataDays',
    iconPos: 'frenfFilterIconPos',
    configPos: 'frenfConfigPos',
    configScale: 'frenfConfigScale',
    tab: 'frenfConfigTab',
    bgColor: 'frenfBgPicker.color',
  };

  const HEX = /^#[0-9a-f]{6}$/i;
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const UI_ATTR = 'data-frenf-ui'; // marks our own UI so the background engine never recolors it
  const ACTIONS = ['scramble', 'rot13', 'hide'];
  let html = document.documentElement; // can be null if the script starts very early

  // Run `fn` as soon as the <html> element exists.
  function whenRoot(fn) {
    if (document.documentElement) {
      html = document.documentElement;
      fn();
      return;
    }
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      html = document.documentElement;
      fn();
    });
    observer.observe(document, { childList: true });
  }

  // Swatches shown in the picker: darks, mid-tones, lights.
  const PALETTE = [
    '#000000', '#111827', '#0b1d3a', '#1e1b4b', '#042f2e', '#14301f', '#450a0a', '#2e1065',
    '#1e40af', '#0e7490', '#15803d', '#b45309', '#be123c', '#7e22ce', '#475569', '#9ca3af',
    '#ffffff', '#f1f5f9', '#e0f2fe', '#dcfce7', '#fef9c3', '#ffedd5', '#fce7f3', '#ede9fe',
  ];

  /* ---------- storage (localStorage can throw, e.g. in private windows) ---------- */

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(store.get(key));
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }
  const saveJSON = (key, value) => store.set(key, JSON.stringify(value));
  const asList = (value) => (Array.isArray(value) ? value.filter((s) => typeof s === 'string') : []);

  /* ---------- shared state ---------- */

  // Filters
  let filterEnabled = loadJSON(KEY.filterEnabled, true) !== false;
  let blockedUsers = asList(loadJSON(KEY.users, []));
  let blockedRooms = asList(loadJSON(KEY.rooms, []));
  let blockedKeywords = asList(loadJSON(KEY.keywords, []));
  let commentAction = store.get(KEY.commentAction);
  if (ACTIONS.indexOf(commentAction) === -1) commentAction = 'scramble';
  let peperonataEnabled = loadJSON(KEY.peperonataEnabled, false) === true;
  let peperonataDays = parseFloat(store.get(KEY.peperonataDays)) || 1.0;

  // Window layout
  const DEFAULT_ICON_POS = { bottom: '20px', right: '20px', top: 'auto', left: 'auto' };
  const DEFAULT_CONFIG_POS = { bottom: '64px', right: '20px', top: 'auto', left: 'auto' };
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 2;

  function loadPos(key, fallback) {
    const p = loadJSON(key, null);
    const px = (v) => typeof v === 'string' && /px$/.test(v);
    const ok = p && typeof p === 'object' && (px(p.left) || px(p.right)) && (px(p.top) || px(p.bottom));
    return ok
      ? { top: String(p.top), left: String(p.left), bottom: String(p.bottom), right: String(p.right) }
      : Object.assign({}, fallback);
  }

  let iconPos = loadPos(KEY.iconPos, DEFAULT_ICON_POS);
  let configPos = loadPos(KEY.configPos, DEFAULT_CONFIG_POS);
  let configScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, parseFloat(store.get(KEY.configScale)) || 1.0));

  // Background
  let current = BG_ON ? store.get(KEY.bgColor) : null;
  if (!HEX.test(current || '')) current = null;

  let gearEl = null;   // the gear button (set when the UI is built)
  let gearPath = null; // the gear's SVG path, tinted red while filters are active

  /* =====================================================================
     FEED FILTER
     ===================================================================== */

  function hasActiveFilters() {
    return blockedUsers.length > 0 || blockedRooms.length > 0 || blockedKeywords.length > 0 || peperonataEnabled;
  }

  // The gear turns red while filters are on and doing something.
  function updateIconState() {
    if (!gearEl) return;
    const active = filterEnabled && hasActiveFilters();
    gearEl.style.opacity = active ? '0.95' : '0.65';
    if (gearPath) gearPath.setAttribute('fill', active ? '#dc2626' : '#1f2937');
  }

  function getHandleFromLink(linkElement) {
    if (!linkElement || !linkElement.href) return '';
    const parts = linkElement.href.split('/');
    return parts[parts.length - 1].toLowerCase();
  }

  function parseTimestampToDays(text) {
    if (!text) return 0;
    text = text.trim().toLowerCase();

    if (text.includes('ieri') || text.includes('yesterday')) return 1.0;
    if (text.includes('oggi') || text.includes('today')) return 0.0;

    const match = text.match(/(\d+)\s+([a-z]+)/i);
    if (match) {
      const val = parseFloat(match[1]);
      const unit = match[2];

      if (unit.startsWith('second')) return val / 86400;
      if (unit.startsWith('minut')) return val / 1440;
      if (unit.startsWith('hour') || unit.startsWith('ore') || unit.startsWith('ora')) return val / 24;
      if (unit.startsWith('day') || unit.startsWith('giorn')) return val;
      if (unit.startsWith('week') || unit.startsWith('settiman')) return val * 7;
      if (unit.startsWith('month') || unit.startsWith('mes')) return val * 30;
      if (unit.startsWith('year') || unit.startsWith('ann')) return val * 365;
    }

    const d = new Date(text);
    if (!isNaN(d.getTime())) {
      return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    }

    return 0;
  }

  function isMatch(handle, list) {
    if (!handle) return false;
    return list.some((pattern) => {
      if (pattern.includes('*') || pattern.includes('?')) {
        const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp('^' + regexPattern + '$', 'i').test(handle);
      }
      return handle === pattern;
    });
  }

  function rot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
      return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
    });
  }

  function scrambleText(text) {
    const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?~';
    let scrambled = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char.match(/\s/)) {
        scrambled += char;
      } else {
        scrambled += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    return scrambled;
  }

  function resetFilters() {
    document.querySelectorAll('.entry').forEach((el) => { el.style.display = ''; });
    document.querySelectorAll('.comment-body[data-processed]').forEach((comment) => {
      const action = comment.dataset.processed;
      if (action === 'hide') {
        comment.style.display = '';
      } else {
        const authorLink = comment.querySelector('.commentLinks a.user');
        if (authorLink && authorLink.dataset.origText) {
          authorLink.textContent = authorLink.dataset.origText;
          delete authorLink.dataset.origText;
        }
        comment.querySelectorAll('.frenf-obfuscated-text').forEach((span) => {
          const textNode = document.createTextNode(span.dataset.origText);
          span.parentNode.replaceChild(textNode, span);
        });
      }
      delete comment.dataset.processed;
    });
  }

  function processComment(comment, action) {
    if (comment.dataset.processed) return;
    if (action === 'hide') {
      comment.style.display = 'none';
      comment.dataset.processed = 'hide';
      return;
    }
    const authorLink = comment.querySelector('.commentLinks a.user');
    if (authorLink) {
      authorLink.dataset.origText = authorLink.textContent;
      if (action === 'scramble') authorLink.textContent = scrambleText(authorLink.textContent);
      else if (action === 'rot13') authorLink.textContent = rot13(authorLink.textContent);
    }
    const walk = document.createTreeWalker(comment, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];
    let n;
    while ((n = walk.nextNode())) {
      if (n.parentNode.closest('.commentLinks')) continue;
      if (n.nodeValue.trim().length > 0) nodesToReplace.push(n);
    }
    nodesToReplace.forEach((node) => {
      const span = document.createElement('span');
      span.className = 'frenf-obfuscated-text';
      span.dataset.origText = node.nodeValue;
      if (action === 'scramble') span.textContent = scrambleText(node.nodeValue);
      else if (action === 'rot13') span.textContent = rot13(node.nodeValue);
      node.parentNode.replaceChild(span, node);
    });
    comment.dataset.processed = action;
  }

  function applyFilters() {
    if (!filterEnabled) return;
    if (!hasActiveFilters()) return;

    // 1. Filter main posts (.entry)
    document.querySelectorAll('.entry').forEach((entry) => {
      let shouldBlock = false;

      if (peperonataEnabled) {
        const timeLink = entry.querySelector('.postLinks a');
        if (timeLink) {
          const ageInDays = parseTimestampToDays(timeLink.textContent);
          if (ageInDays > peperonataDays) shouldBlock = true;
        }
      }

      if (!shouldBlock) {
        const authorLink = entry.querySelector('.entry-body.public strong.media-heading a.user') || entry.querySelector('.media-heading a.user');
        const authorHandle = getHandleFromLink(authorLink);
        const roomLinks = entry.querySelectorAll('.entry-body a.user:not(strong.media-heading a.user)');
        const roomHandles = Array.from(roomLinks).map(getHandleFromLink);
        const textElement = entry.querySelector('.entry-text');
        const postText = textElement ? textElement.innerText.toLowerCase() : '';

        if (isMatch(authorHandle, blockedUsers)) {
          shouldBlock = true;
        } else if (blockedRooms.length > 0 && roomHandles.some((room) => isMatch(room, blockedRooms))) {
          shouldBlock = true;
        } else if (blockedKeywords.length > 0) {
          for (const keyword of blockedKeywords) {
            if (postText.includes(keyword)) {
              shouldBlock = true;
              break;
            }
          }
        }
      }

      if (shouldBlock) entry.style.display = 'none';
    });

    // 2. Filter single comments
    document.querySelectorAll('.comment-body').forEach((comment) => {
      const authorLink = comment.querySelector('.commentLinks a.user');
      const authorHandle = getHandleFromLink(authorLink);
      if (isMatch(authorHandle, blockedUsers)) processComment(comment, commentAction);
    });
  }

  // Re-run everything after a setting changed.
  function refreshFilters() {
    updateIconState();
    resetFilters();
    if (filterEnabled) applyFilters();
  }

  function initFilters() {
    updateIconState();
    if (filterEnabled) applyFilters();

    const watch = (feed) => {
      new MutationObserver((mutations) => {
        if (filterEnabled && mutations.some((m) => m.addedNodes.length > 0)) applyFilters();
      }).observe(feed, { childList: true, subtree: true });
    };

    const feed = document.getElementById('feed');
    if (feed) {
      watch(feed);
      return;
    }
    // The script now starts earlier than before, so the feed may not be in the page yet: wait for it.
    const waiter = new MutationObserver(() => {
      const late = document.getElementById('feed');
      if (!late) return;
      waiter.disconnect();
      if (filterEnabled) applyFilters();
      watch(late);
    });
    waiter.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* =====================================================================
     BACKGROUND PICKER
     ===================================================================== */

  /* ---------- color math ---------- */

  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const toHex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t); // t = 0 gives a, t = 1 gives b
  const average = (list) => [0, 1, 2].map((i) => list.reduce((sum, c) => sum + c[i], 0) / list.length);

  // Parses computed "rgb()/rgba()" strings into [r, g, b, a].
  function parseColor(str) {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(str);
    if (!m) return null;
    let alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[5]) alpha /= 100;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), alpha];
  }
  const alphaOf = (c) => (c.length > 3 ? c[3] : 1);
  const cssColor = (c) => (alphaOf(c) < 0.995
    ? 'rgba(' + c.slice(0, 3).map(Math.round).join(',') + ',' + alphaOf(c) + ')'
    : toHex(c));
  const blend = (c, under) => [0, 1, 2].map((i) => under[i] + (c[i] - under[i]) * alphaOf(c));

  const saturation = (c) => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255;
  const luma = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const sameColor = (a, b) => dist(a, b) <= 1 && Math.abs(alphaOf(a) - alphaOf(b)) < 0.02;

  // WCAG relative luminance and contrast ratio.
  function luminance(rgb) {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const worst = (color, surfaces) => Math.min(...surfaces.map((s) => contrast(color, s)));

  // Move `base` toward `target` only as far as needed to reach `min` contrast on every surface.
  function reach(base, target, surfaces, min) {
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const c = mix(base, target, t);
      if (worst(c, surfaces) >= min) return c;
    }
    return target;
  }

  // Fade `fg` toward `bg` (up to `amount`) while keeping at least `min` contrast.
  function fade(fg, bg, surfaces, amount, min) {
    for (let t = amount; t > 0; t -= 0.04) {
      const c = mix(fg, bg, t);
      if (worst(c, surfaces) >= min) return c;
    }
    return fg;
  }

  /* ---------- theme ---------- */

  const MIN_CONTRAST = 4.6; // a little above the WCAG AA minimum (4.5), to absorb rounding

  // Lighter/darker variants of the background for raised surfaces. They shade toward the
  // text color (lighter on dark, darker on light) unless that would cost too much contrast.
  function shades(bg, fg) {
    const opposite = fg === WHITE ? BLACK : WHITE;
    const toward = [bg, mix(bg, fg, 0.06), mix(bg, fg, 0.12)];
    if (worst(fg, toward) >= 7) return { list: toward, target: fg };
    const away = [bg, mix(bg, opposite, 0.06), mix(bg, opposite, 0.12)];
    return worst(fg, away) > worst(fg, toward) ? { list: away, target: opposite } : { list: toward, target: fg };
  }

  function buildTheme(hex) {
    const bg = hexToRgb(hex);
    const light = shades(bg, WHITE);
    const dark = shades(bg, BLACK);
    // Text is black or white, whichever reads better on the chosen color and its shades.
    const fg = worst(WHITE, light.list) >= worst(BLACK, dark.list) ? WHITE : BLACK;
    const s = fg === WHITE ? light : dark;
    const muted = fade(fg, bg, [bg, s.list[1]], 0.4, MIN_CONTRAST);
    return { fg, bg1: bg, target: s.target, muted };
  }

  /* ---------- page engine ----------
     The site's colors are not exposed as variables, so the engine reads each element's
     computed colors and writes inline overrides where needed:
       - neutral backgrounds (white, grays, near-black) become shades of the chosen color;
       - colored backgrounds (buttons, labels, alerts) keep their color;
       - text on a recolored background becomes black/white (or a faded or adjusted
         variant for muted text and colored links) with at least 4.5:1 contrast;
       - neutral borders follow the new background.
     Hover, focus and class changes are re-evaluated so state colors stay readable.
     Our own panel and gear carry UI_ATTR and are never touched. */

  const SKIP = new Set(['HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BASE',
    'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'MAP', 'AREA']);
  const FORM = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const SIDES = [['Top', 'top'], ['Right', 'right'], ['Bottom', 'bottom'], ['Left', 'left']];
  const INTERACTIVE = 'a,button,input,select,textarea,label,li,tr,[role="button"]';

  let theme = null;                 // set while a color is chosen
  let page0 = [255, 255, 255];      // the page's original background color
  let info = new WeakMap();         // element -> { origBg, bg, changed, color }
  const saved = new WeakMap();      // element -> Map(property -> [inline value, priority])
  const touched = new Set();        // elements carrying our inline overrides
  let early = null;                 // temporary style that hides the page until it is recolored

  const skip = (el) => SKIP.has(el.tagName) || el.namespaceURI !== XHTML || el.hasAttribute(UI_ATTR);

  function setImportant(el, prop, value) {
    let props = saved.get(el);
    if (!props) {
      props = new Map();
      saved.set(el, props);
      touched.add(el);
    }
    if (!props.has(prop)) props.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  }

  // Undo our overrides inside `scope` (an element), or everywhere when scope is null.
  function release(scope) {
    touched.forEach((el) => {
      if (scope && el !== scope && !scope.contains(el)) return;
      const props = saved.get(el);
      if (props && el.isConnected) {
        props.forEach((prev, prop) => {
          if (prev[0]) el.style.setProperty(prop, prev[0], prev[1]);
          else el.style.removeProperty(prop);
        });
        if (!el.getAttribute('style')) el.removeAttribute('style'); // leave no empty style="" behind
      }
      saved.delete(el);
      touched.delete(el);
    });
  }

  // Finish running CSS transitions so computed styles report final values, not mid-fade ones.
  function settle(scope) {
    try {
      const list = scope === html ? document.getAnimations() : scope.getAnimations({ subtree: true });
      list.forEach((a) => { if (a instanceof CSSTransition) a.finish(); });
    } catch (e) { /* not supported: skip */ }
  }

  function pageColor() {
    const body = parseColor(getComputedStyle(document.body).backgroundColor);
    const root = parseColor(getComputedStyle(html).backgroundColor);
    if (body && body[3] >= 0.95) return body.slice(0, 3);
    if (root && root[3] >= 0.95) return root.slice(0, 3);
    return [255, 255, 255];
  }

  // Shade of the chosen color for a neutral original background `c`.
  function mapSurface(c, el, t) {
    let bg = t.bg1;
    const m = Math.abs(luma(c) - luma(page0));
    if (dist(c, page0) > 4 && m >= 0.02) bg = mix(t.bg1, t.target, Math.min(0.05 + m * 0.35, 0.2));
    if (bg === t.bg1 && FORM.has(el.tagName)) bg = mix(t.bg1, t.target, 0.06); // keep fields visible
    return bg;
  }

  // Black or white, whichever reads better on `bg`. This is the theme's text color on
  // ordinary surfaces, but can differ on odd ones (for example a translucent dark bar).
  function fgOn(bg, t) {
    const other = t.fg === WHITE ? BLACK : WHITE;
    return contrast(t.fg, bg) >= contrast(other, bg) ? t.fg : other;
  }

  // New text color for original color `tc` on a recolored background (`fg` = text color for it).
  function mapText(tc, origBg, bg, fg) {
    const rgb = tc.slice(0, 3);
    if (saturation(rgb) <= 0.12) {
      const r = contrast(rgb, origBg);
      if (r >= 7) return fg;                                    // strong text
      const amount = r >= 4.5 ? 0.22 : r >= 3 ? 0.36 : 0.5;    // muted text stays muted
      return fade(fg, bg, [bg], amount, MIN_CONTRAST);
    }
    return reach(rgb, fg, [bg], MIN_CONTRAST);                   // keep the hue of colored text
  }

  function analyze(el, parent, t) {
    const cs = getComputedStyle(el);
    const plan = [];
    let origBg = parent.origBg;
    let bg = parent.bg;
    let changed = parent.changed;
    const isRoot = el === html || el === document.body;

    const own = parseColor(cs.backgroundColor);
    const image = cs.backgroundImage;
    const gradient = image.indexOf('gradient(') !== -1;
    const picture = image !== 'none' && !gradient;
    const faded = parseFloat(cs.opacity) < 0.95;

    // The opaque color of this element's own background layer, if it has one.
    let layer = null;
    if (gradient) {
      const stops = (image.match(/rgba?\([^)]*\)/g) || []).map(parseColor);
      if (stops.length && stops.every((s) => s && s[3] >= 0.95)) layer = average(stops);
    }
    if (!layer && own && own[3] >= 0.95) layer = own.slice(0, 3);

    if (isRoot) {
      bg = t.bg1;
      changed = true;
      plan.push(['background-color', toHex(bg)], ['background-image', 'none']);
    } else if (layer) {
      origBg = layer;
      if (!faded && (dist(layer, page0) <= 4 || saturation(layer) <= 0.06)) {
        bg = mapSurface(layer, el, t);
        changed = true;
        plan.push(['background-color', toHex(bg)]);
        if (gradient) plan.push(['background-image', 'none']);
      } else {
        bg = layer;
        changed = false;
      }
    } else if (own && own[3] > 0) {
      origBg = blend(own, parent.origBg);
      if (!faded && own[3] >= 0.6 && luma(own) > 0.85 && saturation(own) <= 0.06) {
        // A light veil (for example a loading overlay) becomes a veil in the new background color.
        bg = blend([t.bg1[0], t.bg1[1], t.bg1[2], own[3]], parent.bg);
        changed = true;
        plan.push(['background-color', 'rgba(' + t.bg1.map(Math.round).join(',') + ',' + own[3] + ')']);
      } else {
        bg = blend(own, parent.bg);
      }
    } else if (picture) {
      changed = false; // text over an image: leave its colors alone
    }

    if (isRoot && el === html) plan.push(['color-scheme', t.fg === WHITE ? 'dark' : 'light']);

    // Text color.
    const tc = parseColor(cs.color);
    const fg = isRoot ? t.fg : fgOn(bg, t);
    let want = tc;
    if (isRoot) want = fg;
    else if (tc && tc[3] >= 0.95 && changed) want = mapText(tc, origBg, bg, fg);
    let color = parent.color;
    if (want) {
      color = want;
      if (!tc || !sameColor(want, tc) || !sameColor(want, parent.color)) plan.push(['color', cssColor(want)]);
    }

    // A colored link that had to become plain text color keeps an underline, so it stays recognizable.
    if (el.tagName === 'A' && changed && want && tc && saturation(tc) > 0.12 && sameColor(want, fg) &&
        cs.textDecorationLine.indexOf('underline') === -1) {
      plan.push(['text-decoration-line', 'underline']);
    }

    // Neutral borders follow the new background.
    if (changed) {
      SIDES.forEach(([cap, side]) => {
        if (!(parseFloat(cs['border' + cap + 'Width']) > 0)) return;
        const c = parseColor(cs['border' + cap + 'Color']);
        if (!c || c[3] === 0 || saturation(c) > 0.12) return;
        const value = c[3] >= 0.95
          ? toHex(mix(bg, fg, 0.22))
          : 'rgba(' + fg.join(',') + ',' + c[3] + ')';
        plan.push(['border-' + side + '-color', value]);
      });
    }

    return { info: { origBg, bg, changed, color }, plan };
  }

  function nearestInfo(el) {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const i = info.get(p);
      if (i) return i;
    }
    return { origBg: page0, bg: theme.bg1, changed: true, color: theme.fg };
  }

  // Analyze the subtree of `rootEl` (reads only), then write the overrides.
  function run(rootEl) {
    const t = theme;
    const jobs = [];
    const visit = (el) => {
      const result = analyze(el, nearestInfo(el), t);
      info.set(el, result.info);
      jobs.push([el, result.plan]);
    };
    visit(rootEl);
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_ELEMENT, (n) => (
      skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    ));
    while (walker.nextNode()) visit(walker.currentNode);
    jobs.forEach(([el, plan]) => plan.forEach(([prop, value]) => setImportant(el, prop, value)));
    settle(rootEl);
  }

  function paint(el) {
    if (skip(el)) return;
    release(el);
    settle(el);
    run(el);
  }

  function paintAll() {
    hideEarly();
    release(null);
    info = new WeakMap();
    if (!theme || !document.body) return;
    settle(html);
    page0 = pageColor();
    run(html);
    updatePlaceholder();
  }

  // Repaint in the next frame, coalescing bursts of events and mutations.
  const pending = new Set();
  let queued = false;
  let everything = false;

  function schedule(el) {
    if (!theme) return;
    if (el) {
      if (!el.isConnected || el === html || el === document.body) everything = true;
      else if (el.closest('[' + UI_ATTR + ']')) return;
      else pending.add(el);
    } else {
      everything = true;
    }
    if (!queued) {
      queued = true;
      requestAnimationFrame(flush);
    }
  }

  function flush() {
    queued = false;
    const list = Array.from(pending).filter((el) => el.isConnected);
    pending.clear();
    if (!theme) { everything = false; return; }
    if (everything) {
      everything = false;
      paintAll();
      return;
    }
    list.filter((el) => !list.some((other) => other !== el && other.contains(el))).forEach(paint);
  }

  // Hide the page (on the chosen color) until it has been recolored, to avoid a flash.
  function showEarly() {
    try {
      early = document.createElement('style');
      early.textContent = 'html{visibility:hidden!important;background:' + toHex(theme.bg1) + '!important}';
      html.appendChild(early);
      setTimeout(hideEarly, 3000);
    } catch (e) { early = null; }
  }
  function hideEarly() {
    if (early) {
      early.remove();
      early = null;
    }
  }

  // Placeholder text can only be styled from a stylesheet (silently skipped if the page's policy blocks it).
  let placeholderStyle = null;
  function updatePlaceholder() {
    try {
      if (!theme) {
        if (placeholderStyle) placeholderStyle.remove();
        placeholderStyle = null;
        return;
      }
      if (!placeholderStyle) {
        placeholderStyle = document.createElement('style');
        placeholderStyle.setAttribute(UI_ATTR, '');
        html.appendChild(placeholderStyle);
      }
      placeholderStyle.textContent = '::placeholder{color:' + toHex(theme.muted) + '!important;opacity:1!important}';
    } catch (e) { /* ignore */ }
  }

  function setColor(hex) {
    theme = buildTheme(hex);
    syncUiTheme();
    schedule(null);
  }

  function clearColor() {
    theme = null;
    hideEarly();
    release(null);
    info = new WeakMap();
    updatePlaceholder();
    syncUiTheme();
  }

  function initEngine() {
    new MutationObserver((records) => {
      if (!theme) return;
      records.forEach((r) => {
        if (r.type === 'attributes') schedule(r.target);
        else r.addedNodes.forEach((n) => { if (n.nodeType === 1) schedule(n); });
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    // Hover, focus and pressed states come from the site's own CSS; re-evaluate them.
    ['mouseover', 'mouseout', 'mousedown', 'mouseup', 'focusin', 'focusout'].forEach((type) => {
      document.addEventListener(type, (e) => {
        if (!theme || !e.target.closest) return;
        const el = e.target.closest(INTERACTIVE);
        if (el) schedule(el);
      }, true);
    });
  }

  /* =====================================================================
     COMMON INTERFACE: one gear, one panel with tabs, shared move/scale logic
     ===================================================================== */

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const ui = { panel: null, header: null, body: null, tabButtons: [] };

  function syncUiTheme() {
    const panel = ui.panel;
    if (!panel) return;
    const bg = theme ? theme.bg1 : [255, 255, 255];
    const fg = theme ? theme.fg : [31, 41, 55];
    const border = mix(bg, fg, 0.25);
    panel.style.background = toHex(bg);
    panel.style.borderColor = toHex(border);
    panel.style.color = toHex(fg);
    if (ui.header) ui.header.style.borderBottomColor = toHex(mix(bg, fg, 0.28));
    if (ui.body) ui.body.style.background = toHex(bg);
    ui.tabButtons.forEach((tab) => {
      const on = tab.getAttribute('aria-selected') === 'true';
      const tabBg = on ? toHex(fg) : toHex(mix(bg, fg, 0.12));
      const tabText = on ? toHex(bg) : toHex(fg);
      const tabBorder = toHex(mix(bg, fg, on ? 0.18 : 0.35));
      tab.style.background = tabBg;
      tab.style.color = tabText;
      tab.style.borderColor = tabBorder;
    });
  }

  // Inline styles are set through the CSSOM, which content security policies allow.
  function make(tag, style, attrs, children) {
    const node = document.createElement(tag);
    Object.assign(node.style, { boxSizing: 'border-box' }, style);
    Object.keys(attrs || {}).forEach((key) => node.setAttribute(key, attrs[key]));
    (children || []).forEach((child) => node.append(child));
    return node;
  }

  function focusRing(node) {
    node.addEventListener('focus', () => {
      if (node.matches(':focus-visible')) {
        node.style.outline = '2px solid #2563eb';
        node.style.outlineOffset = '2px';
      }
    });
    node.addEventListener('blur', () => { node.style.outline = 'none'; });
  }

  function gearIcon() {
    const teeth = 8;
    const outer = 10.6;
    const inner = 7.8;
    const hole = 3.4;
    const step = (Math.PI * 2) / teeth;
    const points = [];
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      [[inner, a - step * 0.27], [outer, a - step * 0.15], [outer, a + step * 0.15], [inner, a + step * 0.27]]
        .forEach(([radius, angle]) => {
          points.push((12 + radius * Math.cos(angle)).toFixed(2) + ' ' + (12 + radius * Math.sin(angle)).toFixed(2));
        });
    }
    const d = 'M' + points.join('L') + 'Z' +
      'M' + (12 + hole) + ' 12a' + hole + ' ' + hole + ' 0 1 0 ' + (-2 * hole) + ' 0' +
      'a' + hole + ' ' + hole + ' 0 1 0 ' + (2 * hole) + ' 0Z';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '30');
    svg.setAttribute('height', '30');
    svg.style.display = 'block';
    svg.style.pointerEvents = 'none';
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#1f2937');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '1.1');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    gearPath = path;
    return svg;
  }

  function initUI() {
    if (document.getElementById('frenfTk-gear')) return;

    const GEAR = 36;
    const NO_DRAG = 'button, input, textarea, select, label, option, a';
    const vw = () => document.documentElement.clientWidth;
    const vh = () => document.documentElement.clientHeight;
    const stopEnter = (e) => { if (e.key === 'Enter') e.stopPropagation(); };
    const displayUser = (u) => ((u.includes('*') || u.includes('?')) ? u : '@' + u);
    const lines = (text, clean) => text.split(/\r?\n/).map((s) => clean(s.trim()).toLowerCase()).filter((s) => s.length > 0);

    /* ---- small form helpers ---- */

    const FIELD = {
      display: 'block', width: '100%', margin: '0 0 8px', padding: '4px 6px',
      border: '1px solid #cbd5e1', borderRadius: '4px', background: '#ffffff', color: '#1f2937',
      font: '13px/1.4 ' + FONT, cursor: 'text',
    };

    const caption = (text) => make('div', {
      margin: '0 0 3px', color: '#374151', font: '12px/1.4 ' + FONT, cursor: 'default',
    }, null, [text]);

    function button(text, background, onClick, extra) {
      const b = make('button', Object.assign({
        margin: '0', padding: '6px 8px', border: '0', borderRadius: '4px', background, color: '#ffffff',
        font: '600 12px/1.2 ' + FONT, cursor: 'pointer',
      }, extra), { type: 'button' }, [text]);
      b.addEventListener('click', onClick);
      focusRing(b);
      return b;
    }

    function checkbox(text, checked) {
      const input = make('input', { margin: '0 8px 0 0', cursor: 'pointer' }, { type: 'checkbox' });
      input.checked = checked;
      const row = make('label', {
        display: 'flex', alignItems: 'center', margin: '0 0 8px', fontWeight: '600', cursor: 'pointer',
      }, null, [input, text]);
      return { row, input };
    }

    function area(value) {
      const box = make('textarea', Object.assign({}, FIELD, { resize: 'vertical', minHeight: '40px' }), { rows: '2' });
      box.value = value;
      box.addEventListener('keydown', stopEnter);
      return box;
    }

    /* ---- Filters tab ---- */

    const enableAll = checkbox('Enable All Filters', filterEnabled);
    const usersInput = area(blockedUsers.map(displayUser).join('\n'));
    const roomsInput = area(blockedRooms.join('\n'));
    const keywordsInput = area(blockedKeywords.join('\n'));

    const actionSelect = make('select', Object.assign({}, FIELD, { height: '28px', cursor: 'pointer' }), null, [
      ['scramble', 'Scramble'], ['rot13', 'ROT13'], ['hide', 'Hide completely'],
    ].map(([value, text]) => make('option', {}, { value }, [text])));
    actionSelect.value = commentAction;

    const pepe = checkbox('Peperonata Filter', peperonataEnabled);
    const daysInput = make('input', Object.assign({}, FIELD, { margin: '0' }), { type: 'number', step: '0.1' });
    daysInput.value = String(peperonataDays);

    enableAll.input.addEventListener('change', (e) => {
      filterEnabled = e.target.checked;
      saveJSON(KEY.filterEnabled, filterEnabled);
      refreshFilters();
    });
    pepe.input.addEventListener('change', (e) => {
      peperonataEnabled = e.target.checked;
      saveJSON(KEY.peperonataEnabled, peperonataEnabled);
      refreshFilters();
    });
    daysInput.addEventListener('change', (e) => {
      peperonataDays = parseFloat(e.target.value) || 0;
      store.set(KEY.peperonataDays, peperonataDays);
      if (peperonataEnabled) refreshFilters();
    });

    function saveFilters() {
      filterEnabled = enableAll.input.checked;
      peperonataEnabled = pepe.input.checked;
      peperonataDays = parseFloat(daysInput.value) || 0;
      commentAction = actionSelect.value;
      blockedUsers = lines(usersInput.value, (s) => s.replace(/^@/, ''));
      blockedRooms = lines(roomsInput.value, (s) => s.replace(/^[@/]/, ''));
      blockedKeywords = lines(keywordsInput.value, (s) => s);

      saveJSON(KEY.filterEnabled, filterEnabled);
      saveJSON(KEY.peperonataEnabled, peperonataEnabled);
      store.set(KEY.peperonataDays, peperonataDays);
      saveJSON(KEY.users, blockedUsers);
      saveJSON(KEY.rooms, blockedRooms);
      saveJSON(KEY.keywords, blockedKeywords);
      store.set(KEY.commentAction, commentAction);

      setOpen(false);
      refreshFilters();
    }

    function exportSettings() {
      const stored = store.get(KEY.bgColor);
      const data = {
        version: 2,
        filterEnabled, peperonataEnabled, peperonataDays,
        blockedUsers, blockedRooms, blockedKeywords, commentAction,
        backgroundColor: HEX.test(stored || '') ? stored : null,
        iconPos, configPos, configScale,
      };
      const a = document.createElement('a');
      a.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2)));
      a.setAttribute('download', 'frenfit_settings.json');
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    function importSettings() {
      const input = make('input', {}, { type: 'file', accept: 'application/json' });
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imp = JSON.parse(event.target.result);
            if (!imp || typeof imp !== 'object') throw new Error('not a settings object');
            if (Array.isArray(imp.blockedUsers)) usersInput.value = asList(imp.blockedUsers).map(displayUser).join('\n');
            if (Array.isArray(imp.blockedRooms)) roomsInput.value = asList(imp.blockedRooms).join('\n');
            if (Array.isArray(imp.blockedKeywords)) keywordsInput.value = asList(imp.blockedKeywords).join('\n');
            if (ACTIONS.indexOf(imp.commentAction) !== -1) actionSelect.value = imp.commentAction;
            if (typeof imp.filterEnabled === 'boolean') enableAll.input.checked = imp.filterEnabled;
            if (typeof imp.peperonataEnabled === 'boolean') pepe.input.checked = imp.peperonataEnabled;
            if (imp.peperonataDays !== undefined) daysInput.value = imp.peperonataDays;
            if (imp.configScale) setScale(parseFloat(imp.configScale) || 1);
            // Window positions are not imported: they depend on the screen they were saved on.
            if ('backgroundColor' in imp) applyBackground(imp.backgroundColor);
            alert("Settings imported successfully! Click 'Save & Apply' to confirm your filter changes.");
          } catch (err) {
            alert('Error: Invalid settings file.');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    const filtersPane = make('div', { display: 'flex', flexDirection: 'column' }, null, [
      enableAll.row,
      caption('Blocked Users (* and ? wildcards supported)'), usersInput,
      caption('Blocked Rooms (* and ? wildcards supported)'), roomsInput,
      caption('Blocked Keywords in Posts (NO wildcards)'), keywordsInput,
      caption('Action on Blocked Comments'), actionSelect,
      make('div', { borderTop: '1px solid #e5e7eb', margin: '4px 0 10px', paddingTop: '10px' }, null, [
        pepe.row, caption('Hide posts older than (days):'), daysInput,
      ]),
      make('div', { display: 'flex', gap: '6px' }, null, [
        button('Save & Apply', '#5cb85c', saveFilters, { flex: '1.7 1 0' }),
        button('Export', '#0275d8', exportSettings, { flex: '1 1 0' }),
        button('Import', '#f0ad4e', importSettings, { flex: '1 1 0' }),
      ]),
    ]);

    /* ---- Background tab (only where the picker is enabled) ---- */

    function buildBackgroundPane() {
      const swatches = PALETTE.map((hex) => {
        const swatch = make('button', {
          width: '24px', height: '24px', padding: '0', margin: '0',
          borderRadius: '6px', border: '1px solid rgba(0,0,0,.3)', background: hex, cursor: 'pointer',
        }, { type: 'button', title: hex, 'aria-label': 'Use ' + hex });
        swatch.dataset.hex = hex;
        swatch.addEventListener('click', () => choose(hex));
        focusRing(swatch);
        return swatch;
      });

      const custom = make('input', {
        width: '34px', height: '26px', padding: '0', margin: '0',
        border: '1px solid #9ca3af', borderRadius: '6px', background: 'none', cursor: 'pointer',
      }, { type: 'color', value: '#0b1d3a', title: 'Custom color', 'aria-label': 'Custom background color' });
      custom.addEventListener('input', () => choose(custom.value));
      focusRing(custom);

      const resetButton = button('Use site default', '#ffffff', () => reset(), {
        margin: '0 0 0 auto', padding: '4px 10px', border: '1px solid #9ca3af', color: '#111827', fontWeight: '400',
      });

      const pane = make('div', { display: 'none', flexDirection: 'column' }, null, [
        make('div', { display: 'grid', gridTemplateColumns: 'repeat(8, 24px)', gap: '6px' }, null, swatches),
        make('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }, null, [
          custom, make('span', { cursor: 'default' }, null, ['Custom']), resetButton,
        ]),
        make('div', { marginTop: '8px', color: '#4b5563', fontSize: '12px', cursor: 'default' }, null, [
          'Text color adjusts automatically for contrast.',
        ]),
      ]);

      function refresh() {
        swatches.forEach((swatch) => {
          const on = current === swatch.dataset.hex;
          swatch.style.boxShadow = on ? '0 0 0 2px #ffffff, 0 0 0 4px #2563eb' : 'none';
          swatch.setAttribute('aria-pressed', String(on));
        });
        if (current) custom.value = current;
      }

      function choose(hex) {
        current = hex.toLowerCase();
        store.set(KEY.bgColor, current);
        setColor(current);
        refresh();
      }

      function reset() {
        current = null;
        store.remove(KEY.bgColor);
        clearColor();
        refresh();
      }

      refresh();
      return { pane, choose, reset };
    }

    const bgApi = BG_ON ? buildBackgroundPane() : null;

    // Used by Import: applies a color now where the picker runs, otherwise just stores it.
    function applyBackground(color) {
      const ok = typeof color === 'string' && HEX.test(color);
      if (bgApi) {
        if (ok) bgApi.choose(color);
        else if (color === null) bgApi.reset();
      } else if (ok) {
        store.set(KEY.bgColor, color.toLowerCase());
      } else if (color === null) {
        store.remove(KEY.bgColor);
      }
    }

    /* ---- panel shell: tabs + size buttons on top, scrollable content below ---- */

    const TABS = [['filters', 'Filters', filtersPane]];
    if (bgApi) TABS.push(['bg', 'Background', bgApi.pane]);

    let activeTab = store.get(KEY.tab);
    if (!TABS.some((t) => t[0] === activeTab)) activeTab = 'filters';
    let open = false;

    const tabButtons = TABS.map(([id, text]) => {
      const tab = make('button', {
        margin: '0', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
        font: '600 12px/1.2 ' + FONT, cursor: 'pointer',
      }, { type: 'button', role: 'tab' }, [text]);
      tab.addEventListener('click', () => selectTab(id));
      focusRing(tab);
      return tab;
    });
    ui.tabButtons = tabButtons;

    function selectTab(id) {
      activeTab = id;
      store.set(KEY.tab, id);
      TABS.forEach(([tabId, , pane], i) => {
        const on = tabId === id;
        pane.style.display = on ? 'flex' : 'none';
        tabButtons[i].setAttribute('aria-selected', String(on));
        Object.assign(tabButtons[i].style, on
          ? { background: '#2563eb', color: '#ffffff', borderColor: '#2563eb' }
          : { background: '#f3f4f6', color: '#1f2937', borderColor: '#d1d5db' });
      });
      body.scrollTop = 0;
      if (open) clamp(panel, 8);
      syncUiTheme();
    }

    const sizeButton = (text, title, onClick) => {
      const b = make('button', {
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px',
        margin: '0', padding: '0', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#eeeeee',
        color: '#333333', font: '700 16px/1 ' + FONT, cursor: 'pointer',
      }, { type: 'button', title, 'aria-label': title }, [text]);
      b.addEventListener('click', onClick);
      focusRing(b);
      return b;
    };

    const header = make('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      flex: '0 0 auto', margin: '0 0 10px', paddingBottom: '8px', borderBottom: '1px solid #e5e7eb',
    }, null, [
      make('div', { display: 'flex', gap: '4px' }, { role: 'tablist' }, tabButtons),
      make('div', { display: 'flex', gap: '5px' }, null, [
        sizeButton('-', 'Smaller window', () => setScale(configScale - 0.1)),
        sizeButton('+', 'Larger window', () => setScale(configScale + 0.1)),
      ]),
    ]);
    ui.header = header;

    const body = make('div', { flex: '1 1 auto', minHeight: '0', overflowY: 'auto', overflowX: 'hidden', padding: '4px' },
      null, TABS.map((t) => t[2]));
    ui.body = body;

    const panel = make('div', {
      position: 'fixed', zIndex: '2147483647', display: 'none', flexDirection: 'column',
      width: '300px', padding: '12px', background: '#ffffff', color: '#1f2937',
      border: '1px solid #d1d5db', borderRadius: '8px', boxShadow: '0 4px 14px rgba(0,0,0,.25)',
      font: '13px/1.4 ' + FONT, textAlign: 'left', colorScheme: 'light', cursor: 'move',
      transform: 'scale(' + configScale + ')', transformOrigin: 'top right',
    }, { id: 'frenfTk-panel', role: 'dialog', 'aria-label': 'frenf:it toolkit', [UI_ATTR]: '' }, [header, body]);
    ui.panel = panel;
    Object.assign(panel.style, configPos);

    /* ---- gear ---- */

    const gear = make('button', {
      position: 'fixed', zIndex: '2147483646', display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: GEAR + 'px', height: GEAR + 'px', margin: '0', padding: '0', border: '0', background: 'transparent',
      cursor: 'move', touchAction: 'none', userSelect: 'none', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.5))',
    }, {
      id: 'frenfTk-gear', type: 'button', 'aria-label': 'frenf:it toolkit', 'aria-haspopup': 'dialog',
      'aria-expanded': 'false', [UI_ATTR]: '',
      title: 'frenf:it toolkit - click: open, double-click: toggle filters, drag: move',
    }, [gearIcon()]);
    Object.assign(gear.style, iconPos);
    gearEl = gear;
    focusRing(gear);
    gear.addEventListener('mouseenter', () => { gear.style.opacity = '1'; });
    gear.addEventListener('mouseleave', updateIconState);

    /* ---- sizing, bounds, moving ---- */

    // Keep the panel within the viewport at any scale; its content scrolls instead.
    function fitPanel() {
      panel.style.maxHeight = Math.max(160, Math.floor((vh() - 16) / configScale)) + 'px';
    }

    function setScale(value) {
      configScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 10) / 10));
      panel.style.transform = 'scale(' + configScale + ')';
      store.set(KEY.configScale, configScale);
      fitPanel();
      if (open) clamp(panel, 8);
    }

    const readPos = (node) => ({
      top: node.style.top || 'auto', left: node.style.left || 'auto',
      bottom: node.style.bottom || 'auto', right: node.style.right || 'auto',
    });

    // Shift a fixed element by (dx, dy), whichever edges it is anchored to.
    function nudge(node, dx, dy) {
      const s = node.style;
      if (dx) {
        if (s.left && s.left !== 'auto') s.left = (parseFloat(s.left) + dx) + 'px';
        else s.right = ((parseFloat(s.right) || 0) - dx) + 'px';
      }
      if (dy) {
        if (s.top && s.top !== 'auto') s.top = (parseFloat(s.top) + dy) + 'px';
        else s.bottom = ((parseFloat(s.bottom) || 0) - dy) + 'px';
      }
    }

    // Pull an element back into view (measured as it is drawn, so scale is accounted for).
    function clamp(node, margin) {
      const r = node.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const W = vw();
      const H = vh();
      let dx = 0;
      let dy = 0;
      if (r.width + 2 * margin >= W || r.left < margin) dx = margin - r.left;
      else if (r.right > W - margin) dx = W - margin - r.right;
      if (r.height + 2 * margin >= H || r.top < margin) dy = margin - r.top;
      else if (r.bottom > H - margin) dy = H - margin - r.bottom;
      if (dx || dy) nudge(node, dx, dy);
    }

    // Mouse and touch dragging. `ignore` lists elements that keep their normal behaviour.
    function makeDraggable(node, ignore, margin, commit) {
      let dragging = false;
      let sx = 0;
      let sy = 0;
      let ox = 0;
      let oy = 0;

      function start(x, y) {
        dragging = false;
        sx = x;
        sy = y;
        ox = node.offsetLeft; // layout position, unaffected by the CSS scale
        oy = node.offsetTop;
      }
      function move(x, y, prevent) {
        const dx = x - sx;
        const dy = y - sy;
        if (!dragging) {
          if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
          dragging = true;
          node.style.bottom = 'auto'; // unlock from the bottom/right anchoring
          node.style.right = 'auto';
        }
        if (prevent) prevent();
        node.style.left = (ox + dx) + 'px';
        node.style.top = (oy + dy) + 'px';
      }
      function finish() {
        if (!dragging) return;
        clamp(node, margin);
        commit(readPos(node));
      }

      node.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || (ignore && e.target.closest(ignore))) return;
        e.preventDefault(); // no text selection while dragging
        start(e.clientX, e.clientY);
        const onMove = (ev) => move(ev.clientX, ev.clientY);
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          finish();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      node.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1 || (ignore && e.target.closest(ignore))) return;
        start(e.touches[0].clientX, e.touches[0].clientY);
        const onMove = (ev) => move(ev.touches[0].clientX, ev.touches[0].clientY, () => ev.preventDefault());
        const onEnd = () => {
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
          document.removeEventListener('touchcancel', onEnd);
          finish();
        };
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
      }, { passive: true });

      return () => dragging;
    }

    const gearWasDragged = makeDraggable(gear, null, 2, (pos) => {
      iconPos = pos;
      saveJSON(KEY.iconPos, pos);
    });
    makeDraggable(panel, NO_DRAG, 8, (pos) => {
      configPos = pos;
      saveJSON(KEY.configPos, pos);
    });

    /* ---- open / close ---- */

    function setOpen(value) {
      open = value;
      panel.style.display = open ? 'flex' : 'none';
      gear.setAttribute('aria-expanded', String(open));
      if (open) {
        fitPanel();
        clamp(panel, 8);
      }
    }

    function toggleFilters() {
      filterEnabled = !filterEnabled;
      enableAll.input.checked = filterEnabled;
      saveJSON(KEY.filterEnabled, filterEnabled);
      refreshFilters();
    }

    let clickTimer;
    gear.addEventListener('click', (e) => {
      if (e.detail === 0) { setOpen(!open); return; } // keyboard (Enter/Space)
      if (gearWasDragged()) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => setOpen(!open), 250); // wait to see whether it is a double click
    });
    gear.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      if (!gearWasDragged()) toggleFilters();
    });

    document.addEventListener('keydown', (e) => {
      if (open && e.key === 'Escape') {
        setOpen(false);
        gear.focus();
      }
    });
    window.addEventListener('resize', () => {
      clamp(gear, 2);
      if (open) {
        fitPanel();
        clamp(panel, 8);
      }
    });

    document.body.append(gear, panel);
    selectTab(activeTab);
    fitPanel();
    updateIconState();
    syncUiTheme();
    setTimeout(() => clamp(gear, 2), 100);
  }

  /* ---------- start ---------- */

  // Apply the saved color as early as possible: hide the page until it has been recolored.
  if (current) {
    theme = buildTheme(current);
    whenRoot(showEarly);
  }

  function ready() {
    html = document.documentElement;
    if (BG_ON) initEngine();
    initUI();
    initFilters();
    if (theme) paintAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();

  // Stylesheets and images that arrive late can change colors: look again once everything has loaded.
  window.addEventListener('load', () => { if (theme) schedule(null); });
})();
