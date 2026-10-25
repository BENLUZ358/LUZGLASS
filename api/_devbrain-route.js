'use strict';
const { handleRelay } = require('./_devbrain-relay');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let database;
    const deps = {
      // Lazy getter: handleRelay authenticates and validates scope before any Firebase access.
      get db() {
        if (database) return database;
        const { initializeApp, cert, getApps } = require('firebase-admin/app');
        const { getDatabase } = require('firebase-admin/database');
        const { lgDatabaseUrl } = require('./_env');
        const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        const app = getApps().length ? getApps()[0] : initializeApp({ projectId: account.project_id,
          credential: cert(account), databaseURL: lgDatabaseUrl() });
        if (app.options.projectId !== account.project_id && app.options.credential.projectId !== account.project_id) throw new Error('project mismatch');
        database = getDatabase(app);
        return database;
      },
      customer: raw => {
        const { waitUntil } = require('@vercel/functions');
        return require('./wa-inbound').handleCustomerInbound(raw, { db: deps.db, waitUntil });
      },
    };
    const r = await handleRelay(req, deps);
    return res.status(r.status).json(r.body);
  } catch (_) { return res.status(500).json({ error: 'relay unavailable' }); }
};
module.exports.handleRelay = handleRelay;
