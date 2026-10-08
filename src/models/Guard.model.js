const mongoose = require('mongoose');
const { withId } = require('./_base');

const guardSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true, index: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true, index: true },
    shift: {
      start: { type: String, default: null }, // "HH:MM"
      end: { type: String, default: null },
    },
    phone: { type: String, default: '' },
    cnic: { type: String, default: '' },
    address: { type: String, default: '' },
    emergencyContact: { type: String, default: '' },
    active: { type: Boolean, default: true, index: true },
    profilePhoto: { type: String, default: null },
    absentAlertDate: { type: String, default: null }, // YYYY-MM-DD of last NOT_CHECKED_IN alert
  },
  { timestamps: true }
);

withId(guardSchema);

module.exports = mongoose.model('Guard', guardSchema);
