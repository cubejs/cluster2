'use strict';

var listen = require('../../index').listen;
var express = require('express');
var app = express();

function configureApp() {
    app.get('/sayHello', function (req, res) {
        res.send('hello', 200);
    });

    return app;
}

listen({
    'noWorkers': 1,
    'createServer': require('http').createServer,
    'app': app,
    'port': parseInt(process.env.port) || 9090,
    'configureApp': configureApp,
    'cache': {
        'enable': false
    },
    'ecv': {
        'mode': 'control',
        'root': '/ecv'
    },
    'monCreateServer': require('http').createServer,
    'monPort': parseInt(process.env.monPort) || 9091
}).then(function (resolved) {
    //console.log(resolved);
    if (resolved.worker) {
        return;
    }
    var master = resolved.master;
    var workerPid = Object.keys(master.puppets)[0];
    process.on('message', function (msg) {
        if (msg.operation === 'pause') {
            master.pause(workerPid).then(function (resolved) {
                process.send({paused: true});
            });
        }
        if (msg.operation === 'resume') {
            master.resume(workerPid).then(function (resolved) {
                process.send({resumed: true});
            });
        }
    });
    process.send({ready: true});
}).otherwise(function (err) {
    console.log(err);
    process.send({err: err});
});
