'use strict';

var util = require('util');
var axon = require('axon');
var CacheSockets = require('./cache-socket.js');

module.exports = function CacheUsrSocket(format) {
    this.subSock = axon.socket('sub');
    this.reqSock = axon.socket('req');

    this.subSock.on('message', function (msg) {
        _this.emit('message', msg);
    });

    return CacheSockets.call(this, [reqSock, subSock], format);
}

util.inherits(CacheUsrSocket, CacheSockets);

CacheUsrSocket.prototype.send = function send(msg, reply) {
    var _this = this;

    _this.reqSock.send(msg, reply);
};
