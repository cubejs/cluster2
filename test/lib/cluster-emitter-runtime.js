'use strict';

process.getLogger = require('../../lib/utils.js').getLogger;

var should = require('should'),
	cluster = require('cluster'),
	optimist = require('optimist'),
	when = require('when'),
	timeout = require('when/timeout'),
	_ = require('underscore'),
	emitter = require('../../lib/cluster-emitter.js').emitter,
	logger = process.getLogger(__filename);

if(cluster.isMaster){

	var argv = optimist.argv,
		token = argv.token,
		noWorkers = argv.noWorkers || 2,
		event = 'event-' + token,
		echo = 'echo-' + event;

	cluster.setupMaster({
		'args': ['--event=' + event]
	});

	logger.info('[master] exec with token:%s and will use event:%s and echo:%s to verify emitter with %d workers', token, event, echo, noWorkers);

	var workers = _.map(_.range(0, noWorkers), function(){
			return cluster.fork();
		}),
		waitForWorkers = when.map(workers, function(w){
			var waitForOnline = when.defer();

			w.once('online', function(){
				waitForOnline.resolve(w);
			});

			return timeout(2000, waitForOnline.promise);
		}),
		exit = function exit(error){

			logger.info('[master] exiting with error:%j', error);

			process.send({
				'exit': error
			}); //tell the test it has exited with failure

			process.nextTick(function(){ //exit now.
				_.invoke(workers, 'kill', 'SIGTERM'); //force all workers to exit before master itself
				process.nextTick(function(){
					process.exit(error ? -1 : 0);
				});
			});
		};

	waitForWorkers
		.then(function(){

			logger.info('[master] got all workers online notifications');

			var expects = _.map(workers, function(w){
				return w.process.pid;//all workers' pids
			})
			.concat([process.pid]);//master included

			emitter.once(event, function(){

				logger.info('[master] received event:%s, and will echo:%s with pid:%d', event, echo, process.pid);
				emitter.emit(echo, ['self'], process.pid);
			});

			emitter.on(echo, function(pid){

				logger.info('[master] received echo:%s from process:%d', echo, pid);

				expects = _.without(expects, pid);
				if(_.isEmpty(expects)){
					exit();
				}
			});

			logger.info('[master] emitting event:%s to all', event);
			emitter.emit(event, null/*target*/, echo);

			setTimeout(function(){

				exit(new Error('timeout after 5s, remaining expects:' + expects));
			}, 5000);
		})
		.otherwise(function(error){

			logger.info('[master] did not receive all workers online notification in time');
			exit(error);
		});
}
else{

	var argv = optimist.argv,
		event = argv.event;

	emitter.on(event, function(echo){

		logger.info('[worker:%d] received:%s and will echo:%s', process.pid, event, echo);

		var eventToMe = event + '/' + process.pid;

		emitter.once(eventToMe, function(){

			logger.info('[worker:%d] received:%s and will emit:%s', process.pid, eventToMe, echo);
			emitter.emit(echo, null, process.pid);
			logger.info('[worker:%d] emitted:%s with payload:%s', process.pid, echo, process.pid);
		});

		emitter.emit(eventToMe, ['self']);
		logger.info('[worker:%d] emitted:%s', process.pid, eventToMe);
	});

	logger.info('[worker:%d] prepared to echo to event:%s', process.pid, event);
}
