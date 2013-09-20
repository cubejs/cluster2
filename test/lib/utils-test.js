var should = require('should'),
	utils = require('../../lib/utils.js'),
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