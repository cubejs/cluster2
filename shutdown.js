'use strict';

var utils = require('./lib/utils'),
	readMasterPid = utils.readMasterPid,
	readPids = utils.readPids,
	safeKill = utils.safeKill,
	getLogger = utils.getLogger,
	optimist = require('optimist'),
	when = require('when'),
	path = require('path'),
	_ = require('underscore');

var argv = optimist.argv,
	timeout = argv.timeout || 60000,//user specified timeout or 1 min
	pids = argv.pids || path.join(process.cwd(), '/pids'),
	masterPid = argv.pid || readMasterPid(pids),
	workerPids = _.filter(readPids(pids) || [], function(pid){
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
	else{//master is finally gone, we'll quickly check whether all workers are gone too

		when.map(workerPids, function(wpid){

			var tillWorkerGone = when.defer();

			if(!safeKill(wpid, 'SIGHUP', logger)){
				logger.warn('[shutdown] cleanup found dangling worker:%d', wpid);
				tillWorkerGone.reject(new Error('pid:' + wpid + ' still lives'));
			}
			else{
				//worker already exit, check next
				tillWorkerGone.resolve(true);
			}
		})
		.then(function(){
			//all workers exit normally
			process.exit(0);
		})
		.otherwise(function(){
			//some worker didn't exit though master already did
			process.exit(-1);
		});
	}

})(Date.now());

