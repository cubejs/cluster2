var _ = require('underscore'),
	when = require('when'),
	timeout = require('when/timeout'),
	cluster = require('cluster'),
	assert = require('assert'),
	util = require('util'),
	fork = require('child_process').fork,
	BigNumber = require('bignumber.js'),
	Worker = require('./worker.js').Worker,
	rejectIfPortBusy = require('./utils.js').rejectIfPortBusy,
	writePid = require('./utils.js').writePid,
	getNodeInspectorPath = require('./utils.js').getNodeInspectorPath,
	enable = require('./ecv.js').enable;

var masterDeferred = when.defer(),
	masterPromise = exports.master = masterDeferred.promise;

/**
 * Slave is an image of the worker at the Master's runtime, to simplify the state machine
 */
var Slave = exports.Slave = function Slave(master, worker, options, env){

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
			//here's the key feature for cluster3, based on the historic tps info, memory usage, gc rate, we could determine if a slave should
			//enter an old state from active

			if(master.markOld(heartbeat)){

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
			delete master.slaves[_this.pid];
		}
	};

	_this.oldState = {

		'disconnect': function(){
			
			worker.disconnect();
		},

		'whenExit': function(){

			_this.state = _this.diedState;

			//already exit, clean up
			delete master.slaves[_this.pid];
		}
	};

	_this.diedState = {

		'disconnect': function(){
			//already disconnected	
		},

		'whenExit': function(){
			//already exit, clean up
			delete master.slaves[_this.pid];
		}
	};

	_this.state = _this.forkedState;
};

Slave.prototype.debug = function(){

	//debugger listening on port 5858
	var _this = this,
		buff = '',
		pid = _this.pid,
		worker = _this.worker,
		debugDeferred = when.defer();

	_this.emitter.once('debug-port-listening', function(){

		_this.logger.info('[debug] slave: %d received debug-port-listening', pid);
		debugDeferred.resolve(pid);
	});

	worker.process.kill('SIGUSR1');//make it debug ready
	_this.logger.debug('[debug] master sent signal SIGUSR1 to %d', pid);

	return debugDeferred.promise;
};

Slave.prototype.disconnect = function(){

	return this.state.disconnect();
};

Slave.prototype.whenOnline = function(){

	return this.state.whenOnline();
};

Slave.prototype.whenListening = function(){

	return this.state.whenListening();
};

Slave.prototype.whenHeartbeat = function(heartbeat){

	return this.state.whenHeartbeat(heartbeat);
};

Slave.prototype.whenExit = function(){

	return this.state.whenExit();
};

var Master = exports.Master = function(proc, options){

	var _this = this.initialize(proc, options);

	masterDeferred.resolve(_this);

	return _this;
};

