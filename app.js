const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SALON_CAPACITY = Number(process.env.SALON_CAPACITY || 900);
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
    return res.status(401).json({ success: false, message: "Yetkisiz erisim." });
  }
  return res.redirect("/login");
}

function requireEditor(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith("/api")) {
      return res.status(401).json({ success: false, message: "Yetkisiz erisim." });
    }
    return res.redirect("/login");
  }
  if (isViewer(req)) {
    if (req.originalUrl.startsWith("/api")) {
      return res.status(403).json({ success: false, message: "Salt okunur hesap: degisiklik yapilamaz." });
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
    totalGuests: total,
    capacity: SALON_CAPACITY,
    occupancyRate: occupancy.toFixed(1)
  };
}

const GUEST_STATS_SQL = "SELECT status, COUNT(*) AS total FROM guests GROUP BY status";
const CONFIRMED_PERSONS_SQL =
  "SELECT COALESCE(SUM(party_size), 0) AS total FROM guests WHERE rsvp_at IS NOT NULL AND party_size IS NOT NULL";

async function fetchGuestStats() {
  const [countRows, confirmedRows] = await Promise.all([
    pool.query(GUEST_STATS_SQL),
    pool.query(CONFIRMED_PERSONS_SQL)
  ]);
  const stats = countStats(countRows[0]);
  stats.confirmedPersons = Number(confirmedRows[0][0]?.total ?? 0);
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
  if (req.session.user) return res.redirect(isViewer(req) ? viewerHome() : "/");
  res.render("login", { error: "" });
});

