'use strict';

var common = require('./cache-common.js'),
	_ = require('underscore'),
	fs = require('graceful-fs'),
	os = require('os'),
	net = require('net'),
	util = require('util');

var success = common.status.success,
	failure = common.status.failure,
	GET = common.types.GET,
	SET = common.types.SET,
	DEL = common.types.DEL,
	ALL = common.types.ALL,
	INSPECT = common.types.INSPECT,
	PING = common.types.PING,
	PONG = common.types.PONG,
	CHN = common.changeToken,
	domain = os.type().toLowerCase().indexOf('windows') >= 0 ? 8888 : '/tmp/cache.socket.' + process.pid,
	domainPath = common.domainPath,
	persistPath = common.persistPath,
	cache = {},
	expirations = {},
	persists = {},
	conns = [],
	logger = process.getLogger(__filename);

var manager = {

	'domain': domain,

	'all': function(conn, token){

		common.write(conn, common.serialize({
			'type': ALL,
			'token': token,
			'keys': _.keys(cache),
			'status': success
		}));
	},

	'set': function(conn, token, key, value, persist, expire, overwrite){

		var old = cache[key],
			write = old === undefined || overwrite;

		cache[key] = write ? value : cache[key];

		common.write(conn, common.serialize({
			'type': SET,
			'token': token,
			'key': key,
			'status': write ? success: failure
		}));

		if(write){

			var notify = common.serialize({
				'token': CHN,
				'key': key,
				'value': cache[key]
			});
			_.each(conns, function(c){
				common.write(c, notify);
			});

			if(persist || persists[key]){
				persists[key] = cache[key];
			}
			if(expire){
				expirations[key] = Date.now() + expire;
			}
		}
	},

	'get': function(conn, token, key, value, persist, expire){

		var result = {
			'type': GET,
			'token': token,
			'key': key,
			'value': cache[key] || value,//default
			'status': success
		};

		common.write(conn, common.serialize(result));
	},

	'ins': function(conn, token, key){

		var result = {
			'type': INSPECT,
			'token': token,
			'key': key,
			'value': cache[key],
			'persist': persists[key],
			'expire': Date.now() - expirations[key],
			'status': success
		};

		common.write(conn, common.serialize(result));
	},

	'del': function(conn, token, key){

		var value = cache[key];
		delete cache[key];
		delete cache[key + '/lock'];//locker released too

		delete persists[key];//no harm even if it's not a persisted key
		delete expirations[key];

		common.write(conn, common.serialize({
			'type': DEL,
			'token': token,
			'key': key,
			'value': value,
			'status': success
		}));

		var notify = common.serialize({
			'token': CHN,
			'key': key,
			'value': cache[key]
		});
		_.each(conns, function(c){
			common.write(c, notify);
		});
	},

	'ping': function(conn, token){

		common.write(conn, common.serialize({
			'type': PING,
			'token': PONG
		}));
	},

	'pong': function(conn, token){
		//nothing
	}
};

module.exports = {

	'createServer': net.createServer,
	'app':function(conn) { //'connection' listener

		conns.push(conn);

		var buff = '';

		conn.setEncoding('utf-8');
		conn.counter = 0;

	  	conn.on('data', function(data){

	  		buff += data;

	  		var packs = buff.split('\r\n');

	  		if(packs.length > 1){
	  			buff = packs.pop();//whatever the last element is, could be empty string, or partial data, wait till next data arrives.
	  		
		  		_.each(packs, function(pack){
		  			
		  			conn.counter += 1;

			  		var command = common.deserialize(pack),
			  			token = command.token,
			  			type = command.type, //['set', 'get', 'del', 'persist']
			  			key = command.key, //cache key
			  			value = command.value,
			  			persist = command.persist,
			  			expire = command.expire,
			  			overwrite = !command.leaveIfNonNull; // cache value

			  		manager[type].apply(manager, [conn, token, key, value, persist, expire, overwrite]);
			  	});
	  		}//otherwise keep buffering...
	  	});

	  	var keepAlive = setInterval(function(){

	  		manager.ping(conn, PONG);
	  	}, 1000);//ping/pong every second

	  	conn.once('close', function(){
			
			logger.info('connection closed who has received:%d', conn.counter);

	  		conns = _.without(conns, conn);
	  		conn.destroy();
	  		clearInterval(keepAlive);
	  	});
	},
	'port': domain,
	'afterServerStarted': function() { //'listening' listener
	
		logger.info('cache manager started');
		
		var persistPathExists = fs.existsSync(persistPath);

		if(persistPathExists){
			//to get the cache from something already persisted
			cache = common.deserialize(fs.readFileSync(persistPath, {'encoding':'utf-8'}) || '{}');
		}

		//register domain to where all other users and the master process could watch
		fs.writeFileSync(domainPath, domain);

		var updateTask = function updateTask(){

			//expiration monitoring every 10 seconds
			var now = Date.now();
			_.each(expirations, function(due, key){
				if(due >= now){

					delete cache[key];
					delete cache[key + '/lock'];//locker released too
					delete persists[key];//no harm even if it's not a persisted key
					delete expirations[key];

					var notify = common.serialize({
						'token': CHN,
						'key': key,
						'value': cache[key]
					});
					_.each(conns, function(c){
						common.write(c, notify);
					});
				}
			});

			//persist every 10 seconds
			fs.writeFile(persistPath, common.serialize(persists), function(){
				setTimeout(updateTask, 10000);
			});
		};

		updateTask();

		return manager;
	}
};
