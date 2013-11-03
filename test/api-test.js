'use strict';

var should = require('should'),
	getLogger = require('../lib/utils').getLogger;

describe('cluster2', function(){

	before(function(done){

		process.getLogger = getLogger;

		done();
	});
		
	describe('#isMaster', function(){

		it('should assert true', function(done){

			var cluster2 = require('../lib/index');
			cluster2.isMaster.should.equal(true);
			cluster2.isWorker.should.equal(false);
			cluster2.emitter.should.be.ok;
			cluster2.cacheManager.should.be.ok;
			cluster2.status.should.be.ok;

			done();

		});

	});

	describe('#listen', function(){

		it('should start listening app', function(done){

			done();

		});

	});

	describe('#run', function(){

		it('should start running the given runnable', function(done){

			done();
			
		});

	});

});