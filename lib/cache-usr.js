'use strict';

var _ = require('underscore'),
	net = require('net'),
	util = require('util'),
	when = require('when'),
	timeout = require('when/timeout'),
	fs = require('graceful-fs'),
	common = require('./cache-common');
	
var success = common.status.success,
	NS = common.types.NS,
	ALL = common.types.ALL,
	GET = common.types.GET,
	SET = common.types.SET,
	DEL = common.types.DEL,
    LOCK = common.types.LOCK,
	INSPECT = common.types.INSPECT,
	PONG = common.types.PONG,
	CHN = common.changeToken,
	nextToken = common.nextToken,
	logger = process.getLogger(__filename),
	domain = null,
	userDeferred = when.defer(),
	handlers = {

	},
	changes = {

	},
	anyChanges = {

	},
    stats = {
        
    },
	conn = null,
	//TODO, support connection pooling to speed up the cache operations if needed.
	reconnect = function reconnect(error){

		var options = _.isString(domain) ? {'path': domain} : domain,
			connecting = net.connect(options, 
				function(){
					connecting.writable = true;
					conn = connecting;
					if(!userDeferred.hasBeenResolved){
						userDeferred.resolve(process.user = user);
						userDeferred.hasBeenResolved = true;
					}
				}),
			buff = '';

		connecting.setEncoding('utf-8');
		connecting.on('data', function(data){

			buff += data;

			var packs = buff.split('\r\n');

			if(packs.length > 1){

				buff = packs.pop();

				_.each(packs, function(pack){

					var response = common.deserialize(pack),
						token = response.token,
						namespace = response.ns,
						key = response.key,
						value = response.value;

					if(token === CHN){
						
						changes[namespace] = changes[namespace] || {};
						_.each(changes[namespace][key] || [], function(whenChange){
							whenChange(value, key);
						});

						_.invoke(anyChanges[namespace] || [], 'call', null, value, key);
					}
					else if(token === PONG){//just to keep the connection open
						
						common.write(connecting, common.serialize({
							'type': PONG,
							'token': PONG
						}));
					}
					else{
						
						handlers[token].apply(user, [
							response.status, 
							key || response.keys || response.namespaces, 
							value, 
							response.persist, 
							response.expire
						]);
					}
				});
			}
		});
		
		connecting.once('close', function(error){

			connecting.writable = false;
			connecting.destroy();
			
			reconnect(error);
		});
	};

