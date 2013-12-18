'use strict';

var express = require('express'),
	cluster = require('cluster'),
	when = require('when'),
	path = require('path'),
	ejs = require('ejs'),
	fs = require('graceful-fs'),
	_ = require('underscore');

var logger = function logger(){
		
		if(!_.isFunction(process.getLogger)){
			return {
				'info': _.bind(console.log, console),
				'debug': _.bind(console.log, console)
			};
		}

		return process.getLogger(__filename);
	},
	monApp = express(),
	emitter = require('cluster-emitter'),
	status = require('cluster-status');

//the monitor app should support the following:

//debug
var debugMiddleware = exports.debugMiddleware = function(req, res, next){

	if(req.url === '/help'){

		return res.sendfile(path.join(__dirname, './public/images/live-debugging.png'));
	}

	if(req.url === '/deps'){

		require('./utils').npmls
			.then(function(deps){
				res.type('json').send(deps);
			})
			.otherwise(function(error){
				res.send(500);
			});

		return;
	}

	if(req.url !== '/debug'){
		
		return next();
	}

	logger().debug('[monitor][index] renders');
	
	res.render('index', {
		
	});
};

monApp.use('/scripts', express.static(path.join(__dirname, './public/scripts')));
monApp.use('/stylesheets', express.static(path.join(__dirname, './public/stylesheets')));
monApp.engine('.ejs', require('ejs').__express);
monApp.set('views', path.join(__dirname, './views'));
monApp.set('view engine', 'ejs');
monApp.use(debugMiddleware);

exports.monApp = monApp;

