const mongoose = require('mongoose');
const { withId } = require('./_base');

const alertSchema = new mongoose.Schema(
  {
    guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', index: true, default: null },
    guardName: { type: String, default: '' },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', default: null },
    type: {
      type: String,
      required: true,
      enum: ['LEFT_AREA', 'STILL_OUTSIDE', 'RETURNED', 'NO_SIGNAL', 'NOT_CHECKED_IN', 'FAKE_GPS'],
      index: true,
    },
    message: { type: String, required: true },
    time: { type: String, required: true }, // ISO
    acknowledged: { type: Boolean, default: false, index: true },
    acknowledgedBy: { type: String, default: null },
    acknowledgedAt: { type: String, default: null },
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null },
    distanceMeters: { type: Number, default: null },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { timestamps: true }
);

alertSchema.index({ guardId: 1, time: -1 });
alertSchema.index({ acknowledged: 1, time: -1 });

withId(alertSchema);

module.exports = mongoose.model('Alert', alertSchema);