var user = process.user || {

	'ns': function(options){
		
		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillNs = when.defer(),
			handler = function(status, namespaces){

				if(success === status){

					tillNs.resolve(namespaces || []);
				}
				else{

					tillNs.reject(new Error('failed to get namespaces'));
				}
			};

		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': NS,
			'token': token
		}));

		return (wait > 0 ? timeout(wait, tillNs.promise) : tillNs.promise).ensure(function(){
			delete handlers[token];
		});	
	},

	'keys': function(namespace, options){

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillKeys = when.defer(),
			handler = function(status, keys){

				if(success === status){

					tillKeys.resolve(keys || []);
				}
				else{

					tillKeys.reject(new Error('failed to get keys'));
				}
			};

		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': ALL,
			'token': token,
			'ns': namespace
		}));

		return (wait > 0 ? timeout(wait, tillKeys.promise) : tillKeys.promise).ensure(function(){
			delete handlers[token];
		});	
	},

	'get': function(namespace, key, loader, options){

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillGet = when.defer(),
			handler = function handler(status, key, value){

				if(success === status && value !== undefined){//got the value
					
                    user.stat(namespace, 'hit');
					tillGet.resolve(value);
				}
				else if(loader){//must atomically load the value

					var watchOthers = function watchOthers(changed){
						//unregister itself immediately
						user.unwatch(namespace, key, watchOthers);
						
						if(changed !== undefined){
                            user.stat(namespace, 'hit');
							tillGet.resolve(changed);
						}
						else{
                            user.stat(namespace, 'error');
							tillGet.reject(new Error('loader failed'));
						}
					};

					user.watch(namespace, key, watchOthers);
					user.lock(namespace, key, {
							'wait': wait
						})
						.then(function(locked){
							//only one of the concurrent writers will be given the set===true
							if(locked){
								
								var handleError = function handleError(error){
									throw error;
								};
                                
                                user.stat(namespace, 'miss');
								user.unwatch(namespace, key, watchOthers);//unregister immediately as i'm about to write the value
								try{
									//promise or value
									when(loader(), function(value){
                                        
	                                        user.stat(namespace, 'load');
											//success value loaded
											user.set(namespace, key, value, { 
												'wait': wait
											})
											.then(
												_.bind(tillGet.resolve, tillGet, value), 
												handleError
											);

										}, 
										handleError);
								}
								catch(e){
									//in case loaded fail
									user.stat(namespace, 'error');
									user.del(namespace, key).ensure(function(){
                                        tillGet.reject(e);
                                    });
								}	
							}
						});
				}
				else{
					//got nothing
                    user.stat(namespace, 'miss');
					tillGet.resolve(null);//no value, but resolved
				}
			};

		
		//local copy miss, fetch from master cache
		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': GET,
			'token': token,
			'ns': namespace,
			'key': key
		}));

		return (wait > 0 ? timeout(wait, tillGet.promise) : tillGet.promise).ensure(function(){
			delete handlers[token];
		});	
	},

	'inspect': function(namespace, key, options){
	
		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillInspect = when.defer(),
			handler = function(status, key, value, persist, expire){

				if(success === status && value !== undefined){

					tillInspect.resolve([value, persist, expire]);
				}
				else{
					tillInspect.reject(new Error('no value found for key'));
				}
			};

		//local copy miss, fetch from master cache
		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': INSPECT,
			'token': token,
			'ns': namespace,
			'key': key
		}));

		return (wait > 0 ? timeout(wait, tillInspect.promise) : tillInspect.promise).ensure(function(){
			delete handlers[token];
		});	
	},

	/**
	 * @param key string
	 * @param value Object
	 * @param options {
	 		persist boolean (whether should survice cache-mgr failure)
	 		expire number (time to live, default null, won't expire)
			wait number (timeout after wait expired)
	 		leaveIfNonNull boolean (true means the set will backout if the value exists, default as false, which will overwrite the value)
	 * }
	 */
	'set': function(namespace, key, value, options){//must guarantee that value has no '\r\n' in it (if it's a string or any complex type)

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillSet = when.defer(),
			handler = function(status, key){

                tillSet.resolve(success === status);
			};

		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': SET,
			'token': token,
			'ns': namespace,
			'key': key,
			'value': value,
			'leaveIfNonNull': options.leaveIfNonNull
		}));

		return (wait > 0 ? timeout(wait, tillSet.promise) : tillSet.promise).ensure(function(){
			delete handlers[token];
		});
	},

    'lock': function(namespace, key, options){//must guarantee that value has no '\r\n' in it (if it's a string or any complex type)

        options = options || {};

        var token = nextToken(),
            wait = options.wait,
            tillLock = when.defer(),
            handler = function(status, key){

                tillLock.resolve(success === status);
            };

        handlers[token] = handler;

        common.write(conn, common.serialize({
            'type': LOCK,
            'token': token,
            'ns': namespace,
            'key': key,
            'value': process.pid
        }));

        return (wait > 0 ? timeout(wait, tillLock.promise) : tillLock.promise).ensure(function(){
            delete handlers[token];
        });
    },

	/**
	 * @param key string
	 * @param wait number (timeout after wait expired)
	 */
	'del': function(namespace, key, options){

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillDel = when.defer(),
			handler = function(status, key, value){

                tillDel.resolve(success === status ? value : null);
			};

		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': DEL,
			'token': token,
			'ns': namespace,
			'key': key
		}));

		return (wait > 0 ? timeout(wait, tillDel.promise) : tillDel.promise).ensure(function(){
			delete handlers[token];
		});
	},

	'watch': function(namespace, key, callback){

		if(!key){
			anyChanges[namespace] = anyChanges[namespace] || [];
			anyChanges[namespace].push(callback);
		}
		else{
			changes[namespace] = changes[namespace] || {};
			changes[namespace][key] = changes[namespace][key] || [];
			changes[namespace][key].push(callback);
		}
	},

	'unwatch': function(namespace, key, callback){

		if(!key){
			anyChanges[namespace] = _.without(anyChanges[namespace] || [], callback);
		}
		else{
			changes[namespace] = changes[namespace] || {};
			changes[namespace][key] = _.without(changes[namespace][key] || [], callback);
		}
	},
    
    'stat': function(namespace, action){
        
        var stat = stats[namespace] = stats[namespace] || {
        
            'hit': 0,
            'miss': 0,
            'load': 0,
            'error': 0
        };
		
        if(action){
            stat[action] += 1;
        }
        
        return stat;
	},

	'switchDomain': function(d){//only in case of cache-mgr down and needs to switch to a new one
		
		if(d && domain !== d){
			
			domain = d;
			if(conn){
				conn.writable = false;
				conn.end();
			}
			reconnect();
		}
	},

	'pong': function(){

	}
};

//when the cache-mgr is created by a replacement process, the new domain will be written to the same file being watched below
var tillExists = function(path){
	fs.exists(path, function(exists){
		if(exists){
			fs.watchFile(path, 
				function(){
					fs.readFile(path, {
							'encoding': 'utf-8'
						}, 
						function(err, d){
							logger.info('[cache] switching domain:%s', d);
							user.switchDomain(d);
						});
				});
		}
		else{
			process.nextTick(function(){
				tillExists(path);
			});
		}
	});
};

exports.user = function(domain){

	if(!process.userPromise){//each process needs at most one cache user

		logger.info('[cache] user created');

		tillExists(common.domainPath);

		user.switchDomain(domain || fs.readFileSync(common.domainPath, {'encoding':'utf-8'}));
	
		process.userPromise = userDeferred.promise;
	}

	return process.userPromise;
};

