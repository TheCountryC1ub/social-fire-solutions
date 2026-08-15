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

// Meta Conversions API — same env vars as /api/seo-audit and /api/free-website.
const META_API_VERSION = process.env.META_API_VERSION || "v21.0";

function expectedKey(token) {
  return crypto.createHash("sha256").update("aibw:" + token).digest("hex").slice(0, 32);
}

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

// The Commas transaction id, used as Meta's event_id. If a browser-side
// Purchase twin is ever added on /thanks, give it this SAME id so Meta
// collapses the pair into one conversion instead of counting two.
function findTxId(obj) {
  const cands = [
    obj.transaction_id, obj.id, obj.payment_id, obj.order_id, obj.charge_id,
    obj.data && obj.data.transaction_id,
    obj.data && obj.data.id,
    obj.data && obj.data.payment_id,
    obj.data && obj.data.order_id,
    obj.data && obj.data.transaction && obj.data.transaction.id,
  ];
  for (const v of cands) if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  return "";
}

// Server-side Purchase. This is the ONLY Purchase source for this funnel:
// it fires on money actually received, so it can't be blocked by an ad
// blocker and can't false-positive on someone reloading the thanks page.
// Deliberately omits client_ip_address / client_user_agent — this request
// comes from Commas' server, so those values describe Commas, not the buyer,
// and wrong values hurt match quality more than absent ones.
// Best-effort: a CAPI failure must never fail the GHL write.
async function capiPurchase({ email, firstName, lastName, txId, amount }) {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return { sent: false, reason: "not_configured" };

  const user_data = {};
  if (email) user_data.em = sha256(email);
  if (firstName) user_data.fn = sha256(firstName);
  if (lastName) user_data.ln = sha256(lastName);

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: txId ? "aibw-" + txId : undefined,
        event_source_url: "https://socialfire.solutions/ai-brain-webinar/checkout",
        action_source: "website",
        user_data,
        custom_data: {
          content_name: "AI Brain Webinar",
          content_ids: [PRODUCT_ID],
          content_type: "product",
          value: Number(amount) || 27,
          currency: "USD",
        },
      },
    ],
  };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.error("[webinar-purchase] CAPI rejected:", JSON.stringify(j).slice(0, 400));
    return { sent: r.ok, received: j.events_received, error: j.error ? j.error.message : undefined };
  } catch (err) {
    console.error("[webinar-purchase] CAPI failed:", err && err.message);
    return { sent: false, reason: "request_failed" };
  }
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

  // ?dry=1 — config check that writes nothing and sends no event. Lets us
  // confirm the Meta CAPI credentials are live in prod without polluting the
  // pixel dataset with a purchase that never happened.
  if (req.query && req.query.dry) {
    return res.status(200).json({
      ok: true,
      dry: true,
      ghl: "configured",
      capi: process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN ? "configured" : "not_configured",
      capiTestMode: process.env.META_TEST_EVENT_CODE ? "on" : "off",
    });
  }

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

    // Meta Purchase — after the GHL write, so a CAPI hiccup never costs us the buyer.
    const capi = await capiPurchase({
      email,
      firstName,
      lastName,
      txId: findTxId(d),
      amount: d.amount || (d.data && d.data.amount),
    });

    return res.status(200).json({ ok: true, contactId, capi });
  } catch (err) {
    console.error("[webinar-purchase] request failed:", err && err.message);
    return res.status(502).json({ ok: false, error: "ghl_request_failed" });
  }
};
