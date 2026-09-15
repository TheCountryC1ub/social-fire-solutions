# Social Fire Solutions — Website

One-page site. Single self-contained file: **`index.html`** (HTML + CSS + JS, no build step).

## Run it
Double-click `index.html` to open in any browser. Nothing to install.

## Before you go live
Open `index.html`, scroll to the `<script>` near the bottom, and set your booking link:

```js
const BOOKING_URL = "#book"; // → e.g. "https://calendly.com/socialfiresolutions/intro"
```

Every "Book a call" button (5 of them, incl. the sticky mobile bar) updates automatically.

## Deploy
Hosted on **Vercel** (auto-deploys from GitHub `main`). Works as static + one serverless function.

## AI Brain survey → GoHighLevel
- `/ai-brain-form` is the site's primary intake survey. Every "Get Started" CTA points to it;
  the "Book a call" step lives at the END of the form, so we capture the visitor's business
  details before the call.
- On submit it POSTs to **`/api/lead`** (a Vercel serverless function) which upserts the
  visitor as a GHL contact (source "AI Brain Survey (Website)"), appends tags
  (`AI Brain Survey`, `Type: …`, `Stage: …`) and attaches the full survey as a note.
- **Required Vercel env vars** (Project → Settings → Environment Variables, Production):
  - `GHL_TOKEN` — GHL Private Integration Token (`pit-…`)
  - `GHL_LOCATION` — GHL location id (`96CjYLgHjgrtu0M0ML2X`)
  - After adding them, redeploy so the function picks them up.
- If the function is missing/unconfigured/errors, the form **falls back to a pre-filled
  mailto** to the address in `ai-brain-form/index.html` → `CONFIG.EMAIL`, so no lead is lost.

## Website funnel → GoHighLevel
- `/website` is the "a 2026 website that moves as fast as you think" survey funnel for
  small businesses. Two doors everywhere: **schedule a call** (GHL booking widget
  `8qVrNv1XSH2gqAi7tQrl`, opens in a new tab) or **take the survey**. Same
  Typeform-style engine as `/ai-brain-form`. No price on the page — the survey ends with
  "we'll come back with what we'd build, how fast, and what it costs."
- History: it was `/free-website` ("we build it free, $499 if you love it") from
  2026-07-22 to 2026-09-15. That offer is retired; `vercel.json` 308-redirects
  `/free-website` → `/website` so the old ad links still land.
- Homepage section **"04 — The 2026 Website"** (sky-blue box, the one cool-toned section on
  the page) carries both doors. **We do NOT build e-commerce/online stores** (too many steps &
  optimizations) — stated on both the homepage box and the funnel welcome; there is no
  "sell products online" option in the survey.
- Steps: has-a-website? → business type + name + one-liner → what the site should do →
  what they already have (+ links) → timeline → contact + consent. Success screen =
  "Schedule a call" + blog link (no auto-redirect).
- On submit it POSTs to **`/api/free-website`** (endpoint path unchanged) which upserts the
  GHL contact (source "Website Survey (Website)", companyName = business name), appends tags
  (`Website Survey`, `Has site: …`, `Type: …`, `Timeline: …`) and attaches the full survey
  as a note. The tag was `Free Website Survey` before 2026-09-15 — the published GHL
  workflow "FREE Website Optin" still triggers on the OLD tag (and still emails the
  free/$499 copy), so it deliberately does not fire on new leads until its copy is
  updated and its trigger re-pointed. `/api/dash.js` classifies both tags as "Website
  Survey". Uses the SAME `GHL_TOKEN` / `GHL_LOCATION` env vars as `/api/lead` —
  nothing new to configure. Falls back to a pre-filled mailto if the function errors.
- `/your-name` is the personal-website variant (noindex): same two doors, same
  "send me the plan" ending, tag `Personal Website Survey` via `/api/your-name`.

## Assets
Images and the ambient hero video are hosted on Higgsfield's CDN and referenced by URL,
so the page stays a single lightweight file. To make it fully self-hosted, download the
four asset URLs (search `cloudfront` in `index.html`) into a `/assets` folder and update
the paths.

## Brand
Onyx black + ember/molten/gold burn gradient · Playfair Display + Inter · "Spread like fire."
Real numbers used: $10M+ ad spend managed · 100s of brands grown.


---
Related: [[Social Fire Hub]]