Master.prototype.initialize = function(proc, options){

	var _this = this;

	writePid(process.pid);

	if(cluster.isMaster) {

		_.extend(_this, {
			'pid': proc.pid,
			'process': proc,
			'emitter': options.emitter,
			'logger': process.getLogger(__filename),
			'createServer': options.monCreateServer,
			'app': options.monApp,
			'port': options.monPort,
			'warmUp': function(){

				_this.fork(_this.options, {
					'CACHE_MANAGER': true
				});

				enable(options.monApp, options.ecv);

				_.each(_.range(0, _this.noWorkers), function(ith){
					return _this.fork(_this.options);
				});

				//wait for all slaves to be ready, and then enable ECV as the last step
				_this.markUp();	
			},
			'noWorkers': options.noWorkers,
			'markOld': options.markOld || function(heartbeat){

				//TODO markOld heuristic
				//when a worker has exceeds certain threshold of TPS we start sampling and identify when TPS could reach its plateau
				//for each heartbeat, if the TPS goes up, whether CPU/memory/GC goes up/down, we take it as progress to its plateau
				//once a plateau is identified, we will compare the upcoming TPS, CPU, memory, GC to determine if it's an old age
				//that is when the TPS drop over a given percentage, say 10%, along with CPU, memory, GC growth, that's when we mark
				//this worker as old, as its performance degrades possibly related to GC
				//the 2nd step could be more conservative, using 2 consecutive occurances of the scenario as the criteria instead of 1.
				//this is the current state of the heuristic, should work for most of the cases, and will be interesting to see how generalized it is.
				//besides, even if markOld succeeded, we should not immediately start a successor and kill the original, that task must be
				//queued to make sure no more than one old worker gets collected at the same time
				
				var _this = this,
					pid = heartbeat.pid,
					slave = _this.slaves[pid],
					currTPS = heartbeat.durations / heartbeat.transactions;

				if(currTPS <= 2){//TPS too low, no good for sampling as the 1st phase.
					return false;
				}

				var peak = slave.peak = slave.peak || {
						'tps': currTPS,
						'cpu': heartbeat.cpu,
						'memory': heartbeat.memory,
						'gc.incremental': heartbeat.gc.incremental,
						'gc.full': heartbeat.gc.full
					};//remember the peak of each slave

				if(currTPS >= peak.tps){
					peak.tps = Math.max(currTPS.tps, peak.tps);
					peak.cpu = Math.max(currTPS.cpu, peak.cpu);
					peak.memory = Math.max(currTPS.memory, peak.memory);
					peak.gc.incremental = Math.max(currTPS.gc.incremental, peak.gc.incremental);
					peak.gc.full = Math.max(currTPS.gc.full, peak.gc.full);
				}
				else if(currTPS < peak.tps * 0.9 //10% tps drop
					&& heartbeat.cpu > peak.cpu
					&& heartbeat.memory > peak.memory
					&& heartbeat.gc.incremental > peak.gc.incremental
					&& heartbeat.gc.full > peak.gc.full){
					return true;
				}

				return false;
			},
			'dyingQueue': null,//a chain of old workers to be collected, it's a FIFO, which guarantees that no more than one old worker will be collected at any time.
			'stopTimeout': options.stopTimeout,
			'debug.debugPort': options.debug.debugPort,
			'debug.webPort': options.debug.webPort,
			'debug.saveLiveEdit': options.debug.saveLiveEdit,
			'debug.hidden': options.debug.hidden || [],
			'options': options,
			'slaves': {

			},
			'status': require('./cluster-status.js').status(options.emitter)
		});

		cluster.on('fork', function(worker){//interestingly, on fork or #fork could complete in disorder...
			_this.slaves[worker.process.pid] = _this.slaves[worker.process.pid] || new Slave(_this, worker, options, worker.process.env || {});
			_this.slaves[worker.process.pid].worker = worker;
		});

		cluster.on('online', function(worker){
			_this.slaves[worker.process.pid].whenOnline();
		});

		cluster.on('listening', function(worker){
			_this.slaves[worker.process.pid].whenListening();
		});

		cluster.on('exit', function(worker){
			_this.logger.info('master detects exit of worker:' + worker.process.pid);
			_this.slaves[worker.process.pid].whenExit();
		});

		_this.emitter.on('heartbeat', function(heartbeat){
			_this.slaves[heartbeat.pid].whenHeartbeat(heartbeat);
		});

		process.once('SIGINT', _.bind(_this.whenStop, _this));
		process.once('SIGTERM', _.bind(_this.whenExit, _this));

		assert.ok(_this.createServer);
		assert.ok(_this.app);
		assert.ok(_this.port);

		/*when.all([
			rejectIfPortBusy('localhost', options.port), 
			rejectIfPortBusy('localhost', options.monPort),
			rejectIfPortBusy('localhost', _this['debug.debugPort']),
			rejectIfPortBusy('localhost', _this['debug.webPort'])
		])
		.then(function(){
				//nothing to do
			}, 
			function(error){

				_this.logger.error('[master] one of the ports:%j we need has been occupied, please shutdown your program on that port; error:%j',
					[options.port, options.monPort, _this['debug.debugPort'], _this['debug.webPort'], error]);

				process.exit(-1);
			});*/

		return _this;
	}
	else if(proc.env.CACHE_MANAGER){

		var manager = require('./cache-mgr.js');
		_.extend(options, {
			'createServer': manager.createServer,
			'app': manager.app,
			'port': manager.port,
			'warmUp': manager.afterServerStarted,
			'debug': false
		});

		return new Worker(proc, options);
	}
	else{

		_.extend(options, {
			'debug': process.env.debug
		});

		return new Worker(proc, options);
	}
};

Master.prototype.listen = function(){

	var _this = this,
		createServer = _this.createServer,
		monApp = _this.app,
		monPort = _this.port,
		warmUp = _this.warmUp,
		wait = _this.timeout;

	assert.ok(createServer);
	assert.ok(monApp);
	assert.ok(monPort);

	var deferred = when.defer(),
		server = createServer(monApp).listen(monPort, function(){
			
			deferred.resolve({
				'server': server,
				'app': monApp,
				'port': monPort,
				'master': _this,
				'worker': null
			});
		});

	return (wait > 0 ? timeout(_this.timeout, deferred.promise) : deferred.promise)
		.then(function(resolve){
			
			_this.logger.info('[master] warmUp');
			warmUp();
			return resolve;
		});
};

