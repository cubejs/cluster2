/*
 * GET home page.
 */
var bad = ['bad'];
var oneKb = []

for(var i = 0; i < 1000; i += 1){
	oneKb[i] = '-'
}

oneKb = oneKb.join('');

console.log('[1kb] %s', oneKb);

exports.index = function(req, res){

	var cache = require('cluster-cache').use('template_engine');

	res.locals.session = req.session;

	cache.get('engine', function(){
		return req.app.settings.template_engine;
	})
	.then(function(engine){

    	bad.push('[bad]' + oneKb + Date.now())//till it's too big to fit
		res.render('index', {
			'title': 'Express with ' + engine
		});
	});
};
