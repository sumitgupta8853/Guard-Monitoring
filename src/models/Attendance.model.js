const mongoose = require('mongoose');
const { withId } = require('./_base');

const violationSchema = new mongoose.Schema(
  {
    startedAt: { type: String, required: true }, // ISO
    endedAt: { type: String, default: null },
    seconds: { type: Number, default: 0 },
    maxDistance: { type: Number, default: 0 },
    escalated: { type: Boolean, default: false },
  },
  { _id: true }
);

const pointSchema = new mongoose.Schema(
  {
    lat: Number,
    lng: Number,
    accuracy: Number,
    distanceMeters: Number,
  },
  { _id: false }
);

const hourlyPhotoSchema = new mongoose.Schema(
  {
    at: { type: String, required: true }, // ISO upload time
    photo: { type: String, required: true }, // stored filename under uploads/attendance
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    accuracy: { type: Number, default: null },
    distanceMeters: { type: Number, default: null },
    slotIndex: { type: Number, required: true }, // 1-based: due at checkInAt + slotIndex * interval
    overdue: { type: Boolean, default: false }, // uploaded after due+grace
  },
  { _id: true }
);

const attendanceSchema = new mongoose.Schema(
  {
    guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', required: true, index: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    checkInAt: { type: String, required: true },
    checkInPhoto: { type: String, default: null },
    checkInLocation: { type: pointSchema, default: null },
    late: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    checkOutAt: { type: String, default: null },
    checkOutPhoto: { type: String, default: null },
    checkOutLocation: { type: pointSchema, default: null },
    closedBy: { type: String, default: null },
    zone: { type: String, enum: ['inside', 'outside'], default: 'inside' },
    signal: { type: String, enum: ['ok', 'lost'], default: 'ok' },
    outsideCount: { type: Number, default: 0 },
    noSignalAlerted: { type: Boolean, default: false },
    lastSeenAt: { type: String, default: null },
    lastSeenMs: { type: Number, default: null },
    lastLocation: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      distanceMeters: Number,
    },
    violations: { type: [violationSchema], default: [] },
    outsideSeconds: { type: Number, default: 0 },
    workedSeconds: { type: Number, default: 0 },
    insideSeconds: { type: Number, default: 0 },
    fakeGpsAlerted: { type: Boolean, default: false },
    // Hourly proof-of-presence photos taken between check-in and check-out.
    hourlyPhotos: { type: [hourlyPhotoSchema], default: [] },
    lastHourlyPhotoAt: { type: String, default: null },
    lastHourlyPhotoMs: { type: Number, default: null },
    hourlyAlertSlot: { type: Number, default: 0 }, // highest slot already alerted as missed
  },
  { timestamps: true }
);

attendanceSchema.index({ guardId: 1, date: 1 });
attendanceSchema.index({ guardId: 1, checkOutAt: 1 });

attendanceSchema.index({ checkOutAt: 1, lastSeenMs: 1 });

withId(attendanceSchema);

module.exports = mongoose.model('Attendance', attendanceSchema);
