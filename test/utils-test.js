'use strict';

var should = require('should'),
	utils = require('../lib/utils'),
	path = require('path'),
	when = require('when'),
	fs = require('graceful-fs'),
	_ = require('underscore');

describe('utils', function(){

	describe('#ensureDir', function(){

		it('should mkdir if it does not exist', function(done){

			this.timeout(1000);

			var ensureDir = utils.ensureDir,
				dir = path.join(__dirname, '/ensureDir-' + Date.now());

			fs.existsSync(dir).should.equal(false);

			ensureDir(dir);
			fs.existsSync(dir).should.equal(true);

			ensureDir(dir);
			fs.existsSync(dir).should.equal(true);

			var touch = path.join(dir, 'touch.txt');

			fs.writeFileSync(touch, '');
			fs.existsSync(touch).should.equal(true);

			ensureDir(dir);
			fs.existsSync(touch).should.equal(true);

			ensureDir(dir, true);
			fs.existsSync(touch).should.equal(false);

			fs.unlink(dir, function(){
				done();
			});

		});

	});

	describe('#writePid', function(){

		it('should writePid to a given dir', function(done){

			this.timeout(1000);

			var writePid = utils.writePid,
				dir = path.join(__dirname, '/writePid-' + Date.now()),
				pid = process.pid;

			writePid(pid, dir);
			fs.existsSync(dir).should.equal(true);

			var written = fs.readdirSync(dir);
			written.should.be.ok;

			_.some(_.map(written, function(filename){

				if(/master\.([\d]+)\.pid/.test(filename)){
					//filename matched, further verifyt the pid
					var verifyPid = fs.readFileSync(path.join(dir, filename), {'encoding':'utf-8'});
					return verifyPid && parseInt(verifyPid, 10) === pid;
				}
				else{
					//not matched
					return false;
				}

			})).should.equal(true);

			done();
		});
	});

	describe('#readPids', function(){

		it('should read all pids from a given dir', function(done){

			this.timeout(1000);

			var writePid = utils.writePid,
				readPids = utils.readPids,
				dir = path.join(__dirname, '/readPids-' + Date.now()),
				pid = process.pid;

			writePid(pid, dir);
			fs.existsSync(dir).should.equal(true);

			var pids = readPids(dir);
			pids.should.be.ok;
			pids.should.include(pid);

			done();
		});
	});

	describe('#readMasterPid', function(){

		it('should read master pid from a given dir', function(done){

			this.timeout(1000);

			var writePid = utils.writePid,
				readMasterPid = utils.readMasterPid,
				dir = path.join(__dirname, '/readMasterPid-' + Date.now()),
				pid = process.pid;

			writePid(pid, dir);
			fs.existsSync(dir).should.equal(true);

			var masterPid = readMasterPid(dir);
			masterPid.should.be.ok;
			masterPid.should.equal(pid);
			
			done();
		});
	});

	describe('#getNodeInspectorPath', function(){

		it('should get the path of node-inspector', function(done){

			this.timeout(500);

			var nodeInspectorPath = utils.getNodeInspectorPath();
			nodeInspectorPath.should.be.ok;
			
			var stat = fs.statSync(nodeInspectorPath);
			stat.should.be.ok;
			stat.isFile().should.equal(true);

			done();
		});
	});

	describe('#assertOld', function(){
        
        it('should use the heuristic to determine when gc is hurting tps', function(done){
        
            //whenever tps grow up, whether or not other metrics goes up/down assertion should be false.
            var pid = Math.floor(process.pid * (1 + Math.random())),
                assertOld = utils.assertOld(0);//0 seconds is old
            
            _.each(_.range(0, 1000), function(ith){
            
                assertOld({
                    'pid': pid,
                    'tps': ith,
                    'cpu': ith,
                    'memory': ith,
                    'gc': {
                        'incremental': ith,
                        'full': ith
                    }
                }).should.equal(false);
            });
            
            done();
        });
    });
    
    describe('#assertBadGC', function(){
        
        it('should use the heuristic to determine when gc is hurting tps', function(done){
        
            //whenever tps grow up, whether or not other metrics goes up/down assertion should be false.
            var pid = Math.floor(process.pid * (1 + Math.random())),
                assertBadGC = utils.assertBadGC();
            
            _.each(_.range(0, 1000), function(ith){
            
                assertBadGC({
                    'pid': pid,
                    'tps': ith,
                    'cpu': ith,
                    'memory': ith,
                    'gc': {
                        'incremental': ith,
                        'full': ith
                    }
                }).should.equal(false);
            });
            
            done();
        });
        
        it('should assert true whenever a degradation of more than 10% happens', function(done){
        
            var pid = Math.floor(process.pid * (1 + Math.random())),
                assertBadGC = utils.assertBadGC();
            
            assertBadGC({
                'pid': pid,
                'tps': 50,
                'cpu': 50,
                'memory': 1000000000,
                'gc': {
                    'incremental': 100,
                    'full': 10
                }
            }).should.equal(false);
            
            assertBadGC({
                'pid': pid,
                'tps': 40,//over 10%
                'cpu': 55,//higher
                'memory': 1100000000,
                'gc': {
                    'incremental': 110,
                    'full': 11
                }
            }).should.equal(true);
            
            done();
        });
        
        it('should give 10% margin for tolerance', function(done){
            
            var pid = Math.floor(process.pid * (1 + Math.random())),
                assertBadGC = utils.assertBadGC();
            
            assertBadGC({
                'pid': pid,
                'tps': 50,
                'cpu': 50,
                'memory': 1000000000,
                'gc': {
                    'incremental': 100,
                    'full': 10
                }
            }).should.equal(false);
            
            assertBadGC({
                'pid': pid,
                'tps': 48,//less than 10%
                'cpu': 55,//higher
                'memory': 1100000000,
                'gc': {
                    'incremental': 110,
                    'full': 11
                }
            }).should.equal(false);
            
            done();
        });

    });

	describe('#deathQueue', function(){

		it('should let the suicide worker die if it is the 1st one in the queue', function(done){

			var deathQueue = utils.deathQueue,
				emitter = new (require('events').EventEmitter)();

			emitter.to = function(targets){

				return {
					'emit': function(){
						emitter.emit.apply(emitter, arguments);
					}
				};
			};

			var pid = Math.floor(process.pid * (1 + Math.random())),
				util = require('util');

			emitter.once('disconnect', function(suicide){

				suicide.should.equal(pid);

				process.nextTick(function(){
					emitter.emit(util.format('worker-%d-died', suicide));
				});

				done();
			});

			deathQueue(pid, emitter, function(){

				var successor = pid + 1;
				process.nextTick(function(){
					emitter.emit(util.format('worker-%d-warmup', successor));
				});

				return {
					'process': {
						'pid': successor
					}
				}
			});

		});

		it('should let us queue the suicide workers one after another', function(done){

			var deathQueue = utils.deathQueue,
				emitter = new (require('events').EventEmitter)();

			emitter.to = function(targets){

				return {
					'emit': function(){
						emitter.emit.apply(emitter, arguments);
					}
				};
			};

			var pid = Math.floor(process.pid * (1 + Math.random())),
				util = require('util'),
				expects = _.map(_.range(0, 10), function(ith){return pid + ith * 2;});

			emitter.on('disconnect', function(suicide){

				suicide.should.equal(expects.shift());

				process.nextTick(function(){
					emitter.emit(util.format('worker-%d-died', suicide));
				});

				if(!expects.length){
					done();
				}
			});

			_.each(_.range(0, 10), function(ith){

				var ithPid = pid + ith * 2,
					prevPid = ithPid - 2,
					ithSuccessor = ithPid + 1;

				deathQueue(ithPid, emitter, function(){

					process.nextTick(function(){

						//because we queued the deaths, at the time this ith worker is to suicide, the i - 1 th worker should have been gone!
						_.contains(expects, prevPid).should.equal(false);
						emitter.emit(util.format('worker-%d-warmup', ithSuccessor));
					});

					return {
						'process': {
							'pid': ithSuccessor
						}
					}
				});
			});
		});

	});

	describe('#gcstats', function(){

		//NOTE, we were using node-gc module, and it couldn't work together with express, socket.io, request etc.
		//we received an error 'Bus error: 10' and node program exit abnormally
		//we switched memwatch and nodefly-gcinfo modules but they were not emitting gc events at all
		//now we're using gc-stats module, which is very rough, the index.js doesn't seem to be a correct one
		//but the binary works, we wrap it in our utils and leverage only the binary part of it.
		it('should collect gc stats', function(done){

			this.timeout(30000);

			var gc = utils.gcstats,
				min = 1,
				bigger = [0], 
				nextGrowth;;

			gc.on('stats', function onStats(stats){

  				console.log('%d %j', process.pid, stats);

				stats.should.be.ok;
				/*{
					"pause":5181203,
					"pauseMS":5,
					"before":{
						"totalHeapSize":17603072,
						"totalHeapExecutableSize":3145728,
						"usedHeapSize":10838176,
						"heapSizeLimit":1535115264
					},
					"after":{
						"totalHeapSize":18635008,
						"totalHeapExecutableSize":3145728,
						"usedHeapSize":8770888,
						"heapSizeLimit":1535115264
					},
					"diff":{
						"totalHeapSize":1031936,
						"totalHeapExecutableSize":0,
						"usedHeapSize":-2067288,
						"heapSizeLimit":0
					}
				}*/
				stats.pause.should.be.ok;

				if((min -= 1) <= 0){

					clearTimeout(nextGrowth);

					gc.removeListener('stats', onStats);

					done();
				}
			});

			(function grow(){

				bigger.push(bigger);
				
				nextGrowth = setTimeout(grow, 1);

			})();

		});

	});

	describe('#ls', function(){

		it('should list all the deps', function(done){

			utils.npmls.then(function(deps){

				done();

			}, done);
		});

	});

	after(function(done){

		var rmPatterns = [
			/ensureDir-[\d]+/, 
			/writePid-[\d]+/,
			/readPids-[\d]+/,
			/readMasterPid-[\d]+/
		];

		fs.readdir(__dirname, function(err, files){

			_.each(files, function(f){

				if(_.some(_.invoke(rmPatterns, 'test', f))){

					var rm = path.join(__dirname, f),
						touches = fs.readdirSync(rm) || [];

					_.each(touches, function(t){

						fs.unlinkSync(path.join(rm, t));
					});

					fs.rmdirSync(rm);
				}
			});

			done();
		});

	});

});