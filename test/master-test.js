'use strict';

var should = require('should'),
	_ = require('underscore'),
	util = require('util'),
	express = require('express'),
	request = require('request'),
	EventEmitter = require('events').EventEmitter,
    getLogger = require('../lib/utils').getLogger,
    pickAvailablePort = require('../lib/utils').pickAvailablePort;

describe('master', function(){

	before(function(done){

		process.getLogger = getLogger;
		done();
	});

	describe('#construction', function(){

		it('should create a master', function(done){

			var logger = process.getLogger(),
				Master = require('../lib/master').Master;

			pickAvailablePort(8000, 8099).then(function(port){

				logger.info('[test] port picked:%d', port);

				var emitter = new EventEmitter(),
					app = express(),
					master = new Master(process, {
						'emitter': emitter,
						'monCreateServer': require('http').createServer,
						'monApp': app,
						'monPort': port,
						'port': port + 1,
						'noWorkers': 0,
						'debug': {
							'debugPort': port + 2,
							'webPort': port + 3
						},
						'cache': {

						},
						'ecv': {
							'root': '/ecv'
						}
					});

				logger.info('[test] master created');

				app.get('/', function(req, res){

					res.send(200);
				});

				logger.info('[test] app created');

				master.should.be.ok;
				master.isMaster.should.equal(true);
				master.isWorker.should.equal(false);
				master.pid.should.equal(process.pid);
				master.status.should.be.ok;
				should.not.exist(master.gc);

				_.isFunction(master.listen).should.equal(true);
				_.isFunction(master.run).should.equal(true);

				master.listen().then(function(resolve){

					resolve.should.be.ok;
					resolve.server.should.be.ok;
					resolve.app.should.equal(app);
					resolve.port.should.equal(port);
					should.not.exist(resolve.worker);
					resolve.master.should.equal(master);

					var hit = util.format('http://localhost:%d/', port);

					request.get(hit, function(err, response, body){

						should.not.exist(err);
						response.should.be.ok;
						response.statusCode.should.equal(200);

						done();
					});

				}, done);
			});
		});

	});

});