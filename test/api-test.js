'use strict';

var should = require('should');

describe('cluster2', function(){

	describe('#isMaster', function(){

		it('should assert true', function(done){

			var cluster2 = require('../lib/index');
			cluster2.isMaster.should.equal(true);
			cluster2.isWorker.should.equal(false);

			done();

		});
		
	});

	describe('#listen', function(){

		it('should start listening app', function(done){

			done();

		});

	});

});