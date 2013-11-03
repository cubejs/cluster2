'use strict';

var listen = require('../lib/index').listen,
	util = require('util'),
	path = require('path'),
	express = require('express'),
	store = new express.session.MemoryStore, 
	app = express(),
	dust = require('dustjs-linkedin'), 
	cons = require('consolidate'),
	routes = require('./routes');

listen({
	'noWorkers': 3,
	'createServer': require('http').createServer,
	'app': app,
	'port': 8080,
	'monPort': 8081,
	'configureApp': function(app){

		app.engine('dust', cons.dust);

		app.configure(function(){

			app.set('template_engine', 'dust');
			app.set('domain', 'localhost');
			app.set('views', __dirname + '/views');
			app.set('view engine', 'dust');
			app.use(express.favicon());
			app.use(express.logger('dev'));
			app.use(express.bodyParser());
			app.use(express.methodOverride());
			app.use(express.cookieParser('wigglybits'));
			app.use(express.session({ 
				'secret': 'whatever', 
				'store': store 
			}));
			app.use(express.session());
			app.use(app.router);
			app.use(express.static(path.join(__dirname, 'public')));

			//middleware
			app.use(function(req, res, next){

				if(req.session.user){
					req.session.logged_in = true;
				}

				res.locals.message = req.flash();
				res.locals.session = req.session;
				res.locals.q = req.body;
				res.locals.err = false; 
				
				next();
			});
		});

		app.configure('development', function(){
			app.use(express.errorHandler());
		});

		app.locals.inspect = util.inspect;
		app.get('/', routes.index);

		return app;
	},
	'debug': {
		'webPort': 8082,
		'saveLiveEdit': true
	},
	'cache': {
		'enable': true,
		'mode': 'master'
	},
	'gc': {
		'monitor': true
	},
	'maxAge': 30,//1 minute, just to see how the workers get killed!
	'heartbeatInterval': 5000
})
.then(function(resolve){

	require('../lib/status').register('worker', function(){
		return process.pid;
	});

	if(resolve.master){ //this means all workers have been warmed up!

		var request = require('request'),
		_ = require('underscore');

		(function round(){

			_.each(_.range(0, 20), function(ith){

				request.get('http://localhost:8080', function(err, response, body){
					
					if(err || response.statusCode !== 200){
						console.log('[err:%j] response:%j and body:%s', err, response, body);
					}
				});
			});

			setTimeout(round, 1000);

		})();
	}
})
.otherwise(function(error){

	console.trace(error);
});
