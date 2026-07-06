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
Drag this `Website` folder onto **Netlify Drop** (app.netlify.com/drop), or push to
**GitHub Pages / Vercel / Cloudflare Pages**. It works as-is.

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
