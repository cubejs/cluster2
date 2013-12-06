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

var Cluster = require('../../lib/index.js'),
    express = require('express');

var server = express.createServer();
var serving = true;
server.get('/', function(req, res) {
    res.send('hello');
    if(!serving)  {
        req.connection.end();
    }
});

// test nanny feature
server.get('/nanny-feature-test', function (req, res) {
    // the first worker that handles the request will run away
    res.send(process.pid + '');
    console.log('worker ' + process.pid + ' will run away after 2s');
    setTimeout(function () {
        console.log('worker ' + process.pid + ' runs away');
        clearInterval(process.heartbeat);
    }, 2000);
});

server.on('close', function() {
    serving = false;
})

var c = new Cluster({
    timeout: 300 * 1000,
    port: process.env["port"] || 3000,
    monPort: process.env["monPort"] || 10000 - process.env["port"] || 3001,
    cluster: true,
    noWorkers: process.env["noWorkers"] || 2,
    connThreshold: 10,
    ecv: {
        control: true
    },
    heartbeatInterval: process.env["heartbeatInterval"] || 1000,
    maxHeartbeatDelay: process.env["maxHeartbeatDelay"] || 3000
});

c.on('died', function(pid) {
    //console.log('Worker ' + pid + ' died');
    process.send({
        pid: pid,
        dead: true
    })
});

c.on('forked', function(pid) {
    //console.log('Worker ' + pid + ' forked');
});

c.on('listening', function(pid){
    //console.log('Worker ' + pid + ' listening');
    process.send({
        ready: true
    });
});

c.on('SIGKILL', function() {
    //console.log('Got SIGKILL');
    process.send({
        'signal':'SIGKILL'
    });
});

c.on('SIGTERM', function(event) {
    //console.log('Got SIGTERM - shutting down');
    console.log(event);
    process.send({
        'signal':'SIGTERM'
    });
});

c.on('SIGINT', function() {
    //console.log('Got SIGINT');
    process.send({
        'signal':'SIGINT'
    });
});

c.on('heartbeat', function(heartbeat){

    //console.log('Got HEARTBEAT:%j', heartbeat);
    heartbeat.type = 'heartbeat';
    process.send(heartbeat);
});

c.listen(function(cb) {
    cb(server);
});
