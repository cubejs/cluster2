'use strict';

var when = require('when'),
	timeout = require('when/timeout'),
	util = require('util'),
	_ = require('underscore');

/**
 * Puppet is a projection of the worker at the Master's runtime, to simplify the state machine & control over workers.
 * NOTE, Puppet only runs in master's runtime, it has access to master instance, and the worker handle to communicate via messaging.
 * NOTE, Puppet is a state machine, which are [FORKED, ACTIVE, OLD, DIED], the transitions are events based, including esp. heartbeats.
 */
var Puppet = exports.Puppet = function Puppet(master, worker, options, env){

	var _this = this;

	_.extend(_this, {
		'logger': master.logger,
		'emitter': master.emitter,
		'cacheManager': env.CACHE_MANAGER,
		'debugging': env.debug,
		'worker': worker,
		'pid': worker.process.pid
	});

	_this.forkedState = {

		'disconnect': function(){
			
			worker.disconnect();
		},

		'whenOnline': function(){

			if(_this.debugging){
				//we could enable debugging here
				master.emitter.once('debug-started', function(){
					_this.emitter.emit('run', [_this.pid]);
				});

				master.emitter.once('debug-finished', function(){
					_this.disconnect();
				});

				_this.debug();
			}
		},

		'whenListening': function(){

			_this.state = _this.activeState;
			//this is mainly for the old worker to be notified that the successor is ready
			master.emitter.emit(util.format('worker-%d-listening', worker.process.pid), ['self']);
		},

		'whenHeartbeat': function(){
			//no interest
		},

		'whenExit': function(){

			if(!worker.suicide){//accident, must be revived
				master.fork(options, env);
			}
		}
	};

	_this.activeState = {

		'disconnect': function(){
			
			worker.disconnect();
			worker.suicide = true;
		},

		'whenHeartbeat': function(heartbeat){
			//here's the key feature for cluster3, based on the historic tps info, memory usage, gc rate, we could determine if a puppet should
			//enter an old state from active

			if(master.assertOld(heartbeat)){

				var dieDeferred = when.defer(),
					diePromise = null,
					die = function(){

						_this.activeState = _this.oldState;

						var successor = master.fork(options, env);
						//when successor is in place, the old worker could be discontinued finally
						master.emitter.once(util.format('worker-%d-listening', successor.process.pid), function(){

							master.emitter.emit('disconnect', ['master', worker.pid]);
							dieDeferred.resolve(worker.pid);

							if(master.dyingQueue === diePromise){//last of dyingQueue resolved, clean up the dyingQueue
								master.dyingQueue = null;
							}
						});
					};

				if(!master.dyingQueue){//1st in the dying queue, 
					diePromise = master.dyingQueue = timeout(dieDeferred.promise, 60000);//1 min
					die();
				}
				else{
					diePromise = master.dyingQueue = timeout(master.dyingQueue, 60000).ensure(die);
				}
			}
		},

		'whenExit': function(){

			if(!worker.suicide){//accident, must be revived
				master.fork(options, env);
			}
			//already exit, clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.oldState = {

		'disconnect': function(){
			
			worker.disconnect();
		},

		'whenExit': function(){

			_this.state = _this.diedState;

			//already exit, clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.diedState = {

		'disconnect': function(){
			//already disconnected	
		},

		'whenExit': function(){
			//already exit, clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.state = _this.forkedState;
};

Puppet.prototype.debug = function(){

	//debugger listening on port 5858
	var _this = this,
		buff = '',
		pid = _this.pid,
		worker = _this.worker,
		waitForDebugPort = when.defer();

	_this.emitter.once('debug-port-listening', function(){

		_this.logger.info('[debug] puppet: %d received debug-port-listening', pid);

		waitForDebugPort.resolve(pid);
	});

	worker.process.kill('SIGUSR1');//make it debug ready

	_this.logger.info('[debug] master sent signal SIGUSR1 to %d', pid);

	return waitForDebugPort.promise;
};

Puppet.prototype.disconnect = function(){

	return this.state.disconnect();
};

Puppet.prototype.whenOnline = function(){

	return this.state.whenOnline();
};

Puppet.prototype.whenListening = function(){

	return this.state.whenListening();
};

Puppet.prototype.whenHeartbeat = function(heartbeat){

	return this.state.whenHeartbeat(heartbeat);
};

Puppet.prototype.whenExit = function(){

	return this.state.whenExit();
};
