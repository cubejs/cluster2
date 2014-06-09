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

var _ = require('underscore'),
    fs = require('fs'),
    util = require('util'),
    when = require('when'),
    timeout = require('when/timeout'),
    assert = require('assert');

// Utility to ensure that certain directories exist
exports.ensureDir = function(dir, clean) {
    try {
        fs.readdirSync(dir);
        if(clean) {
            var paths = fs.readdirSync(dir);
            paths.forEach(function(filename) {
                try {
                    fs.unlink(dir + '/' + filename);
                }
                catch(e) {}
            });
        }
    }
    catch(e) {
        fs.mkdirSync(dir, 0755);
    }
}

exports.forMemoryNum = function(memory) {
    var strMemory;
    if(memory < 1024) {
        strMemory = memory + ' Bytes';
    }
    if(memory < 1024 * 1024) {
        strMemory = (memory / 1024).toFixed(2) + ' KB';
    }
    else {
        strMemory = (memory / (1024 * 1024)).toFixed(2) + ' MB';
    }
    return strMemory;
};


/*var tillPrevDeath = null;

exports.deathQueue = function deathQueue(worker, emitter, success){

    assert.ok(worker);
    assert.ok(emitter);
    assert.ok(success);

    var tillDeath = when.defer(),
        afterDeath = null,
        die = function(){

            var successor = success(),
                workerPid = worker.pid,
                expectPid = successor.pid;

            //when successor is in place, the old worker could be discontinued finally
            emitter.on('listening', function onListen(onboard){

                if(expectPid === onboard){
                    
                    emitter.removeListener('listening', onListen);

                    worker.kill('SIGINT');

                    emitter.on('died', function onDeath(death){

                        if(death === workerPid){

                            emitter.removeListener('died', onDeath);

                            tillDeath.resolve(workerPid);

                            if(tillPrevDeath === afterDeath){//last of dyingQueue resolved, clean up the dyingQueue
                                tillPrevDeath = null;
                            }
                        }
                    });
                }

            });
        };

    if(!tillPrevDeath){
        //1st in the dying queue,
        afterDeath = tillPrevDeath = timeout(60000, tillDeath.promise);//1 min timeout
        die();
    }
    else{
        //some one in the queue already, wait till prev death and then start `die`
        afterDeath = tillPrevDeath = timeout(60000, tillPrevDeath.ensure(die));
    }
};*/

exports.safeKill = function(pid, signal, logger){

    try{
        process.kill(pid, signal);
        return false;
    }
    catch(e){
        //verify error is Error: ESRCH
        logger.debug('[shutdown] safeKill received:%j', e);
        return e.errno === 'ESRCH'; //no such process
    }
};

exports.deathQueueGenerator = function(options){

    options = options || {};

    var tillPrevDeath = null,
        queue = options.queue || [],
        wait = options.timeout || 60000,
        retry = options.retry || 3,
        logger = options.logger || {
            'debug' : function(){
                console.log.apply(console, arguments);
            }
        };

    return function deathQueue(worker, emitter, success){

        assert.ok(worker);
        assert.ok(emitter);
        assert.ok(success);

        var pid = worker.pid,
            death = util.format('worker-%d-died', pid);

        if(!_.contains(queue, pid)){

            queue.push(pid);

            var tillDeath = when.defer(),
                afterDeath = null,
                die = function die(retry){

                    if(!retry){
                        if(tillPrevDeath){
                            tillPrevDeath.reject(new Error('[deathQueue] failed after retries'));
                        }
                        tillPrevDeath = null;//reset
                    }
                    
                    var successor = success(),
                        successorPid = successor.pid,
                        successorGuard = setTimeout(function onSuccessorTimeout(){
                            //handle error case of successor not 'listening' after started
                            exports.safeKill(pid, 'SIGTERM', logger);
                            
                            logger.debug('[deathQueue] successor:%d did not start listening, kill by SIGTERM', successorPid);
                            //cancel onListening event handler of the dead successor
                            emitter.removeListener('listening', onSuccessorListening);
                            //retry of the 'die' process
                            die(retry - 1);
                            
                        }, wait),
                        onSuccessorListening = function onSuccessorListening(onboard){

                            if(successorPid !== onboard){
                                return; //noop
                            }
                            else{
                                emitter.removeListener('listening', onSuccessorListening);
                            }

                            clearTimeout(successorGuard);
                            logger.debug('[deathQueue] successor:%d of %d is ready, wait for %s and timeout in:%dms', successorPid, pid, death, wait);

                            function stopWorker(signal){

                                if(!exports.safeKill(pid, signal, logger)){
                                    //worker still there, should emit 'exit' eventually
                                    logger.debug('[deathQueue] worker:%d did not report death by:%d, kill by '+signal, pid, wait);
                                    if (signal === 'SIGTERM') {
                                        deathGuard = setTimeout(stopWorker.bind(null, 'SIGKILL'), wait);
                                    }
                                }
                                else{//suicide or accident already happended, process has run away
                                    //we emit this from master on behalf of the run away process.
                                    logger.debug('[deathQueue] worker:%d probably ran away, emit:%s on behalf', death);
                                    //immediately report death to the master
                                    emitter.emit('died', pid);
                                }
                            }

                            var onDeath = function onDeath(dismiss){

                                    if(pid !== dismiss){
                                        return;
                                    }
                                    else{
                                        emitter.removeListener('died', onDeath);
                                    }

                                    logger.debug('[deathQueue] %d died', pid);

                                    clearTimeout(deathGuard);//release the deathGuard
                                    
                                    tillDeath.resolve(pid);

                                    if(tillPrevDeath === afterDeath){//last of dyingQueue resolved, clean up the dyingQueue

                                        logger.debug('[deathQueue] death queue cleaned up');

                                        tillPrevDeath = null;
                                        
                                        queue = [];
                                    }
                                },
                                deathGuard = setTimeout(stopWorker.bind(null, 'SIGTERM'), wait);

                            worker.kill('SIGINT');
                            
                            emitter.on('died', onDeath);
                        };

                    //when successor is in place, the old worker could be discontinued finally
                    emitter.on('listening', onSuccessorListening);
                };

            if(!tillPrevDeath){//1st in the dying queue,
                afterDeath = tillPrevDeath = tillDeath.promise;//1 min
                die(retry);
            }
            else{
                afterDeath = tillPrevDeath = tillPrevDeath.ensure(_.bind(die, null, retry));
            }
        }
    };
    
};

exports.deathQueue = exports.deathQueueGenerator({
    'timeout': process.env.DEATH_TIMEOUT || 60000
});
