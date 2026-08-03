/* ==============================================================
   PDF Reader Engine v1.1 — Secure Embedded Document Viewer
   JS  — host this file on GitHub and serve via jsDelivr CDN:
   https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@VERSION/pdfre.js

   Companion stylesheet (load first):
     https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@VERSION/pdfre.css

   pdf.js is fetched automatically from jsDelivr on first use unless
   window.pdfjsLib is already present.

   Public API
   ----------
   Sources: PDF, self-contained HTML notes, or a JSON contents file
   listing several HTML notes files to merge.

   window.initPdfReader(containerId, options)  → reader instance
   window.PDFRE.encodeSrc(url [, key])         → obfuscated token
   window.PDFRE.autoInit()                     → mount [data-pdfre] blocks
   ============================================================== */
(function (global) {
    'use strict';

    var VERSION = '1.1.0';
    var CFG = global.PDFRE_CONFIG = global.PDFRE_CONFIG || {};

    /* ==========================================================
       1. pdf.js LOADER
       ========================================================== */
    var PDFJS_VERSION = CFG.pdfjsVersion || '3.11.174';
    var PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/build/';
    var PDFJS_LIB = CFG.pdfjsLib || (PDFJS_BASE + 'pdf.min.js');
    var PDFJS_WORKER = CFG.pdfjsWorker || (PDFJS_BASE + 'pdf.worker.min.js');

    var _libPromise = null;

    function configureWorker() {
        if (global.pdfjsLib && global.pdfjsLib.GlobalWorkerOptions &&
            !global.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        }
        return global.pdfjsLib;
    }

    function ensurePdfJs() {
        if (global.pdfjsLib) return Promise.resolve(configureWorker());
        if (_libPromise) return _libPromise;

        _libPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = PDFJS_LIB;
            s.async = true;
            s.onload = function () {
                if (!global.pdfjsLib) {
                    reject(new Error('pdf.js loaded but pdfjsLib is undefined.'));
                    return;
                }
                resolve(configureWorker());
            };
            s.onerror = function () {
                reject(new Error('Could not load pdf.js from ' + PDFJS_LIB));
            };
            document.head.appendChild(s);
        });
        return _libPromise;
    }

    /* ==========================================================
       2. SOURCE OBFUSCATION CODEC
       ----------------------------------------------------------
       Turns a plain PDF URL into a token that is not readable in
       the page source. This is obfuscation, not encryption — see
       README "What this does and does not protect".
       ========================================================== */
    var PEPPER = 'pdfre|v1|8f3c2d';

    function b64uEncode(str) {
        return btoa(unescape(encodeURIComponent(str)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function b64uDecode(str) {
        var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        return decodeURIComponent(escape(atob(s)));
    }

    function xorStr(str, key) {
        var out = '', i;
        for (i = 0; i < str.length; i++) {
            out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return out;
    }

    function nonce(n) {
        var abc = 'abcdefghijklmnopqrstuvwxyz0123456789', out = '';
        var buf = null;
        try {
            if (global.crypto && global.crypto.getRandomValues) {
                buf = new Uint8Array(n);
                global.crypto.getRandomValues(buf);
            }
        } catch (e) { buf = null; }
        for (var i = 0; i < n; i++) {
            var r = buf ? buf[i] : Math.floor(Math.random() * 256);
            out += abc.charAt(r % abc.length);
        }
        return out;
    }

    function encodeSrc(url, key) {
        var nc = nonce(6);
        var k = PEPPER + nc + (key || '');
        return 'p1.' + nc + '.' + b64uEncode(xorStr(encodeURIComponent(String(url)), k));
    }

    function decodeSrc(token, key) {
        var parts = String(token).split('.');
        if (parts[0] !== 'p1' || parts.length < 3) {
            throw new Error('Malformed source token.');
        }
        var nc = parts[1];
        var body = parts.slice(2).join('.');
        var k = PEPPER + nc + (key || '');
        return decodeURIComponent(xorStr(b64uDecode(body), k));
    }

    /* ==========================================================
       3. SMALL HELPERS
       ========================================================== */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function el(html) {
        var d = document.createElement('div');
        d.innerHTML = html.trim();
        return d.firstChild;
    }

    function prevent(e) { e.preventDefault(); e.stopPropagation(); return false; }

    function hostAllowed(list) {
        if (!list || !list.length) return true;
        var h = (global.location.hostname || '').toLowerCase();
        for (var i = 0; i < list.length; i++) {
            var p = String(list[i]).toLowerCase().trim();
            if (!p) continue;
            if (p === '*') return true;
            if (p.indexOf('*.') === 0) {
                var bare = p.slice(2);
                if (h === bare || h.slice(-(bare.length + 1)) === '.' + bare) return true;
            } else if (h === p) {
                return true;
            }
        }
        return false;
    }

    function fmtBytes(n) {
        if (!n) return '';
        var u = ['B', 'KB', 'MB', 'GB'], i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
    }

    function fetchBytes(url, opts, onProgress) {
        var init = {
            method: 'GET',
            mode: 'cors',
            credentials: opts.withCredentials ? 'include' : 'omit',
            cache: 'default'
        };
        if (opts.headers) init.headers = opts.headers;

        return fetch(url, init).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + (res.statusText || 'request failed'));

            var total = parseInt(res.headers.get('content-length') || '0', 10);

            if (!res.body || typeof res.body.getReader !== 'function') {
                return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
            }

            var reader = res.body.getReader();
            var chunks = [], received = 0;

            return (function pump() {
                return reader.read().then(function (r) {
                    if (r.done) {
                        var out = new Uint8Array(received), off = 0;
                        for (var i = 0; i < chunks.length; i++) {
                            out.set(chunks[i], off);
                            off += chunks[i].length;
                        }
                        chunks.length = 0;
                        return out;
                    }
                    chunks.push(r.value);
                    received += r.value.length;
                    if (onProgress) onProgress(received, total);
                    return pump();
                });
            })();
        });
    }

    /* Some proxies (Google Apps Script in particular) can only return text,
       so they hand back a base64 payload. Accept both shapes. */
    function normalizeBytes(bytes) {
        if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 &&
            bytes[2] === 0x44 && bytes[3] === 0x46) {
            return bytes;                                  // already "%PDF"
        }
        try {
            var head = '';
            for (var i = 0; i < Math.min(bytes.length, 80); i++) {
                head += String.fromCharCode(bytes[i]);
            }
            head = head.replace(/^\s+/, '');
            if (!/^(data:application\/pdf;base64,)?JVBER/.test(head)) return bytes;

            var txt = (global.TextDecoder)
                ? new TextDecoder('utf-8').decode(bytes)
                : Array.prototype.map.call(bytes, function (c) {
                    return String.fromCharCode(c);
                }).join('');

            txt = txt.trim()
                .replace(/^data:application\/pdf;base64,/, '')
                .replace(/\s+/g, '');

            var bin = atob(txt);
            var out = new Uint8Array(bin.length);
            for (var k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
            return out;
        } catch (e) {
            return bytes;
        }
    }

    function decodeText(bytes) {
        if (global.TextDecoder) return new TextDecoder('utf-8').decode(bytes);
        var out = '';
        for (var i = 0; i < bytes.length; i += 8192) {
            out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
    }

    /* Work out what arrived: a PDF, a JSON contents file, or HTML notes. */
    function sniffKind(bytes) {
        if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 &&
            bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';

        var head = '';
        for (var i = 0; i < Math.min(bytes.length, 600); i++) {
            head += String.fromCharCode(bytes[i]);
        }
        head = head.replace(/^\uFEFF/, '').replace(/^\s+/, '');

        if (head.charAt(0) === '{' || head.charAt(0) === '[') return 'manifest';
        return 'html';
    }

    /* ==========================================================
       4. ICONS
       ========================================================== */
    var I = {
        thumbs: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/>',
        search: '<circle cx="11" cy="11" r="6.6"/><path d="M20.2 20.2l-4.4-4.4"/>',
        close: '<path d="M6 6l12 12M18 6L6 18"/>',
        up: '<path d="M6 14.5l6-6 6 6"/>',
        down: '<path d="M6 9.5l6 6 6-6"/>',
        zin: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M10.6 7.8v5.6M7.8 10.6h5.6M20 20l-4.5-4.5"/>',
        zout: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M7.8 10.6h5.6M20 20l-4.5-4.5"/>',
        fitw: '<path d="M3.5 7.5V4.5h17v3M3.5 16.5v3h17v-3M7 12h10M7 12l2.4-2.4M7 12l2.4 2.4M17 12l-2.4-2.4M17 12l-2.4 2.4"/>',
        fitp: '<rect x="6.5" y="3.5" width="11" height="17" rx="1.2"/><path d="M9.5 8h5M9.5 12h5"/>',
        fsIn: '<path d="M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5"/>',
        fsOut: '<path d="M9.5 4v5.5H4M14.5 4v5.5H20M9.5 20v-5.5H4M14.5 20v-5.5H20"/>',
        rotate: '<path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4"/><path d="M20.5 4v5h-5"/>',
        outline: '<circle cx="4.6" cy="6" r="1.15"/><path d="M9 6h11"/><circle cx="4.6" cy="12" r="1.15"/><path d="M9 12h11"/><circle cx="4.6" cy="18" r="1.15"/><path d="M9 18h7"/>',
        alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v6M12 16.3v.5"/>'
    };

    function svg(name) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[name] + '</svg>';
    }

    function iconBtn(cls, name, tip, label) {
        return '<button type="button" class="pdfre-ico ' + cls + '" data-tip="' + tip +
            '" aria-label="' + (label || tip) + '">' + svg(name) + '</button>';
    }

    /* ==========================================================
       5. DOCUMENT-LEVEL PROTECTION (shared across instances)
       ========================================================== */
    var Guards = {
        count: 0,
        styleEl: null,
        blockPagePrint: true,
        readers: [],

        add: function (reader) {
            this.readers.push(reader);
            if (reader.opts.blockPagePrint === false) this.blockPagePrint = false;
            if (this.count++ === 0) this.install();
        },

        remove: function (reader) {
            var i = this.readers.indexOf(reader);
            if (i > -1) this.readers.splice(i, 1);
            if (--this.count <= 0) { this.count = 0; this.uninstall(); }
        },

        install: function () {
            document.addEventListener('keydown', this.onKey, true);
            global.addEventListener('beforeprint', this.onBeforePrint);
            global.addEventListener('afterprint', this.onAfterPrint);

            if (this.blockPagePrint && !this.styleEl) {
                this.styleEl = document.createElement('style');
                this.styleEl.id = 'pdfre-print-guard';
                this.styleEl.textContent =
                    '@media print{html body>*{display:none !important}' +
                    'html body::before{content:"Printing is disabled for this document.";' +
                    'display:block;padding:48px;font:600 15px/1.6 system-ui,sans-serif;' +
                    'text-align:center;color:#111}}';
                document.head.appendChild(this.styleEl);
            }
        },

        uninstall: function () {
            document.removeEventListener('keydown', this.onKey, true);
            global.removeEventListener('beforeprint', this.onBeforePrint);
            global.removeEventListener('afterprint', this.onAfterPrint);
            if (this.styleEl && this.styleEl.parentNode) {
                this.styleEl.parentNode.removeChild(this.styleEl);
            }
            this.styleEl = null;
        },

        onKey: function (e) {
            var k = (e.key || '').toLowerCase();
            var mod = e.ctrlKey || e.metaKey;
            var blocked =
                (mod && !e.shiftKey && (k === 'p' || k === 's' || k === 'u')) ||
                (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
                k === 'f12';

            if (!blocked) return;

            // Never swallow keystrokes aimed at a real text field elsewhere
            var t = e.target;
            if (t && /^(input|textarea|select)$/i.test(t.tagName) &&
                !(t.className && String(t.className).indexOf('pdfre-') === 0)) {
                if (k === 'u' || k === 'c') return;
            }

            e.preventDefault();
            e.stopPropagation();
            Guards.readers.forEach(function (r) {
                if (k === 'p' || k === 's') r.toast('Download and print are disabled for this document.');
            });
            return false;
        },

        onBeforePrint: function () {
            Guards.readers.forEach(function (r) { r.blank(true); });
        },

        onAfterPrint: function () {
            Guards.readers.forEach(function (r) { r.blank(false); });
        }
    };

    /* ==========================================================
       6. READER
       ========================================================== */
    var DEFAULTS = {
        src: '',
        srcEnc: '',
        key: '',
        htmlUrl: '',            // alias of src, for readability
        jsonUrl: '',            // alias of src — a JSON contents file
        srcType: 'auto',        // 'auto' | 'pdf' | 'html' | 'manifest'
        sectionSelector: '',    // what counts as a "page" in HTML notes
        proxyUrl: '',
        headers: null,
        withCredentials: false,

        title: 'Document',
        subtitle: '',
        height: 720,
        theme: 'dark',

        page: 1,
        zoom: 'fit-width',
        minZoom: 0.3,
        maxZoom: 6,

        autohide: 'always',
        autohideDelay: 2600,

        thumbnails: true,
        search: true,
        rotate: true,
        showPageNumbers: true,
        startFullscreen: false,

        allowedHosts: [],
        watermark: '',
        watermarkOpacity: 0.1,
        protect: true,
        blockPagePrint: true,
        paranoid: false,

        renderBuffer: 2,
        maxCanvasScale: 2,

        onReady: null,
        onError: null,
        onPageChange: null
    };

    var SHELL_HTML =
        '<div class="pdfre-shell">' +
          '<div class="pdfre-topbar">' +
            iconBtn('pdfre-b-thumbs', 'thumbs', 'Pages', 'Toggle page thumbnails') +
            '<div class="pdfre-title-wrap">' +
              '<div class="pdfre-title"></div>' +
              '<div class="pdfre-subtitle"></div>' +
            '</div>' +
            '<div class="pdfre-topbar-actions">' +
              iconBtn('pdfre-b-search', 'search', 'Search', 'Search in document') +
              iconBtn('pdfre-b-fs', 'fsIn', 'Fullscreen', 'Enter fullscreen') +
            '</div>' +
          '</div>' +

          '<div class="pdfre-body">' +
            '<aside class="pdfre-sidebar"><div class="pdfre-thumbs"></div></aside>' +
            '<div class="pdfre-scroll"><div class="pdfre-pages"></div></div>' +
            '<div class="pdfre-frame-wrap"></div>' +
          '</div>' +

          '<div class="pdfre-dock">' +
            iconBtn('pdfre-b-prev', 'up', 'Previous page', 'Previous page') +
            '<div class="pdfre-pageind">' +
              '<input class="pdfre-pageinput" type="number" min="1" value="1" aria-label="Page number">' +
              '<span>/</span><span class="pdfre-pagetotal">–</span>' +
            '</div>' +
            iconBtn('pdfre-b-next', 'down', 'Next page', 'Next page') +
            '<span class="pdfre-sep"></span>' +
            iconBtn('pdfre-b-zout', 'zout', 'Zoom out', 'Zoom out') +
            '<span class="pdfre-zoomval">100%</span>' +
            iconBtn('pdfre-b-zin', 'zin', 'Zoom in', 'Zoom in') +
            iconBtn('pdfre-b-fit', 'fitw', 'Fit to width', 'Change fit mode') +
            iconBtn('pdfre-b-rot', 'rotate', 'Rotate', 'Rotate pages') +
            '<span class="pdfre-sep pdfre-sep-fs"></span>' +
            iconBtn('pdfre-b-fs2', 'fsIn', 'Fullscreen', 'Enter fullscreen') +
          '</div>' +

          '<div class="pdfre-search">' +
            '<div class="pdfre-search-row">' +
              '<input class="pdfre-search-input" type="text" placeholder="Search in document" aria-label="Search in document">' +
              '<span class="pdfre-search-count"></span>' +
              iconBtn('pdfre-b-sprev', 'up', 'Previous match', 'Previous match') +
              iconBtn('pdfre-b-snext', 'down', 'Next match', 'Next match') +
              iconBtn('pdfre-b-sclose', 'close', 'Close', 'Close search') +
            '</div>' +
            '<div class="pdfre-results"></div>' +
          '</div>' +

          '<div class="pdfre-loader">' +
            '<div class="pdfre-spin"></div>' +
            '<div class="pdfre-bar"><div class="pdfre-bar-fill"></div></div>' +
            '<div class="pdfre-loader-text">Loading document…</div>' +
          '</div>' +

          '<div class="pdfre-error">' +
            svg('alert') +
            '<div class="pdfre-error-title">This document could not be opened</div>' +
            '<div class="pdfre-error-msg"></div>' +
            '<div class="pdfre-error-code"></div>' +
            '<button type="button" class="pdfre-btn">Try again</button>' +
          '</div>' +

          '<div class="pdfre-toast"></div>' +
        '</div>';

    function Reader(container, options) {
        var o = {}, k;
        for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) o[k] = DEFAULTS[k];
        for (k in options) if (options.hasOwnProperty(k)) o[k] = options[k];
        this.opts = o;

        this.container = container;
        this.mode = null;        // 'pdf' | 'html'
        this.frame = null;
        this.idoc = null;
        this.iwin = null;
        this.sections = [];
        this.pdf = null;
        this.numPages = 0;
        this.dims = [];          // 1-based page dimensions at scale 1
        this.pageEls = [];       // 1-based page elements
        this.tasks = {};         // in-flight render tasks
        this.rendered = {};
        this.current = 1;
        this.scale = 1;
        this.fitMode = (o.zoom === 'fit-page' || o.zoom === 'fit-width') ? o.zoom : null;
        this.rotation = 0;
        this.isFs = false;
        this.destroyed = false;
        this.textIndex = null;
        this.matches = [];
        this.matchIndex = -1;
        this._idleTimer = null;
        this._toastTimer = null;
        this._raf = null;

        this.build();
        this.load();
    }

    Reader.prototype.build = function () {
        var self = this, o = this.opts;

        var root = document.createElement('div');
        root.className = 'pdfre-root';
        root.setAttribute('data-theme', o.theme === 'light' ? 'light' : 'dark');
        root.appendChild(el(SHELL_HTML));

        this.container.innerHTML = '';
        this.container.appendChild(root);

        var q = function (sel) { return root.querySelector(sel); };
        this.root = root;
        this.shell = q('.pdfre-shell');
        this.scrollEl = q('.pdfre-scroll');
        this.pagesEl = q('.pdfre-pages');
        this.frameWrap = q('.pdfre-frame-wrap');
        this.sidebarEl = q('.pdfre-thumbs');
        this.loaderEl = q('.pdfre-loader');
        this.loaderText = q('.pdfre-loader-text');
        this.barFill = q('.pdfre-bar-fill');
        this.errorEl = q('.pdfre-error');
        this.toastEl = q('.pdfre-toast');
        this.pageInput = q('.pdfre-pageinput');
        this.pageTotal = q('.pdfre-pagetotal');
        this.zoomVal = q('.pdfre-zoomval');
        this.searchEl = q('.pdfre-search');
        this.searchInput = q('.pdfre-search-input');
        this.searchCount = q('.pdfre-search-count');
        this.resultsEl = q('.pdfre-results');

        q('.pdfre-title').textContent = o.title || 'Document';
        q('.pdfre-subtitle').textContent = o.subtitle || '';

        var h = typeof o.height === 'number' ? o.height + 'px' : String(o.height);
        this.shell.style.height = h;

        if (!o.thumbnails) q('.pdfre-b-thumbs').style.display = 'none';
        if (!o.search) q('.pdfre-b-search').style.display = 'none';
        if (!o.rotate) q('.pdfre-b-rot').style.display = 'none';

        /* ---- controls ---- */
        var on = function (sel, ev, fn) {
            var node = q(sel);
            if (node) node.addEventListener(ev, fn);
            return node;
        };

        on('.pdfre-b-thumbs', 'click', function () { self.toggleSidebar(); });
        on('.pdfre-b-search', 'click', function () { self.toggleSearch(); });
        on('.pdfre-b-fs', 'click', function () { self.toggleFullscreen(); });
        on('.pdfre-b-fs2', 'click', function () { self.toggleFullscreen(); });
        on('.pdfre-b-prev', 'click', function () { self.goTo(self.current - 1); });
        on('.pdfre-b-next', 'click', function () { self.goTo(self.current + 1); });
        on('.pdfre-b-zin', 'click', function () { self.zoomBy(1.25); });
        on('.pdfre-b-zout', 'click', function () { self.zoomBy(1 / 1.25); });
        on('.pdfre-b-fit', 'click', function () { self.cycleFit(); });
        on('.pdfre-b-rot', 'click', function () { self.rotate(90); });
        on('.pdfre-b-sclose', 'click', function () { self.toggleSearch(false); });
        on('.pdfre-b-snext', 'click', function () { self.stepMatch(1); });
        on('.pdfre-b-sprev', 'click', function () { self.stepMatch(-1); });
        on('.pdfre-error .pdfre-btn', 'click', function () { self.load(); });

        this.pageInput.addEventListener('change', function () {
            self.goTo(parseInt(this.value, 10) || 1);
        });
        this.pageInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { self.goTo(parseInt(this.value, 10) || 1); this.blur(); }
            e.stopPropagation();
        });

        var searchDebounce = null;
        this.searchInput.addEventListener('input', function () {
            clearTimeout(searchDebounce);
            var v = this.value;
            searchDebounce = setTimeout(function () { self.runSearch(v); }, 260);
        });
        this.searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { self.stepMatch(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { self.toggleSearch(false); }
            e.stopPropagation();
        });

        /* ---- scrolling ---- */
        this.onScroll = function () {
            if (self._raf) return;
            self._raf = requestAnimationFrame(function () {
                self._raf = null;
                self.updateVisible();
            });
        };
        this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });

        /* ---- auto-hide (Drive-style) ---- */
        this.onActivity = function () { self.poke(); };
        ['mousemove', 'mousedown', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) {
            self.shell.addEventListener(ev, self.onActivity, { passive: true });
        });
        this.shell.addEventListener('mouseleave', function () { self.poke(true); });

        /* ---- keyboard ---- */
        this.onKey = function (e) { self.handleKey(e); };
        this.shell.setAttribute('tabindex', '-1');
        this.shell.addEventListener('keydown', this.onKey);

        /* ---- fullscreen change ---- */
        this.onFsChange = function () {
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            self.isFs = (fsEl === self.shell);
            self.syncFsButtons();
            self.relayout(true);
            self.poke();
        };
        document.addEventListener('fullscreenchange', this.onFsChange);
        document.addEventListener('webkitfullscreenchange', this.onFsChange);

        /* ---- resize ---- */
        this.onResize = function () {
            clearTimeout(self._resizeT);
            self._resizeT = setTimeout(function () { self.relayout(true); }, 140);
        };
        global.addEventListener('resize', this.onResize);
        if (global.ResizeObserver) {
            this.ro = new ResizeObserver(this.onResize);
            this.ro.observe(this.shell);
        }

        /* ---- pinch zoom ---- */
        this.installPinch();

        /* ---- protection ---- */
        if (o.protect) {
            root.addEventListener('contextmenu', prevent);
            ['copy', 'cut', 'dragstart', 'selectstart'].forEach(function (ev) {
                root.addEventListener(ev, function (e) {
                    if (e.target && e.target.className &&
                        String(e.target.className).indexOf('pdfre-search-input') > -1) return;
                    if (e.target === self.pageInput) return;
                    prevent(e);
                });
            });
            Guards.add(this);
            if (o.paranoid) this.installParanoid();
        }

        if (o.startFullscreen) {
            setTimeout(function () { self.toggleFullscreen(true); }, 40);
        }
    };

    /* ---------- loading ---------- */
    Reader.prototype.load = function () {
        var self = this, o = this.opts;

        this.hideError();
        this.loaderEl.classList.remove('is-hidden');
        this.setProgress(0, 'Loading document…');

        if (!hostAllowed(o.allowedHosts)) {
            this.fail('This document is not licensed for display on this domain.',
                global.location.hostname);
            return;
        }

        var url;
        try {
            url = o.srcEnc
                ? decodeSrc(o.srcEnc, o.key)
                : String(o.src || o.htmlUrl || o.jsonUrl || '');
        } catch (e) {
            this.fail('The document source could not be resolved.', e.message);
            return;
        }

        if (!url && !o.proxyUrl) {
            this.fail('No document source was provided.',
                'Set one of "src", "htmlUrl", "jsonUrl", "srcEnc" or "proxyUrl".');
            return;
        }

        /* Three source modes, in order of how much the browser gets to see:
             1. src / srcEnc alone  — the browser fetches the origin URL.
             2. proxyUrl + src      — the origin URL is passed to your proxy.
             3. proxyUrl alone      — the origin URL lives on your server and
                                      never reaches the browser at all.        */
        var fetchUrl;
        if (!url) {
            fetchUrl = o.proxyUrl;
        } else if (o.proxyUrl) {
            fetchUrl = o.proxyUrl.indexOf('{src}') > -1
                ? o.proxyUrl.replace('{src}', encodeURIComponent(url))
                : o.proxyUrl + (o.proxyUrl.indexOf('?') > -1 ? '&' : '?') + 'src=' + encodeURIComponent(url);
        } else {
            fetchUrl = url;
        }

        var manifestBase = url;   // kept in this closure only, never on the instance

        fetchBytes(fetchUrl, o, function (got, total) {
            if (total) {
                self.setProgress(got / total, Math.round(got / total * 100) + '% · ' + fmtBytes(total));
            } else {
                self.setProgress(-1, fmtBytes(got) + ' loaded');
            }
        }).then(function (raw) {
            if (self.destroyed) return null;
            url = null;
            fetchUrl = null;

            var bytes = normalizeBytes(raw);
            var kind = (o.srcType && o.srcType !== 'auto') ? o.srcType : sniffKind(bytes);

            if (kind === 'pdf') {
                self.setProgress(1, 'Preparing pages…');
                return self.openPdf(bytes);
            }
            if (kind === 'manifest' || kind === 'json') {
                self.setProgress(1, 'Reading contents…');
                return self.openManifest(decodeText(bytes), manifestBase);
            }
            self.setProgress(1, 'Preparing notes…');
            return self.openHtml(decodeText(bytes));
        }).catch(function (err) {
            if (self.destroyed) return;
            var msg = 'The file could not be fetched or is not a readable document.';
            var detail = (err && err.message) || String(err);
            if (/failed to fetch|networkerror|load failed/i.test(detail)) {
                msg = 'The file could not be fetched. The host may not allow cross-origin requests (CORS).';
            } else if (/invalid pdf|missing pdf|unexpected/i.test(detail)) {
                msg = 'The file was received but is not a valid PDF.';
            } else if (/password/i.test(detail)) {
                msg = 'This PDF is password protected.';
            } else if (/json/i.test(detail)) {
                msg = 'The contents file was received but is not valid JSON.';
            }
            self.fail(msg, detail);
            if (typeof self.opts.onError === 'function') self.opts.onError(err);
        });
    };

    /* ---------- PDF path ---------- */
    Reader.prototype.openPdf = function (bytes) {
        var self = this;
        this.mode = 'pdf';

        return ensurePdfJs().then(function (lib) {
            if (self.destroyed) return null;
            return lib.getDocument({
                data: bytes,
                disableAutoFetch: true,
                isEvalSupported: false,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VERSION + '/cmaps/',
                cMapPacked: true
            }).promise;
        }).then(function (pdf) {
            if (!pdf || self.destroyed) return;
            self.pdf = pdf;
            self.numPages = pdf.numPages;
            self.pageTotal.textContent = pdf.numPages;
            self.pageInput.max = pdf.numPages;

            return self.primeDims().then(function () {
                self.buildPages();
                self.relayout(false);
                var start = clamp(parseInt(self.opts.page, 10) || 1, 1, self.numPages);
                if (start > 1) self.goTo(start, true);
                self.updateVisible();
                self.loaderEl.classList.add('is-hidden');
                self.poke();
                if (self.opts.thumbnails) self.buildThumbs();
                if (typeof self.opts.onReady === 'function') {
                    self.opts.onReady({ mode: 'pdf', pages: self.numPages });
                }
            });
        });
    };

    Reader.prototype.primeDims = function () {
        var self = this;
        var n = this.numPages;
        this.dims = new Array(n + 1);

        return this.pdf.getPage(1).then(function (p) {
            var vp = p.getViewport({ scale: 1 });
            var base = { w: vp.width, h: vp.height };
            for (var i = 1; i <= n; i++) self.dims[i] = { w: base.w, h: base.h, exact: false };
            self.dims[1].exact = true;

            if (n > 400) return null;      // very long docs: measure lazily instead

            var i2 = 2;
            function step() {
                if (i2 > n || self.destroyed) return null;
                var batch = [];
                for (var c = 0; c < 24 && i2 <= n; c++, i2++) {
                    batch.push(self.measure(i2));
                }
                return Promise.all(batch).then(step);
            }
            return step();
        });
    };

    Reader.prototype.measure = function (i) {
        var self = this;
        return this.pdf.getPage(i).then(function (p) {
            var vp = p.getViewport({ scale: 1 });
            self.dims[i] = { w: vp.width, h: vp.height, exact: true };
        }).catch(function () { });
    };

    Reader.prototype.buildPages = function () {
        var frag = document.createDocumentFragment();
        this.pageEls = new Array(this.numPages + 1);

        for (var i = 1; i <= this.numPages; i++) {
            var p = document.createElement('div');
            p.className = 'pdfre-page';
            p.setAttribute('data-page', i);
            if (this.opts.showPageNumbers) {
                var badge = document.createElement('span');
                badge.className = 'pdfre-page-num';
                badge.textContent = i + ' / ' + this.numPages;
                p.appendChild(badge);
            }
            this.pageEls[i] = p;
            frag.appendChild(p);
        }
        this.pagesEl.innerHTML = '';
        this.pagesEl.appendChild(frag);
    };

    /* ---------- layout / zoom ---------- */
    Reader.prototype.maxDims = function () {
        var w = 0, h = 0;
        for (var i = 1; i <= this.numPages; i++) {
            var d = this.dims[i];
            if (!d) continue;
            var dw = this.swapped() ? d.h : d.w;
            var dh = this.swapped() ? d.w : d.h;
            if (dw > w) w = dw;
            if (dh > h) h = dh;
        }
        return { w: w || 612, h: h || 792 };
    };

    Reader.prototype.swapped = function () {
        return (this.rotation % 180) !== 0;
    };

    Reader.prototype.computeScale = function () {
        var m = this.maxDims();
        var padX = 32;
        var availW = Math.max(120, this.scrollEl.clientWidth - padX - 14);
        var availH = Math.max(120, this.scrollEl.clientHeight - 64);

        if (this.fitMode === 'fit-width') return availW / m.w;
        if (this.fitMode === 'fit-page') return Math.min(availW / m.w, availH / m.h);
        return this.scale;
    };

    Reader.prototype.relayout = function (keepAnchor) {
        if (this.mode === 'html') return this.htmlRelayout();
        if (!this.pdf) return;

        var anchorPage = this.current;
        var anchorEl = this.pageEls[anchorPage];
        var anchorOffset = 0;
        if (keepAnchor && anchorEl) {
            anchorOffset = anchorEl.getBoundingClientRect().top -
                this.scrollEl.getBoundingClientRect().top;
        }

        var next = clamp(this.computeScale(), this.opts.minZoom, this.opts.maxZoom);
        var changed = Math.abs(next - this.scale) > 0.001;
        this.scale = next;

        for (var i = 1; i <= this.numPages; i++) {
            var d = this.dims[i];
            if (!d) continue;
            var w = (this.swapped() ? d.h : d.w) * this.scale;
            var h = (this.swapped() ? d.w : d.h) * this.scale;
            var pe = this.pageEls[i];
            pe.style.width = Math.round(w) + 'px';
            pe.style.height = Math.round(h) + 'px';
        }

        if (changed) this.unrenderAll();
        this.zoomVal.textContent = Math.round(this.scale * 100) + '%';

        if (keepAnchor && anchorEl) {
            this.scrollEl.scrollTop = anchorEl.offsetTop - anchorOffset;
        }

        this.updateVisible();
    };

    Reader.prototype.zoomBy = function (f) {
        this.fitMode = null;
        this.scale = clamp(this.scale * f, this.opts.minZoom, this.opts.maxZoom);
        this.relayout(true);
        this.setFitIcon();
    };

    Reader.prototype.setZoom = function (z) {
        if (z === 'fit-width' || z === 'fit-page') {
            this.fitMode = z;
        } else {
            this.fitMode = null;
            this.scale = clamp(parseFloat(z) || 1, this.opts.minZoom, this.opts.maxZoom);
        }
        this.relayout(true);
        this.setFitIcon();
    };

    Reader.prototype.cycleFit = function () {
        if (this.mode === 'html') {
            if (this.fitMode) { this.setZoom(1); this.toast('Actual size'); }
            else { this.setZoom('fit-width'); this.toast('Fit to width'); }
            return;
        }
        this.setZoom(this.fitMode === 'fit-width' ? 'fit-page' : 'fit-width');
        this.toast(this.fitMode === 'fit-width' ? 'Fit to width' : 'Fit to page');
    };

    Reader.prototype.setFitIcon = function () {
        var btn = this.root.querySelector('.pdfre-b-fit');
        if (!btn) return;
        var name = this.fitMode === 'fit-page' ? 'fitp' : 'fitw';
        btn.innerHTML = svg(name);
        btn.setAttribute('data-tip', this.fitMode === 'fit-page' ? 'Fit to page' : 'Fit to width');
    };

    Reader.prototype.rotate = function (deg) {
        if (this.mode === 'html') return;
        this.rotation = (this.rotation + deg + 360) % 360;
        this.unrenderAll();
        this.relayout(true);
        this.toast('Rotated ' + this.rotation + '°');
    };

    /* ---------- rendering ---------- */
    Reader.prototype.updateVisible = function () {
        if (this.mode === 'html') return this.htmlUpdateVisible();
        if (!this.pdf || this.destroyed) return;

        var top = this.scrollEl.scrollTop;
        var vh = this.scrollEl.clientHeight;
        var buffer = this.opts.renderBuffer;

        var first = 0, last = 0, best = 1, bestVis = -1;

        for (var i = 1; i <= this.numPages; i++) {
            var pe = this.pageEls[i];
            if (!pe) continue;
            var pTop = pe.offsetTop;
            var pBot = pTop + pe.offsetHeight;

            var visible = Math.min(pBot, top + vh) - Math.max(pTop, top);
            if (visible > bestVis) { bestVis = visible; best = i; }

            if (pBot > top - vh * buffer && pTop < top + vh * (1 + buffer)) {
                if (!first) first = i;
                last = i;
            }
        }

        for (var j = 1; j <= this.numPages; j++) {
            if (j >= first && j <= last) this.renderPage(j);
            else if (this.rendered[j] && (j < first - 2 || j > last + 2)) this.unrenderPage(j);
        }

        if (best !== this.current) {
            this.current = best;
            if (document.activeElement !== this.pageInput) this.pageInput.value = best;
            this.markThumb(best);
            if (typeof this.opts.onPageChange === 'function') this.opts.onPageChange(best);
        }
    };

    Reader.prototype.renderPage = function (i) {
        var self = this;
        if (this.rendered[i] || this.tasks[i] || !this.pdf) return;

        this.tasks[i] = true;

        this.pdf.getPage(i).then(function (page) {
            if (self.destroyed || !self.tasks[i]) return;

            var rot = (page.rotate + self.rotation) % 360;
            var vp = page.getViewport({ scale: self.scale, rotation: rot });

            // keep the placeholder honest for long documents measured lazily
            var d = self.dims[i];
            if (d && !d.exact) {
                var base = page.getViewport({ scale: 1, rotation: page.rotate });
                self.dims[i] = { w: base.width, h: base.height, exact: true };
                var pe0 = self.pageEls[i];
                pe0.style.width = Math.round(vp.width) + 'px';
                pe0.style.height = Math.round(vp.height) + 'px';
            }

            var dpr = Math.min(global.devicePixelRatio || 1, self.opts.maxCanvasScale);
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(vp.width * dpr));
            canvas.height = Math.max(1, Math.floor(vp.height * dpr));
            canvas.style.width = '100%';
            canvas.style.height = '100%';

            var ctx = canvas.getContext('2d', { alpha: false });
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            var task = page.render({
                canvasContext: ctx,
                viewport: vp,
                transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
                intent: 'display'
            });
            self.tasks[i] = task;

            return task.promise.then(function () {
                if (self.destroyed || self.tasks[i] !== task) return;
                self.stampWatermark(ctx, canvas.width, canvas.height);
                var pe = self.pageEls[i];
                var old = pe.querySelector('canvas');
                if (old) pe.removeChild(old);
                pe.insertBefore(canvas, pe.firstChild);
                pe.classList.add('is-rendered');
                self.rendered[i] = canvas;
                self.tasks[i] = null;
                if (self.pendingHighlight === i) {
                    self.pendingHighlight = null;
                    self.paintHighlights();
                }
            });
        }).catch(function () {
            self.tasks[i] = null;
        });
    };

    Reader.prototype.unrenderPage = function (i) {
        var t = this.tasks[i];
        if (t && typeof t.cancel === 'function') { try { t.cancel(); } catch (e) { } }
        this.tasks[i] = null;

        var canvas = this.rendered[i];
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        }
        this.rendered[i] = null;
        if (this.pageEls[i]) this.pageEls[i].classList.remove('is-rendered');
    };

    Reader.prototype.unrenderAll = function () {
        if (this.mode === 'html') return;
        for (var i = 1; i <= this.numPages; i++) this.unrenderPage(i);
    };

    Reader.prototype.stampWatermark = function (ctx, w, h) {
        var text = this.opts.watermark;
        if (!text) return;
        ctx.save();
        ctx.globalAlpha = this.opts.watermarkOpacity;
        ctx.fillStyle = '#000';
        var size = Math.max(14, Math.round(Math.min(w, h) / 26));
        ctx.font = '600 ' + size + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(w / 2, h / 2);
        ctx.rotate(-Math.PI / 6);
        var stepY = size * 5, stepX = ctx.measureText(text).width + size * 4;
        for (var y = -h; y < h; y += stepY) {
            for (var x = -w; x < w; x += stepX) ctx.fillText(text, x, y);
        }
        ctx.restore();
    };

    /* Blank every canvas (used around print events). */
    Reader.prototype.blank = function (on) {
        if (this.mode === 'html') return;
        if (on) {
            for (var i = 1; i <= this.numPages; i++) {
                var c = this.rendered[i];
                if (!c) continue;
                var ctx = c.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, c.width, c.height);
            }
        } else {
            this.unrenderAll();
            this.updateVisible();
        }
    };

    /* ---------- navigation ---------- */
    Reader.prototype.goTo = function (n, instant) {
        if (this.mode === 'html') return this.htmlGoTo(n, instant);
        if (!this.pdf) return;
        n = clamp(parseInt(n, 10) || 1, 1, this.numPages);
        var pe = this.pageEls[n];
        if (!pe) return;
        this.scrollEl.scrollTo({
            top: pe.offsetTop - 8,
            behavior: instant ? 'auto' : 'smooth'
        });
        this.pageInput.value = n;
    };

    Reader.prototype.handleKey = function (e) {
        var t = e.target;
        if (t && /^(input|textarea)$/i.test(t.tagName)) return;

        var k = e.key;
        var handled = true;

        var sc = (this.mode === 'html' && this.iwin) ? this.iwin : this.scrollEl;
        var vh = (this.mode === 'html' && this.iwin)
            ? this.iwin.innerHeight
            : this.scrollEl.clientHeight;

        switch (k) {
            case 'ArrowDown': case 'PageDown': case ' ':
                sc.scrollBy({ top: vh * 0.9, behavior: 'smooth' }); break;
            case 'ArrowUp': case 'PageUp':
                sc.scrollBy({ top: -vh * 0.9, behavior: 'smooth' }); break;
            case 'ArrowRight': this.goTo(this.current + 1); break;
            case 'ArrowLeft': this.goTo(this.current - 1); break;
            case 'Home': this.goTo(1); break;
            case 'End': this.goTo(this.numPages); break;
            case '+': case '=': this.zoomBy(1.25); break;
            case '-': case '_': this.zoomBy(1 / 1.25); break;
            case '0': this.setZoom('fit-width'); break;
            case 'f': case 'F': this.toggleFullscreen(); break;
            case 'r': case 'R': if (this.opts.rotate) this.rotate(90); break;
            case 'Escape':
                if (this.shell.classList.contains('is-search')) this.toggleSearch(false);
                else handled = false;
                break;
            default:
                if ((e.ctrlKey || e.metaKey) && (k === 'f' || k === 'F') && this.opts.search) {
                    this.toggleSearch(true);
                } else handled = false;
        }
        if (handled) { e.preventDefault(); e.stopPropagation(); }
    };

    /* ---------- fullscreen + auto-hide ---------- */
    Reader.prototype.toggleFullscreen = function (force) {
        var want = (typeof force === 'boolean') ? force : !this.isFs;
        var s = this.shell;

        if (want) {
            var req = s.requestFullscreen || s.webkitRequestFullscreen || s.msRequestFullscreen;
            if (req) {
                try {
                    var p = req.call(s);
                    if (p && p.catch) p.catch(this.pseudoFs.bind(this, true));
                } catch (e) { this.pseudoFs(true); }
            } else {
                this.pseudoFs(true);
            }
        } else {
            if (s.classList.contains('is-pseudo-fs')) {
                this.pseudoFs(false);
            } else {
                var exit = document.exitFullscreen || document.webkitExitFullscreen;
                if (exit) { try { exit.call(document); } catch (e) { } }
            }
        }
        this.shell.focus({ preventScroll: true });
    };

    Reader.prototype.pseudoFs = function (on) {
        this.shell.classList.toggle('is-pseudo-fs', !!on);
        document.documentElement.classList.toggle('pdfre-noscroll', !!on);
        document.body.classList.toggle('pdfre-noscroll', !!on);
        this.isFs = !!on;
        this.syncFsButtons();
        this.relayout(true);
        this.poke();
    };

    Reader.prototype.syncFsButtons = function () {
        var name = this.isFs ? 'fsOut' : 'fsIn';
        var tip = this.isFs ? 'Exit fullscreen' : 'Fullscreen';
        var list = this.root.querySelectorAll('.pdfre-b-fs, .pdfre-b-fs2');
        for (var i = 0; i < list.length; i++) {
            list[i].innerHTML = svg(name);
            list[i].setAttribute('data-tip', tip);
        }
    };

    /* Reset the idle timer — controls reappear, then fade after the delay. */
    Reader.prototype.poke = function (immediateHide) {
        var self = this, mode = this.opts.autohide;
        clearTimeout(this._idleTimer);

        if (mode === 'never' || (mode === 'fullscreen' && !this.isFs)) {
            this.shell.classList.remove('is-idle');
            this.setFrameIdle(false);
            return;
        }
        this.shell.classList.remove('is-idle');
        this.setFrameIdle(false);

        var delay = immediateHide ? 420 : (this.opts.autohideDelay || 2600);
        this._idleTimer = setTimeout(function () {
            if (self.destroyed) return;
            if (self.shell.classList.contains('is-search')) return;
            if (self.root.querySelector('.pdfre-topbar:hover, .pdfre-dock:hover')) {
                self.poke();
                return;
            }
            if (document.activeElement === self.pageInput) return;
            self.shell.classList.add('is-idle');
            self.setFrameIdle(true);
        }, delay);
    };

    Reader.prototype.setFrameIdle = function (on) {
        if (!this.idoc) return;
        try { this.idoc.documentElement.classList.toggle('pdfre-idle', !!on); } catch (e) { }
    };

    /* ---------- sidebar / thumbnails ---------- */
    Reader.prototype.toggleSidebar = function (force) {
        var on = (typeof force === 'boolean') ? force : !this.shell.classList.contains('is-sidebar');
        this.shell.classList.toggle('is-sidebar', on);
        this.root.querySelector('.pdfre-b-thumbs').classList.toggle('is-on', on);
        var self = this;
        setTimeout(function () { self.relayout(true); }, 260);
    };

    Reader.prototype.buildThumbs = function () {
        var self = this;
        var frag = document.createDocumentFragment();
        this.thumbEls = new Array(this.numPages + 1);

        for (var i = 1; i <= this.numPages; i++) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'pdfre-thumb';
            b.setAttribute('data-page', i);
            var d = this.dims[i] || { w: 612, h: 792 };
            b.innerHTML = '<span class="pdfre-thumb-box" style="aspect-ratio:' +
                (d.w / d.h).toFixed(4) + '"></span>' + i;
            b.addEventListener('click', (function (n) {
                return function () { self.goTo(n); };
            })(i));
            this.thumbEls[i] = b;
            frag.appendChild(b);
        }
        this.sidebarEl.innerHTML = '';
        this.sidebarEl.appendChild(frag);
        this.markThumb(this.current);

        if (global.IntersectionObserver) {
            this.thumbObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (!en.isIntersecting) return;
                    var n = parseInt(en.target.getAttribute('data-page'), 10);
                    self.thumbObserver.unobserve(en.target);
                    self.renderThumb(n);
                });
            }, { root: this.sidebarEl, rootMargin: '200px' });

            for (var j = 1; j <= this.numPages; j++) this.thumbObserver.observe(this.thumbEls[j]);
        }
    };

    Reader.prototype.renderThumb = function (i) {
        var self = this;
        if (!this.pdf || !this.thumbEls || !this.thumbEls[i]) return;
        this.pdf.getPage(i).then(function (page) {
            if (self.destroyed) return;
            var vp0 = page.getViewport({ scale: 1 });
            var target = 160;
            var vp = page.getViewport({ scale: target / vp0.width });
            var c = document.createElement('canvas');
            c.width = Math.floor(vp.width);
            c.height = Math.floor(vp.height);
            var ctx = c.getContext('2d', { alpha: false });
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                if (self.destroyed) return;
                var box = self.thumbEls[i].querySelector('.pdfre-thumb-box');
                if (box) { box.innerHTML = ''; box.appendChild(c); }
            });
        }).catch(function () { });
    };

    Reader.prototype.markThumb = function (n) {
        if (!this.thumbEls) return;
        for (var i = 1; i <= this.numPages; i++) {
            if (!this.thumbEls[i]) continue;
            this.thumbEls[i].classList.toggle('is-active', i === n);
        }
        var act = this.thumbEls[n];
        if (act && this.shell.classList.contains('is-sidebar')) {
            var r = act.getBoundingClientRect();
            var pr = this.sidebarEl.getBoundingClientRect();
            if (r.top < pr.top || r.bottom > pr.bottom) {
                this.sidebarEl.scrollTop += (r.top - pr.top) - pr.height / 3;
            }
        }
    };

    /* ---------- search ---------- */
    Reader.prototype.toggleSearch = function (force) {
        var on = (typeof force === 'boolean') ? force : !this.shell.classList.contains('is-search');
        this.shell.classList.toggle('is-search', on);
        this.root.querySelector('.pdfre-b-search').classList.toggle('is-on', on);
        if (on) {
            this.poke();
            var self = this;
            setTimeout(function () { self.searchInput.focus(); }, 60);
            this.buildTextIndex();
        } else {
            this.clearHighlights();
        }
    };

    Reader.prototype.buildTextIndex = function () {
        var self = this;
        if (this.mode !== 'pdf') return Promise.resolve(null);
        if (this.textIndexPromise) return this.textIndexPromise;

        this.textIndex = new Array(this.numPages + 1);
        var i = 1;

        this.textIndexPromise = (function step() {
            if (i > self.numPages || self.destroyed) return Promise.resolve(self.textIndex);
            var n = i++;
            return self.pdf.getPage(n)
                .then(function (page) { return page.getTextContent(); })
                .then(function (tc) {
                    var str = '', map = [];
                    for (var t = 0; t < tc.items.length; t++) {
                        var it = tc.items[t];
                        map.push({ start: str.length, len: it.str.length, item: it });
                        str += it.str;
                        if (it.hasEOL) str += ' ';
                    }
                    self.textIndex[n] = { text: str, lower: str.toLowerCase(), map: map };
                })
                .catch(function () { self.textIndex[n] = { text: '', lower: '', map: [] }; })
                .then(step);
        })();

        return this.textIndexPromise;
    };

    Reader.prototype.runSearch = function (term) {
        var self = this;
        term = String(term || '').trim();
        if (this.mode === 'html') return this.htmlSearch(term);
        this.clearHighlights();
        this.matches = [];
        this.matchIndex = -1;

        if (term.length < 2) {
            this.searchCount.textContent = '';
            this.resultsEl.innerHTML = '<div class="pdfre-empty">Type at least two characters.</div>';
            return;
        }

        this.searchCount.textContent = '…';
        this.resultsEl.innerHTML = '<div class="pdfre-empty">Searching…</div>';

        this.buildTextIndex().then(function () {
            if (self.destroyed) return;
            var needle = term.toLowerCase();

            for (var p = 1; p <= self.numPages; p++) {
                var idx = self.textIndex[p];
                if (!idx || !idx.lower) continue;
                var from = 0, at;
                while ((at = idx.lower.indexOf(needle, from)) !== -1) {
                    self.matches.push({ page: p, start: at, end: at + needle.length });
                    from = at + needle.length;
                    if (self.matches.length > 800) break;
                }
                if (self.matches.length > 800) break;
            }

            self.renderResults(term);
            if (self.matches.length) self.stepMatch(1);
        });
    };

    Reader.prototype.renderResults = function (term) {
        var self = this;
        this.searchCount.textContent = this.matches.length
            ? (this.matchIndex + 1) + '/' + this.matches.length
            : '0';

        if (!this.matches.length) {
            this.resultsEl.innerHTML = '<div class="pdfre-empty">No results for “' +
                term.replace(/[<>&]/g, '') + '”.</div>';
            return;
        }

        var html = '';
        var shown = Math.min(this.matches.length, 120);
        for (var i = 0; i < shown; i++) {
            var m = this.matches[i];
            var idx = this.textIndex[m.page];
            var a = Math.max(0, m.start - 34), b = Math.min(idx.text.length, m.end + 44);
            var pre = idx.text.slice(a, m.start);
            var hit = idx.text.slice(m.start, m.end);
            var post = idx.text.slice(m.end, b);
            var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
            html += '<button type="button" class="pdfre-result" data-i="' + i + '">' +
                '<span class="pdfre-result-pg">Page ' + m.page + '</span>' +
                (a > 0 ? '…' : '') + esc(pre) + '<b>' + esc(hit) + '</b>' + esc(post) +
                (b < idx.text.length ? '…' : '') + '</button>';
        }
        this.resultsEl.innerHTML = html;

        this.resultsEl.querySelectorAll('.pdfre-result').forEach(function (btn) {
            btn.addEventListener('click', function () {
                self.matchIndex = parseInt(btn.getAttribute('data-i'), 10);
                self.showMatch();
            });
        });
    };

    Reader.prototype.stepMatch = function (dir) {
        if (!this.matches.length) return;
        this.matchIndex = (this.matchIndex + dir + this.matches.length) % this.matches.length;
        this.showMatch();
    };

    Reader.prototype.showMatch = function () {
        if (this.mode === 'html') return this.showHtmlMatch();
        var m = this.matches[this.matchIndex];
        if (!m) return;

        this.searchCount.textContent = (this.matchIndex + 1) + '/' + this.matches.length;
        this.resultsEl.querySelectorAll('.pdfre-result').forEach(function (b) {
            b.classList.toggle('is-active', parseInt(b.getAttribute('data-i'), 10) === this.matchIndex);
        }, this);

        this.goTo(m.page);
        this.clearHighlights();
        if (this.rendered[m.page]) this.paintHighlights();
        else this.pendingHighlight = m.page;
    };

    Reader.prototype.paintHighlights = function () {
        var self = this;
        var m = this.matches[this.matchIndex];
        if (!m || this.rotation !== 0) return;

        var idx = this.textIndex[m.page];
        if (!idx) return;

        this.pdf.getPage(m.page).then(function (page) {
            if (self.destroyed) return;
            var vp = page.getViewport({ scale: self.scale, rotation: page.rotate });
            var pe = self.pageEls[m.page];
            if (!pe) return;

            var lib = global.pdfjsLib;
            idx.map.forEach(function (entry) {
                if (entry.start + entry.len <= m.start || entry.start >= m.end) return;
                try {
                    var tx = lib.Util.transform(vp.transform, entry.item.transform);
                    var fh = Math.hypot(tx[2], tx[3]) || Math.abs(tx[3]) || 10;
                    var w = (entry.item.width || 0) * self.scale;
                    var hl = document.createElement('span');
                    hl.className = 'pdfre-hl is-current';
                    hl.style.left = Math.round(tx[4]) + 'px';
                    hl.style.top = Math.round(tx[5] - fh) + 'px';
                    hl.style.width = Math.max(4, Math.round(w)) + 'px';
                    hl.style.height = Math.round(fh * 1.18) + 'px';
                    pe.appendChild(hl);
                } catch (e) { /* geometry unavailable — page jump still works */ }
            });
        }).catch(function () { });
    };

    Reader.prototype.clearHighlights = function () {
        if (this.mode === 'html') return this.clearHtmlMarks();
        var list = this.root.querySelectorAll('.pdfre-hl');
        for (var i = 0; i < list.length; i++) list[i].parentNode.removeChild(list[i]);
    };

    /* ---------- pinch zoom ---------- */
    Reader.prototype.installPinch = function () {
        var self = this, startDist = 0, startScale = 1, pinching = false;

        function dist(t) {
            var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
            return Math.hypot(dx, dy);
        }

        this.scrollEl.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 2) return;
            pinching = true;
            startDist = dist(e.touches);
            startScale = self.scale;
        }, { passive: true });

        this.scrollEl.addEventListener('touchmove', function (e) {
            if (!pinching || e.touches.length !== 2) return;
            e.preventDefault();
            var f = dist(e.touches) / (startDist || 1);
            self.fitMode = null;
            self.scale = clamp(startScale * f, self.opts.minZoom, self.opts.maxZoom);
            for (var i = 1; i <= self.numPages; i++) {
                var d = self.dims[i];
                if (!d) continue;
                var pe = self.pageEls[i];
                pe.style.width = Math.round((self.swapped() ? d.h : d.w) * self.scale) + 'px';
                pe.style.height = Math.round((self.swapped() ? d.w : d.h) * self.scale) + 'px';
            }
            self.zoomVal.textContent = Math.round(self.scale * 100) + '%';
        }, { passive: false });

        this.scrollEl.addEventListener('touchend', function () {
            if (!pinching) return;
            pinching = false;
            self.unrenderAll();
            self.updateVisible();
            self.setFitIcon();
        });

        // Ctrl + wheel zoom (trackpad pinch on desktop)
        this.scrollEl.addEventListener('wheel', function (e) {
            if (!e.ctrlKey) return;
            e.preventDefault();
            self.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
        }, { passive: false });
    };

    /* ---------- paranoid mode ---------- */
    Reader.prototype.installParanoid = function () {
        var self = this;
        var wasOpen = false;
        this._paranoidTimer = setInterval(function () {
            if (self.destroyed) return;
            var open = (global.outerWidth - global.innerWidth > 170) ||
                (global.outerHeight - global.innerHeight > 190);
            if (open === wasOpen) return;
            wasOpen = open;
            self.shell.style.visibility = open ? 'hidden' : '';
            if (open) self.toast('Viewer paused while developer tools are open.');
        }, 900);
    };

    /* ---------- ui bits ---------- */
    Reader.prototype.setProgress = function (frac, text) {
        if (frac < 0) {
            this.barFill.style.width = '35%';
        } else {
            this.barFill.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
        }
        if (text) this.loaderText.textContent = text;
    };

    Reader.prototype.fail = function (msg, code) {
        this.loaderEl.classList.add('is-hidden');
        this.errorEl.classList.add('is-shown');
        this.errorEl.querySelector('.pdfre-error-msg').textContent = msg || '';
        this.errorEl.querySelector('.pdfre-error-code').textContent = code || '';
    };

    Reader.prototype.hideError = function () {
        this.errorEl.classList.remove('is-shown');
    };

    Reader.prototype.toast = function (msg) {
        var self = this;
        this.toastEl.textContent = msg;
        this.toastEl.classList.add('is-shown');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () {
            self.toastEl.classList.remove('is-shown');
        }, 2200);
    };

    /* ---------- public instance API ---------- */
    Reader.prototype.getState = function () {
        return {
            mode: this.mode,
            page: this.current,
            pages: this.numPages,
            zoom: Math.round(this.scale * 100) / 100,
            fitMode: this.fitMode,
            rotation: this.rotation,
            fullscreen: this.isFs
        };
    };

    Reader.prototype.destroy = function () {
        if (this.destroyed) return;
        this.destroyed = true;

        clearTimeout(this._idleTimer);
        clearTimeout(this._toastTimer);
        clearTimeout(this._resizeT);
        clearInterval(this._paranoidTimer);
        if (this._raf) cancelAnimationFrame(this._raf);

        global.removeEventListener('resize', this.onResize);
        document.removeEventListener('fullscreenchange', this.onFsChange);
        document.removeEventListener('webkitfullscreenchange', this.onFsChange);
        if (this.ro) this.ro.disconnect();
        if (this.thumbObserver) this.thumbObserver.disconnect();

        this.unrenderAll();
        if (this.pdf) { try { this.pdf.destroy(); } catch (e) { } }
        this.pdf = null;

        if (this.frame && this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
        this.frame = null;
        this.idoc = null;
        this.iwin = null;
        this.sections = [];

        if (this.opts.protect) Guards.remove(this);
        if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);

        var i = Registry.indexOf(this);
        if (i > -1) Registry.splice(i, 1);
    };

    /* ==========================================================
       6b. HTML NOTES MODE
       ----------------------------------------------------------
       An HTML notes file is mounted inside a sandboxed iframe via
       srcdoc — the markup goes in, the address does not, and the
       notes file's own scripts never run. The parent keeps script
       access (allow-same-origin) so navigation, zoom, search and
       the auto-hiding controls all still work.
       ========================================================== */

    var DEFAULT_SECTION_SEL =
        '#book > section, .sheet > section, main > section, article > section, ' +
        'body > section, .pdfre-part > section';

    var HTML_RESET =
        'html,body{height:auto !important;min-height:0 !important;max-height:none !important;' +
        'overflow-x:hidden !important}' +
        'body{margin:0 !important;padding:66px 0 96px 0 !important;' +
        '-webkit-user-select:none;-moz-user-select:none;user-select:none;' +
        '-webkit-touch-callout:none}' +
        '#app,#canvas,#viewer,#page,.viewport,.wrapper{display:block !important;' +
        'height:auto !important;max-height:none !important;overflow:visible !important}' +
        'img,svg,canvas,figure{-webkit-user-drag:none;user-drag:none}' +
        '::selection{background:transparent}' +
        'html.pdfre-idle{cursor:none}' +
        'html.pdfre-narrow .sheet{width:auto !important;max-width:none !important;' +
        'margin:0 !important;padding:20px 15px !important;box-shadow:none !important}' +
        'html.pdfre-narrow #canvas{padding:0 !important;background:none !important}' +
        'html.pdfre-narrow body>*{max-width:100% !important}' +
        'mark.pdfre-mark{background:rgba(251,188,5,.55);color:inherit;padding:0;border-radius:2px}' +
        'mark.pdfre-mark.is-current{background:rgba(255,112,67,.7);box-shadow:0 0 0 2px rgba(255,112,67,.35)}' +
        '.pdfre-wm{position:fixed;inset:0;pointer-events:none;z-index:2147483000;' +
        'background-repeat:repeat;background-position:center}' +
        '.pdfre-part-head{margin:0;padding:38px 0 26px;text-align:center;' +
        'font:600 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;' +
        'color:#8a7a5a;border-top:1px solid rgba(0,0,0,.12)}' +
        '@media print{html,body{display:none !important}}';

    /* Strip anything executable, keep the author's styling. */
    function parseNotes(html) {
        var doc;
        try {
            doc = new DOMParser().parseFromString(html, 'text/html');
        } catch (e) {
            return { title: '', head: '', body: html };
        }

        var kill = doc.querySelectorAll('script,noscript,iframe,object,embed,applet,form,base,meta[http-equiv]');
        for (var i = kill.length - 1; i >= 0; i--) {
            if (kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]);
        }

        var all = doc.querySelectorAll('*');
        for (var n = 0; n < all.length; n++) {
            var attrs = all[n].attributes;
            for (var a = attrs.length - 1; a >= 0; a--) {
                var name = attrs[a].name.toLowerCase();
                var val = attrs[a].value || '';
                if (name.indexOf('on') === 0 || /^\s*javascript:/i.test(val)) {
                    all[n].removeAttribute(attrs[a].name);
                }
            }
        }

        var head = [];
        var styles = doc.head ? doc.head.querySelectorAll('style') : [];
        for (var s = 0; s < styles.length; s++) head.push(styles[s].outerHTML);

        var links = doc.head
            ? doc.head.querySelectorAll('link[rel="stylesheet"],link[rel="preconnect"],link[rel="dns-prefetch"]')
            : [];
        for (var l = 0; l < links.length; l++) head.push(links[l].outerHTML);

        return {
            title: (doc.title || '').trim(),
            head: head.join('\n'),
            body: doc.body ? doc.body.innerHTML : html
        };
    }

    function watermarkCss(text, opacity) {
        if (!text) return '';
        var svgWm = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210">' +
            '<text x="160" y="105" text-anchor="middle" font-family="sans-serif" font-size="21" ' +
            'font-weight="600" fill="#000" fill-opacity="' + (opacity || 0.1) + '" ' +
            'transform="rotate(-28 160 105)">' +
            String(text).replace(/[<>&"]/g, '') + '</text></svg>';
        return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svgWm) + '")';
    }

    Reader.prototype.openHtml = function (text) {
        return this.mountHtml([{ title: '', html: text }]);
    };

    /* A JSON contents file listing one or more HTML notes files. */
    Reader.prototype.openManifest = function (text, base) {
        var self = this, o = this.opts;
        var data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Invalid JSON in the contents file: ' + e.message);
        }

        var list = data.documents || data.parts || data.notes || data.files ||
            (Array.isArray(data) ? data : null);
        if (!list || !list.length) {
            throw new Error('The contents file has no "documents" array.');
        }

        if (data.title) {
            o.title = data.title;
            this.root.querySelector('.pdfre-title').textContent = data.title;
        }
        if (data.subtitle) {
            o.subtitle = data.subtitle;
            this.root.querySelector('.pdfre-subtitle').textContent = data.subtitle;
        }

        var resolve = function (u) {
            var abs = u;
            try { if (base) abs = new URL(u, base).href; } catch (e) { }
            if (!o.proxyUrl) return abs;
            return o.proxyUrl.indexOf('{src}') > -1
                ? o.proxyUrl.replace('{src}', encodeURIComponent(abs))
                : o.proxyUrl + (o.proxyUrl.indexOf('?') > -1 ? '&' : '?') + 'src=' + encodeURIComponent(abs);
        };

        var parts = [], missed = [], i = 0;

        return (function step() {
            if (i >= list.length || self.destroyed) return Promise.resolve();
            var entry = list[i++];
            var url = typeof entry === 'string'
                ? entry
                : (entry.url || entry.src || entry.htmlUrl || entry.jsonUrl || '');
            var title = (typeof entry === 'object' && entry.title) ? entry.title : '';

            self.setProgress(i / list.length, 'Loading ' + i + ' of ' + list.length + '…');

            if (!url) return step();

            return fetchBytes(resolve(url), o, null).then(function (bytes) {
                parts.push({ title: title, html: decodeText(normalizeBytes(bytes)) });
            }).catch(function (err) {
                missed.push((title || url) + ' — ' + ((err && err.message) || 'unavailable'));
            }).then(step);
        })().then(function () {
            if (self.destroyed) return;
            if (!parts.length) {
                throw new Error('None of the listed documents could be loaded. ' + missed.join('; '));
            }
            return self.mountHtml(parts, parts.length > 1).then(function () {
                if (missed.length) {
                    self.toast(missed.length + ' part' + (missed.length > 1 ? 's' : '') +
                        ' could not be loaded.');
                }
            });
        });
    };

    Reader.prototype.mountHtml = function (parts, showPartHeads) {
        var self = this, o = this.opts;

        this.mode = 'html';
        this.shell.classList.add('is-html');
        this.root.querySelector('.pdfre-b-rot').style.display = 'none';
        var thumbBtn = this.root.querySelector('.pdfre-b-thumbs');
        thumbBtn.innerHTML = svg('outline');
        thumbBtn.setAttribute('data-tip', 'Contents');

        this.pageInput.setAttribute('aria-label', 'Section number');
        this.root.querySelector('.pdfre-b-prev').setAttribute('data-tip', 'Previous section');
        this.root.querySelector('.pdfre-b-next').setAttribute('data-tip', 'Next section');
        this.searchInput.setAttribute('placeholder', 'Search in notes');

        var heads = [], seenHead = {}, bodies = [];

        for (var i = 0; i < parts.length; i++) {
            var parsed = parseNotes(parts[i].html);

            if (parsed.head && !seenHead[parsed.head]) {
                seenHead[parsed.head] = 1;
                heads.push(parsed.head);
            }
            if (showPartHeads && parts[i].title) {
                bodies.push('<p class="pdfre-part-head">' +
                    String(parts[i].title).replace(/[<>&]/g, '') + '</p>');
            }
            bodies.push('<div class="pdfre-part">' + parsed.body + '</div>');

            if (i === 0 && parsed.title && (!o.title || o.title === 'Document')) {
                this.root.querySelector('.pdfre-title').textContent = parsed.title;
            }
        }

        var wm = watermarkCss(o.watermark, o.watermarkOpacity);
        var wmDiv = wm ? '<div class="pdfre-wm" style="background-image:' + wm + '"></div>' : '';

        var srcdoc =
            '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            heads.join('\n') +
            '<style>' + HTML_RESET + '</style>' +
            '</head><body>' + bodies.join('\n') + wmDiv + '</body></html>';

        var frame = document.createElement('iframe');
        frame.className = 'pdfre-frame';
        frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('title', o.title || 'Document');
        frame.setAttribute('aria-label', o.title || 'Document');

        this.frameWrap.innerHTML = '';
        this.frameWrap.appendChild(frame);
        this.frame = frame;

        return new Promise(function (resolve) {
            var settled = false;

            function done() {
                if (settled || self.destroyed) return;
                settled = true;
                self.initFrame();
                resolve();
            }

            frame.addEventListener('load', function () {
                if (frameHasContent()) done();
            });

            function frameHasContent() {
                try {
                    var d = frame.contentDocument;
                    return !!(d && d.body && d.body.children.length);
                } catch (e) { return false; }
            }

            frame.srcdoc = srcdoc;

            /* Poll for the frame's DOM rather than waiting on `load`, which
               also waits for webfonts and images. If srcdoc did not take
               after a couple of seconds, write the document in directly. */
            var tries = 0;
            (function poll() {
                if (settled || self.destroyed) return;
                if (frameHasContent()) return done();

                if (++tries === 60) {
                    try {
                        var d = frame.contentDocument;
                        d.open();
                        d.write(srcdoc);
                        d.close();
                    } catch (e) { /* fall through to the timeout below */ }
                }
                if (tries < 120) setTimeout(poll, 25);
                else done();
            })();
        });
    };

    Reader.prototype.initFrame = function () {
        var self = this, o = this.opts;

        try {
            this.idoc = this.frame.contentDocument;
            this.iwin = this.frame.contentWindow;
        } catch (e) {
            this.fail('The notes could not be displayed.', e.message);
            return;
        }
        if (!this.idoc) {
            this.fail('The notes could not be displayed.', 'Frame document unavailable.');
            return;
        }

        /* sections become "pages" for the dock and the contents list */
        var sel = o.sectionSelector || DEFAULT_SECTION_SEL;
        var nodes = this.idoc.querySelectorAll(sel);
        if (!nodes.length) nodes = this.idoc.querySelectorAll('h1, h2');
        if (!nodes.length && this.idoc.body) nodes = [this.idoc.body.firstElementChild].filter(Boolean);

        this.sections = Array.prototype.slice.call(nodes);
        this.numPages = Math.max(1, this.sections.length);
        this.pageTotal.textContent = this.numPages;
        this.pageInput.max = this.numPages;

        /* natural content width, measured before any zoom is applied */
        var probe = this.idoc.querySelector('.sheet, #book, .pdfre-part > *') || this.idoc.body;
        this.htmlNaturalWidth = (probe && probe.offsetWidth) || 794;

        /* forward activity and input from inside the frame */
        var pass = { passive: true };
        ['mousemove', 'mousedown', 'touchstart', 'wheel', 'keydown'].forEach(function (ev) {
            self.idoc.addEventListener(ev, function () { self.poke(); }, pass);
        });
        this.idoc.addEventListener('keydown', function (e) { self.handleKey(e); });
        this.iwin.addEventListener('scroll', function () {
            if (self._raf) return;
            self._raf = requestAnimationFrame(function () {
                self._raf = null;
                self.htmlUpdateVisible();
            });
        }, pass);

        if (o.protect) {
            this.idoc.addEventListener('contextmenu', prevent);
            ['copy', 'cut', 'dragstart', 'selectstart'].forEach(function (ev) {
                self.idoc.addEventListener(ev, prevent);
            });
            this.idoc.addEventListener('keydown', Guards.onKey, true);
        }

        this.htmlRelayout();

        var start = clamp(parseInt(o.page, 10) || 1, 1, this.numPages);
        if (start > 1) this.htmlGoTo(start, true);

        this.htmlUpdateVisible();
        this.loaderEl.classList.add('is-hidden');
        this.poke();
        if (o.thumbnails) this.buildOutline();

        if (typeof o.onReady === 'function') {
            o.onReady({ mode: 'html', pages: this.numPages, sections: this.numPages });
        }
    };

    Reader.prototype.htmlRelayout = function () {
        if (!this.idoc || !this.iwin) return;

        var availW = this.frameWrap.clientWidth || this.shell.clientWidth;
        var narrow = availW < 720;
        this.idoc.documentElement.classList.toggle('pdfre-narrow', narrow);

        var z;
        if (this.fitMode === 'fit-width' || this.fitMode === 'fit-page') {
            z = narrow ? 1 : (availW - 40) / (this.htmlNaturalWidth || 794);
        } else {
            z = this.scale;
        }
        z = clamp(z, this.opts.minZoom, this.opts.maxZoom);
        this.scale = z;

        this.idoc.body.style.zoom = z;
        this.zoomVal.textContent = Math.round(z * 100) + '%';
    };

    Reader.prototype.htmlGoTo = function (n, instant) {
        if (!this.iwin || !this.sections.length) return;
        n = clamp(parseInt(n, 10) || 1, 1, this.numPages);
        var target = this.sections[n - 1];
        if (!target) return;

        var top = target.getBoundingClientRect().top + this.iwin.scrollY - 62;
        this.iwin.scrollTo({ top: Math.max(0, top), behavior: instant ? 'auto' : 'smooth' });
        this.pageInput.value = n;
    };

    Reader.prototype.htmlUpdateVisible = function () {
        if (!this.iwin || !this.sections.length || this.destroyed) return;

        var mark = 96, best = 1;
        for (var i = 0; i < this.sections.length; i++) {
            if (this.sections[i].getBoundingClientRect().top <= mark) best = i + 1;
            else break;
        }

        if (best !== this.current) {
            this.current = best;
            if (document.activeElement !== this.pageInput) this.pageInput.value = best;
            this.markThumb(best);
            if (typeof this.opts.onPageChange === 'function') this.opts.onPageChange(best);
        }
    };

    Reader.prototype.sectionLabel = function (el, i) {
        var t = el.querySelector
            ? el.querySelector('.ch-title, .cv-title, .dv-title, h1, h2, h3')
            : null;
        var name = t ? t.textContent : (el.textContent || '');
        name = name.replace(/\s+/g, ' ').trim();
        if (!name) name = 'Section ' + i;

        var k = el.querySelector
            ? el.querySelector('.ch-kicker, .cv-eyebrow, .dv-badge, .pill, .num')
            : null;
        var kicker = k ? k.textContent.replace(/\s+/g, ' ').trim() : '';
        if (kicker === name) kicker = '';

        return { name: name.slice(0, 110), kicker: kicker.slice(0, 34) };
    };

    Reader.prototype.buildOutline = function () {
        var self = this;
        var frag = document.createDocumentFragment();
        this.thumbEls = new Array(this.numPages + 1);

        for (var i = 1; i <= this.numPages; i++) {
            var info = this.sectionLabel(this.sections[i - 1], i);
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'pdfre-out';
            b.setAttribute('data-page', i);
            b.innerHTML =
                (info.kicker ? '<span class="pdfre-out-k">' + escapeHtml(info.kicker) + '</span>' : '') +
                '<span class="pdfre-out-t">' + escapeHtml(info.name) + '</span>';
            b.addEventListener('click', (function (n) {
                return function () { self.goTo(n); };
            })(i));
            this.thumbEls[i] = b;
            frag.appendChild(b);
        }

        this.sidebarEl.classList.add('is-outline');
        this.sidebarEl.innerHTML = '';
        this.sidebarEl.appendChild(frag);
        this.markThumb(this.current);
    };

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ---------- search inside HTML notes ---------- */
    Reader.prototype.htmlSearch = function (term) {
        var self = this;
        this.clearHtmlMarks();
        this.matches = [];
        this.matchIndex = -1;

        if (!this.idoc) return;
        if (term.length < 2) {
            this.searchCount.textContent = '';
            this.resultsEl.innerHTML = '<div class="pdfre-empty">Type at least two characters.</div>';
            return;
        }

        var needle = term.toLowerCase();
        var body = this.idoc.body;
        var walker = this.idoc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                var p = node.parentNode;
                if (!p) return NodeFilter.FILTER_REJECT;
                var tag = (p.nodeName || '').toLowerCase();
                if (tag === 'script' || tag === 'style' || tag === 'mark') return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        var targets = [], node;
        while ((node = walker.nextNode())) {
            if (node.nodeValue.toLowerCase().indexOf(needle) > -1) targets.push(node);
            if (targets.length > 600) break;
        }

        var snippets = [];
        for (var t = 0; t < targets.length; t++) {
            var text = targets[t].nodeValue;
            var lower = text.toLowerCase();
            var rest = targets[t];
            var consumed = 0;
            var at;

            while ((at = lower.indexOf(needle, consumed)) > -1) {
                var local = at - consumed;
                var after = rest.splitText(local);
                var tail = after.splitText(needle.length);
                var mk = this.idoc.createElement('mark');
                mk.className = 'pdfre-mark';
                mk.appendChild(this.idoc.createTextNode(after.nodeValue));
                after.parentNode.replaceChild(mk, after);

                this.matches.push(mk);
                snippets.push({
                    pre: text.slice(Math.max(0, at - 34), at),
                    hit: text.substr(at, needle.length),
                    post: text.slice(at + needle.length, at + needle.length + 46),
                    page: this.sectionOf(mk)
                });

                rest = tail;
                consumed = at + needle.length;
                if (this.matches.length > 800) break;
            }
            if (this.matches.length > 800) break;
        }

        this.renderHtmlResults(term, snippets);
        if (this.matches.length) this.stepMatch(1);
    };

    Reader.prototype.sectionOf = function (node) {
        for (var i = this.sections.length - 1; i >= 0; i--) {
            if (this.sections[i].contains && this.sections[i].contains(node)) return i + 1;
        }
        var top = node.getBoundingClientRect ? node.getBoundingClientRect().top : 0;
        for (var j = this.sections.length - 1; j >= 0; j--) {
            if (this.sections[j].getBoundingClientRect().top <= top) return j + 1;
        }
        return 1;
    };

    Reader.prototype.renderHtmlResults = function (term, snippets) {
        var self = this;
        this.searchCount.textContent = this.matches.length ? String(this.matches.length) : '0';

        if (!this.matches.length) {
            this.resultsEl.innerHTML = '<div class="pdfre-empty">No results for “' +
                escapeHtml(term) + '”.</div>';
            return;
        }

        var html = '', shown = Math.min(snippets.length, 120);
        for (var i = 0; i < shown; i++) {
            var s = snippets[i];
            html += '<button type="button" class="pdfre-result" data-i="' + i + '">' +
                '<span class="pdfre-result-pg">Section ' + s.page + '</span>…' +
                escapeHtml(s.pre) + '<b>' + escapeHtml(s.hit) + '</b>' + escapeHtml(s.post) + '…</button>';
        }
        this.resultsEl.innerHTML = html;

        this.resultsEl.querySelectorAll('.pdfre-result').forEach(function (btn) {
            btn.addEventListener('click', function () {
                self.matchIndex = parseInt(btn.getAttribute('data-i'), 10);
                self.showMatch();
            });
        });
    };

    Reader.prototype.showHtmlMatch = function () {
        var mk = this.matches[this.matchIndex];
        if (!mk) return;

        this.searchCount.textContent = (this.matchIndex + 1) + '/' + this.matches.length;
        for (var i = 0; i < this.matches.length; i++) {
            this.matches[i].classList.toggle('is-current', i === this.matchIndex);
        }
        this.resultsEl.querySelectorAll('.pdfre-result').forEach(function (b) {
            b.classList.toggle('is-active', parseInt(b.getAttribute('data-i'), 10) === this.matchIndex);
        }, this);

        var top = mk.getBoundingClientRect().top + this.iwin.scrollY - this.iwin.innerHeight / 3;
        this.iwin.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        this.htmlUpdateVisible();
    };

    Reader.prototype.clearHtmlMarks = function () {
        if (!this.idoc) return;
        var marks = this.idoc.querySelectorAll('mark.pdfre-mark');
        for (var i = 0; i < marks.length; i++) {
            var m = marks[i], p = m.parentNode;
            if (!p) continue;
            p.replaceChild(this.idoc.createTextNode(m.textContent), m);
            p.normalize();
        }
        this.matches = [];
        this.matchIndex = -1;
    };

    /* ==========================================================
       7. PUBLIC ENTRY POINTS
       ========================================================== */
    var Registry = [];

    function initPdfReader(containerId, options) {
        var container = typeof containerId === 'string'
            ? document.getElementById(containerId)
            : containerId;

        if (!container) {
            console.error('[pdfre] Container not found: ' + containerId);
            return null;
        }

        var r = new Reader(container, options || {});
        Registry.push(r);
        return r;
    }

    function autoInit() {
        var nodes = document.querySelectorAll('[data-pdfre]:not([data-pdfre-mounted])');
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            n.setAttribute('data-pdfre-mounted', '1');

            var d = n.dataset;
            var opts = {
                src: d.pdfreSrc || d.pdfreHtml || d.pdfreJson || '',
                srcType: d.pdfreType || 'auto',
                sectionSelector: d.pdfreSections || '',
                srcEnc: d.pdfreEnc || '',
                key: d.pdfreKey || '',
                proxyUrl: d.pdfreProxy || '',
                title: d.pdfreTitle || 'Document',
                subtitle: d.pdfreSubtitle || '',
                theme: d.pdfreTheme || 'dark',
                height: d.pdfreHeight || 720,
                page: parseInt(d.pdfrePage, 10) || 1,
                zoom: d.pdfreZoom || 'fit-width',
                autohide: d.pdfreAutohide || 'always',
                watermark: d.pdfreWatermark || '',
                thumbnails: d.pdfreThumbnails !== 'false',
                search: d.pdfreSearch !== 'false',
                startFullscreen: d.pdfreFullscreen === 'true'
            };
            if (d.pdfreHosts) opts.allowedHosts = d.pdfreHosts.split(',');
            initPdfReader(n, opts);
        }
    }

    global.initPdfReader = initPdfReader;
    global.PDFRE = {
        version: VERSION,
        init: initPdfReader,
        autoInit: autoInit,
        encodeSrc: encodeSrc,
        instances: Registry,
        destroyAll: function () {
            Registry.slice().forEach(function (r) { r.destroy(); });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }

})(typeof window !== 'undefined' ? window : this);
