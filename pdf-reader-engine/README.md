# PDF Reader Engine v1

A secure, embeddable PDF viewer for Blogger, WordPress and plain HTML.
Host once on GitHub → serve anywhere via jsDelivr CDN.

Pages are rasterised to `<canvas>` with pdf.js, so the browser's own PDF
plugin — and its download and print buttons — never appear. There is no
`<iframe src>` and no `<embed>`, so the file address is not sitting in
your page markup.

```
pdf-reader-engine/
├── pdfre.css                    ← all styles (scoped to .pdfre-root)
├── pdfre.js                     ← the engine
├── embed-snippet.html           ← ready-to-paste code for any site
├── demo.html                    ← local test page
├── tools/
│   └── link-encoder.html        ← turn a PDF URL into a token + snippet
├── proxy/
│   ├── cloudflare-worker.js     ← hides the source address completely
│   └── google-apps-script.gs    ← same, for PDFs living in Google Drive
└── README.md
```

## What it does

- **Fullscreen with auto-hiding controls** — the top bar and the floating
  dock fade out after a couple of seconds of stillness and come back on
  any movement, the way Google Drive's preview behaves. Works with the
  native Fullscreen API and falls back to a fixed-position mode on iOS
  Safari, where the API is unavailable.
- **Continuous scroll** with page virtualisation — only nearby pages hold
  a canvas, so a 400-page file stays responsive.
- **Page thumbnails**, jump-to-page, zoom, fit-to-width / fit-to-page,
  90° rotation, pinch zoom, Ctrl+wheel zoom, full keyboard control.
- **Search** across the document with result snippets and highlighting.
- **No download button, no print button, no context menu, no text
  selection.** `Ctrl+P` and `Ctrl+S` are intercepted; a print attempt
  produces a notice instead of the document.
- **Domain lock** — refuse to render unless the page is on a host you
  listed.
- **Watermark** stamped into the canvas itself, so it survives a
  screenshot.
- Dark and light themes, responsive down to phones, multiple readers per
  page, no dependency other than pdf.js (fetched automatically).

## Quick start

**1. Push to GitHub and tag a release**

```bash
git init
git add .
git commit -m "v1.0.0 — initial CDN release"
git remote add origin https://github.com/YOUR-USER/pdf-reader-engine.git
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

**2. CDN URLs** (live about ten minutes after tagging)

```
https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.0.0/pdfre.css
https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.0.0/pdfre.js
```

> Always pin a version tag. Never use `@latest` in production.

**3. Head block — once per site**

Blogger: Theme → Edit HTML, just before `</head>`.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.0.0/pdfre.css">
<script defer src="https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.0.0/pdfre.js"></script>
```

**4. Reader block — once per post**

```html
<div data-pdfre
     data-pdfre-src="https://cdn.jsdelivr.net/gh/YOU/notes@v1/chapter-1.pdf"
     data-pdfre-title="Chapter 1 — Cell Biology"
     data-pdfre-height="720"></div>
```

That is the whole integration. `embed-snippet.html` has four more
methods, including the JavaScript API and proxy mode.

## Hiding the source address

Three modes, in order of how much the browser gets to see.

| Mode | Setting | Address visible in page source | Address visible in network panel |
|---|---|---|---|
| Plain | `src` | yes | yes |
| Token | `srcEnc` + `key` | no | yes |
| Proxy | `proxyUrl`, no `src` | no | no — only your proxy |

**Token mode.** Open `tools/link-encoder.html` in a browser, paste your
URL, and it hands back a token plus the finished embed block. Or from
the console on a page that has the engine loaded:

```js
PDFRE.encodeSrc('https://example.com/file.pdf', 'my-key')
// → "p1.k3m9xq.HxYxLzc..."
```

**Proxy mode.** Deploy `proxy/cloudflare-worker.js` (free tier is
plenty), list your documents in it, and point the reader at a slug:

```html
<div data-pdfre
     data-pdfre-proxy="https://your-worker.workers.dev/d/chapter-1"
     data-pdfre-title="Chapter 1"></div>
```

The real address stays on the server. The worker also checks the
`Origin` header, so copying the worker URL into another site gets a 403.

For PDFs in Google Drive, `proxy/google-apps-script.gs` does the same
job — it returns the file base64-encoded and the engine decodes it.

## What this does and does not protect

Worth being straight about this, because the difference matters.

**It reliably stops:** the download and print buttons of the native PDF
viewer, right-click → Save as, text selection and copying, drag-and-drop
of the page image, `Ctrl+P` / `Ctrl+S`, printing the page from the
browser menu, reading the file address out of View Source, and embedding
on domains you did not authorise.

**It does not stop a determined technical user.** Once a browser
displays a document, the bytes are on that machine — that is true of
every web viewer, including Google Drive's. With `src` or `srcEnc`, the
network panel still shows where the bytes came from, because the browser
has to fetch them from somewhere. Token mode raises the effort; it is
obfuscation, not encryption, and anyone who reads `pdfre.js` can reverse
it. Screenshots and screen recording are always possible.

