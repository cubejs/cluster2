var _ = require('underscore'),
	cluster = require('cluster'),
	EventEmitter = require('events').EventEmitter,
	util = require('util');

function DEFAULT_REDUCER(memoize, element) {

	return {
		value : memoize ? memoize.value + element : element//whether it's string or number, most of the scenarios could be handled
	};
}

function AVERAGE_REDUCER(memoize, element) {

	return {
		total : memoize ? memoize.total + element : element,
		count : memoize ? memoize.count + 1 : 1,
		get value(){
			return this.total / this.count;
		}
	}
}

function ARRAY_REDUCER(memoize, element) {
	
	return {
		value : memoize ? memoize.value.concat([element]) : [element]
	};
}

function FIRST_REDUCER(memoize, element) {

	return {
		value : memoize ? memoize.value : element
	};
}

//componentStatus module allows application to #register their component view handlers
//each handler should take a simple JSON object {'component':', 'view':'[JSON|HTML]'} and produce a result
//which has same keys, except for that view should contain the actual view content, as string to be displayed
var ComponentStatus = exports.ComponentStatus = function(emitter){

	var components = this.components = {},
		workers = this.workers = {},
		reducers = this.reducers = {};

	this.emitter = emitter;
	emitter.on('new-component-status', function(component){

		//console.log('[cluster2] master component-status:' + JSON.stringify(component));
		components[component.name] = {
			'reducer': component.reducer,
			'count': components[component.name] ? components[component.name].count + 1 : 1
		};

		workers[component.worker] = workers[component.worker] || [];
		workers[component.worker].push(component.name);
	});

	emitter.on('worker-died', function(worker){

		_.each(workers[worker] || [], function(component){
			components[component].count = components[component].count - 1;
		});
	});

	this.reducer('default', DEFAULT_REDUCER)
		.reducer('sum', DEFAULT_REDUCER)
		.reducer('concat', DEFAULT_REDUCER)
		.reducer('avg', AVERAGE_REDUCER)
		.reducer('array', ARRAY_REDUCER)
		.reducer('first', FIRST_REDUCER);
};

//worker
ComponentStatus.prototype.register = function(name, handler, reducer, updater){

	var emitter = this.emitter;
	emitter.emit('new-component-status', {
		'name' : name,
		'reducer': reducer,
		'worker': process.pid
	});

	emitter.on('get-component-status', function(component, now, options){
		if(_.isEqual(name, component)){
			emitter.emit(
				util.format('get-component-status-%s-%d-%s', component, now, options.worker ? process.pid : ''), 
				handler(options.params));
		}
	});

	if(updater){
		emitter.on('update-component-status', function(component, now, options, value){
			if(_.isEqual(name, component)){
				emitter.emit(
					util.format('update-component-status-%s-%d-%s', component, now, options.worker ? process.pid : ''), 
					updater(options.params, value));
			}
		});
	}

	if(cluster.isWorker){
		var components = this.components = this.components || {};
		components[name] = {
			'reducer': reducer,
			'count': components[name] ? components[name].count + 1 : 1
		};
	}
	
	return this;
};

//master
ComponentStatus.prototype.reducer = function(name, handler){

	this.reducers[name] = handler;
	return this;
}

//master
ComponentStatus.prototype.getComponents = function(){

	return _.keys(this.components);
};

//master
ComponentStatus.prototype.getStatus = function(component, options){
	
	options = options || {};

	var emitter = this.emitter,
		params = options.params || [],
		worker = options.worker,
		done = options.done,
		expects = worker ? 1 : this.components[component].count,
		reducer = this.reducers[this.components[component].reducer] || DEFAULT_REDUCER,
		now = Date.now(),
		event = util.format('get-component-status-%s-%d-%s', component, now, worker || ''),
		all = [],
		collect = function(status){
			all.push(status);
			if((expects -= 1) === 0){
				clearTimeout(timeOut);
				emitter.removeListener(event, collect);
				done(_.reduce(all, reducer, null).value);
			}
		},
		timeOut = setTimeout(function(){
			emitter.removeListener(event, collect);
			var partial = _.reduce(all, reducer, null);
			done(partial ? partial.value : null);
		}, 3000);

	//console.log('[cluster2] getStatus:' + component + ';event:' + event + ';expects:' + expects);
	emitter.on(event, collect);
	//console.log('[cluster2] expects:' + event);
	emitter.emit('get-component-status', component, now, params);

	return this;
};

