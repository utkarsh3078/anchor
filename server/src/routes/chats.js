import { Router } from 'express';
import { collection } from '../lib/db.js';

const router = Router();

async function messages(res) {
  const col = await collection('messages');
  if (!col) res.status(503).json({ error: 'Chat history needs MONGODB_URI' });
  return col;
}

// Chats, newest first: [{ chatId, title (first question), messages, updatedAt }]
router.get('/', async (_req, res) => {
  try {
    const col = await messages(res);
    if (!col) return;
    const chats = await col.aggregate([
      { $sort: { createdAt: 1 } },
      { $group: { _id: '$chatId', title: { $first: '$query' }, messages: { $sum: 1 }, updatedAt: { $last: '$createdAt' } } },
      { $sort: { updatedAt: -1 } },
      { $limit: 100 },
    ]).toArray();
    res.json(chats.map(({ _id, ...c }) => ({ chatId: _id, ...c })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// One chat's messages, oldest first
router.get('/:chatId', async (req, res) => {
  try {
    const col = await messages(res);
    if (!col) return;
    const rows = await col.find({ chatId: req.params.chatId }, { projection: { _id: 0 } })
      .sort({ createdAt: 1 }).toArray();
    if (!rows.length) return res.status(404).json({ error: 'Chat not found' });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:chatId', async (req, res) => {
  try {
    const col = await messages(res);
    if (!col) return;
    const { deletedCount } = await col.deleteMany({ chatId: req.params.chatId });
    res.json({ deleted: deletedCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
