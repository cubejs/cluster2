'use strict';

var express = require('express'),
	when = require('when'),
	path = require('path'),
	ejs = require('ejs'),
	fs = require('graceful-fs'),
	_ = require('underscore');

var logger = process.getLogger(__filename),
	monApp = express(),
	masterPromise = require('./master.js').master;

//the monitor app should support the following:

//debug

monApp.use('/scripts', express.static(path.join(__dirname, './public/scripts')));
monApp.use('/stylesheets', express.static(path.join(__dirname, './public/stylesheets')));
monApp.engine('.ejs', require('ejs').__express);
monApp.set('views', path.join(__dirname, './public/views'));
monApp.set('view engine', 'ejs');

var debugMiddleware = exports.debugMiddleware = function(req, res, next){

	if(req.url === '/help'){
		res.sendfile(path.join(__dirname, './public/views/live-debugging.png'));
		return;
	}

	if(req.url !== '/debug'){
		next();
		return;
	}

	//the debug flow is as the following:
	//app view accepts debug request, and we call master#debug to start
	//app view shows the debug as preparing till we hear 'debug-inspector' event from the master
	//app view shows the inspector's url for user to go to
	//if it's debugging live, the worker is still running and debug is started as well
	//otherwise the debugging fresh, the worker won't start till user comes back to the app view and 'resume' the debug (after he/she puts all the breakpoints needed)
	//user could continue the debug till the app view accepts 'debug-finshed' request and propagate this event to the master

	exports.io.sockets.on('connection', function (socket) {

		var debugging = undefined,
			inspector = null,
			state = null,
			statuses = {},
			knownPids = [],
			debug = function debug(pid){

				debugging = pid;
				inspector = null;
				state = null;

				logger.info('[debug] %s requested', pid);

				masterPromise.then(function(master){

					socket.once('debug-started', function(){

						state = 'debug-started';
						master.emitter.emit('debug-started', ['master']);
						logger.info('debug:%s start requested', pid);
					});

					socket.once('debug-finished', function(){

						debugging = null;
						inspector = null;
						state = 'debug-finshed';

						master.emitter.emit('debug-finished', ['master']);
						logger.info('[debug] %s finished', pid);
						socket.once('debug', debug);
					});

					master.emitter.once('debug-inspector', function(inspectorUrl){

						inspector = inspectorUrl;
						logger.info('[debug] %s inspector ready:%s', pid, inspector);
						knownPids = [];//force an update
					});

					master.debug(pid);
				});
			};

		socket.once('debug', debug);

		function workers(){
			
			masterPromise.then(function(master){
				var pids = _.keys(master.slaves),
					promises = _.map(master.status.statuses(), function(status){
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

						var arrOfStatues = _.map(statuses, function(v, k){
								v.name = k;
								return v;
							});
						if(!_.isEqual(knownPids, pids)){
							
							knownPids = pids;//update pids

							fs.readFile(path.join(__dirname, '/public/views/workers.ejs'), {
									'encoding': 'utf-8'
								}, 
								function(err, read){

									var html = ejs.render(read, {
												'pids': pids,
												'debugging': debugging,
												'inspector': inspector,
												'state': state,
												'statuses': arrOfStatues
											});

									socket.emit('workers', {
										'view': 'html',
										'html': html 
									});
							});
						}
						else{
							socket.emit('status-change', pids, arrOfStatues);
						}
					});
			});
			setTimeout(workers, 1000);//everyone 1s
		};

		workers();

		function caches(){

			masterPromise.then(function(){

				require('./cache-usr.js').user().then(function(usr){

					usr.watch(null, function(key, value){

						usr.inspect(key).then(function(status){
							
							socket.emit('cache-changed', key, status[0], status[1], status[2]);
						});
					});

					usr.keys().then(function(keys){

						when.map(keys, function(k){

								return usr.inspect(k);
							})
							.then(function(values){

								fs.readFile(path.join(__dirname, '/public/views/caches.ejs'), {
										'encoding': 'utf-8'
									}, 
									function(err, read){

										var html = ejs.render(read, {
													'caches': _.map(keys, function(k, i){
														return {
															'key': k,
															'value': values[i][0],
															'persist': values[i][1],
															'expire': values[i][2]
														};
													})
												});

										socket.emit('caches', {
											'view': 'html',
											'html': html 
										});
								});
							});
					});
				});
			});
		}

		caches();
	});

	res.render('index', {

	});
};

monApp.use(debugMiddleware);

exports.monApp = monApp;

exports.monCreateServer = function createServer(app){

	var server = require('http').createServer(app);

	exports.io = require('socket.io').listen(server, {'log': false});

	logger.info('monitor server started');

	return server;
};
