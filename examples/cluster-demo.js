'use strict';

var Cluster = require('../lib/index.js').Cluster,
	util = require('util'),
	express = require('express'),
	app = express();

app.get('/', function(req, res){

	require('../lib/cache').use('demo-cache')
		.then(function(cache){

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
});

new Cluster({
	'noWorkers': 1,
	'createServer': require('http').createServer,
	'app': app,
	'port': 9090,
	'monPort': 9091,
	'debug': {
		'webPort': 9092,
		'saveLiveEdit': true
	},
	'heartbeatInterval': 5000
})
.listen()
.then(function(resolve){

	var masterOrWorker = resolve.master || resolve.worker;

	masterOrWorker.status.register('worker', process.pid);
});
