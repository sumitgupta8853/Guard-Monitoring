const bcrypt = require('bcryptjs');
const cfg = require('../config');
const User = require('../models/User.model');

async function seedAdmin() {
  const existing = await User.findOne({ role: 'admin' });
  if (!existing) {
    await User.create({
      username: cfg.ADMIN_USER,
      passwordHash: bcrypt.hashSync(cfg.ADMIN_PASS, 10),
      role: 'admin',
    });
    console.log(`Admin account created: username "${cfg.ADMIN_USER}"`);
  }
}

module.exports = { seedAdmin };
