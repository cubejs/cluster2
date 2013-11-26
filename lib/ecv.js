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

	var logger = process.getLogger(__filename),
        mode = options.mode || 'control', //default is control + disabled === false, therefore, ecv is mark up
		root = options.root,
		positive = options.positive || function(req, res){
			res.send(200);
		},
		negative = options.negative || function(req, res){
			res.send(500);
		};

	assert.ok(root);

	logger.info('[ecv] enabled in the mode:%s', mode);

	if('monitor' === mode){

		var monitor = options.monitor, //monitor must be given, and it's expected in full url format
			validator = options.validator || function(error, response, body){

				return !error && response.statusCode < 400;
			};

		assert.ok(monitor);

		app.use(function(req, res, next){

			if(req.url !== root){

				next();
			}
			else{
				request.get(monitor, function(error, response, body){

					(validator(error, response, body) ? positive : negative)(req, res);
				});
			}
		});
	}
	else if('control' === mode){

		var emitter = options.emitter,
			markUp = options.markUp,
			markDown = options.markDown;

		app.ecv = {'disabled': options.disabled};

		app.use(function(req, res, next){

			if(req.url === markDown){

				app.ecv.disabled = true;
				emitter.to(['master']).emit('markDown');
				logger.info('[ecv] traffic disabled');

				negative(req, res);
			}
			else if(req.url === markUp){

				app.ecv.disabled = false;
				emitter.to(['master']).emit('markUp');
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
