const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");
const { guestLocaleMiddleware, getWeddingCalendar, localeDateTimeFormat } = require("./i18n");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
let SALON_CAPACITY = Number(process.env.SALON_CAPACITY || 900);
const LIMITED_USER_USERNAME = "enis";
const VIEWER_USERNAME = "izleyici";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("view cache", false);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  })
);

// Sablonlar alt klasorlu kopyalarla (anil, yunus) ortak oldugu icin basePath her zaman tanimli olmali.
app.locals.basePath = "";
// Panel ve davetiye sayfalari ayni dil secimini kullanir (?lang=tr|de|en, cerezde saklanir).
app.use(guestLocaleMiddleware);

function isViewer(req) {
  return req.session?.user?.role === "viewer";
}

function isAdmin(req) {
  return req.session?.user?.role === "admin";
}

function isBenutzer(req) {
  return req.session?.user?.role === "benutzer";
}

function canManageGuest(req, guestUserId) {
  if (isAdmin(req)) return true;
  if (!isBenutzer(req)) return false;
  const currentUserId = Number(req.session?.user?.id || 0);
  if (!currentUserId || guestUserId == null) return false;
  return Number(guestUserId) === currentUserId;
}

function canSeeGuestContact(req, guestUserId) {
  return canManageGuest(req, guestUserId);
}

function viewerHome() {
  return "/gun-akisi";
}

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "viewer") return "viewer";
  if (r === "benutzer") return "benutzer";
  return "admin";
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  if (req.originalUrl.startsWith("/api")) {
    return res.status(401).json({ success: false, message: req.t("panel.api.unauthorized") });
  }
  return res.redirect("/login");
}

function requireEditor(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith("/api")) {
      return res.status(401).json({ success: false, message: req.t("panel.api.unauthorized") });
    }
    return res.redirect("/login");
  }
  if (isViewer(req)) {
    if (req.originalUrl.startsWith("/api")) {
      return res.status(403).json({ success: false, message: req.t("panel.api.readOnly") });
    }
    return res.redirect(viewerHome());
  }
  return next();
}

const GUN_AKISI_SELECT =
  "SELECT id, tarih, saat_baslangic, saat_bitis, aksiyon, aciklama, sahis FROM gun_akisi ORDER BY tarih ASC, saat_baslangic ASC, saat_bitis ASC, id ASC";

function isValidSaatRange(baslangic, bitis) {
  const b = String(baslangic || "").slice(0, 5);
  const e = String(bitis || "").slice(0, 5);
  return b !== "" && e !== "" && b <= e;
}

function generateInviteToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getPublicBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (envBase) return envBase;
  return `${req.protocol}://${req.get("host")}`;
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function buildWeddingIcs(locale = "tr") {
  const calendar = getWeddingCalendar(locale);
  const { title, description, date, endDate, start, end, timezone, location, mapsUrl, travelMinutes, reminders } = calendar;
  // Her hatirlatma icin bir VALARM (or. 1 gun once, 1 saat once).
  const alarms = reminders.flatMap((before) => [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(title)}`,
    `TRIGGER:-${before}`,
    "END:VALARM"
  ]);
  const uid = `wedding-${date}@davetiye`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const prodLang = String(locale || "tr").toUpperCase();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Davetiye//Wedding//${prodLang}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${timezone}:${date}T${start}`,
    `DTEND;TZID=${timezone}:${endDate || date}T${end}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(`${description}\n${location}\n${mapsUrl}`)}`,
    `LOCATION:${escapeIcsText(location)}`,
    // Yol suresi (Apple Takvim) ve hatirlatmalar.
    `X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT${travelMinutes}M`,
    ...alarms,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

function normalizeNameForMatch(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function scoreGuestNameMatch(query, name) {
  const q = normalizeNameForMatch(query);
  const n = normalizeNameForMatch(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 92;
  if (n.includes(q)) return 85;
  const qParts = q.split(" ").filter(Boolean);
  const nParts = n.split(" ").filter(Boolean);
  if (qParts.length && qParts.every((part) => nParts.some((np) => np.startsWith(part) || np.includes(part)))) {
    return 78;
  }
  const dist = levenshtein(q, n);
  const maxLen = Math.max(q.length, n.length);
  const ratio = 1 - dist / maxLen;
  return ratio >= 0.55 ? Math.round(ratio * 70) : 0;
}

function findMatchingGuests(query, guests, limit = 8) {
  const minScore = 45;
  return guests
    .map((guest) => ({
      id: guest.id,
      name: guest.name,
      score: scoreGuestNameMatch(query, guest.name)
    }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "tr", { sensitivity: "base" }))
    .slice(0, limit);
}

async function ensureGuestRsvpColumns() {
  const [cols] = await pool.query("SHOW COLUMNS FROM guests");
  const names = new Set(cols.map((c) => c.Field));
  if (!names.has("invite_token")) {
    await pool.query("ALTER TABLE guests ADD COLUMN invite_token VARCHAR(64) DEFAULT NULL");
  }
  if (!names.has("party_size")) {
    await pool.query("ALTER TABLE guests ADD COLUMN party_size TINYINT UNSIGNED DEFAULT NULL");
  }
  if (!names.has("rsvp_note")) {
    await pool.query("ALTER TABLE guests ADD COLUMN rsvp_note VARCHAR(500) DEFAULT NULL");
  }
  if (!names.has("rsvp_at")) {
    await pool.query("ALTER TABLE guests ADD COLUMN rsvp_at TIMESTAMP NULL DEFAULT NULL");
  }
  // Davet takibi: ne zaman / hangi yolla gonderildi, ilk ne zaman ve kac kez acildi.
  if (!names.has("invite_sent_at")) {
    await pool.query("ALTER TABLE guests ADD COLUMN invite_sent_at TIMESTAMP NULL DEFAULT NULL");
  }
  if (!names.has("invite_sent_via")) {
    await pool.query("ALTER TABLE guests ADD COLUMN invite_sent_via VARCHAR(16) DEFAULT NULL");
  }
  if (!names.has("invite_opened_at")) {
    await pool.query("ALTER TABLE guests ADD COLUMN invite_opened_at TIMESTAMP NULL DEFAULT NULL");
  }
  if (!names.has("invite_open_count")) {
    await pool.query("ALTER TABLE guests ADD COLUMN invite_open_count INT UNSIGNED NOT NULL DEFAULT 0");
  }
  if (!names.has("invite_copied_at")) {
    await pool.query("ALTER TABLE guests ADD COLUMN invite_copied_at TIMESTAMP NULL DEFAULT NULL");
  }
  // Takvim dugmesi (Google / .ics): ilk tiklama, hangi dugmeler, kac kez.
  if (!names.has("calendar_at")) {
    await pool.query("ALTER TABLE guests ADD COLUMN calendar_at TIMESTAMP NULL DEFAULT NULL");
  }
  if (!names.has("calendar_via")) {
    await pool.query("ALTER TABLE guests ADD COLUMN calendar_via VARCHAR(16) DEFAULT NULL");
  }
  if (!names.has("calendar_count")) {
    await pool.query("ALTER TABLE guests ADD COLUMN calendar_count INT UNSIGNED NOT NULL DEFAULT 0");
  }
  const [indexes] = await pool.query("SHOW INDEX FROM guests WHERE Key_name = 'idx_guests_invite_token'");
  if (!indexes.length) {
    await pool.query("CREATE UNIQUE INDEX idx_guests_invite_token ON guests (invite_token)");
  }
}

async function ensureGuestInviteToken(guestId) {
  const [rows] = await pool.query("SELECT invite_token FROM guests WHERE id = ? LIMIT 1", [guestId]);
  const guest = rows[0];
  if (!guest) return null;
  if (guest.invite_token) return guest.invite_token;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateInviteToken();
    try {
      const [result] = await pool.query("UPDATE guests SET invite_token = ? WHERE id = ? AND invite_token IS NULL", [
        token,
        guestId
      ]);
      if (result.affectedRows > 0) return token;
      const [again] = await pool.query("SELECT invite_token FROM guests WHERE id = ? LIMIT 1", [guestId]);
      if (again[0]?.invite_token) return again[0].invite_token;
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }
  }
  return null;
}

async function ensureGunAkisiTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gun_akisi (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      tarih DATE NOT NULL,
      saat_baslangic TIME NOT NULL,
      saat_bitis TIME NOT NULL,
      aksiyon VARCHAR(120) NOT NULL,
      aciklama TEXT DEFAULT NULL,
      sahis VARCHAR(120) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [cols] = await pool.query("SHOW COLUMNS FROM gun_akisi");
  const names = new Set(cols.map((c) => c.Field));
  if (names.has("saat") && !names.has("saat_baslangic")) {
    await pool.query("ALTER TABLE gun_akisi ADD COLUMN saat_baslangic TIME NULL, ADD COLUMN saat_bitis TIME NULL");
    await pool.query("UPDATE gun_akisi SET saat_baslangic = saat, saat_bitis = saat WHERE saat_baslangic IS NULL");
    await pool.query("ALTER TABLE gun_akisi DROP COLUMN saat");
  }
  if (!names.has("saat_baslangic") && !names.has("saat")) {
    await pool.query("ALTER TABLE gun_akisi ADD COLUMN IF NOT EXISTS saat_baslangic TIME NOT NULL DEFAULT '09:00:00'");
    await pool.query("ALTER TABLE gun_akisi ADD COLUMN IF NOT EXISTS saat_bitis TIME NOT NULL DEFAULT '10:00:00'");
  }
}

// Kapasite liste sayfasindan degistirilebilir; son verilen deger app_settings tablosunda saklanir.
async function ensureCapacitySetting() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      name VARCHAR(64) NOT NULL PRIMARY KEY,
      value VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  const [rows] = await pool.query("SELECT value FROM app_settings WHERE name = 'salon_capacity' LIMIT 1");
  const saved = rows[0] ? Number(rows[0].value) : NaN;
  if (Number.isInteger(saved) && saved > 0) SALON_CAPACITY = saved;
}

async function ensureSeedUsers() {
  const limitedUserPasswordHash = await bcrypt.hash("password", 10);
  const viewerPasswordHash = await bcrypt.hash("password", 10);
  await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'benutzer') ON DUPLICATE KEY UPDATE role = 'benutzer'",
    [LIMITED_USER_USERNAME, limitedUserPasswordHash]
  );
  await pool.query(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'viewer') ON DUPLICATE KEY UPDATE role = VALUES(role)",
    [VIEWER_USERNAME, viewerPasswordHash]
  );
}

