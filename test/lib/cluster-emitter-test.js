'use strict';

var should = require('should'),
	_ = require('underscore'),
	getLogger = require('../../lib/utils.js').getLogger;

describe('cluster-emitter', function(){

	before(function(done){

		process.getLogger = getLogger;
		done();
	});

	describe('master-emitter', function(){

		it('should work in none-cluster mode', function(done){

			this.timeout(500);

			var emitter = require('../../lib/cluster-emitter.js').emitter;

			emitter.should.be.ok;
			_.isFunction(emitter.emit).should.equal(true);
			_.isFunction(emitter.on).should.equal(true);
			_.isFunction(emitter.once).should.equal(true);
			_.isFunction(emitter.removeListener).should.equal(true);
			_.isFunction(emitter.removeAllListeners).should.equal(true);

			var event = 'event-' + Date.now(),
				echo = 'echo-' + event;

			emitter.once(echo, function(){//test once

				done();
			});

			emitter.on(event, function(){//test on

				emitter.emit(echo);
			});

			emitter.emit(event);//test emit
		});

	});

});