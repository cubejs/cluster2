'use strict';

var should = require('should');
var cacheSocketFactory = require('../lib/cache-socket/cache-socket-factory.js');
var cacheMgrSocket = cacheSocketFactory.getCacheSocket('manager', 'json');
var cacheUsrSocket = cacheSocketFactory.getCacheSocket('user', 'json');

describe('Test cache socket', function () {

    before(function (done) {
        var ports = [9090, 9091];
        cacheMgrSocket.listen(ports, function (error) {
            if (error) {
                return done(error);
            }else {
                cacheUsrSocket.connect(ports, function (error) {
                    if (error) {
                        return done(error);
                    }else {
                        return done();
                    }
                });
            }
        });
    });

    after(function (done) {
        cacheMgrSocket.close();
        cacheUsrSocket.close();
        done();
    });

    it ('Manager should be able to get request and reply', function (done) {
        cacheMgrSocket.on('message', function (msg, reply) {
            msg.should.be.ok;
            msg.hello.should.equal('hello');
            reply('world');
        });

        cacheUsrSocket.send({hello: 'hello'}, function (back) {
            back.should.equal('world');
            return done();
        });
    });

    it ('User should be able to get notification', function (done) {
        cacheUsrSocket.on('message', function (msg) {
            msg.should.be.ok;
            msg.hello.should.equal('notification');
            done();
        });

        cacheMgrSocket.send({hello: 'notification'});
    });
});