**If the file genuinely must stay private, use proxy mode.** That is the
only configuration where the origin address never reaches the browser.
Pair it with signed, expiring URLs on your storage bucket and an
`Origin` check in the worker, and you have something an ordinary visitor
cannot get around. Add a watermark so that anything that does escape is
traceable.

Treat `paranoid: true` as a deterrent, not a control — it blanks the
viewer when the window geometry suggests devtools are open, which is a
heuristic and can misfire on unusual window setups.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `src` | `''` | Plain PDF URL |
| `srcEnc` | `''` | Obfuscated token from the link encoder |
| `key` | `''` | Key the token was encoded with |
| `proxyUrl` | `''` | Proxy endpoint; use alone for full privacy |
| `headers` | `null` | Extra request headers |
| `title` | `'Document'` | Heading in the top bar |
| `subtitle` | `''` | Small line beneath the heading |
| `height` | `720` | Number of px, or a CSS length like `'80vh'` |
| `theme` | `'dark'` | `dark` or `light` |
| `page` | `1` | Page to open on |
| `zoom` | `'fit-width'` | `fit-width`, `fit-page`, or a number |
| `minZoom` / `maxZoom` | `0.3` / `6` | Zoom limits |
| `autohide` | `'always'` | `always`, `fullscreen`, `never` |
| `autohideDelay` | `2600` | ms of stillness before controls fade |
| `thumbnails` | `true` | Page sidebar |
| `search` | `true` | Search panel |
| `rotate` | `true` | Rotate button |
| `showPageNumbers` | `true` | Badge on page hover |
| `startFullscreen` | `false` | Open fullscreen immediately |
| `allowedHosts` | `[]` | e.g. `['site.com', '*.blogspot.com']` |
| `watermark` | `''` | Text stamped into every page canvas |
| `watermarkOpacity` | `0.10` | 0–1 |
| `protect` | `true` | Context menu, copy, drag and shortcut guards |
| `blockPagePrint` | `true` | Printing yields a notice, not the document |
| `paranoid` | `false` | Blank the viewer while devtools look open |
| `renderBuffer` | `2` | Screens of pages kept rendered either side |
| `maxCanvasScale` | `2` | Device-pixel-ratio cap |
| `onReady` / `onPageChange` / `onError` | `null` | Callbacks |

## Instance API

```js
var reader = window.initPdfReader('my-container', { src: '…' });

reader.goTo(12);
reader.setZoom('fit-page');        // or 1.5
reader.rotate(90);
reader.toggleFullscreen(true);
reader.toggleSidebar();
reader.toggleSearch(true);
reader.getState();                 // { page, pages, zoom, rotation, fullscreen }
reader.destroy();
```

Globals: `PDFRE.encodeSrc`, `PDFRE.autoInit`, `PDFRE.instances`,
`PDFRE.destroyAll`, `PDFRE.version`.

## Keyboard

`↓ ↑ Space PgUp PgDn` scroll · `→ ←` page · `Home End` first/last ·
`+ −` zoom · `0` fit width · `F` fullscreen · `R` rotate ·
`Ctrl+F` search · `Esc` close search or exit fullscreen

## Hosting your PDFs

The file must be served over HTTPS **with CORS headers**, since the
engine fetches the bytes itself. These work out of the box:

- jsDelivr — `https://cdn.jsdelivr.net/gh/USER/REPO@TAG/file.pdf`
- `raw.githubusercontent.com`
- Cloudflare R2, Amazon S3, Backblaze B2 (with a CORS rule)
- Your own server, sending `Access-Control-Allow-Origin`

Google Drive share links do **not** work directly — Drive does not send
CORS headers for them. Use the Apps Script proxy instead.

jsDelivr caps files at 20 MB. For textbooks, either split by chapter or
serve from R2 through the worker.

## Troubleshooting

**"The file could not be fetched (CORS)"** — the host is not sending
`Access-Control-Allow-Origin`. Move the file to jsDelivr or put a proxy
in front of it.

**"This document is not licensed for display on this domain"** — the
current hostname is not in `allowedHosts`. Blogger custom domains and
`*.blogspot.com` are different hosts; list both.

**Blank viewer, no error** — check the browser console. Usually pdf.js
was blocked by a content-security policy; set `PDFRE_CONFIG.pdfjsLib` to
a copy you host yourself.

**Controls never hide** — `autohide` is `never`, or a control has focus.
They also stay put while the search panel is open, by design.

**Slow on very long documents** — lower `maxCanvasScale` to `1.5` and
`renderBuffer` to `1`.

## Updating the engine

1. Edit `pdfre.css` / `pdfre.js`
2. Commit and push a new tag (`v1.1.0`)
3. Update the version in your site's `<link>` and `<script>` URLs

Old tags stay available on jsDelivr forever, so existing embeds never
break.

## Compatibility

Chrome, Edge, Firefox, Safari 14+, and mobile equivalents. Confirmed on
Blogger, WordPress (Custom HTML block), and plain HTML pages.

## Licence

MIT — see `LICENSE`. pdf.js is Apache 2.0, © Mozilla.
