'use strict';

var when = require('when');
var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

module.exports = function CacheSockets(sockets, format) {
    EventEmitter.call(this);
    return this.initialize(sockets, format);
}

util.inherits(CacheSockets, EventEmitter);

CacheSockets.prototype.initialize = function initialize(sockets, format) {
    format = format || 'json';
    sockets = sockets || [];
    sockets = _isArray(sockets) ? sockets : [sockets];

    _.each(sockets, function (socket) {
        socket.format(format);
        socket.on('error', function (error) {
            _this.emit('error', error);
        });
    });

    this.sockets = sockets;
};

CacheSockets.prototype.listen = function listen(ports, hosts, cb) {
    var _this = this;

    ports = ports || [];
    if (ports.length < _this.sockets.length) {
        var error = new Error('The number of ports does not match the number of sockets');
        if (cb) {
            cb(error);
        }
        _this.emit('error', error);
        return _this;
    }

    hosts = hosts || [];

    when.map(_.range(_this.sockets.length), function (ith) {
        var tillBind = when.defer();
        _this.sockets[ith].bind(ports[ith], hosts[ith], function (error) {
            if (error) {
                tillBind.reject(error);
            }else {
                tillBind.resolve(_this.sockets[ith]);
            }
        });
        return tillBind.promise;
    }).then(function (resolved) {
        if (cb) {
            cb(null);
        }
        _this.emit('listen');
    }).otherwise(function (error) {
        if (cb) {
            cb(error);
        }
        _this.emit('error', error);
    });
    
    return _this;
};

CacheSockets.prototype.close = function close(cb) {
    var _this = this;

    when.map(_.range(_this.sockets.length), function (ith) {
        var tillClose = when.defer();
        _this.sockets[ith].close(function (error) {
            if (error) {
                tillClose.reject(error);
            }else {
                tillClose.resolve(_this.sockets[ith]);
            }
        });
        return tillClose.promise;
    }).then(function (resolved) {
        if (cb) {
            cb(null);
        }
        _this.emit('close');
    }).otherwise(function (error) {
        if (cb) {
            cb(error);
        }
        _this.emit('error', error);
    });
};

CacheSockets.prototype.connect = function connect(ports, hosts, cb) {
    var _this = this;

    ports = ports || [];
    if (ports.length < _this.sockets.length) {
        var error = new Error('The number of ports does not match the number of sockets');
        if (cb) {
            cb(error);
        }
        _this.emit('error', error);
        return _this;
    }

    hosts = hosts || [];

    when.map(_.range(_this.sockets.length), function (ith) {
        var tillConnect = when.defer();
        _this.sockets[ith].connect(ports[ith], hosts[ith], function (error) {
            if (error) {
                tillConnect.reject(error);
            }else {
                tillConnect.resolve(_this.sockets[ith]);
            }
        });
        return tillConnect.promise;
    }).then(function (resolved) {
        if (cb) {
            cb(null);
        }
        _this.emit('connect');
    }).otherwise(function (error) {
        if (cb) {
            cb(error);
        }
        _this.emit('error', error);
    });
};
