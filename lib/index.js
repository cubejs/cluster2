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

var readMasterPid = require('./utils').readMasterPid,
    getLogger = require('./utils').getLogger,
    argv = require('optimist').argv,
	when = require('when'),
    path = require('path'),
    os = require('os'),
    _ = require('underscore'),
    assert = require('assert');

process.getLogger = function defaultGetLogger(){

    return {

        'info': function(){
            console.log.apply(console, arguments);
        },
        
        'debug': function(){
            console.log.apply(console, arguments);
        }
    }
};

process.cluster2 = {

};

/**
 * @return promise of Server starts
 * 
 * listen will create the Master process, and delegate to its#listen
 * it gives back a promise for the master's server to be started (monitoring application)
 * 
 * the resolved promise will always give:
 * {
 *  'server': server,
 *  'app': app,
 *  'port': port,
 *  'master': master,
 *  'worker': worker  
 * }
 *
 * if cluster.isMaster === true, the promise will be resolved as monCreateServer, monApp, monPort, master, null
 * otherwise, the promise instead will be resolved as createServer, app, port, null, worker
 */
module.exports = {

    /**
     *
     * @param options
     * @return promise
     *
     * options is a map contains almost every configurable aspect of cluster.
     * <ul>
     *  <li>emitter: the event driver of the entire cluster, usually being ./emitter, could be overwritten for test or other purposes</li>
     *  <li>noWorkers: the number of workers the cluster will spawn, default being from the value of '--noWorkers' in argv, otherwise the number of cpu cores on the machine</li>
     *  <li>monCreateServer: a function which creates the server for monitor application, default being http#createServer</li>
     *  <li>monApp: an express application to allow monitoring purpose of the entire cluster, default being ./monitor, which supports 'debug', 'ecv' features etc.</li>
     *  <li>monPort: the port to run the monitor application on, default being from the value of '--monPort' in argv, otherwise 8081</li>
     *  <li>monConfigureApp: a function to adapt the monitor application before monitor application starts, default doing nothing</li>
     *  <li>createServer: a function which creates the server for user application (running in workers), default beging http#createServer</li>
     *  <li>app: the user application to run across all workers, must be provided</li>
     *  <li>port: the port to run the user application on, default being from the value of '--port' in argv, otherwise 8080</li>
     *  <li>configureApp: a function to adapt the user application, usually to register all routes, middlewares, default doing nothing</li>
     *  <li>warmUp: a function to run after the user application started listening, usually to hit some routes to load caches, templates, resources for performance sake.</li>
     *  <li>shouldKill: a function to determine if a worker is going wild, and must be terminated (then replaced) based on collected heartbeat stats, default being a combination of ./utils#assertOld & ./utils#assertBadGC</li>
     *  <li>stopTimeout: an integer of MS to wait before further action upon a worker to be disconnected, default being from the value of '--stop-timeout' in argv, otherwise 1 minute</li>
     *  <li>ecv.root: a string for the url route ecv will be using in monitor application, default being from the value of '--ecv.root' in argv, otherwise '/ecv'</li>
     *  <li>ecv.mode: one of ['control', 'monitor'] options, default being from the value of '--ecv.mode' in argv, otherwise 'control'</li>
     *  <li>ecv.disable: a boolean value used in 'control' mode, telling whether ecv should start as 'disabled' or 'enabled', default being from the value of '--ecv.disable' in argv, otherwise true</li>
     *  <li>ecv.markUp: a string for the url route ecv will accept to 'enable' the traffic in 'control' mode, default beging from the value of '--ecv.mark-up' in argv, otherwise '/ecv/enable'</li>
     *  <li>ecv.markDown: a string for the url route ecv will accept to 'disable' the traffic in 'control' mode, default being from the value of '--ecv.mark-down' in argv, otherwise '/ecv/disable'</li>
     *  <li>ecv.monitor: a string for the url to be tested in 'monitor' mode, default being the value of '--ecv.monitor' in argv, otherwise '/'</li>
     *  <li>ecv.validator: a function to validate the http response from hitting the monitor url given, default being checking status code equal 200</li>
     *  <li>debug.debugPort: an integer of the port for node-inspector to connect to the user application process, default being from the value of '--debug.debug-port' in argv, otherwise 5858</li>
     *  <li>debug.webPort: an integer of port to run the node-inspector server, default being from the value of '--debug.web-port' in argv, otherwise 8082</li>
     *  <li>debug.saveLiveEdit: a boolean value whether or not allowing node-inspector's change should be saved to the file, default being from the value of '--debug.save-live-edit' in argv, otherwise false</li>
     *  <li>cache.enable: a boolean value whether or not caching service should be started for the cluster, default being from the value of '--cache.enable', otherwise true</li>
     *  <li>cache.mode: one of ['standalone', 'master'] options, which tells the caching service to be run as a process or within master, default being from the value of '--cache.mode' in argv, otherwise 'standalone'</li>
     *  <li>gc.monitor: a boolean value whether or not to monitor the GC stats of each worker, default being the value of '--trace-gc' in argv, otherwise true</li>
     *  <li>gc.idleNotification: a boolean value whether or not node should send 'idle' notification to v8, default being the opposite to the value of '--nouse-idle-notification', otherwise false</li>
     *  <li>nanny.enable: a boolean value whether or not nanny monitoring is needed, default being the value of '--nanny.enable' in argv, otherwise true</li>
     *  <li>nanny.tolerance: an integer of MS to wait from action upon suspicious run away workers, default being the value of '--nanny.tolerance' in argv, otherwise 3 mins</li>
     *  <li>maxAge: an integer of seconds to determine that a worker is to be terminated, used by ./utils#assertOld, default being the value of '--max-age' in argv, otherwise 3 days</li>
     *  <li>heartbeatInterval: an integer of MS for each worker to report its health, default being the value of '--heartbeat-interval' in argv, otherwise 1 min</li>
     * </ul> 
     */
    'listen': function listen(options) {

        exports.getLogger = process.getLogger = options.getLogger || getLogger;

        assert.ok(process.getLogger);

        // Trap all uncaught exception here.
        process.on('uncaughtException', function (error) {

            process.getLogger(__filename).info(error.stack || error);
        });

        var emitter = require('./emitter'),
            actualOptions = {
                'pids': argv.pids || path.join(process.cwd(), '/pids'),
                'emitter': emitter,
                'noWorkers': argv.noWorkers || os.cpus().length,
                'monCreateServer': require('./monitor').monCreateServer,
                'monApp': require('./monitor').monApp,
                'monPort': argv.monPort || 8081,
                'warmUpPort': argv.warmUpPort || 8083,
                'monConfigureApp': function(monApp){

                    return monApp;
                },
                'createServer': require('http').createServer,
                'configureApp': function(app){ //happens before server listen

                    return app;
                },
                'app': null,//must be provided by the options
                'port': argv.port || 8080,
                'warmUp': function(app, address){ //happens after server listen

                    return app;
                },
                'shouldKill': null, //should be a function determine if worker is old or not
                'stopTimeout': argv['stop-timeout'] || 60000,//1 min
                'debug': {
                    'webPort': argv['debug.web-port'] || 8082,
                    'debugPort': argv['debug.debug-port'] || 5858,
                    'saveLiveEdit': argv['debug.save-live-edit'] || false,
                    'hidden':[]
                },
                'ecv': {
                    'root': argv['ecv.root'] || '/ecv',
                    'mode': argv['ecv.mode'] || 'control',
                    'disable': argv['ecv.disable'] || true,
                    'markUp': argv['ecv.mark-up'] || '/ecv/enable',
                    'markDown': argv['ecv.mark-down'] || '/ecv/disable',
                    'monitor': argv['ecv.monitor'] || '/',
                    'validator': function(err, response, body){
                        return !err && response && response.statusCode === 200;
                    },
                    'emitter': emitter
                },
                'cache': {
                    'enable': argv['cache.enable'] || true,
                    'mode': argv['cache.mode'] || 'standalone', //a process will be allocated dedicated to it, otherwise crush that into master
                    'domainPath': argv['cache.domain-path'] || './cluster-cache-domain',
                    'persistPath': argv['cache.persist-path'] || './cluster-cache-persist'
                },
                'gc': {
                    'monitor': argv['trace-gc'] || true,
                    'idleNotification': !argv['nouse-idle-notification'] //idle notification by default, unless explicitly set in the argv
                },
                'nanny': {
                    'enable': argv['nanny.enable'] || true,
                    'tolerance': argv['nanny.tolerance'] || 60000 * 3
                },
                'maxAge': argv['max-age'] || 60 * 60 * 24 * 3, //how long could a worker keep running, default will be 3 days
                'heartbeatInterval': argv['heartbeat-interval'] || 5000
            };
        
        //apply highest precendence of configurations from @param options
        _.extend(actualOptions.ecv, options.ecv || {});
        _.extend(actualOptions.debug, options.debug || {});
        _.extend(actualOptions.cache, options.cache || {});
        _.extend(actualOptions.gc, options.gc || {});
        _.extend(actualOptions, _.omit(options, 'ecv', 'debug', 'cache', 'gc'));

        //validate all required parameters were given
        assert.ok(actualOptions.monCreateServer);
        assert.ok(actualOptions.monApp);
        assert.ok(actualOptions.monPort);
        assert.ok(actualOptions.createServer);
        assert.ok(actualOptions.app);
        assert.ok(actualOptions.port);
        assert.notEqual(actualOptions.port, actualOptions.monPort, "monitor port & application port cannot use the same!");
        assert.notEqual(actualOptions.port, actualOptions.debug.debugPort, "debug port & application port cannot use the same!");
        assert.notEqual(actualOptions.monPort, actualOptions.debug.debugPort, "monitor port & debug port cannot use the same!");   

        var Master = require('./master').Master;

        return new Master(process, actualOptions).listen();
    },

    /**
     * experimental support to run anything, no need to be a server
     */
    'run': function run(options){

        exports.getLogger = process.getLogger = options.getLogger || getLogger;

        assert.ok(process.getLogger);

        // Trap all uncaught exception here.
        process.on('uncaughtException', function (error) {

            process.getLogger(__filename).error(error.stack || error);
        });

        var emitter = require('./emitter'),
            actualOptions = {
                'pids': argv.pids || path.join(process.cwd(), '/pids'),
                'emitter': emitter,
                'noWorkers': argv.noWorkers || os.cpus().length,
                'monCreateServer': require('./monitor').monCreateServer,
                'monConfigureApp': function(monApp){

                    return monApp;
                },
                'monApp': require('./monitor').monApp,
                'monPort': argv.monPort || 8081,
                'runnable': options.runnable, //runnable is a function to be called without scope (closure)
                'warmUp': function(runnable){
                    return runnable;
                },
                'shouldKill': null, //should be a function determine if worker is old or not
                'stopTimeout': 60000,//1 min
                'debug': {
                    'webPort': argv['debug.webPort'] || 8082,
                    'debugPort': argv['debug.debugPort'] || 5858,
                    'saveLiveEdit': argv.saveLiveEdit || false,
                    'hidden':[]
                },
                'cache': {
                    'enable': argv['cache.enable'] || true,
                    'mode': argv['cache.mode'] || 'standalone' //a process will be allocated dedicated to it, otherwise crush that into master
                },
                'gc': {
                    'monitor': argv['trace-gc'] || true,
                    'idle-notification': !argv['nouse-idle-notification'] || false
                },
                'nanny': {
                    'enable': argv['nanny.enable'] || true,
                    'tolerance': argv['nanny.tolerance'] || 60000 * 3
                },
                'maxAge': argv['max-age'] || 0,//how long could a worker keep running, default will be 3 days
                'heartbeatInterval': argv['heartbeat.interval'] || 5000
            };

        _.extend(actualOptions.debug, options.debug || {});
        _.extend(actualOptions.cache, options.cache || {});
        _.extend(actualOptions.gc, options.gc || {});
        _.extend(actualOptions, _.omit(options, 'debug', 'cache', 'gc'));

        assert.ok(actualOptions.monCreateServer);
        assert.ok(actualOptions.monApp);
        assert.ok(actualOptions.monPort);
        assert.ok(actualOptions.runnable);
        assert.notEqual(actualOptions.monPort, actualOptions.debug.debugPort, "monitor port & debug port cannot use the same!");   

        var Master = require('./master').Master;

        return new Master(process, actualOptions).run();
    },

    /**
     * @return boolean whether the active process is master or not
     */
    get isMaster(){

        return require('cluster').isMaster;
    },

    /**
     * @return boolean whether the active process is worker or not
     */
    get isWorker(){

        return require('cluster').isWorker;
    },
    
    /**
     * @return the cluster emitter submodule
     */
    get emitter(){
        
        return require('./emitter');
    },
    
    /**
     * @return the cluster status submodule
     */
    get status(){
        
        return require('./status');
    },
    
    /**
     * @return the cluster cache submodule
     */
    get cacheManager(){
        
        return require('./cache');
    },
    
    get monitor(){
        
        return require('./monitor');
    },
    
    get ecv(){
        
        return require('./ecv');
    }
};
