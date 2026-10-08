const http = require('http');
const { Server } = require('socket.io');
const cfg = require('./config');
const { createApp } = require('./app');
const { connectDB, closeDB } = require('./db/connect');
const { seedAdmin } = require('./db/seed');
const { initSockets } = require('./sockets');
const { startJobs } = require('./jobs/watchdog');

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: cfg.CORS_ORIGIN } });
initSockets(io);

async function start() {
  await connectDB();
  await seedAdmin();
  startJobs();
  if (require.main === module) {
    server.listen(cfg.PORT, () => console.log(`Guard monitor backend listening on :${cfg.PORT}`));
  }
}

start().catch((e) => {
  console.error('Failed to start server:', e.message);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await closeDB().catch(() => {});
    process.exit(0);
  });
}

module.exports = { app, server, start };

