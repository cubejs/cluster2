'use strict';

var assert = require('assert'),
	util = require('util'),
	when = require('when'),
	timeout = require('when/timeout'),
	cluster = require('cluster'),
	request = require('request'),
	_ = require('underscore'),
	Puppet = require('./puppet').Puppet,
	BigNumber = require('bignumber.js'),
	writePid = require('./utils').writePid,
    assertOld = require('./utils').assertOld,
    assertBadGC = require('./utils').assertBadGC,
	startInspector = require('./utils').startInspector,
    warmUpThenMark = require('./utils').warmUpThenMark,
	rejectIfPortBusy = require('./utils').rejectIfPortBusy;

var tillMaster = when.defer();

exports.master = tillMaster.promise;

var Master = exports.Master = _.once(function(proc, options){

	return this.initialize(proc, options);
});

Master.prototype.initialize = function(proc, options){

	var _this = this;

	writePid(process.pid);

	if(cluster.isMaster) {

		_.extend(_this, {
			'pid': proc.pid,
			'process': proc,
			'emitter': options.emitter,
			'logger': process.getLogger(__filename),
			'runnable': options.runnable,
			'createServer': options.monCreateServer,
			'app': options.monApp,
			'port': options.monPort,
			'ecv': options.ecv,
			'configureApp': function(monApp){
				//cache is 1st enabled, ahead of any worker process, ahead of master's monitor app configuration
				//to allow cache service started earlier than where it's required.
				require('./cache').enable(options.cache, _this);

				require('./ecv').enable(monApp, options.ecv);

				//monitor app could also be configured now, should return a value or promise.
				return options.monConfigureApp(monApp);
			},
			'warmUp': function(){

				_.each(_.range(0, _this.noWorkers), function(ith){
					return _this.fork(_this.options);
				});

				//wait for all puppets to be ready, and then enable ECV as the last step
				return warmUpThenMark(_this.emitter, 
						_.map(_this.puppets, function(p){
							return p.pid;
						}))
						.ensure(function(){
							_this.markUp();
						});
			},
			'noWorkers': options.noWorkers,
			'shouldKill': options.shouldKill || (function(){

				var assertions = [assertOld(options.maxAge), assertBadGC()];

				return function(heartbeat){

					return _.some(assertions, function(a){

						return a(heartbeat);
					});
				};
				
			})(),
			'stopTimeout': options.stopTimeout,
			'debug.debugPort': options.debug.debugPort,
			'debug.webPort': options.debug.webPort,
			'debug.saveLiveEdit': options.debug.saveLiveEdit,
			'debug.hidden': options.debug.hidden || [],
			'options': options,
			'puppets': {

			},
			'status': require('./status'),
			'isMaster': true,
			'isWorker': false
		});

		cluster.on('fork', function(worker){//interestingly, on fork or #fork could complete in disorder...
			_this.puppets[worker.process.pid] = _this.puppets[worker.process.pid] || new Puppet(_this, worker, options, worker.process.env || {});
			_this.puppets[worker.process.pid].worker = worker;
		});

		cluster.on('online', function(worker){
			_this.puppets[worker.process.pid].whenOnline();
		});

		cluster.on('listening', function(worker){
			_this.puppets[worker.process.pid].whenListening();
		});

		cluster.on('exit', function(worker){
			_this.puppets[worker.process.pid].whenExit();
		});

		_this.emitter.on('heartbeat', function(heartbeat){
			_this.puppets[heartbeat.pid].whenHeartbeat(heartbeat);
		});

		_this.emitter.on('disconnect', function(pid){
			_this.puppets[pid].disconnect();
		});

		process.once('SIGINT', _.bind(_this.whenStop, _this));
		process.once('SIGTERM', _.bind(_this.whenExit, _this));

		if(!_this.runnable){//if not runnable, it must have server application 
			assert.ok(_this.createServer);
			assert.ok(_this.app);
			assert.ok(_this.port);

			when.all([
				rejectIfPortBusy('localhost', options.port), 
				rejectIfPortBusy('localhost', options.monPort),
				rejectIfPortBusy('localhost', _this['debug.debugPort']),
				rejectIfPortBusy('localhost', _this['debug.webPort'])
			])
			.otherwise(function(error){

				_this.logger.error('[master] one of the ports:%j we need has been occupied, please shutdown your program on that port; error:%j',
					[options.port, options.monPort, _this['debug.debugPort'], _this['debug.webPort'], error]);

				process.exit(-1);
			});
		}

		tillMaster.resolve(_this);

		return _this;
	}
	else if(proc.env && proc.env.CACHE_MANAGER){

		var Worker = require('./worker').Worker,
			manager = require('./cache-mgr');

		_.extend(options, {
			'createServer': manager.createServer,
			'app': manager.app,
			'port': manager.port,
			'warmUp': manager.afterServerStarted,
			'debug': false,
			'maxAge': null
		});
		
		tillMaster.reject(new Error('this is cache manager worker'));
	
		return new Worker(proc, options);
	}
	else{

		var Worker = require('./worker').Worker;
		
		_.extend(options, {
			'debug': process.env && process.env.debug
		});

		tillMaster.reject(new Error('this is worker'));
	
		return new Worker(proc, options);
	}
};

