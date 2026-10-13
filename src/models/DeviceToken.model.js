const mongoose = require('mongoose');
const { withId } = require('./_base');

// One row per (user, device). A guard or admin can have many devices
// (phone + spare + web). Token is the FCM registration token and rotates,
// so we upsert by (userId + deviceId) when deviceId is known, else by token.
const deviceTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', default: null, index: true },
    role: { type: String, enum: ['admin', 'guard'], required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    deviceId: { type: String, default: null, index: true },
    appVersion: { type: String, default: null },
    lastRegisteredAt: { type: String, default: null }, // ISO
  },
  { timestamps: true }
);

deviceTokenSchema.index({ userId: 1, deviceId: 1 });

withId(deviceTokenSchema);

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
