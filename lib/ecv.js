'use strict';

//ecv is redesigned to be a simpler middleware of the monitoring app
//ecv should show a consistent view of the entire cluster
//ecv should have a root path, which is what the ops requests will be
//ecv should have 2 modes, monitor vs. controlled
//monitor mode requires a monitor url, a validator which allows ecv to issue request and let validator checks and decide if the ecv should be positive or negative
//controled mode is simply an on/off switch based on 2 more url routes (enable/disable)
var request = require('request'),
	assert = require('assert');

var logger = process.getLogger(__filename);

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

	logger.info('[ecv] enabled in the mode:%s', mode);

	if('monitor' === mode){

		var monitor = options.monitor,
			validator = options.validator || function(err, res, body){

				return res.statusCode < 400;
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

		var emitter = options.emitter,
			markUp = options.markUp,
			markDown = options.markDown;

		app.ecv = {'disabled': options.disabled};
		emitter.on('warning', function(message){
			
			if(message.command === 'disable'){

				app.ecv.disabled = true;
				logger.info('[ecv] traffic disabled');
			}
			else if(message.command === 'enable'){
				
				app.ecv.disabled = false;
				logger.info('[ecv] traffic enabled');
			}
		});

		app.use(function(req, res, next){

			if(req.url === markDown){

				app.ecv.disabled = true;
				emitter.emit('markDown', ['master']);
				logger.info('[ecv] traffic disabled');

				negative(req, res);
			}
			else if(req.url === markUp){

				app.ecv.disabled = false;
				emitter.emit('markUp', ['master']);
				logger.info('[ecv] traffic enabled');

				positive(req, res);
			}
			else if(req.url !== root){

				next();
			}
			else{
				//just to tell if ecv is on/off
				(app.ecv.disabled ? negative : positive)(req, res);
			}
		});
	}
}