ComponentStatus.prototype.setStatus = function(component, options, value){

	options = options || {};

	var emitter = this.emitter,
		params = options.params || [],
		worker = options.worker,
		done = options.done,
		expects = worker ? 1 : this.components[component].count,
		reducer = this.reducers[this.components[component].reducer] || DEFAULT_REDUCER,
		now = Date.now(),
		event = util.format('update-component-status-%s-%d-%s', component, now, worker || ''),
		all = [],
		collect = function(status){
			all.push(status);
			if((expects -= 1) === 0){
				clearTimeout(timeOut);
				emitter.removeListener(event, collect);
				done(_.reduce(all, reducer, null).value);
			}
		},
		timeOut = setTimeout(function(){
			emitter.removeListener(event, collect);
			var partial = _.reduce(all, reducer, null);
			done(partial ? partial.value : null);
		}, 3000);

	//console.log('[cluster2] getStatus:' + component + ';event:' + event + ';expects:' + expects);
	emitter.on(event, collect);
	//console.log('[cluster2] expects:' + event);
	emitter.emit('update-component-status', component, now, params, value);

	return this;
};

//default single process emitter is the process itself
var emitter = {

	'handlers': {},
	
	'emit': function(){
		process.emit.apply(process, arguments);
	},

	'on': function(event, handler){
		if(!emitter.handlers[event]){
			emitter.handlers[event] = [];
			process.on(event, function(){
				var params = arguments;
				_.each(emitter.handlers[event], function(handler){
					handler.apply(null, params);
				});
			});
		}
		emitter.handlers[event].push(handler);
	},
	
	'removeListener': function(event, handler){
		emitter.handlers[event] = _.without(emitter.handlers[event] || [], handler);
	}
};

//overwrite the emitter in case the process is the master of a cluster
if(process.cluster && process.cluster.clustered){
	var workers = process.cluster.workers;
	emitter = {
		'handlers': {

		},

		'emit': function(){
			var args = _.toArray(arguments),
				event = args.shift();

			//console.log('[cluster2] master emits:' + event + ':\n' + JSON.stringify(args) + ':\nto workers:' + _.keys(workers).length);
			_.each(_.values(workers), function(worker){
				try{
					worker.send({
						type: event,
						params: args
					});
				}
				catch(error){
					console.log('[cluster2] master sending to worker failed');
				}
			});

			process.emit.apply(process, arguments);
		},

		'on': function(event, handler){

			emitter.handlers[event] = emitter.handlers[event] || [];
			emitter.handlers[event].push(handler);

			_.each(_.values(workers), function(worker){
				if(!worker.clusterEventHandler){
					worker.clusterEventHandler = function(message){
						_.invoke(emitter.handlers[message.type] || [], 'apply', null, message.params);
					};

					worker.on('message', worker.clusterEventHandler);
				}
			});

			if(emitter.handlers[event].length === 1){
				process.on(event, function(){
					_.invoke(emitter.handlers[event] || [], 'apply', null, arguments);
				});
			}
		},

		'removeListener': function(event, handler){

			emitter.handlers[event] = _.without(emitter.handlers[event] || [], handler);

			if(emitter.handlers[event].length === 0){
				process.removeAllListeners(event);
			}
		}
	};

	process.cluster.emitter.on('listening', function(pid){
		//console.log('[cluster2] master found new worker, and will hook up with activated listener:' + pid);
		var worker = workers[pid];
		if(!worker.clusterEventHandler){
			worker.clusterEventHandler = function(message){
				_.invoke(emitter.handlers[message.type] || [], 'apply', null, message.params);
			};

			worker.on('message', worker.clusterEventHandler);
		}
	});

	process.cluster.emitter.on('died', function(pid){
		//bugfix of slow vi, as some worker died, and we didn't reduce the expectations.
		process.emit.apply(process, ['worker-died', pid]);
	});
}	

if(cluster.isWorker){
	emitter = {
		'handlers': {},
		
		'emit': function(){
			
			var args = _.toArray(arguments),
				event = args.shift();

			process.send({
				type: event,
				params: args
			});
		},

		'on': function(event, handler){
			this.handlers[event] = this.handlers[event] || [];
			this.handlers[event].push(handler);
		},
		
		'removeListener': function(event, handler){
			this.handlers[event] = _.without(this.handlers[event] || [], handler);
		}
	};

	process.on('message', function(message){
		_.each(emitter.handlers[message.type] || [], function(h){
			h.apply(null, message.params);
		});
	});
}

exports.componentStatus = new ComponentStatus(emitter);
