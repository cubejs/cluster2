cubejs-cluster2
===============

This is a completely overhaul, not expected to be backward compatible, but the features should cover the most popular while some changes are on their way:

## simplification

You'll see that we've simplified the api a great deal, the listen method takes no arguments at all, and all dancing parts could be injected through the construation.
That's based on the adoption of Promise A+ (when.js). 
You'll also find redundant features like: multiple app/port support, ecv on workers removed, to keep code clean.

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
require('cluster/cache').use('cache-name', {
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

.unwatch('cache-key-1', watching);//stop watching
