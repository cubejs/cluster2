/*
 * Copyright 2012 eBay Software Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var misc = require('./misc.js'),
    ecv = require('./ecv.js'),
    Monitor = require('./monitor.js'),
    _ = require('underscore'),
    assert = require('assert'),
    cluster = require('cluster'),
    EventEmitter = require('events').EventEmitter,
    os = require('os'),
    fs = require('fs'),
    Q = require('q'),
    util = require('util'),
    getrusage = require('getrusage'),
    memwatch = require('memwatch');

var debug = process.env['cluster2'];
function log() {
    if(debug) {
        console.log(JSON.stringify(arguments));
    }
}

// Master process
var Process = module.exports = function Process(options) {
    this.options = options || {};
    this.emitter = this.options.emitter || new EventEmitter();
    var self = this;

    // Stats
    this.stats = {
        workers: {},
        noWorkers: 0,
        workersKilled: 0
    };

    this._heartbeats = [];

    this.killall = function(signal) {
        log('killall called with signal ', signal);
        var that = this, fullname;
        fs.readdir(that.options.pids, function(err, paths) {
            var count = paths.length;
            if(count === 0) {
                return;
            }
            var mf = _.find(paths, function(path) {
                return /master\./.test(path);
            });
            paths.forEach(function(filename) {
                fullname = that.options.pids + '/' + filename;
                if(/worker\./.test(filename)) {
                    that.kill(fullname, signal, function() {
                        count = count - 1;
                        if(count === 1 && mf) {
                            log('Sending ', signal, ' to the master');
                            that.kill(that.options.pids + '/' + mf, signal);
                        }
                    });
                }
            });
        })
    };

    this.kill = function(fullname, signal, f) {
        log('sending ', signal, ' to ', fullname);
        fs.readFile(fullname, 'ascii', function(err, data) {
            var pid = parseInt(data);
            if(pid === process.pid) {
                log('Unlinking ', fullname);
                fs.unlinkSync(fullname);
                process.exit(0);
            }
            else {
                try {
                    process.kill(pid, signal);
                }
                catch(e) {
                    log(e.stack || e);
                }
            }
            fs.unlink(fullname, function(err) {
                log('Unlinking ', fullname);
                if(err) {
                    console.error('Unable to delete ' + fullname);
                }
                if(f) {
                    assert.ok('function' === typeof f);
                    f();
                }
            });
        });
    };

    this.emitter.on('SIGINT', function() {
        if(cluster.isMaster) {
            self.killall(('SIGINT'));
            clearInterval(self._heartbeatScheduler);
        }
    });
    this.emitter.on('SIGTERM', function() {
        if(cluster.isMaster) {
            self.killall('SIGTERM');
            clearInterval(self._heartbeatScheduler);
        }
    });
    this.emitter.on('SIGKILL', function() {
        if(cluster.isMaster) {
            self.killall('SIGKILL');
            clearInterval(self._heartbeatScheduler);
        }
    });

    this.createWorker = function () {
        var worker = cluster.fork().process;
        var self = this;
        self.lastTime = self.lastTime || Date.now();

        fs.writeFileSync(util.format('%s/worker.%d.pid', this.options.pids, worker.pid), worker.pid);

        self.emitter.emit('forked', worker.pid);

        // Collect counters from workers
        worker.on('message', function (message) {
            if(message.type === 'counter') {
                var name = message.name;
                if(!self.stats.workers[message.pid]) {
                    self.stats.workers[message.pid] = {};
                }
                var pidStats = self.stats.workers[message.pid];
                if(!pidStats[name]) {
                    pidStats[name] = 0
                }
                pidStats[name]++;
                self.emitter.emit("listening", message.pid);
            }
            if(message.type === "heartbeat"){

                if(message.pid != process.pid){
                    self._heartbeats.push(message);//must append to the tail
                }

                self._heartbeatScheduler = self._heartbeatScheduler || setInterval(function () {

                    var count = self._heartbeats.length,
                        threads = {},
                        aggr = {};

                    _.each(_.range(0, count), function(aggregated){
                        
                        var heartbeat = self._heartbeats.shift();

                        _.each(heartbeat, function(val, key){
                            aggr[key] = (aggr[key] || 0) + val;
                        });

                        threads[heartbeat.pid] = heartbeat.pid;
                    });

                    //emit the aggregated heartbeat message
                    self.emitter.emit('heartbeat', {
                        'pid': process.pid,
                        'usertime': aggr.usertime / count,//avg
                        'systime': aggr.systime / count,//avg
                        'uptime': aggr.uptime / count,//avg
                        'totalmem': aggr.totalmem / count,//avg
                        'freemem': aggr.freemem / count,//avg
                        'totalConnections': aggr.totalConnections,//total
                        'pendingConnections': aggr.pendingConnections,//total
                        'timedoutConnections': aggr.timedoutConnections,//total
                        'fullGCs': aggr.fullGCs,//total
                        'incrementalGCs': aggr.incrementalGCs,//total
                        'heapCompactions': aggr.heapCompactions,//total
                        'totalTransactions': aggr.totalTransactions,//total
                        'totalDuration': aggr.totalDuration,//total
                        'errors': aggr.errors,//total
                        'threads': _.keys(threads).length,
                        'interval': Date.now() - self.lastTime
                    });

                    self.lastTime = Date.now();
                    
                }, self.options.heartbeatInterval || 60000);
            }
            else if(message.type === "delegate"){//delegate is a proposed work pattern between master & workers, there're jobs workers would like to delegate to master
                //and master would use messaging to interact with the actual handler module, and send the result back to all workers; besides, such handler might notify
                //the master whenever there're some change of the results to publish to all workers in the future.
                var delegate = message.delegate,
                    expect = message.expect;

                if(expect){//there're jobs which expects immediate responses, in case of those, onExpect handler is created, timeout might be applied
                    var deferred = Q.defer(),
                    origin = message,
                    matches = message.matches,
                    targets = message.targets,
                    isExpected = function(origin, response){
                        return _.reduce(matches, function(memoize, match){
                            return memoize && _.isEqual(origin[match], response[match]);
                        },
                        true);
                    },
                    onExpect = function(message){
                        if(isExpected(origin, message)){
                            self.emitter.removeListener(expect, onExpect);
                            deferred.resolve(message);
                        }
                    },
                    send = function(message){
                        message.type = expect;
                        if(targets){
                            var workers = _.reduce(self.workers, function(memoize, worker){
                                memoize[worker.pid] = worker;
                                return memoize;
                            }, {});
                            _.each(_.compact(targets), function(target){
                                var targetWorker = self.workers[target];
                                if(targetWorker){
                                    targetWorker.send(message);
                                }
                            });
                        }
                        else{
                            self.notifyWorkers(message);
                        }
                    },
                    timeOut = setTimeout(function(){
                        log('[cluster] reject timeout:' + JSON.stringify(message));
                        deferred.reject(new Error("timeout"));
                    }, message.timeOut || 10000);

                    self.emitter.on(expect, onExpect);

                    deferred.promise
                        .then(function(message){
                            clearTimeout(timeOut);
                            send(message);
                        })
                        .fail(function(error){
                            log('[cluster] fail error:' + error);
                            message.error = error;
                            send(message);
                        })
                        .fin(function(){
                            if(message.notification){//this is for future update notifications, and registered afterwards.
                                if(!self._notifications){
                                    self._notifications = {};
                                }
                                if(!self._notifications[expect]){//make sure notifications won't be repeatedly registered.
                                    self._notifications[expect] = true;
                                    self.emitter.on(expect, function(message){
                                        send(message);
                                    });
                                }
                            }
                        })
                        .done();
                }

                self.emitter.emit(delegate, message);
            }
        });

        this.stats.noWorkers++;

        worker.on('message', function(message) {
            if(message && message.command) {
                self.notifyWorkers(message);
            }
        });

        return worker;
    }

    this.notifyWorkers = function(message) {
        _.each(self.workers, function(worker, pid) {
            try{
                worker.send(message);
            }
            catch(error){
                log('[cluster2] cannot send message to worker:' + pid);
            } 
        });
    }
}

Process.prototype.listen = function() {

    process.on('uncaughtException', function(err) {
        // handle the error safely
        log('[fatal] ' + err);
    });

    var exit = process.exit;
    process.exit = function(){
        log('[cluster2] exit unexpectedly' + new Error().stack);
        exit.apply(process, arguments);
    };

    var self = this, apps, monApp, cb;

    if(arguments.length === 3) {
        apps = arguments[0];
        monApp = arguments[1];
        cb = arguments[2];
    }
    else if (arguments.length === 2) {
        apps = arguments[0];
        cb = arguments[1];
    }
    if(cluster.isMaster) {
        
        this.stats.pid = process.pid;
        this.stats.start = new Date();
        this.stats.totalmem = os.totalmem();
        this.stats.freemem = os.freemem();
        this.stats.workers = this.workers = [];

        //before monitor app starts
        process.cluster = {
            clustered: true,
            emitter: self.emitter,
            workers: self.workers
        };
        //register the master worker itself
        var componentStatus = self.componentStatusResolved = require('./component-status.js').componentStatus;
        componentStatus.register('worker', function(){
            return 'm' + process.pid;
        }, 'array');

        self.emitter.emit('component-status-initialized', componentStatus);

        // Monitor to serve log files and other stats - typically on an internal port
        var monitor = new Monitor({
            monitor: monApp,
            stats: self.stats,
            host: self.options.monHost,
            port: self.options.monPort,
            path: self.options.monPath
        });

        monitor.once('listening', function() {
            misc.ensureDir(process.cwd() + '/pids', true); // Ensure pids dir
            misc.ensureDir(process.cwd() + '/logs'); // Ensure logs dir

            fs.writeFileSync(util.format('%s/master.%d.pdf', self.options.pids, self.stats.pid), self.stats.pid);
            log('Master ', process.pid, ' started');

            // Fork workers
            for(var i = 0; i < self.options.noWorkers; i++) {
                var worker = self.createWorker();
                self.workers[worker.pid + ''] = worker;
            }

            var deathWatcher = function (worker, code, signal) {
                worker = worker.process;
                log('[cluster2] death watch activated, worker:' + worker.pid + '\tcode:' + code + '\tsignal:' + signal + '\texit:' + worker.exitCode);
                if(code === 0) {
                    self.stats.noWorkers--;
                    return;
                }

                self.emitter.emit('died', worker.pid);
                self.stats.workersKilled++;
                self.stats.noWorkers--;
                //bugfix by huzhou@ebay.com, worker & replacement name collision
                var replacement = self.createWorker();
                self.workers[replacement.pid + ''] = replacement;
                delete self.workers[worker.pid + ''];
                delete self.stats.workers[worker.pid];

                log('[cluster2] updated worker list:' + _.keys(self.workers));
            };
            cluster.on('exit', deathWatcher);

            process.on('SIGINT', function() {
                cluster.removeListener('exit', deathWatcher);
                self.emitter.emit('SIGINT');
            });

            process.on('SIGTERM', function() {
                log(process.pid, ' got SIGTERM');
                self.emitter.emit('SIGTERM', {
                    pid: process.pid,
                    type: 'master'
                });
                var interval = setInterval(function() {
                    if(self.stats.noWorkers === 0) {
                        clearInterval(interval);
                        process.exit(0);
                    }
                }, 100);
            });

            _.each(apps, function(app){
                app.app.on('connection', function(conn) {
                    log('master conn listener');
                });
            });

            cb.call(null);
        });

        monitor.on('error', function (e) {
            if(e.code === 'EADDRINUSE') {
                console.error('Address in use ...');
                process.exit(-1);
            }
        });
        var monHost = this.options.monHost || '0.0.0.0';
        monitor.listen(this.options.monPort, monHost).once("listening", function(){
            //redundant for express2, absolutely needed for express3 and above
            monitor.emit("listening");
        });
    }
    else {
        
        var listening = false, conns = 0, totalConns = 0, timedoutConns = 0, noAppClosed = 0;
        process.on('SIGINT', function() {
            self.emitter.emit('SIGINT', {
                pid: process.pid,
                type: 'worker'
            });
            process.exit();
        });
        process.on('SIGTERM', function() {
            log(process.pid + ' got SIGTERM');

            // Don't accept connections
            _.each(apps, function(app){
                if(app.listening){
                    try {
                        app.app.close();
                    }
                    catch(e) {}
                }
            });
            self.emitter.emit('SIGTERM', {
                pid: process.pid,
                type: 'worker'
            });
            // Once all pending connections are closed, exit.
            var internal = setInterval(function() {
                if(conns === 0) {
                    clearInterval(internal);
                    process.exit(0);
                }
            }, 100);
        });

        // Set time out on idle sockets
        function setTimeout(conn) {
            conns++;
            totalConns++;
            conn.setTimeout(self.options.timeout,
                function () {
                    timedoutConns++;
                    self.emitter.emit('warning', {
                        message: 'Client socket timed out'
                    });
                    conn.destroy();
                }
            );
            conn.on('close', function() {
                conns--;
            })
        }

        _.each(apps, function(app){
            var notifyInitialized = _.once(function(){

                var componentStatus = self.componentStatusResolved = require('./component-status.js').componentStatus;
                componentStatus.register('worker', function(){
                    return process.pid;
                }, 'array');

                self.emitter.emit('component-status-initialized', componentStatus);
            });

            app.app.once('listening', function() {
                app.listening = true;
                process.send({
                    type:"counter",
                    name:process.pid,
                    pid:process.pid
                });

                notifyInitialized();
            });

            // Workers are net.Servers
            var ports = _.isArray(app.port) ? app.port : [app.port];
            var host = self.options.host ? self.options.host : '0.0.0.0';
            var servers = _.map(ports, function(port) {
                log('Worker ', process.pid, ' listening to ', port);
                return app.app.listen(port, host);
            });

            _.each(servers, function(server){
                server.once("listening", function() {
                    if(self.options.ecv) {
                        ecv.enable(apps, self.options, self.emitter, function(data) {
                            return true;
                        });
                    }
                    cb();
                    //redundant for express2, absolutely needed for express3 and above
                    app.app.emit('listening');    
                });
                server.on('connection', setTimeout);
            });
        });

        // Recycle self when no of connections connection threshold
        // we'd like to have the threshold randomized in between [1, 1.5) of the given threshold
        // to avoid all workers die around the same time. This is in particular important for boxes of small number of cpu cores
        var threshold = self.options.connThreshold;
        threshold = threshold + Math.floor((Math.random() * threshold) / 2);
        var recycle = setInterval(function() {
            if(totalConns > threshold) {
                log('[cluster2] exit because of connection threshold:' + threshold + ':' + totalConns);
                clearInterval(recycle);
                _.each(apps, function(app){
                    if(app.listening){
                        try {
                            app.app.close();
                        }
                        catch(e) {}
                    }
                });
                self.emitter.emit('SIGTERM', {
                    pid: process.pid,
                    type: 'worker'
                });
                // Once all pending connections are closed, exit.
                var internal = setInterval(function() {
                    if(conns === 0) {
                        clearInterval(internal);
                        process.exit(-1);
                    }
                }, 100);
            }
        },  100);

        var memStats = {
            'num_full_gc': 0,
            'num_inc_gc': 0,
            'heap_compactions': 0
        };
        memwatch.on('stats', function(stats){
            _.extend(memStats, stats || {});
        });

        var txStats = {
            'count': 0,
            'totalDuration': 0
        }

        self.emitter.on('rootTransaction', function(tx){
            txStats.count += 1;
            txStats.totalDuration += tx.duration;
        });

        var errors = 0;

        self.emitter.on('errorTransaction', function(){

            errors += 1;
        });

        // Heartbeat - make sure to clear this on 'close'
        var heartbeat = setInterval(function () {

            var memUsage = process.memoryUsage(),
                memTotal = Math.pow(2, 31) - 1,//should be 4g full space, but that exceeds MAX_INT, reduce it to MAX_INT
                heartbeat = {
                    'pid': process.pid,
                    'usertime': getrusage.getcputime(),
                    'systime': getrusage.getsystemtime(),
                    'uptime': Math.round(process.uptime()),
                    'totalmem': memTotal,
                    'freemem': memTotal - memUsage.heapTotal,
                    'totalConnections': totalConns,
                    'pendingConnections': conns,
                    'timedoutConnections': timedoutConns,
                    'fullGCs': memStats['num_full_gc'],
                    'incrementalGCs': memStats['num_inc_gc'],
                    'heapCompactions': memStats['heap_compactions'],
                    'totalTransactions': txStats.count,
                    'totalDuration': txStats.totalDuration,
                    'errors': errors
                };

            self.emitter.emit('heartbeat', heartbeat);
            var toMaster = {
                type:"heartbeat"
            };
            _.extend(toMaster, heartbeat);

            process.send(toMaster);

            memStats.num_full_gc = 0;
            memStats.num_inc_gc = 0;
            memStats.heap_compactions = 0;
            txStats.count = 0;
            txStats.totalDuration = 0;
            errors = 0;

        }, self.options.heartbeatInterval || 60000);

        _.each(apps, function(app){
            app.app.on('close', function() {
                noAppClosed++;
                if(noAppClosed >= noAppClosed.length){
                    clearInterval(heartbeat);
                    clearInterval(recycle);
                }
            })
        });
    }

    process.on('exit', function () {
        log(process.pid, ' is about to exit.');
    });
};

Process.prototype.stop = function() {
    this.emitter.emit('SIGKILL');
};

Process.prototype.shutdown = function() {
    log('Shutdown request received - emitting SIGTERM');
    this.emitter.emit('SIGTERM');
};

