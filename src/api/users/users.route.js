import express from "express"; 
import auth from './auth.route.js';
import update from './update.route.js';
import clubAuth from './club-auth.route.js';


const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    message: 'Users API Route',
  });
});
 
router.use('/', auth);
router.use('/', clubAuth);
router.use('/update', update);
export default router;