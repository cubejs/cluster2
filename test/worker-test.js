'use strict';

var should = require('should'),
	express = require('express'),
	request = require('request'),
	util = require('util'),
	_ = require('underscore'),
	getLogger = require('../lib/utils').getLogger,
	pickAvailablePort = require('../lib/utils').pickAvailablePort,
	Worker = require('../lib/worker').Worker,
	EventEmitter = require('events').EventEmitter;

describe('worker', function(){

	before(function(done){

		process.getLogger = getLogger;
		done();
	});

	describe('#construction', function(){

		it('should create a worker instance', function(done){

			this.timeout(10000);

			var logger = process.getLogger();

			pickAvailablePort(7000, 7999).then(function(port){

				logger.info('[test] port picked:%d', port);

				var emitter = new EventEmitter();
				emitter.to = function(targets){

					return {
						'emit': function(){
							emitter.emit.apply(emitter, arguments);
						}
					};
				};

				var app = express(),
					configured = false,
					warmed = false,
					worker = new Worker(process, {
						'emitter': emitter,
						'createServer': require('http').createServer,
						'app': app,
						'port': port,
						'configureApp': function(app){
							configured = true;
						},
						'warmUp': function(){
							warmed = true;
						},
						'gc': {
							'monitor': true
						}
					});

				logger.info('[test] worker created');

				var memory = [];
				app.get('/', function(req, res){

					memory.push(memory);//this should let GC kick in quickly

					res.send(200);
				});

				logger.info('[test] app created');

				worker.should.be.ok;
				worker.isMaster.should.equal(false);
				worker.isWorker.should.equal(true);
				worker.pid.should.equal(process.pid);
				worker.debug.should.not.be.ok;
				worker.aliveConnections.should.equal(0);
				worker.totalConnections.should.equal(0);
				worker.status.should.be.ok;
				worker.gc.should.be.ok;
				worker.gc.incremental.should.equal(0);
				worker.gc.full.should.equal(0);
				worker.error.should.be.ok;
				worker.error.fatal.should.equal(0);
				worker.error.count.should.equal(0);

				_.isFunction(worker.listen).should.equal(true);
				_.isFunction(worker.run).should.equal(true);
				_.isFunction(worker.whenGC).should.equal(true);
				_.isFunction(worker.whenHeartbeat).should.equal(true);
				_.isFunction(worker.whenStop).should.equal(true);
				_.isFunction(worker.whenExit).should.equal(true);

				worker.listen().then(function(resolve){

					resolve.should.be.ok;
					resolve.server.should.be.ok;
					resolve.app.should.equal(app);
					resolve.port.should.equal(port);
					should.not.exist(resolve.master);
					resolve.worker.should.equal(worker);
					configured.should.equal(true);
					warmed.should.equal(true);

					var hit = util.format('http://localhost:%d/', port);

					request.get(hit, function(err, response, body){

						should.not.exist(err);
						response.should.be.ok;
						response.statusCode.should.equal(200);

						//now we'll verify gc
						emitter.on('gc', function(usage, type){

							logger.info('[test] gc happended');

							type.should.be.ok;

							numOfGCs += 1;
						});

						var numOfGCs = 0,
							load = function load(){
								request.get(hit, function(err, response, body){

									should.not.exist(err);
									response.should.be.ok;
									response.statusCode.should.equal(200);

									if(numOfGCs < 2){
										load();
									}
									else{
										//now we'll verify heartbeat
										done();
									}
								});
							};

						load();
					});

				}, done);
			});

		});
	});

});