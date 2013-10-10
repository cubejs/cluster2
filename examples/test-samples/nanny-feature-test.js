'use strict';

var Cluster = require('../../lib/index.js'),
    net = require('net'),
    server = net.createServer();

server.on('listening', function () {
    // determine whose going to die
    console.log('worker ' + process.pid + ' start listening');
    if (process.pid % 3 === 0) {
        console.log('worker ' + process.pid + ' will be blocked after 15s');
        setTimeout(function () {
            console.log('worker ' + process.pid + ' is blocked');
            if (process.heartbeat) {
                console.log('clear the heartbeat interval');
                clearInterval(process.heartbeat);
            }
            //process.exit(-1);
        }, 15000);
    }
});

var cluster = new Cluster({
    port: 9090,
    noWorkers: 3,
    heartbeatInterval: 10000,
    maxHbInterval: 30000
});

cluster.listen(function (cb) {
    cb(server);
});
