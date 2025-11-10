import express from "express"; 
import spaces from './spaces/space.route.js';
import users from './users/users.route.js';
import admin from './admin/admin.route.js';


const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    message: 'API :3',
  });
});

router.use('/spaces/', spaces);
router.use('/users/', users);
router.use('/admin/', admin);
export default router;