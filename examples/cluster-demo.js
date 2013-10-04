'use strict';

var listen = require('../lib/index').listen,
	util = require('util'),
	express = require('express'),
	app = express();

listen({
	'createServer': require('http').createServer,
	'app': app,
	'configureApp': function(){
		
		//by the time, user application gets here, master already started, cache service started, caching is ready to be used.

		app.get('/', function(req, res){

			var cache = require('../lib/cache').use('demo-cache');

			var key = req.query.key,
				val = req.query.value;

			if(!key){
				cache.get('key', function(){
						return 'value';
					})
					.then(function(value){
						res.send(util.format('hello from:%d whose cached value is:%j', process.pid, value), 200);
					});
			}
			else{
				console.log('[cache] set:%s=%j', key, val);
				cache.set(key, val)
					.then(function(set){
						res.send(util.format('[cache] set:%s to value:%j result:%s', key, val, set), 200);
					});
			}
			
		});

		return app;//in the end, the configured application (with middlewares, routes registered) should be returned
	},
	'debug': {
		'webPort': 9092,
		'saveLiveEdit': true
	},
	'gc': {
		'monitor': true
	}
})
.then(function(resolve){

	require('../lib/status').register('worker', function(){
		
		return process.pid;
	});
})
.otherwise(function(error){

	console.trace(error);
});
