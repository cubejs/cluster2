var net = require('net'),
	when = require('when'),
	timeout = require('when/timeout'),
	cluster = require('cluster'),
	winston = require('winston'),
	fs = require('graceful-fs'),
	path = require('path'),
	util = require('util');

exports.exitIfBusyPort = function exitIfBusyPort(host, port) {
    
    var deferred = when.defer(),
    	server = net.createServer();

    server.once('error', function (e) {
        if(e.code === 'EADDRINUSE') {
            console.trace('Port is use ..' + port);
            deferred.resolved(true)
        }
    });

    server.listen(port, host, function() { //'listening' listener

        server.close();
        deferred.resolve(false);
    });

    return timeout(3000, deferred.promise);
};

exports.ensureDir = function ensureDir(dir, clean) {
    try {
        fs.readdirSync(dir);
        if(clean) {
            var paths = fs.readdirSync(dir);
            paths.forEach(function(filename) {
                try {
                    fs.unlink(dir + '/' + filename);
                }
                catch(e) {

                }
            });
        }
    }
    catch(e) {
        fs.mkdirSync(dir, 0755);
    }
};

exports.writePid = function writePid(pid, dir) {

	pid = pid || process.pid;
	dir = dir || path.join(process.cwd(), '/pids');
	
	exports.ensureDir(dir);

	var persist = util.format('%s.%d.pid', cluster.isMaster ? 'master' : 'worker', pid);

	fs.writeFileSync(path.join(dir, persist), pid, {
		'encoding': 'utf-8'
	});
};

exports.readPids = function readPids(dir) {
	
	dir = dir || path.join(process.cwd(), '/pids');
	exports.ensureDir(dir);

	return _.map(fs.readdirSync(dir), function(filename){

		return fs.readSync(path.join(dir, filename), {
			'encoding': 'utf-8'
		});
	});
};

exports.readMasterPid = function readMasterPid(dir) {

	dir = dir || path.join(process.cwd(), '/pids');
	exports.ensureDir(dir);

	return fs.readSync(
		path.join(dir, 
			_.filter(fs.readdirSync(dir), function(filename){
				return /master\./.test(filename);
			})[0]), 
		{
			'encoding': 'utf-8'
		});
};

exports.getNodeInspectorPath = function getNodeInspectorPath(){

	var here = path.join(__dirname, '..'),//see if it's under cluster's node_modules
		find = function(dir){

			if(fs.existsSync(path.join(dir, './node_modules/node-inspector'))){
				return path.join(dir, './node_modules/node-inspector/bin/inspector.js');
			}

			if(dir === process.cwd()){
				return null;
			}

			return find(path.join(dir, '..'));
		};

	return find(here);
};

exports.getLogger = function getLogger(){
	return new (winston.Logger)({
	    'transports': [
	    	new (winston.transports.Console)()/*,
	    	new (winston.transports.File)({ 
	    		'filename': path.join('./log', process.pid + '.log'),
	    		'maxsize': 4 * 1024 * 1024,//4mb
	    		'maxFiles': 4//4 files max, 16mb for each process
	    	})*/
	    ]
	});
};

