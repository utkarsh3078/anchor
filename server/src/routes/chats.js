import { Router } from 'express';
import { collection } from '../lib/db.js';
import { sendError, withGemini } from './common.js';

// Chats belong to the Gemini key that created them (stored as a short SHA-256 hash, never
// the key), so visitors only see their own history. No Gemini call is made here.
const router = Router();
router.use(withGemini);

async function messages(res) {
  const col = await collection('messages');
  if (!col) res.status(503).json({ error: 'history_unavailable', message: 'Chat history needs MONGODB_URI' });
  return col;
}

// Chats, newest first: [{ chatId, title (first question), messages, updatedAt }]
router.get('/', async (req, res) => {
  try {
    const col = await messages(res);
    if (!col) return;
    const chats = await col.aggregate([
      { $match: { owner: req.gemini.keyHash } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: '$chatId', title: { $first: '$query' }, messages: { $sum: 1 }, updatedAt: { $last: '$createdAt' } } },
      { $sort: { updatedAt: -1 } },
      { $limit: 100 },
    ]).toArray();
    res.json(chats.map(({ _id, ...c }) => ({ chatId: _id, ...c })));
  } catch (e) {
    sendError(res, e);
  }
});

// One chat's messages, oldest first
router.get('/:chatId', async (req, res) => {
  try {
    const col = await messages(res);
    if (!col) return;
    const rows = await col.find({ chatId: req.params.chatId, owner: req.gemini.keyHash }, { projection: { _id: 0, owner: 0 } })
      .sort({ createdAt: 1 }).toArray();
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: 'Chat not found' });
    res.json(rows);
  } catch (e) {
    sendError(res, e);
  }
});

router.delete('/:chatId', async (req, res) => {
  try {
    const col = await messages(res);
    if (!col) return;
    const { deletedCount } = await col.deleteMany({ chatId: req.params.chatId, owner: req.gemini.keyHash });
    res.json({ deleted: deletedCount });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
