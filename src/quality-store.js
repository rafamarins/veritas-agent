import { DurableObject } from 'cloudflare:workers';
import { reviewQuestions } from './retrieval.js';

const utcDay = () => new Date().toISOString().slice(0, 10);
const maxChatRequests = 200;
const reviewSeeds = ['inspect-1', 'budget-2', 'deposit-1', 'decide-6'];

export class VeritasQuality extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS budget (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS replies (id TEXT PRIMARY KEY, day TEXT NOT NULL, topic TEXT, mode TEXT NOT NULL, vote INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS replies_day_topic ON replies(day,topic);
      CREATE TABLE IF NOT EXISTS policies (topic TEXT PRIMARY KEY, style TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews (day TEXT PRIMARY KEY, id TEXT NOT NULL, started INTEGER NOT NULL, status TEXT NOT NULL, results TEXT NOT NULL);
    `);
  }
  style(topic) {
    return (
      this.sql
        .exec('SELECT style FROM policies WHERE topic=?', topic)
        .toArray()[0]?.style ?? 'standard'
    );
  }
  reserve(topic) {
    const allowed =
      this.sql
        .exec(
          'INSERT INTO budget VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<? RETURNING used',
          utcDay(),
          maxChatRequests,
        )
        .toArray().length > 0;
    return { allowed, style: this.style(topic ?? '') };
  }
  record(topic, mode) {
    const id = crypto.randomUUID();
    this.sql.exec(
      'INSERT INTO replies (id,day,topic,mode) VALUES(?,?,?,?)',
      id,
      utcDay(),
      reviewQuestions.has(topic) ? topic : null,
      mode,
    );
    return id;
  }
  vote(id, value) {
    if (![-1, 0, 1].includes(value)) return false;
    return (
      this.sql
        .exec(
          "UPDATE replies SET vote=? WHERE id=? AND day>=date(?, '-30 days') RETURNING id",
          value,
          id,
          utcDay(),
        )
        .toArray().length > 0
    );
  }
  pruneExpired(day) {
    for (const table of ['replies', 'budget', 'reviews'])
      this.sql.exec(
        'DELETE FROM ' + table + " WHERE day < date(?, '-30 days')",
        day,
      );
  }
  beginReview(day) {
    const current = this.sql
      .exec('SELECT status,started FROM reviews WHERE day=?', day)
      .toArray()[0];
    if (current?.status === 'complete') return null;
    if (current?.status === 'running' && Date.now() - current.started < 900000)
      return { running: true };
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO reviews VALUES(?,?,?,'running','[]') ON CONFLICT(day) DO UPDATE SET id=excluded.id, started=excluded.started, status='running', results='[]'",
      day,
      id,
      Date.now(),
    );
    const rows = this.sql
      .exec(
        `
      SELECT topic, SUM(CASE WHEN vote=-1 THEN 2 ELSE 0 END + CASE WHEN mode!='assistant' THEN 1 ELSE 0 END) AS trouble
      FROM replies WHERE topic IS NOT NULL AND day BETWEEN date(?, '-7 days') AND ? GROUP BY topic
      HAVING trouble > 0 ORDER BY trouble DESC, topic LIMIT 2`,
        day,
        day,
      )
      .toArray();
    const seed =
      reviewSeeds[
        Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000) %
          reviewSeeds.length
      ];
    const topics = [...new Set([...rows.map((r) => r.topic), seed])]
      .filter((t) => reviewQuestions.has(t))
      .slice(0, 2);
    return {
      id,
      topics: topics.map((topic) => ({ topic, style: this.style(topic) })),
    };
  }
  completeReview(day, id, results, status) {
    return this.ctx.storage.transactionSync(() => {
      const changed = this.sql
        .exec(
          "UPDATE reviews SET status=?, results=? WHERE day=? AND id=? AND status='running' RETURNING id",
          status,
          JSON.stringify(results),
          day,
          id,
        )
        .toArray().length;
      if (!changed) return false;
      for (const r of results)
        if (r.decision === 'promote') {
          this.sql.exec(
            'INSERT INTO policies VALUES(?,?) ON CONFLICT(topic) DO UPDATE SET style=excluded.style',
            r.topic,
            r.alternate.style,
          );
        }
      return true;
    });
  }
}
