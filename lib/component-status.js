var _ = require("underscore"),
	cluster = require("cluster"),
	EventEmitter = require("events").EventEmitter;

//componentStatus module allows application to #register their component view handlers
//each handler should take a simple JSON object {"component":"", "view":"[JSON|HTML]"} and produce a result
//which has same keys, except for that view should contain the actual view content, as string to be displayed
var ComponentStatus = exports.ComponentStatus = function(emitter){

};

ComponentStatus.prototype.register(name, handler){
	emitter.emit("new-component-status", name);

	emitter.on("get-component-status", function(component, params){
		if(_.isEqual(name, component)){
			emitter.emit("component-status-got", handler(params));
		}
	});
};

var ComponentStatusRegistry = exports.ComponentStatusRegistry = function(emitter){

	var components = this.components = {};
	var masterEmitter = this.masterEmitter = new EventEmitter();

	emitter.on("new-component-status", function(component){
		components[component] += 1;
	});

	masterEmitter.on("component-status", function(component, params)){

		var expects = components[component],
			allStatus = [],
			got = function(status){
				allStatus.push(status);
				if((expects -= 1) === 0){
					clearTimeout(timeOut);
					emitter.removeListener("component-status-got", got);
					masterEmitter.emit("component-status-combined", allStatus);
				}
			},
			timeOut = setTimeout(function(){
				emitter.removeListener("component-status-got", got);
				masterEmitter.emit("component-status-combined", allStatus);
			}, 5000);

		emitter.on("component-status-got", got);

		emitter.emit("get-component-status");
	});
};

ComponentStatusRegistry.prototype.components = function(){
	return this.components;
}

ComponentStatusRegistry.prototype.getStatus(component, params, handler){
	this.masterEmitter.once("component-status-combined", handler);
	this.masterEmitter.emit("component-status", component, params);
}

//default single process emitter is the process itself
var emitter = process;

//overwrite the emitter in case the process is the master of a cluster
if(process.cluster && process.cluster.clustered){
	var workers = process.cluster.workers;
	emitter = {
		handlers : [],
		actuals : [],

		emit: function(){
			var event = arguments.shift();
			_.values(workers, function(worker){
				worker.send({
					type: event,
					params: arguments
				});
			});
		},
		on: function(event, handler){
			this.handlers.push(handler);
			this.actuals.push(function(message){
				if(_.isEqual(message.type, event)){
					handler.apply(null, message.params);
				}
			});
			_.values(workers, function(worker)){
				worker.on("message", _.last(actuals));
			}
		},
		removeListener: function(event, handler){
			var index = _.indexOf(this.handlers, handler);
			_.values(workers, function(worker){
				worker.removeListener("message", this.actuals[index]);
				this.handlers = this.handlers.splice(index, 1);
				this.actuals = this.actuals.splice(index, 1);
			});
		}
	}
}	
if(cluster.isWorker){
	emitter = {
		emit: function(){
			var event = arguments.shift();
			process.send({
				type: event,
				params: arguments
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

exports.componentStatusRegistry = new ComponentStatusRegistry(emitter);
exports.componentStatus = new ComponentStatus(emitter);