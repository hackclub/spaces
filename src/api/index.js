import express from "express"; 
import spaces from './spaces/space.route.js';
import auth from './users/auth.route.js';


const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    message: 'API :3',
  });
});

router.use('/spaces/', spaces);
router.use('/users/', auth);
export default router;