'use strict';

var should = require('should'),
    _ = require('underscore'),
    EventEmitter = require('events').EventEmitter,
    Puppet = require('../lib/puppet').Puppet,
    getLogger = require('../lib/utils').getLogger;

describe('puppet', function(){

    before(function(done){

        process.getLogger = getLogger;
        done();
    });

    describe('#contructor', function(){

        it('should create a puppet instance', function(done){

            var emitter = new EventEmitter();
            emitter.to = function(targets){

                return {
                    'emit': function(){
                        emitter.emit.apply(emitter, arguments);
                    }
                };
            };

            var pid = Math.floor(process.pid * (1 + Math.random())),
                logger = getLogger(),
                master = {
                    'logger': logger,
                    'emitter': emitter,
                    'puppets': {},

                    'fork': function(){

                    }
                },
                worker = {
                    'process': {
                        'pid': pid
                    },

                    'disconnect': function(){

                        process.nextTick(function(){

                            emitter.emit('disconnect', worker);

                            process.nextTick(function(){

                                emitter.emit('exit', worker);
                            });
                        });
                    }
                },
                puppet = new Puppet(master, worker, {}, {});

            master.puppets[pid] = puppet;

            puppet.should.be.ok;

            _.each(['disconnect', 'whenOnline', 'whenListening', 'whenExit', 'whenHeartbeat'], function(m){
                _.isFunction(puppet[m]).should.equal(true);
            });

            _.each(['forkedState', 'activeState', 'oldState', 'diedState'], function(s){
                puppet[s].should.be.ok;
            });

            emitter.once('online', function(worker){

                puppet.whenOnline();
            });

            emitter.once('listening', function(worker){

                puppet.whenListening();
            });

            emitter.once('heartbeat', function(worker, heartbeat){

                puppet.whenHeartbeat();
            });

            emitter.once('disconnect', function(worker){

                puppet.disconnect();
            });

            emitter.once('exit', function(worker){

                puppet.whenExit();
            });

            puppet.state.should.equal(puppet.forkedState);

            emitter.once('online', function(worker){

                puppet.worker.should.equal(worker);
                puppet.state.should.equal(puppet.forkedState);

                emitter.once('listening', function(worker){

                    puppet.worker.should.equal(worker);
                    puppet.state.should.equal(puppet.activeState);

                    emitter.once('exit', function(worker){

                        puppet.worker.should.equal(worker);
                        puppet.state.should.equal(puppet.diedState);

                        done();
                    });

                    emitter.emit('exit', worker);
                });

                emitter.emit('listening', worker);
            });

            emitter.emit('online', worker);

        });

    });

});