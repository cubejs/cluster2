//cluster-emitter is a different EventEmitter which allows all messages send between master & slaves, with an additional parameters as 'target'
//the rest of the api should be the same as EventEmitter, so 'on', 'once', 'removeListener', 'removeAllListeners', 'emit'
'use strict';

var cluster = require('cluster'),
    _ = require('underscore');

var masterEmitter = {
    
    get workers(){
        return cluster.workers;    
    },
    
    'handlers': {

    },
    
    'on': function(event, handler){
        
        var _this = this;
        _this.handlers[event] = _this.handlers[event] || [];
        _this.handlers[event].push(handler);

        _.each(_this.workers, function(worker){
            if(!worker.clusterEventHandler){
                worker.clusterEventHandler = function(message){
                    _.invoke(_this.handlers[message.type] || [], 'apply', null, message.params);
                };

                worker.on('message', worker.clusterEventHandler);
            }
        });

        if(_this.handlers[event].length === 1){
            process.on(event, function(){
                _.invoke(emitter.handlers[event] || [], 'apply', null, arguments);
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
            targets = args.shift() || _.map(_this.workers, function(worker){return worker.process.pid;}).concat(['self']);

			_.each(_.filter(_this.workers, function(worker){
                    _.contains(targets, worker.process.pid);
                }), 
                function(worker){
                    try{
                        worker.send({
                            'type': event,
                            'params': args
                        });
                    }
                    catch(error){
                        console.log('[cluster2] master sending to worker failed');
                    }
                });

        if(_.contains(targets, 'master') || _.contains(targets, 'self')){
            process.emit.apply(process, arguments);
        }
    },
    
    'removeListener': function(event, handler){
        
        var _this = this;
        _this.handlers[event] = _.without(_this.handlers[event] || [], handler);

        if(_this.handlers[event].length === 0){
            process.removeAllListeners(event);
        }
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
        
        if(_.contains(targets, 'self')){
            process.emit.apply(process, arguments);
        }
    },

    'on': function(event, handler){
        
        var _this = this;
        _this.handlers[event] = _this.handlers[event] || [];
        _this.handlers[event].push(handler);
        
        if(_this.handlers[event].length === 1){
            
            process.on(event, function(){
                _.invoke(emitter.handlers[event] || [], 'apply', null, arguments);
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
    }
};

if(cluster.isMaster){

    exports.emitter = masterEmitter;
}
else{
    
    var emitter = exports.emitter = slaveEmitter;
    
    process.on('message', function(message){
        _.each(emitter.handlers[message.type] || [], function(h){
            h.apply(null, message.params);
        });
    });
}

