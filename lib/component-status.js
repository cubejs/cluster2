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

//componentStatus module allows application to #register their component view handlers
//each handler should take a simple JSON object {"component":"", "view":"[JSON|HTML]"} and produce a result
//which has same keys, except for that view should contain the actual view content, as string to be displayed
var ComponentStatus = exports.ComponentStatus = function(emitter){

	var components = this.components = {},
		reducers = this.reducers = {};

	emitter.on("new-component-status", function(component){

		//console.log('[cluster2] master component-status:' + JSON.stringify(component));
		components[component.name] = {
			reducer: component.reducer,
			count: components[component.name] ? components[component.name].count + 1 : 1
		};
	});

	this.reducer('default', DEFAULT_REDUCER)
		.reducer('sum', DEFAULT_REDUCER)
		.reducer('concat', DEFAULT_REDUCER)
		.reducer('avg', AVERAGE_REDUCER)
		.reducer('array', ARRAY_REDUCER);
};

//worker
ComponentStatus.prototype.register = function(name, handler, reducer){

	emitter.emit("new-component-status", {
		name : name,
		reducer: reducer
	});

	emitter.on("get-component-status", function(component, now, options){
		if(_.isEqual(name, component)){
			emitter.emit(
				util.format('get-component-status-%s-%d-%s', component, now, options.worker ? process.pid : ''), 
				handler(options.params));
		}
	});

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

	var params = options.params || [],
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
		}, 10000);

	//console.log('[cluster2] getStatus:' + component + ';event:' + event + ';expects:' + expects);
	emitter.on(event, collect);
	//console.log('[cluster2] expects:' + event);
	emitter.emit('get-component-status', component, now, params);

	return this;
};

//default single process emitter is the process itself
var emitter = process;

//overwrite the emitter in case the process is the master of a cluster
if(process.cluster && process.cluster.clustered){
	var workers = process.cluster.workers;
	emitter = {
		events : [],
		handlers : [],
		actuals : [],

		emit: function(){
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

			process.emit(event, args);
		},
		on: function(event, handler){
			
			emitter.events.push(event);
			emitter.handlers.push(handler);
			emitter.actuals.push(function(message){
				//console.log('[cluster2] master handle:' + event + ':' + message.type + ':' + JSON.stringify(message));
				if(_.isEqual(message.type, event)){
					handler.apply(null, message.params);
				}
			});
			_.each(_.values(workers), function(worker){
				worker.on("message", _.last(emitter.actuals));
			});

			process.on(event, handler);
		},
		removeListener: function(event, handler){
			var index = _.indexOf(emitter.handlers, handler);

			_.each(_.values(workers), function(worker){
				worker.removeListener("message", emitter.actuals[index]);
			});

			emitter.handlers = emitter.handlers.splice(index, 1);
			emitter.actuals = emitter.actuals.splice(index, 1);

			process.removeListener(event, handler);
		}
	};

	process.cluster.emitter.on('listening', function(pid){
		//console.log('[cluster2] master found new worker, and will hook up with activated listener:' + pid);
		var worker = workers[pid];
		_.each(emitter.handlers, function(handler, index){

			var event = emitter.events[index],
				actual = emitter.actuals[index];
			worker.on('message', actual);
		});
	});
}	
if(cluster.isWorker){
	emitter = {
		emit: function(){
			
			var args = _.toArray(arguments),
				event = args.shift();

			process.send({
				type: event,
				params: args
			});
		},
		on: function(event, handler){
			
			process.on("message", function(message){
				if(_.isEqual(message.type, event)){
					handler.apply(null, message.params);
				}
			});
		}
	}
}

exports.componentStatus = new ComponentStatus(emitter);