function countStats(rows) {
  const stats = { 1: 0, 2: 0, 3: 0 };
  for (const row of rows) {
    stats[Number(row.status)] = Number(row.total);
  }
  const total = stats[1] + stats[2] + stats[3];
  const occupancy = SALON_CAPACITY > 0 ? Math.min(100, ((stats[1] * 2.5) / SALON_CAPACITY) * 100) : 0;
  return {
    count1: stats[1],
    count2: stats[2],
    count3: stats[3],
    confirmedPersons: 0,
    confirmedGuestCount: 0,
    declinedRsvpCount: 0,
    totalGuests: total,
    capacity: SALON_CAPACITY,
    occupancyRate: occupancy.toFixed(1)
  };
}

const GUEST_STATS_SQL = "SELECT status, COUNT(*) AS total FROM guests GROUP BY status";
const CONFIRMED_PERSONS_SQL =
  "SELECT COALESCE(SUM(party_size), 0) AS total FROM guests WHERE party_size IS NOT NULL AND party_size > 0";
const CONFIRMED_GUESTS_SQL =
  "SELECT COUNT(*) AS total FROM guests WHERE party_size IS NOT NULL AND party_size > 0";
const DECLINED_RSVP_SQL =
  "SELECT COUNT(*) AS total FROM guests WHERE party_size = 0 AND rsvp_at IS NOT NULL";

async function fetchGuestStats() {
  const [countRows, confirmedRows, confirmedGuestRows, declinedRows] = await Promise.all([
    pool.query(GUEST_STATS_SQL),
    pool.query(CONFIRMED_PERSONS_SQL),
    pool.query(CONFIRMED_GUESTS_SQL),
    pool.query(DECLINED_RSVP_SQL)
  ]);
  const stats = countStats(countRows[0]);
  stats.confirmedPersons = Number(confirmedRows[0][0]?.total ?? 0);
  stats.confirmedGuestCount = Number(confirmedGuestRows[0][0]?.total ?? 0);
  stats.declinedRsvpCount = Number(declinedRows[0][0]?.total ?? 0);
  return stats;
}

