# PDF Reader Engine v1.2.0

A secure, embeddable document viewer for Blogger, WordPress and plain
HTML. Host once on GitHub → serve anywhere via jsDelivr CDN.

It reads two kinds of source:

- **PDF** — pages are rasterised to `<canvas>` with pdf.js, so the
  browser's own PDF plugin, and its download and print buttons, never
  appear.
- **HTML notes** — a self-contained notes or book file is mounted in a
  sandboxed frame with its own styling intact, chaptered by section.

Either way there is no `<iframe src>` and no `<embed>` pointing at your
file, so the address is not sitting in your page markup.

```
pdf-reader-engine/
├── pdfre.css                    ← all styles (scoped to .pdfre-root)
├── pdfre.js                     ← the engine
├── embed-snippet.html           ← ready-to-paste code for any site
├── demo.html                    ← local test page
├── examples/
│   ├── contents.json            ← sample contents file for merged notes
│   ├── sample.pdf
│   └── veterinary-microbiology-part-1.html
├── tools/
│   ├── link-encoder.html        ← turn a PDF URL into a token + snippet
│   └── layout-check.html        ← measures HTML notes layout in a 390px frame
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
- **HTML notes as a source** — point it at a `.html` study-notes file and
  it renders inside a sandboxed frame: the notes file's own scripts never
  run, its styling is preserved, and a contents sidebar is built from the
  document's sections. A JSON contents file can merge several notes files
  into one continuous book.
- **Page thumbnails**, jump-to-page, zoom, fit-to-width / fit-to-page,
  90° rotation, pinch zoom, Ctrl+wheel zoom, full keyboard control.
- **Notes keep their authored layout** — a fixed page sheet is never
  reflowed to fit a phone. When it does not fit, the frame scrolls
  sideways and can be dragged to pan.
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
git commit -m "v1.2.0 — PDF and HTML notes"
git remote add origin https://github.com/YOUR-USER/pdf-reader-engine.git
git push -u origin main
git tag v1.2.0
git push origin v1.2.0
```

**2. CDN URLs** (live about ten minutes after tagging)

```
https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.2.0/pdfre.css
https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.2.0/pdfre.js
```

> Always pin a version tag. Never use `@latest` in production.

**3. Head block — once per site**

Blogger: Theme → Edit HTML, just before `</head>`.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.2.0/pdfre.css">
<script defer src="https://cdn.jsdelivr.net/gh/YOUR-USER/pdf-reader-engine@1.2.0/pdfre.js"></script>
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

## HTML notes instead of a PDF

Point `src` at an HTML file and the engine switches modes on its own —
it sniffs the bytes, so no extra setting is needed.

```html
<div data-pdfre
     data-pdfre-src="https://cdn.jsdelivr.net/gh/YOU/notes@v1/microbiology.html"
     data-pdfre-title="Veterinary Microbiology"
     data-pdfre-subtitle="ICAR eCourses · 20 chapters"
     data-pdfre-height="80vh"></div>
```

What happens to the file:

- It is parsed, then `<script>`, `<iframe>`, `<object>`, `<form>` and
  every `on*` handler are stripped. The `<style>` blocks and font links
  are kept, so the notes look exactly as authored.
- The result is mounted with `srcdoc` into an iframe sandboxed to
  `allow-same-origin allow-popups`. Nothing in the notes file can
  execute, and the address never appears as a frame `src`.
- Each top-level `<section>` becomes a "page": the dock counts them, the
  arrows step through them, and the sidebar becomes a contents list built
  from each section's heading and kicker. If a file has no sections, the
  engine falls back to `h1`/`h2` headings. Override with
  `sectionSelector` if your markup differs.
- The notes keep the width they were authored at. If that is wider than
  the frame — a 210mm sheet on a phone, or anything you have zoomed into
  — the frame scrolls sideways rather than reflowing the text. Drag to
  pan, or use the scrollbar, `Shift`+wheel, or `Shift`+`←`/`→`.
- Zoom scales the whole document. Fit-to-width will not shrink below
  `htmlFitMinZoom` (0.85 by default): an A4 sheet fitted into a 390px
  phone lands at 0.44×, which is 7px type, so the floor holds it at a
  readable size and lets the overflow scroll instead. Set it to `0` to
  always fit the full width, or `1` to never shrink.
