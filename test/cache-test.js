'use strict';

var should = require('should'),
	getLogger = require('../lib/utils.js').getLogger,
	logger = getLogger(__filename);

describe('cache', function(){


	before(function(done){

		process.getLogger = getLogger;

		var mgr = require('../lib/cache-mgr.js'),
			svr = mgr.createServer(mgr.app);

		svr.listen(mgr.port, mgr.afterServerStarted);

		done();
	});

	describe('#cache-user', function(){

		it('should auto connect to mgr', function(done){

			this.timeout(3000);

			require('../lib/cache-usr.js').user()
				.then(function(usr){

					done();
				});
		});

		it('should support all ACID operations', function(done){

			this.timeout(3000);

			require('../lib/cache-usr.js').user()
				.then(function(usr){

					var namespace = 'ns-' + Date.now();
					logger.info('[test] using namespace:%s', namespace);

					usr.get(namespace, 'key')
						.then(function(value){

							logger.info('[test] first "key" get attempt should fail:%j', value);
							should.not.exist(value);

							usr.watch(namespace, 'key', function(value, key){

								value.should.equal('value');

								logger.info('[test] watch key triggered');
							});

							usr.watch(namespace, null, function(value, key){

								key.should.equal('key');
								value.should.equal('value');

								logger.info('[test] watch all triggered');

							});

							usr.set(namespace, 'key', 'value')
								.then(function(set){

									logger.info('[test] first "key" set attempt should succeed:%s', set);
									set.should.equal(true);

									usr.get(namespace, 'key')
										.then(function(value){

											logger.info('[test] 2nd "key" get attempt should succeed:%j', value);
											value.should.be.ok;
											value.should.equal('value');

											usr.inspect(namespace, 'key')
												.then(function(inspection){

													logger.info('[test] inspecting "key" got:%j', inspection);
													inspection.should.be.ok;
													inspection.length.should.equal(3);

													//value, persist, expire
													inspection[0].should.equal('value');
													inspection[1].should.equal(false);
													inspection[2].should.equal(0);

													done();

												}, done);

										}, done);

								}, done);

						}, done);
				});
		});
	});

	describe('#use', function(){


		it('should give a Cache interface back which hides the cache-usr behind', function(done){

			this.timeout(4000);

			var namespace = 'use-ns-' + Date.now(),
				persist = true,
				expire = 3000;

			require('../lib/cache').use(namespace, {
				'persist': persist,
				'expire': expire
			})
			.then(function(cache){

				logger.info('[test] cache obtained:%j', cache);

				cache.should.be.ok;
				cache.namespace.should.equal(namespace);

				var meta = cache.meta();
				meta.should.be.ok;
				meta.persist.should.equal(true);
				
				logger.info('[test] cache queries begin');

				cache.get('key')
					.then(function(value){

						logger.info('[test] cache 1st "get" attempt should value:%j', value);

						should.not.exist(value);

						cache.get('key', function(){

							return 'value';
						})
						.then(function(value){

							logger.info('[test] cache 2nd "get" with loader attempt should succeed given value:%j', value);

							value.should.equal('value');

							done();

						}, done);

					}, done);

				done();

			}, done);
		});

	});

});