'use strict';

var _ = require('underscore'),
	net = require('net'),
	util = require('util'),
	when = require('when'),
	timeout = require('when/timeout'),
	fs = require('graceful-fs'),
	common = require('./cache-common.js');
	
var success = common.status.success,
	failure = common.status.failure,
	GET = common.types.GET,
	SET = common.types.SET,
	DEL = common.types.DEL,
	CHN = common.changeToken,
	nextToken = common.nextToken,
	domain = null,
	userDeferred = when.defer(),
	handlers = {

	},
	changes = {

	},
	anyChange = function(){

	},
	conn = null,
	reconnect = function reconnect(){

		var options = _.isString(domain) ? {'path': domain} : domain,
			connecting = net.connect(options, 
				function(){
					console.log(options);
					connecting.writable = true;
					conn = connecting;
					if(!userDeferred.hasBeenResolved){
						userDeferred.resolve(user);
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
						key = response.key,
						value = response.value,
						status = response.status;

					if(token !== CHN){
						if(!handlers[token]){
							console.log('pid:' +process.pid + '?token:' + token + ';key:' + key);
							process.exit(-1);
						}
						else{
							handlers[token].apply(user, [status, key, value]);
						}
					}
					else{
						_.each(changes[key], function(whenChange){
							whenChange(value);
						});
						anyChange(key, value);
					}
				});
			}
		});

		connecting.once('error', function(){
			connecting.writable = false;
			reconnect();
		});
	};

var user = {

	'copy': null,

	'get': function(key, loader, options){

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillGet = when.defer(),
			handler = function(status, key, value){

				if(success === status && value){//got the value
					
					if(user.copy){//copy the value fetched from master cache, this is needed for consistency restore, unmakeCopy then makeCopy etc.
						user.copy[key] = value;
					}

					tillGet.resolve(value);
				}
				else if(loader){//must atomically load the value

					var watchOthers = function(changed){
						//unregister itself immediately
						user.unwatch(key, watchOthers);
						tillGet.resolve(changed);
					};

					user.watch(key, watchOthers);
					user.set(key + '/lock', process.pid, {
							'persist': options.persist,
							'expire': options.expire,
							'wait': wait, 
							'leaveIfNonNull': true
						})
						.then(function(set){
							//only one of the concurrent writers will be given the set===true
							if(set){
								user.unwatch(key, watchOthers);//unregister immediately as i'm about to write the value
								var loaded = loader();
								user.set(key, loaded, {
										'persist': options.persist,
										'expire': options.expire, 
										'wait': wait
									})
									.then(function(){
										tillGet.resolve(loaded);
									});
							}
						});
				}
				else{//got nothing

					tillGet.resolve(null);
				}
			};

		if(user.copy && user.copy[key] !== undefined){
			console.log('copy hit');
			//local copy hit
			tillGet.resolve(user.copy[key]);
		}
		else{
			//local copy miss, fetch from master cache
			handlers[token] = handler;

			common.write(conn, common.serialize({
				'type': GET,
				'token': token,
				'key': key
			}));
		}

		return (wait > 0 ? timeout(wait, tillGet.promise) : tillGet.promise).ensure(function(){
			delete handlers[token];
		});	

		//return tillGet.promise;
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
	'set': function(key, value, options){//must guarantee that value has no '\r\n' in it (if it's a string or any complex type)

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillSet = when.defer(),
			handler = function(status, key){
				if(success === status){

					if(user.copy){//user copy enabled
						user.copy[key] = value;
					}

					tillSet.resolve(true);
				}
				else{
					tillSet.resolve(false);
				}
			};

		//console.log('expecting token:' + token);
			
		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': SET,
			'token': token,
			'key': key,
			'value': value,
			'persist': options.persist,
			'expire': options.expire,
			'leaveIfNonNull': options.leaveIfNonNull
		}));

		return (wait > 0 ? timeout(wait, tillSet.promise) : tillSet.promise).ensure(function(){
			delete handlers[token];
		});

		//return tillSet.promise;
	},

	/**
	 * @param key string
	 * @param wait number (timeout after wait expired)
	 */
	'del': function(key, options){

		options = options || {};

		var token = nextToken(),
			wait = options.wait,
			tillDel = when.defer(),
			handler = function(status, key, value){

				if(success === status){

					if(user.copy){//user copy enabled
						delete user.copy[key];
					}

					tillDel.resolve(value);
				}
				else{
					tillDel.resolve(null);
				}
			};

		handlers[token] = handler;

		common.write(conn, common.serialize({
			'type': DEL,
			'token': token,
			'key': key
		}));

		return (wait > 0 ? timeout(wait, tillDel.promise) : tillDel.promise).ensure(function(){
			delete handlers[token];
		});
	},

	'watch': function(key, callback){

		changes[key] = changes[key] || [];
		changes[key].push(callback);
	},

	'unwatch': function(key, callback){

		changes[key] = changes[key] || [];
		changes[key] = _.without(changes[key], callback);
	},

	'makeCopy': function(){

		if(user.copy !== null){//don't let repeated makeCopy request wipe out the existing copies
			return;
		}

		user.copy = {};
		anyChange = function(key, value){
			//console.log('changed');
			if(value !== null){
				user.copy[key] = value;
			}
			else{
				delete user.copy[key];
			}
		};
	},

	'unmakeCopy': function(){

		user.copy = null;
		anyChange = function(){

		};
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
							console.log('switching domain:' + d);
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

	tillExists(common.domainPath);

	user.switchDomain(domain || fs.readFileSync(common.domainPath, {'encoding':'utf-8'}));

	return userDeferred.promise;
};

