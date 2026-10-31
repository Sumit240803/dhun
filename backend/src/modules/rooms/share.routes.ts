// The page a shared room link lands on.
//
// A link shared to WhatsApp is opened by somebody who may not have the app.
// So {base}/r/{code} is a real page: who is live and what the room is called,
// one button that opens the app (the dhun:// scheme), one that goes to the
// store. Server-rendered through the same escaping tagged template as the
// admin panel — a room title is user text and lands in HTML here.
//
// No JavaScript on the page, and no API data beyond what the feed already
// shows anyone: a title, a host's name, a viewer count.

import { Router } from 'express';
import { z } from 'zod';
import { html } from '../../admin/html.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { getConfigValue } from '../economy/index.js';
import { getRoom, roomIdForCode } from './live.service.js';

const PAGE_CSS = `
  :root { color-scheme: light; }
  body { margin: 0; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #FFF9F2; color: #231A14; }
  main { max-width: 420px; margin: 0 auto; padding: 32px 20px 48px; text-align: center; }
  .brand { font-weight: 700; letter-spacing: .04em; color: #B3193D; margin-bottom: 28px; }
  .cover { width: 160px; height: 213px; object-fit: cover; border-radius: 20px; margin: 0 auto 20px;
           display: block; background: #F1E7DD; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .host { color: #6B5F57; margin: 0 0 4px; }
  .live { display: inline-block; font-size: 12px; font-weight: 700; color: #fff; background: #FF3B30;
          padding: 2px 10px; border-radius: 999px; margin-bottom: 28px; }
  .ended { display: inline-block; font-size: 12px; font-weight: 700; color: #6B5F57; background: #F1E7DD;
           padding: 2px 10px; border-radius: 999px; margin-bottom: 28px; }
  a.btn { display: block; padding: 14px 20px; border-radius: 14px; text-decoration: none; font-weight: 600;
          margin: 0 0 12px; }
  a.open { background: #FF4D6D; color: #fff; }
  a.store { background: #fff; color: #231A14; border: 1px solid #E6D9CC; }
  .small { color: #9A8E85; font-size: 13px; margin-top: 20px; }
`;

export function buildShareRouter(): Router {
  const router = Router();

  router.get('/style.css', (_req, res) => {
    res.type('css').setHeader('Cache-Control', 'public, max-age=3600').send(PAGE_CSS);
  });

  router.get(
    '/:code',
    // Anonymous and on the open internet; a scraper walking codes meets a ceiling.
    rateLimit({ scope: 'share:landing', limit: 120, windowMs: 600_000, by: 'ip' }),
    validate({
      params: z.object({ code: z.coerce.number().int().min(100_001).max(99_999_999) }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { code } = req.validatedParams as { code: number };
        const storeUrl = String((await getConfigValue('store_url_android')) ?? '');
        const roomId = await roomIdForCode(code);
        const detail = roomId ? await getRoom(roomId) : null;

        // Opens the app on the ROOM CODE, not the uuid: the app resolves it the
        // same way this page did, so a link outlives the room it was made for.
        const appLink = `dhun://r/${code}`;

        res
          .status(detail ? 200 : 404)
          .type('html')
          .setHeader('Cache-Control', 'no-store')
          .setHeader(
            'Content-Security-Policy',
            "default-src 'none'; style-src 'self'; img-src 'self' https:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
          )
          .send(
            `<!doctype html>` +
              html`<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${detail ? `${detail.room.hostName ?? 'A host'} is live on Dhun` : 'Dhun'}</title>
  <link rel="stylesheet" href="/r/style.css" />
</head>
<body>
  <main>
    <div class="brand">DHUN</div>
    ${detail
      ? html`${detail.room.coverUrl
            ? html`<img class="cover" src="${detail.room.coverUrl}" alt="" />`
            : html`<div class="cover"></div>`}
          <h1>${detail.room.title}</h1>
          <p class="host">${detail.room.hostName ?? '—'} · Room ${String(detail.room.publicId)}</p>
          <span class="live">LIVE</span>
          <a class="btn open" href="${appLink}">Open in Dhun</a>`
      : html`<h1>This room has ended</h1>
          <p class="host">Room ${String(code)} is not live right now.</p>
          <span class="ended">ENDED</span>
          <a class="btn open" href="dhun://">Open Dhun</a>`}
    ${storeUrl ? html`<a class="btn store" href="${storeUrl}">Get the app on Google Play</a>` : ''}
    <p class="small">Live rooms, music and friends. India first.</p>
  </main>
</body>
</html>`.value,
          );
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
