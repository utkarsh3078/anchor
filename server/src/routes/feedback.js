import { Router } from 'express';
import { collection } from '../lib/db.js';
import { parseFeedback, saveFeedback } from '../lib/feedback.js';
import { limitFeedback } from '../lib/limits.js';
import { sendError, withGemini } from './common.js';

const router = Router();

// "Was this helpful?" under an answer. Body: { messageId, rating: 'up' | 'down' | null,
// comment? }. The key must be the one that asked (X-Gemini-Key); no Gemini call is made.
// null takes the rating back. 404 when the answer isn't this key's, 503 without MongoDB.
router.post('/', withGemini, limitFeedback, async (req, res) => {
  try {
    const fb = parseFeedback(req.body);
    const col = await collection('messages');
    if (!col) return res.status(503).json({ error: 'feedback_unavailable', message: 'Ratings can’t be saved right now (MongoDB not configured or unreachable)' });
    const found = await saveFeedback(col, { owner: req.gemini.keyHash, ...fb });
    if (!found) return res.status(404).json({ error: 'not_found', message: 'Answer not found' });
    res.json({ messageId: fb.messageId, rating: fb.rating, comment: fb.comment });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
