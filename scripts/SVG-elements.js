/**********************************************************
    This file contains Objects uses to build a 
    representation of an SVG DOM.
***********************************************************/

// Generic SVG DOM element
var SVG_Element = function(element) {
    this.tag = element.nodeName;
    this.attributes = {};
    this.originalAttributes = {};
    this.essentialAttributes = [];
    this.styles = {};
    this.children = [];
    this.text = "";

    // TODO: may need to replace this with actual namespace
    this.namespaceURI = 'http://www.w3.org/2000/svg';

    // Add attributes to two hashs, one for the original and one for optimising
    var i,
        attr,
        attrName,
        attributes = element.attributes || [];

    for (i = 0; i < attributes.length; i++){
        attr = attributes.item(i);
        attrName = attr.nodeName;
        this.originalAttributes[attrName] = attr.value;
        this.attributes[attrName] = attr.value;
    }

    // Convert position attributes to numbers and add default values 
    var attributeData = shapeAttributes[this.tag];
    if (attributeData) {
        var digitAttributes = attributeData.parseAsDigit || [];
        for (i = 0; i < digitAttributes.length; i++) {
            attrName = digitAttributes[i];
            this.originalAttributes[attrName] = parseFloat(this.originalAttributes[attrName] || 0);
        }
        this.essentialAttributes = attributeData.essential || [];
    }

    // Parse transform
    if (this.attributes.transform) {
        this.addTransform(this.attributes.transform);
    }

    for (i = 0; i < element.childNodes.length; i++) {
        var child = element.childNodes[i];
        if (child instanceof Text) {
            // Tag contains text
            if (child.data.replace(/^\s*/, "") !== "") {
                this.text = child.data;
            }
        } else {
            this.children.push(this.getChild(child));
        }
    }

};

// Copy attributes so we can optimise them without losing them
SVG_Element.prototype.getOriginalAttributes = function() {
    this.attributes = {};
    for (var attr in this.originalAttributes) {
        this.attributes[attr] = this.originalAttributes[attr];
    }

    // Should we remove this element when optimising
    this.toRemove = false;
};

// TODO: make sure this works with multiple transforms
SVG_Element.prototype.addTransform = function(transform) {
    this.transform = SVG_optimise.parseTransforms(transform);
    // TODO: Only doing this so it shows up when we write the object
    // Need to fix so that we can do this without calling optimise
    this.attributes.transform = transform;
};

SVG_Element.prototype.write = function(options, depth) {
    if (this.toRemove) { return ""; }

    depth = depth || 0;
    var indent = (options.whitespace === 'remove') ? '' : new Array(depth + 1).join('  ');

    // Open tag
    var str = indent + '<' + this.tag;

    // Write attributes
    for (var attr in this.attributes) {
        str += ' ' + attr + '="' + this.attributes[attr] + '"';
    }

    if (!this.toSkip) { depth++; }

    // Add child information
    var childString = "";
    for (var i = 0; i < this.children.length; i++) {
        childString += this.children[i].write(options, depth);
    }

    if (this.toSkip) { return childString; }

    if (this.text.length + childString.length > 0) {
        str += ">" + options.newLine;
        if (this.text) { str += indent + "  " + this.text; }
        str += childString + indent + "</" + this.tag + ">";
    } else {
        str += "/>" + options.newLine;
    }

    return str;
};

// TODO: get this work with skipped elements
SVG_Element.prototype.createSVGObject = function() {
    var element = document.createElementNS(this.namespaceURI, this.tag);

    for (var attr in this.attributes) {
        element.setAttribute(attr, this.attributes[attr]);
    }

    if (this.text) {
        var textNode = document.createTextNode(this.text);
        element.appendChild(textNode);
    }

    for (var i = 0; i < this.children.length; i++) {
        element.appendChild(this.children[i].createSVGObject());
    }

    return element;
};

SVG_Element.prototype.optimise = function(options) {
    // Get set copy of attributes to optimise
    this.getOriginalAttributes();

    this.attributeCounts = 0;
    for (var attr in this.attributes) {
        this.attributeCounts++;
    }

    this.elementSpecificOptimisations(options);

    // If an shape element lacks some dimension then don't draw it
    if (options.removeRedundantShapes && this.essentialAttributes) {
        for (var i = 0; i < this.essentialAttributes.length; i++) {
            if (!this.attributes[this.essentialAttributes[i]]) {
                this.toRemove = true;
                // If we remove the element, then remove its children
                return;
            }
        }
    }

    for (var i = 0; i < this.children.length; i++) {
        this.children[i].optimise(options);
    }
};

// Overwritten by other object classes
SVG_Element.prototype.elementSpecificOptimisations = function(options) {
    if (this.transform) {
        this.attributes = this.applyTransformation(this.attributes, options);
    }
};

