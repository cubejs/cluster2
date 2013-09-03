'use strict';

var express = require('express'),
	path = require('path');

var monApp = express(),
	masterPromise = require('./master.js').master;

//the monitor app should support the following:

//debug

monApp.use('/scripts', express.static(path.join(__dirname, './public/scripts')));
monApp.use('/stylesheets', express.static(path.join(__dirname, './public/stylesheets')));
monApp.engine('.ejs', require('ejs').__express);
monApp.set('views', path.join(__dirname, './public/views'));
monApp.set('view engine', 'ejs');

monApp.get('/debug', function(req, res){

	//the debug flow is as the following:
	//app view accepts debug request, and we call master#debug to start
	//app view shows the debug as preparing till we hear 'debug-inspector' event from the master
	//app view shows the inspector's url for user to go to
	//if it's debugging live, the worker is still running and debug is started as well
	//otherwise the debugging fresh, the worker won't start till user comes back to the app view and 'resume' the debug (after he/she puts all the breakpoints needed)
	//user could continue the debug till the app view accepts 'debug-finshed' request and propagate this event to the master

	res.send('debugging on its way', 200);
});

//status

//workers
exports.monCreatServer = function createServer(){

	var server = require('http').createServer(arguments);

	exports.io = require('socket.io').listen(server);

	return server;
};

exports.monApp = monApp;