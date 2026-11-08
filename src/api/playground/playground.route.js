import express from 'express';
import pg from '../../utils/db.js';
import { getUser } from '../../utils/user.js';
import { extractAuth } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(extractAuth);

export const PLAYGROUND_TOOLS = ['love2d'];

router.post('/visit', async (req, res) => {
  try {
    const user = await getUser(req.authToken);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const tool = req.body?.tool ?? null;
    if (tool !== null && !PLAYGROUND_TOOLS.includes(tool)) {
      return res.status(400).json({ error: 'Unknown tool' });
    }

    await pg('playground_visits').insert({ user_id: user.id, tool });
    res.json({ success: true });
  } catch (err) {
    console.error('Error recording playground visit:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
