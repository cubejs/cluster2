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

var readMasterPid = require('./utils.js').readMasterPid,
    getLogger = require('./utils.js').getLogger,
	when = require('when'),
    assert = require('assert'),
    os = require('os'),
    _ = require('underscore');

var Cluster = exports.Cluster = function Cluster(options) {
    
    exports.getLogger = process.getLogger = options.getLogger || getLogger;
    assert.ok(process.getLogger);

    // Trap all uncaught exception here.
    process.on('uncaughtException', function (error) {

        process.getLogger(__filename).error(error.stack || error);
    });

    var emitter = require('./cluster-emitter.js').emitter;
    this.options = {
        'emitter': emitter,
        'noWorkers': os.cpus().length,
        'monCreateServer': require('./monitor-app.js').monCreateServer,
        'monApp': require('./monitor-app.js').monApp,
        'monPort': 8081,
        'createServer': require('http').createServer,
        'app': null,//must be provided by the options
        'port': 8080,
        'warmUp': function(){

        },
        'markOld': null, //should be a function determine if worker is old or not
        'stopTimeout': 60000,//1 min
        'debug': {
            'webPort': 8082,
            'debugPort': 5858,
            'saveLiveEdit': false,
            'hidden':[]
        },
        'ecv': {
            'root': '/ecv',
            'mode': 'control',
            'disable': true,
            'markUp': '/ecv/enable',
            'markDown': '/ecv/disable',
            'emitter': emitter
        }
    };

    _.extend(this.options.ecv, options.ecv || {});
    _.extend(this.options.debug, options.debug || {});
    _.extend(this.options, _.omit(options, 'ecv', 'debug'));

    assert.ok(this.options.monCreateServer);
    assert.ok(this.options.monApp);
    assert.ok(this.options.monPort);
    assert.ok(this.options.createServer);
    assert.ok(this.options.app);
    assert.ok(this.options.port);
    assert.notEqual(this.options.port, this.options.monPort, "monitor port & application port cannot use the same!");
    assert.notEqual(this.options.port, this.options.debugPort, "debug port & application port cannot use the same!");
    assert.notEqual(this.options.monPort, this.options.debugPort, "monitor port & debug port cannot use the same!");   

    _.extend(this, {
        'on': _.bind(emitter.on, emitter),
        'once': _.bind(emitter.once, emitter),
        'removeListener': _.bind(emitter.removeListener, emitter),
        'emit': _.bind(emitter.emit, emitter)
    });
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
 * 
 * Given the master/worker instance user could get hands on a few more functionalities
 * assuming the following:
 * var masterOrWorker = resolve.master || resolve.worker;
 * masterOrWorker.status;//gives the status registry
 * masterOrWorker.emitter;//gives the event emitter in use of the cluster
 * masterOrWorker.useCache();//gives the cache user promise, which after resolved would allow users to access cluster caching
 */
Cluster.prototype.listen = function() {

    var Master = require('./master.js').Master;

    return new Master(process, this.options).listen();
};

/**
 * asynchronously shutdown the master process and let Master finishes its workers on behalf of the cluster
 * the master's pid is persisted under ./pids with the pattern of 'master.pid'
 */
Cluster.prototype.shutdown = function () {

    var masterPid = readMasterPid();
    
    process.kill(masterPid, 'SIGINT');

    //in case the graceful shutdown doesn't complete, send the TERM signal instead.
    setTimeout(function(){
            process.kill(masterPid, 'SIGTERM');
        }, 
        this.stopTimeout);
};

