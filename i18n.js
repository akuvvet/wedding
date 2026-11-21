const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "locales");
// Varsayilan dil Turkce; Almanca ve Ingilizce de secilebilir (panel ve davetiye sayfasi).
const SUPPORTED = new Set(["tr", "de", "en"]);
const DEFAULT_LOCALE = "tr";
const DATE_LOCALES = { tr: "tr-TR", de: "de-DE", en: "en-GB" };
const LANG_COOKIE = "lang";
const LANG_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const messagesByLocale = {};

function loadLocale(locale) {
  const safe = SUPPORTED.has(locale) ? locale : DEFAULT_LOCALE;
  if (!messagesByLocale[safe]) {
    const filePath = path.join(LOCALES_DIR, `${safe}.json`);
    messagesByLocale[safe] = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  return messagesByLocale[safe];
}

function getNested(obj, key) {
  return key.split(".").reduce((acc, part) => (acc && acc[part] != null ? acc[part] : undefined), obj);
}

function interpolate(str, vars = {}) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : ""));
}

function createTranslator(locale) {
  const messages = loadLocale(locale);
  return (key, vars) => {
    const value = getNested(messages, key);
    if (value == null) return key;
    return interpolate(value, vars);
  };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

function resolveLocale(req) {
  const queryLang = String(req.query?.lang || "").trim().toLowerCase();
  if (SUPPORTED.has(queryLang)) return queryLang;
  const cookieLang = parseCookies(req.headers?.cookie)[LANG_COOKIE];
  if (SUPPORTED.has(cookieLang)) return cookieLang;
  return DEFAULT_LOCALE;
}

function setLangCookie(res, locale) {
  res.setHeader(
    "Set-Cookie",
    `${LANG_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`
  );
}

function guestLocaleMiddleware(req, res, next) {
  const queryLang = String(req.query?.lang || "").trim().toLowerCase();
  if (SUPPORTED.has(queryLang)) {
    setLangCookie(res, queryLang);
    req.locale = queryLang;
  } else {
    req.locale = resolveLocale(req);
  }

  const messages = loadLocale(req.locale);
  const t = createTranslator(req.locale);
  req.t = t;
  res.locals.locale = req.locale;
  res.locals.t = t;
  res.locals.i18n = messages;
  next();
}

// Dugun salonu: adres, yol tarifi linki, takvim kaydindaki yol suresi ve hatirlatmalar (ICS sure bicimi).
const WEDDING_VENUE = {
  venueName: "Visaal Event Location",
  address: "Obergath 154, 47805 Krefeld-Fischeln",
  travelMinutes: 30,
  reminders: ["P1D", "PT1H"]
};
// Takvim kaydi ve yol tarifi icin: salon adi + adres.
WEDDING_VENUE.location = `${WEDDING_VENUE.venueName}, ${WEDDING_VENUE.address}`;
WEDDING_VENUE.mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(WEDDING_VENUE.location)}`;

function getWeddingCalendar(locale) {
  const t = createTranslator(locale);
  return {
    ...WEDDING_VENUE,
    title: t("calendar.title"),
    description: t("calendar.description"),
    icsFilename: t("calendar.icsFilename"),
    date: "20270116",
    start: "170000",
    // Gece yarisinda biter: bitis ertesi gunun 00:00'i.
    endDate: "20270117",
    end: "000000",
    timezone: "Europe/Berlin"
  };
}

function localeDateTimeFormat(locale) {
  return DATE_LOCALES[locale] || DATE_LOCALES[DEFAULT_LOCALE];
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED,
  createTranslator,
  guestLocaleMiddleware,
  getWeddingCalendar,
  localeDateTimeFormat,
  resolveLocale
};
