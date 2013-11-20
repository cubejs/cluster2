'use strict';

var listen = require('../../lib/index.js').listen;
var express = require('express');
var app = express();

function configureApp() {
    app.get('/set', function (req, res) {
        var key = req.query.key;
        var value = req.query.value;
        if (!key || !value) {
            res.send('hello', 200);
        }else {
            var cache = require('../../lib/cache.js').use('cache-test');
            cache.set(key, value).then(function (happens) {
                if (happens) {
                    res.send(value, 200);
                }else {
                    res.send('fail', 200);
                }
            }).otherwise(function (err) {
                res.send(err, 404);
            });
        }
    });

    app.get('/get', function (req, res) {
        var key = req.query.key;
        if (!key) {
            res.send('hello', 200);
        }else {
            var cache = require('../../lib/cache.js').use('cache-test');
            cache.get(key, function () {
                return 'cache-test';
            }).then(function (value) {
                res.send(value, 200);
            }).otherwise(function (err) {
                res.send(err, 404);
            });
        }
    });

    return app;
}

listen({
    'noWorkers': 8,
    'createServer': require('http').createServer,
    'app': app,
    'port': 9090,
    'configureApp': configureApp,
    'cache': {
        'enable': true,
        'mode': 'standalone'
    },
    'ecv': {
        'mode': 'control',
        'root': '/ecv'
    },
    'monCreateServer': require('http').createServer,
    'monPort': 9091
}).then(function (resolved) {
    //if (!require('cluster').isMaster) {
        process.send({ready: true}); 
    //}
}).otherwise(function (err) {
    process.send({err: err});
});
