import express from "express";
import { 
  createContainer, 
  startContainer, 
  stopContainer, 
  getContainerStatus,
  getUserSpaces,
  deleteSpace
} from "../../utils/spaces.js";
import { containerOpsLimiter } from "../../middlewares/rate-limit.middleware.js";

const router = express.Router();

router.post("/create", /* containerOpsLimiter, */ async (req, res) => {
  const { password, type } = req.body;
  const authorization = req.headers.authorization;
  
  try {
    const result = await createContainer(password, type, authorization);
    res.json(result);
  } catch (err) {
    if (err.validTypes) {
      return res.status(400).json({ 
        error: err.message, 
        validTypes: err.validTypes
      });
    }
    
    const statusCode = err.statusCode || (err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.post("/start/:spaceId", /* containerOpsLimiter, */ async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await startContainer(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.post("/stop/:spaceId", /* containerOpsLimiter, */ async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await stopContainer(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.get("/status/:spaceId", async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await getContainerStatus(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

// GET /api/v1/spaces/list - List all spaces for authenticated user
router.get("/list", async (req, res) => {
  const authorization = req.headers.authorization;
  
  try {
    const spaces = await getUserSpaces(authorization);
    res.json({
      message: "Spaces retrieved successfully",
      spaces
    });
  } catch (err) {
    const statusCode = err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

router.delete("/delete/:spaceId", async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await deleteSpace(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

export default router;
