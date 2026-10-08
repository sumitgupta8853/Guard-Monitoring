const mongoose = require('mongoose');
const { withId } = require('./_base');

const siteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    radiusMeters: { type: Number, required: true, min: 10, max: 10000 },
    address: { type: String, default: '' },
  },
  { timestamps: true }
);

withId(siteSchema);

module.exports = mongoose.model('Site', siteSchema);
