const router = require('express').Router();
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const push = require('../controllers/push.controller');

// Both guards and admins register here — role comes from the JWT.
// requireAuth() with no role arg = any logged-in user.
router.post('/token', requireAuth(), asyncHandler(push.register));
router.delete('/token', requireAuth(), asyncHandler(push.remove));
router.get('/status', requireAuth(), asyncHandler(push.status));
router.post('/test', requireAuth(), asyncHandler(push.test));

module.exports = router;