SVG_Element.prototype.applyTransformation = function(coordinates, options) {
    for (var i = 0; i < this.transform.length; i++) {
        var transform = this.transform[i];
        var transformFunction = this[transform[0]];

        // TODO: strip out meaningless transforms
        if (transformFunction) {
            coordinates = transformFunction.call(this, coordinates, transform.slice(1));
            // Remove transformation from the attribute hash
            // TOOD: Check there are no other transformations in the attribute
            delete coordinates.transform;
        } else {
            console.warn("No transform function " + transform + " for " + this.tag);
        }
    }

    return coordinates;
};

SVG_Element.prototype.translate = function(coordinates, parameters) {
    var attributes = SVG_optimise.transformShape.translate(this.tag, coordinates, parameters);
    // TODO: Move this to the translate function when we decide how to update attributes
    $.extend(coordinates, attributes);
    return coordinates;
};

// Path element
// https://www.w3.org/TR/SVG/paths.html
var SVG_Path_Element = function(element) {
    SVG_Element.call(this, element);

    // Convert path d attribute to array of arrays
    if (this.attributes.d) {
        this.path = SVG_optimise.parsePath(this.attributes.d);
    }
};
SVG_Path_Element.prototype = Object.create(SVG_Element.prototype);

SVG_Path_Element.prototype.elementSpecificOptimisations = function(options) {
    // Replace current d attributed with optimised version
    if (this.path) {
        var optimisedPath = this.path;

        if (this.transform) {
            optimisedPath = this.applyTransformation(optimisedPath, options);
        }

        optimisedPath = SVG_optimise.optimisePath(optimisedPath, options);
        // TODO: don't replace attribute but write a new one instead
        this.attributes.d = SVG_optimise.getPathString(optimisedPath, options);
    }

};

SVG_Path_Element.prototype.translate = function(coordinates, parameters) {
    return SVG_optimise.transformPath.translate(coordinates, parameters);
};

SVG_Path_Element.prototype.scale = function(coordinates, parameters) {
    return SVG_optimise.transformPath.scale(coordinates, parameters);
};


var SVG_Polyline_Element = function(element) {
    SVG_Element.call(this, element);

    // Convert path d attribute to array of arrays
    if (this.attributes.points) {
        this.points = this.attributes.points.split(/\s*[,\s]+/).map(parseFloat);
    }
};
SVG_Polyline_Element.prototype = Object.create(SVG_Element.prototype);


SVG_Polyline_Element.prototype.elementSpecificOptimisations = function(options) {
    if (this.transform) {
        this.attributes.points = this.points;
        this.attributes = this.applyTransformation(this.attributes, options);
        
        // TODO: Maybe move this to optimise-functions
        var coordinates = this.attributes.points;

        var pathString = "";
        for (var i = 0; i < coordinates.length; i++) {
            var n = coordinates[i];
            var d = options.positionDecimals(n);
            // Add a space if this is no the first digit and if the digit positive
            pathString += (i > 0 && (n > 0 || d == '0')) ? " " + d : d;
        }
        this.attributes.points = pathString;
    }
};

var SVG_Group_Element = function(element) {
    SVG_Element.call(this, element);
};
SVG_Group_Element.prototype = Object.create(SVG_Element.prototype);

SVG_Group_Element.prototype.elementSpecificOptimisations = function(options) {
    if (options.removeCleanGroups && !this.attributeCounts) {
        this.toSkip = true;
    }
};


// Create the child element of an given element with the correct Objects
SVG_Element.prototype.getChild = function(child) {
    switch (child.nodeName) {
        case 'path':
            return new SVG_Path_Element(child);
        case 'polyline':
            return new SVG_Polyline_Element(child);
        case 'g':
            return new SVG_Group_Element(child);
        default:
            return new SVG_Element(child);
    }
};


// Base object containing the SVG elements
// Also where the optimisation options are stored
var SVG_Root = function(svgString) {
    var jQuerySVG = svgString;

    // If passed a string, convert to JQuery object other assume we already have a JQuery object
    if (typeof svgString === 'string') {
       jQuerySVG = SVG_optimise.svgToJQueryObject(svgString);
    }

    this.elements = SVG_Element.prototype.getChild(jQuerySVG);
    this.options = {
        whitespace: 'remove',
        positionDecimals: SVG_optimise.getRoundingFunction('decimal places', 1),
        removeRedundantShapes: true,
        removeCleanGroups: true,
    };
};

SVG_Root.prototype.optimise = function() {
    return this.elements.optimise(this.options);
};

// Return a string representing an SVG
SVG_Root.prototype.write = function() {
    this.options.newLine = (this.options.whitespace === 'remove') ? "": "\n";
    return this.elements.write(this.options);
};

// Return an SVG objec that can be inserted into the DOM
SVG_Root.prototype.createSVGObject = function() {
    return  this.elements.createSVGObject();
};

//var obj = new SVG_Root()
