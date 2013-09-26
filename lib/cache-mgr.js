'use strict';

var common = require('./cache-common'),
	_ = require('underscore'),
	fs = require('graceful-fs'),
	os = require('os'),
	net = require('net'),
	util = require('util'),
	path = require('path'),
	when = require('when'),
	timeout = require('when/timeout'),
	ensureDir = require('./utils').ensureDir;

var success = common.status.success,
	failure = common.status.failure,
	NS = common.types.NS,
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
	namespaces = {
		'': { //meta namespace
			'': { //meta of meta namespace itself
				'value': { //meta value
					'persist': true, //persist true
					'expire': 0, //never expire
					'lastModified': 0,
					'lastPersisted': 0
				}
			}
		}
	},
	metaOfNs = function metaOfNs(namespace){

		var entry = namespaces[''][namespace];

		return entry ? entry.value : {
			'persist': false,
			'expire': 0
		};//default meta
	},
	conns = [],
	logger = process.getLogger(__filename);

var manager = {

	'domain': domain,

	'ns': function(conn, token){

		common.write(conn, common.serialize({
			'type': NS,
			'token': token,
			'namespaces': _.keys(namespaces),
			'status': success
		}));
	},

	'all': function(conn, token, namespace){

		var cache = namespaces[namespace] || {};

		common.write(conn, common.serialize({
			'type': ALL,
			'token': token,
			'namespace': namespace,
			'keys': _.keys(cache),
			'status': success
		}));
	},

	'set': function(conn, token, namespace, key, value, overwrite){

		var cache = namespaces[namespace] = namespaces[namespace] || {}, 
			meta = metaOfNs(namespace),
			expire = meta.expire,
			old = cache[key],
			write = old === undefined || overwrite;

		cache[key] = write ? {
				'value': value,
				'expire': expire > 0 ? Date.now + expire : 0 //expire at
			} 
			: cache[key];

		common.write(conn, common.serialize({
			'type': SET,
			'token': token,
			'key': key,
			'status': write ? success: failure
		}));

		if(write){

			meta.lastModified = Date.now();

			var notify = common.serialize({
				'token': CHN,
				'namespace': namespace,
				'key': key,
				'value': cache[key]['value']
			});

			_.each(conns, function(c){
				common.write(c, notify);
			});
		}
	},

	'get': function(conn, token, namespace, key, value){

		var cache = namespaces[namespace] || {},
			entry = cache[key] || {},
			result = {
				'type': GET,
				'token': token,
				'key': key,
				'value': entry.value || value,//default
				'status': success
			};

		common.write(conn, common.serialize(result));
	},

	'ins': function(conn, token, namespace, key){

		var cache = namespaces[namespace] || {},
			meta = metaOfNs(namespace),
			entry = cache[key],
			result = {
				'type': INSPECT,
				'token': token,
				'key': key,
				'value': entry.value,
				'persist': meta.persist,
				'expire': meta.expire ? Date.now() - entry.expire : meta.expire,
				'status': success
			};

		common.write(conn, common.serialize(result));
	},

	'del': function(conn, token, namespace, key){

		var cache = namespaces[namespace] || {},
			entry = cache[key] || {},
			value = entry.value;
		
		delete cache[key];
		delete cache[key + '/lock'];//locker released too

		metaOfNs(namespace).lastModified = Date.now();

		common.write(conn, common.serialize({
			'type': DEL,
			'token': token,
			'key': key,
			'value': value,
			'status': success
		}));

		var notify = common.serialize({
			'token': CHN,
			'namespace': namespace,
			'key': key,
			'value': value
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
			  			namespace = command.namespace,
			  			type = command.type, //['set', 'get', 'del', 'persist']
			  			key = command.key, //cache key
			  			value = command.value,
			  			overwrite = !command.leaveIfNonNull; // cache value

			  		manager[type].apply(manager, [conn, token, namespace, key, value, overwrite]);
			  	});
	  		}//otherwise keep buffering...
	  	});

	  	var keepAlive = setInterval(function(){
	  		//this is to keep the connection open, just to send PING, and receive PONG, and will be extended to validate the health of the connection later
	  		manager.ping(conn, PONG);
	  		
	  	}, 2000);//ping/pong every second

	  	conn.once('close', function(){
			
			logger.info('connection closed who has received:%d', conn.counter);

	  		conns = _.without(conns, conn);
	  		conn.destroy();

	  		clearInterval(keepAlive);
	  	});
	},

	'port': domain,

	'afterServerStarted': function() { //'listening' listener
	
		logger.info('[cache] manager started');
		
		ensureDir(persistPath);

		var persists = fs.readdirSync(persistPath) || [];
		
		logger.info('[cache] manager loading from persistences: %j', persists);

		_.each(persists, function(p){

			var filter = /^(.+)\.cache$/,
				match = filter.exec(p);

			if(match && match[1]){
				namespaces[match[1]] = common.deserialize(fs.readFileSync(path.join(persistPath, p), {'encoding':'utf-8'}) || '{}');
			}
		});

		namespaces[''] = namespaces[''] || {};
		namespaces[''][''] = { //meta of meta namespace itself
				'value': { //meta value
					'persist': true, //persist true
					'expire': 0 //never expire
				}
			};
		logger.info('[cache] manager loaded from all persistences');

		//register domain to where all other users and the master process could watch
		fs.writeFileSync(domainPath, domain);

		var nextUpdate = null,
            updateTask = function updateTask(){

			//expiration monitoring every 10 seconds
			var now = Date.now(),
				cachesToPersist = {};

			logger.info('[cache][maintain] at:%d upon namespaces:%j', now, _.keys(namespaces));
			_.each(namespaces, function(cache, namespace){

				var meta = metaOfNs(namespace),
					persist = meta.persist,
					expire = meta.expire;

				if(expire > 0){
					_.each(cache, function(entry, key){

						if(entry.expire <= now){

							delete cache[key];
							delete cache[key + '/lock'];

							var notify = common.serialize({
								'token': CHN,
								'namespace': namespace,
								'key': key,
								'value': cache[key]
							});

							_.each(conns, function(c){
								common.write(c, notify);
							});
						}
					});
				}

				if(persist && (meta.lastPersisted < meta.lastModified)){
					cachesToPersist[namespace] = cache;
				}
			});

			logger.info('[cache][maintain] expiration finished, and persist the following:%j', _.keys(cachesToPersist));
			
			when.all(_.map(cachesToPersist, function(cache, namespace){

				var waitForPersist = when.defer(),
					persistence = path.join(persistPath, namespace + '.cache');

				logger.info('[cache][maintain] to persist namespace:%s to:%s', namespace, persistence);
				
				fs.writeFile(persistence, common.serialize(cache), function(err){

					logger.info('[cache][maintain] persisted:%s %s', persistence, err ? 'with error' : 'successfully');

					metaOfNs(namespace).lastPersisted = Date.now();
					
					waitForPersist.resolve(!err);
				});

				return timeout(waitForPersist, 10000);//too big?
			}))
			.ensure(function(){

				nextUpdate = setTimeout(updateTask, 10000);
			})
		};

		updateTask();
        
        process.once('SIGINT', function(){
        
            clearTimeout(nextUpdate);
            
            updateTask();
        });

		return manager;
	}
};
