/*jshint node:true*/

'use strict';

var rocambole = require('rocambole'),
    esprima = require('esprima'),
    Syntax = esprima.Syntax,
    Parser;

/**
 * Constructor.
 */
Parser = function () {};

/**
 * Run the callback foreach dejavu usage.
 * The callback will receive an object containing a type and the node.
 * The type is either interface, abstract or concrete.
 *
 * @param {String}   code     The source code
 * @param {Function} callback The callback
 *
 * @return {Object} The ast
 */
Parser.prototype.forEachUsage = function (code, callback) {
    var objectName,
        props,
        ast,
        that = this;

    ast = rocambole.parse(code, { loc: true });

    rocambole.recursive(ast, function (curr) {
        if (curr.type === Syntax.CallExpression &&
            curr.callee.type === Syntax.MemberExpression &&
            curr.callee.property.type === Syntax.Identifier &&
            curr['arguments'].length && curr['arguments'][0].type === Syntax.ObjectExpression) {

            objectName = curr.callee.object.type === 'MemberExpression' ? curr.callee.object.property.name : curr.callee.object.name;

            // Obvious usage
            if (curr.callee.property.name === 'declare') {
                if (objectName === 'Interface') {
                    callback(null, { type: 'interface', node: curr });
                } else if (objectName === 'AbstractClass') {
                    callback(null, { type: 'abstract', node: curr });
                } else if (objectName === 'Class' || objectName === 'FinalClass') {
                    callback(null, { type: 'concrete', node: curr });
                }
            // Usage with extend
            } else if (curr.callee.property.name === 'extend') {
                props = curr['arguments'][0].properties;

                if (that._isInterface(props)) {
                    callback(null, { type: 'interface', node: curr });
                } else if (that._isAbstractClass(props)) {
                    callback(null, { type: 'abstract', node: curr });
                } else if (that._isClass(props)) {
                    callback(null, { type: 'concrete', node: curr });
                } else {
                    callback(new Error('Not enough metadata to optimize usage at line ' + curr.loc.start.line + ', column ' + curr.loc.start.column + ' (add a $name property?)\n'));
                }
            }
        }
    });

    return ast;
};

/**
 * Checks if the passed nodes (members) are part of an interface.
 *
 * @param {Array} asts The nodes
 *
 * @return {Boolean} True if it is, false otherwise
 */
Parser.prototype._isInterface = function (nodes) {
    var x,
        curr;

    // Every single function must be empty
    // Also all the properties must be functions except a few ones ($extends, $name, $static)
    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];

        if (curr.key.name === '$name' || curr.key.name === '$extends') {
            continue;
        }

        if (curr.key.name === '$statics') {
            if (!this._isInterface(curr.value)) {
                return false;
            }
        } else if (curr.type === Syntax.FunctionExpression) {
            if (curr.body.body.length) {
                return false;
            }
        } else {
            return false;
        }
    }

    return true;
};

/**
 * Checks if the passed nodes (members) are part of an abstract class.
 *
 * @param {Array} nodes The nodes
 *
 * @return {Boolean} True if it is, false otherwise
 */
Parser.prototype._isAbstractClass = function (nodes) {
    // Check if it has an $abstracts
    var x,
        curr;

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];

        if (curr.key.name === '$abstracts') {
            return true;
        }
    }

    return false;
};

/**
 * Checks if the passed nodes (members) are part of a concrete class.
 *
 * @param {Array} nodes The nodes
 *
 * @return {Boolean} True if it is, false otherwise
 */
Parser.prototype._isClass = function (nodes) {
    // Check if it has a $name, $extends, $borrows, $statics, $finals, $constants
    var x,
        curr,
        known = ['$name', '$extends', '$borrows', '$implements', '$statics', '$finals', '$constants'];

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];

        if (known.indexOf(curr.key.name) !== -1) {
            return true;
        }
    }

    return false;
};

module.exports = Parser;