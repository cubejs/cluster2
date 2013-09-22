'use strict';

var readMasterPid = require('./utils.js').readMasterPid;

process.kill(readMasterPid(), 'SIGSTOP');
