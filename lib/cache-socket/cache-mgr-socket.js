'use strict';

var util = require('util');
var axon = require('axon');
var CacheSocket = require('./cache-socket.js');

function CacheMgrSocket(format) {
    var _this = this;

    _this.pubSock = axon.socket('pub');
    _this.repSock = axon.socket('rep');

    _this.repSock.on('message', function (msg, reply) {
        _this.emit('message', msg, reply);
    });

    return CacheSocket.call(_this, [_this.repSock, _this.pubSock], format);
}

util.inherits(CacheMgrSocket, CacheSocket);

CacheMgrSocket.prototype.send = function send(msg) {
    var _this = this;

    _this.pubSock.send(msg);
};

module.exports = CacheMgrSocket;