app.post("/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) return res.render("login", { error: "Kullanici adi ve sifre zorunludur." });
  const validFallback = username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD;

  try {
    const [rows] = await pool.query("SELECT id, username, password_hash, role FROM users WHERE username = ? LIMIT 1", [username]);
    const user = rows[0];
    let validHash = false;
    if (user && user.password_hash && user.password_hash.startsWith("$2")) {
      const normalizedHash = user.password_hash.replace(/^\$2y\$/, "$2b$");
      validHash = await bcrypt.compare(password, normalizedHash);
    }
    if (!validHash && !validFallback) return res.render("login", { error: "Giris bilgileri hatali." });
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
    res.redirect(role === "viewer" ? viewerHome() : "/");
  } catch (err) {
    res.status(500).render("login", { error: "Sunucu hatasi: " + err.message });
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
  if (!name) return res.render("index", { ok: false, error: "Ad Soyad zorunludur.", username: req.session.user.username });
  if (![1, 2, 3].includes(status)) return res.render("index", { ok: false, error: "Gecersiz status secimi.", username: req.session.user.username });

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
    res.status(500).render("index", { ok: false, error: "Kayit hatasi: " + err.message, username: req.session.user.username });
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
    res.status(500).send("Sunucu hatasi: " + err.message);
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
      error: "Tarih, baslangic/bitis saati ve aksiyon zorunludur.",
      username: req.session.user.username,
      readOnly: false
    });
  }
  if (!isValidSaatRange(saatBaslangic, saatBitis)) {
    const [entries] = await pool.query(GUN_AKISI_SELECT);
    return res.status(422).render("gun-akisi", {
      entries,
      ok: false,
      error: "Bitis saati baslangic saatinden once olamaz.",
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
      error: "Kayit hatasi: " + err.message,
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
    return res.status(422).json({ success: false, message: "Gecersiz veri." });
  }
  if (!isValidSaatRange(saatBaslangic, saatBitis)) {
    return res.status(422).json({ success: false, message: "Bitis saati baslangic saatinden once olamaz." });
  }

  try {
    const [result] = await pool.query(
      "UPDATE gun_akisi SET tarih = ?, saat_baslangic = ?, saat_bitis = ?, aksiyon = ?, aciklama = ?, sahis = ? WHERE id = ?",
      [tarih, saatBaslangic, saatBitis, aksiyon, aciklama || null, sahis || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Kayit bulunamadi." });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
});

app.delete("/api/gun-akisi/:id", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) {
    return res.status(422).json({ success: false, message: "Gecersiz veri." });
  }

  try {
    const [result] = await pool.query("DELETE FROM gun_akisi WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Kayit bulunamadi." });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
});

app.get("/list", requireLogin, async (req, res) => {
  try {
    const currentUserId = await resolveCurrentUserId(req);
    const viewer = isViewer(req);
    const admin = isAdmin(req);
    const baseUrl = getPublicBaseUrl(req);
    const guestSql = viewer
      ? `SELECT g.id, g.name, g.city, g.status, g.user_id, g.invite_token, g.party_size, g.rsvp_note, g.rsvp_at, u.username AS kullanici
         FROM guests g
         LEFT JOIN users u ON u.id = g.user_id
         ORDER BY g.name ASC, g.id ASC`
      : `SELECT g.id, g.name, g.phone, g.email, g.city, g.status, g.user_id, g.invite_token, g.party_size, g.rsvp_note, g.rsvp_at, u.username AS kullanici
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
    res.status(500).send("Sunucu hatasi: " + err.message);
  }
});

app.get("/davet/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(404).send("Davet bulunamadi.");
  try {
    const [rows] = await pool.query(
      "SELECT id, name, party_size, rsvp_note, rsvp_at, status FROM guests WHERE invite_token = ? LIMIT 1",
      [token]
    );
    const guest = rows[0];
    if (!guest) return res.status(404).send("Davet bulunamadi veya suresi dolmus.");
    res.set("Cache-Control", "no-store");
    res.render("rsvp", {
      token,
      guest,
      submitted: req.query.ok === "1",
      error: ""
    });
  } catch (err) {
    res.status(500).send("Sunucu hatasi: " + err.message);
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
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
});

app.post("/api/rsvp/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const guestId = Number(req.body.guest_id || 0);
  const typedName = String(req.body.name || "").trim();
  const notAttending = req.body.not_attending === true || req.body.not_attending === "true";
  const partySize = Number(req.body.party_size ?? (notAttending ? 0 : 1));
  const note = String(req.body.note || "").trim().slice(0, 500);

  if (!token || !guestId || !typedName) {
    return res.status(422).json({ success: false, message: "Lutfen isminizi secin veya yazin." });
  }
  if (notAttending) {
    if (!Number.isInteger(partySize) || partySize !== 0) {
      return res.status(422).json({ success: false, message: "Gecersiz katilim bilgisi." });
    }
  } else if (!Number.isInteger(partySize) || partySize < 1 || partySize > 5) {
    return res.status(422).json({ success: false, message: "Kisi sayisi 1 ile 5 arasinda olmalidir." });
  }

  try {
    const [tokenRows] = await pool.query("SELECT id, name FROM guests WHERE invite_token = ? LIMIT 1", [token]);
    const invitedGuest = tokenRows[0];
    if (!invitedGuest) {
      return res.status(404).json({ success: false, message: "Davet bulunamadi." });
    }

    const [selectedRows] = await pool.query("SELECT id, name FROM guests WHERE id = ? LIMIT 1", [guestId]);
    const selectedGuest = selectedRows[0];
    if (!selectedGuest) {
      return res.status(404).json({ success: false, message: "Secilen isim bulunamadi." });
    }

    const matchScore = scoreGuestNameMatch(typedName, selectedGuest.name);
    if (matchScore < 45) {
      return res.status(422).json({ success: false, message: "Yazdiginiz isim secilen kayitla uyusmuyor." });
    }

    if (Number(invitedGuest.id) !== Number(selectedGuest.id)) {
      const invitedScore = scoreGuestNameMatch(selectedGuest.name, invitedGuest.name);
      if (invitedScore < 55) {
        return res.status(422).json({
          success: false,
          message: "Bu davet linki baska bir kisiye ait. Lutfen size gonderilen linki kullanin."
        });
      }
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
      message: notAttending
        ? "Katilamayacaginiz kaydedildi. Tesekkur ederiz."
        : "Katiliminiz kaydedildi. Tesekkur ederiz!",
      guest: {
        id: selectedGuest.id,
        name: selectedGuest.name,
        party_size: notAttending ? 0 : partySize,
        status: notAttending ? 3 : 1
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/update", requireEditor, async (req, res) => {
  const id = Number(req.body.id || 0);
  const status = Number(req.body.status || 0);
  if (!id || ![1, 2, 3].includes(status)) {
    return res.status(422).json({ success: false, message: "Gecersiz veri." });
  }

  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: "Kayit bulunamadi." });
    }
    const guestUserId = guest.user_id == null ? null : Number(guest.user_id);
    if (!canManageGuest(req, guestUserId)) {
      return res.status(403).json({ success: false, message: "Bu kaydi guncelleme yetkiniz yok." });
    }
    await pool.query("UPDATE guests SET status = ? WHERE id = ?", [status, id]);
    const stats = await fetchGuestStats();
    return res.json({
      success: true,
      stats: statsPayload(stats)
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
});

function statsPayload(stats) {
  return {
    count_1: stats.count1,
    count_2: stats.count2,
    count_3: stats.count3,
    total_guests: stats.totalGuests,
    occupancy_rate: stats.occupancyRate,
    confirmed_persons: stats.confirmedPersons
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
    return res.status(422).json({ success: false, message: "Gecersiz veri." });
  }

  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: "Kayit bulunamadi." });
    }
    const guestUserId = guest.user_id == null ? null : Number(guest.user_id);
    if (!canManageGuest(req, guestUserId)) {
      return res.status(403).json({ success: false, message: "Bu kaydi guncelleme yetkiniz yok." });
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
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
}

app.put("/api/guest/:id", requireEditor, handleGuestSave);
app.post("/api/guest/:id", requireEditor, handleGuestSave);

app.delete("/api/guest/:id", requireEditor, async (req, res) => {
  const id = Number(req.params.id || 0);
  const currentUserId = Number(await resolveCurrentUserId(req) || 0);
  if (!id) {
    return res.status(422).json({ success: false, message: "Gecersiz veri." });
  }

  try {
    const [rows] = await pool.query("SELECT user_id FROM guests WHERE id = ? LIMIT 1", [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).json({ success: false, message: "Kayit bulunamadi." });
    }
    const guestUserId = guest.user_id == null ? null : Number(guest.user_id);
    const canDelete = canManageGuest(req, guestUserId);
    if (!canDelete) {
      return res.status(403).json({ success: false, message: "Bu kaydi silme yetkiniz yok." });
    }

    await pool.query("DELETE FROM guests WHERE id = ?", [id]);
    const stats = await fetchGuestStats();
    return res.json({ success: true, stats: statsPayload(stats) });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Sunucu hatasi: " + err.message });
  }
});

Promise.all([ensureSeedUsers(), ensureGunAkisiTable(), ensureGuestRsvpColumns()])
  .catch((err) => {
    console.error("Baslangic kurulum hatasi:", err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
