'use strict';

var util = require('util');
var axon = require('axon');
var CacheSocket = require('./cache-socket.js');

function CacheUsrSocket(format) {
    var _this = this;
    _this.subSock = axon.socket('sub');
    _this.reqSock = axon.socket('req');

    _this.subSock.on('message', function (msg) {
        _this.emit('message', msg);
    });

    return CacheSocket.call(_this, [_this.reqSock, _this.subSock], format);
}

util.inherits(CacheUsrSocket, CacheSocket);

CacheUsrSocket.prototype.send = function send(msg, reply) {
    var _this = this;

    _this.reqSock.send(msg, reply);
};

module.exports = CacheUsrSocket;
