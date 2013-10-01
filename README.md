cubejs-cluster2
===============

This is a completely overhaul, not expected to be backward compatible, but the features should cover the most popular while some changes are on their way:

## simplification

You'll see that we've simplified the api a great deal, the listen method takes no arguments at all, and all dancing parts could be injected through the construation.
That's based on the adoption of Promise A+ (when.js). 
You'll also find redundant features like: multiple app/port support, ecv on workers removed, none cluster mode removed, to keep code clean.

* **`cluster`**

```javascript
var listen = require('cluster2').listen;

listen({

  'noWorkers': 1, //default number of cpu cores
	'createServer': require('http').createServer,
	'app': app, //your express app
	'port': 9090, //express app listening port
	'monPort': 9091, //monitoring app listening port
  'configureApp': function(app){
    //register your routes, middlewares to the app, must return value or promise
    return app;
  },
  'warmUp': function(){
    //warm up your application, must return value or promise
    return true;
  }
	'debug': { //node-inspector integration
		'webPort': 9092, //node-inspector web listening port
		'saveLiveEdit': true
	},
	'ecv': {
	  'mode': 'control',
	  'root': '/ecv'
	},
  'cache': {
    'enable': true, //check cache section
    'mode': 'standalone' //default creates a standalone worker specific to run as cache manager, otherwise use master to run
  },
  'gc': {
    'monitor': true,  //will reflect the gc (incremental, full) in heartbeat, this conflicts with socket.io somehow
    'idle-noitification': false, //for performance reason, we'll disable node idle notification to v8 by default
    'explicit': false //yet impl, meant to expose gc() as a global function
  },
	'heartbeatInterval': 5000 //heartbeat interval in MS
})
.then(function(resolved){
   //cluster started
   //resolved is an object which embeds server, app, port, etc.
   //this is quite useful, you must understand that both master and workers will get to here (due to fork)
   //if it's worker, it means the warmup of that worker process has been finished (and listening already happen of course)
   //if it's master, it means all of the workers (noWorkers) asked to be created initially have all been warmed up
   //and implicitly, the ecv if enabled, will return 200 to whoever polls for the status
})
.otherwise(function(error){
  //cluster start error
});
//the major change is the return of promise and the much simplified #listen (as all options pushed to construction)

```

## emitter

Cluster used to be an emitter itself, which isn't very much helpful, and forced event register/emit to be delayed till the cluster instance is created.
Even if it's created, accessing the instance from different modules require the instance to be passed down, or global, neither looks appealing.
The new cluster-emitter is designed to work with cluster not cluster2 instance at all (in fact, we eliminated the cluster2 instance as you see the api above)
The emitter also makes communications between worker & master (or reverse) as simple as a normal EventEmitter.

```javascript
var emitter = require('cluster2/emitter');

emitter.on('event', function callback(){
	//an event callback
});

emitter.once('event', function callbackOnce(){
	//another event callback
});

emitter.removeListener('event', callback);
emitter.removeListener('event', callbackOnce);
emitter.removeAllListeners('event');

emitter.emit('event', 'arg0', 'arg1');
//it varies in master and worker runtime, in master it's the same as saying
emitter.emitTo(['self'].concat(_.map(cluster.workers, function(w){return w.process.pid;})), ['event', 'arg0', 'arg1']);
//as this indicates, the master's emit target by default is everybody, master itself and all active workers
//and in worker runtime, it's intepreted as worker itself and master
emitter.emitTo(['self', 'master'], ['event', 'arg0', 'arg1']);
//you don't have to use the different `emitTo` method unless you have a different targets set from the default explained above.
//but in cause you need, it's also simplified as:
emitter.to(['master']).emit('event', 'arg0', 'arg1');
//use to method to scope the target differently, the value should be an array of pids, or 'master', or 'self'

```

## ecv

ECV is a preserved feature, but we've simplified that too. Most of the use cases we've seen doesn't really need an ECV for each worker process, in fact
that could be very confusing. To let tools view the cluster as an entirety, ECV is to run only in master runtime, it still supports the 'monitor' vs. 'control' mode.

```javascript

//ecv control could be used as such
var enable = require('cluster2/ecv').enable;

enable(app);

//more use cases just let cluster2 enables it by passing configurations to the #listen
var listen = require('cluster2').listen;

listen({

  'noWorkers': 1, //default number of cpu cores
	'createServer': require('http').createServer,
	'app': app,
	'port': 9090,
	'monPort': 9091,
	'debug': { //node-inspector integration
		'webPort': 9092,
		'saveLiveEdit': true
	},
	'ecv': {
	  'mode': 'control',//could be 'monitor' or 'control'
	  'root': '/ecv',
      'markUp': '/ecv/markUp',
      'markDown': '/ecv/markDown'
	}
	'heartbeatInterval': 5000 //heartbeat rate
})
```

