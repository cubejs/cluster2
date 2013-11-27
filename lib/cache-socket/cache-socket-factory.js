'use strict';

var CacheUsrSocket = require('./cache-usr-socket.js');
var CacheMgrSocket = require('./cache-mgr-socket.js');

exports.getCacheSocket = function (type, format) {
    if (type === 'manager') {
        return new CacheMgrSocket(format);
    }else if (type === 'user') {
        return new CacheUsrSocket(format);
    }else {
        throw new Error('Unknown cache socket type');
    }
    return null;
};
