'use strict';

var _ = require('underscore'),
	when = require('when'),
	util = require('util'),
	timeout = require('when/timeout'),
	usage = require('usage'),
	BigNumber = require('bignumber.js'),
	assert = require('assert');

var Worker = exports.Worker = _.once(function(proc, options){

	var _this = this,
		emitter = _this.emitter = options.emitter;

	_.extend(_this, {
		'pid': proc.pid,
		'process': proc,
		'logger': proc.getLogger(__filename),
		'options': options,
		'runnable': options.runnable,
		'createServer': options.createServer,
		'app': options.app,
		'port': options.port,
		'configureApp': function(app){

			if(_.isFunction(app.use)){//make sure this middleware is ahead of others, to collect tps information
				
				app.use(function(req, res, next){

					var begin = Date.now();
					res.once('finish', function(){
						_this.transactions += 1;
						_this.durations += Date.now() - begin;
					});

					next();
				});
			}

			return options.configureApp(app);
		},
		'warmUp': options.warmUp,
		'debug': options.debug || false,
		'timeout': options.timeout || 5000,
		'aliveConnections': 0,
		'totalConnections': 0,
		'transactions': 0,
		'durations': 0,
		'totalTransactions': new BigNumber(0),
		'totalDurations': new BigNumber(0),
		'heartbeatInterval': options.heartbeatInterval || 60000,//1 min, the heartbeat shouldn't be too frequent, which could cause false assertion of utils#assertBadGC
		'status': require('./status'),
		'status.os': {

		},
		'gc': {
			'monitor': options.gc.monitor,
			'explicit': options.gc.explicit,
			'incremental': 0,
			'full': 0,
			'pauseMS': 0
		},
		'error': {
			'count': 0,
			'fatal': 0
		},
		'isMaster': false,
		'isWorker': true
	});

	if(_this.gc.monitor){
		//in dev, we will not monitor gc, because, oddly enough, it conflicts with socket.io
		//which is the key to our hot reload functionality

		var gcstats = require('./utils').gcstats;

		gcstats.on('stats', function(stats) {
			//cannot tell if it's incremental or full, just to check if pauseMS is too long
			_this.whenGC(stats.pauseMS, stats.pauseMS < 500 ? 'incremental' : 'full');
		});
	}

	process.once('disconnect', _.bind(_this.whenStop, _this, 'disconnect'));
	process.once('SIGINT', _.bind(_this.whenStop, _this));
	process.once('SIGTERM', _.bind(_this.whenExit, _this));
	process.once('SIGUSR1', function(){
		process.nextTick(function(){
			emitter.to(['master']).emit(util.format('debug-%d-listening', _this.pid));
		});
	});

	emitter.on('error', function(err){

		if(err && err.fatal){
			_this.error.fatal += 1;
		}
		else{
			_this.error.count += 1;
		}
	});

	_this.status.register('status.os', 
		function(){
			return _this['status.os'];
		},
		function(status){
			return _this['status.os'] = status;
		});

	_this.whenHeartbeat();
});

Worker.prototype.listen = function(){

	var _this = this,
		app = _this.app,
		port = _this.port,
		createServer = _this.createServer,
		configureApp = _this.configureApp,
		warmUp = _this.warmUp,
		debug = _this.debug,
		wait = _this.timeout;

	assert.ok(createServer);
	assert.ok(app);
	assert.ok(port);
	assert.ok(configureApp);
	assert.ok(warmUp);

	var tillListen = when.defer(),
		run = function(){

			when(configureApp(app)).ensure(function(configured){ //configure app before listening
				
				_this.logger.debug('[worker] %d app configured', _this.pid);
					
				var server = createServer(app).listen(port, function(){

					_this.logger.debug('[worker] %d started listening', _this.pid);
					_this.emitter.to(['master', 'self']).emit(util.format('worker-%d-listening', _this.pid));
					
					//connection monitoring, including live/total connections and idle connections
					server.on('connection', function(conn){
						_this.whenConnected(conn);
					});

					when(warmUp()).ensure(function(warmedUp){ //warm up app after listening

						_this.logger.debug('[worker] %d warmed up', _this.pid);
						_this.emitter.to(['master', 'self']).emit(util.format('worker-%d-warmup', _this.pid)); //tell master i'm ready

						tillListen.resolve({
							'server': server,
							'app': app,
							'port': port,
							'master': null,
							'worker': _this
						});
					})
				});
			});
		};

	if(!debug){ //normal
		run();
	}
	else{ //debug fresh process, waiting for 'run' command
		_this.emitter.once('run', run);
	}

	return (wait > 0 ? timeout(_this.timeout, tillListen.promise) : tillListen.promise);
};

