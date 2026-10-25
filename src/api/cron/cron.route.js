import express from "express";
import { stopExpiredSpaces } from "../../utils/auto-stop.js";

const router = express.Router();

router.get("/auto-stop", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ success: false });
  }

  const summary = await stopExpiredSpaces();
  res.status(200).json({ success: true, ...summary });
});

export default router;
