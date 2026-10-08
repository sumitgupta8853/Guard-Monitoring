const mongoose = require('mongoose');
const { withId } = require('./_base');

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'guard'], required: true, index: true },
    guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', default: null, index: true },
    disabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

withId(userSchema);

module.exports = mongoose.model('User', userSchema);
