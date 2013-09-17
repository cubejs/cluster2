'use strict';

var promiseOfUsr = require('../../lib/cache-usr.js').user(process.env['domain']),
	when = require('when'),
	should = require('should');

var counter = 0;

promiseOfUsr.then(function(usr){

	for(var i = 0; i < 10000; i += 1){

		usr.get('k2', function(){
				return 'v2';
			})
			.then(function(v){
				//should be v2
				v.should.equal('v2');
				counter += 1;
			});
	}
});

setTimeout(function(){
	console.log('test got:' + counter);
	process.exit(0);
}, 3000);