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
		'warmUp': options.warmUp,
		'debug': options.debug || false,
		'timeout': options.timeout || 5000,
		'liveConnections': 0,
		'totalConnections': 0,
		'transactions': 1,
		'durations': 0,
		'totalTransactions': new BigNumber(1),//avoid zero division
		'totalDurations': new BigNumber(0),
		'heartbeatInterval': options.heartbeatInterval || 60000,//1 min, the heartbeat should be too frequent, which could cause false old determining
		'status': require('./status'),
		'status.os': {

		},
		'gc': {
			'monitor': options.gc.monitor,
			'explicit': options.gc.explicit,
			'incremental': 0,
			'full': 0
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

		var gc = require('node-gc');

		gc.on('scavenge', function(info) {
			_this.whenGC('', 'incremental');
		});
		
		gc.on('marksweep', function(info) {
		  	//got marked and sweeped
			_this.whenGC('', 'full');
		});
	}

	process.once('disconnect', _.bind(_this.whenStop, _this, 'disconnect'));
	process.once('SIGINT', _.bind(_this.whenStop, _this, 'sigint'));
	process.once('SIGTERM', _.bind(_this.whenExit, _this));
	process.once('SIGUSR1', function(){
		process.nextTick(function(){
			emitter.emit('debug-port-listening', ['master']);
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
		createServer = _this.createServer,
		app = _this.app,
		port = _this.port,
		warmUp = _this.warmUp,
		debug = _this.debug,
		wait = _this.timeout;

	assert.ok(createServer);
	assert.ok(app);
	assert.ok(port);
	assert.ok(warmUp);

	var deferred = when.defer(),
		run = function(){
			var server = createServer(app).listen(port, function(){
				
				server.on('connection', function(conn){
					_this.whenConnected(conn);
				});

				if(_.isFunction(app.use)){//tps information
					app.use(function(req, res, next){

						var begin = Date.now();
						res.once('finish', function(){
							_this.transactions += 1;
							_this.durations += Date.now() - begin;
						});

						next();
					});
				}

				deferred.resolve({
					'server': server,
					'app': app,
					'port': port,
					'master': null,
					'worker': _this
				});
			});
		};

	if(!debug){
		run();
	}
	else{
		_this.emitter.once('run', run);
	}

	return (wait > 0 ? timeout(_this.timeout, deferred.promise) : deferred.promise)
		.then(function(resolve){
			
			_this.logger.info('[worker] %d warming up', process.pid);
			
			warmUp();

			_this.emitter.emit(util.format('worker-%d-warmup'), ['master']);

			return resolve;
		});
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

    _this.liveConnections += 1;
    _this.totalConnections += 1;

    conn.setTimeout(_this.timeout, _.bind(conn.destroy, conn));

    conn.once('close', function() {
        _this.liveConnections -= 1;
    });
};

Worker.prototype.whenHeartbeat = function(){

	//heartbeat to the master
	var _this = this,
		emitter = _this.emitter;

	usage.lookup(_this.pid, function(error, result){

		var heartbeat = {
			'pid': process.pid,
			'cpu': result.cpu,
			'memory': result.memory,
			'liveConnections': _this.liveConnections,
			'totalConnections': _this.totalConnections,
			'transactions': _this.transactions,
			'durations': _this.durations,
			'totalTransactions': _this.totalTransactions.plus(_this.transactions).toString(16),
			'totalDurations': _this.totalDurations.plus(_this.durations).toString(16),
			'gc': _this.gc,
			'error': _this.error
		};

		emitter.emit('heartbeat', ['self', 'master'], heartbeat);
		_this.status.setStatus('status.os', heartbeat);

		//cleanup after heartbeat
		_this.durations = 0;
		_this.transactions = 1;
		_this.gc.incremental = 0;
		_this.gc.full = 0;
		_this.error.count = 0;
		_this.error.fatal = 0;
	});

	_this.nextHeartbeat = setTimeout(_.bind(_this.whenHeartbeat, _this), _this.heartbeatInterval);
};

Worker.prototype.whenGC = function(usage, type){

	var _this = this;

	_this.logger.info('[worker] gc usage:%s, type:%s', usage, type);

	_this.gc[type] += 1;

	_this.emitter.emit('gc', ['self'], usage, type);
};

Worker.prototype.whenStop = function(){

	var _this = this;

	clearTimeout(_this.nextHeartbeat);

	(function gracefully(){

		if(_this.liveConnections > 0){

			_this.logger.info('[worker] gracefully shutdown: %d pending on liveConnections: %d', process.pid, _this.liveConnections);
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