async function resolveCurrentUserId(req) {
  const sessionUser = req.session?.user || {};
  const sessionUserId = Number(sessionUser.id || 0);
  if (sessionUserId > 0) return sessionUserId;
  const username = String(sessionUser.username || "").trim();
  if (!username) return null;
  const [rows] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
  return rows[0] ? Number(rows[0].id) : null;
}

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect(isViewer(req) ? viewerHome() : "/list");
  res.render("login", { error: "" });
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) return res.render("login", { error: req.t("panel.api.loginRequired") });
  const validFallback = username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD;

  try {
    const [rows] = await pool.query("SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1", [username]);
    const user = rows[0];
    let validHash = false;
    if (user && user.password_hash && user.password_hash.startsWith("$2")) {
      const normalizedHash = user.password_hash.replace(/^\$2y\$/, "$2b$");
      validHash = await bcrypt.compare(password, normalizedHash);
    }
    if (!validHash && !validFallback) return res.render("login", { error: req.t("panel.api.loginInvalid") });
    let userId = user ? Number(user.id) : 0;
    if (!userId && validFallback) {
      const fallbackHash = await bcrypt.hash(password, 10);
      const [insertResult] = await pool.query(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin') ON DUPLICATE KEY UPDATE username = username",
        [username, fallbackHash]
      );
      userId = Number(insertResult.insertId || 0);
      if (!userId) {
        const [fallbackRows] = await pool.query("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
        userId = fallbackRows[0] ? Number(fallbackRows[0].id) : 0;
      }
    }
    const role = normalizeRole(user ? user.role : "admin");
    req.session.user = {
      id: userId || 0,
      username: user ? user.username : username,
      role
    };
    res.redirect(role === "viewer" ? viewerHome() : "/list");
  } catch (err) {
    res.status(500).render("login", { error: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireLogin, (req, res) => {
  if (isViewer(req)) return res.redirect(viewerHome());
  const ok = req.query.ok === "1";
  res.render("index", { ok, error: "", username: req.session.user.username });
});

app.post("/", requireEditor, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim();
  const city = String(req.body.city || "").trim();
  const status = Number(req.body.status || 2);
  if (!name) return res.render("index", { ok: false, error: req.t("panel.api.nameRequired"), username: req.session.user.username });
  if (![1, 2, 3].includes(status)) return res.render("index", { ok: false, error: req.t("panel.api.invalidStatus"), username: req.session.user.username });

  try {
    const userId = await resolveCurrentUserId(req);
    const inviteToken = generateInviteToken();
    await pool.query("INSERT INTO guests (name, phone, email, city, status, user_id, invite_token) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      name,
      phone || null,
      email || null,
      city || null,
      status,
      userId,
      inviteToken
    ]);
    res.redirect("/?ok=1");
  } catch (err) {
    res.status(500).render("index", { ok: false, error: req.t("panel.api.saveError", { msg: err.message }), username: req.session.user.username });
  }
});

app.get("/gun-akisi", requireLogin, async (req, res) => {
  try {
    const [entries] = await pool.query(GUN_AKISI_SELECT);
    res.render("gun-akisi", {
      entries,
      ok: req.query.ok === "1",
      error: "",
      username: req.session.user.username,
      readOnly: isViewer(req)
    });
  } catch (err) {
    res.status(500).send(req.t("panel.api.serverError", { msg: err.message }));
  }
});

app.post("/gun-akisi", requireEditor, async (req, res) => {
  const tarih = String(req.body.tarih || "").trim();
  const saatBaslangic = String(req.body.saat_baslangic || "").trim();
  const saatBitis = String(req.body.saat_bitis || "").trim();
  const aksiyon = String(req.body.aksiyon || "").trim();
  const aciklama = String(req.body.aciklama || "").trim();
  const sahis = String(req.body.sahis || "").trim();

  if (!tarih || !saatBaslangic || !saatBitis || !aksiyon) {
    const [entries] = await pool.query(GUN_AKISI_SELECT);
    return res.status(422).render("gun-akisi", {
      entries,
      ok: false,
      error: req.t("panel.api.flowRequired"),
      username: req.session.user.username,
      readOnly: false
    });
  }
  if (!isValidSaatRange(saatBaslangic, saatBitis)) {
    const [entries] = await pool.query(GUN_AKISI_SELECT);
    return res.status(422).render("gun-akisi", {
      entries,
      ok: false,
      error: req.t("panel.api.flowOrder"),
      username: req.session.user.username,
      readOnly: false
    });
  }

  try {
    await pool.query(
      "INSERT INTO gun_akisi (tarih, saat_baslangic, saat_bitis, aksiyon, aciklama, sahis) VALUES (?, ?, ?, ?, ?, ?)",
      [tarih, saatBaslangic, saatBitis, aksiyon, aciklama || null, sahis || null]
    );
    res.redirect("/gun-akisi?ok=1");
  } catch (err) {
    const [entries] = await pool.query(GUN_AKISI_SELECT);
    res.status(500).render("gun-akisi", {
      entries,
      ok: false,
      error: req.t("panel.api.saveError", { msg: err.message }),
      username: req.session.user.username,
      readOnly: false
    });
  }
});

app.post("/api/gun-akisi/:id", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  const tarih = String(req.body.tarih || "").trim();
  const saatBaslangic = String(req.body.saat_baslangic || "").trim();
  const saatBitis = String(req.body.saat_bitis || "").trim();
  const aksiyon = String(req.body.aksiyon || "").trim();
  const aciklama = String(req.body.aciklama || "").trim();
  const sahis = String(req.body.sahis || "").trim();

  if (!id || !tarih || !saatBaslangic || !saatBitis || !aksiyon) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }
  if (!isValidSaatRange(saatBaslangic, saatBitis)) {
    return res.status(422).json({ success: false, message: req.t("panel.api.flowOrder") });
  }

  try {
    const [result] = await pool.query(
      "UPDATE gun_akisi SET tarih = ?, saat_baslangic = ?, saat_bitis = ?, aksiyon = ?, aciklama = ?, sahis = ? WHERE id = ?",
      [tarih, saatBaslangic, saatBitis, aksiyon, aciklama || null, sahis || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

app.delete("/api/gun-akisi/:id", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }

  try {
    const [result] = await pool.query("DELETE FROM gun_akisi WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

app.get("/list", requireLogin, async (req, res) => {
  try {
    const currentUserId = await resolveCurrentUserId(req);
    const viewer = isViewer(req);
    const admin = isAdmin(req);
    const baseUrl = getPublicBaseUrl(req);
    const guestSql = viewer
      ? `SELECT g.id, g.name, g.phone, g.email, g.city, g.status, g.user_id, g.invite_token, g.party_size, g.rsvp_note, g.rsvp_at, g.invite_sent_at, g.invite_sent_via, g.invite_opened_at, g.invite_open_count, g.invite_copied_at, g.calendar_at, g.calendar_via, g.calendar_count, u.username AS kullanici
         FROM guests g
         LEFT JOIN users u ON u.id = g.user_id
         ORDER BY g.name ASC, g.id ASC`
      : `SELECT g.id, g.name, g.phone, g.email, g.city, g.status, g.user_id, g.invite_token, g.party_size, g.rsvp_note, g.rsvp_at, g.invite_sent_at, g.invite_sent_via, g.invite_opened_at, g.invite_open_count, g.invite_copied_at, g.calendar_at, g.calendar_via, g.calendar_count, u.username AS kullanici
         FROM guests g
         LEFT JOIN users u ON u.id = g.user_id
         ORDER BY g.name ASC, g.id ASC`;
    const [guests] = await pool.query(guestSql);
    if (!viewer) {
      for (const guest of guests) {
        if (!guest.invite_token) {
          guest.invite_token = await ensureGuestInviteToken(guest.id);
        }
      }
    }
    const [filterUsers] = await pool.query(
      `SELECT u.id, u.username FROM users u
       WHERE u.id IN (SELECT DISTINCT user_id FROM guests WHERE user_id IS NOT NULL)
       ORDER BY u.username ASC`
    );
    const [filterCities] = await pool.query(
      `SELECT DISTINCT TRIM(city) AS city FROM guests
       WHERE city IS NOT NULL AND TRIM(city) <> ''
       ORDER BY city ASC`
    );
    const [unassignedRows] = await pool.query("SELECT 1 FROM guests WHERE user_id IS NULL LIMIT 1");
    const [emptyCityRows] = await pool.query(
      "SELECT 1 FROM guests WHERE city IS NULL OR TRIM(city) = '' LIMIT 1"
    );
    const stats = await fetchGuestStats();
    res.render("list", {
      guests,
      stats,
      filterUsers,
      filterCities,
      hasUnassignedGuests: unassignedRows.length > 0,
      hasEmptyCityGuests: emptyCityRows.length > 0,
      currentUserId: Number(currentUserId || 0),
      isAdmin: admin,
      username: req.session.user.username,
      readOnly: viewer,
      baseUrl
    });
  } catch (err) {
    res.status(500).send(req.t("panel.api.serverError", { msg: err.message }));
  }
});

app.get("/davet/:token", guestLocaleMiddleware, async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(404).send(req.t("errors.inviteNotFound"));
  try {
    const [rows] = await pool.query(
      "SELECT id, name, party_size, rsvp_note, rsvp_at, status FROM guests WHERE invite_token = ? LIMIT 1",
      [token]
    );
    const guest = rows[0];
    if (!guest) return res.status(404).send(req.t("errors.inviteExpired"));
    res.set("Cache-Control", "no-store");
    res.render("rsvp", {
      token,
      guest,
      submitted: req.query.ok === "1",
      error: "",
      calendar: getWeddingCalendar(req.locale),
      showCalendar: Number(guest.status) === 1 && !!guest.rsvp_at && Number(guest.party_size || 0) > 0,
      locale: req.locale,
      dateLocale: localeDateTimeFormat(req.locale)
    });
  } catch (err) {
    res.status(500).send(req.t("api.serverError", { msg: err.message }));
  }
});

app.get("/davet/:token/takvim.ics", guestLocaleMiddleware, async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(404).send(req.t("errors.inviteNotFound"));
  try {
    const [rows] = await pool.query("SELECT id FROM guests WHERE invite_token = ? LIMIT 1", [token]);
    if (!rows[0]) return res.status(404).send(req.t("errors.inviteNotFound"));
    const calendar = getWeddingCalendar(req.locale);
    res.set("Cache-Control", "no-store");
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${calendar.icsFilename}"`);
    return res.send(buildWeddingIcs(req.locale));
  } catch (err) {
    return res.status(500).send(req.t("api.serverError", { msg: err.message }));
  }
});

app.get("/api/rsvp/names", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) {
    return res.json({ success: true, matches: [] });
  }
  try {
    const [guests] = await pool.query("SELECT id, name FROM guests ORDER BY name ASC");
    const matches = findMatchingGuests(query, guests);
    return res.json({ success: true, matches });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

app.post("/api/rsvp/:token", guestLocaleMiddleware, async (req, res) => {
  const token = String(req.params.token || "").trim();
  const guestId = Number(req.body.guest_id || 0);
  const notAttending = req.body.not_attending === true || req.body.not_attending === "true";
  const partySize = Number(req.body.party_size ?? (notAttending ? 0 : 1));
  const note = String(req.body.note || "").trim().slice(0, 500);

  if (!token) {
    return res.status(422).json({ success: false, message: req.t("api.invalidInvite") });
  }
  if (notAttending) {
    if (!Number.isInteger(partySize) || partySize !== 0) {
      return res.status(422).json({ success: false, message: req.t("api.invalidAttendance") });
    }
  } else if (!Number.isInteger(partySize) || partySize < 1 || partySize > 5) {
    return res.status(422).json({ success: false, message: req.t("api.partySizeRange") });
  }

  try {
    const [tokenRows] = await pool.query("SELECT id, name FROM guests WHERE invite_token = ? LIMIT 1", [token]);
    const selectedGuest = tokenRows[0];
    if (!selectedGuest) {
      return res.status(404).json({ success: false, message: req.t("api.inviteNotFound") });
    }
    if (guestId && Number(selectedGuest.id) !== guestId) {
      return res.status(422).json({ success: false, message: req.t("api.invalidGuestRecord") });
    }

    await pool.query(
      notAttending
        ? "UPDATE guests SET name = ?, party_size = 0, rsvp_note = ?, rsvp_at = CURRENT_TIMESTAMP, status = 3 WHERE id = ?"
        : "UPDATE guests SET name = ?, party_size = ?, rsvp_note = ?, rsvp_at = CURRENT_TIMESTAMP, status = 1 WHERE id = ?",
      notAttending
        ? [selectedGuest.name, note || null, selectedGuest.id]
        : [selectedGuest.name, partySize, note || null, selectedGuest.id]
    );

    return res.json({
      success: true,
      message: notAttending ? req.t("api.declineSuccess") : req.t("api.attendanceSuccess"),
      guest: {
        id: selectedGuest.id,
        name: selectedGuest.name,
        party_size: notAttending ? 0 : partySize,
        status: notAttending ? 3 : 1
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("api.serverError", { msg: err.message }) });
  }
});

// Davet sayfasindaki takvim dugmesine (Google / .ics) basildiginda tarayici bildirir.
// Takvime gercekten kaydedilip kaydedilmedigi bilinemez; yalnizca dugmeye basilmasi kaydedilir.
// Panelde oturumu acik olan kullanicinin tiklamalari sayilmaz.
app.post("/api/rsvp/:token/calendar", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const via = String((req.body && req.body.via) || "");
  if (!token || !["google", "ics"].includes(via)) return res.status(422).json({ success: false });
  if (req.session && req.session.user) return res.json({ success: true, counted: false });
  try {
    const [rows] = await pool.query("SELECT id, calendar_via FROM guests WHERE invite_token = ? LIMIT 1", [token]);
    if (!rows[0]) return res.status(404).json({ success: false });
    const known = new Set(String(rows[0].calendar_via || "").split(","));
    known.add(via);
    const value = ["google", "ics"].filter((v) => known.has(v)).join(",");
    await pool.query(
      `UPDATE guests
       SET calendar_at = COALESCE(calendar_at, CURRENT_TIMESTAMP), calendar_via = ?, calendar_count = calendar_count + 1
       WHERE id = ?`,
      [value, rows[0].id]
    );
    return res.json({ success: true, counted: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

// Davet sayfasi acildiginda tarayici bildirir. Link onizlemeleri (or. WhatsApp) sayfadaki
// kodu calistirmadigi icin sayilmaz; panelde oturumu acik olan kullanicinin acilislari da sayilmaz.
app.post("/api/rsvp/:token/opened", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(404).json({ success: false });
  if (req.session && req.session.user) return res.json({ success: true, counted: false });
  try {
    const [result] = await pool.query(
      `UPDATE guests
       SET invite_opened_at = COALESCE(invite_opened_at, CURRENT_TIMESTAMP), invite_open_count = invite_open_count + 1
       WHERE invite_token = ?`,
      [token]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false });
    return res.json({ success: true, counted: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/capacity", requireEditor, async (req, res) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ success: false, message: req.t("panel.api.capacityAdminOnly") });
  }
  const capacity = Number(req.body.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000) {
    return res.status(422).json({ success: false, message: req.t("panel.api.capacityRange") });
  }
  try {
    await pool.query(
      "INSERT INTO app_settings (name, value) VALUES ('salon_capacity', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [String(capacity)]
    );
    SALON_CAPACITY = capacity;
    const stats = await fetchGuestStats();
    return res.json({ success: true, capacity, stats: statsPayload(stats) });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

app.post("/api/update", requireEditor, async (req, res) => {
  const id = Number(req.body.id || 0);
  const status = Number(req.body.status || 0);
  if (!id || ![1, 2, 3].includes(status)) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }

  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    const guestUserId = guest.user_id == null ? null : Number(guest.user_id);
    if (!canManageGuest(req, guestUserId)) {
      return res.status(403).json({ success: false, message: req.t("panel.api.noUpdatePermission") });
    }
    await pool.query("UPDATE guests SET status = ? WHERE id = ?", [status, id]);
    const stats = await fetchGuestStats();
    return res.json({
      success: true,
      stats: statsPayload(stats)
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

function statsPayload(stats) {
  return {
    count_1: stats.count1,
    count_2: stats.count2,
    count_3: stats.count3,
    total_guests: stats.totalGuests,
    occupancy_rate: stats.occupancyRate,
    confirmed_persons: stats.confirmedPersons,
    confirmed_guest_count: stats.confirmedGuestCount,
    declined_rsvp_count: stats.declinedRsvpCount
  };
}

async function handleGuestSave(req, res) {
  const id = Number(req.params.id || 0);
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim();
  const city = String(req.body.city || "").trim();
  const status = Number(req.body.status || 0);
  if (!id || !name || ![1, 2, 3].includes(status)) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }

  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    const guestUserId = guest.user_id == null ? null : Number(guest.user_id);
    if (!canManageGuest(req, guestUserId)) {
      return res.status(403).json({ success: false, message: req.t("panel.api.noUpdatePermission") });
    }
    const userId = await resolveCurrentUserId(req);
    const ownerId = guest.user_id != null ? Number(guest.user_id) : userId;
    await pool.query("UPDATE guests SET name = ?, phone = ?, email = ?, city = ?, status = ?, user_id = ? WHERE id = ?", [
      name,
      phone || null,
      email || null,
      city || null,
      status,
      ownerId,
      id
    ]);
    const stats = await fetchGuestStats();
    return res.json({ success: true, stats: statsPayload(stats) });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
}

app.put("/api/guest/:id", requireEditor, handleGuestSave);
app.post("/api/guest/:id", requireEditor, handleGuestSave);

// Davet linki kopyalandiginda isaretlenir (listede dugme yesil gorunur).
app.post("/api/guest/:id/copied", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }
  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    if (!canManageGuest(req, guest.user_id == null ? null : Number(guest.user_id))) {
      return res.status(403).json({ success: false, message: req.t("panel.api.noUpdatePermission") });
    }
    await pool.query("UPDATE guests SET invite_copied_at = COALESCE(invite_copied_at, CURRENT_TIMESTAMP) WHERE id = ?", [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

// Davet "gonderildi" isareti: listede WhatsApp / e-posta dugmesine basilinca ya da elle konur / kaldirilir.
app.post("/api/guest/:id/sent", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  const sent = req.body.sent !== false;
  const via = String(req.body.via || "manual");
  if (!id || !["whatsapp", "email", "manual"].includes(via)) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }
  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    if (!canManageGuest(req, guest.user_id == null ? null : Number(guest.user_id))) {
      return res.status(403).json({ success: false, message: req.t("panel.api.noUpdatePermission") });
    }
    let value = null;
    if (sent) {
      // WhatsApp ve e-posta birlikte tutulur ("whatsapp,email"); elle konan isaret tek basina durur.
      value = via;
      if (via !== "manual") {
        const [cur] = await pool.query("SELECT invite_sent_via FROM guests WHERE id = ? LIMIT 1", [id]);
        const known = new Set(String((cur[0] && cur[0].invite_sent_via) || "").split(","));
        known.add(via);
        value = ["whatsapp", "email"].filter((v) => known.has(v)).join(",");
      }
      await pool.query("UPDATE guests SET invite_sent_at = CURRENT_TIMESTAMP, invite_sent_via = ? WHERE id = ?", [value, id]);
    } else {
      await pool.query("UPDATE guests SET invite_sent_at = NULL, invite_sent_via = NULL WHERE id = ?", [id]);
    }
    return res.json({ success: true, sent, via: value });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

app.delete("/api/guest/:id", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  const currentUserId = Number(await resolveCurrentUserId(req) || 0);
  if (!id) {
    return res.status(422).json({ success: false, message: req.t("panel.api.invalidData") });
  }

  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: req.t("panel.api.notFound") });
    }
    const guestUserId = guest.user_id == null ? null : Number(guest.user_id);
    const canDelete = canManageGuest(req, guestUserId);
    if (!canDelete) {
      return res.status(403).json({ success: false, message: req.t("panel.api.noDeletePermission") });
    }

    await pool.query("DELETE FROM guests WHERE id = ?", [id]);
    const stats = await fetchGuestStats();
    return res.json({ success: true, stats: statsPayload(stats) });
  } catch (err) {
    return res.status(500).json({ success: false, message: req.t("panel.api.serverError", { msg: err.message }) });
  }
});

Promise.all([ensureSeedUsers(), ensureGunAkisiTable(), ensureGuestRsvpColumns(), ensureCapacitySetting()])
  .catch((err) => {
    console.error("Baslangic kurulum hatasi:", err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
