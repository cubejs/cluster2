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

`http://localhost:9091/debug` (change host, port to your configured values) `debug` route is what we added as a middleware to the monitor app given. It presents an insight of the running workers, their health; in addition, the cluster cache status. You could hover on a worker pid to request a node-inspector based debug, the control flow is described at `__dirname/lib/public/views/live-debugging.png`.

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
    "winston": {
      "version": "0.7.2",
      "from": "winston@~0.7.2",
      "dependencies": {
        "async": {
          "version": "0.2.9",
          "from": "async@0.2.x"
        },
        "colors": {
          "version": "0.6.2",
          "from": "colors@0.6.x"
        },
        "cycle": {
          "version": "1.0.2",
          "from": "cycle@1.0.x"
        },
        "eyes": {
          "version": "0.1.8",
          "from": "eyes@0.1.x"
        },
        "pkginfo": {
          "version": "0.3.0",
          "from": "pkginfo@0.3.x"
        },
        "request": {
          "version": "2.16.6",
          "from": "request@2.16.x",
          "dependencies": {
            "form-data": {
              "version": "0.0.10",
              "from": "form-data@~0.0.3",
              "dependencies": {
                "combined-stream": {
                  "version": "0.0.4",
                  "from": "combined-stream@~0.0.4",
                  "dependencies": {
                    "delayed-stream": {
                      "version": "0.0.5",
                      "from": "delayed-stream@0.0.5",
                      "resolved": "https://registry.npmjs.org/delayed-stream/-/delayed-stream-0.0.5.tgz"
                    }
                  }
                }
              }
            },
            "mime": {
              "version": "1.2.11",
              "from": "mime@~1.2.7"
            },
            "hawk": {
              "version": "0.10.2",
              "from": "hawk@~0.10.2",
              "dependencies": {
                "hoek": {
                  "version": "0.7.6",
                  "from": "hoek@0.7.x"
                },
                "boom": {
                  "version": "0.3.8",
                  "from": "boom@0.3.x"
                },
                "cryptiles": {
                  "version": "0.1.3",
                  "from": "cryptiles@0.1.x"
                },
                "sntp": {
                  "version": "0.1.4",
                  "from": "sntp@0.1.x"
                }
              }
            },
            "node-uuid": {
              "version": "1.4.1",
              "from": "node-uuid@~1.4.0"
            },
            "cookie-jar": {
              "version": "0.2.0",
              "from": "cookie-jar@~0.2.0"
            },
            "aws-sign": {
              "version": "0.2.0",
              "from": "aws-sign@~0.2.0"
            },
            "oauth-sign": {
              "version": "0.2.0",
              "from": "oauth-sign@~0.2.0"
            },
            "forever-agent": {
              "version": "0.2.0",
              "from": "forever-agent@~0.2.0"
            },
            "tunnel-agent": {
              "version": "0.2.0",
              "from": "tunnel-agent@~0.2.0"
            },
            "json-stringify-safe": {
              "version": "3.0.0",
              "from": "json-stringify-safe@~3.0.0"
            },
            "qs": {
              "version": "0.5.6",
              "from": "qs@~0.5.4"
            }
          }
        },
        "stack-trace": {
          "version": "0.0.7",
          "from": "stack-trace@0.0.x"
        }
      }
    },
    "graceful-fs": {
      "version": "2.0.1",
      "from": "graceful-fs@~2.0.0"
    },
    "request": {
      "version": "2.21.0",
      "from": "request@~2.21.0",
      "dependencies": {
        "qs": {
          "version": "0.6.5",
          "from": "qs@~0.6.0"
        },
        "json-stringify-safe": {
          "version": "4.0.0",
          "from": "json-stringify-safe@~4.0.0"
        },
        "forever-agent": {
          "version": "0.5.0",
          "from": "forever-agent@~0.5.0"
        },
        "tunnel-agent": {
          "version": "0.3.0",
          "from": "tunnel-agent@~0.3.0"
        },
        "http-signature": {
          "version": "0.9.11",
          "from": "http-signature@~0.9.11",
          "dependencies": {
            "assert-plus": {
              "version": "0.1.2",
              "from": "assert-plus@0.1.2",
              "resolved": "https://registry.npmjs.org/assert-plus/-/assert-plus-0.1.2.tgz"
            },
            "asn1": {
              "version": "0.1.11",
              "from": "asn1@0.1.11",
              "resolved": "https://registry.npmjs.org/asn1/-/asn1-0.1.11.tgz"
            },
            "ctype": {
              "version": "0.5.2",
              "from": "ctype@0.5.2",
              "resolved": "https://registry.npmjs.org/ctype/-/ctype-0.5.2.tgz"
            }
          }
        },
        "hawk": {
          "version": "0.13.1",
          "from": "hawk@~0.13.0",
          "dependencies": {
            "hoek": {
              "version": "0.8.5",
              "from": "hoek@0.8.x"
            },
            "boom": {
              "version": "0.4.2",
              "from": "boom@0.4.x",
              "dependencies": {
                "hoek": {
                  "version": "0.9.1",
                  "from": "hoek@0.9.x"
                }
              }
            },
            "cryptiles": {
              "version": "0.2.2",
              "from": "cryptiles@0.2.x"
            },
            "sntp": {
              "version": "0.2.4",
              "from": "sntp@0.2.x",
              "dependencies": {
                "hoek": {
                  "version": "0.9.1",
                  "from": "hoek@0.9.x"
                }
              }
            }
          }
        },
        "aws-sign": {
          "version": "0.3.0",
          "from": "aws-sign@~0.3.0"
        },
        "oauth-sign": {
          "version": "0.3.0",
          "from": "oauth-sign@~0.3.0"
        },
        "cookie-jar": {
          "version": "0.3.0",
          "from": "cookie-jar@~0.3.0"
        },
        "node-uuid": {
          "version": "1.4.1",
          "from": "node-uuid@~1.4.0"
        },
        "mime": {
          "version": "1.2.11",
          "from": "mime@~1.2.7"
        },
        "form-data": {
          "version": "0.0.8",
          "from": "form-data@0.0.8",
          "resolved": "https://registry.npmjs.org/form-data/-/form-data-0.0.8.tgz",
          "dependencies": {
            "combined-stream": {
              "version": "0.0.4",
              "from": "combined-stream@~0.0.4",
              "dependencies": {
                "delayed-stream": {
                  "version": "0.0.5",
                  "from": "delayed-stream@0.0.5",
                  "resolved": "https://registry.npmjs.org/delayed-stream/-/delayed-stream-0.0.5.tgz"
                }
              }
            },
            "async": {
              "version": "0.2.9",
              "from": "async@~0.2.7"
            }
          }
        }
      }
    },
    "express": {
      "version": "3.1.2",
      "from": "express@~3.1.0",
      "dependencies": {
        "connect": {
          "version": "2.7.5",
          "from": "connect@2.7.5",
          "resolved": "https://registry.npmjs.org/connect/-/connect-2.7.5.tgz",
          "dependencies": {
            "qs": {
              "version": "0.5.1",
              "from": "qs@0.5.1",
              "resolved": "https://registry.npmjs.org/qs/-/qs-0.5.1.tgz"
            },
            "formidable": {
              "version": "1.0.11",
              "from": "formidable@1.0.11",
              "resolved": "https://registry.npmjs.org/formidable/-/formidable-1.0.11.tgz"
            },
            "buffer-crc32": {
              "version": "0.1.1",
              "from": "buffer-crc32@0.1.1",
              "resolved": "https://registry.npmjs.org/buffer-crc32/-/buffer-crc32-0.1.1.tgz"
            },
            "bytes": {
              "version": "0.2.0",
              "from": "bytes@0.2.0",
              "resolved": "https://registry.npmjs.org/bytes/-/bytes-0.2.0.tgz"
            },
            "pause": {
              "version": "0.0.1",
              "from": "pause@0.0.1",
              "resolved": "https://registry.npmjs.org/pause/-/pause-0.0.1.tgz"
            }
          }
        },
        "commander": {
          "version": "0.6.1",
          "from": "commander@0.6.1",
          "resolved": "https://registry.npmjs.org/commander/-/commander-0.6.1.tgz"
        },
        "range-parser": {
          "version": "0.0.4",
          "from": "range-parser@0.0.4",
          "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-0.0.4.tgz"
        },
        "mkdirp": {
          "version": "0.3.5",
          "from": "mkdirp@0.3.5",
          "resolved": "https://registry.npmjs.org/mkdirp/-/mkdirp-0.3.5.tgz"
        },
        "cookie": {
          "version": "0.0.5",
          "from": "cookie@0.0.5",
          "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.0.5.tgz"
        },
        "buffer-crc32": {
          "version": "0.2.1",
          "from": "buffer-crc32@~0.2.1"
        },
        "fresh": {
          "version": "0.1.0",
          "from": "fresh@0.1.0",
          "resolved": "https://registry.npmjs.org/fresh/-/fresh-0.1.0.tgz"
        },
        "methods": {
          "version": "0.0.1",
          "from": "methods@0.0.1",
          "resolved": "https://registry.npmjs.org/methods/-/methods-0.0.1.tgz"
        },
        "send": {
          "version": "0.1.0",
          "from": "send@0.1.0",
          "resolved": "https://registry.npmjs.org/send/-/send-0.1.0.tgz",
          "dependencies": {
            "mime": {
              "version": "1.2.6",
              "from": "mime@1.2.6",
              "resolved": "https://registry.npmjs.org/mime/-/mime-1.2.6.tgz"
            }
          }
        },
        "cookie-signature": {
          "version": "1.0.0",
          "from": "cookie-signature@1.0.0",
          "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.0.0.tgz"
        },
        "debug": {
          "version": "0.7.2",
          "from": "debug@*"
        }
      }
    },
    "socket.io": {
      "version": "0.9.16",
      "from": "socket.io@~0.9.16",
      "dependencies": {
        "socket.io-client": {
          "version": "0.9.16",
          "from": "socket.io-client@0.9.16",
          "resolved": "https://registry.npmjs.org/socket.io-client/-/socket.io-client-0.9.16.tgz",
          "dependencies": {
            "uglify-js": {
              "version": "1.2.5",
              "from": "uglify-js@1.2.5",
              "resolved": "https://registry.npmjs.org/uglify-js/-/uglify-js-1.2.5.tgz"
            },
            "ws": {
              "version": "0.4.31",
              "from": "ws@0.4.x",
              "dependencies": {
                "commander": {
                  "version": "0.6.1",
                  "from": "commander@~0.6.1",
                  "resolved": "https://registry.npmjs.org/commander/-/commander-0.6.1.tgz"
                },
                "nan": {
                  "version": "0.3.2",
                  "from": "nan@~0.3.0"
                },
                "tinycolor": {
                  "version": "0.0.1",
                  "from": "tinycolor@0.x"
                },
                "options": {
                  "version": "0.0.5",
                  "from": "options@>=0.0.5"
                }
              }
            },
            "xmlhttprequest": {
              "version": "1.4.2",
              "from": "xmlhttprequest@1.4.2",
              "resolved": "https://registry.npmjs.org/xmlhttprequest/-/xmlhttprequest-1.4.2.tgz"
            },
            "active-x-obfuscator": {
              "version": "0.0.1",
              "from": "active-x-obfuscator@0.0.1",
              "resolved": "https://registry.npmjs.org/active-x-obfuscator/-/active-x-obfuscator-0.0.1.tgz",
              "dependencies": {
                "zeparser": {
                  "version": "0.0.5",
                  "from": "zeparser@0.0.5",
                  "resolved": "https://registry.npmjs.org/zeparser/-/zeparser-0.0.5.tgz"
                }
              }
            }
          }
        },
        "policyfile": {
          "version": "0.0.4",
          "from": "policyfile@0.0.4",
          "resolved": "https://registry.npmjs.org/policyfile/-/policyfile-0.0.4.tgz"
        },
        "base64id": {
          "version": "0.1.0",
          "from": "base64id@0.1.0",
          "resolved": "https://registry.npmjs.org/base64id/-/base64id-0.1.0.tgz"
        },
        "redis": {
          "version": "0.7.3",
          "from": "redis@0.7.3",
          "resolved": "https://registry.npmjs.org/redis/-/redis-0.7.3.tgz"
        }
      }
    },
    "ejs": {
      "version": "0.8.4",
      "from": "ejs@~0.8.4"
    },
    "node-inspector": {
      "version": "0.4.0",
      "from": "node-inspector@~0.4.0",
      "dependencies": {
        "express": {
          "version": "3.3.8",
          "from": "express@~3.3",
          "dependencies": {
            "connect": {
              "version": "2.8.8",
              "from": "connect@2.8.8",
              "resolved": "https://registry.npmjs.org/connect/-/connect-2.8.8.tgz",
              "dependencies": {
                "qs": {
                  "version": "0.6.5",
                  "from": "qs@0.6.5",
                  "resolved": "https://registry.npmjs.org/qs/-/qs-0.6.5.tgz"
                },
                "formidable": {
                  "version": "1.0.14",
                  "from": "formidable@1.0.14",
                  "resolved": "https://registry.npmjs.org/formidable/-/formidable-1.0.14.tgz"
                },
                "bytes": {
                  "version": "0.2.0",
                  "from": "bytes@0.2.0",
                  "resolved": "https://registry.npmjs.org/bytes/-/bytes-0.2.0.tgz"
                },
                "pause": {
                  "version": "0.0.1",
                  "from": "pause@0.0.1",
                  "resolved": "https://registry.npmjs.org/pause/-/pause-0.0.1.tgz"
                },
                "uid2": {
                  "version": "0.0.2",
                  "from": "uid2@0.0.2",
                  "resolved": "https://registry.npmjs.org/uid2/-/uid2-0.0.2.tgz"
                }
              }
            },
            "commander": {
              "version": "1.2.0",
              "from": "commander@1.2.0",
              "resolved": "https://registry.npmjs.org/commander/-/commander-1.2.0.tgz",
              "dependencies": {
                "keypress": {
                  "version": "0.1.0",
                  "from": "keypress@0.1.x"
                }
              }
            },
            "range-parser": {
              "version": "0.0.4",
              "from": "range-parser@0.0.4",
              "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-0.0.4.tgz"
            },
            "mkdirp": {
              "version": "0.3.5",
              "from": "mkdirp@0.3.5",
              "resolved": "https://registry.npmjs.org/mkdirp/-/mkdirp-0.3.5.tgz"
            },
            "cookie": {
              "version": "0.1.0",
              "from": "cookie@0.1.0",
              "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.1.0.tgz"
            },
            "buffer-crc32": {
              "version": "0.2.1",
              "from": "buffer-crc32@0.2.1",
              "resolved": "https://registry.npmjs.org/buffer-crc32/-/buffer-crc32-0.2.1.tgz"
            },
            "fresh": {
              "version": "0.2.0",
              "from": "fresh@0.2.0",
              "resolved": "https://registry.npmjs.org/fresh/-/fresh-0.2.0.tgz"
            },
            "methods": {
              "version": "0.0.1",
              "from": "methods@0.0.1",
              "resolved": "https://registry.npmjs.org/methods/-/methods-0.0.1.tgz"
            },
            "send": {
              "version": "0.1.4",
              "from": "send@0.1.4",
              "resolved": "https://registry.npmjs.org/send/-/send-0.1.4.tgz",
              "dependencies": {
                "mime": {
                  "version": "1.2.11",
                  "from": "mime@~1.2.9"
                }
              }
            },
            "cookie-signature": {
              "version": "1.0.1",
              "from": "cookie-signature@1.0.1",
              "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.0.1.tgz"
            },
            "debug": {
              "version": "0.7.2",
              "from": "debug@*"
            }
          }
        },
        "async": {
          "version": "0.2.9",
          "from": "async@~0.2.8"
        },
        "glob": {
          "version": "3.2.6",
          "from": "glob@~3.2.1",
          "dependencies": {
            "minimatch": {
              "version": "0.2.12",
              "from": "minimatch@~0.2.11",
              "dependencies": {
                "lru-cache": {
                  "version": "2.3.1",
                  "from": "lru-cache@2"
                },
                "sigmund": {
                  "version": "1.0.0",
                  "from": "sigmund@~1.0.0"
                }
              }
            },
            "inherits": {
              "version": "2.0.1",
              "from": "inherits@2"
            }
          }
        },
        "rc": {
          "version": "0.3.1",
          "from": "rc@~0.3.0",
          "dependencies": {
            "optimist": {
              "version": "0.3.7",
              "from": "optimist@~0.3.4",
              "dependencies": {
                "wordwrap": {
                  "version": "0.0.2",
                  "from": "wordwrap@~0.0.2"
                }
              }
            },
            "deep-extend": {
              "version": "0.2.6",
              "from": "deep-extend@~0.2.5"
            },
            "ini": {
              "version": "1.1.0",
              "from": "ini@~1.1.0"
            }
          }
        }
      }
    },
    "gc-stats": {
      "version": "0.0.1",
      "from": "gc-stats@~0.0.1",
      "resolved": "https://registry.npmjs.org/gc-stats/-/gc-stats-0.0.1.tgz"
    },
    "bignumber.js": {
      "version": "1.1.1",
      "from": "bignumber.js@~1.1.1"
    },
    "npm": {
      "version": "1.3.11",
      "from": "npm@~1.3",
      "dependencies": {
        "semver": {
          "version": "2.1.0",
          "from": "semver@2.1"
        },
        "ini": {
          "version": "1.1.0",
          "from": "ini@latest"
        },
        "slide": {
          "version": "1.1.5",
          "from": "slide@~1.1.4"
        },
        "abbrev": {
          "version": "1.0.4",
          "from": "abbrev@latest"
        },
        "graceful-fs": {
          "version": "2.0.1",
          "from": "graceful-fs@~2.0.0"
        },
        "minimatch": {
          "version": "0.2.12",
          "from": "minimatch@latest",
          "dependencies": {
            "sigmund": {
              "version": "1.0.0",
              "from": "sigmund@~1.0.0",
              "resolved": "https://registry.npmjs.org/sigmund/-/sigmund-1.0.0.tgz"
            }
          }
        },
        "nopt": {
          "version": "2.1.2",
          "from": "nopt@latest"
        },
        "rimraf": {
          "version": "2.2.2",
          "from": "rimraf@2.2.2",
          "resolved": "https://registry.npmjs.org/rimraf/-/rimraf-2.2.2.tgz"
        },
        "request": {
          "version": "2.27.0",
          "from": "request@2.27.0",
          "dependencies": {
            "qs": {
              "version": "0.6.5",
              "from": "qs@~0.6.0"
            },
            "json-stringify-safe": {
              "version": "5.0.0",
              "from": "json-stringify-safe@~5.0.0"
            },
            "forever-agent": {
              "version": "0.5.0",
              "from": "forever-agent@~0.5.0"
            },
            "tunnel-agent": {
              "version": "0.3.0",
              "from": "tunnel-agent@~0.3.0"
            },
            "http-signature": {
              "version": "0.10.0",
              "from": "http-signature@~0.10.0",
              "dependencies": {
                "assert-plus": {
                  "version": "0.1.2",
                  "from": "assert-plus@0.1.2"
                },
                "asn1": {
                  "version": "0.1.11",
                  "from": "asn1@0.1.11"
                },
                "ctype": {
                  "version": "0.5.2",
                  "from": "ctype@0.5.2"
                }
              }
            },
            "hawk": {
              "version": "1.0.0",
              "from": "hawk@~1.0.0",
              "dependencies": {
                "hoek": {
                  "version": "0.9.1",
                  "from": "hoek@0.9.x"
                },
                "boom": {
                  "version": "0.4.2",
                  "from": "boom@0.4.x"
                },
                "cryptiles": {
                  "version": "0.2.2",
                  "from": "cryptiles@0.2.x"
                },
                "sntp": {
                  "version": "0.2.4",
                  "from": "sntp@0.2.x"
                }
              }
            },
            "aws-sign": {
              "version": "0.3.0",
              "from": "aws-sign@~0.3.0"
            },
            "oauth-sign": {
              "version": "0.3.0",
              "from": "oauth-sign@~0.3.0"
            },
            "cookie-jar": {
              "version": "0.3.0",
              "from": "cookie-jar@~0.3.0"
            },
            "node-uuid": {
              "version": "1.4.1",
              "from": "node-uuid@~1.4.0"
            },
            "mime": {
              "version": "1.2.11",
              "from": "mime@~1.2.9"
            },
            "form-data": {
              "version": "0.1.1",
              "from": "form-data@~0.1.0",
              "dependencies": {
                "combined-stream": {
                  "version": "0.0.4",
                  "from": "combined-stream@~0.0.4",
                  "dependencies": {
                    "delayed-stream": {
                      "version": "0.0.5",
                      "from": "delayed-stream@0.0.5"
                    }
                  }
                },
                "async": {
                  "version": "0.2.9",
                  "from": "async@~0.2.9"
                }
              }
            }
          }
        },
        "which": {
          "version": "1.0.5",
          "from": "which@1"
        },
        "tar": {
          "version": "0.1.18",
          "from": "tar@latest"
        },
        "fstream": {
          "version": "0.1.24",
          "from": "fstream@latest"
        },
        "block-stream": {
          "version": "0.0.7",
          "from": "block-stream@latest"
        },
        "mkdirp": {
          "version": "0.3.5",
          "from": "mkdirp@0.3.5",
          "resolved": "https://registry.npmjs.org/mkdirp/-/mkdirp-0.3.5.tgz"
        },
        "read": {
          "version": "1.0.5",
          "from": "read@latest",
          "dependencies": {
            "mute-stream": {
              "version": "0.0.4",
              "from": "mute-stream@~0.0.4"
            }
          }
        },
        "lru-cache": {
          "version": "2.3.1",
          "from": "lru-cache@2.3.1",
          "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-2.3.1.tgz"
        },
        "node-gyp": {
          "version": "0.10.10",
          "from": "node-gyp@0.10.10"
        },
        "fstream-npm": {
          "version": "0.1.5",
          "from": "fstream-npm@~0.1.3",
          "dependencies": {
            "fstream-ignore": {
              "version": "0.0.7",
              "from": "fstream-ignore@~0.0.5"
            }
          }
        },
        "uid-number": {
          "version": "0.0.3",
          "from": "../uid-number"
        },
        "archy": {
          "version": "0.0.2",
          "from": "archy@0.0.2"
        },
        "chownr": {
          "version": "0.0.1",
          "from": "../chownr"
        },
        "npmlog": {
          "version": "0.0.4",
          "from": "npmlog@latest"
        },
        "ansi": {
          "version": "0.1.2",
          "from": "ansi@~0.1.2"
        },
        "npm-registry-client": {
          "version": "0.2.28",
          "from": "npm-registry-client@latest",
          "dependencies": {
            "couch-login": {
              "version": "0.1.18",
              "from": "couch-login@~0.1.18"
            }
          }
        },
        "read-package-json": {
          "version": "1.1.3",
          "from": "read-package-json@~1.1.3",
          "resolved": "https://registry.npmjs.org/read-package-json/-/read-package-json-1.1.3.tgz",
          "dependencies": {
            "normalize-package-data": {
              "version": "0.2.2",
              "from": "normalize-package-data@~0.2",
              "resolved": "https://registry.npmjs.org/normalize-package-data/-/normalize-package-data-0.2.2.tgz"
            }
          }
        },
        "read-installed": {
          "version": "0.2.4",
          "from": "read-installed@~0.2.2"
        },
        "glob": {
          "version": "3.2.6",
          "from": "glob@latest"
        },
        "init-package-json": {
          "version": "0.0.11",
          "from": "init-package-json@latest",
          "dependencies": {
            "promzard": {
              "version": "0.2.0",
              "from": "promzard@~0.2.0"
            }
          }
        },
        "osenv": {
          "version": "0.0.3",
          "from": "osenv@latest"
        },
        "lockfile": {
          "version": "0.4.2",
          "from": "lockfile@0.4.2",
          "resolved": "https://registry.npmjs.org/lockfile/-/lockfile-0.4.2.tgz"
        },
        "retry": {
          "version": "0.6.0",
          "from": "retry"
        },
        "once": {
          "version": "1.1.1",
          "from": "once"
        },
        "npmconf": {
          "version": "0.1.3",
          "from": "npmconf@latest",
          "dependencies": {
            "config-chain": {
              "version": "1.1.7",
              "from": "config-chain@~1.1.1",
              "dependencies": {
                "proto-list": {
                  "version": "1.2.2",
                  "from": "proto-list@~1.2.1"
                }
              }
            }
          }
        },
        "opener": {
          "version": "1.3.0",
          "from": "opener@latest"
        },
        "chmodr": {
          "version": "0.1.0",
          "from": "chmodr@latest"
        },
        "cmd-shim": {
          "version": "1.0.1",
          "from": "cmd-shim@latest"
        },
        "sha": {
          "version": "1.2.3",
          "from": "sha@latest",
          "dependencies": {
            "readable-stream": {
              "version": "1.0.17",
              "from": "readable-stream@1.0",
              "resolved": "https://registry.npmjs.org/readable-stream/-/readable-stream-1.0.17.tgz"
            }
          }
        },
        "editor": {
          "version": "0.0.4",
          "from": "editor@"
        },
        "child-process-close": {
          "version": "0.1.1",
          "from": "child-process-close@",
          "resolved": "https://registry.npmjs.org/child-process-close/-/child-process-close-0.1.1.tgz"
        },
        "npm-user-validate": {
          "version": "0.0.3",
          "from": "npm-user-validate@0.0.3",
          "resolved": "https://registry.npmjs.org/npm-user-validate/-/npm-user-validate-0.0.3.tgz"
        },
        "github-url-from-git": {
          "version": "1.1.1",
          "from": "github-url-from-git@1.1.1",
          "resolved": "https://registry.npmjs.org/github-url-from-git/-/github-url-from-git-1.1.1.tgz"
        },
        "inherits": {
          "version": "2.0.1",
          "from": "inherits@"
        }
      }
    },
    "consolidate": {
      "version": "0.9.1",
      "from": "consolidate@~0.9.1",
      "resolved": "https://registry.npmjs.org/consolidate/-/consolidate-0.9.1.tgz"
    },
    "dustjs-helpers": {
      "version": "1.1.1",
      "from": "dustjs-helpers@~1.1.1"
    },
    "dustjs-linkedin": {
      "version": "2.0.3",
      "from": "dustjs-linkedin@~2.0.3",
      "resolved": "https://registry.npmjs.org/dustjs-linkedin/-/dustjs-linkedin-2.0.3.tgz"
    },
    "should": {
      "version": "1.2.2",
      "from": "should@~1.2.2"
    },
    "optimist": {
      "version": "0.6.0",
      "from": "optimist@~0.6.0",
      "dependencies": {
        "wordwrap": {
          "version": "0.0.2",
          "from": "wordwrap@~0.0.2"
        },
        "minimist": {
          "version": "0.0.5",
          "from": "minimist@~0.0.1"
        }
      }
    },
    "mocha": {
      "version": "1.11.0",
      "from": "mocha@~1.11.0",
      "dependencies": {
        "commander": {
          "version": "0.6.1",
          "from": "commander@0.6.1",
          "resolved": "https://registry.npmjs.org/commander/-/commander-0.6.1.tgz"
        },
        "growl": {
          "version": "1.7.0",
          "from": "growl@1.7.x"
        },
        "jade": {
          "version": "0.26.3",
          "from": "jade@0.26.3",
          "resolved": "https://registry.npmjs.org/jade/-/jade-0.26.3.tgz",
          "dependencies": {
            "mkdirp": {
              "version": "0.3.0",
              "from": "mkdirp@0.3.0",
              "resolved": "https://registry.npmjs.org/mkdirp/-/mkdirp-0.3.0.tgz"
            }
          }
        },
        "diff": {
          "version": "1.0.2",
          "from": "diff@1.0.2",
          "resolved": "https://registry.npmjs.org/diff/-/diff-1.0.2.tgz"
        },
        "debug": {
          "version": "0.7.2",
          "from": "debug@*"
        },
        "mkdirp": {
          "version": "0.3.5",
          "from": "mkdirp@0.3.5",
          "resolved": "https://registry.npmjs.org/mkdirp/-/mkdirp-0.3.5.tgz"
        },
        "ms": {
          "version": "0.3.0",
          "from": "ms@0.3.0",
          "resolved": "https://registry.npmjs.org/ms/-/ms-0.3.0.tgz"
        },
        "glob": {
          "version": "3.2.1",
          "from": "glob@3.2.1",
          "resolved": "https://registry.npmjs.org/glob/-/glob-3.2.1.tgz",
          "dependencies": {
            "minimatch": {
              "version": "0.2.12",
              "from": "minimatch@~0.2.11",
              "dependencies": {
                "lru-cache": {
                  "version": "2.3.1",
                  "from": "lru-cache@2"
                },
                "sigmund": {
                  "version": "1.0.0",
                  "from": "sigmund@~1.0.0"
                }
              }
            },
            "graceful-fs": {
              "version": "1.2.3",
              "from": "graceful-fs@~1.2.0"
            },
            "inherits": {
              "version": "1.0.0",
              "from": "inherits@1"
            }
          }
        }
      }
    }
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
