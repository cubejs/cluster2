'use strict';

var when = require('when'),
	util = require('util'),
	_ = require('underscore'),
	deathQueue = require('./utils').deathQueue;

/**
 * Puppet is a projection of the worker at the Master's runtime, to simplify the state machine & control over workers.
 * NOTE, Puppet only runs in master's runtime, it has access to master instance, and the worker handle to communicate via messaging.
 * NOTE, Puppet is a state machine, which are [FORKED, ACTIVE, OLD, DIED], the transitions are events based, including esp. heartbeats.
 */
var Puppet = exports.Puppet = function Puppet(master, worker, options, env){

	var _this = this;

	env = env || {};
	_.extend(_this, {
		'pid': worker.process.pid,
		'logger': master.logger,
		'emitter': master.emitter,
		'cacheManager': env.CACHE_MANAGER,
		'debugging': env.debug,
		'worker': worker
	});

	_this.forkedState = {

		'disconnect': function(){
			
			worker.disconnect();
		},

		'whenOnline': function(){

			if(_this.debugging){
				//we could enable debugging here
				_this.emitter.once('debug-started', function(){
					_this.emitter.to([_this.pid]).emit('run');
				});

                _this.emitter.once('debug-finished', function(){
					_this.disconnect();
				});

				_this.debug();
			}
		},

		'whenListening': function(){

			_this.state = _this.activeState;
		},

		'whenHeartbeat': function(){
			//no interest
		},

		'whenExit': function(){

            _this.state = _this.diedState;

			if(!worker.suicide){//accident, must be revived
				master.fork(options, env);
			}
            //already exit, clean up
            delete master.puppets[_this.pid];
		}
	};

	_this.activeState = {

		'disconnect': function(){
			
			worker.disconnect();
		},

		'whenHeartbeat': function(heartbeat){

			if(master.shouldKill(heartbeat)){

				deathQueue(_this.pid, master.emitter, function(){//success function

					_this.activeState = _this.oldState;

					return master.fork(options, env);
				});
			}
		},

		'whenExit': function(){

            _this.state = _this.diedState;

			if(!worker.suicide){//accident, must be revived
				master.fork(options, env);
			}
			//already exit, clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.oldState = {

		'disconnect': function(){

            worker.suicide = true;
            worker.disconnect();
		},

		'whenExit': function(){

			_this.state = _this.diedState;

			//already exit, clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.diedState = {

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
		pid = _this.pid,
		worker = _this.worker,
		tillDebugPortListen = when.defer();

	_this.emitter.once(util.format('debug-%d-listening', pid), function(){

		_this.logger.info('[debug] puppet: %d received debug-port-listening', pid);

        tillDebugPortListen.resolve(pid);
	});

	worker.process.kill('SIGUSR1');//make it debug ready

	_this.logger.info('[debug] master sent signal SIGUSR1 to %d', pid);

	return tillDebugPortListen.promise;
};

Puppet.prototype.disconnect = function(){

	return this.state.disconnect();
};

Puppet.prototype.whenOnline = function(){

	return this.state.whenOnline();
};

Puppet.prototype.whenListening = function(){

	this.logger.info('[master] detects worker:%d is listening now', this.pid);

	//this is mainly for the old worker to be notified that the successor is ready
    this.emitter.to(['master']).emit(util.format('worker-%d-listening', this.pid));

	return this.state.whenListening();
};

Puppet.prototype.whenHeartbeat = function(heartbeat){

	return this.state.whenHeartbeat(heartbeat);
};

Puppet.prototype.whenExit = function(){

	this.logger.info('[master] detects exit of worker:%d', this.pid);

	this.emitter.to(['master']).emit(util.format('worker-%d-died', this.pid));

	return this.state.whenExit();
};
