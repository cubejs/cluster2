cubejs-cluster2
===============

This is a completely overhaul, not expected to be backward compatible, but the features should cover the most popular while some changes are on their way:

# simplification

You'll see that we've simplified the api a great deal, the listen method takes no arguments at all, and all dancing parts could be injected through the construation.
That's based on the adoption of Promise A+ (when.js). 
You'll also find redundant features like: multiple app/port support, ecv on workers removed, to keep code clean.

# debug

Ever imagined debugging to be simpler? Here's the good news, we've carefully designed the debugging process from the ground up of the new cluster.
With integration with ECV, worker lifecycle management, node-inspector, and bootstrap + websocket debug app (middleware to be exact). You're now
able to debug any running worker a few clicks away, same applies for a newly forked one.

# robustness

This is sth we learned given the real experience of a node.js application, workers do get slower, whether that's memory leak, or GC becomes worse, it's easier to prepare
than to avoid. So as a step forward from the previous 'death watch', we're now proactively collecting performance statistics and to decide it a worker could be ended 
before it gets slow.

# caching

This is as exciting as debugging, it allows workers to share computation results, watch over others, in a fast and reliable manner.
We tried work delegation to master once, and found it error-prone and difficult to code against, caching makes things so much simpler, using domain socket, so much faster.
The atomic getOrLoad syntax makes sharing efficient, running cache manager as another worker and persistence support make it disaster recoverable.
It's like having a memcached process, only this is node, and you can debug it too.