## debug

Ever imagined debugging to be simpler? Here's the good news, we've carefully designed the debugging process from the ground up of the new cluster.
With integration with ECV, worker lifecycle management, node-inspector, and bootstrap + websocket debug app (middleware to be exact). You're now
able to debug any running worker a few clicks away, same applies for a newly forked one.

`http://localhost:9091/debug` (change host, port to your configured values) `debug` route is what we added as a middleware to the monitor app given. It presents an insight of the running workers, their health; in addition, the cluster cache status. You could hover on a worker pid to request a node-inspector based debug, the control flow is described at `__dirname/lib/public/images/live-debugging.png`.

The experience is designed to be the same across different environments, whether dev, qa, or even production, the same debugging flow and mechanism would make diagnostics much more effective.

## deps

This is a preserved feature of cluster2, it simply list the npm ls result and give it under `http://localhost:9091/deps` route, which looks like the following.

```javascript
{
  "name": "cluster2",
  "version": "0.5.0",
  "dependencies": {
    "underscore": {
      "version": "1.4.4",
      "from": "underscore@~1.4.4"
    },
    "usage": {
      "version": "0.3.8",
      "from": "usage@~0.3.8",
      "dependencies": {
        "bindings": {
          "version": "1.1.1",
          "from": "bindings@1.x.x"
        }
      }
    },
    "when": {
      "version": "2.3.0",
      "from": "when@~2.3.0"
    },
    "graceful-fs": {
      "version": "2.0.1",
      "from": "graceful-fs@~2.0.0"
    },
    "gc-stats": {
      "version": "0.0.1",
      "from": "gc-stats@~0.0.1",
      "resolved": "https://registry.npmjs.org/gc-stats/-/gc-stats-0.0.1.tgz"
    },
    "bignumber.js": {
      "version": "1.1.1",
      "from": "bignumber.js@~1.1.1"
    }
    //... more dependencies not shown
  }
}
```

## robustness

This is sth we learned given the real experience of a node.js application, workers do get slower, whether that's memory leak, or GC becomes worse, it's easier to prepare
than to avoid. So as a step forward from the previous 'death watch', we're now proactively collecting performance statistics and to decide it a worker could be ended 
before it gets slow. You could see the simple heurstic we put at `__dirname/lib/utils.js` # `assertOld` function. You can always overwrite this based on your application's characteristics, but this gives a good starting point based on heartbeat collected stats.

```javascript

var peaks = {},
  MAX_LIFE = 3600 * 24 * 3;//3 days

exports.assertOld = function assertOld(heartbeat){

    var pid = heartbeat.pid,
      uptime = heartbeat.uptime,
        currTPS = heartbeat.tps || (heartbeat.transactions * 1000 / heartbeat.cycle);

    if(uptime > MAX_LIFE){ //a conservative check
      return true;
    }

    if(currTPS <= 2){//intelligent heuristic, TPS too low, no good for sampling as the 1st phase.
        return false;
    }

    var peak = peaks[pid] = peaks[pid] || {
            'tps': currTPS,
            'cpu': heartbeat.cpu,
            'memory': heartbeat.memory,
            'gc': {
                'incremental': heartbeat.gc.incremental,
                'full': heartbeat.gc.full
            }
        };//remember the peak of each puppet

    if(currTPS >= peak.tps){
        peak.tps = Math.max(heartbeat.tps, peak.tps);
        peak.cpu = Math.max(heartbeat.cpu, peak.cpu);
        peak.memory = Math.max(heartbeat.memory, peak.memory);
        peak.gc.incremental = Math.max(heartbeat.gc.incremental, peak.gc.incremental);
        peak.gc.full = Math.max(heartbeat.gc.full, peak.gc.full);
    }
    else if(currTPS < peak.tps * 0.9 //10% tps drop
        && heartbeat.cpu > peak.cpu
        && heartbeat.memory > peak.memory
        && heartbeat.gc.incremental > peak.gc.incremental
        && heartbeat.gc.full >= peak.gc.full){//sorry, current gc.full is usually zero
        
        return true;
    }

    return false;
};
```

Apart from the above mentioned proactive collection, we noticed another subtle issue in practice. When a worker is dead, its load will be distributed to the rest of alives certainly, that adds some stress to the alives, but when more than one worker died at the same time, the stress could become problem.
Therefore, to prevent such from happening when worker is marked to be replaced, we made it a FIFO, further explained in `__dirname/lib/utils` # `deathQueue` function. Its purpose is to guarantee that no more than one worker could commit suicide and be replaced at the same time.

