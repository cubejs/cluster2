'use strict';

var request = require('request');
var should = require('should');
var fork = require('child_process').fork;
var when = require('when');
var parallel = require('when/parallel');
var util = require('util');
var utils = require('../lib/utils');

describe('Cache Performance Test', function () {

    var childProc;
    var key = 'cache-test-key';
    var value = 'cache-test-value';
    var port;
    var writeTask = function () {
        var deferred = when.defer();
        request.get(util.format('http://127.0.0.1:%d/set?key=%s&value=%s', port, key, value), function (err, res, body) {
            if (!err && res.statusCode === 200 && body === value) {
                deferred.resolve(body);
            }else {
                deferred.reject('cache set error');
            }
        });
        return deferred.promise;
    };
    var readTask = function () {
        var deferred = when.defer();
        request.get(util.format('http://127.0.0.1:%d/get?key=%s', port, key), function (err, res, body) {
            if (!err && res.statusCode === 200 && (body === value || body === 'cache-test')) {
                deferred.resolve(body);
            }else {
                deferred.reject('cache get error');
            }
        });
        return deferred.promise;
    };

    before(function (done) {
        this.timeout(10000);
        var token = 't-' + Date.now();
        utils.pickAvailablePorts(9090, 9190, 2).then(function (ports) {
            port = ports[0];
            childProc = fork(require.resolve('./lib/cluster-cache-runtime.js'), ['--token=' + token], {env: {port: ports[0], monPort: ports[1]}});
            childProc.on('message', function (msg) {
                if (msg.ready) {
                    return done();
                }
                if (msg.err) {
                    return done(err);
                }
            });
        }).otherwise(function (err) {
            return done(err);
        });
    });

    after(function (done) {
        this.timeout(5000);
        childProc.kill('SIGTERM');
        setTimeout(done, 4000);
    });

    describe('# 90% read, %10 write', function () {
        this.timeout(10000);
        var tasks = [];
        for (var i=0; i<20; i++) {
            if (i % 10 === 0) {
                tasks.push(writeTask);
            }else {
                tasks.push(readTask);
            }
        }
        it('Should resolve all the promises', function (done) {
            var startTime = Date.now();
            parallel(tasks).then(function (values) {
                var duration = Date.now() - startTime;
                console.log(duration / 1000);
                done();
            }).otherwise(function (err) {
                done(err);
            });
        });
    });

    describe('# 50% read, 50% write', function () {
        this.timeout(10000);
        var tasks = [];
        for (var i=0; i<20; i++) {
            if (i % 10 < 5) {
                tasks.push(writeTask);
            }else {
                tasks.push(readTask);
            }
        }
        it('Should resolve all the promises', function (done) {
            var startTime = Date.now();
            parallel(tasks).then(function (values) {
                var duration = Date.now() - startTime;
                console.log(duration / 1000);
                done();
            }).otherwise(function (err) {
                done(err);
            });
        });
    });

    describe('# 10% read, 90% write', function () {
        this.timeout(10000);
        var tasks = [];
        for (var i=0; i<20; i++) {
            if (i % 10 < 9) {
                tasks.push(writeTask);
            }else {
                tasks.push(readTask);
            }
        }
        it('Should resolve all the promises', function (done) {
            var startTime = Date.now();
            parallel(tasks).then(function (values) {
                var duration = Date.now() - startTime;
                console.log(duration / 1000);
                done();
            }).otherwise(function (err) {
                done(err);
            });
        });
    });
});
