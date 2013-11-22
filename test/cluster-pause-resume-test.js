'use strict';

var request = require('request');
var should = require('should');
var fork = require('child_process').fork;
var utils = require('../lib/utils');

describe('Test Pause and Resume the Worker', function () {
    
    var childProc;
    var port;
    
    before(function (done) {
        var token = 't-' + Date.now();
        utils.pickAvailablePorts(9090, 9190, 2).then(function (ports) {
            port = ports[0]
            childProc = fork(require.resolve('./lib/cluster-pause-resume-runtime.js'), ['--token=' + token], {env: {port: ports[0], monPort: ports[1]}});
            childProc.once('message', function (msg) {
                if (msg.ready) {
                    return done();
                }else if (msg.err) {
                    console.log(msg.err);
                    return done(msg.err);
                }
            });
        }).otherwise(function (err) { 
            return done(err);
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
                    url: 'http://127.0.0.1:' + port + '/sayHello',
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
                request.get('http://127.0.0.1:' + port + '/sayHello', function (err, res, body) {
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
