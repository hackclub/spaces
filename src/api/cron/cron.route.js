import express from "express";
import crypto from "crypto";
import { stopExpiredSpaces } from "../../utils/auto-stop.js";

const router = express.Router();

router.get("/auto-stop", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const given = Buffer.from(req.headers.authorization || "");
  if (!cronSecret || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ success: false });
  }

  const summary = await stopExpiredSpaces();
  res.status(200).json({ success: true, ...summary });
});

export default router;
