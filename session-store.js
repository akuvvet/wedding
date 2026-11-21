// Oturumlari MySQL'de saklar (express-session icin). Boylece uygulama yeniden baslasa da
// kullanicilar cikis yapmis olmaz ve "Beni hatirla" 30 gun boyunca gecerli kalir.
// Ek paket gerektirmez; uygulamanin mevcut veritabani baglantisini kullanir.
const session = require("express-session");

const TABLE = "sessions";
// "Beni hatirla" isaretsiz oturumlar (tarayici kapaninca biten cerez) sunucuda
// son islemden bu kadar sure sonra silinir.
const IDLE_MS = 12 * 60 * 60 * 1000;
const CLEANUP_MS = 60 * 60 * 1000;

class MySqlSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    this.ready = pool.query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (
         sid VARCHAR(128) NOT NULL PRIMARY KEY,
         expires BIGINT UNSIGNED NOT NULL,
         data MEDIUMTEXT NOT NULL,
         INDEX idx_sessions_expires (expires)
       ) DEFAULT CHARSET=utf8mb4`
    );
    this.ready.catch((err) => console.error("session table:", err.message));
    const timer = setInterval(() => this.cleanup().catch(() => {}), CLEANUP_MS);
    if (timer.unref) timer.unref();
  }

  // Cerezin bitis zamani varsa o, yoksa (tarayici oturumu) simdi + IDLE_MS.
  expiry(sess) {
    const raw = sess && sess.cookie && sess.cookie.expires;
    const time = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(time) ? time : Date.now() + IDLE_MS;
  }

  run(work, cb) {
    this.ready
      .then(work)
      .then(
        (value) => cb && process.nextTick(() => cb(null, value)),
        (err) => cb && process.nextTick(() => cb(err))
      );
  }

  get(sid, cb) {
    this.run(async () => {
      const [rows] = await this.pool.query(`SELECT data, expires FROM ${TABLE} WHERE sid = ? LIMIT 1`, [sid]);
      if (!rows[0] || Number(rows[0].expires) <= Date.now()) return null;
      try {
        return JSON.parse(rows[0].data);
      } catch (_) {
        return null;
      }
    }, cb);
  }

  set(sid, sess, cb) {
    this.run(async () => {
      await this.pool.query(
        `INSERT INTO ${TABLE} (sid, expires, data) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
        [sid, this.expiry(sess), JSON.stringify(sess)]
      );
    }, cb);
  }

  touch(sid, sess, cb) {
    this.run(async () => {
      await this.pool.query(`UPDATE ${TABLE} SET expires = ? WHERE sid = ?`, [this.expiry(sess), sid]);
    }, cb);
  }

  destroy(sid, cb) {
    this.run(async () => {
      await this.pool.query(`DELETE FROM ${TABLE} WHERE sid = ?`, [sid]);
    }, cb);
  }

  async cleanup() {
    await this.ready;
    await this.pool.query(`DELETE FROM ${TABLE} WHERE expires < ?`, [Date.now()]);
  }
}

module.exports = { MySqlSessionStore };
