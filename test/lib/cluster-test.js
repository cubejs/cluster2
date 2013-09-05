'use strict';

var Cluster = require('../../lib/index.js'),
	util = require('util'),
	express = require('express'),
	app = express();

app.get('/', function(req, res){

	require('../../lib/cache-usr.js').user()
		.then(function(usr){

			console.log('cache user started');

			usr.get('key', function(){
					return 'value';
				})
				.then(function(value){
					res.send(util.format('hello from:%d whose cached value is:%j', process.pid, value), 200);
				});
		});
});

new Cluster({
	'noWorkers': 1,
	'createServer': require('http').createServer,
	'app': app,
	'port': 8080
})
.listen();