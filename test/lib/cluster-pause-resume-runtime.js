'use strict';

var listen = require('../../index').listen,
    express = require('express'),
    _ = require('underscore'),
    app = express();

function configureApp() {

    app.get('/sayHello', function (req, res){
        res.send('hello', 200);
    });

    return app;
}

listen({
    'noWorkers': 1,
    'createServer': require('http').createServer,
    'app': app,
    'port': parseInt('' + process.env.port, 10) || 9090,
    'configureApp': configureApp,
    'cache': {
        'enable': true
    },
    'ecv': {
        'mode': 'control',
        'root': '/ecv'
    },
    'monCreateServer': require('http').createServer,
    'monPort': parseInt('' + process.env.monPort, 10) || 9091
})
.then(function(resolved){
    
        if(resolved.worker){
            return;
        }

        var master = resolved.master,
            workerPid = _.last(_.keys(master.puppets));

        console.log('[test] pause & resume pid:%d', workerPid);

        process.on('message', function(msg){

            if(msg.operation === 'pause') {

                master.pause(workerPid).then(function(resolved){

                        console.log('[test] paused');
                        process.send({'paused': true});
                    }, 
                    function(err){

                        console.log('[test] error:\n' + err.stack);
                        process.send({'paused': false});
                    });
            }
            if(msg.operation === 'resume'){

                master.resume(workerPid).then(function(resolved){
                        process.send({'resumed': true});
                    }, 
                    function(err){
                        process.send({'resumed': false});
                    });
            }
        });

        process.send({'ready': true});
    },
    function (err) {
        
        process.send({'err': err});
    });
