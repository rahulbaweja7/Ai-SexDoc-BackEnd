const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Trace = require('../utils/models/Trace');

const DAY = 24 * 60 * 60 * 1000;

// GET /stats — observability aggregates from the trace collection.
// No user questions/answers are stored, so this is safe to expose read-only.
router.get('/', async (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ db: false, message: 'No database connection — traces unavailable.' });
  }
  try {
    const since = new Date(Date.now() - DAY);
    const sumTokens = { $sum: { $add: ['$promptTokens', '$completionTokens'] } };

    const [total, last24h, byRoute, allTime, day, escalations, recent] = await Promise.all([
      Trace.countDocuments(),
      Trace.countDocuments({ createdAt: { $gte: since } }),
      Trace.aggregate([{ $group: { _id: '$route', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Trace.aggregate([{ $group: { _id: null, tokens: sumTokens, cost: { $sum: '$costUsd' }, avgTotalMs: { $avg: '$totalMs' }, avgGenMs: { $avg: '$generationMs' } } }]),
      Trace.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, tokens: sumTokens, cost: { $sum: '$costUsd' } } }]),
      Trace.countDocuments({ route: { $regex: '^emergency' } }),
      Trace.find().sort({ createdAt: -1 }).limit(20).select('-__v -_id'),
    ]);

    const round = (n, d = 2) => (n == null ? 0 : Math.round(n * 10 ** d) / 10 ** d);
    const at = allTime[0] || {};
    const d24 = day[0] || {};

    res.json({
      db: true,
      total,
      last24h,
      escalations,
      byRoute: byRoute.map(r => ({ route: r._id, count: r.count })),
      tokens: { total: at.tokens || 0, last24h: d24.tokens || 0 },
      cost: { total: round(at.cost || 0, 4), last24h: round(d24.cost || 0, 4) },
      latency: { avgTotalMs: round(at.avgTotalMs || 0, 0), avgGenMs: round(at.avgGenMs || 0, 0) },
      recent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
