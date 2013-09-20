var should = require('should'),
	express = require('express'),
	request = require('request'),
	http = require('http'),
	when = require('when'),
	_ = require('underscore'),
	EventEmitter = require('events').EventEmitter,
	getLogger = require('../../lib/utils.js').getLogger,
	exitIfBusyPort = require('../../lib/utils.js').exitIfBusyPort;

function knock(port, path, assertions){

	var deferred = when.defer();

	request.get('http://127.0.0.1:' + port + path, function(error, response, body){

		try{
			assertions(error, response, body);
			deferred.resolve(null);
		}
		catch(e){
			deferred.reject(e);
		}
	});

	return deferred.promise;
}

describe('ecv', function(){

	before(function(done){

		process.getLogger = getLogger;
		done();
	});

	describe('#enable', function(){

		it('should support control mode', function(done){

			var ecv = require('../../lib/ecv.js'),
				app = express(),
				server = http.createServer(app),
				emitter = new EventEmitter(),
				positive = function(req, res){
					res.send('postive', 200);
				},
				negative = function(req, res){
					res.send('negative', 500);
				};

			ecv.enable(app, {
				'root': '/ecv',
				'markUp': '/ecv/markUp',
				'markDown': '/ecv/markDown',
				'mode': 'control',
				'disabled': true,
				'emitter': emitter
			});

			when.any(_.map(_.range(8000, 9000), function(port){
					return exitIfBusyPort('localhost', port);
				}))
				.then(function(port){

					server.listen(port, function(){
						//server started;

						knock(port, '/ecv', function(error, response, body){

							should.not.exist(error);
							response.should.be.ok;
							response.statusCode.should.equal(500);//yet markUp
						})
						.then(function(){

							emitter.emit('warning', {'command':'enable'});

							knock(port, '/ecv', function(error, response, body){
								
								should.not.exist(error);
								response.should.be.ok;
								response.statusCode.should.equal(200);//should have been marked up
							})
							.then(function(){

								emitter.emit('warning', {'command':'disable'}); 

								knock(port, '/ecv', function(error, response, body){

									should.not.exist(error);
									response.should.be.ok;
									response.statusCode.should.equal(500);//marked down again
								})
								.then(done, done);

							}, done);
						}, done);
					});
				}, 
				function(){
					done(new Error('no port available in [8000, 9000]'));
				});
		});
	});
});