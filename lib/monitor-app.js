'use strict';

var express = require('express'),
	when = require('when'),
	path = require('path'),
	ejs = require('ejs'),
	fs = require('graceful-fs'),
	_ = require('underscore');

var monApp = express(),
	masterPromise = require('./master.js').master;

//the monitor app should support the following:

//debug

monApp.use('/scripts', express.static(path.join(__dirname, './public/scripts')));
monApp.use('/stylesheets', express.static(path.join(__dirname, './public/stylesheets')));
monApp.engine('.ejs', require('ejs').__express);
monApp.set('views', path.join(__dirname, './public/views'));
monApp.set('view engine', 'ejs');

var debugMiddleware = exports.debugMiddleware = function(req, res, next){

	if(req.url !== '/debug'){
		next();
	}

	//the debug flow is as the following:
	//app view accepts debug request, and we call master#debug to start
	//app view shows the debug as preparing till we hear 'debug-inspector' event from the master
	//app view shows the inspector's url for user to go to
	//if it's debugging live, the worker is still running and debug is started as well
	//otherwise the debugging fresh, the worker won't start till user comes back to the app view and 'resume' the debug (after he/she puts all the breakpoints needed)
	//user could continue the debug till the app view accepts 'debug-finshed' request and propagate this event to the master

	exports.io.sockets.on('connection', function (socket) {

		socket.on('debug', function(pid){

			masterPromise.then(function(master){

				socket.once('debug-started', function(){

					master.emitter.emit('debug-started', 'master');
				});

				socket.once('debug-finshed', function(){

					master.emitter.emit('debug-finished', 'master');
				});

				master.emitter.once('debug-inspector', function(inspectorUrl){

					socket.emit('debug-inspector', pid, inspectorUrl);
				});

				master.debug(pid);
			});
		});

		function workers(){
			
			masterPromise.then(function(master){
				var pids = _.keys(master.slaves),
					statuses = {};

				var promises = _.map(master.status.statuses(), function(status){

					return master.status.getStatus(status);
				});

				when.all(promises)
					.then(function(statusesOfWorkers){

						_.each(statusesOfWorkers, function(statusOfWorkers){

							_.each(statusOfWorkers, function(statusOfWorker){

								statuses[statusOfWorker.name] = statuses[statusOfWorker.name] || {};
								statuses[statusOfWorker.name][statusOfWorker.pid] = statusOfWorker.status;
							});
						});

						fs.readFile(path.join(__dirname, '/public/views/workers.ejs'), {
								'encoding': 'utf-8'
							}, 
							function(err, read){

								var html = ejs.render(read, {
											'pids': pids,
											'statuses': _.map(statuses, function(v, k){
													v.name = k;
													return v;
												})
										});
								
								console.log('html:' + html);

								socket.emit('workers', {
									'view': 'html',
									'html': html 
								});
						});
					});
				});
			setTimeout(workers, 3000);//everyone 3s
		};

		workers();
	});

	res.render('index', {

	});
};

monApp.use(debugMiddleware);

exports.monApp = monApp;

exports.monCreateServer = function createServer(app){

	var server = require('http').createServer(app);

	exports.io = require('socket.io').listen(server);

	return server;
};
