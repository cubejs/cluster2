'use strict';

var readMasterPid = require('./utils').readMasterPid,
	readPids = require('./utils').readPids,
	safeKill = require('./utils').safeKill,
	getLogger = require('./utils').getLogger,
	optimist = require('optimist'),
	when = require('when'),
	_ = require('underscore');

var argv = optimist.argv,
	timeout = argv.timeout || 60000,//user specified timeout or 1 min
	masterPid = argv.pid || readMasterPid(),
	workerPids = _.filter(readPids() || [], function(pid){
			return pid !== masterPid;
		}),
	logger = getLogger();

logger.info('[shutdown] SIGINT:%d monitor:%j', masterPid, workerPids);

(function shutdown(begin){

	if(!safeKill(masterPid, 'SIGINT', logger)){//master will handle 'SIGINT' only once

		if(Date.now() - begin >= timeout){

			_.each(workerPids, function(wpid){
				//bruteforcely kill all workers
				safeKill(wpid, 'SIGTERM', logger);
			});

			//bruteforcely kill master
			safeKill(masterPid, 'SIGTERM', logger);
		}

		setTimeout(_.bind(shutdown, null, begin), 1000);//check every seconds
	}
	else{//master is finally gone, we'll quickly check all workers gone too

		when.map(workerPids, function(wpid){

			var tillWorkerGone = when.defer();

			if(!safeKill(wpid, 'SIGHUP', logger)){
				tillWorkerGone.reject(new Error('pid:' + wpid + ' still lives'));
			}
			else{
				tillWorkerGone.resolve(true);
			}
		})
		.then(function(){

			process.exit(0);
		})
		.otherwise(function(){

			process.exit(-1);
		});
	}

})(Date.now());

