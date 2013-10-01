/*
 * GET home page.
 */

exports.index = function(req, res){
	
	var cache = require('../../lib/cache').use('template_engine');
	
	res.locals.session = req.session;

	cache.get('engine', function(){
		return req.app.settings.template_engine;
	})
	.then(function(engine){	

		res.render('index', { 
			'title': 'Express with ' + engine 
		});
	});
};