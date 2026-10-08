const { verifyToken } = require('../services/token.service');

// <img src="/api/files/...?token=JWT"> can't send headers, so allow token in query here only
const queryTokenAuth = (req, _res, next) => {
  if (!req.get('authorization') && typeof req.query.token === 'string')
    req.headers.authorization = 'Bearer ' + req.query.token;
  next();
};

const socketAuth = async (socket, next) => {
  const auth = await verifyToken(socket.handshake.auth && socket.handshake.auth.token);
  if (!auth) return next(new Error('unauthorized'));
  socket.data.auth = auth;
  next();
};

module.exports = { queryTokenAuth, socketAuth };
