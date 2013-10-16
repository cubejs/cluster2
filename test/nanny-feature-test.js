'use strict';

var should = require('should'),
    request = require('request'),
    _ = require('underscore'),
    spawn = require('child_process').spawn,
    EventEmitter = require('events').EventEmitter,
    emitter = new EventEmitter();

describe('Test Cluster2 Nanny Feature', function () {

    var childProc;

    before(function (done) {
        this.timeout(10000);
        var env = {};
        _.extend(env, process.env);
        _.extend(env, {
            host: '127.0.0.1',
            port: 3000,
            monPort: 3001,
            noWorkers: 2,
            heartbeatInterval: 500,
            maxHeartbeatDelay: 1500
        });

        childProc = spawn('node', ['test/lib/server.js'], {
            env: env,
            stdio: ['pipe', 1, 2, 'ipc']
        });

        childProc.once('message', function (msg) {
            if (msg.ready) {
                return done();
            }
        });
        //setTimeout(done, 5000);
    });

    it('Should get the run away worker id and get notified when the worker died', function (done) {
        var pid;
        this.timeout(10000);
        request.get('http://127.0.0.1:3000/nanny-feature-test', function (err, res, body) {
            should.not.exist(err);
            body.should.be.ok;
            pid = parseInt(body);
            //console.log('body: ' + pid);
        });
        childProc.on('message', function (msg) {
            if (msg.dead) {
                msg.pid.should.equal(pid);
                return done();
            }
        });
    });

    it('Should always has 2 workers running', function (done) {
        request.get('http://127.0.0.1:3001/ComponentStatus?component=worker', function (err, res, body) {
            console.log(body);
            var pids = body.substring(1, body.length - 1).split(',');
            pids.length.should.equal(3); // master & 2 workers
            done(); 
        });
    });
    
    after(function (done) {
        childProc.kill('SIGKILL');
        done();
    });
});
