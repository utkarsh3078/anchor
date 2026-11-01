import { Router } from 'express';
import { listTextModels } from '../lib/gemini.js';
import { config } from '../config.js';
import { sendError, withGemini } from './common.js';

const router = Router();

// The client's key gate: send X-Gemini-Key; 200 means the key works, and the list fills
// the model picker. 401 gemini_key_invalid means ask again. Lists models only (a
// metadata call), it does not generate text.
router.get('/models', withGemini, async (req, res) => {
  try {
    const models = await listTextModels(req.gemini);
    res.json({ models, defaultModel: config.gemini.genModel });
  } catch (e) {
    sendError(res, e);
  }
});

export default router;
