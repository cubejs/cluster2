'use strict';

var when = require('when'),
	util = require('util'),
	_ = require('underscore'),
	deathQueue = require('./utils').deathQueue;

/**
 * Puppet is a handle of the worker at the Master's runtime, to simplify the state machine & control over workers.
 * NOTE, Puppet only runs in master's runtime, it has access to master instance, and the worker handle to communicate via messaging.
 * NOTE, Puppet is a state machine, which are [FORKED, ACTIVE, PAUSED, OLD, DIED], the transitions are events based.
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
        'port': options.port,
        'warmUpPort': options.warmUpPort,
		'worker': worker,
		'lastHeartbeat': Date.now()
	});
    
    function defaultExit(){

        if(!worker.suicide && _this.state !== _this.diedState){//accident, must be revived
            master.fork(options, env);
        }
        
        _this.state = _this.diedState;
        
        delete master.puppets[_this.pid];
    }

	_this.forkedState = {

		'name': 'forked',

		'dismiss': function(){
			
			worker.disconnect();
		},

		'whenOnline': function(){

			if(_this.debugging){
				//we could enable debugging here
				_this.emitter.once('debug-started', function(){
					_this.emitter.to([_this.pid]).emit('run');
				});

                _this.emitter.once('debug-finished', function(){
					_this.dismiss();
				});

				_this.debug();
			}
		},

		'whenListening': function(address){
            
            if(address.port === _this.port){
                _this.state = _this.activeState;
            }
		},

		'whenHeartbeat': function(){
			//no interest
		},

		'whenExit': defaultExit
	};

	_this.activeState = {

		'name': 'active',

		'dismiss': function(){
			
			worker.disconnect();
		},

		'whenListening': function(address){
            //noop
		},

		'whenHeartbeat': function(heartbeat){

			if(master.shouldKill(heartbeat)){//when in active state, each heartbeat must be examined to determine if this worker is old

                //deathQueue function guarantees that only one worker could commit suicide at a time
				deathQueue(master.deathQueue, _this.pid, master.emitter, function(){//success function

					_this.activeState = _this.oldState;

					return master.fork(options, env);
				});
			}
		},

		'whenExit': defaultExit
	};

	_this.pausedState = {

		'name': 'paused',

		'dismiss': function(){
			
			worker.disconnect();
		},

		'whenListening': function(){
            //noop
		},

		'whenHeartbeat': function(heartbeat){   
            //noop
		},

		'whenExit': defaultExit
	};

	_this.oldState = {

		'name': 'old',

		'dismiss': function(){

            worker.suicide = true; //MUST set suicide true, to avoid master spawning extra worker
            
            worker.disconnect();
		},

		'whenExit': function(){

			_this.state = _this.diedState;

			//already exit, clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.diedState = {

		'name': 'died',

		'whenExit': function(){
            
			//already exit, just clean up
			delete master.puppets[_this.pid];
		}
	};

	_this.state = _this.forkedState;
};

Puppet.prototype.debug = function(){

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

Puppet.prototype.dismiss = function(){

	return this.state.dismiss();
};

Puppet.prototype.pause = function(){

	var _this = this,
		tillPaused = when.defer();

	_this.emitter.once(util.format('worker-%d-paused', _this.pid), function(){
		if(_this.state === _this.activeState){
			_this.state = _this.pausedState;

			_this.logger.info('[puppet] paused worker:%d', _this.pid);
			tillPaused.resolve(_this);
		}
		else{
			tillPaused.reject(new Error('state changed before pause completed, and now is:' + _this.state.name));
		}
	});
    
	_this.emitter.to([_this.pid]).emit('pause');
	
    return tillPaused.promise;
};

Puppet.prototype.resume = function(){

	var _this = this,
		tillResumed = when.defer();

	_this.emitter.once(util.format('worker-%d-resumed', _this.pid), function(){
		if(_this.state === _this.pausedState){
			_this.state = _this.activeState;
			tillResumed.resolve(_this);
		}
		else{
			tillResumed.reject(new Error('state changed before resume completed'));
		}
	});
    
	_this.emitter.to([_this.pid]).emit('resume');

	return tillResumed.promise;
};

Puppet.prototype.whenOnline = function(){

	return this.state.whenOnline();
};

Puppet.prototype.whenListening = function(address){

	this.logger.info('[master] detects worker:%d is listening now on:%j', this.pid, address);

	return this.state.whenListening(address);
};

Puppet.prototype.whenHeartbeat = function(heartbeat){

	this.lastHeartbeat = Date.now(); //MUST update #lastHeartbeat to survive nanny check
	
	return this.state.whenHeartbeat(heartbeat);
};

Puppet.prototype.whenExit = function(){

	this.logger.info('[master] detects exit of worker:%d', this.pid);

	this.emitter.to(['master']).emit(util.format('worker-%d-died', this.pid));

	return this.state.whenExit();
};
