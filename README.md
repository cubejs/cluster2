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

This is as exciting as debugging, it allows workers to share computation results, watch over others, in a fast and reliable manner.
We tried work delegation to master once, and found it error-prone and difficult to code against, caching makes things so much simpler, using domain socket, so much faster.
The atomic getOrLoad syntax makes sharing efficient, running cache manager as another worker and persistence support make it disaster recoverable.
It's like having a memcached process, only this is node, and you can debug it too.

* **`user`** 

```javascript
require('cluster/cache-user').user().then(function(usr){
//the usr is the major api cluster application could then interact with
//the usr is the same accross the entire worker process
});
```
* **`keys`**

```javascript
var usr;//assume the usr has been assigned as above

usr.keys({
  'wait': 100//this is a timeout option
})
.then(function(keys){
//the keys resolved is an array of all cached keys:string[] from the cache-manager's view
});
```
* **`get`**

```javascript
var usr;//assume the usr has been assigned as above

usr.get('cache-key-1', //key must be string
  function(){
    return 'cache-value-loaded-1';
  },
  {
    'persist': false,//default false, otherwise the loaded value will be persisted, if not loaded, the persistence info will be returned
    'expire': 10000,//default null, otherwise it means in how many ms the key/value should be expired if not loaded. 
    'wait': 100//this is a timeout option
  })
  .then(function(value, persist, expire){
    //the value resolved is anything already cached or the value newly loaded
    //note, the loader will be called once and once only, if it failed, the promise of get will be rejected.
  });
```
* **`set`**

```javascript
var usr;//assume the usr has been assigned as above

usr.set('cache-key-1', //key must be string
  'cache-value-loaded-1', //value could be any json object
  {
    'persist': false,
    'expire': 10000,
    'leaveIfNotNull': false,//default false, which allows set to overwrite existing values, use true for the atomic getAndLoad
    'wait': 100
  })
  .then(function(happens){
  //the happens resolved is a true/false value indicating if the value has been accepted by the cache manager
  });
```
* **`del`**

```javascript
var usr;//assume the usr has been assigned as above

usr.del('cache-key-1', //key must be string
  {
    'wait': 100//this is a timeout option
  })
  .then(function(value){
  //the old value deleted
  });
```
* **`watch`**

```javascript
var usr;//assume the usr has been assigned as above

usr.watch('cache-key-1', //key must be string
  function watching(value){
    //this is a callback which will be called anytime the associatd key has an updated value
  });
```
* **`unwatch`**

```javascript
var usr;//assume the usr has been assigned as above

usr.unwatch('cache-key-1', watching);//stop watching

```
* **`makeCopy`**

```javascript
var usr;//assume the usr has been assigned as above

usr.makeCopy();
//this forces the user to keep copy of cache manager whenever a value is loaded, it also watches any change and update the copy automatically
//this option is to make the cache more reliable but could cause consistency problem when the cache manager dies
```
* **`unmakeCopy`**

```javascript
var usr;//assume the usr has been assigned as above

usr.unmakeCopy();
//the opposite as makeCopy, and the default behavior, no copy is kept locally, all queries go to cache manager
//which maximizes the consistency, but availability will be hurt when the cache manager is in the middle over recovery
```
