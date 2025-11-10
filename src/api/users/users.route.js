import express from "express"; 
import auth from './auth.route.js';
import update from './update.route.js';


const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    message: 'Users API Route',
  });
});
 
router.use('/', auth);
router.use('/update', update);
export default router;