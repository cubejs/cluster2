'use strict';

var util = require('util');
var when = require('when');
var timeout = require('when/timeout');
var assert = require('assert');
var _ = require('underscore');
var Worker = require('./worker').Worker;

var CacheMgrWorker = exports.CacheMgrWorker = function (proc, options) {
    Worker.call(this, proc, options);
}

util.inherits(CacheMgrWorker, Worker);

CacheMgrWorker.prototype.listen = function listen () {
    var _this = this,
        app = _this.app,
        ports = _this.port,
        createServer = _this.createServer,
        warmUp = _this.warmUp,
        debug = _this.debug,
        wait = _this.timeout;

    assert.ok(createServer);
    assert.ok(app);
    assert.equal(_.isArray(ports), true, 'The cache manager worker should have a ports array');
    assert.ok(warmUp);

    var tillListen = when.defer();
    var run = function () {
        _this.logger.info('[cache] manager %d listening on %j', _this.pid, ports);
        var server = createServer(app).listen(ports, function(error) {
            if (error) {
                _this.logger.info('[cache] manager %d error: %j', _this.pid, error);
            }
            _this.logger.info('[cache] manager %d started listening on %j', _this.pid, ports);
            when(warmUp()).ensure(function () {
                _this.logger.info('[cache] manager %d warmed up', _this.pid);
                _this.emitter.emit(util.format('worker-%d-warmup', _this.pid)); //tell everyone warmup is done
                // cache manager does not need to switch port
                _this.emitter.emit(util.format('worker-%d-listening', _this.pid), {port: ports}); //tell master, worker ready

                tillListen.resolve({
                    'server': server,
                    'app': app,
                    'port': port,
                    'master': null,
                    'worker': _this
                });
            });
        });
    };

    if (!debug) {
        run();
    }else {
        _this.emitter.once('run', run);
    }

    return (wait > 0 ? timeout(_this.timeout, tillListen.promise) : tillListen.promise);
};

CacheMgrWorker.prototype.pause = function () {
    throw new Error('pause is not supported in CacheMgrWorker');
};

CacheMgrWorker.prototype.resume = function () {
    throw new Error('resume is not supported in CacheMgrWorker');
};


