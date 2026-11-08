import express from "express";
import crypto from "crypto";
import { stopExpiredSpaces } from "../../utils/auto-stop.js";
import { deleteExpiredSessions } from "../../utils/sessions.js";
import { rebuildTemplates } from "../../utils/templates.js";
import { spaceConfigs } from "../../utils/spaces.js";

const router = express.Router();

const requireCronSecret = (req, res, next) => {
  const cronSecret = process.env.CRON_SECRET;

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const given = Buffer.from(req.headers.authorization || "");
  if (!cronSecret || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ success: false });
  }

  next();
};

router.get("/auto-stop", requireCronSecret, async (req, res) => {
  const summary = await stopExpiredSpaces();
  const expiredSessions = await deleteExpiredSessions();
  res.status(200).json({ success: true, ...summary, expiredSessions });
});

router.get("/templates", requireCronSecret, async (req, res) => {
  const templates = await rebuildTemplates(spaceConfigs);
  for (const template of templates.filter((result) => !result.ok)) {
    console.error(`Failed to rebuild the ${template.type} template:`, template.error);
  }
  res.status(200).json({ success: templates.every((result) => result.ok), templates });
});

export default router;
