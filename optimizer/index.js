/*jshint node:true*/

'use strict';

var utils = require('mout'),
    Parser = require('./lib/Parser'),
    Optimizer = require('./lib/Optimizer'),
    OptimizerClosure = require('./lib/OptimizerClosure'),
    esformatter = require('esformatter');

module.exports = function (contents, options, callback) {
    if (utils.lang.isFunction(options)) {
        callback = options;
        options = {};
    } else {
        options = options || {};
    }

    options = utils.object.mixIn({
        closure: false
    }, options);

    var parser = new Parser(),
        optimizer = new Optimizer({ escodegen: options.escodegenOpts }),
        optimizerClosure = new OptimizerClosure({ escodegen: options.escodegenOpts }),
        errors = [],
        ast,
        output;

    // Find usages
    ast = parser.forEachUsage(contents, function (err, obj) {
        if (err) {
            return errors.push(err);
        }

        // Use the closure optimizer if the user wants to use it
        // or if the default one can't be used
        if (options.closure || !optimizer.canOptimize(obj.node)) {
            optimizerClosure.optimize(obj);
        } else {
            optimizer.optimize(obj);
        }
    });

    // Generate the source
    output = esformatter.format(ast);

    callback(errors, output);
};