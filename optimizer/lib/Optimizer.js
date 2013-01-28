/*jshint node:true, regexp:false*/

'use strict';

var esprima = require('esprima'),
    rocambole = require('rocambole'),
    Syntax = esprima.Syntax,
    Optimizer;

/**
 * Constructor.
 */
Optimizer = function () {};

/**
 * Checks if this optimizer can optimize a target.
 *
 * @param {String|Object} target The string or the node
 */
Optimizer.prototype.canOptimize = function (target) {
    if (typeof target !== 'string') {
        target = target.toString();
    }

    return !(/(_*this|_*that|_*self)[\n\r\s]*\.[\n\r\s]*\$self/g).test(target);
};

/**
 * Optimizes the node passed in the object according to the type.
 * Used as the callback for forEachUsage.
 *
 * @param {Object} obj The object containing the type and the node
 */
Optimizer.prototype.optimize = function (obj) {
    var type = obj.type,
        node = obj.node;

    // Detect and make the optimizations according to the type
    if (type === 'concrete') {
        this.optimizeClass(node);
    } else if (type === 'abstract') {
        this.optimizeAbstractClass(node);
        this.optimizeClass(node);
    } else if (type === 'interface') {
        this.optimizeInterface(node);
    }
};

/**
 * Optimizes an interface.
 * The node will be directly modified.
 *
 * @param {Object} node The node containing the interface
 */
Optimizer.prototype.optimizeInterface = function (node) {
    // Step 1
    // Remove all the functions
    var nodes = node['arguments'][0].properties,
        x,
        curr;

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];

        if (curr.value.type === Syntax.FunctionExpression) {
            nodes.splice(x, 1);
        }
    }

    // Step 2
    // Remove $name and $statics
    this._removeProperties(nodes, ['$name', '$statics']);
};

/**
 * Optimizes an abstract classs.
 * This just removes the abstract members.
 * You should call optimizeClass() after.
 * The node will be directly modified.
 *
 * @param {Object} node The node containing the abstract class
 */
Optimizer.prototype.optimizeAbstractClass = function (node) {
    // Step 1
    // Remove abstracts
    // Beware that we need to preserve functions that have .$bound()
    var nodes = node['arguments'][0].properties,
        curr,
        x;

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];

        if (curr.key.name === '$abstracts' && curr.value.type === Syntax.ObjectExpression) {
            this._removeAbstractFunctions(curr.value.properties);
            if (!curr.value.properties.length) {
                nodes.splice(x, 1);
            }

            break;
        }
    }
};

/**
 * Optimizes a concrete class.
 * The node will be directly modified.
 *
 * @param {Object} node The node containing the class
 */
Optimizer.prototype.optimizeClass = function (node) {
    var args = node['arguments'],
        type = node.callee.property.name,
        canBeOptimized,
        parent;

    if (type === 'extend') {
        parent = node.callee.object.toString();
    } else {
        parent = this._getExtends(args[0]);
    }

    // If something strange is being extended, do not optimize
    if (parent && !(/^[a-z0-9_\$\.]+$/i).test(parent)) {
        return;
    }

    this._currentParent = parent;

    // Step 1
    // Replace all the this.$super / this.$static / this.$self accordingly
    // Be aware that depending on the context (normal or static, things must be adapted)
    canBeOptimized = this._findAndParseFunctions(args[0].properties);

    // Step 2
    // Add a true flag if the constructor can be optimized
    // and remove the $super and $parent that was previously added
    if (canBeOptimized) {
        node['arguments'].push({
            type: 'Literal',
            value: true
        });
    }

    // Step 3
    // Remove $name and $locked
    this._removeProperties(args[0].properties, ['$name', '$locked']);
};

/**
 * Removes the given properties from several nodes.
 * The original node will be modified.
 *
 * @param {Array} nodes      The nodes
 * @param {Array} properties The properties to remove
 */
Optimizer.prototype._removeProperties = function (nodes, properties) {
    var x;

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        if (properties.indexOf(nodes[x].key.name) !== -1) {
            nodes.splice(x, 1);
        }
    }
};

/**
 * Removes all abstract functions of an abstract class.
 * All $bound functions will be kept.
 * The original nodes array will be modified.
 *
 * @param {Array} nodes The nodes
 */
Optimizer.prototype._removeAbstractFunctions = function (nodes) {
    var x,
        curr;

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];

        if (curr.key.name === '$statics' && curr.value.type === Syntax.ObjectExpression) {
            this._removeAbstractFunctions(curr.value.properties);
            if (!curr.value.properties.length) {
                nodes.splice(x, 1);
            }
        } else if (curr.value.type === Syntax.FunctionExpression) {
            nodes.splice(x, 1);
        }
    }
};

/**
 * Finds and parses a concrete class functions in order to optimize them.
 * All super and self calls will be replaced with their efficient counterpart.
 *
 * @param {Array}   nodes    The nodes containing the functions
 * @param {Boolean} isStatic True if in static context, false otherwise
 *
 * @return {Boolean} True if the constructor can be optimized, false otherwise
 */
