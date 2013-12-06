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

'use strict';

var Process = require('./process.js'),
    ecv = require('./ecv.js'),
    _ = require('underscore'),
    assert = require('assert'),
    os = require('os'),
    when = require('when'),
    util = require('util'),
    net = require('net'),
    events = require('events');

// Trap all uncaught exception here.
process.on('uncaughtException', function (error) {
    // TODO: This has to the log file
    console.error(error.stack || error);
});

exports.version = require('../package.json').version;
exports.defaultOptions = {
    cluster: true,
    port: 3000,
    monPort: 3001,
    ecv: {
        path: '/ecv'
    },
    monPath: '/',
    noWorkers: os.cpus().length
};

var Cluster = module.exports = function Cluster(options) {
    // Extend from EventEmitter
    events.EventEmitter.call(this);

    this.options = {};
    _.extend(this.options, exports.defaultOptions);
    _.extend(this.options, options);

    assert.notEqual(this.options.port, this.options.monPort, "monitor port & application port cannot use the same!");
}

util.inherits(Cluster, events.EventEmitter);

/**
 * Start the cluster
 */
Cluster.prototype.listen = function(createApp, cb) {

    var self = this,
        options = self.options;
    
    assert.ok(_.isFunction(createApp), 'createApp must be a function');

    if(options.cluster) {
        var master = new Process({
            pids: process.cwd() + '/pids',
            logs: process.cwd() + '/logs',
            port: options.port,
            host: options.host || '0.0.0.0',
            monPort: options.monPort,
            monHost: options.monHost || '0.0.0.0',
            monPath: options.monPath,
            ecv: options.ecv,
            noWorkers: options.noWorkers,
            timeout: options.timeout || 30 * 1000, // idle socket timeout
            connThreshold: options.connThreshold || 10000, // recycle workers after this many connections
            uptimeThreshold: options.uptimeThreshold || 3600 * 24, // 24 hours (uptimeThreshold is in seconds)
            heartbeatInterval: options.heartbeatInterval,
            maxHeartbeatDelay: options.maxHeartbeatDelay,
            emitter: self
        });

        if(options.stop) {
            master.stop()
        }
        else if(options.shutdown) {
            master.shutdown();
        }
        else {
            initApp(function (app, monApp) {
                master.listen(app, monApp, function () {
                    if(options.ecv) {
                        ecv.enable(app, options, self, function (data) {
                            return true;
                        });
                    }
                    if(cb) {
                        cb(app, monApp);
                    }
                });
            });
        }
    }
    else { 
        // Temp Fix to unblock tech talk demo 
        var ports = _.isArray(options.port) ? options.port : [options.port]; 
        if (ports.length > 1) { 
            console.log('Provide a single port for non-cluster mode. Exiting.'); 
            process.exit(-1); 
        } 
        
        createApp.call(null, function (app, monApp) {
            //adding monApp to none-cluster mode
            var Monitor = require('./monitor.js'),
                monitor = new Monitor({
                    monitor: options.monitor || monApp,
                    stats: self.stats,
                    host: options.monHost,
                    port: options.monPort,
                    path: options.monPath
                });
            
            monitor.listen(options.monPort, options.host);
            
            app.listen(ports[0], options.host, function () { 
                if (options.ecv) { 
                    //bugfix by huzhou@ebay.com, in cluster=false mode, ecv failed because of wrong params, should use array of 'app':app object
                    ecv.enable([{'app':app}], options, self, function (data) { 
                        return true; 
                    }); 
                } 
                if (cb) { 
                    cb(app, monitor); 
                } 
            }); 

            //register the master worker itself, as it doesn't go through master process creation
            var componentStatus = self.componentStatusResolved = require('./component-status.js').componentStatus;
            componentStatus.register('worker', function(){
                return 'm' + process.pid;
            }, 'array');

            self.emit('component-status-initialized', componentStatus);
        }); 
    }

    function initApp(cb) {
        createApp.call(null, function (app, monApp) {
            // If the port is already occupied, this will exit to prevent node workers from multiple
            // masters hanging around together
            var ports = _.isArray(app) 
                ? _.reduce(app, 
                        function(ports, anApp){
                            return ports.concat(anApp.port && anApp.app 
                                    ? _.isArray(anApp.port) ? anApp.port : [anApp.port] 
                                    : []);
                        }, 
                        []) 
                : _.isArray(options.port) ? options.port : [options.port];

            exitIfBusyPort(options.host, ports, ports.length - 1, function(){
                cb(_.filter(_.isArray(app) ? app : [{app: app, port: options.port}],
                    function(app){
                        return app.app && app.port;
                    }), monApp);
            });
        });
    }

    function exitIfBusyPort(host, port, index, cb) {
        if(index < 0) {
            return cb();
        }
        var server = net.createServer();
        server.on('error', function (e) {
            if(e.code === 'EADDRINUSE') {
                console.error('Port is use ..' + port[index]);
                process.exit(-1);
            }
        });
        if (require('cluster').isMaster) {
            server.listen(port[index], host, function() { //'listening' listener
                exitIfBusyPort(host, port, index-1, function(){
                    server.close();
                    cb();
                })
            });
        }
        else {
            process.nextTick(cb);
        }
    }

    return self;
};

Cluster.prototype.componentStatus = function(){

    if(!this.componentStatusPromise){

        var componentStatusDeferred = when.defer();
        this.componentStatusPromise = componentStatusDeferred.promise;

        if(!this.componentStatusResolved){
            this.once('component-status-initialized', function(componentStatus){
                componentStatusDeferred.resolve(componentStatus);
            });
        }
        else{
            componentStatusDeferred.resolve(this.componentStatusResolved);
        }
    }

    return this.componentStatusPromise;
};

Cluster.prototype.stop = function () {
    var master = new Process({
        pids: process.cwd() + '/pids'
    });
    master.stop();
};

Cluster.prototype.shutdown = function () {
    var master = new Process({
        pids: process.cwd() + '/pids'
    });
    master.shutdown();
};
