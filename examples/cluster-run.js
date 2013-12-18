'use strict';

var should = require('should'),
	run = require('../lib/main').run;

run({
	'runnable': function(){

		console.log('process:%d alive and runnable executed', process.pid);
		//for user to put logic for testings here.
	},
	'noWorkers': 2,
	'debug': {
		'webPort': 9092,
		'saveLiveEdit': true
	},
	'cache': {
		'enable': true
	},
	'gc': {
		'monitor': true
	}
})
.then(function(resolve){

	require('cluster-status').register('worker', function(){
		
		return process.pid;
	});

	setTimeout(function(){
		//worker die in 1s, master die in 1s after promise resolved.
			process.exit(0);

		}, 1000);
})
.otherwise(function(error){

	console.trace(error);
});