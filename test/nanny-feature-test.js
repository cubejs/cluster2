'use strict';

var should = require('should'),
    request = require('request'),
    _ = require('underscore'),
    spawn = require('child_process').spawn,
    nodeunit = require('nodeunit'),
    EventEmitter = require('events').EventEmitter,
    emitter = new EventEmitter(),
    childProc;

exports['Nanny Feature Test'] = {
    setUp: function (callback) {
        var env = {};
        _.extend(env, process.env);
        _.extend(env, {
            host: '127.0.0.1',
            port: 3000,
            monPort: 3001,
            noWorkers: 2,
            hearheatInterval: 500,
            maxHeartbeatDelay: 1500
        });

        childProc = spawn('node', ['test/lib/server.js'], {
            env: env,
            stdio: ['pipe', 1, 2, 'ipc']
        });

        childProc.once('message', function (msg) {
            if (msg.ready) {
                //test.done();
                callback();
            }
        });
    },
    
    tearDown: function (callback) {
        childProc.kill('SIGKILL');
        callback();
    },

    'worker runs away and gets killed & replacement has been created': function (test) {
        var pid;
        request.get('http://127.0.0.1:3000/nanny-feature-test', function (err, res, body) {
            test.equal(err, null);
            test.ok(body);
            pid = parseInt(body);
            console.log(pid);
        });
        childProc.on('message', function (msg) {
            if (msg.dead) {
                console.log(msg.pid);
                test.strictEqual(msg.pid, pid);
                request.get('http://127.0.0.1:3001/ComponentStatus?component=worker', function (err, res, body) {
                    console.log(body);
                    var pids = body.substring(1, body.length - 1).split(',');
                    test.strictEqual(pids.length, 3); // master & 2 workers
                    test.done();
                });
            }
        });
    },

    /*'New worker created to replace the killed worker': function (test) {
        request.get('http://127.0.0.1:3001/ComponentStatus?component=worker', function (err, res, body) {
            var pids = body.substring(1, body.length - 1).split(',');
            test.strictEqual(pids.length, 3); // master & 2 workers
            test.done();
        });
    }*/
};
