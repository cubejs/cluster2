'use strict';

var should = require('should'),
	_ = require('underscore'),
	util = require('util'),
	express = require('express'),
	request = require('request'),
	EventEmitter = require('events').EventEmitter,
    getLogger = require('../lib/utils').getLogger,
    pickAvailablePorts = require('../lib/utils').pickAvailablePorts;

describe('master', function(){

	before(function(done){

		process.getLogger = getLogger;
		done();
	});

	describe('#construction', function(){

		it('should create a master', function(done){

			var logger = process.getLogger(),
				Master = require('../lib/master').Master;

			pickAvailablePorts(7000, 7999, 4).then(function(ports){

				logger.info('[test] ports picked:%j', ports);

				var emitter = new EventEmitter(),
					app = express(),
					master = new Master(process, {
						'emitter': emitter,
						'monCreateServer': require('http').createServer,
						'monConfigureApp': function(monApp){
							return monApp;
						},
						'monApp': app,
						'monPort': ports[0],
						'port': ports[1],
						'noWorkers': 0,
						'debug': {
							'debugPort': ports[2],
							'webPort': ports[3]
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
					resolve.port.should.equal(ports[0]);
					should.not.exist(resolve.worker);
					resolve.master.should.equal(master);

					var hit = util.format('http://localhost:%d/', ports[0]);

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