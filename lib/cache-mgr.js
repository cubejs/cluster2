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
    LOCK = common.types.LOCK,
	INSPECT = common.types.INSPECT,
	PING = common.types.PING,
	PONG = common.types.PONG,
	CHN = common.changeToken,
	domain = '/tmp/cache.socket.' + process.pid,
	domainPath = common.domainPath,
	persistPath = common.persistPath,
    ports = process.env.CACHE_PORTS ? JSON.parse(process.env.CACHE_PORTS) : [9190, 9191],
	namespaces = {
		'': { //meta namespace
			'': { //meta of meta namespace itself
				'value': { //meta value
					'persist': true, //persist true
					'expire': 0, //never expire
					'lastModified': 0,
					'lastPersisted': -1
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

	'ns': function(reply, token){

		reply({
			'type': NS,
			'token': token,
			'namespaces': _.keys(namespaces),
			'status': success
		});
	},

	'all': function(reply, token, namespace){

		var cache = namespaces[namespace] || {};

		reply({
			'type': ALL,
			'token': token,
			'keys': _.keys(cache),
			'status': success
		});
	},

    'lock': function(reply, token, namespace, key, value){

        var cache = namespaces[namespace] = namespaces[namespace] || {},
            write = cache[key] === undefined;

        if(write){
            cache[key] = {
                'lock': value
            };
        }

        reply({
            'type': LOCK,
            'token': token,
            'key': key,
            'status': write ? success: failure
        });
    },

	'set': function(reply, token, namespace, key, value, overwrite){

		var cache = namespaces[namespace] = namespaces[namespace] || {}, 
			meta = metaOfNs(namespace),
			expire = meta.expire,
			old = cache[key],
			write = (old === undefined || overwrite);

		cache[key] = write ? {
                'lock': old ? old.lock : null,
				'value': value,
				'expire': expire > 0 ? Date.now + expire : 0 //expire at
			} 
			: cache[key];

		reply({
			'type': SET,
			'token': token,
			'key': key,
			'status': write ? success: failure
		});

		if(write){

			meta.lastModified = Date.now();

			manager.notify(namespace, key, cache[key]['value']);
		}
	},

	'notify': function(namespace, key, value){

		var notify = {
			'token': CHN,
			'ns': namespace,
			'key': key,
			'value': value
		};

        this.cacheSocket.send(notify);

		if(namespace === '' 
			&& value === undefined 
			&& key !== ''){
			//dump the cache
			delete namespaces[key];
		}
	},

	'get': function(reply, token, namespace, key, value){

		var cache = namespaces[namespace] || {},
			entry = cache[key] || {},
			result = {
				'type': GET,
				'token': token,
				'key': key,
				'value': entry.value || value,//default
				'status': success
			};

		reply(result);
	},

	'ins': function(reply, token, namespace, key){

		var cache = namespaces[namespace] || {},
			meta = metaOfNs(namespace),
			entry = cache[key],
			result = {
				'type': INSPECT,
				'token': token,
				'key': key,
				'value': entry ? entry.value : null,
				'persist': meta.persist,
				'expire': meta.expire && entry ? Date.now() - entry.expire : meta.expire,
				'status': success
			};

		reply(result);
	},

	'del': function(reply, token, namespace, key){

		var cache = namespaces[namespace] || {},
			entry = cache[key] || {},
			value = entry.value;
		
		delete cache[key];//locker released too

		metaOfNs(namespace).lastModified = Date.now();

		reply({
			'type': DEL,
			'token': token,
			'key': key,
			'value': value,
			'status': success
		});

		manager.notify(namespace, key, undefined);
	},

	'ping': function(token){

		this.cacheSocket.send({
			'type': PING,
			'token': PONG
		});
	},

	'pong': function(reply, token){
		//nothing
	}
};

module.exports = {

	'createServer': function createServer(app) {
        return app;
    },

	'app': (function () { //'connection' listener
        manager.cacheSocket = require('./cache-socket/cache-socket-factory').getCacheSocket('manager', 'json');

        manager.cacheSocket.on('message', function (command, reply) {
            manager[command.type].apply(manager, [
                reply, command.token, command.ns, command.key, command.value, !command.leaveIfNonNull
            ]);
        });

	  	var keepAlive = setInterval(function(){
	  		//this is to keep the connection open, just to send PING, and receive PONG, and will be extended to validate the health of the connection later
	  		manager.ping(PONG);
	  	}, 3000);//ping/pong every 3secs

	  	manager.cacheSocket.once('close', function(){
			
			loggerinfo('cacheSock closed');

	  		clearInterval(keepAlive);
	  	});

        return manager.cacheSocket;
	})(),

	'port': ports,

	'afterServerStarted': function() { //'listening' listener
	
		logger.info('[cache] manager started, persistence:%j', persistPath);
		
		ensureDir(persistPath);
		
		var persistMeta = path.join(persistPath, '.cache');
		
		if(fs.existsSync(persistMeta)){
			
			namespaces[''] = common.deserialize(fs.readFileSync(persistMeta, {'encoding': 'utf-8'}));
		}

		logger.info('[cache] manager loading from persistences: %j', namespaces['']);

		_.each(namespaces, function(cache, namespace){

			var pathOfNs = path.join(persistPath, namespace + '.cache');

			if(!metaOfNs(namespace).persist){

				if(fs.existsSync(pathOfNs)){//dump the persisted cache
					fs.unlinkSync(pathOfNs);
				}

				delete namespaces[''][namespace];//dump from meta
			}
			else{

				if(fs.existsSync(pathOfNs)){
					//load from persisted cache
					namespaces[namespace] = common.deserialize(fs.readFileSync(pathOfNs, {'encoding': 'utf-8'}));
				}
				else{
					namespaces[namespace] = {};//empty cache
				}
			}
		});

		logger.info('[cache] manager loaded from all persistences');

		//register domain to where all other users and the master process could watch
		fs.writeFileSync(domainPath, JSON.stringify(ports));
        logger.debug('[cache] manager wrote %j to %s', ports, domainPath);

		var nextUpdate = null,
            updateTask = function updateTask(){

			//expiration monitoring every 10 seconds
			var now = Date.now(),
				cachesToPersist = {};

			_.each(namespaces, function(cache, namespace){

				var meta = metaOfNs(namespace),
					persist = meta.persist,
					expire = meta.expire;

				logger.debug('[cache][maintain] at:%d upon namespace:%s meta:%j', now, namespace, meta);
			
				if(expire > 0){
					_.each(cache, function(entry, key){

						if(entry.expire <= now){

							var old = cache[key];

							delete cache[key];

							manager.notify(namespace, key, old);
						}
					});
				}

				if(persist && (meta.lastPersisted < meta.lastModified)){
					cachesToPersist[namespace] = cache;
				}
			});

			logger.debug('[cache][maintain] expiration finished, and persist the following:%j', _.keys(cachesToPersist));
			
			when.all(_.map(cachesToPersist, function(cache, namespace){

				var tillPersist = when.defer(),
					persistence = path.join(persistPath, namespace + '.cache');

				logger.debug('[cache][maintain] to persist namespace:%s to:%s', namespace, persistence);
				
				fs.writeFile(persistence, common.serialize(cache), function(err){

					logger.debug('[cache][maintain] persisted:%s %s', persistence, err ? 'with error' : 'successfully');

					metaOfNs(namespace).lastPersisted = Date.now();
					
					tillPersist.resolve(!err);
				});

				return timeout(tillPersist, 10000);//too big?
			}))
			.ensure(function(){

				nextUpdate = setTimeout(updateTask, 10000);
			})
		};

		updateTask();
        
        process.once('SIGINT', function(){
        
            clearTimeout(nextUpdate);

        });

		return manager;
	}
};