exports.monCreateServer = function createServer(app){

	var server = require('http').createServer(app),
		io = require('socket.io').listen(server, {'log': false}),
		debugging = undefined,
		inspector = null,
		state = null,
		statuses = {},
		sockets = [],
		pauses = {};//all of these vars are now scoped in monCreateServer to make unique

	logger().info('[monitor] server started');

	var workers = _.once(function tick(){

		var pids = _.map(cluster.workers, function(w){
			return w.process.pid;
		});

		logger().debug('[monitor][workers] pids:%j', pids);

		when.map(status.statuses(), function(s){

				return status.getStatus(s);
			})
			.then(function(statusesOfWorkers){

				logger().debug('[monitor][workers] statusesOfWorkers:%j', statusesOfWorkers);

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

				_.each(sockets, function(socket){

					if(_.isEmpty(_.difference(socket.knownPids, pids)) && _.isEmpty(_.difference(pids, socket.knownPids))){
						
						logger().debug('[monitor][workers] emits status changes:%j', arrOfStatues);
						socket.emit('status-change', pids, arrOfStatues);
					}
					else{

						logger().debug('[monitor][workers] detects workers changed:%j from:%j', pids, socket.knownPids);
						socket.knownPids = pids;//update pids

						fs.readFile(path.join(__dirname, '/views/workers.ejs'), {
								'encoding': 'utf-8'
							}, 
							function(err, read){

								var html = ejs.render(read, {
											'pids': pids,
											'debugging': debugging,
											'inspector': inspector,
											'state': state,
											'statuses': arrOfStatues,
											'pauses': pauses
										});

								logger().debug('[monitor][workers] renders workers view:%s', html);
								socket.emit('workers', {
									'view': 'html',
									'html': html 
								});
						});
					}
				});
			});

		setTimeout(tick, 1000);//everyone 1s
	});

	var watchings = [],
		watchExists = function watchExists(usr, namespace){

			if(_.contains(watchings, namespace)){
				return;
			}

			watchings.push(namespace);
			usr.watch(namespace, null, function(value, key){

				logger().debug('[monitor][cache][%s] detects change of:%s', namespace, key);
				usr.inspect(namespace, key).then(function(status){
					
					logger().debug('[monitor][cache][%s] emits cache-changed event over websocket', namespace);
					_.invoke(sockets, 'emit', 'cache-changed', namespace, key, status[0], status[1], status[2]);
				});
			});
		},
		watchFresh = _.once(function(usr){

			usr.watch('', null, function(value, namespace){

					logger().info('[monitor][cache] detects new namespace:%s', namespace);
					fs.readFile(path.join(__dirname, '/views/caches.ejs'), {
							'encoding': 'utf-8'
						}, 
						function(err, read){

							var html = ejs.render(read, {
										'namespace': namespace,
										'caches': []
									});

							logger().debug('[monitor][cache][%s] renders empty caches view', namespace);
							_.invoke(sockets, 'emit', 'caches', {
								'view': 'html',
								'namespace': namespace,
								'html': html 
							});
					});

					watchExists(usr, namespace);
				});
		});

	function caches(){

		require('cluster-cache').user.use().then(function(usr){

			usr.ns()
				.then(function(namespaces){

					logger().debug('[monitor][cache] existing namespaces:%s', namespaces);

					_.each(namespaces || [], function(namespace){

						watchExists(usr, namespace);

						usr.keys(namespace).then(function(keys){

							logger().debug('[monitor][cache][%s] existing keys:%s', namespace, keys);

							when.map(keys, function(k){

									return usr.inspect(namespace, k);
								})
								.then(function(values){

									fs.readFile(path.join(__dirname, '/views/caches.ejs'), {
											'encoding': 'utf-8'
										}, 
										function(err, read){

											var html = ejs.render(read, {
														'namespace': namespace,
														'caches': _.map(keys, function(k, i){
															return {
																'key': k,
																'value': values[i][0],
																'persist': values[i][1],
																'expire': values[i][2]
															};
														})
													});

											logger().debug('[monitor][cache][%s] inspected:\n%s\nand renders caches view:\n%s', JSON.stringify(values), namespace, html);
											_.each(sockets, function(socket){
												if(!_.contains(socket.namespaces, namespace)){

													socket.namespaces.push(namespace);
													socket.emit('caches', {
														'view': 'html',
														'namespace': namespace,
														'html': html 
													});
												}
											})
									});
								});
						});
					});
				});

			watchFresh(usr);
		});
	}

	//the debug flow is as the following:
	//app view accepts debug request, and we call master#debug to start
	//app view shows the debug as preparing till we hear 'debug-inspector' event from the master
	//app view shows the inspector's url for user to go to
	//if it's debugging live, the worker is still running and debug is started as well
	//otherwise the debugging fresh, the worker won't start till user comes back to the app view and 'resume' the debug (after he/she puts all the breakpoints needed)
	//user could continue the debug till the app view accepts 'debug-finshed' request and propagate this event to the master

	io.sockets.on('connection', function (socket) {

		logger().info('[monitor] accepted new websocket and sending workers & caches view');

		socket.knownPids = [];
		socket.namespaces = [];
		sockets.push(socket);

		workers();

		caches();

		socket.once('debug', function debug(pid){

			debugging = pid;
			inspector = null;
			state = null;

			logger().info('[debug] %s requested', pid);

			socket.once('debug-started', function(){

				state = 'debug-started';
				emitter.to(['master']).emit('debug-started');
				logger().info('debug:%s start requested', pid);
			});

			socket.once('debug-finished', function(){

				debugging = null;
				inspector = null;
				state = 'debug-finshed';

				emitter.to(['master']).emit('debug-finished');
				logger().info('[debug] %s finished', pid);
				socket.once('debug', debug);
			});

			emitter.once('debug-inspector', function(inspectorUrl){

				inspector = inspectorUrl;
				logger().info('[debug] %s inspector ready:%s', pid, inspector);
				socket.knownPids = [];//force an update
			});

			emitter.to(['master']).emit('debug', pid);
		});

		socket.on('pause', function pause(pid){

			if(!pauses[pid]){
				pauses[pid] = true;
				emitter.to(['master']).emit('pause', pid);
			}
		});

		socket.on('resume', function resume(pid){

			if(pauses[pid]){
				emitter.to(['master']).emit('resume', pid);
				delete pauses[pid];
			}
		});

		socket.once('close', function close(){

			sockets = _.without(sockets, socket);
		});
	});

	return server;
};
