const { socketAuth } = require('../middlewares/uploadAuth');
const notify = require('../services/notify.service');

function initSockets(io) {
  io.use(socketAuth);
  io.on('connection', (socket) => {
    const { user, guard } = socket.data.auth;
    socket.join(user.role === 'admin' ? 'admins' : 'guard:' + guard.id);
  });
  notify.init(io);
}

module.exports = { initSockets };
