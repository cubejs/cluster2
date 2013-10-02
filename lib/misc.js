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

var fs = require('fs'),
    assert = require('assert'),
    when = require('when'),
    timeout = require('when/timeout');

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


var tillPrevDeath = null;

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

    if(!tillPrevDeath){//1st in the dying queue,
        afterDeath = tillPrevDeath = timeout(tillDeath.promise, 60000);//1 min
        die();
    }
    else{
        afterDeath = tillPrevDeath = timeout(tillPrevDeath, 60000).ensure(die);
    }
};