```javascript

var tillPrevDeath = null;

exports.deathQueue = function deathQueue(pid, emitter, success){

  assert.ok(pid);
  assert.ok(emitter);
  assert.ok(success);

  var tillDeath = when.defer(),
    afterDeath = null,
    die = function(){

      var successor = success();

      //when successor is in place, the old worker could be discontinued finally
      emitter.once(util.format('worker-%d-listening', successor.process.pid), function(){

        emitter.emit('disconnect', ['master', pid], pid);
                tillDeath.resolve(pid);

        if(tillPrevDeath === afterDeath){//last of dyingQueue resolved, clean up the dyingQueue
                    tillPrevDeath = null;
        }
      });
    };

  if(!tillPrevDeath){//1st in the dying queue,
    afterDeath = tillPrevDeath = timeout(tillDeath.promise, 60000);//1 min
    die();
  }
  else{
    afterDeath = tillPrevDeath = timeout(tillPrevDeath, 60000).ensure(die);
  }
};
```

## caching

This is as exciting as debugging, it allows workers to share computation results, watch over changes, in a fast and reliable manner.
We tried work delegation to master once, and found it error-prone and difficult to code against, caching makes things so much simpler, using domain socket, so much faster.
The atomic getOrLoad syntax makes sharing efficient, running cache manager as another worker and persistence support make it disaster recoverable.
It's like having a memcached process, only this is node, and you can debug it too.

* **`cache`** 

```javascript
var cache = require('cluster2/cache').use('cache-name', {
  'persist': true,//default false
  'expire': 60000 //in ms, default 0, meaning no expiration
});

```
* **`keys`**

```javascript
var cache;//assume the cache is in use as above

cache.keys({
  'wait': 100//this is a timeout option
})
.then(function(keys){
//the keys resolved is an array of all cached keys:string[] from the cache-manager's view
});

//to use the cache, we assume u've started the cluster2 with caching enabled, and you can select how cache manager should be run
listen({

  'noWorkers': 1, //default number of cpu cores
	'createServer': require('http').createServer,
	'app': app,
	'port': 9090,
	'monPort': 9091,
	'debug': { //node-inspector integration
		'webPort': 9092,
		'saveLiveEdit': true
	},
	'ecv': {
	  'mode': 'control',
	  'root': '/ecv'
	},
    'cache': {
      'enable': true,//true by default
      'mode': 'standalone'//as a standalone worker process by default, otherwise will crush with the master process
    }
	'heartbeatInterval': 5000 //heartbeat rate
})
```
* **`get`**

```javascript
var cache;

cache.get('cache-key-1', //key must be string
  function(){
    return 'cache-value-loaded-1'; //value could be value or promise
  },
  {
    'wait': 100//this is a timeout option
  })
  .then(function(value){
    //the value resolved is anything already cached or the value newly loaded
    //note, the loader will be called once and once only, if it failed, the promise of get will be rejected.
  })
  .otherwise(function(error){
  
  });
```
* **`set`**

```javascript
var cache;

cache.set('cache-key-1', //key must be string
  'cache-value-loaded-1', //value could be any json object
  {
    'leaveIfNotNull': false,//default false, which allows set to overwrite existing values
    'wait': 100
  })
  .then(function(happens){
    //the happens resolved is a true/false value indicating if the value has been accepted by the cache manager
  })
  .otherwise(function(error){
  
  });
```
* **`del`**

```javascript
var cache;

cache.del('cache-key-1', //key must be string
  {
    'wait': 100//this is a timeout option
  })
  .then(function(value){
    //the old value deleted
  });
```
* **`watch`**

```javascript
var cache;

cache.watch('cache-key-1', //key must be string or null (indicating watch everything)
  function watching(value, key){
    //this is a callback which will be called anytime the associatd key has an updated value
  });
```
* **`unwatch`**

```javascript
var cache;

cache.unwatch('cache-key-1', watching);//stop watching
```

## status

This is a helpful piece evolved from the current cluster2, which is to allow applications to easily register status of any interest.
It allows each worker to register its own state, master would automatically aggregate all states from active workers.
It works nicely with our monitor capability (via debug middleware)

* **`register`**

```javascript
require('cluster2/status')
  .register('status-name',
    function(){
      return 'view';//view function
    },
    function(value){
      //update function
    });
```

* **`statuses`**

```javascript
require('cluster2/status')
  .statuses(); //return names of registered statuses
```

* **`getStatus`**

```javascript
require('cluster2/status')
  .getStatus('status-name')
  .then(function(status){
    //got status
  })
  .otherwise(function(error){
    //err
  });
```

* **`setStatus`**

```javascript
require('cluster2/status')
  .setStatus('status-name',
    'value')
  .then(function(set){
    //set or not
  })
  .otherwise(function(error){
    //err
  });
```
