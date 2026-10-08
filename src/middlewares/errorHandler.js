// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const isUpload = err.name === 'MulterError' || /image/i.test(err.message || '');
  const status =
    err.status || (isUpload || err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'server error' : err.message });
}

function notFound(_req, res) {
  res.status(404).json({ error: 'not found' });
}

module.exports = { errorHandler, notFound };
