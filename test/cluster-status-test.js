'use strict';

var should = require('should'),
	fork = require('child_process').fork,
	getLogger = require('../lib/utils').getLogger;

describe('cluster-status', function(){

	before(function(done){

		process.getLogger = getLogger;
		done();
	});

	describe('#statuses', function(){

		it('should get no status at the beginning', function(done){

			var status = require('../lib/status');

			status.statuses().should.be.ok;
			status.statuses().length.should.equal(0);

			done();

		});

	});

	describe('#register', function(){

		it('should allow register of an immutable component', function(done){

			var status = require('../lib/status'),
				name = 'immutable-status-' + Date.now(),
				view = 'view-' + name;

			status.getStatus(name).then(done, function(){

				status.register(name, function(){
					return view;
				});

				status.getStatus(name).then(function(result){

					result.should.be.ok;
					result.length.should.equal(1);

					var stat = result.shift();
					stat.should.be.ok;
					stat.pid.should.equal(process.pid);
					stat.name.should.equal(name);
					stat.status.should.equal(view);

					status.setStatus(name, 'noop').then(function(){ //as we didn't register update, setStatus should have no effect at all.

						status.getStatus(name).then(function(result){

							result.should.be.ok;
							result.length.should.equal(1);

							var stat = result.shift();
							stat.should.be.ok;
							stat.pid.should.equal(process.pid);
							stat.name.should.equal(name);
							stat.status.should.equal(view);

							done();

						});

					}, done);

				}, done);
			});
		});

		it('should allow register of a mutable component', function(done){

			var status = require('../lib/status'),
				name = 'mutable-status-' + Date.now(),
				view = 'view-' + name,
				updated = 'updated-' + name;

			status.getStatus(name).then(done, function(){

				status.register(name, function(){
						return view;
					},
					function(update){
						view = update;
					});

				status.getStatus(name).then(function(result){

					result.should.be.ok;
					result.length.should.equal(1);

					var stat = result.shift();
					stat.should.be.ok;
					stat.pid.should.equal(process.pid);
					stat.name.should.equal(name);
					stat.status.should.equal(view);


					status.setStatus(name, updated).then(function(){ //as we didn't register update, setStatus should have no effect at all.

						status.getStatus(name).then(function(result){

							result.should.be.ok;
							result.length.should.equal(1);

							var stat = result.shift();
							stat.should.be.ok;
							stat.pid.should.equal(process.pid);
							stat.name.should.equal(name);
							stat.status.should.equal(updated);

							done();

						});

					}, done);

				}, done);
			});
		});

	});

	//need to add test for cluster mode.
	//we'll need to verify that statuses, register, setStatus, getStatus all work from workers view, masters view
	//worker should see components registered by itself
	//master should see components registered by itself and all of its workers

	describe('cluster-status', function(){

		it('should work in cluster mode', function(done){

			this.timeout(5000);

			var token = 't-' + Date.now(),
				clusterRuntime = fork(require.resolve('./lib/cluster-status-runtime'), ['--token=' + token]);
			
			clusterRuntime.once('message', function(msg){

				console.log('[test] message:%j, exit:%j', msg, msg.exit);

				done(msg.exit);

			});

		});
	});

});