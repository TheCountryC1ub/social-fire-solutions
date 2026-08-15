// Vercel serverless function — receives Commas (Fanbasis) webhook events for the
// org, keeps only AI Brain Webinar purchases (product DEO2B), and files the buyer
// into GoHighLevel with the tag that starts the webinar email sequence.
//
// Auth: the webhook URL carries ?k=<key> where key = sha256("aibw:" + GHL_TOKEN)
// truncated to 32 hex chars — derived from an existing server secret, so no extra
// env var is needed and nothing secret lives in this public repo. Rotating
// GHL_TOKEN invalidates the URL (re-subscribe the Commas webhook if that happens).
//
// Uses the same env vars as api/lead.js: GHL_TOKEN, GHL_LOCATION.

const crypto = require("crypto");

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const PRODUCT_ID = "DEO2B"; // AI Brain Webinar · $27

function expectedKey(token) {
  return crypto.createHash("sha256").update("aibw:" + token).digest("hex").slice(0, 32);
}

function findEmail(obj) {
  const direct = [
    obj.email,
    obj.customer_email,
    obj.buyer_email,
    obj.customer && obj.customer.email,
    obj.fan && obj.fan.email,
    obj.buyer && obj.buyer.email,
    obj.contact && obj.contact.email,
    obj.data && obj.data.email,
    obj.data && obj.data.customer && obj.data.customer.email,
    obj.data && obj.data.fan && obj.data.fan.email,
  ];
  for (const v of direct) {
    if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())) return String(v).trim();
  }
  // last resort: first email-looking string anywhere in the payload
  const m = JSON.stringify(obj).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : "";
}

function findName(obj) {
  const cands = [
    obj.name,
    obj.customer_name,
    obj.customer && obj.customer.name,
    obj.fan && obj.fan.name,
    obj.buyer && obj.buyer.name,
    obj.data && obj.data.name,
    obj.data && obj.data.customer && obj.data.customer.name,
  ];
  for (const v of cands) if (v && String(v).trim()) return String(v).trim();
  const first = obj.first_name || (obj.customer && obj.customer.first_name) || "";
  const last = obj.last_name || (obj.customer && obj.customer.last_name) || "";
  return `${first} ${last}`.trim();
}

function splitName(full) {
  const t = String(full || "").trim().replace(/\s+/g, " ");
  if (!t) return { firstName: "", lastName: "" };
  const parts = t.split(" ");
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const token = process.env.GHL_TOKEN;
  const location = process.env.GHL_LOCATION;
  if (!token || !location) return res.status(500).json({ ok: false, error: "not_configured" });

  const k = (req.query && req.query.k) || "";
  if (k !== expectedKey(token)) return res.status(401).json({ ok: false, error: "bad_key" });

  let d = req.body;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch (_) { d = {}; } }
  d = d || {};

  const raw = JSON.stringify(d);

  // The org webhook fires for every product — only the webinar matters here.
  if (raw.indexOf(PRODUCT_ID) === -1) {
    return res.status(200).json({ ok: true, skipped: "other_product" });
  }

  const email = findEmail(d);
  if (!email) {
    console.error("[webinar-purchase] DEO2B event with no email:", raw.slice(0, 800));
    return res.status(200).json({ ok: false, skipped: "no_email" });
  }

  const { firstName, lastName } = splitName(findName(d));
  const headers = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    // 1) Upsert (dedupes by email). Tags deliberately not sent here — upsert
    //    replaces the whole tag set; the /tags endpoint below appends instead.
    const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        locationId: location,
        firstName,
        lastName,
        email,
        source: "AI Brain Webinar (Commas)",
      }),
    });
    const upsertJson = await upsertRes.json().catch(() => ({}));
    if (!upsertRes.ok) {
      console.error("[webinar-purchase] upsert failed:", JSON.stringify(upsertJson).slice(0, 500));
      return res.status(502).json({ ok: false, error: "ghl_upsert_failed" });
    }

    const contactId = (upsertJson.contact && upsertJson.contact.id) || upsertJson.id || null;
    if (contactId) {
      // 2) "aibw-buyer" starts the email sequence workflow (trigger: Tag Added)
      try {
        await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
          method: "POST",
          headers,
          body: JSON.stringify({ tags: ["AI Brain Webinar", "aibw-buyer"] }),
        });
      } catch (_) {}

      // 3) Receipt trail for humans (best-effort)
      try {
        await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            body: "AI BRAIN WEBINAR — $27 purchase (Commas product DEO2B)\n\nWebhook payload (trimmed):\n" + raw.slice(0, 1500),
          }),
        });
      } catch (_) {}
    }

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    console.error("[webinar-purchase] request failed:", err && err.message);
    return res.status(502).json({ ok: false, error: "ghl_request_failed" });
  }
};
