'use strict';

var util = require('util');
	
var increment = 0,
	writer = function writer(conn){

		var writerOfConn = conn.writerOfConn || (function createWriter(){

			var buffer = [],
				directWriter = {
			
					'write': function write(message){

						if(!conn.write(message + '\r\n')){//kernel buffer cannot hold further

							conn.writerOfConn = bufferWriter;

							conn.once('drain', function(){//wait till 'drain' event and write access open

								conn.writerOfConn = directWriter;
								
								while(buffer.length){

									directWriter.write(buffer.shift());
								}
							});
						}
					}
				},

				bufferWriter = {

					'write': function write(message){

						buffer.push(message);
					}
				};

			return directWriter;
		})();

		return writerOfConn;
	};

module.exports = {
	
	'domainPath': process.env.CACHE_DOMAIN_PATH || './cluster-cache-domain',
	
	'persistPath': process.env.CACHE_PERSIST_PATH || './cluster-cache-persist',
	
	'status': {
		'success' : '1',
		'failure' : '-1'
	},

	'types': {
		'NS'		: 'ns',
		'GET'		: 'get',
		'SET' 		: 'set',
        'LOCK'		: 'lock',
		'DEL' 		: 'del',
		'ALL' 		: 'all',
		'INSPECT' 	: 'ins',
		'PING'		: 'ping',
		'PONG'		: 'pong'
	},
	
	'serialize': function serialize(object){

		return encodeURIComponent(JSON.stringify(object));
	},
	
	'deserialize': function deserialize(string){

		return JSON.parse(decodeURIComponent(string));
	},
	
	'write': function(conn, message){

		return writer(conn).write(message);
	},
	
	'nextToken': function(){
		
		return [process.pid, increment += 1].join('-');
	},
	
	'changeToken': 'chn'
};


