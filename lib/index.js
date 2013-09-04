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

var Master = require('./master.js').Master,
    readMasterPid = require('./utils.js').readMasterPid,
	when = require('when'),
    assert = require('assert'),
    os = require('os'),
    _ = require('underscore');

// Trap all uncaught exception here.
process.on('uncaughtException', function (error) {
    // TODO: This has to the log file
    console.error(error.stack || error);
});

var Cluster = module.exports = function Cluster(options) {
    
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
        'debugPort': 8082,
        'ecv': {
            'root': '/ecv',
            'mode': 'control',
            'disable': true,
            'markUp': '/ecv/enable',
            'markDown': '/ecv/disable',
            'emitter': emitter
        }
    };

    _.extend(this.options, options);

    assert.ok(this.options.monCreateServer);
    assert.ok(this.options.monApp);
    assert.ok(this.options.monPort);
    assert.ok(this.options.createServer);
    assert.ok(this.options.app);
    assert.ok(this.options.port);
    assert.notEqual(this.options.port, this.options.monPort, "monitor port & application port cannot use the same!");

    _.extend(this, {
        'on': _.bind(emitter.on, emitter),
        'once': _.bind(emitter.once, emitter),
        'removeListener': _.bind(emitter.removeListener, emitter),
        'emit': _.bind(emitter.emit, emitter)
    });
};

/**
 * @return promise of Master Server starts
 * 
 * listen will create the Master process, and delegate to its#listen
 * it gives back a promise for the master's server to be started (monitoring application)
 */
Cluster.prototype.listen = function() {

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
