// Photos are private: admins can open any folder, a guard only their own.
const router = require('express').Router();
const { requireAuth } = require('../middlewares/auth');
const { queryTokenAuth } = require('../middlewares/uploadAuth');
const { serveFile } = require('../controllers/files.controller');

// <img> tags can't send headers, so allow the token in the query here only
router.use(queryTokenAuth);
router.use(requireAuth('admin', 'guard'));

router.get('/:folder/:name', serveFile);

module.exports = router;
