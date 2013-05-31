var _ = require("underscore");

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

	var components = {};

	emitter.on("new-component-status", function(component){
		components[component] += 1;
	});

	emitter.on("component-status", function(component, params)){

		var expects = components[component],
			allStatus = [],
			got = function(status){
				allStatus.push(status);
				if((expects -= 1) === 0){
					clearTimeout(timeOut);
					emitter.removeListener("component-status-got", got);
					emitter.emit("component-status-combined", allStatus);
				}
			},
			timeOut = setTimeout(function(){
				emitter.removeListener("component-status-got", got);
			}, 5000);

		emitter.on("component-status-got", got);

		emitter.emit("get-component-status");
	});
};