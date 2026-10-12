// In-memory stand-in for the Firebase compat SDK — training-video harness only (based on scratchpad/fake-firebase-admin.js).
// The store is window.__LG_SEED (from the recorder). Writes stay in memory; the recorder reads window.__store back.
// Also: confirm/alert/prompt are recorded instead of shown (a browser dialog never appears in a screenshot — the
// compositor draws it from the recorded text), window.open/print are captured (the chisum report), and /api/ answers
// come from seed.__api (default: success).
(function () {
  const seed = window.__LG_SEED || {};
  const store = JSON.parse(JSON.stringify(seed.db || {}));
  const API = seed.__api || {};
  // a fixed clock (seed.__clock) — "אומתה ע״י נועה · 12.10 10:41" and not whatever time the recording ran
  if (seed.__clock) {
    const RD = Date, off = seed.__clock - RD.now();
    class FD extends RD {
      constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); }
      static now() { return RD.now() + off; }
    }
    window.Date = FD;
  }
  const NOW = seed.__clock || Date.now();
  window.__dialogs = [];
  window.__opened = [];
  window.__apiCalls = [];

  const parts = p => String(p || '').split('/').filter(Boolean);
  const get = p => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), store);
  const put = (p, v) => {
    const ks = parts(p); let o = store;
    if (!ks.length) return;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = (o[ks[i]] && typeof o[ks[i]] === 'object') ? o[ks[i]] : {};
    // like the real database: an empty object (or one whose children are all empty/null) is not stored
    const prune = x => {
      if (x === null || typeof x !== 'object') return x;
      const out = Array.isArray(x) ? [] : {};
      let any = false;
      for (const [k, val] of Object.entries(x)) { const c = prune(val); if (c !== undefined && c !== null) { out[k] = c; any = true; } }
      return any ? out : undefined;
    };
    const val = v === null || v === undefined ? undefined : prune(JSON.parse(JSON.stringify(v)));
    if (val === undefined) delete o[ks[ks.length - 1]];
    else o[ks[ks.length - 1]] = val;
  };
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const listeners = [];
  const snap = (key, v) => ({
    key, val: () => clone(v), exists: () => v !== undefined && v !== null,
    forEach(cb) { Object.keys(v || {}).forEach(k => cb(snap(k, v[k]))); },
    child: k => snap(k, (v || {})[k]), numChildren: () => Object.keys(v || {}).length,
  });
  function query(path, q) {
    const run = () => {
      let v = get(path);
      if (!q.by || !v || typeof v !== 'object') return v;
      let ks = Object.keys(v).sort((a, b) => ((v[a] || {})[q.by] ?? 0) < ((v[b] || {})[q.by] ?? 0) ? -1 : 1);
      if ('eq' in q) ks = ks.filter(k => (v[k] || {})[q.by] === q.eq);
      if (q.last) ks = ks.slice(-q.last);
      if (q.first) ks = ks.slice(0, q.first);
      const o = {}; ks.forEach(k => { o[k] = v[k]; }); return ks.length ? o : null;
    };
    const self = {
      key: parts(path).slice(-1)[0] || null,
      orderByChild: c => query(path, { ...q, by: c }), orderByKey: () => self, orderByValue: () => self,
      equalTo: x => query(path, { ...q, eq: x }), startAt: () => self, endAt: () => self,
      limitToLast: n => query(path, { ...q, last: n }), limitToFirst: n => query(path, { ...q, first: n }),
      child: c => ref(parts(path).concat(parts(c)).join('/')),
      once: async () => snap(self.key, run()),
      get: async () => snap(self.key, run()),
      on(ev, cb) { listeners.push({ path, cb, run, key: self.key }); setTimeout(() => cb(snap(self.key, run())), 30); return cb; },
      off() {},
      set: async v => { put(path, v); notify(); },
      update: async u => { Object.entries(u).forEach(([k, v]) => put(parts(path).concat(parts(k)).join('/'), v)); notify(); },
      remove: async () => { put(path, null); notify(); },
      push(v) { const k = 'k' + Date.now() + Math.random().toString(36).slice(2, 6); const r = ref(path + '/' + k); if (v !== undefined) r.set(v); return r; },
      transaction: async fn => {
        const n = fn(clone(get(path)));
        if (n !== undefined) { put(path, n); notify(); }
        return { committed: n !== undefined, snapshot: snap(self.key, get(path)) };
      },
    };
    return self;
  }
  const ref = p => query(p || '', {});
  function notify() { setTimeout(() => listeners.forEach(l => l.cb(snap(l.key, l.run()))), 20); }
  window.__store = store;

  const email = (seed.__session || '0500000000') + '@luzglass.local';
  const user = { uid: 'u-' + email, email, getIdToken: async () => 'fake' };
  const auth = {
    currentUser: user, onAuthStateChanged(cb) { setTimeout(() => cb(user), 10); return () => {}; },
    signOut: async () => {}, setPersistence: async () => {}, signInWithEmailAndPassword: async () => ({ user }),
  };
  const database = () => ({ ref, goOnline() {}, goOffline() {} });
  database.ServerValue = { TIMESTAMP: NOW, increment: n => n };
  const authFn = () => auth; authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  window.firebase = { apps: [], initializeApp(c) { this.apps.push(c); return this; }, app() { return this; }, database, auth: authFn };

  // /api/ — the server functions do not exist here. Each answer comes from seed.__api[<path>], default success.
  const realFetch = window.fetch;
  window.fetch = (u, o) => {
    const url = String(u);
    const m = url.match(/^\/?api\/([^?]+)/) || url.match(/^https?:\/\/[^/]+\/api\/([^?]+)/);
    if (!m) return realFetch(u, o);
    let body = null; try { body = o && o.body ? JSON.parse(o.body) : null; } catch (e) { body = o && o.body; }
    window.__apiCalls.push({ path: m[1], body });
    const ans = API[m[1]] || { ok: true, queued: true, processed: 0, remaining: 0, results: [] };
    return Promise.resolve(new Response(JSON.stringify(ans), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };

  // browser dialogs — recorded, answered "yes"
  window.confirm = msg => { window.__dialogs.push({ kind: 'confirm', msg: String(msg) }); return true; };
  window.alert   = msg => { window.__dialogs.push({ kind: 'alert',   msg: String(msg) }); };
  window.prompt  = (msg, d) => { window.__dialogs.push({ kind: 'prompt', msg: String(msg) }); return d || ''; };
  // print windows — captured as HTML for the recorder
  window.open = () => {
    const doc = { html: '', write(s) { this.html += s; }, writeln(s) { this.html += s + '\n'; }, open() {}, close() {} };
    const w = { document: doc, closed: false, close() { this.closed = true; }, focus() {}, print() {}, location: { href: '' },
                addEventListener() {}, onload: null };
    window.__opened.push(w);
    return w;
  };
  window.print = () => {};
})();
