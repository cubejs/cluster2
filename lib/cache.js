'use strict';

var _ = require('underscore'),
	when = require('when'),
	timeout = require('when/timeout'),
	pipeline = require('when/pipeline'),
	logger = process.getLogger(__filename);

var Cache = exports.Cache = function(usr, namespace, options){

	options = options || {
		'persist': false,
		'expire': 0
	};

	_.extend(this, {
		'usr': usr,
		'namespace': namespace,
		'persist': options.persist,
		'expire': options.expire
	});
};

Cache.prototype.meta = function(){

	return {
		'persist': this.persist,
		'expire': this.expire
	};
}

Cache.prototype.keys = function keys(){

	return this.usr.keys(this.namespace);
};

Cache.prototype.get = function get(key, loader, options){

	return this.usr.get(this.namespace, key, loader, options);
};

Cache.prototype.set = function set(key, value, options){

	return this.usr.set(this.namespace, key, value, options);
};

Cache.prototype.del = function del(key, options){

	return this.usr.del(this.namespace, key, options);
};

Cache.prototype.watch = function watch(key, onChange){

	return this.usr.watch(this.namespace, key, onChange);
};

Cache.prototype.unwatch = function unwatch(key, onChange){

	return this.usr.get(this.namespace, key, loader, options);
};

module.exports = {

	'use': function(namespace, options){

		var actualOptions = options || {};
		_.defaults(actualOptions, {
			'persist': false,
			'expire': 0,
			'timeout': 3000
		});

		return pipeline([
			function(domain){

				logger.info('[cache] using domain:%s', domain);
				return require('./cache-usr.js').user(domain);
			}, 
			function(usr){

				logger.info('[cache] usr ready, and using namespace:%s & options:%j', namespace, actualOptions);
				return when.join(usr, usr.get('', namespace, function(){

					return actualOptions;
				}));
			},
			function(resolve){

				var usr = resolve[0],
					meta = resolve[1];

				logger.info('[cache] namespace:%s reserved with meta:%j', namespace, meta);
				return new Cache(usr, namespace, meta);
			}
		], actualOptions.domain);//optional

		/*var waitToUse = when.defer();

		require('./cache-usr.js').user(actualOptions.domain)
			.then(function(usr){
				usr.get('', namespace, function(){
						return actualOptions;
					})
					.then(function(meta){
						waitToUse.resolve(new Cache(usr, namespace, meta));
					});
			});

		return timeout(actualOptions.timeout, waitToUse.promise);*/
	}
};
