/*
 * Copyright 2012 eBay Software Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
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
    when = require('when'),
    timeout = require('when/timeout'),
    util = require('util'),
    BigNumber = require('bignumber.js'),
    usage = require('usage');
    // uvmon = require('nodefly-uvmon');

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

    this.options.maxHeartbeatDelay = options.maxHeartbeatDelay || 3*60000; //default 3 mins

    this._heartbeats = [];

    this.killall = function(signal) {
        log('killall called with signal ', signal);
        // uvmon.stop();
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
                self.emitter.emit('listening', message.pid);
            }
            if(message.type === 'heartbeat'){
                if(message.pid != process.pid){
                    self._heartbeats.push({
                        'pid': message.pid,
                        'usertime': message.cpu/self.options.noWorkers,
                        'systime': message.cpu/self.options.noWorkers,
                        'uptime': message.uptime,
                        'totalmem': Math.pow(2, 31) - 1,
                        'freemem': Math.pow(2, 31) - 1 - message.memory,
                        'totalConnections': message.totalConnections,
                        'pendingConnections': message.aliveConnections,
                        'timedoutConnections': 0,
                        'fullGCs': message.gc.full,
                        'incrementalGCs': message.gc.incremental,
                        'pauseMS': message.gc.pauseMS,
                        'totalTransactions': message.transactions,
                        'totalDurations': message.durations,
                        'errors': message.error.count,
                        'interval': message.cycle
                    });//must append to the tail
                    // update the last heartbeat time for the worker
                    var workerStats = self.stats.workers[message.pid];
                    //console.log('heartbeat ' + process.pid);
                    workerStats.lastHeartbeatAt= Date.now();
                }

                self._heartbeatScheduler = self._heartbeatScheduler || setInterval(function () {

                    var heartbeatsOfThisCycle = _.clone(self._heartbeats);
                    //clean up immediately
                    self._heartbeats = [];

                    var groupedByWorkers = _.reduce(heartbeatsOfThisCycle, function(memoize, aHeartbeat){

                            memoize[aHeartbeat.pid] = (memoize[aHeartbeat.pid] || []).concat(aHeartbeat);
                            return memoize;
                        }, {}),

                        avgOfWorkers = _.map(groupedByWorkers, function(heartbeatsOfThisWorker, pid){

                            var aggrOfThisWorker = {}, 
                                numOfHeartbeats = heartbeatsOfThisWorker.length;

                            _.each(heartbeatsOfThisWorker, function(aHeartbeatOfThisWorker){
                            _.each(aHeartbeatOfThisWorker, function(val, key){
                            aggrOfThisWorker[key] = (aggrOfThisWorker[key] || 0) + val;
                            });
                            });

                            return {
                                'pid': process.pid,
                                'usertime': aggrOfThisWorker.usertime / numOfHeartbeats,//avg
                                'systime': aggrOfThisWorker.systime / numOfHeartbeats,//avg
                                'uptime': aggrOfThisWorker.uptime / numOfHeartbeats,//avg
                                'totalmem': aggrOfThisWorker.totalmem / numOfHeartbeats,//avg
                                'freemem': aggrOfThisWorker.freemem / numOfHeartbeats,//avg
                                'totalConnections': aggrOfThisWorker.totalConnections / numOfHeartbeats,//avg
                                'pendingConnections': aggrOfThisWorker.pendingConnections / numOfHeartbeats,//avg
                                'timedoutConnections': aggrOfThisWorker.timedoutConnections / numOfHeartbeats,//avg
                                'fullGCs': aggrOfThisWorker.fullGCs / numOfHeartbeats,//avg
                                'incrementalGCs': aggrOfThisWorker.incrementalGCs / numOfHeartbeats,//avg
                                'pauseMS': aggrOfThisWorker.pauseMS / numOfHeartbeats,//avg
                                'totalTransactions': aggrOfThisWorker.totalTransactions / numOfHeartbeats,//avg
                                'totalDuration': aggrOfThisWorker.totalDurations / numOfHeartbeats,//avg
                                'errors': aggrOfThisWorker.errors / numOfHeartbeats,//avg
                                'interval': aggrOfThisWorker.interval / numOfHeartbeats//avg
                            };
                        }),

                        aggrOfWorkers = _.reduce(avgOfWorkers, function(memoize, avgOfWorker){
                            _.each(avgOfWorker, function(val, key){
                                memoize[key] = (memoize[key] || 0) + val;
                            });

                            return memoize;
                        }, {});

                    _.extend(aggrOfWorkers, {
                        'pid': process.pid,
                        'threads': avgOfWorkers.length,
                        'uptime': aggrOfWorkers.uptime / avgOfWorkers.length, //uptime is the only value we don't want total..
                        'interval': aggrOfWorkers.interval / avgOfWorkers.length
                    });


                    //emit the aggregated heartbeat message
                    self.emitter.emit('heartbeat', aggrOfWorkers);

                    self.lastTime = Date.now();

                    // Check the last heartbeat time of all the workers
                    _.each(self.stats.workers, function (workerStats, pid) {
                        var now = Date.now();
                        if (now - workerStats.lastHeartbeatAt> self.options.maxHeartbeatDelay) {
                            // this worker hasn't been sending heartbeat for maxHeartbeatDelay 
                            log(util.format('[Cluster2] Detected worker%d is not responsive for %d', pid, now - workerStats.lastHeartbeatAt));
                            var deathQueue = require('./misc').deathQueue;
                            deathQueue(self.workers[pid], self.emitter, function () {
                                // create a successor
                                var successor = self.createWorker();
                                self.workers[successor.pid] = successor;
                                log(util.format('[Cluster2] Created a new worker with pid %d', successor.pid));
                                return successor;
                            });
                        }
                    });
                    
                }, self.options.heartbeatInterval || 60000);
            }
            else if(message.type === 'suicide'){ //TODO, deathQueue

                var deathQueue = require('./misc').deathQueue;

                deathQueue(worker, self.emitter, function(){

                    var successor = self.createWorker();
                    self.workers[successor.pid + ''] = successor;
                    return successor;
                });
            }
            else if(message.type === 'delegate'){//delegate is a proposed work pattern between master & workers, there're jobs workers would like to delegate to master
                //and master would use messaging to interact with the actual handler module, and send the result back to all workers; besides, such handler might notify
                //the master whenever there're some change of the results to publish to all workers in the future.
                var delegate = message.delegate,
                    expect = message.expect;

                if(expect){//there're jobs which expects immediate responses, in case of those, onExpect handler is created, timeout might be applied
                    var deferred = when.defer(),
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
                        deferred.reject(new Error('timeout'));
                    }, message.timeOut || 10000);

                    self.emitter.on(expect, onExpect);

                    deferred.promise
                        .then(function(message){
                            clearTimeout(timeOut);
                            send(message);
                        })
                        .otherwise(function(error){
                            log('[cluster] fail error:' + error);
                            message.error = error;
                            send(message);
                        })
                        .ensure(function(){
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
                        });
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
        if(!_.contains(process.argv, '--nouse-idle-notification')){
            //the ugly way to force --nouse-idle-notification is actually to modify process.argv directly in master
            var argv = _.toArray(process.argv),
                node = argv.shift();
            argv.unshift('--nouse-idle-notification');
            argv.unshift(node);
            process.argv = argv;
        }
        
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
                    self.emitter.emit('died', worker.pid);
                    self.stats.workersKilled++;
                    self.stats.noWorkers--;
                    delete self.workers[worker.pid + ''];
                    delete self.stats.workers[worker.pid];
                    return;
                }

                self.emitter.emit('died', worker.pid);
                self.stats.workersKilled++;
                self.stats.noWorkers--;
                delete self.workers[worker.pid + ''];
                delete self.stats.workers[worker.pid];
                //bugfix by huzhou@ebay.com, worker & replacement name collision
                var replacement = self.createWorker();
                self.workers[replacement.pid + ''] = replacement;

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
        monitor.listen(this.options.monPort, monHost).once('listening', function(){
            //redundant for express2, absolutely needed for express3 and above
            monitor.emit('listening');
        });
    }
    else {
        var totalTransactions = new BigNumber(0);
        var totalDurations = new BigNumber(0);
        
        var listening = false, conns = 0, totalConns = 0, timedoutConns = 0, noAppClosed = 0, graceful = _.once(function graceful(signal, code){

            _.each(apps, function(app){
                log('[graceful] app status:%s', app.listening);
                if(app.listening){
                    try {
                        if(app.server && app.server._handle){
                            log('[graceful] app server shutdown');
                            app.server.close();
                        }
                        else{
                            log('[graceful] app app shutdown');
                            app._router = null;
                        }
                    }
                    catch(e) {
                        log('worker shutdown error:', e);
                    }
                }
            });

            // put the emitter in the process
            process.emitter = self.emitter;
            self.emitter.emit(signal, {
                pid: process.pid,
                type: 'worker'
            });

            // Once all pending connections are closed, exit.
            var internal = setInterval(function() {
                if(conns === 0) {
                    clearInterval(internal);
                    process.exit(code);
                }
            }, 100);
        });

        process.on('SIGINT', function() {
            
            graceful('SIGINT', 0);
        });
        
        process.on('SIGTERM', function() {

            log(process.pid, 'got SIGTERM');

            process.exit(0);
        });

        // Set time out on idle sockets
        function monitorConnection(conn) {
            //increase connections
            conns++;
            totalConns++;
            //idle timeout
            conn.setTimeout(self.options.timeout, function () {
                    
                    timedoutConns++;
                    self.emitter.emit('warning', {
                        message: 'Client socket timed out'
                    });
                    conn.destroy();
                });
            //decrease connection
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
                    type:'counter',
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
                server.once('listening', function() {
                    if(self.options.ecv) {
                        ecv.enable(apps, self.options, self.emitter, function(data) {
                            return true;
                        });
                    }
                    cb();
                    //redundant for express2, absolutely needed for express3 and above
                    app.app.emit('listening');    
                });
                server.on('connection', monitorConnection);
                app.server = server;
            });
        });

        // Recycle self when no of connections connection threshold
        // we'd like to have the threshold randomized in between [1, 1.5) of the given threshold
        // to avoid all workers die around the same time. This is in particular important for boxes of small number of cpu cores
        var connThreshold = self.options.connThreshold,
            uptimeThreshold = self.options.uptimeThreshold;

        var recycle = setInterval(function() {

                var uptime = process.uptime();
                if(totalConns > connThreshold || uptime >= uptimeThreshold) {
                    
                    log('[cluster2] exit because of connThreshold:' + connThreshold + ':' + totalConns + '; or uptime:' + uptime + ' has exceeded:' + uptimeThreshold);
                    clearInterval(recycle);

                    //wait for master's order
                    process.send({
                        'type': 'suicide'
                    });
                }
            },  
            1000);

        var memStats = {
            gc: {
                'incremental': 0,
                'full': 0,
                'pauseMS': 0
            }
        };

        var bin = require('gc-stats/build/Release/gcstats');
        bin.afterGC(function(stats) {
            //cannot tell if it's incremental or full, just to check if pauseMS is too long
            //logger.debug('[worker] gc usage:%d, type:%s', usage, type);

            memStats.gc[stats.pauseMS < 500 ? 'incremental' : 'full'] += 1;
            memStats.gc.pauseMS += stats.pauseMS;
        });

        var txStats = {
            'count': 0,
            'totalDuration': 0,
            'start': Date.now()
        }
        self.emitter.on('rootTransaction', function(tx){
            txStats.count += 1;            
            txStats.totalDuration += tx.duration;
        });

        var errors = 0;
        self.emitter.on('errorTransaction', function(){

            errors += 1;
        });

        var heartbeatInterval = self.options.heartbeatInterval || 60000;
        // Heartbeat - make sure to clear this on 'close'
        var heartbeat = setInterval(function () {
            
            totalTransactions = totalTransactions.plus(txStats.count);
            totalDurations = totalDurations.plus(txStats.totalDuration);

            usage.lookup(process.pid, function(err, result) {
                if(!err){

                    var heartbeat = {
                            'pid': process.pid,
                            'uptime': process.uptime(),
                            'cpu': result.cpu,
                            'memory': result.memory,
                            'aliveConnections': conns,
                            'totalConnections': totalConns,
                            'timedoutConnections': timedoutConns,
                            'transactions': txStats.count,
                            'durations': txStats.totalDuration,
                            'totalTransactions': totalTransactions,
                            'totalDurations': totalDurations,
                            'gc': memStats.gc,
                            // 'uv': uvmon.getData(), //added uv monitor data for heartbeat
                            'error': {
                                count: errors
                            },
                            'cycle': (Date.now() - txStats.start)
                        };


                    self.emitter.emit('heartbeat', heartbeat);
                    var toMaster = {
                        'type': 'heartbeat'
                    };
                    _.extend(toMaster, heartbeat);

                    process.send(toMaster);
                    //reset
                    memStats = {
                        gc: {
                            'incremental': 0,
                            'full': 0,
                            'pauseMS': 0
                        }
                    };
                    txStats.count = 0;
                    txStats.totalDuration = 0;
                    txStats.start = Date.now();
                    errors = 0;
                }
            });

        }, heartbeatInterval);
        // put the heartbeat interval id in the process context 
        process.heartbeat = heartbeat;

        _.each(apps, function(app){

            app.app.once('close', function() {
                
                noAppClosed++;
                
                if(noAppClosed >= noAppClosed.length){
                    clearInterval(heartbeat);
                    clearInterval(recycle);
                }
            });
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

