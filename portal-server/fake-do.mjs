// A tiny in-memory stand-in for a Durable Object, used by the tests and by dev.mjs.
import worker, { Portal } from './worker.js';
export class FakeStorage {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  async put(k, v) { this.m.set(k, JSON.parse(JSON.stringify(v))); }
  async delete(k) { return this.m.delete(k); }
  async list({ prefix = '' } = {}) { const out = new Map(); [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().forEach((k) => out.set(k, JSON.parse(JSON.stringify(this.m.get(k))))); return out; }
}
export function makeEnv(extra = {}) {
  const portal = new Portal({ storage: new FakeStorage() }, extra);
  const env = { ...extra, PORTAL: { idFromName: () => 'x', get: () => ({ fetch: (req) => portal.fetch(req) }) } };
  portal.env = env;
  return env;
}
export { worker };
