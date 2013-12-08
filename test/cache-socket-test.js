'use strict';

var should = require('should');
var cacheSocketFactory = require('../lib/cache-socket/cache-socket-factory.js');
var utils = require('../lib/utils.js');
var cacheMgrSocket = cacheSocketFactory.getCacheSocket('manager', 'json');
var cacheUsrSocket = cacheSocketFactory.getCacheSocket('user', 'json');

describe('Test cache socket', function () {

    before(function (done) {
        utils.pickAvailablePorts(9190, 9290, 2).then(function (ports) {
            console.log('pickup ports %j', ports);
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
        }, done);
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
