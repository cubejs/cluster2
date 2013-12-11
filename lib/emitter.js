//cluster-emitter is a different EventEmitter which allows all messages send between master & slaves, with an additional parameters as 'target'
//the rest of the api should be the same as EventEmitter, so 'on', 'once', 'removeListener', 'removeAllListeners', 'emit'
'use strict';

var cluster = require('cluster'),
    _ = require('underscore');

var masterEmitter = {//masterEmitter is the emitter variation in master process
    
        get logger(){
            return process.getLogger(__filename);
        },
        
        get workers(){//return active workers
    
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
    
                if(!worker.clusterEventHandler){
                    //this is the 1st time a handler is registered, must register 'message' handler on all workers
                    worker.clusterEventHandler = function(message){
                        _.invoke(_this.handlers[message.type] || [], 'apply', null, message.params);
                    };
    
                    worker.on('message', worker.clusterEventHandler);
                }
            });
    
            if(_this.handlers[event].length === 1){
                //this is the 1st time a handler of this event is registered in master process
                process.on(event, function(){
                    _.invoke(_this.handlers[event] || [], 'apply', null, arguments);
                });
            }
        },
    
        'once': function(event, handler){
        
            var _this = this,
                handleOnce = function handleOnce(){
                    //wrap handler, and remove itself immediately after
                    handler.apply(null, arguments);
                    _this.removeListener(event, handleOnce);
                };
    
            _this.on(event, handleOnce);
        },
        
        'emit': function(){
    
            var _this = this,
                pids = _.map(_this.workers, function(worker){//map all workers' pids
                    return worker.process.pid;
                });
            
            return _this.emitTo(pids.concat(['self'])/*plus 'self'*/, arguments);
        },
    
        'to': function(targets){
    
            var _this = this;
    
            return {
                'emit': function(){
                    //set audience to @param targets
                    return _this.emitTo(targets, arguments);
                }
            };
        },
    
        'emitTo': function(targets, args){
    
            args = _.toArray(args || []);
    
            var _this = this,
                event = args.shift(),
                audience = _.filter(_this.workers, function(worker){
                    //filter workers, include only those in the @param targets
                    return _.contains(targets, worker.process.pid);
                });
    
            _.each(audience, function(worker){
                    try{
                        worker.send({
                            'type': event,
                            'params': args
                        });
                    }
                    catch(error){
                        _this.logger.warn('[cluster2] master sending to worker failed:%j', error);
                    }
                });
    
            if(_.contains(targets, 'master') || _.contains(targets, 'self') || _.contains(targets, process.pid)){
                //audience including 'master' itself
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
    },
    //slaveEmitter is the emitter variation in all worker processes
    slaveEmitter = {

        'handlers': {},
    
        'on': function(event, handler){
            
            var _this = this;
            _this.handlers[event] = _this.handlers[event] || [];
            _this.handlers[event].push(handler);
            
            if(_this.handlers[event].length === 1){
                //1st time this event handler is registered in worker process
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
            //default audience being both 'master' & 'worker' itself
            return this.emitTo(['master', 'self'], arguments);
        },
    
        'to': function(targets){
    
            var _this = this;
    
            return {
                'emit': function(){
                    //set audience to @param targets
                    return _this.emitTo(targets, arguments);
                }
            };
        },
    
        'emitTo': function(targets, args){
            
            args = _.toArray(args || []);
    
            var event = args.shift();
    
            if(_.contains(targets, 'master')){
                //audience includes 'master'
                process.send({
                    'type': event,
                    'params': args
                });
            }
            
            if(_.contains(targets, 'self') || _.contains(targets, process.pid)){
                //audience includes 'worker' itself
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

//export the proper emitter based on whose runtime this is, master vs. worker.
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
    
    //enable listening to master's messages
    process.on('message', function(message){

        _.each(emitter.handlers[message.type] || [], function(h){
            h.apply(null, message.params);
        });
    });
}

