var baseKarmaConfig = require('./karma.base.conf.js');

var conf = baseKarmaConfig;
conf['browsers'] = ['ChromeDebugging'];

module.exports = function(config) {
  config.set(conf);
};
