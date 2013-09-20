var net = require('net'),
	when = require('when'),
	timeout = require('when/timeout'),
	cluster = require('cluster'),
	winston = require('winston'),
	fs = require('graceful-fs'),
	path = require('path'),
	util = require('util'),
	_ = require('underscore');

exports.rejectIfPortBusy = function rejectIfPortBusy(host, port){
    
    var deferred = when.defer(),
    	socket = new net.Socket(),
    	server = net.createServer();

	socket.once('error', function(err) {
        
        socket.end();
        socket.destroy();
        
        server.once('error', function(e){
	        if(e.code === 'EADDRINUSE'){
	            deferred.reject(new Error('Port is use ..' + port));
	        }
	    });

	    server.listen(port, host, function(){ //'listening' listener
	    	
	    	server.close();
	        deferred.resolve(port);
	    });
	});

    socket.connect(port, host, function() {

        socket.end();
        socket.destroy();
       	
       	deferred.reject(new Error('Port is use ..' + port));
    });

    return timeout(3000, deferred.promise);
};

exports.pickAvailablePort = function pickAvailablePort(min, max){

	return when.any(_.map(_.range(min, max), function(port){
			return exports.rejectIfPortBusy('localhost', port);
		}));
};

exports.ensureDir = function ensureDir(dir, clean) {
    try {
        var paths = fs.readdirSync(dir);
        if(clean) {
            paths.forEach(function(filename) {
                try {
                    fs.unlinkSync(path.join(dir, filename));
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

		return parseInt(fs.readFileSync(path.join(dir, filename), {
			'encoding': 'utf-8'
		}), 10);
	});
};

exports.readMasterPid = function readMasterPid(dir) {

	dir = dir || path.join(process.cwd(), '/pids');
	exports.ensureDir(dir);

	return parseInt(fs.readFileSync(path.join(dir, _.filter(fs.readdirSync(dir), function(filename){
				return /master\./.test(filename);
			})[0]), 
			{
				'encoding': 'utf-8'
			}),
		10);
};

exports.getNodeInspectorPath = function getNodeInspectorPath(){

	return require.resolve('node-inspector/bin/inspector');
};

var fileLoggerTransport = new (winston.transports.File)({
		'filename': path.join('./log', process.pid + '.log'),
		'maxsize': 4 * 1024 * 1024,//4mb
		'maxFiles': 4//4 files max, 16mb for each process
	}),
	loggers = {

	};

exports.getLogger = function getLogger(category){

	if(!loggers[category]){
		loggers[category] = new (winston.Logger)({
				'transports': [
					new (winston.transports.Console)({
			    		'colorize': 'true',
			    		'label': category
			    	}),
			    	fileLoggerTransport
				]
			});
	}

	return loggers[category];
};

