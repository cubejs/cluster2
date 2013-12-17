'use strict';

var request = require('request'),
    should = require('should'),
    fork = require('child_process').fork,
    utils = require('../lib/utils');

describe('Test Pause and Resume the Worker', function (){
    
    var childProc,
        port;
    
    before(function(done){
        
        this.timeout(5000);

        var token = 't-' + Date.now();
        
        utils.pickAvailablePorts(9090, 9190, 2).then(function(ports){
                
                port = ports[0];
                
                childProc = fork(require.resolve('./lib/cluster-pause-resume-runtime.js'), ['--token=' + token], {
                    'env': {'port': port, 'monPort': ports[1]}
                });

                childProc.once('message', function (msg){
                    
                    done(msg.err);
                });
            },
            function (err) { 

                done(err);
            });
    });

    after(function (done){

        childProc.kill('SIGTERM');
        done();
    });

    it('Should pause the worker', function (done){

        this.timeout(5000);
        
        childProc.send({'operation': 'pause'});

        childProc.on('message', function (msg) {
            if (msg.paused) {
                console.log('[paused]');
                request.get({
                        'url': 'http://127.0.0.1:' + port + '/sayHello',
                        'timeout': 4000
                    }, 
                    function (err, res, body) {
                        done(err ? undefined : new Error('should have got error here'));
                    });
            }
        });
    });

    it('should resume the worker', function (done){

        this.timeout(5000);

        childProc.send({'operation': 'resume'});

        childProc.on('message', function (msg){
            if (msg.resumed) {
                console.log('[resumed]');
                request.get('http://127.0.0.1:' + port + '/sayHello', function (err, res, body){
                    
                    res.statusCode.should.equal(200);
                    body.should.equal('hello');

                    done(err);
                });
            }
        });
    });
});
