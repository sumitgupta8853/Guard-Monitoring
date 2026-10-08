const router = require('express').Router();
const { requireAuth } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const sites = require('../controllers/admin.sites.controller');
const guards = require('../controllers/admin.guards.controller');
const reports = require('../controllers/admin.reports.controller');

router.use(requireAuth('admin'));

// ---------- sites ----------
router.post('/sites', asyncHandler(sites.createSite));
router.get('/sites', asyncHandler(sites.listSites));
router.put('/sites/:id', asyncHandler(sites.updateSite));
router.delete('/sites/:id', asyncHandler(sites.deleteSite));

// ---------- guard profiles ----------
router.post('/guards', asyncHandler(guards.createGuard));
router.get('/guards', asyncHandler(guards.listGuards));
router.get('/guards/:id', asyncHandler(guards.getGuard));
router.put('/guards/:id', asyncHandler(guards.updateGuard));
router.delete('/guards/:id', asyncHandler(guards.deleteGuard));
router.post(
  '/guards/:id/photo',
  sites.uploadAvatar.single('photo'),
  asyncHandler(guards.uploadGuardPhoto)
);

// ---------- live view, dashboard ----------
router.get('/live', asyncHandler(reports.live));
router.get('/dashboard', asyncHandler(reports.dashboard));

// ---------- attendance ----------
router.get('/attendance', asyncHandler(reports.listAttendance));
router.get('/attendance/:id', asyncHandler(reports.getAttendance));
router.get('/attendance/:id/trail', asyncHandler(reports.trail));
router.post('/attendance/:id/close', asyncHandler(reports.closeAttendance));

// ---------- alerts ----------
router.get('/alerts', asyncHandler(reports.listAlerts));
router.post('/alerts/:id/ack', asyncHandler(reports.ackAlert));

module.exports = router;
