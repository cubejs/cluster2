'use strict';

process.getLogger = require('../../lib/utils.js').getLogger;

var should = require('should'),
	cluster = require('cluster'),
	optimist = require('optimist'),
	when = require('when'),
	timeout = require('when/timeout'),
	_ = require('underscore'),
	status = require('../../lib/status'),
	emitter = require('../../lib/emitter'),
	logger = process.getLogger(__filename);

if(cluster.isMaster){

	var argv = optimist.argv,
		token = argv.token,
		noWorkers = argv.noWorkers || 2,
		statusName = 'status-' + token;

	cluster.setupMaster({
		'args': ['--status=' + statusName]
	});

	logger.info('[master] exec with token:%s and will register status:%s and create %d workers', token, statusName, noWorkers);

	var onlineWorkers = 0,
		waitForWorkers = when.defer();

	emitter.on('worker-online', function(pid){

		onlineWorkers += 1;

		if(onlineWorkers === noWorkers){

			waitForWorkers.resolve(onlineWorkers);
		}
	});

	var workers = _.map(_.range(0, noWorkers), function(){

			return cluster.fork();
		}),
		exit = function exit(error){

			logger.info('[master] exiting with error:%j', error);

			process.send({
				'exit': error ? new Error(error) : null
			});

			process.nextTick(function(){ //exit now.
				
				_.invoke(workers, 'kill', 'SIGTERM'); //force all workers to exit before master itself
				
				process.nextTick(function(){

					process.exit(error ? -1 : 0);

				});
			});
		};

	timeout(4000, waitForWorkers.promise)
		.then(function(){

			logger.info('[master] got all workers online notifications');

			var expects = _.map(workers, function(w){
				return w.process.pid;//all workers' pids
			})
			.concat([process.pid]);//master included

			var pid = process.pid;

			status.register(statusName, 
				function(){
					return pid;
				}, 
				function(value){
					pid = value;
				});

			status.getStatus(statusName)
				.then(function(result){

					console.log('[cluster-status] got status result:%j', result);

					result.should.be.ok;
					result.length.should.equal(expects.length);

					exit();

				})
				.otherwise(exit);
		})
		.otherwise(function(error){

			logger.info('[master] did not receive all workers online notification in time');

			exit(error);
		});
}
else{

	var argv = optimist.argv,
		statusName = argv.status,
		pid = process.pid;

	logger.info('[worker:%d] forked and register status:%s', pid, statusName);

	status.register(statusName, 
		function(){
			return pid;
		}, 
		function(value){
			pid = value;
		});

	logger.info('[worker:%d] registered status', process.pid, statusName);

	emitter.to(['master']).emit('worker-online', pid);//truely ready

}
