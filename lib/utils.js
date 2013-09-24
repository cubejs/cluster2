'use strict';

var http = require('http'),
	request = require('request'),
	when = require('when'),
	timeout = require('when/timeout'),
	cluster = require('cluster'),
	winston = require('winston'),
	fs = require('graceful-fs'),
	path = require('path'),
	util = require('util'),
	fork = require('child_process').fork,
	assert = require('assert'),
	_ = require('underscore'),
	ACCESS = parseInt('0755', 8);

exports.rejectIfPortBusy = function rejectIfPortBusy(host, port){
    
    var deferred = when.defer(),
    	server = http.createServer(function(req, res){

    		res.writeHead(200, {'Content-Type': 'text/plain'});
    		res.end(port.toString(10));
    	});

	server.once('error', function(e){
    	deferred.reject(new Error('Port is in use:' + port));
    });

    server.listen(port, host, function(){ //'listening' listener

    	request.get(util.format('http://%s:%d/', host, port), function(err, response, body){
    		
    		//console.log('[utils] url: http://%s:%d/ err:%j response:%j body:%s', host, port, err, response, body);
    		
    		if(!err && response && response.statusCode === 200 && parseInt(body, 10) === port){
    			server.close(function(){
    				deferred.resolve(port);
    			});
    		}
    		else{
    			deferred.reject(new Error('Port is in use:' + port));
    		}
    	});
    });

    return timeout(3000, deferred.promise);
};

global.portsAlreadyPicked = [];

exports.pickAvailablePort = function pickAvailablePort(min, max){

	function checkAvailability(deferred, port){

		if(port > max){
			deferred.reject(new Error('no port available'));
		}
		else if(_.contains(global.portsAlreadyPicked, port)){
			checkAvailability(deferred, port + 1);
		}
		else{
			exports.rejectIfPortBusy('localhost', port)
				.then(function(port){
					deferred.resolve(port);
					global.portsAlreadyPicked.push(port);
				})
				.otherwise(function(){
					checkAvailability(deferred, port + 1);
				});
		}
	}

	var available = when.defer();

	checkAvailability(available, min);

	return available.promise;
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
        fs.mkdirSync(dir, ACCESS);
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

exports.startInspector = function startInspector(webPort, debugPort, saveLiveEdit, hidden, logger){

	logger = logger || {'info': _.bind(console.log, console)};
	hidden = hidden || [];

	logger.info('[utils] starting node-inspector webPort:%d, debugPort:%d, saveLiveEdit:%s, hidden:%j', webPort, debugPort, saveLiveEdit, hidden);

	var inspectorPath = exports.getNodeInspectorPath(),
		inspectorArgs = [
			'--web-port=' + webPort, //where node-inspector process listens to users' request from v8
			'--debug-port=' + debugPort, //where node-inspector process subscribes to debugging app process
			'--save-live-edit=' + saveLiveEdit, //whether or not user could modify the debugging source and save it
			'--hidden=' + JSON.stringify(hidden)//files excluded from adding breakpoints
		];

	logger.info('[utils] starting node-inspector at:%s with args:%j', inspectorPath, inspectorArgs);

	assert.ok(inspectorPath);
			
	//NOTE, this is not _this.fork, but child_process.fork
	return fork(inspectorPath, inspectorArgs, {
			'silent': true
		});
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

