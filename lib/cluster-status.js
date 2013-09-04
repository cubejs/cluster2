'use strict';

//status is to allow workers to expose their important state to master, and possibly let monitor app show them clearly in its views

var when = require('when'),
	timeout = require('when/timeout'),
	cluster = require('cluster'),
	util = require('util'),
	_ = require('underscore');

exports.status = function(emitter){

	var registry = {};

	emitter.on('new-status', function(name, pid, view, update){

		registry[name] = registry[name] || [];
		registry[name].push({
			'pid': pid,
			'view': view,
			'update': update
		});
	});

	emitter.on('del-status', function(name, pid){

		registry[name] = _.filter(registry[name], function(r){
			return r.pid !== pid;
		});
	});

	cluster.on('disconnect', function(worker){

		var pid = worker.process.pid;

		_.each(registry, function(arr, name){

			registry[name] = _.filter(arr, function(r){

				return r.pid !== pid;
			});
		});

		console.log('status auto updated after worker:' + JSON.stringify(registry));
	});

	return {

		'register': function register(name, view, update){

			emitter.emit('new-status', ['master', 'self'], name, process.pid, view, update);

			emitter.on(util.format('get-status-%s', name), function(echo){

				emitter.emit(echo, ['master', 'self'], view());
			});

			emitter.on(util.format('set-status-%s', name), function(value, echo){

				emitter.emit(echo, ['master', 'self'], update(value));
			});
		},

		'unregister': function unregister(name){

			emitter.emit('del-status', ['master', 'self'], name, process.pid);

			emitter.removeListener(util.format('get-status-%s', name));

			emitter.removeListener(util.format('set-status-%s', name));
		},

		'statuses': function(){

			return _.keys(registry);
		},

		'getStatus': function getStatus(name, wait){

			return when.all(_.map(registry[name], function(r){

					var got = when.defer(),
						echo = util.format('get-status-%s-%d-%d', name, r.pid, Date.now());

					emitter.once(echo, function(status){

						got.resolve({
							'pid': r.pid,
							'name': name,
							'status': status
						});
					});

					emitter.emit(util.format('get-status-%s', name), [r.pid], echo);

					return timeout(got.promise, wait || 1000);
				}));
		},

		'setStatus': function setStatus(name, value, wait){

			return when.all(_.map(registry[name], function(r){

					var set = when.defer(),
						echo = util.format('set-status-%s-%d-%d', name, r.pid, Date.now());

					emitter.once(echo, function(status){
						set.resolve({
							'pid': r.pid,
							'name': name,
							'status': status
						});
					});

					emitter.emit(util.format('set-status-%s', name), [r.pid], value, echo);

					return timeout(set.promise, wait || 1000);
				}));
		}
	};
};

