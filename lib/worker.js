var _ = require('underscore'),
	when = require('when'),
	timeout = require('when/timeout'),
	usage = require('usage'),
	BigNumber = require('bignumber.js'),
	gc = require('nodefly-gcinfo'),
	assert = require('assert');

var Worker = exports.Worker = function(proc, options){

	var _this = this,
		emitter = _this.emitter = options.emitter;

	_.extend(_this, {
		'pid': proc.pid,
		'process': proc,
		'logger': proc.getLogger(__filename),
		'options': options,
		'createServer': options.createServer,
		'app': options.app,
		'port': options.port,
		'warmUp': options.warmUp,
		'debug': options.debug,
		'timeout': options.timeout || 5000,
		'liveConnections': 0,
		'totalConnections': 0,
		'transactions': 1,
		'durations': 0,
		'totalTransactions': new BigNumber(1),//avoid zero division
		'totalDurations': new BigNumber(0),
		'heartbeatInterval': options.heartbeatInterval || 60000,//1 min, the heartbeat should be too frequent, which could cause false old determining
		'status': require('./cluster-status.js').status(emitter),
		'status.os': {

		},
		'gc': {
			'incremental': 0,
			'full': 0
		}
	});

	gc.onGC(_.bind(_this.whenGC, _this));
	process.once('disconnect', _.bind(_this.whenStop, _this, 'disconnect'));
	process.once('SIGINT', _.bind(_this.whenStop, _this, 'sigint'));
	process.once('SIGTERM', _.bind(_this.whenExit, _this));
	process.once('SIGUSR1', function(){
		process.nextTick(function(){
			emitter.emit('debug-port-listening', ['master']);
		});
	});

	_this.status.register('status.os', 
		function(){
			return _this['status.os'];
		},
		function(status){
			return _this['status.os'] = status;
		});
	_this.whenHeartbeat();
};

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
			server = createServer(app).listen(port, function(){
				
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
			
			warmUp();

			_this.emitter.emit(util.format('worker-%d-warmup'), ['master']);

			return resolve;
		});
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
			'gc': _this.gc
		};

		emitter.emit('heartbeat', ['self', 'master'], heartbeat);
		_this.status.setStatus('status.os', heartbeat);

		//cleanup after heartbeat
		_this.durations = 0;
		_this.transactions = 1;
		_this.gc.incremental = 0;
		_this.gc.full = 0;
	});

	_this.heartbeatTimer = setTimeout(_.bind(_this.whenHeartbeat, _this), _this.heartbeatInterval);
};

Worker.prototype.whenGC = function(usage, type){

	var _this = this;

	if('kGCTypeMarkSweepCompact' === type){
		_this.gc.full += 1;
	}
	else{
		_this.gc.incremental += 1;
	}

	emitter.emit('gc', ['self', 'master'], usage, type);
};

Worker.prototype.whenStop = function(){

	var _this = this;

	clearTimeout(_this.heartbeatTimer);

	function gracefully(){

		if(_this.liveConnections > 0){

			_this.logger.info('gracefully shutdown: %d pending on liveConnections: %d', process.pid, _this.liveConnections);
			setTimeout(gracefully, 500);
		}
		else{

			_this.logger.info('gracefully shutdown: %d', process.pid);
			process.exit(0);
		}
	}

	gracefully();
};

Worker.prototype.whenExit = function(){

	this.logger.warn('forced shutdown: %d', process.pid);

	process.exit(-1);
};
