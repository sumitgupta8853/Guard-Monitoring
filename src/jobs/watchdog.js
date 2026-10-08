const { startWatchdog } = require('../services/monitor.service');

function startJobs() {
  startWatchdog();
}

module.exports = { startJobs };
