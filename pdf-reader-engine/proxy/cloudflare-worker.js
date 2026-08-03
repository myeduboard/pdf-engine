/**
 * PDF Reader Engine — Cloudflare Worker proxy
 * ---------------------------------------------------------------
 * This is the only way to make a PDF source genuinely non-inspectable.
 * The real file address lives here, on the server. The browser only ever
 * talks to your worker, so the network panel shows the worker URL and
 * nothing else.
 *
 * Deploy (free tier is plenty):
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *   2. Paste this file, edit DOCS and ALLOWED_ORIGINS below, Deploy
 *   3. Point the reader at it:
 *        proxyUrl: 'https://your-worker.workers.dev/d/chapter-1'
 *      and leave `src` / `srcEnc` empty.
 *
 * Requests to /d/<slug> that arrive without an allowed Origin or Referer
 * are refused, so the worker URL is not useful if someone copies it out.
 */

/* ── 1. Your documents. Slug on the left, real address on the right. ── */
const DOCS = {
  'chapter-1': 'https://your-private-bucket.r2.dev/chapter-1.pdf',
  'chapter-2': 'https://your-private-bucket.r2.dev/chapter-2.pdf',
  'syllabus':  'https://raw.githubusercontent.com/you/private-repo/main/syllabus.pdf'
};

/* ── 2. Sites allowed to embed. Exact hosts, or *. for subdomains. ── */
const ALLOWED_ORIGINS = [
  'https://yourblog.blogspot.com',
  'https://www.yoursite.com',
  '*.yoursite.com'
];

/* ── 3. Optional: extra headers sent to the origin (private buckets). ── */
const ORIGIN_HEADERS = {
  // 'Authorization': 'Bearer ...'
};

const CACHE_SECONDS = 3600;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const referer = request.headers.get('Referer') || '';
    const caller = originOf(origin || referer);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(caller) });
    }
    if (request.method !== 'GET') {
      return deny(405, 'Method not allowed', caller);
    }
    if (!isAllowed(caller)) {
      return deny(403, 'This document is not available from that address.', caller);
    }

    const slug = url.pathname.replace(/^\/d\//, '').replace(/\/+$/, '');
    const target = DOCS[slug];
    if (!target) {
      return deny(404, 'Unknown document.', caller);
    }

    const upstream = await fetch(target, {
      headers: { ...ORIGIN_HEADERS, Accept: 'application/pdf' },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });

    if (!upstream.ok) {
      return deny(502, 'The document could not be fetched from storage.', caller);
    }

    const headers = corsHeaders(caller);
    headers.set('Content-Type', 'application/pdf');
    headers.set('Content-Disposition', 'inline');
    headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    const len = upstream.headers.get('Content-Length');
    if (len) headers.set('Content-Length', len);

    return new Response(upstream.body, { status: 200, headers });
  }
};

/* ── helpers ────────────────────────────────────────────────────── */

function originOf(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

function isAllowed(caller) {
  if (!caller) return false;
  let host;
  try { host = new URL(caller).hostname.toLowerCase(); } catch { return false; }

  return ALLOWED_ORIGINS.some((entry) => {
    const e = entry.toLowerCase().trim();
    if (e === '*') return true;
    if (e.startsWith('*.')) {
      const bare = e.slice(2);
      return host === bare || host.endsWith('.' + bare);
    }
    try { return new URL(e).hostname.toLowerCase() === host; }
    catch { return e === host; }
  });
}

function corsHeaders(caller) {
  const h = new Headers();
  if (caller && isAllowed(caller)) {
    h.set('Access-Control-Allow-Origin', caller);
    h.set('Vary', 'Origin');
  }
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Range, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

function deny(status, message, caller) {
  const h = corsHeaders(caller);
  h.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response(message, { status, headers: h });
}
