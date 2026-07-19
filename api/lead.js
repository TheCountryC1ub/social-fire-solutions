// Vercel serverless function — receives the AI Brain survey and pushes it into
// GoHighLevel (v2 / LeadConnector). The GHL token lives ONLY in Vercel env vars
// and is never exposed to the browser.
//
// Required environment variables (set in Vercel → Project → Settings → Environment Variables):
//   GHL_TOKEN     = the Private Integration Token (pit-...)
//   GHL_LOCATION  = the GHL sub-account / location id
//
// The site form falls back to a mailto: link if this endpoint is missing or errors,
// so no lead is ever lost while env vars are being configured.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const FIELD_ORDER = [
  ["company", "Company type"],
  ["companydesc", "What they do"],
  ["stage", "Stage"],
  ["links", "Website & socials"],
  ["shortgoals", "Short-term goals"],
  ["longgoals", "Long-term goals"],
  ["bottlenecks", "Bottlenecks"],
  ["bottleneckwords", "Bottlenecks (their words)"],
];

function splitName(full) {
  const t = String(full || "").trim().replace(/\s+/g, " ");
  if (!t) return { firstName: "", lastName: "" };
  const parts = t.split(" ");
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function noteBody(d) {
  const lines = ["AI BRAIN SURVEY", ""];
  for (const [key, label] of FIELD_ORDER) {
    const v = (d[key] || "").toString().trim();
    lines.push(`${label}: ${v || "—"}`);
  }
  lines.push("", `Consent: ${d.consent ? "Yes" : "—"}`);
  return lines.join("\n");
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
  const tags = ["AI Brain Survey"];
  if (d.company) tags.push(`Type: ${d.company}`);
  if (d.stage) tags.push(`Stage: ${d.stage}`);

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
        source: "AI Brain Survey (Website)",
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

      // 3) Attach the full survey as a note (best-effort — never fails the lead)
      try {
        await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
          method: "POST",
          headers,
          body: JSON.stringify({ body: noteBody(d) }),
        });
      } catch (_) { /* note is non-critical */ }
    }

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    return res.status(502).json({ ok: false, error: "ghl_request_failed" });
  }
};
