// /api/dash — live feed for The Fire Watch (/dashboard).
// Pass-gated: requires ?pass= matching env DASHBOARD_PASS (case/space-insensitive).
//
// Two halves, fetched separately so the page can poll leads fast and traffic slow:
//   ?part=leads    — recent form submissions from GoHighLevel (Free Website,
//                    AI Brain, and the client-page leads), newest first,
//                    plus per-form today / 7-day / all-time counts.
//                    Uses the SAME env vars as the lead endpoints (already set):
//                      GHL_TOKEN, GHL_LOCATION
//   ?part=traffic  — GA4 tiles/chart/pages/sources for the chosen &range=
//                    (today | 7d | 28d | season). Needs extra env vars:
//                      GA4_CLIENT_ID, GA4_CLIENT_SECRET, GA4_REFRESH_TOKEN
//                      GA4_DASH_PROPERTY_ID (optional, defaults to SFS 546695552)
//                    Missing GA4 keys → { ready:false }, never an error, so the
//                    lead feed works before the GA4 keys are pasted in.
//   ?part=appts    — GHL calendar events (booked calls/meetings), 24h back to
//                    60 days out. Sweeps every calendar AND every user in the
//                    location (an event can hang off either), dedupes by id.
//                    Same GHL_TOKEN / GHL_LOCATION env vars as leads.
//   ?part=all      — everything (default).
//
// Sibling of elite-golf-site/api/dash.js, reshaped for SFS + CommonJS
// (this repo's functions are all module.exports). Returns aggregates and
// lead rows only — credentials never reach the client.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const SEASON_START = "2026-07-01"; // SFS site went live July 2026
const RANGES = { today: "today", "7d": "7daysAgo", "28d": "28daysAgo", season: SEASON_START };

// Lead classification: GHL returns tags lowercased. First match wins.
const FORMS = [
  { key: "free", label: "Free Website", tag: "free website survey" },
  { key: "brain", label: "AI Brain", tag: "ai brain survey" },
  { key: "ariel", label: "Ariel Zeigler", tag: "ariel zeigler lead" },
  { key: "madeline", label: "Madeline Reams", tag: "madeline reams lead" },
  { key: "obh", label: "On Brand Hospitality", tag: "on brand hospitality lead" },
];
// Qualifier tags worth surfacing on a feed row ("type: saas", "stage: growing", …)
const META_PREFIXES = ["type:", "stage:", "timeline:", "has site:", "mr interest:", "obh interest:", "az interest:"];

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");

let tokenCache = { value: null, exp: 0 };

async function ga4AccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: process.env.GA4_CLIENT_ID,
    client_secret: process.env.GA4_CLIENT_SECRET,
    refresh_token: process.env.GA4_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!r.ok) throw new Error("token exchange failed: " + r.status);
  const j = await r.json();
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

function classify(contact) {
  const tags = (contact.tags || []).map((t) => String(t).toLowerCase());
  for (const f of FORMS) if (tags.includes(f.tag)) return f;
  const src = String(contact.source || "").toLowerCase();
  for (const f of FORMS) if (src.includes(f.label.toLowerCase())) return f;
  return null;
}

async function leadsSnapshot(tz) {
  const token = process.env.GHL_TOKEN;
  const location = process.env.GHL_LOCATION;
  if (!token || !location) return { ready: false };

  const r = await fetch(GHL_BASE + "/contacts/search", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      locationId: location,
      pageLimit: 100,
      sort: [{ field: "dateAdded", direction: "desc" }],
    }),
  });
  if (!r.ok) throw new Error("GHL search " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json();
  const contacts = j.contacts || [];

  // "today" in the viewer's timezone (sent by the page), not UTC —
  // a 10pm lead should count as today wherever Cameron is watching from
  const dayOf = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: tz });
  const todayStr = dayOf(Date.now());
  const weekAgo = Date.now() - 7 * 86400000;

  const counts = {};
  for (const f of FORMS) counts[f.key] = { label: f.label, today: 0, week: 0, all: 0 };
  const leads = [];
  for (const c of contacts) {
    const form = classify(c);
    if (!form) continue;
    const when = c.dateAdded;
    const t = Date.parse(when);
    counts[form.key].all += 1;
    if (t >= weekAgo) counts[form.key].week += 1;
    if (dayOf(when) === todayStr) counts[form.key].today += 1;
    if (leads.length < 40) {
      const meta = (c.tags || [])
        .map((s) => String(s))
        .filter((s) => META_PREFIXES.some((p) => s.toLowerCase().startsWith(p)));
      leads.push({
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactName || "—",
        email: c.email || null,
        phone: c.phone || null,
        form: form.key,
        formLabel: form.label,
        when,
        meta,
      });
    }
  }
  return {
    ready: true,
    leads,
    counts,
    totalContacts: j.total ?? contacts.length,
    // per-form all-time counts only see the newest 100 contacts; flag when that clips
    window: contacts.length >= 100 ? "newest 100 contacts" : null,
  };
}

// Calendar endpoints reject the contacts Version header — they want 2021-04-15.
const GHL_CAL_VERSION = "2021-04-15";
const APPT_BACK = 86400000; // 24h back: keeps "earlier today" visible in any viewer timezone
const APPT_FWD = 60 * 86400000;

