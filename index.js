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

process.getLogger = process.getLogger || function defaultGetLogger(){

    return {

        'info': function(){
            console.log.apply(console, arguments);
        },
        
        'debug': function(){
            console.log.apply(console, arguments);
        }
    }
};

var cluster2 = process.cluster2 = process.cluster2 || {};

cluster2.main = cluster2.main || require('underscore').extend(require('./lib/main'), {

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
        
        return require('cluster-emitter');
    },
    
    /**
     * @return the cluster status submodule
     */
    get status(){
        
        return require('cluster-status');
    },
    
    /**
     * @return the cluster cache submodule
     */
    get cacheManager(){
        
        return require('cluster-cache');
    }
});

module.exports = cluster2.main;