- Set `htmlReflow: true` to restore the old behaviour, where a narrow
  screen released the fixed sheet width and let the text reflow.
- Search highlights matches in place with `<mark>` and lists them by
  section.
- Selection, copy, right-click and printing are blocked exactly as in PDF
  mode, and the watermark is tiled behind the text.

### Merging several notes files

Give it a JSON contents file instead and it stitches them into one
continuous document:

```json
{
  "title": "Veterinary Microbiology — Complete",
  "subtitle": "ICAR eCourses",
  "documents": [
    { "title": "Part 1 — General",    "url": "part-1.html" },
    { "title": "Part 2 — Systematic", "url": "part-2.html" }
  ]
}
```

```html
<div data-pdfre
     data-pdfre-json="https://cdn.jsdelivr.net/gh/YOU/notes@v1/contents.json"
     data-pdfre-height="80vh"></div>
```

Relative URLs resolve against the contents file. Duplicate stylesheets
are deduplicated, each part gets a divider heading, and the sections of
every part flow into one contents list. `title` and `subtitle` from the
contents file override the ones set on the element.

If auto-detection ever guesses wrong, force it with
`data-pdfre-type="html"`, `"pdf"` or `"manifest"`.

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
| `src` | `''` | Plain document URL — PDF, HTML notes or JSON contents |
| `htmlUrl` / `jsonUrl` | `''` | Aliases of `src`, for readability |
| `srcType` | `'auto'` | `auto`, `pdf`, `html`, `manifest` |
| `sectionSelector` | `''` | What counts as a page in HTML notes |
| `htmlReflow` | `false` | Let narrow screens reflow notes instead of scrolling sideways |
| `htmlFitMinZoom` | `0.85` | Fit-to-width will not shrink notes below this; `0` disables |
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

reader.goTo(12);                   // page, or section in HTML mode
reader.setZoom('fit-page');        // or 1.5
reader.rotate(90);                 // PDF mode only
reader.toggleFullscreen(true);
reader.toggleSidebar();
reader.toggleSearch(true);
reader.getState();                 // { mode, page, pages, zoom, rotation, fullscreen }
reader.destroy();
```

Globals: `PDFRE.encodeSrc`, `PDFRE.autoInit`, `PDFRE.instances`,
`PDFRE.destroyAll`, `PDFRE.version`.

## Keyboard

`↓ ↑ Space PgUp PgDn` scroll · `→ ←` page · `Shift`+`→ ←` pan sideways ·
`Home End` first/last ·
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

**HTML notes show one section only** — the file's top-level elements do
not match the default selector. Set `sectionSelector` to whatever wraps
each chapter, for example `'.chapter'` or `'#book > section'`.

**"That address returned a web page, not a notes file"** — the host sent
a sign-in wall, a 404 page, or a share-link landing page instead of the
file. Google Drive and Dropbox share links do this. Use a direct download
link, or route it through `proxy/cloudflare-worker.js`.

**Reading the error panel** — the small grey line under the message
carries the diagnostics: HTTP status, content type, size, and what the
engine decided the file was. `HTTP 200, text/html, 134 KB, read as html`
means the fetch worked and it was treated as notes; `Failed to fetch`
with nothing after it means the request never completed, which is almost
always CORS.

**HTML notes are cut off at the sides** — they are not; the frame
scrolls horizontally. Drag to pan, or use `Shift`+wheel. If you would
rather the text reflowed to the screen, set `htmlReflow: true`.

**Notes are too small on a phone** — raise `htmlFitMinZoom` (try `1`,
which never shrinks the sheet) and pan sideways, or set `htmlReflow:
true` to give up the fixed layout in exchange for full-width text.

**HTML notes look unstyled** — the styling lived in an external
stylesheet that is not reachable. Inline the CSS into a `<style>` block
in the notes file; self-contained files are what this mode expects.

## Updating the engine

1. Edit `pdfre.css` / `pdfre.js`
2. Commit and push a new tag (`v1.2.0`)
3. Update the version in your site's `<link>` and `<script>` URLs

Old tags stay available on jsDelivr forever, so existing embeds never
break.

## Compatibility

Chrome, Edge, Firefox, Safari 14+, and mobile equivalents. Confirmed on
Blogger, WordPress (Custom HTML block), and plain HTML pages.

## Licence

MIT — see `LICENSE`. pdf.js is Apache 2.0, © Mozilla.
