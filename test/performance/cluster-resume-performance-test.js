'use strict';

var request = require('request');
var should = require('should');
var fork = require('child_process').fork;

describe('Test Pause and Resume the Worker', function () {
    var childProc;
    before(function (done) {
        var token = 't-' + Date.now();
        childProc = fork(require.resolve('../../../ebay-node-demo/server.js'), ['--token=' + token]);
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

    it('First request time', function (done) {
        this.timeout(10000);
        request.get({
            url: 'http://127.0.0.1:9090/ui-components',
            timeout: 10000
        }, function (err, res, body) {
            if (err) {
                done(err);
            }
            res.statusCode.should.equal(200);
            done();
        });
    });

    /*it('Pause the woker', function (done) {
        this.timeout(5000);
        childProc.send({operation: 'pause'});

        childProc.once('message', function (msg) {
            if (msg.paused) {
                request.get({
                    url: 'http://127.0.0.1:9090',
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

    it('First request after resume', function (done) {
        this.timeout(5000);
        childProc.send({operation: 'resume'});

        childProc.once('message', function (msg) {
            if (msg.resumed) {
                request.get('http://127.0.0.1:9090/ui-components', function (err, res, body) {
                    if (err) {
                        done(err);
                    }
                    res.statusCode.should.equal(200);
                    done();
                });
            }
        });
    });*/
});
