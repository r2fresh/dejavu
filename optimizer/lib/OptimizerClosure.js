/*jshint node:true, regexp:false*/

'use strict';

var Optimizer = require('./Optimizer'),
    esprima = require('esprima'),
    inherits = require('inherits'),
    Syntax = esprima.Syntax,
    OptimizerClosure;

/**
 * Constructor.
 */
OptimizerClosure = function () {
    Optimizer.call(this);
};

/**
 * {@inheritDoc}
 */
OptimizerClosure.prototype.canOptimize = function () {
    return true;
};

/**
 * {@inheritDoc}
 */
OptimizerClosure.prototype.optimizeClass = function (node) {
    var args = node['arguments'],
        type = node.callee.property.name,
        extend,
        funcExpression,
        canBeOptimized,
        hasParent;

    // Step 1
    // Convert the object to a return function with the magical $ params
    funcExpression = {
        type: Syntax.FunctionExpression,
        id: null,
        params: [],
        body: {
            type: Syntax.BlockStatement,
            body: [
                {
                    type: Syntax.ReturnStatement
                    // Return object will be here as the argument key
                }
            ]
        }
    };

    if (type === 'extend' || (extend = this._getExtends(args[0]))) {
        hasParent = true;
        funcExpression.params.push(
            {
                type: Syntax.Identifier,
                name: '$super'
            },
            {
                type: Syntax.Identifier,
                name: '$parent'
            },
            {
                type: Syntax.Identifier,
                name: '$self'
            }
        );

        if (type !== 'extend') {
            this._removeExtends(args[0]);
            node['arguments'] = [
                {
                    type: 'Identifier',
                    name: extend
                },
                funcExpression
            ];
        } else {
            node['arguments'] = [funcExpression];
        }
    } else {
        hasParent = false;
        funcExpression.params.push(
            {
                type: Syntax.Identifier,
                name: '$self'
            }
        );
        node['arguments'] = [funcExpression];
    }

    funcExpression.body.body[0].argument = args[0];

    // Step 2
    // Replace all the this.$super / this.$static / this.$self accordingly
    // Be aware that depending on the context (normal or static, things must be adapted)
    canBeOptimized = this._findAndParseFunctions(args[0].properties);

    // Step 3
    // Add a true flag if the constructor can be optimized
    // and remove the $super and $parent that was previously added
    if (canBeOptimized) {
        node['arguments'].push({
            type: 'Literal',
            value: true
        });

        funcExpression.params.splice(hasParent ? 2 : 0, 1);
    }

    // Step 4
    // Remove $name and $locked
    this._removeProperties(args[0].properties, ['$name', '$locked']);
};

/**
 * {@inheritDoc}
 */
OptimizerClosure.prototype._replaceSpecial = function (funcName, node, isStatic) {
    var code = node.value ? node.value.toString() : node.object.toString(),
        canBeOptimized = true;

    function selfReplacer() {
        canBeOptimized = false;
        return '$self';
    }

    if (!isStatic && funcName === ('_initialize' || funcName === '__initialize')) {
        funcName = 'initialize';
    }

    // Super replacement
    code = code.replace(/(_*this|_*that|_*self)((?:\r|\n|\s)*)?\.((?:\r|\n|\s)*)\$super\(/g, '$super$2.$3' + funcName + '.call($1, ')
               .replace(/(_*this|_*that|_*self), \)/g, '$1)');

    // If on static context, $super is actually $parent
    // Also this.$static can be replaced by this because is faster
    if (isStatic) {
        code = code.replace(/\$super/g, '$parent');
        code = code.replace(/(_*this|_*that|_*self)((?:\r|\n|\s)*)?\.((?:\r|\n|\s)*)?\$static/g, '$1$2$3');
    }

    // Self replacement
    code = code.replace(/(_*this|_*that|_*self)((?:\r|\n|\s)*)?\.((?:\r|\n|\s)*)?\$self?/g, selfReplacer);

    // Test if something went wrong
    if (/\.(\r|\n|\s)*\$super/g.test(code) || /\.(\r|\n|\s)*\$self/g.test(code) || (isStatic && /\.(\r|\n|\s)*\$static/g.test(code))) {
        process.stderr.write('The optimization might have broken the behavior at line ' + node.value.loc.start.line + ', column ' + node.value.loc.start.column + '\n');
    }

    this._updateNode(node.value || node.object, code);

    return canBeOptimized;
};

inherits(OptimizerClosure, Optimizer);

module.exports = OptimizerClosure;