async function apptsSnapshot() {
  const token = process.env.GHL_TOKEN;
  const location = process.env.GHL_LOCATION;
  if (!token || !location) return { ready: false };
  const headers = {
    Authorization: "Bearer " + token,
    Version: GHL_CAL_VERSION,
    Accept: "application/json",
    "User-Agent": "sfs-fire-watch/1.0",
  };
  // null on any failure — one dead angle shouldn't dark the whole panel
  const gj = (url, extra) =>
    fetch(url, { headers: extra ? { ...headers, ...extra } : headers })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  const [calsJ, usersJ] = await Promise.all([
    gj(GHL_BASE + "/calendars/?locationId=" + location),
    gj(GHL_BASE + "/users/?locationId=" + location, { Version: GHL_VERSION }),
  ]);
  const calNames = {};
  for (const c of (calsJ && calsJ.calendars) || []) calNames[c.id] = c.name || null;
  const userIds = (((usersJ && usersJ.users) || [])).map((u) => u && u.id).filter(Boolean);

  const angles = [
    ...Object.keys(calNames).map((id) => "&calendarId=" + id),
    ...userIds.map((id) => "&userId=" + id),
  ];
  if (!angles.length) return { ready: true, events: [] };

  const base = GHL_BASE + "/calendars/events?locationId=" + location +
    "&startTime=" + (Date.now() - APPT_BACK) + "&endTime=" + (Date.now() + APPT_FWD);
  const results = await Promise.all(angles.map((a) => gj(base + a)));

  const seen = {};
  const events = [];
  for (const r of results) {
    for (const e of (r && r.events) || []) {
      if (!e || !e.id || seen[e.id]) continue;
      seen[e.id] = 1;
      const status = String(e.appointmentStatus || "").toLowerCase();
      if (status === "cancelled" || status === "invalid") continue;
      const s = typeof e.startTime === "number" ? e.startTime : Date.parse(e.startTime);
      if (!isFinite(s)) continue;
      const en = typeof e.endTime === "number" ? e.endTime : Date.parse(e.endTime);
      const where = String(e.address || e.meetingLocation || "").trim();
      events.push({
        id: e.id,
        title: String(e.title || "").trim() || "Busy",
        start: new Date(s).toISOString(),
        end: isFinite(en) ? new Date(en).toISOString() : null,
        status,
        calendar: calNames[e.calendarId] || null,
        where: where || null,
      });
    }
  }
  events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { ready: true, events: events.slice(0, 60) };
}

async function trafficSnapshot(range) {
  if (!(process.env.GA4_CLIENT_ID && process.env.GA4_CLIENT_SECRET && process.env.GA4_REFRESH_TOKEN)) {
    return { ready: false };
  }
  const isToday = range === "today";
  const dateRanges = [{ startDate: RANGES[range], endDate: "today" }];
  const token = await ga4AccessToken();
  const pid = process.env.GA4_DASH_PROPERTY_ID || "546695552";
  const r = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/" + pid + ":batchRunReports", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { dateRanges,
          metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" },
                    { name: "averageSessionDuration" }, { name: "engagementRate" }, { name: "newUsers" }] },
        { dateRanges,
          // the day view charts hour-by-hour; longer ranges chart day-by-day
          dimensions: [{ name: isToday ? "hour" : "date" }],
          metrics: [{ name: "sessions" }, { name: "activeUsers" }],
          orderBys: [{ dimension: { dimensionName: isToday ? "hour" : "date" } }], limit: 100 },
        { dateRanges,
          dimensions: [{ name: "eventName" }],
          metrics: [{ name: "eventCount" }], limit: 100 },
        { dateRanges,
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
          orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: 50 },
        { dateRanges,
          dimensions: [{ name: "sessionSourceMedium" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 15 },
      ],
    }),
  });
  if (!r.ok) throw new Error("GA4 API " + r.status + ": " + (await r.text()).slice(0, 300));
  const reports = (await r.json()).reports || [];
  const rows = (i) => reports[i]?.rows || [];
  const dims = (row) => (row.dimensionValues || []).map((v) => v.value);
  const mets = (row) => (row.metricValues || []).map((v) => Number(v.value));

  const t = rows(0)[0] ? mets(rows(0)[0]) : [0, 0, 0, 0, 0, 0];
  const events = {};
  for (const row of rows(2)) events[dims(row)[0]] = mets(row)[0];

  return {
    ready: true,
    totals: t,
    daily: isToday ? [] : rows(1).map((row) => [dims(row)[0], ...mets(row)]),
    hourly: isToday ? rows(1).map((row) => [dims(row)[0], ...mets(row)]) : [],
    events,
    pages: rows(3).map((row) => [dims(row)[0], ...mets(row)]),
    sources: rows(4).map((row) => [dims(row)[0], mets(row)[0]]),
  };
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const pass = process.env.DASHBOARD_PASS;
  if (!pass) { res.status(503).json({ error: "not configured" }); return; }
  if (norm(q.pass) !== norm(pass)) { res.status(401).json({ error: "not tonight" }); return; }

  const part = ["leads", "traffic", "appts", "all"].includes(q.part) ? q.part : "all";
  const range = q.range in RANGES ? q.range : "today";
  let tz = process.env.DASH_TZ || "America/Denver";
  if (q.tz) { try { new Date().toLocaleDateString("en-CA", { timeZone: q.tz }); tz = q.tz; } catch (_) { /* keep fallback */ } }
  try {
    const [leads, traffic, appts] = await Promise.all([
      part === "leads" || part === "all" ? leadsSnapshot(tz) : null,
      part === "traffic" || part === "all" ? trafficSnapshot(range) : null,
      part === "appts" || part === "all" ? apptsSnapshot() : null,
    ]);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ generatedAt: new Date().toISOString(), range, leads, traffic, appts });
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
};
