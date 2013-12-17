'use strict';

var listen = require('../../index').listen;
var express = require('express');
var app = express();

function configureApp() {

    app.get('/set', function (req, res) {

        var key = req.query.key,
            value = req.query.value;
        if (!key || !value) {
            res.send('hello', 200);
        }
        else {
            
            var cache = require('cluster-cache').use('cache-test');
            cache.set(key, value).then(function(happens){    
                    res.send(happens ? value : 'fail', 200);
                },
                function (err) {
                    res.send(err, 404);
                });
        }
    });

    app.get('/get', function (req, res) {
        var key = req.query.key;
        if (!key) {
            res.send('hello', 200);
        }
        else {

            var cache = require('cluster-cache').use('cache-test');
            cache.get(key, function (){
                return 'cache-test';
            })
            .then(function (value){
                    res.send(value, 200);
                },
                function (err){
                    res.send(err, 404);
                });
        }
    });

    return app;
}

//console.log('aaa: ' + process.env.port);
listen({
    'noWorkers': 2,
    'createServer': require('http').createServer,
    'app': app,
    'port': parseInt(process.env.port) || 9090,
    'configureApp': configureApp,
    'cache': {
        'enable': true,
        'mode': 'standalone',
        'domainPath': '/tmp/cluster-cache-domain-' + process.pid,
        'persistPath': '/tmp/cluster-cache-persist-' + process.pid
    },
    'ecv': {
        'mode': 'control',
        'root': '/ecv'
    },
    'monCreateServer': require('http').createServer,
    'monPort': parseInt(process.env.monPort) || 9091
})
.then(function (resolved) {
        process.send({'ready': true});
    },
    function (err) {
        process.send({'err': err});
    });
