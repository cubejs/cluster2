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
	when = require('when'),
    assert = require('assert'),
    os = require('os'),
    _ = require('underscore');

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
module.exports = {

    'listen': function listen(options) {

        exports.getLogger = process.getLogger = options.getLogger || getLogger;
        assert.ok(process.getLogger);

        // Trap all uncaught exception here.
        process.on('uncaughtException', function (error) {

            process.getLogger(__filename).error(error.stack || error);
        });

        var emitter = require('./emitter'),
            actualOptions = {
                'emitter': emitter,
                'noWorkers': os.cpus().length,
                'monCreateServer': require('./monitor').monCreateServer,
                'monApp': require('./monitor').monApp,
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
                },
                'cache': {
                    'enable': true,
                    'mode': 'standalone' //a process will be allocated dedicated to it, otherwise crush that into master
                }
            };

        _.extend(actualOptions.ecv, options.ecv || {});
        _.extend(actualOptions.debug, options.debug || {});
        _.extend(actualOptions.cache, options.cache || {});
        _.extend(actualOptions, _.omit(options, 'ecv', 'debug', 'cache'));

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
                'emitter': emitter,
                'noWorkers': os.cpus().length,
                'monCreateServer': require('./monitor').monCreateServer,
                'monApp': require('./monitor').monApp,
                'monPort': 8081,
                'runnable': options.runnable,
                'markOld': null, //should be a function determine if worker is old or not
                'stopTimeout': 60000,//1 min
                'debug': {
                    'webPort': 8082,
                    'debugPort': 5858,
                    'saveLiveEdit': false,
                    'hidden':[]
                },
                'cache': {
                    'enable': true,
                    'mode': 'standalone' //a process will be allocated dedicated to it, otherwise crush that into master
                }
            };

        _.extend(actualOptions.debug, options.debug || {});
        _.extend(actualOptions.cache, options.cache || {});
        _.extend(actualOptions, _.omit(options, 'debug', 'cache'));

        assert.ok(actualOptions.monCreateServer);
        assert.ok(actualOptions.monApp);
        assert.ok(actualOptions.monPort);
        assert.ok(actualOptions.runnable);
        assert.notEqual(actualOptions.monPort, actualOptions.debug.debugPort, "monitor port & debug port cannot use the same!");   

        var Master = require('./master').Master;

        return new Master(process, actualOptions).run();
    },

    get isMaster(){

        return require('cluster').isMaster;
    },

    get isWorker(){

        return require('cluster').isWorker;
    }

};
