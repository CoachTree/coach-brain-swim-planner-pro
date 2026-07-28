# Coach Brain Swim Planner Pro

Local-first swim workout and season planning software for coaches.

The product is designed for low-budget sale and delivery: it runs as a static
React app, keeps coach data in the browser, exports PDFs, creates shareable
session links, and needs no paid AI API, database, or custom backend for the
core product.

## What Is Included

- Session builder for age, level, stroke, goal, distance, intensity, season
  role, pool course, equipment, sprint finisher, and optional pace target.
- Rule-based Coach Brain generator for pool-ready session structure.
- Season planner for 1-24 week build, intensive, race-specific, taper, and
  race-week cycles.
- Coach Library with favourites, test sets, result history, and session journal.
- Coach Library backup and restore via JSON export/import.
- PDF export, plain-text copy, and URL-hash share links.
- Meter and yard modes.
- Community MVP: evidence cards, structured local replications, useful votes,
  and an AI Debate framework focused on reproducibility rather than authority.
- Static hosting support through `frontend/build`.

## Low-Budget Business Model

The simplest first version is a one-time license or annual access sold through
your chosen checkout/file-delivery service.

Recommended launch shape:

1. Build the app with your brand name and screenshots.
2. Host the demo/public app as a static site.
3. Sell access as a downloadable source/build package or a private hosted link.
4. Offer support by email or a private community before building accounts.
5. Add accounts and cloud sync only after real customers ask for it.

This avoids monthly AI, database, and authentication costs while still giving
coaches a useful product.

## Project Layout

```text
frontend/              React app to run, build, and deploy
frontend/src/          Product code
frontend/public/       Static hosting metadata and SPA redirects
frontend/build/        Production build output after `npm run build`
```

## Run Locally

Use Node.js 20 or newer.

```bash
cd frontend
npm install
npm start
```

Open `http://localhost:3000`.

## Build For Production

```bash
cd frontend
npm install
npm run build
```

Upload the contents of `frontend/build/` to a static host. The app includes
`frontend/public/_redirects`, so React Router routes such as `/s` work on hosts
that support Netlify-style SPA redirects.

## Environment Variables

No environment variables are required for the production frontend. The app does
not need an AI key, database URL, or API server.

## Community MVP

The Community tab is intentionally local-first in this package: contributions
remain in the current browser and demo evidence is seeded. A global community
requires consent, identity, moderation, privacy, and evidence provenance before
it should accept live data. See `COMMUNITY_MVP_JA.md` for the Japanese product
and implementation notes.

## Delivery Checklist

- Replace any remaining placeholder brand or support email text.
- Build with `npm run build`.
- Test session generation, PDF export, copy, share link, favourites, library
  export/import, and season planning.
- Upload `frontend/build/` to your host.
- Prepare screenshots, short demo video, refund policy, support terms, and a
  clear license statement for customers.

## License

This repository is prepared as a commercial product package. Add your final
customer license terms before sale. A lightweight template is included in
`COMMERCIAL_LICENSE_TEMPLATE.md`.
