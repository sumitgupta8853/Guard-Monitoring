const router = require('express').Router();
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { uploader } = require('../uploads/uploader');
const profile = require('../controllers/guard.profile.controller');
const attendance = require('../controllers/guard.attendance.controller');
const loc = require('../controllers/guard.location.controller');

router.use(requireAuth('guard'));

router.get('/me', asyncHandler(profile.me));
router.post('/change-password', asyncHandler(profile.changePassword));
router.post(
  '/attendance/check-in',
  uploader('attendance').single('photo'),
  asyncHandler(attendance.checkIn)
);
router.post(
  '/attendance/check-out',
  uploader('attendance').single('photo'),
  asyncHandler(attendance.checkOut)
);
router.post('/location', asyncHandler(loc.location));
router.get('/attendance', asyncHandler(profile.history));

module.exports = router;
