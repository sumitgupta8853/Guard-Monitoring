const mongoose = require('mongoose');
const { withId } = require('./_base');

const locationSchema = new mongoose.Schema(
  {
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', required: true, index: true },
    guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', required: true, index: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: 0 },
    distanceMeters: { type: Number, default: 0 },
    time: { type: String, required: true }, // ISO; TTL keeps the trail bounded
  },
  { timestamps: true }
);

locationSchema.index({ attendanceId: 1, time: 1 });
locationSchema.index({ guardId: 1, time: -1 });

// Keep ~90 days of breadcrumbs; replaces the old in-memory 50k splice.
locationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

withId(locationSchema);

module.exports = mongoose.model('Location', locationSchema);
