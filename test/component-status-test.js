// 'use strict';

// var componentStatus = require('../lib/component-status.js').componentStatus,
// 	should = require('should');

// describe('component-status', function(){

// 	describe('#register', function(){

// 		it('should allow registration', function(done){

// 			componentStatus.register('health', function(params){
// 				return 'i am healthy\n';
// 			});

// 			componentStatus.reducer('health', function(memoize, health){
// 				return {
// 					value : memoize && health
// 				};
// 			});

// 			componentStatus.getComponents().should.include('health');

// 			componentStatus.getStatus('health', {
// 				done : function(status){
// 					status.should.be.ok;
// 					done();	
// 				}
// 			});
// 		});

// 		it('should allow update of status of the updater is given', function(done){
// 			var trafficEnabled = true;
// 			componentStatus.register('traffic-enabled', 
// 				function(params){
// 					return trafficEnabled;
// 				}, 
// 				'array', 
// 				function(params, value){
// 					trafficEnabled = value;
// 				});

// 			componentStatus.getStatus('traffic-enabled', {
// 				'done': function(status){
// 					status.should.be.ok;
// 					status[0].should.be.ok;

// 					componentStatus.setStatus('traffic-enabled', {
// 						'done': function(){
							
// 							componentStatus.getStatus('traffic-enabled', {
// 								'done': function(status){

// 									status.should.be.ok;
// 									status[0].should.not.be.ok;

// 									done();
// 								}
// 							});
// 						}
// 					}, false);
// 				}
// 			});
// 		});

// 		it('should allow update of status of the updater is given from worker', function(done){
// 			var trafficEnabled = true;
// 			componentStatus.register('traffic-enabled', 
// 				function(params){
// 					return trafficEnabled;
// 				}, 
// 				'array', 
// 				function(params, value){
// 					trafficEnabled = value;
// 				});

// 			componentStatus.getStatus('traffic-enabled', {
// 				'worker': process.pid,
// 				'done': function(status){
// 					status.should.be.ok;
// 					status[0].should.be.ok;

// 					componentStatus.setStatus('traffic-enabled', {
// 						'worker': process.pid,
// 						'done': function(){
							
// 							componentStatus.getStatus('traffic-enabled', {
// 								'worker': process.pid,
// 								'done': function(status){

// 									status.should.be.ok;
// 									status[0].should.not.be.ok;

// 									done();
// 								}
// 							});
// 						}
// 					}, false);
// 				}
// 			});
// 		});
// 	});