Worker.prototype.run = function(){

	var _this = this,
		runnable = _this.runnable,
		debug = _this.debug,
		wait = _this.timeout;

	assert.ok(runnable);

	if(!debug){
		runnable();
	}
	else{
		_this.emitter.once('run', runnable);
	}
};

Worker.prototype.whenConnected = function whenConnected(conn) {

	var _this = this;

    _this.aliveConnections += 1;
    _this.totalConnections += 1;

    conn.setTimeout(_this.timeout, _.bind(conn.destroy, conn));

    conn.once('close', function() {
        _this.aliveConnections -= 1;
    });
};

Worker.prototype.whenHeartbeat = function(){

	//heartbeat to the master
	var _this = this,
		emitter = _this.emitter;

	usage.lookup(_this.pid, function(error, result){

		_this.totalTransactions = _this.totalTransactions.plus(_this.transactions);
		_this.totalDurations = _this.totalDurations.plus(_this.durations);

		var heartbeat = {
			'pid': process.pid,
			'uptime': process.uptime(),
			'cpu': result.cpu,
			'memory': result.memory,
			'aliveConnections': _this.aliveConnections,
			'totalConnections': _this.totalConnections,
			'transactions': _this.transactions,
			'durations': _this.durations,
			'tps': _this.transactions * 1000 / _this.heartbeatInterval,
			'totalTransactions': _this.totalTransactions.toString(16),
			'totalDurations': _this.totalDurations.toString(16),
			'gc': _this.gc,
			'error': _this.error,
			'cycle': _this.heartbeatInterval
		};

		_this.status.setStatus('status.os', heartbeat);
		emitter.to(['self', 'master']).emit('heartbeat', heartbeat);

		//cleanup after heartbeat
		_this.durations = 0;
		_this.transactions = 0;
		_this.gc = {
			'incremental': 0,
			'full': 0,
			'pauseMS': 0
		};
		_this.error = {
			'count': 0,
			'fatal': 0
		};
	});

	_this.nextHeartbeat = setTimeout(
		_.bind(_this.whenHeartbeat, _this), _this.heartbeatInterval);
};

Worker.prototype.whenGC = function(usage, type){

	var _this = this;

	_this.logger.debug('[worker] gc usage:%d, type:%s', usage, type);

	_this.gc[type] += 1;
	_this.gc.pauseMS += usage;

	_this.emitter.to(['self']).emit('gc', usage, type);
};

Worker.prototype.whenStop = function(){

	var _this = this;

	clearTimeout(_this.nextHeartbeat);

	//stop serving traffic, when 'disconnect' server should already take off traffic, this is to make sure resources get released
	if(_.isFunction(_this.app.close)){
		_this.app.close();
	}

	(function gracefully(){

		if(_this.aliveConnections > 0){

			_this.logger.debug('[worker] gracefully shutdown: %d pending on aliveConnections: %d', process.pid, _this.aliveConnections);
			setTimeout(gracefully, 500);
		}
		else{

			_this.logger.info('[worker] gracefully shutdown: %d', process.pid);
			process.exit(0);
		}

	})();
};

Worker.prototype.whenExit = function(){

	this.logger.warn('[worker] forced shutdown: %d', process.pid);

	process.exit(-1);
};
