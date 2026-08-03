/**
 * PDF Reader Engine — Google Apps Script proxy
 * ---------------------------------------------------------------
 * Serves PDFs that live in your Google Drive without exposing the file
 * ID or the Drive link. Apps Script can only return text, so the file
 * goes out base64-encoded — the reader detects that and decodes it.
 *
 * Setup:
 *   1. script.google.com → New project → paste this file
 *   2. Fill in DOCS below with your slugs and Drive file IDs
 *   3. Deploy → New deployment → Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   4. Copy the /exec URL and point the reader at it:
 *        proxyUrl: 'https://script.google.com/macros/s/XXXX/exec?d=chapter-1'
 *      leaving `src` and `srcEnc` empty.
 *
 * Note on size: Apps Script responses are capped and base64 adds about
 * a third. Keep files under roughly 15 MB here — for anything larger,
 * use the Cloudflare Worker instead.
 */

/* Slug → Drive file ID. Keep the IDs here, never in your page. */
var DOCS = {
  'chapter-1': '1AbCdEfGhIjKlMnOpQrStUvWxYz_example',
  'chapter-2': '1ZyXwVuTsRqPoNmLkJiHgFeDcBa_example'
};

/* Blogs allowed to embed. Leave empty to allow any site. */
var ALLOWED_HOSTS = [
  'yourblog.blogspot.com',
  'www.yoursite.com'
];

function doGet(e) {
  var slug = (e && e.parameter && e.parameter.d) || '';
  var from = (e && e.parameter && e.parameter.h) || '';

  if (ALLOWED_HOSTS.length && from && ALLOWED_HOSTS.indexOf(from) === -1) {
    return text('Not available from that address.');
  }

  var id = DOCS[slug];
  if (!id) return text('Unknown document.');

  try {
    var blob = DriveApp.getFileById(id).getBlob();
    return ContentService
      .createTextOutput(Utilities.base64Encode(blob.getBytes()))
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return text('The document could not be read: ' + err);
  }
}

function text(msg) {
  return ContentService.createTextOutput(msg)
    .setMimeType(ContentService.MimeType.TEXT);
}
