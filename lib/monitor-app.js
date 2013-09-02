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

	res.send('debugging on its way', 200);
});

//status

//workers

exports.monApp = monApp;