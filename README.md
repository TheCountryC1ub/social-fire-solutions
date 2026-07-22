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

## Free Website funnel → GoHighLevel
- `/free-website` is the "Free website — no tricks, no gimmicks" survey funnel for small
  businesses: we build the site free, host it, show it finished; if they love it it's $499
  once, if not they owe nothing. Same Typeform-style engine as `/ai-brain-form`.
- Homepage section **"04 — The Free Website"** (sky-blue box, the one cool-toned section on
  the page) links to it. **We do NOT build e-commerce/online stores** (too many steps &
  optimizations) — stated on both the homepage box and the funnel welcome; there is no
  "sell products online" option in the survey.
- Steps: has-a-website? → business type + name + one-liner → what the site should do →
  what they already have (+ links) → timeline → contact + consent.
- On submit it POSTs to **`/api/free-website`** which upserts the GHL contact (source
  "Free Website Survey (Website)", companyName = business name), appends tags
  (`Free Website Survey`, `Has site: …`, `Type: …`, `Timeline: …`) and attaches the full
  survey as a note. Uses the SAME `GHL_TOKEN` / `GHL_LOCATION` env vars as `/api/lead` —
  nothing new to configure. Falls back to a pre-filled mailto if the function errors.

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
