'use strict';

var componentStatus = require('../lib/component-status.js').componentStatus,
	should = require('should');

describe('component-status', function(){

	describe('#register', function(){

		it('should allow registration', function(done){

			componentStatus.register('health', function(params){
				return 'i am healthy\n';
			});

			componentStatus.reducer('health', function(memoize, health){
				return {
					value : memoize && health
				};
			});

			componentStatus.getComponents().should.include('health');

			componentStatus.getStatus('health', {
				done : function(status){
					status.should.be.ok;
					done();	
				}
			});
		});
	});
});