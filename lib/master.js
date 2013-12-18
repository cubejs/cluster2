'use strict';

var _ = require('underscore'),
	util = require('util'),
	when = require('when'),
    pipeline = require('when/pipeline'),
	timeout = require('when/timeout'),
	utils = require('./utils'),
	assert = require('assert'),
	cluster = require('cluster'),
	request = require('request'),
	Puppet = require('./puppet').Puppet;

var Master = exports.Master = function(proc, options){

	return this.initialize(proc, options);
};

Master.prototype.initialize = function initialize(proc, options){

	var _this = this,
		pids = options.pids;

	utils.writePid(process.pid, pids);

	if(cluster.isMaster) {

		_.extend(_this, {
			'pid': proc.pid,
			'process': proc,
			'emitter': utils.decorateEmitter(options.emitter),
			'logger': process.getLogger(__filename),
			'runnable': options.runnable,
			'createServer': options.monCreateServer,
			'app': options.monApp,
			'port': options.monPort,
            'warmUpPort': options.warmUpPort,
			'ecv': options.ecv,
			'cache': options.cache,
			'gc': options.gc,
			'configureApp': function(monApp){

				assert.ok(_this.createServer);
				assert.ok(_this.app);
				assert.ok(_this.port);

				//cache is 1st enabled, ahead of any worker process, ahead of master's monitor app configuration
				//to allow cache service started earlier than where it's required.
				require('cluster-cache').enable(_.extend(options.cache, {'master':_this}));

				require('cluster-status').register('deathQueue', function(){
					return _this.deathQueue || [];
				});
	
				require('./ecv').enable(monApp, options.ecv);
				
				//monitor app could also be configured now, should return a value or promise.
                return when.all([
                    utils.rejectIfPortBusy('localhost', options.port),
                    utils.rejectIfPortBusy('localhost', options.monPort),
                    utils.rejectIfPortBusy('localhost', options.warmUpPort),
                    utils.rejectIfPortBusy('localhost', _this['debug.debugPort']),
                    utils.rejectIfPortBusy('localhost', _this['debug.webPort'])
                ])
                .then(
                    function (ports) {
                    
                    	_this.logger.info('selected ports approved');
                        return options.monConfigureApp(monApp);
                    }, 
                    function (error) {

                        _this.logger.error('[master] one of the ports:%j we need has been occupied, please shutdown your program on that port; error:%j', [
                            options.port, 
                            options.monPort, 
                            _this['debug.debugPort'], 
                            _this['debug.webPort'], 
                            error
                        ]);

                        process.exit(-1);
                    });
			},
			'warmUp': function(){

				if(!_this.gc.idleNotification && !_.contains(process.argv, '--nouse-idle-notification')){
					//the ugly way to force --nouse-idle-notification is actually to modify process.argv directly in master
					var argv = _.toArray(process.argv),
						node = argv.shift();
					argv.unshift('--nouse-idle-notification');
					argv.unshift(node);

					process.argv = argv;
					//cluster#setupMaster or 'settings' could only handle execArgv, and won't help with '--nouse-idle-notification'
				}

				//wait for all puppets to be ready, and then enable ECV as the last step
				return pipeline([
                        utils.pickAvailablePorts,
                        function(warmUpPorts){
                            
                            return _.map(_.range(0, _this.noWorkers), function(ith){
                                
                                return _this.fork(_this.options, {
                                        'warmUpPort': warmUpPorts.shift()
                                    });
                            });
                        },
                        function(){
                            
                            var pids = _.map(_this.puppets, function(p){
                                    return p.pid;
                                });
                            
                            return utils.markUpAfterAllListening(_this.emitter, pids)
                                .then(function(){
                                    _this.markUp();
                                })
                                .otherwise(function(error){
                                    _this.logger.info('[master] got warmup error from some worker:%j, please check and mark up', error);
                                });
                        }
                    ], options.warmUpPort, options.warmUpPort + _this.noWorkers * 3, _this.noWorkers);
			},
			'noWorkers': options.noWorkers,
			'shouldKill': options.shouldKill || (function(){

				var assertions = [utils.assertOld(options.maxAge), utils.assertBadGC()];

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
			'deathQueue': [],
			'status': require('cluster-status'),
			'isMaster': true,
			'isWorker': false
		});
		
		if(options.nanny && options.nanny.enable){
			_this.nannyScheduler = setInterval(
				_.bind(utils.nanny, _this.puppets, _this.deathQueue, _this.emitter, function(){
						_this.fork(options, proc.env);
					}, 
					{
						'logger': _this.logger,
						'tolerance': options.nanny.tolerance
					}), 
				options.heartbeatInterval);
		}

		cluster.on('fork', function(worker){//interestingly, on fork or #fork could complete in disorder...
			
            _this.puppets[worker.process.pid] = _this.puppets[worker.process.pid] 
                || new Puppet(_this, worker, options, worker.process.env || {});
            
			_this.puppets[worker.process.pid].worker = worker;
		});

		cluster.on('online', function(worker){
			_this.puppets[worker.process.pid].whenOnline();
		});

		cluster.on('listening', function(worker, address){
			_this.puppets[worker.process.pid].whenListening(address);
		});

		cluster.on('exit', function(worker){

			var deadPid = worker.process.pid;
			//exit puppet
			_this.puppets[deadPid].whenExit();
			//mark dead worker's pid in /pids path
			utils.markDeadPid(deadPid, pids);
		});

		_this.emitter.on('heartbeat', function(heartbeat){
			_this.puppets[heartbeat.pid].whenHeartbeat(heartbeat);
		});

		_this.emitter.on('dismiss', function(pid){
			_this.puppets[pid].dismiss();
		});

		_this.emitter.on('debug', function(pid){
			_this.debug(pid);
		});

		_this.emitter.on('pause', function(pid){
			_this.pause(pid);
		});

		_this.emitter.on('resume', function(pid){
			_this.resume(pid);
		});

		process.once('SIGINT', _.bind(_this.whenStop, _this));
		process.once('SIGTERM', _.bind(_this.whenExit, _this));

		return _this;
	}
	else if(proc.env && proc.env.CACHE_MANAGER){

		var Worker = require('./worker').Worker,
			manager = require('cluster-cache').manager;

		_.extend(options, {
			'createServer': manager.createServer,
			'app': manager.app,
			'port': manager.port,
			'warmUp': manager.afterServerStarted,
			'debug': false,
            'CACHE_DOMAIN_PATH': options.domainPath,
            'CACHE_PERSIST_PATH': options.persistPath,
			'maxAge': null
		});
	
		return new Worker(proc, options);
	}
	else{

		var Worker = require('./worker').Worker;
		
		_.extend(options, {
			'debug': process.env.debug,
            'CACHE_DOMAIN_PATH': options.domainPath,
            'CACHE_PERSIST_PATH': options.persistPath
		});

		return new Worker(proc, options);
	}
};

Master.prototype.listen = function listen(){

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
	assert.ok(warmUp);

	var tillListen = when.defer();

	when(configureApp(monApp)).ensure(function(configured){

		var server = createServer(monApp).listen(monPort, function(){
			
			_this.logger.info('[master] warmUp');

			when(warmUp(monApp, server.address())).ensure(function(){

				_this.logger.info('[master] warmUp complete');

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

Master.prototype.pause = function pause(pid){

	if(!pid){
		return when.map(this.puppets, function(p){
			return p.pause();
		});
	}
	else{
		return this.puppets[pid].pause();
	}
};

Master.prototype.resume = function resume(pid){

	if(!pid){
		return when.map(this.puppets, function(p){
			return p.resume();
		});
	}
	else{
		return this.puppets[pid].resume();
	}
};

Master.prototype.run = function run(){

	var _this = this,
		warmUp = _this.warmUp,
		wait = _this.timeout;

	assert.ok(warmUp);

	require('cluster-cache').enable(_.extend(options.cache, {'master':_this}));

	var tillRun = when.defer();

	when(warmUp()).ensure(function(warmedUp){

			_this.logger.info('[master] warmUp complete: %j', warmedUp);

			tillRun.resolve({
				'master': _this,
				'worker': null
			});
		});

	return (wait > 0 ? timeout(_this.timeout, tillRun.promise) : tillRun.promise);
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
			puppet.dismiss();
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

			debugging.dismiss();
		});
	}
	
	ready.then(function(){//must wait for the signal to be sent, and child process ready to accept connection on 5858

		_this.logger.info('[master][debug] starting inspector');

		var inspector = utils.startInspector(_this['debug.webPort'], 
				_this['debug.debugPort'],
				_this['debug.saveLiveEdit'],
				_this['debug.hidden'],
				_this.logger);

		inspector.on('message', function inspectorListener(msg){

			if(msg.event === 'SERVER.LISTENING'){

				var inspectorUrl = msg.address.url;
				_this.logger.debug('[master][debug] got inspector url:%s', inspectorUrl);
				_this.emitter.emit('debug-inspector', inspectorUrl);

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

	var _this = this,
        tillMarkDowm = when.defer();
	//mark down ecv
	if(_this.ecv.mode === 'control'){
		_this.logger.info('[master][ecv] marking down');
		request.get(util.format('http://127.0.0.1:%d/%s', _this.port, _this.ecv.markDown), function(err, response, body){
                if(!err){
                    tillMarkDowm.resolve({
                        'response': response,
                        'body': body
                    });
                }
                else{
                    tillMarkDowm.reject(err);
                }
            });
	}
	else{
		_this.logger.info('[master][ecv] markDown ignored, not in control mode');
        tillMarkDowm.reject(new Error('not in control mode'));
	}
    
    return tillMarkDowm.promise;
};

Master.prototype.markUp = function markUp(){

	var _this = this,
        tillMarkUp = when.defer();
	//mark up ecv
	if(_this.ecv.mode === 'control'){
		_this.logger.info('[master][ecv] marking up');
		request.get(util.format('http://127.0.0.1:%d/%s', _this.port, _this.ecv.markUp), function(err, response, body){
                if(!err){
                    tillMarkUp.resolve({
                        'response': response,
                        'body': body
                    });
                }
                else{
                    tillMarkUp.reject(err);
                }
            });
	}
	else{
		_this.logger.info('[master][ecv] markUp ignored, not in control mode');
        tillMarkUp.reject(new Error('not in control mode'));
	}
    
    return tillMarkUp.promise;
};

Master.prototype.fork = function fork(options, env){

	var _this = this,
		forked = cluster.fork(env);

	//create and register the puppet managing this forked worker immediately
	_this.puppets[forked.process.pid] = new Puppet(_this, forked, options, env);

	return forked;
};

Master.prototype.beforeStop = function beforeStop(){
    
    var _this = this;

    if(_this.nannyScheduler){
		//stop nanny monitoring, otherwise it will conflict with the worker decrease 
		clearInterval(_this.nannyScheduler);
	}

	_this.emitter.emit('debug-finished');//kill inspector please

	_.each(_this.puppets, function(puppet){
		//disconnect each worker
		puppet.dismiss();
	});
};

Master.prototype.whenStop = function whenStop(){

	var _this = this,
		cycle = 1000,
		deadline = Date.now() + _this.stopTimeout,
		gracefully = function(){

			if(_.keys(_this.puppets).length === 0){//wait till each live puppets to be disconnected, then exit
				process.exit(0);
			}

			if(Date.now() >= deadline){
				process.exit(-1);
			}
			else{
				setTimeout(gracefully, cycle);
			}
		};//check every second

	_this.beforeStop();
    
	gracefully();//shutdown gracefully
};

Master.prototype.whenExit = function whenExit(){

	this.beforeStop();

	process.exit(-1);//shutdown bruteforcely
};