Master.prototype.useCache = function useCache(domain){

	return require('./cache-usr.js').user(domain);
};

Master.prototype.debug = function debug(pid){

	var _this = this,
		noWorkers = _this.noWorkers;

	pid = pid && _.isString(pid) ? parseInt(pid, 10) : null;

	_this.logger.info('[debug] master debugging %d, currently busy: %s', pid, _this.debugging);

	if(!_this.debugging){
		_this.debugging = true;
	}
	else{
		return;//cannot debug more than one worker
	}

	_this.markDown();

	//debug fresh
	_.each(_this.slaves, function(slave){

		if(!slave.cacheManager && pid !== slave.pid){
			_this.logger.info('debug fresh, disconnecting:%j vs pid:%j', slave.pid, pid);
			slave.disconnect();
		}
	});

	//send signal to the slave
	var pending = when.defer(),
		ready = pending.promise;
	if(!pid){
		_this.fork(_this.options, {
			'debug': true
		});
		pending.resolve(true);
	}
	else{
		var debugging = _this.slaves[pid];
		_this.logger.info('[debug] going to debug live:%d status:%s', pid, debugging !== null);
		ready = debugging.debug();

		_this.emitter.once('debug-finished', function(){

			debugging.disconnect();
		});
	}
	
	var inspectorPath = getNodeInspectorPath();
	assert.ok(inspectorPath);

	ready.then(function(){//must wait for the signal to be sent, and child process ready to accept connection on 5858

		var inspectorArgs = [
				'--web-port=' + _this['debug.webPort'], //where node-inspector process listens to users' request from v8
				'--debug-port=' + _this['debug.debugPort'], //where node-inspector process subscribes to debugging app process
				'--save-live-edit=' + _this['debug.saveLiveEdit'], //whether or not user could modify the debugging source and save it
				'--hidden=' + _this['debug.hidden']//files excluded from adding breakpoints
			];
		_this.logger.info('[debug] starting node-inspector at:%s with args:%j', inspectorPath, inspectorArgs);		
		
		//NOTE, this is not _this.fork, but child_process.fork
		var inspector = fork(inspectorPath, inspectorArgs, {'silent': true});

		inspector.on('message', function inspectorListener(msg){

			if(msg.event === 'SERVER.LISTENING'){

				var inspectorUrl = msg.address.url;
				_this.logger.debug('[debug] master got inspector url:%s', inspectorUrl);
				_this.emitter.emit('debug-inspector', ['master'], inspectorUrl);

				inspector.removeListener('message', inspectorListener);
			}
		});

		_this.emitter.once('debug-finished', function(){//u'll hear back from the debug app about this

			if(_this.debugging === true){
				_this.debugging = false;

				inspector.kill('SIGTERM');
				//restore the workers
				_.each(_.range(0, noWorkers), function(ith){
					_this.fork(_this.options, {});
				});

				//mark up ecv now
				_this.markUp();
			}
		});
	});
};

Master.prototype.markDown = function markDown(){

	var _this = this;
	//mark down ecv
	_this.logger.info('[ecv] master marking down');
	_this.emitter.emit('warning', ['self'], {
		'command': 'disable'
	});
};

Master.prototype.markUp = function markUp(){

	var _this = this;
	//mark up ecv
	_this.logger.info('[ecv] master marking up');
	_this.emitter.emit('warning', ['self'], {
		'command': 'enable'
	});
};

Master.prototype.fork = function(options, env){

	var _this = this,
		forked = cluster.fork(env);

	_this.slaves[forked.process.pid] = new Slave(_this, forked, options, env);

	return forked;
};

Master.prototype.whenStop = function whenStop(){

	var _this = this,
		cycle = 1000,
		threshold = Date.now() + _this.stopTimeout,
		gracefully = function(){

			if(_.keys(_this.slaves).length === 0){//wait till each live slaves to be disconnected, then exit
				process.exit(0);
			}

			if(Date.now() >= threshold){
				process.exit(-1);
			}
			else{
				setTimeout(gracefully, cycle);
			}
		};//check every second

	_.each(_this.slaves, function(slave){

		slave.disconnect();
	});

	gracefully();//shutdown gracefully
};

Master.prototype.whenExit = function whenExit(){

	_.each(_this.slaves, function(slave){

		slave.disconnect();
	});

	process.exit(-1);//shutdown bruteforcely
};
