'use strict';

var util = require('util');
	
var increment = 0,
	writer = function(conn){

		var writerOfConn = conn.writerOfConn || (function(){

			var buffer = [],
				directWriter = {
			
					'write': function write(message){

						if(!conn.write(message + '\r\n')){

							conn.writerOfConn = bufferWriter;
							conn.once('drain', function(){

								conn.writerOfConn = directWriter;
								while(buffer.length && conn.writerOfConn === directWriter){//stop immediately after writer switched again to bufferWriter
									
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
	'domainPath': './cluster-cache-domain',
	'persistPath': './cluster-cache-persist',
	'status': {
		'success' : '1',
		'failure' : '-1'
	},
	'types': {
		'GET' : 'get',
		'SET' : 'set',
		'DEL' : 'del',
		'ALL' : 'all',
		'INSPECT' : 'ins',
		'PING': 'ping',
		'PONG': 'pong'
	},
	'serialize': function serialize(object){

		return JSON.stringify(object);
	},
	'deserialize': function deserialize(string){

		return JSON.parse(string);
	},
	'write': function(conn, message){

		return writer(conn).write(message);
	},
	'nextToken': function(){
		
		return util.format('%d-%d', process.pid, increment += 1);
	},
	'changeToken': 'chn'
};


