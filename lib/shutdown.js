'use strict';

var readMasterPid = require('./utils').readMasterPid,
	getLogger = require('./utils').getLogger,
	masterPid = readMasterPid(),
	logger = getLogger();

logger.info('[shutdown] SIGINT:%d', masterPid);

process.kill(masterPid, 'SIGINT');

process.nextTick(function(){
	process.exit(0);
});
