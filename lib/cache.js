'use strict';

var _ = require('underscore'),
	when = require('when'),
	timeout = require('when/timeout'),
	pipeline = require('when/pipeline'),
	logger = process.getLogger(__filename);

var Cache = exports.Cache = function(namespace, usrAndMetaPromise){

	_.extend(this, {

		'namespace': namespace,
		
		'getUsrAndMeta': function(){

			return usrAndMetaPromise;
		},
		
		'pipeKeys': function(usrAndMeta){
		
			return usrAndMeta.usr.keys(namespace);
		},
		
		'getPipeGet': function(key, loader, options){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.get(namespace, key, loader, options);
			};
		},
		
		'getPipeSet': function(key, value, options){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.set(namespace, key, value, options);
			};
		},
		
		'getPipeDel': function(key, options){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.del(namespace, key, value, usrAndMeta.meta);
			};
		},
		
		'getPipeWatch': function(key, onChange){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.watch(namespace, key, onChange);
			};
		},

		'getPipeUnwatch': function(key, onChange){

			return function(usrAndMeta){
			
				return usrAndMeta.usr.unwatch(namespace, key, onChange)
			};
		},

		'pipeStat': function(usrAndMeta){

			return usrAndMeta.usr.stat(namespace);
		},

		'pipeDestroy': function(usrAndMeta){

			return usrAndMeta.usr.del('', namespace);
		}
	});
};

Cache.prototype.meta = function(){

	return this.getUsrAndMeta().then(function(usrAndMeta){

		return usrAndMeta.meta;
	});
}

Cache.prototype.keys = function keys(){

	return pipeline([this.getUsrAndMeta, this.pipeKeys]);
};

Cache.prototype.get = function get(key, loader, options){

	return pipeline([this.getUsrAndMeta, this.getPipeGet(key, loader, options)]);
};

Cache.prototype.set = function set(key, value, options){

	return pipeline([this.getUsrAndMeta, this.getPipeSet(key, value, options)]);
};

Cache.prototype.del = function del(key, options){

	return pipeline([this.getUsrAndMeta, this.getPipeDel(key, options)]);
};

Cache.prototype.watch = function watch(key, onChange){

	return pipeline([this.getUsrAndMeta, this.getPipeWatch(key, onChange)]);
};

Cache.prototype.unwatch = function unwatch(key, onChange){

	return pipeline([this.getUsrAndMeta, this.getPipeUnwatch(key, onChange)]);
};

Cache.prototype.stat = function stat(){

	return pipeline([this.getUsrAndMeta, this.pipeStat]);
};

Cache.prototype.destroy = function destroy(){

	return pipeline([this.getUsrAndMeta, this.pipeDestroy]);
};

module.exports = {

	'enable': _.once(function(options, master){
	
		if(!options.enable || !require('cluster').isMaster){
			//only master is allowed to enable cache
			return;
		}

		if(options.mode === 'standalone' && master){

			master.fork(master.options, {
				'CACHE_MANAGER': true
			});
		}
		else{
			
			var mgr = require('./cache-mgr'),
				svr = mgr.createServer(mgr.app);

			svr.listen(mgr.port, mgr.afterServerStarted);
		}
	}),

	'use': function(namespace, options){

		var actualOptions = options || {};
		
		_.defaults(actualOptions, {
			'persist': false,
			'expire': 0,
			'timeout': 3000
		});

		return new Cache(namespace, pipeline([
			
			function(domain){

				logger.debug('[cache] using domain:%s', domain);
				return require('./cache-usr').user(domain);
			}, 

			function(usr){

				logger.debug('[cache] usr ready, and using namespace:%s & options:%j', namespace, actualOptions);
				return when.join(usr, usr.get('', namespace, function(){

					return actualOptions;
				}));
			},
			
			function(resolve){

				var usr = resolve[0],
					meta = resolve[1];

				logger.debug('[cache] namespace:%s reserved with meta:%j', namespace, meta);
				return {
					'usr': usr, 
					'meta': meta
				};
			}
		], actualOptions.domain));//optional
	}
};
