'use strict';

//ecv is redesigned to be a simpler middleware of the monitoring app
//ecv should show a consistent view of the entire cluster
//ecv should have a root path, which is what the ops requests will be
//ecv should have 2 modes, monitor vs. controlled
//monitor mode requires a monitor url, a validator which allows ecv to issue request and let validator checks and decide if the ecv should be positive or negative
//controled mode is simply an on/off switch based on 2 more url routes (enable/disable)
var request = require('request'),
	assert = require('assert');

exports.enable = function enable(app, options){

	var mode = options.mode,
		root = options.root,
		positive = options.positive || function(req, res){
			res.send(200);
		},
		negative = options.negative || function(req, res){
			res.send(500);
		};

	assert.ok(mode);
	assert.ok(root);

	if('monitor' === mode){

		var monitor = options.monitor,
			validator = options.validator || function(err, res, body){

				return res.statusCode < 300;
			};

		app.use(function(req, res, next){

			if(req.url !== root){
				next();
			}
			else{
				request.get(monitor, function(err, res, body){

					(validator(err, res, body) ? positive : negative)(req, res);
				});
			}
		});
	}
	else if('control' === mode){

		var disabled = options.disabled,
			emitter = options.emitter,
			markUp = options.markUp,
			markDown = options.markDown;

		emitter.on('warning', function(message){
			
			if(message.command === 'disable'){
				disabled = true;
			}
			else if(message.command === 'enable'){
				disabled = false;
			}
		});

		app.use(function(req, res, next){

			if(req.url === markUp){

				disabled = false;
				emitter.emit('markUp', ['master']);
			}
			else if(req.url === markDown){

				disabled = true;
				emitter.emit('markDown', ['master']);
			}
			else if(req.url !== root){

				next();
			}
			else{
				(disabled ? positive : negative)(req, res);
			}
		});
	}
};
