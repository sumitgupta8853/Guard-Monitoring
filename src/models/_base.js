// Shared toJSON: expose `id` alongside `_id` so the frontend keeps working.
function withId(schema) {
  schema.set('toJSON', {
    virtuals: false,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id.toString();
      return ret;
    },
  });
  schema.set('toObject', {
    virtuals: false,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id.toString();
      return ret;
    },
  });
}

module.exports = { withId };
