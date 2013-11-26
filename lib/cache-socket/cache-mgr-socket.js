'use strict';

var util = require('util');
var axon = require('axon');
var CacheSockets = require('./cache-socket.js');

function CacheMgrSocket(format) {
    this.pubSock = axon.socket('pub');
    this.repSock = axon.socket('rep');

    this.repSock.on('message', function (msg, reply) {
        _this.emit('message', msg, reply);
    });

    return CacheSockets.call(this, [repSock, pubSock], format);
}

util.inherits(CacheMgrSocket, CacheSockets);

CacheMgrSocket.prototype.notify = function notify(msg) {
    var _this = this;

    _this.pubSock.send(msg);
};
