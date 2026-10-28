/**
 * Rasterises the Bluu Rock lockup (public/logo/bluu_long.svg) into the PNG the
 * email template's masthead uses (public/email/wordmark.png).
 *
 * PNG, not SVG or WebP: Gmail drops SVG and Outlook drops WebP. Flattened onto
 * the email ground (#08090b) so the white-inked letters keep their own dark
 * plate even in a client that repaints the background. 3x the 140px display
 * width for retina.
 *
 *   cd src && node scripts/build-email-wordmark.js
 */
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '../public/logo/bluu_long.svg');
const OUT = path.join(__dirname, '../public/email/wordmark.png');

sharp(SRC, { density: 300 })
  .trim()
  .resize({ width: 420 })
  .flatten({ background: '#08090b' })
  .png({ compressionLevel: 9, palette: true })
  .toFile(OUT)
  .then((info) => console.log(`wrote ${OUT} (${info.width}x${info.height}, ${info.size} bytes)`));