Master.prototype.listen = function(){

	var _this = this,
		createServer = _this.createServer,
		monApp = _this.app,
		monPort = _this.port,
		configureApp = _this.configureApp,
		warmUp = _this.warmUp,
		wait = _this.timeout;

	assert.ok(createServer);
	assert.ok(monApp);
	assert.ok(monPort),
	assert.ok(configureApp);

	var tillListen = when.defer();

	when(configureApp(monApp)).ensure(function(configured){

		var server = createServer(monApp).listen(monPort, function(){
			
			_this.logger.info('[master] warmUp');

			when(warmUp()).ensure(function(warmedUp){

				_this.logger.info('[master] warmUp complete: %j', warmedUp);

				tillListen.resolve({
					'server': server,
					'app': monApp,
					'port': monPort,
					'master': _this,
					'worker': null
				});
			});
		});
	});

	return (wait > 0 ? timeout(_this.timeout, tillListen.promise) : tillListen.promise);
};

Master.prototype.run = function(){

	this.warmUp();

	return this;	
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
	_.each(_this.puppets, function(puppet){

		if(!puppet.cacheManager && pid !== puppet.pid){
			_this.logger.info('[master][debug] fresh, disconnecting:%j vs pid:%j', puppet.pid, pid);
			puppet.disconnect();
		}
	});

	//send signal to the puppet
	var pending = when.defer(),
		ready = pending.promise;
		
	if(!pid){

		_this.fork(_this.options, {
			'debug': true
		});
		
		pending.resolve(true);
	}
	else{
		
		var debugging = _this.puppets[pid];

		_this.logger.info('[master][debug] going to debug live:%d status:%s', pid, debugging !== null);
		
		ready = debugging.debug();
		
		_this.emitter.once('debug-finished', function(){

			debugging.disconnect();
		});
	}
	
	ready.then(function(){//must wait for the signal to be sent, and child process ready to accept connection on 5858

		_this.logger.info('[master][debug] starting inspector');

		var inspector = startInspector(_this['debug.webPort'], 
				_this['debug.debugPort'],
				_this['debug.saveLiveEdit'],
				_this['debug.hidden'],
				_this.logger);

		inspector.on('message', function inspectorListener(msg){

			if(msg.event === 'SERVER.LISTENING'){

				var inspectorUrl = msg.address.url;
				_this.logger.debug('[master][debug] got inspector url:%s', inspectorUrl);
				_this.emitter.to(['master']).emit('debug-inspector', inspectorUrl);

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
	})
	.otherwise(function(){

		_this.logger.error('[debug] master did not get worker to debug mode:%d, debug request aborted', pid);
	});
};

Master.prototype.markDown = function markDown(){

	var _this = this;
	//mark down ecv
	_this.logger.info('[master][ecv] marking down');
	if(_this.ecv.mode === 'control'){
		request.get(util.format('http://127.0.0.1:%d/%s', _this.port, _this.ecv.markDown));
	}
};

Master.prototype.markUp = function markUp(){

	var _this = this;
	//mark up ecv
	_this.logger.info('[master][ecv] marking up');
	if(_this.ecv.mode === 'control'){
		request.get(util.format('http://127.0.0.1:%d/%s', _this.port, _this.ecv.markUp));
	}
};

Master.prototype.fork = function(options, env){

	var _this = this,
		forked = cluster.fork(env);

	_this.puppets[forked.process.pid] = new Puppet(_this, forked, options, env);

	return forked;
};

Master.prototype.whenStop = function whenStop(){

	var _this = this,
		cycle = 1000,
		threshold = Date.now() + _this.stopTimeout,
		gracefully = function(){

			if(_.keys(_this.puppets).length === 0){//wait till each live puppets to be disconnected, then exit
				process.exit(0);
			}

			if(Date.now() >= threshold){
				process.exit(-1);
			}
			else{
				setTimeout(gracefully, cycle);
			}
		};//check every second

	_this.emitter.emit('debug-finished');//kill inspector please

	_.each(_this.puppets, function(puppet){

		puppet.disconnect();
	});

	gracefully();//shutdown gracefully
};

Master.prototype.whenExit = function whenExit(){

	_.each(_this.puppets, function(puppet){

		puppet.disconnect();
	});

	process.exit(-1);//shutdown bruteforcely
};
