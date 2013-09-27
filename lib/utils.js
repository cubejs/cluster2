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

//here's the key feature for cluster3, based on the historic tps info, memory usage, gc rate, we could determine if a puppet should
//enter an old state from active

var peaks = {};

exports.assertOld = function assertOld(heartbeat){

    var pid = heartbeat.pid,
        currTPS = heartbeat.tps || (heartbeat.durations / heartbeat.transactions);

    if(currTPS <= 2){//TPS too low, no good for sampling as the 1st phase.
        return false;
    }

    var peak = peaks[pid] = peaks[pid] || {
            'tps': currTPS,
            'cpu': heartbeat.cpu,
            'memory': heartbeat.memory,
            'gc': {
                'incremental': heartbeat.gc.incremental,
                'full': heartbeat.gc.full
            }
        };//remember the peak of each puppet

    if(currTPS >= peak.tps){
        peak.tps = Math.max(heartbeat.tps, peak.tps);
        peak.cpu = Math.max(heartbeat.cpu, peak.cpu);
        peak.memory = Math.max(heartbeat.memory, peak.memory);
        peak.gc.incremental = Math.max(heartbeat.gc.incremental, peak.gc.incremental);
        peak.gc.full = Math.max(heartbeat.gc.full, peak.gc.full);
    }
    else if(currTPS < peak.tps * 0.9 //10% tps drop
        && heartbeat.cpu > peak.cpu
        && heartbeat.memory > peak.memory
        && heartbeat.gc.incremental > peak.gc.incremental
        && heartbeat.gc.full > peak.gc.full){
        
        return true;
    }

    return false;
};

var deathOfPrevious = null;

exports.deathQueue = function deathQueue(pid, emitter, success){

	assert.ok(pid);
	assert.ok(emitter);
	assert.ok(success);

	var tillDeath = when.defer(),
		afterDeath = null,
		die = function(){

			var successor = success();

			//when successor is in place, the old worker could be discontinued finally
			emitter.once(util.format('worker-%d-listening', successor.process.pid), function(){

				emitter.emit('disconnect', ['master', pid], pid);
                tillDeath.resolve(pid);

				if(deathOfPrevious === afterDeath){//last of dyingQueue resolved, clean up the dyingQueue
					deathOfPrevious = null;
				}
			});
		};

	if(!deathOfPrevious){//1st in the dying queue, 
		afterDeath = deathOfPrevious = timeout(tillDeath.promise, 60000);//1 min
		die();
	}
	else{
		afterDeath = deathOfPrevious = timeout(deathOfPrevious, 60000).ensure(die);
	}
};
