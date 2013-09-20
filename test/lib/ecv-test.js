var should = require('should'),
	express = require('express'),
	request = require('request'),
	http = require('http'),
	when = require('when'),
	timeout = require('when/timeout'),
	_ = require('underscore'),
	EventEmitter = require('events').EventEmitter,
	getLogger = require('../../lib/utils.js').getLogger,
	rejectIfPortBusy = require('../../lib/utils.js').rejectIfPortBusy;

function knock(port, path, assertions){

	var deferred = when.defer();

	request.get('http://127.0.0.1:' + port + path, function(error, response, body){

		assertions = assertions || function(){};
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

		it('should support control mode via emitter', function(done){

			this.timeout(3000);

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
					return rejectIfPortBusy('localhost', port);
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
								.then(done, done);//fail due to ecv check incorrect after markdown

							}, done);//fail due to ecv check incorrect after markup

						}, done);//fail due to initial ecv check failed

					});

				}, done);//fail due to ports rejected
		});

		it('should support control mode via urls', function(done){

			this.timeout(5000);

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
					return rejectIfPortBusy('localhost', port);
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

							var expectMarkUpAlert = when.defer();

							emitter.once('markUp', function(target){
								expectMarkUpAlert.resolve(target);
							});

							when.join(knock(port, '/ecv/markUp'), timeout(1000, expectMarkUpAlert.promise)).then(function(){

								knock(port, '/ecv', function(error, response, body){
									
									should.not.exist(error);
									response.should.be.ok;
									response.statusCode.should.equal(200);//should have been marked up
								})
								.then(function(){

									var expectMarkDownAlert = when.defer();

									emitter.once('markDown', function(target){
										expectMarkDownAlert.resolve(target);
									});

									when.join(knock(port, '/ecv/markDown'), timeout(1000, expectMarkDownAlert.promise)).then(function(){

										knock(port, '/ecv', function(error, response, body){

											should.not.exist(error);
											response.should.be.ok;
											response.statusCode.should.equal(500);//marked down again
										})
										.then(done, done); //fail due to incorrect ecv after mark down

									}, done); //fail due to either mark down rejected or mark down status change event not received

								}, done); //fail due to incorrect ecv after mark up

							}, done); //fail due to either mark up rejected or mark up status change event not received

						}, done); //fail due to initial ecv check failed

					});

				}, done); //fail due to all ports rejected
		});
	});
});
