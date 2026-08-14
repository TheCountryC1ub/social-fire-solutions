// Vercel serverless function — receives the Free SEO Audit request and pushes
// it into GoHighLevel (v2 / LeadConnector). Same pattern as /api/free-website.
//
// Uses the SAME environment variables as /api/lead (already set in Vercel):
//   GHL_TOKEN     = the Private Integration Token (pit-...)
//   GHL_LOCATION  = the GHL sub-account / location id
//
// The form falls back to a mailto: link if this endpoint is missing or errors,
// so no lead is ever lost.

const crypto = require("crypto");

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// Meta Conversions API. Bump META_API_VERSION in Vercel if Meta sunsets this one.
const META_API_VERSION = process.env.META_API_VERSION || "v21.0";

const FIELD_ORDER = [
  ["website", "Website URL"],
  ["bizname", "Business name"],
  ["biztype", "Business type"],
  ["concern", "Biggest concern"],
  ["competitor", "Competitor / who outranks them"],
  ["doneseo", "SEO done before?"],
  ["notes", "Anything else"],
];

function splitName(full) {
  const t = String(full || "").trim().replace(/\s+/g, " ");
  if (!t) return { firstName: "", lastName: "" };
  const parts = t.split(" ");
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function noteBody(d) {
  const lines = ["FREE SEO AUDIT REQUEST", ""];
  for (const [key, label] of FIELD_ORDER) {
    const v = (d[key] || "").toString().trim();
    lines.push(`${label}: ${v || "—"}`);
  }
  lines.push("", `Consent: ${d.consent ? "Yes" : "—"}`);
  return lines.join("\n");
}

// ── Meta Conversions API ────────────────────────────────────────────────────
// Server-side twin of the browser `Lead` event. Shares the browser's
// _fbEventId so Meta collapses the pair into ONE conversion. Best-effort:
// a CAPI failure must never fail the lead.

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

function readCookie(req, name) {
  const m = (req.headers.cookie || "").match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );
  return m ? decodeURIComponent(m[1]) : undefined;
}

async function sendMetaLead(req, d, email, phone) {
  const pixel = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token) return; // not configured yet — silently no-op

  const { firstName, lastName } = splitName(d.name);
  const digits = String(phone || "").replace(/\D/g, "");

  const user_data = {
    client_user_agent: req.headers["user-agent"],
    client_ip_address:
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || undefined,
    fbp: readCookie(req, "_fbp"),
    fbc: readCookie(req, "_fbc"),
  };
  if (email) user_data.em = sha256(email);
  if (digits) user_data.ph = sha256(digits);
  if (firstName) user_data.fn = sha256(firstName);
  if (lastName) user_data.ln = sha256(lastName);

  const payload = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: d._fbEventId, // dedupe key — must match the browser event
        event_source_url:
          req.headers.referer || "https://socialfire.solutions/seo-audit",
        action_source: "website",
        user_data,
        custom_data: {
          content_name: "Free SEO Audit",
          value: 0,
          currency: "USD",
        },
      },
    ],
  };
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

  try {
    await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
  } catch (_) {
    /* analytics must never break the lead */
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const token = process.env.GHL_TOKEN;
  const location = process.env.GHL_LOCATION;
  if (!token || !location) {
    return res.status(500).json({ ok: false, error: "not_configured" });
  }

  let d = req.body;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch (_) { d = {}; }
  }
  d = d || {};

  const email = (d.email || "").toString().trim();
  const phone = (d.phone || "").toString().trim();
  if (!email && !phone) {
    return res.status(400).json({ ok: false, error: "missing_contact" });
  }

  const { firstName, lastName } = splitName(d.name);
  const tags = ["SEO Audit Request"];
  if (d.biztype) tags.push(`Type: ${d.biztype}`);
  if (d.concern) tags.push(`Concern: ${d.concern}`);
  if (d.doneseo) tags.push(`Prior SEO: ${d.doneseo}`);

  const headers = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    // 1) Upsert the contact (dedupes by email/phone within the location).
    //    Tags are intentionally NOT sent here — upsert would REPLACE the
    //    contact's whole tag set and wipe tags from other workflows.
    const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        locationId: location,
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName: (d.bizname || "").toString().trim() || undefined,
        website: (d.website || "").toString().trim() || undefined,
        source: "Free SEO Audit (Website)",
      }),
    });

    const upsertJson = await upsertRes.json().catch(() => ({}));
    if (!upsertRes.ok) {
      return res.status(502).json({ ok: false, error: "ghl_upsert_failed", detail: upsertJson });
    }

    const contactId =
      (upsertJson.contact && upsertJson.contact.id) || upsertJson.id || null;

    if (contactId) {
      // 2) Add tags via the dedicated endpoint (APPENDS — non-destructive)
      try {
        await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
          method: "POST",
          headers,
          body: JSON.stringify({ tags }),
        });
      } catch (_) { /* tags are non-critical */ }

      // 3) Attach the full request as a note (best-effort — never fails the lead)
      try {
        await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
          method: "POST",
          headers,
          body: JSON.stringify({ body: noteBody(d) }),
        });
      } catch (_) { /* note is non-critical */ }
    }

    // Server-side Lead. Awaited so it completes before Vercel freezes the
    // function; it swallows its own errors, so it can't fail the lead.
    await sendMetaLead(req, d, email, phone);

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    return res.status(502).json({ ok: false, error: "ghl_request_failed" });
  }
};
