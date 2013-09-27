//cluster-emitter is a different EventEmitter which allows all messages send between master & slaves, with an additional parameters as 'target'
//the rest of the api should be the same as EventEmitter, so 'on', 'once', 'removeListener', 'removeAllListeners', 'emit'
'use strict';

var cluster = require('cluster'),
    _ = require('underscore');

var logger = process.getLogger(__filename),
    masterEmitter = {
    
    /**
     * return active workers
     */
    get workers(){

        return cluster.workers;    
    },
    
    'handlers': {
        //a map of event handlers
    },
    
    'on': function(event, handler, duplicateAllowed){
        
        var _this = this;
        _this.handlers[event] = _this.handlers[event] || [];

        if(!_.contains(_this.handlers, handler) || duplicateAllowed){//avoid duplicates
            _this.handlers[event].push(handler);
        }

        _.each(_this.workers, function(worker){

            if(!worker.clusterEventHandler){//this is the 1st time a handler is registered, must register it for all workers
                worker.clusterEventHandler = function(message){
                    _.invoke(_this.handlers[message.type] || [], 'apply', null, message.params);
                };

                worker.on('message', worker.clusterEventHandler);
            }
        });

        if(_this.handlers[event].length === 1){//this is the 1st time a handler is registered, must register it for master process
            process.on(event, function(){
                _.invoke(_this.handlers[event] || [], 'apply', null, arguments);
            });
        }
    },

    'once': function(event, handler){
    
        var _this = this,
            handleOnce = function handleOnce(){
                handler.apply(null, arguments);
                _this.removeListener(event, handleOnce);
            };

        _this.on(event, handleOnce);
    },
    
    'emit': function(){
        var _this = this,
            args = _.toArray(arguments),
            event = args.shift(),
            //the default target is all active workers and the master itself as 'self'
            targets = args.shift() || _.map(_this.workers, function(worker){return worker.process.pid;}).concat(['self']);

			_.each(_.filter(_this.workers, function(worker){
                    return _.contains(targets, worker.process.pid);
                }), 
                function(worker){
                    try{
                        worker.send({
                            'type': event,
                            'params': args
                        });
                    }
                    catch(error){
                        logger.warn('[cluster2] master sending to worker failed:%j', error);
                    }
                });

        if(_.contains(targets, 'master') || _.contains(targets, 'self') || _.contains(targets, process.pid)){
            
            args.unshift(event);
            process.emit.apply(process, args);
        }
    },
    
    'removeListener': function(event, handler){
        
        var _this = this;
        _this.handlers[event] = _.without(_this.handlers[event] || [], handler);

        if(_this.handlers[event].length === 0){
            process.removeAllListeners(event);
        }
    },

    'removeAllListeners': function(event){

        this.handlers[event] = [];
        process.removeAllListeners(event);
    }
};

var slaveEmitter = {

    'handlers': {},
		
    'emit': function(){
        
        var args = _.toArray(arguments),
            event = args.shift(),
            targets = args.shift() || ['master', 'self'];

        if(_.contains(targets, 'master')){
            process.send({
                'type': event,
                'params': args
            });
        }
        
        if(_.contains(targets, 'self') || _.contains(targets, process.pid)){
            args.unshift(event);
            process.emit.apply(process, args);
        }
    },

    'on': function(event, handler){
        
        var _this = this;
        _this.handlers[event] = _this.handlers[event] || [];
        _this.handlers[event].push(handler);
        
        if(_this.handlers[event].length === 1){
            
            process.on(event, function(){

                _.invoke(_this.handlers[event] || [], 'apply', null, arguments);
            });
        }
    },
    
    'once': function(event, handler){
        var _this = this,
            handleOnce = function handleOnce(){

                handler.apply(null, arguments);
                _this.removeListener(event, handleOnce);
            };

        _this.on(event, handleOnce); 
    },
    
    'removeListener': function(event, handler){
        
        var _this = this;
        _this.handlers[event] = _.without(_this.handlers[event] || [], handler);
        
        if(_this.handlers[event].length === 0){
            process.removeAllListeners(event);
        }
    },

    'removeAllListeners': function(event){

        this.handlers[event] = [];
        process.removeAllListeners(event);
    }
};

if(cluster.isMaster){

    var emitter = module.exports = masterEmitter;

    //any newly forked worker must get a replication of the known event handlers
    cluster.on('fork', function(worker){

        if(!worker.clusterEventHandler){

            worker.clusterEventHandler = function(message){
                _.invoke(emitter.handlers[message.type] || [], 'apply', null, message.params);
            };

            worker.on('message', worker.clusterEventHandler);
        }
    });
}
else{
    
    var emitter = module.exports = slaveEmitter;
    
    process.on('message', function(message){

        _.each(emitter.handlers[message.type] || [], function(h){
            h.apply(null, message.params);
        });
    });
}

