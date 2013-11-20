'use strict';

var request = require('request');
var should = require('should');
var fork = require('child_process').fork;

describe('Test Pause and Resume the Worker', function () {
    
    var childProc;
    
    before(function (done) {
        var token = 't-' + Date.now();
        childProc = fork(require.resolve('./lib/cluster-pause-resume-runtime.js'), ['--token=' + token]);
        childProc.once('message', function (msg) {
            if (msg.ready) {
                return done();
            }else if (msg.err) {
                console.log(msg.err);
                return done(msg.err);
            }
        });
    });

    after(function (done) {
        childProc.kill('SIGTERM');
        done();
    });

    it('Should pause the worker', function (done) {
        this.timeout(5000);
        childProc.send({operation: 'pause'});

        childProc.once('message', function (msg) {
            if (msg.paused) {
                request.get({
                    url: 'http://127.0.0.1:9090/sayHello',
                    timeout: 4000
                }, function (err, res, body) {
                    if (err) {
                        done();
                    }else {
                        done(new Error('Should be error here'));
                    }
                });
            }
        });
    });

    it('should resume the worker', function (done) {
        this.timeout(5000);
        childProc.send({operation: 'resume'});

        childProc.once('message', function (msg) {
            if (msg.resumed) {
                request.get('http://127.0.0.1:9090/sayHello', function (err, res, body) {
                    if (err) {
                        done(err);
                    }
                    res.statusCode.should.equal(200);
                    body.should.equal('hello');
                    done();
                });
            }
        });
    });
});