Optimizer.prototype._findAndParseFunctions = function (nodes, isStatic) {
    if (!Array.isArray(nodes)) {
        return false;
    }

    var x,
        prevCurr,
        curr,
        currFuncName,
        canBeOptimized = true,
        ret;

    for (x = nodes.length - 1; x >= 0; x -= 1) {
        curr = nodes[x];
        ret = null;

        if (curr.key.name === '$statics') {
            ret = this._findAndParseFunctions(curr.value.properties, true);
        } else if (curr.key.name === '$finals') {
            ret = this._findAndParseFunctions(curr.value.properties);
        } else if (curr.value.type === Syntax.CallExpression || curr.value.type === Syntax.MemberExpression) {
            // Traverse all the CallExpressions and MemberExpressions until we find the FunctionExpression
            // This is because we can have functions with .$bound and other things
            currFuncName = curr.key.name;
            curr = curr.value.callee;
            prevCurr = null;
            while (curr && curr.type !== Syntax.FunctionExpression) {
                prevCurr = curr;
                curr = curr.object || curr.callee;
            }

            if (curr && curr.type === Syntax.FunctionExpression && prevCurr) {
                ret = this._replaceSpecial(currFuncName, prevCurr, isStatic);
            }
        } else if (curr.value.type === Syntax.FunctionExpression) {
            currFuncName = curr.key.name;
            ret = this._replaceSpecial(currFuncName, curr, isStatic);

        }

        if (ret === false) {
            canBeOptimized = false;
        }
    }

    return canBeOptimized;
};

/**
 * Replaces a function usage of keywords for their efficient counterparts.
 * Basically this.$super, this.$static and this.$self will be optimized.
 *
 * @param {String}  funcName The function name
 * @param {Object}  node     The node containing the function definition
 * @param {Boolean} isStatic True if in static context, false otherwise
 *
 * @return {Boolean} False if this functions causes the constructor to not be optimized, false otherwise
 */
Optimizer.prototype._replaceSpecial = function (funcName, node, isStatic) {
    // TODO: Replace the node's instead of using regexps?
    //       In this case, regexps are much easier but more error prone
    //       Anyway, at this point we are inside a class function
    var code = node.value ? node.value.toString() : node.object.toString(),
        currParent = this._currentParent;

    if (!isStatic && funcName === ('_initialize' || funcName === '__initialize')) {
        funcName = 'initialize';
    }

    // Super replacement
    if (!isStatic) {
        code = code.replace(/(_*this|_*that|_*self)((?:\r|\n|\s)*)\.((?:\r|\n|\s)*)\$super\(/g, currParent + '$2.prototype.$3' + funcName + '.call($1, ');
    } else {
        code = code.replace(/(_*this|_*that|_*self)((?:\r|\n|\s)*)\.((?:\r|\n|\s)*)\$super\(/g, currParent + '$2.$3' + funcName + '.call($1, ');
    }
    code = code.replace(/(_*this|_*that|_*self), \)/g, '$1)');

    // If on static context, this.$static can be optimized to just this
    if (isStatic) {
        code = code.replace(/(_*this|_*that|_*self)((?:\r|\n|\s)*)?\.((?:\r|\n|\s)*)?\$static/g, '$1$2$3');
    }

    // Remove member
    code = code.replace(/\.\$member\(\)/g, '');

    this._updateNode(node.value || node.object, code);

    return true;
};

/**
 * Grabs and returns the $extends of an usage.
 * Will null if none.
 *
 * @param {Function} node The node
 *
 * @return {String} The $extends property
 */
Optimizer.prototype._getExtends = function (node) {
    var x,
        length = node.properties.length;

    for (x = 0; x < length; x += 1) {
        if (node.properties[x].key.name === '$extends') {
            return node.properties[x].value.toString();
        }
    }

    return null;
};

/**
 * Removes $extends of an usage.
 *
 * @param {Function} node The node
 */
Optimizer.prototype._removeExtends = function (node) {
    var x,
        length = node.properties.length;

    for (x = 0; x < length; x += 1) {
        if (node.properties[x].key.name === '$extends') {
            node.properties.splice(x, 1);
            break;
        }
    }
};

/**
 * Updates a node's contents.
 *
 * @param {Object} node The node
 * @param {String} str  The new contents
 */
Optimizer.prototype._updateNode = function (node, str) {
    var newToken;

    if (node.type === Syntax.FunctionExpression) {
        str = str.replace(/function\s*\(/, 'function x(');
        newToken = rocambole.parse(str).body[0];
        newToken.id = null;
        newToken.type = Syntax.FunctionExpression;
    } else {
        newToken = rocambole.parse(str);
    }

    // Update linked list references
    if (node.startToken.prev) {
        node.startToken.prev.next = newToken;
    }
    if (node.endToken.next) {
        node.endToken.next.prev = newToken;
    }
    node.startToken = node.endToken = newToken;
};

module.exports = Optimizer;