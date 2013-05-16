var _ = require("underscore"),
	cluster = require("cluster");


var handlers = {},
	emitter = cluster.isMaster 
		? {
			on: function(event, handler){
				process.on(event, handler);
			},
			emit: function(){
				process.emit.call(null, arguments);
			}
		} 
		: {
			on: function(event, handler){
				process.on("message", function(message){
					if(_.isEqual(event, message.type)){
						handler(message);
					}
				});	
			},
			emit: function(event, message){
				var _message = {
					type: event
				};
				_.extend(_message, message);
				process.send(_message);
			}
		};

//componentStatus module allows application to #register their component view handlers
//each handler should take a simple JSON object {"component":"", "view":"[JSON|HTML]"} and produce a result
//which has same keys, except for that view should contain the actual view content, as string to be displayed
var componentStatus = exports.componentStats = {

	init : _.once(function(){
		emitter.on("components", function(){
			emitter.emit("components-response", _.keys(componentStats._handlers));
		});

		emitter.on("component", function(message){
			emitter.emit("component-response", componentStatus._handlers[message.component].call(null, message));
		});
	}),

	register: function(component, handler){
		this.init();

		this._handlers[component] = handler;
	}
};
