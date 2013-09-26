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
	}
	'heartbeatInterval': 5000 //heartbeat rate
})
.then(function(resolved){
   //cluster started
   //resolved is an object which embeds server, app, port, etc.
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

emitter.emit('event', null, 'arg0', 'arg1');
//the 'null' value above defaults to the default target of the event
//it varies in master and worker runtime, in master it's the same as saying
emitter.emit('event', ['self'].concat(_.map(cluster.workers, function(w){return w.process.pid;})), 'arg0', 'arg1');
//as this indicates, the master's emit target by default is everybody, master itself and all active workers
//and in worker runtime, the null value is intepreted as worker itself and master
emitter.emit('event', ['self', 'master'], 'arg0', 'arg1');

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

## robustness

This is sth we learned given the real experience of a node.js application, workers do get slower, whether that's memory leak, or GC becomes worse, it's easier to prepare
than to avoid. So as a step forward from the previous 'death watch', we're now proactively collecting performance statistics and to decide it a worker could be ended 
before it gets slow.

## caching

This is as exciting as debugging, it allows workers to share computation results, watch over changes, in a fast and reliable manner.
We tried work delegation to master once, and found it error-prone and difficult to code against, caching makes things so much simpler, using domain socket, so much faster.
The atomic getOrLoad syntax makes sharing efficient, running cache manager as another worker and persistence support make it disaster recoverable.
It's like having a memcached process, only this is node, and you can debug it too.

* **`cache`** 

```javascript
require('cluster2/cache').use('cache-name', {
  'persist': true,//default false
  'expire': 60000 //in ms, default 0, meaning no expiration
})
.then(function(cache){
//the cache is the major api cluster application could then interact with
//the cache values are the same accross the entire worker process
//'cache-name' is a namespace, #use will create such namespace if yet exists
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
    'leaveIfNotNull': false,//default false, which allows set to overwrite existing values, use true for the atomic getAndLoad
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
