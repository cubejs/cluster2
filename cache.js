'use strict';

var cluster2 = process.cluster2 = process.cluster2 || {};
cluster2.cache = cluster2.cache || require('./lib/cache');

module.exports = cluster2.cache;