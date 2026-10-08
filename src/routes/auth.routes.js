const router = require('express').Router();
const { asyncHandler } = require('../utils/asyncHandler');
const { login } = require('../controllers/auth.controller');

router.post('/login', asyncHandler(login));

module.exports = router;
