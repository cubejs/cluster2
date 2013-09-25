'use strict';

var readMasterPid = require('./utils').readMasterPid;

process.kill(readMasterPid(), 'SIGINT');
