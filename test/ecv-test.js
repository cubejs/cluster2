'use strict';

var should = require('should'),
	express = require('express'),
	request = require('request'),
	http = require('http'),
	when = require('when'),
	timeout = require('when/timeout'),
	_ = require('underscore'),
	EventEmitter = require('events').EventEmitter,
	getLogger = require('../lib/utils').getLogger,
	pickAvailablePort = require('../lib/utils').pickAvailablePort;

function knock(port, path, assertions){

	var deferred = when.defer();

	request.get('http://127.0.0.1:' + port + path, function(error, response, body){

		assertions = assertions || function(){};
		try{
			assertions(error, response, body);
			deferred.resolve(null);
		}
		catch(e){
			console.trace(e);
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

		it('should support control mode via urls', function(done){

			this.timeout(5000);

			var ecv = require('../lib/ecv'),
				app = express(),
				server = http.createServer(app),
				emitter = new EventEmitter();

			emitter.to = function(targets){

				return {
					'emit': function(){
						emitter.emit.apply(emitter, arguments);
					}
				};
			};

			ecv.enable(app, {
				'root': '/ecv',
				'markUp': '/ecv/markUp',
				'markDown': '/ecv/markDown',
				'mode': 'control',
				'disabled': true,
				'emitter': emitter
			});

			pickAvailablePort(8000, 8099).then(function(port){

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
							console.log('[markUp] %j', target);
							expectMarkUpAlert.resolve(target);
						});

						when.join(knock(port, '/ecv/markUp'), timeout(2000, expectMarkUpAlert.promise)).then(function(){
							console.log('[marked up]');
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

								when.join(knock(port, '/ecv/markDown'), timeout(2000, expectMarkDownAlert.promise)).then(function(){

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

		it('should support monitor with any validator', function(done){

			this.timeout(3000);

			var ecv = require('../lib/ecv.js'),
				app = express(),
				server = http.createServer(app),
				emitter = new EventEmitter(),
				disabled = false;

			emitter.to = function(targets){

				return {
					'emit': function(){
						emitter.emit.apply(emitter, arguments);
					}
				};
			};

			pickAvailablePort(8000, 8099).then(function(port){
				
				ecv.enable(app, {
					'root': '/ecv',
					'mode': 'monitor',
					'monitor': 'http://localhost:' + port + '/',
					'validator': function(error, response, body){
						
						return !error && response.statusCode === 200;
					},
					'emitter': emitter
				});

				app.get('/', function(req, res){

					res.send(disabled ? 500 : 200);
				});

				server.listen(port, function(){

					knock(port, '/ecv', function(error, response, body){

						should.not.exist(error);
						response.should.be.ok;
						response.statusCode.should.equal(200);
					})
					.then(function(){

						disabled = true;

						knock(port, '/ecv', function(error, response, body){

							should.not.exist(error);
							response.should.be.ok;
							response.statusCode.should.equal(500);
						})
						.then(done, done);

					}, done);
				});
			});
		});
	});
});
