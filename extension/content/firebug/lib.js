/* See license.txt for terms of usage */

var FBL = fbXPCOMUtils;

try { /*@explore*/

(function() {

// ************************************************************************************************
// Constants

const Cc = Components.classes;
const Ci = Components.interfaces;

this.fbs = Cc["@joehewitt.com/firebug;1"].getService().wrappedJSObject;
this.httpObserver = this.CCSV("@joehewitt.com/firebug-http-observer;1", "nsIObserverService");
this.jsd = this.CCSV("@mozilla.org/js/jsd/debugger-service;1", "jsdIDebuggerService");
this.versionChecker = this.CCSV("@mozilla.org/xpcom/version-comparator;1", Ci.nsIVersionComparator);
this.appInfo = this.CCSV("@mozilla.org/xre/app-info;1", Ci.nsIXULAppInfo);

const finder = this.finder = this.CCIN("@mozilla.org/embedcomp/rangefind;1", "nsIFind");
const wm = this.CCSV("@mozilla.org/appshell/window-mediator;1", "nsIWindowMediator");
const ioService = this.CCSV("@mozilla.org/network/io-service;1", "nsIIOService");


// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

const reNotWhitespace = /[^\s]/;
const reSplitFile = /:\/{1,3}(.*?)\/([^\/]*?)\/?($|\?.*)/;
const reURL = /(([^:]+:)\/{1,2}[^\/]*)(.*?)$/;  // This RE and the previous one should changed to be consistent
const reChromeCase = /chrome:\/\/([^/]*)\/(.*?)$/;
// Globals
this.reDataURL = /data:text\/javascript;fileName=([^;]*);baseLineNumber=(\d*?),((?:.*?%0A)|(?:.*))/g;
this.reJavascript = /\s*javascript:\s*(.*)/;
this.reChrome = /chrome:\/\/([^\/]*)\//;
this.reCSS = /\.css$/;
this.reFile = /file:\/\/([^\/]*)\//;
this.reUpperCase = /[A-Z]/;

const reSplitLines = /\r\n|\r|\n/;
const reFunctionArgNames = /function ([^(]*)\(([^)]*)\)/;
const reGuessFunction = /['"]?([0-9A-Za-z_]+)['"]?\s*[:=]\s*(function|eval|new Function)/;
const reWord = /([A-Za-z_$][A-Za-z_$0-9]*)(\.([A-Za-z_$][A-Za-z_$0-9]*))*/;

const overrideDefaultsWithPersistedValuesTimeout = 500;

const NS_SEEK_SET = Ci.nsISeekableStream.NS_SEEK_SET;

// ************************************************************************************************
// Namespaces

var namespaces = [];

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.ns = function(fn)
{
    var ns = {};
    namespaces.push(fn, ns);
    return ns;
};

this.initialize = function()
{
    if (FBTrace.DBG_INITIALIZE)
        FBTrace.sysout("FBL.initialize BEGIN "+namespaces.length+" namespaces\n");

    for (var i = 0; i < namespaces.length; i += 2)
    {
        var fn = namespaces[i];
        var ns = namespaces[i+1];
        fn.apply(ns);
    }

    if (FBTrace.DBG_INITIALIZE)
        FBTrace.sysout("FBL.initialize END "+namespaces.length+" namespaces\n");
};

// ************************************************************************************************
// Basics

this.bind = function()  // fn, thisObject, args => thisObject.fn(args, arguments);
{
   var args = cloneArray(arguments), fn = args.shift(), object = args.shift();
   return function() { return fn.apply(object, arrayInsert(cloneArray(args), 0, arguments)); }
};

this.bindFixed = function() // fn, thisObject, args => thisObject.fn(args);
{
    var args = cloneArray(arguments), fn = args.shift(), object = args.shift();
    return function() { return fn.apply(object, args); }
};

this.extend = function(l, r)
{
    var newOb = {};
    for (var n in l)
        newOb[n] = l[n];
    for (var n in r)
        newOb[n] = r[n];
    return newOb;
};

this.keys = function(map)  // At least sometimes the keys will be on user-level window objects
{
    var keys = [];
    try
    {
        for (var name in map)  // enumeration is safe
            keys.push(name);   // name is string, safe
    }
    catch (exc)
    {
        // Sometimes we get exceptions trying to iterate properties
    }

    return keys;  // return is safe
};

this.values = function(map)
{
    var values = [];
    try
    {
        for (var name in map)
        {
            try
            {
                values.push(map[name]);
            }
            catch (exc)
            {
                // Sometimes we get exceptions trying to access properties
                if (FBTrace.DBG_ERRORS)
                    FBTrace.dumpPropreties("lib.values FAILED ", exc);
            }

        }
    }
    catch (exc)
    {
        // Sometimes we get exceptions trying to iterate properties
        if (FBTrace.DBG_ERRORS)
            FBTrace.dumpPropreties("lib.values FAILED ", exc);
    }

    return values;
};

this.remove = function(list, item)
{
    for (var i = 0; i < list.length; ++i)
    {
        if (list[i] == item)
        {
            list.splice(i, 1);
            break;
        }
    }
};

this.sliceArray = function(array, index)
{
    var slice = [];
    for (var i = index; i < array.length; ++i)
        slice.push(array[i]);

    return slice;
};

function cloneArray(array, fn)
{
   var newArray = [];

   if (fn)
       for (var i = 0; i < array.length; ++i)
           newArray.push(fn(array[i]));
   else
       for (var i = 0; i < array.length; ++i)
           newArray.push(array[i]);

   return newArray;
}

function extendArray(array, array2)
{
   var newArray = [];
   newArray.push.apply(newArray, array);
   newArray.push.apply(newArray, array2);
   return newArray;
}

this.extendArray = extendArray;
this.cloneArray = cloneArray;

function arrayInsert(array, index, other)
{
   for (var i = 0; i < other.length; ++i)
       array.splice(i+index, 0, other[i]);

   return array;
}

this.arrayInsert = arrayInsert;

this.safeToString = function(ob)
{
    try
    {
        if (!ob)
        {
            if (ob == undefined)
                return 'undefined';
            if (ob == null)
                return 'null';
            if (ob == false)
                return 'false';
            return "";
        }
        if (ob && (typeof (ob['toString']) == "function") )
            return ob.toString();
        if (ob && typeof (ob['toSource']) == 'function')
            return ob.toSource();
        var str = "[";
        for (var p in ob)
            str += p+',';
        return str + ']';
    }
    catch (exc)
    {
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("safeToString FAILS "+exc, exc);
    }
    return "[unsupported: no toString() function in type "+typeof(ob)+"]";
};

this.convertToUnicode = function(text, charset)
{
    if (!text)
        return "";

    try
    {
        var conv = this.CCSV("@mozilla.org/intl/scriptableunicodeconverter", "nsIScriptableUnicodeConverter");
        conv.charset = charset ? charset : "UTF-8";
        return conv.ConvertToUnicode(text);
    }
    catch (exc)
    {
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("lib.convertToUnicode: fails: for charset "+charset+" conv.charset:"+conv.charset+" exc: "+exc, exc);
        // the exception is worthless, make up a new one
        throw new Error("Firebug failed to convert to unicode using charset: "+conv.charset+" in @mozilla.org/intl/scriptableunicodeconverter");
    }
};

this.convertFromUnicode = function(text, charset)
{
    if (!text)
        return "";

    try
    {
        var conv = this.CCSV("@mozilla.org/intl/scriptableunicodeconverter", "nsIScriptableUnicodeConverter");
        conv.charset = charset ? charset : "UTF-8";
        return conv.ConvertFromUnicode(text);
    }
    catch (exc)
    {
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("lib.convertFromUnicode: fails: for charset "+charset+" conv.charset:"+conv.charset+" exc: "+exc, exc);
    }
};

this.getPlatformName = function()
{
    return this.CCSV("@mozilla.org/xre/app-info;1", "nsIXULRuntime").OS;
};

this.beep = function()
{
    var sounder = this.CCSV("@mozilla.org/sound;1", "nsISound");
    sounder.beep();
};

this.getUniqueId = function() {
    return this.getRandomInt(0,65536);
}

this.getRandomInt = function(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

this.createStyleSheet = function(doc, url)
{
    var style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.setAttribute("charset","utf-8");
    style.firebugIgnore = true;
    style.setAttribute("type", "text/css");
    style.innerHTML = this.getResource(url);
    return style;
}

this.addStyleSheet = function(doc, style)
{
    var heads = doc.getElementsByTagName("head");
    if (heads.length)
        heads[0].appendChild(style);
    else
        doc.documentElement.appendChild(style);
};

this.addScript = function(doc, id, src)
{
    var element = doc.createElementNS("http://www.w3.org/1999/xhtml", "html:script");
    element.setAttribute("type", "text/javascript");
    element.setAttribute("id", id);
    if (!FBTrace.DBG_CONSOLE)
        element.firebugIgnore = true;

    element.innerHTML = src;
    if (doc.documentElement)
        doc.documentElement.appendChild(element);
    else
    {
        // See issue 1079, the svg test case gives this error
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("lib.addScript doc has no documentElement:", doc);
    }
    return element;
}

// ************************************************************************************************
// Localization

/*
 * $STR - intended for localization of a static string.
 * $STRF - intended for localization of a string with dynamically inserted values.
 *
 * Notes:
 * 1) Name with _ in place of spaces is the key in the firebug.properties file.
 * 2) If the specified key isn't localized for particular language, both methods use
 *    the part after the last dot (in the specified name) as the return value.
 *
 * Examples:
 * $STR("Label"); - search for key "Label" within the firebug.properties file
 *                 and returns its value. If the key doesn't exist returns "Label".
 *
 * $STR("Button Label"); - search for key "Button_Label" withing the firebug.properties
 *                        file. If the key doesn't exist returns "Button Label".
 *
 * $STR("net.Response Header"); - search for key "net.Response_Header". If the key doesn't
 *                               exist returns "Response Header".
 *
 * firebug.properties:
 * net.timing.Request_Time=Request Time: %S [%S]
 *
 * var param1 = 10;
 * var param2 = "ms";
 * $STRF("net.timing.Request Time", param1, param2);  -> "Request Time: 10 [ms]"
 *
 * - search for key "net.timing.Request_Time" within the firebug.properties file. Parameters
 *   are inserted at specified places (%S) in the same order as they are passed. If the
 *   key doesn't exist the method returns "Request Time".
 */
function $STR(name, bundle)
{
    try
    {
        if (typeof bundle == "string")
            bundle = document.getElementById(bundle);

        if (bundle)
            return bundle.getString(name.replace(' ', '_', "g"));

        if (Firebug)
            return Firebug.getStringBundle().GetStringFromName(name.replace(' ', '_', "g"));
    }
    catch (err)
    {
        if (FBTrace.DBG_LOCALE)
        {
            FBTrace.sysout("lib.getString: " + name + "\n");
            FBTrace.sysout("lib.getString FAILS ", err);
        }
    }

    // XXXjjb apparently we get to this code if we get an exception above...is that best we can do?

    // Use only the label after last dot.
    var index = name.lastIndexOf(".");
    if (index > 0 && name.charAt(index-1) != "\\")
        name = name.substr(index + 1);
    name = name.replace("_", " ");

    return name;
}

function $STRF(name, args, bundle)
{
    try
    {
        // xxxHonza: Workaround for #485511
        if (!bundle)
            bundle = "strings_firebug";

        if (typeof bundle == "string")
            bundle = document.getElementById(bundle);

        if (bundle)
            return bundle.getFormattedString(name.replace(' ', '_', "g"), args);
        else
            return Firebug.getStringBundle().formatStringFromName(name.replace(' ', '_', "g"), args, args.length);
    }
    catch (err)
    {
        if (FBTrace.DBG_LOCALE)
        {
            FBTrace.sysout("lib.getString: " + name + "\n");
            FBTrace.sysout("lib.getString FAILS ", err);
        }
    }

    // Use only the label after last dot.
    var index = name.lastIndexOf(".");
    if (index > 0)
        name = name.substr(index + 1);

    return name;
}

this.$STR = $STR;
this.$STRF = $STRF;

/*
 * Use the current value of the attribute as a key to look up the localized value.
 */
this.internationalize = function(element, attr, args)
{
    if (typeof element == "string")
        element = document.getElementById(element);

    if (element)
    {
        var xulString = element.getAttribute(attr);
        if (xulString)
        {
            var localized = args ? $STRF(xulString, args) : $STR(xulString);

            // Set localized value of the attribute.
            element.setAttribute(attr, localized);
        }
    }
    else
    {
        if (FBTrace.DBG_LOCALE)
            FBTrace.sysout("Failed to internationalize element with attr "+attr+' args:'+args);
    }
}

// ************************************************************************************************
// Visibility

this.isVisible = function(elt)
{
    if (elt instanceof XULElement)
    {
        //FBTrace.sysout("isVisible elt.offsetWidth: "+elt.offsetWidth+" offsetHeight:"+ elt.offsetHeight+" localName:"+ elt.localName+" nameSpace:"+elt.nameSpaceURI+"\n");
        return (!elt.hidden && !elt.collapsed);
    }
    return elt.offsetWidth > 0 || elt.offsetHeight > 0 || elt.localName in invisibleTags
        || elt.namespaceURI == "http://www.w3.org/2000/svg"
        || elt.namespaceURI == "http://www.w3.org/1998/Math/MathML";
};

this.collapse = function(elt, collapsed)
{
    elt.setAttribute("collapsed", collapsed ? "true" : "false");
};

this.obscure = function(elt, obscured)
{
    if (obscured)
        this.setClass(elt, "obscured");
    else
        this.removeClass(elt, "obscured");
};

this.hide = function(elt, hidden)
{
    elt.style.visibility = hidden ? "hidden" : "visible";
};

this.clearNode = function(node)
{
    node.innerHTML = "";
};

this.eraseNode = function(node)
{
    while (node.lastChild)
        node.removeChild(node.lastChild);
};

// ************************************************************************************************
// Window iteration

this.iterateWindows = function(win, handler)
{
    if (!win || !win.document)
        return;

    handler(win);

    if (win == top || !win.frames) return; // XXXjjb hack for chromeBug

    for (var i = 0; i < win.frames.length; ++i)
    {
        var subWin = win.frames[i];
        if (subWin != win)
            this.iterateWindows(subWin, handler);
    }
};

this.getRootWindow = function(win)
{
    for (; win; win = win.parent)
    {
        if (!win.parent || win == win.parent || !(win.parent instanceof Window) )
            return win;
    }
    return null;
};

// ************************************************************************************************
// CSS classes

this.hasClass = function(node, name) // className, className, ...
{
    if (!node || node.nodeType != 1)
        return false;
    else
    {
        for (var i=1; i<arguments.length; ++i)
        {
            var name = arguments[i];
            var re = new RegExp("(^|\\s)"+name+"($|\\s)");
            if (!re.exec(node.getAttribute("class")))
                return false;
        }

        return true;
    }
};

this.setClass = function(node, name)
{
    if (node && !this.hasClass(node, name))
        node.className += " " + name;
};

this.getClassValue = function(node, name)
{
    var re = new RegExp(name+"-([^ ]+)");
    var m = re.exec(node.className);
    return m ? m[1] : "";
};

this.removeClass = function(node, name)
{
    if (node && node.className)
    {
        var index = node.className.indexOf(name);
        if (index >= 0)
        {
            var size = name.length;
            node.className = node.className.substr(0,index-1) + node.className.substr(index+size);
        }
    }
};

this.toggleClass = function(elt, name)
{
    if (this.hasClass(elt, name))
        this.removeClass(elt, name);
    else
        this.setClass(elt, name);
};

this.setClassTimed = function(elt, name, context, timeout)
{
    if (!timeout)
        timeout = 1300;

    if (elt.__setClassTimeout)
        context.clearTimeout(elt.__setClassTimeout);
    else
        this.setClass(elt, name);

    if (!this.isVisible(elt))
    {
        if (elt.__invisibleAtSetPoint)
            elt.__invisibleAtSetPoint--;
        else
            elt.__invisibleAtSetPoint = 5;
    }

    elt.__setClassTimeout = context.setTimeout(function()
    {
        delete elt.__setClassTimeout;

        if (elt.__invisibleAtSetPoint)
            FBL.setClassTimed(elt, name, context, timeout);
        else
        {
            delete elt.__invisibleAtSetPoint;
            FBL.removeClass(elt, name);
        }
    }, timeout);
};

this.cancelClassTimed = function(elt, name, context)
{
    if (elt.__setClassTimeout)
    {
        FBL.removeClass(elt, name);
        context.clearTimeout(elt.__setClassTimeout);
        delete elt.__setClassTimeout;
    }
};

// ************************************************************************************************
// DOM queries

this.$ = function(id, doc)
{
    if (doc)
        return doc.getElementById(id);
    else
        return document.getElementById(id);
};

this.getChildByClass = function(node) // ,classname, classname, classname...
{
    for (var i = 1; i < arguments.length; ++i)
    {
        var className = arguments[i];
        var child = node.firstChild;
        node = null;
        for (; child; child = child.nextSibling)
        {
            if (this.hasClass(child, className))
            {
                node = child;
                break;
            }
        }
    }

    return node;
};

this.getAncestorByClass = function(node, className)
{
    for (var parent = node; parent; parent = parent.parentNode)
    {
        if (this.hasClass(parent, className))
            return parent;
    }

    return null;
};

this.getElementByClass = function(node, className)  // className, className, ...
{
    var args = cloneArray(arguments); args.splice(0, 1);
    for (var child = node.firstChild; child; child = child.nextSibling)
    {
        var args1 = cloneArray(args); args1.unshift(child);
        if (FBL.hasClass.apply(null, args1))
            return child;
        else
        {
            var found = FBL.getElementByClass.apply(null, args1);
            if (found)
                return found;
        }
    }

    return null;
};

this.getElementsByClass = function(node, className)  // className, className, ...
{
    function iteratorHelper(node, classNames, result)
    {
        for (var child = node.firstChild; child; child = child.nextSibling)
        {
            var args1 = cloneArray(classNames); args1.unshift(child);
            if (FBL.hasClass.apply(null, args1))
                result.push(child);

            iteratorHelper(child, classNames, result);
        }
    }

    var result = [];
    var args = cloneArray(arguments); args.shift();
    iteratorHelper(node, args, result);
    return result;
};

this.getElementsByAttribute = function(node, attrName, attrValue)
{
    function iteratorHelper(node, attrName, attrValue, result)
    {
        for (var child = node.firstChild; child; child = child.nextSibling)
        {
            if (child.getAttribute(attrName) == attrValue)
                result.push(child);

            iteratorHelper(child, attrName, attrValue, result);
        }
    }

    var result = [];
    iteratorHelper(node, attrName, attrValue, result);
    return result;
}

this.isAncestor = function(node, potentialAncestor)
{
    for (var parent = node; parent; parent = parent.parentNode)
    {
        if (parent == potentialAncestor)
            return true;
    }

    return false;
};

this.getNextElement = function(node)
{
    while (node && node.nodeType != 1)
        node = node.nextSibling;

    return node;
};

this.getPreviousElement = function(node)
{
    while (node && node.nodeType != 1)
        node = node.previousSibling;

    return node;
};

this.getBody = function(doc)
{
    if (doc.body)
        return doc.body;

    var body = doc.getElementsByTagName("body")[0];
    if (body)
        return body;

    return doc.documentElement;  // For non-HTML docs
};

this.findNextDown = function(node, criteria)
{
    if (!node)
        return null;

    for (var child = node.firstChild; child; child = child.nextSibling)
    {
        if (criteria(child))
            return child;

        var next = this.findNextDown(child, criteria);
        if (next)
            return next;
    }
};

this.findPreviousUp = function(node, criteria)
{
    if (!node)
        return null;

    for (var child = node.lastChild; child; child = child.previousSibling)
    {
        var next = this.findPreviousUp(child, criteria);
        if (next)
            return next;

        if (criteria(child))
            return child;
    }
};

this.findNext = function(node, criteria, upOnly, maxRoot)
{
    if (!node)
        return null;

    if (!upOnly)
    {
        var next = this.findNextDown(node, criteria);
        if (next)
            return next;
    }

    for (var sib = node.nextSibling; sib; sib = sib.nextSibling)
    {
        if (criteria(sib))
            return sib;

        var next = this.findNextDown(sib, criteria);
        if (next)
            return next;
    }

    if (node.parentNode && node.parentNode != maxRoot)
        return this.findNext(node.parentNode, criteria, true);
};

this.findPrevious = function(node, criteria, downOnly, maxRoot)
{
    if (!node)
        return null;

    for (var sib = node.previousSibling; sib; sib = sib.previousSibling)
    {
        var prev = this.findPreviousUp(sib, criteria);
        if (prev)
            return prev;

        if (criteria(sib))
            return sib;
    }

    if (!downOnly)
    {
        var next = this.findPreviousUp(node, criteria);
        if (next)
            return next;
    }

    if (node.parentNode && node.parentNode != maxRoot)
    {
        if (criteria(node.parentNode))
            return node.parentNode;

        return this.findPrevious(node.parentNode, criteria, true);
    }
};

this.getNextByClass = function(root, state)
{
    function iter(node) { return node.nodeType == 1 && FBL.hasClass(node, state); }
    return this.findNext(root, iter);
};

this.getPreviousByClass = function(root, state)
{
    function iter(node) { return node.nodeType == 1 && FBL.hasClass(node, state); }
    return this.findPrevious(root, iter);
};

this.hasChildElements = function(node)
{
    if (node.contentDocument) // iframes
        return true;

    for (var child = node.firstChild; child; child = child.nextSibling)
    {
        if (child.nodeType == 1)
            return true;
    }

    return false;
};

this.isElement = function(o)
{
    try {
        return o && o instanceof Element;
    }
    catch (ex) {
        return false;
    }
};

this.isNode = function(o)
{
    try {
        return o && o instanceof Node;
    }
    catch (ex) {
        return false;
    }
};

this.XW_instanceof = function(obj, type) // Cross Window instanceof; type is local to this window
{
    if (obj instanceof type)
        return true;  // within-window test

    if (!type)
        return false;
    if (!obj)
        return (type == "undefined");

    // compare strings: obj constructor.name to type.name.
    // This is not perfect, we should compare type.prototype to object.__proto__, but mostly code does not change the constructor object.
    do
    {
        if (obj.constructor && obj.constructor.name == type.name)  // then the function that constructed us is the argument
            return true;
    }
    while(obj = obj.__proto__);  // walk the prototype chain.
    return false;
    // https://developer.mozilla.org/en/Core_JavaScript_1.5_Guide/Property_Inheritance_Revisited/Determining_Instance_Relationships
}

// ************************************************************************************************
// DOM Modification

this.setOuterHTML = function(element, html)
{
    var doc = element.ownerDocument;
    var range = doc.createRange();
    range.selectNode(element || doc.documentElement);

    var fragment = range.createContextualFragment(html);
    var first = fragment.firstChild;
    var last = fragment.lastChild;
    element.parentNode.replaceChild(fragment, element);
    return [first, last];
};

this.appendInnerHTML = function(element, html, referenceElement)
{
    var doc = element.ownerDocument;
    var range = doc.createRange();  // a helper object
    range.selectNodeContents(element); // the environment to interpret the html

    var fragment = range.createContextualFragment(html);  // parse
    var firstChild = fragment.firstChild;
    element.insertBefore(fragment, referenceElement);
    return firstChild;
};

this.insertTextIntoElement = function(element, text)
{
    var command = "cmd_insertText";

    var controller = element.controllers.getControllerForCommand(command);
    if (!controller || !controller.isCommandEnabled(command))
        return;

    var params = this.CCIN("@mozilla.org/embedcomp/command-params;1", "nsICommandParams");
    params.setStringValue("state_data", text);

    controller = this.QI(controller, Ci.nsICommandController);
    controller.doCommandWithParams(command, params);
};

// ************************************************************************************************
// XPath

/**
 * Gets an XPath for an element which describes its hierarchical location.
 */
this.getElementXPath = function(element)
{
    if (element && element.id)
        return '//*[@id="' + element.id + '"]';
    else
        return this.getElementTreeXPath(element);
};

this.getElementTreeXPath = function(element)
{
    var paths = [];

    for (; element && element.nodeType == 1; element = element.parentNode)
    {
        var index = 0;
        for (var sibling = element.previousSibling; sibling; sibling = sibling.previousSibling)
        {
            if (sibling.localName == element.localName)
                ++index;
        }

        var tagName = element.localName.toLowerCase();
        var pathIndex = (index ? "[" + (index+1) + "]" : "");
        paths.splice(0, 0, tagName + pathIndex);
    }

    return paths.length ? "/" + paths.join("/") : null;
};

this.cssToXPath = function(rule)
{
    var regElement = /^([#.]?)([a-z0-9\\*_-]*)((\|)([a-z0-9\\*_-]*))?/i;
    var regAttr1 = /^\[([^\]]*)\]/i;
    var regAttr2 = /^\[\s*([^~=\s]+)\s*(~?=)\s*"([^"]+)"\s*\]/i;
    var regPseudo = /^:([a-z_-])+/i;
    var regCombinator = /^(\s*[>+\s])?/i;
    var regComma = /^\s*,/i;

    var index = 1;
    var parts = ["//", "*"];
    var lastRule = null;

    while (rule.length && rule != lastRule)
    {
        lastRule = rule;

        // Trim leading whitespace
        rule = this.trimLeft(rule);
        if (!rule.length)
            break;

        // Match the element identifier
        var m = regElement.exec(rule);
        if (m)
        {
            if (!m[1])
            {
                // XXXjoe Namespace ignored for now
                if (m[5])
                    parts[index] = m[5];
                else
                    parts[index] = m[2];
            }
            else if (m[1] == '#')
                parts.push("[@id='" + m[2] + "']");
            else if (m[1] == '.')
                parts.push("[contains(@class, '" + m[2] + "')]");

            rule = rule.substr(m[0].length);
        }

        // Match attribute selectors
        m = regAttr2.exec(rule);
        if (m)
        {
            if (m[2] == "~=")
                parts.push("[contains(@" + m[1] + ", '" + m[3] + "')]");
            else
                parts.push("[@" + m[1] + "='" + m[3] + "']");

            rule = rule.substr(m[0].length);
        }
        else
        {
            m = regAttr1.exec(rule);
            if (m)
            {
                parts.push("[@" + m[1] + "]");
                rule = rule.substr(m[0].length);
            }
        }

        // Skip over pseudo-classes and pseudo-elements, which are of no use to us
        m = regPseudo.exec(rule);
        while (m)
        {
            rule = rule.substr(m[0].length);
            m = regPseudo.exec(rule);
        }

        // Match combinators
        m = regCombinator.exec(rule);
        if (m && m[0].length)
        {
            if (m[0].indexOf(">") != -1)
                parts.push("/");
            else if (m[0].indexOf("+") != -1)
                parts.push("/following-sibling::");
            else
                parts.push("//");

            index = parts.length;
            parts.push("*");
            rule = rule.substr(m[0].length);
        }

        m = regComma.exec(rule);
        if (m)
        {
            parts.push(" | ", "//", "*");
            index = parts.length-1;
            rule = rule.substr(m[0].length);
        }
    }

    var xpath = parts.join("");
    return xpath;
};

this.getElementsBySelector = function(doc, css)
{
    var xpath = this.cssToXPath(css);
    return this.getElementsByXPath(doc, xpath);
};

this.getElementsByXPath = function(doc, xpath)
{
    var nodes = [];

    try {
        var result = doc.evaluate(xpath, doc, null, XPathResult.ANY_TYPE, null);
        for (var item = result.iterateNext(); item; item = result.iterateNext())
            nodes.push(item);
    }
    catch (exc)
    {
        // Invalid xpath expressions make their way here sometimes.  If that happens,
        // we still want to return an empty set without an exception.
    }

    return nodes;
};

this.getRuleMatchingElements = function(rule, doc)
{
    var css = rule.selectorText;
    var xpath = this.cssToXPath(css);
    return this.getElementsByXPath(doc, xpath);
};

// ************************************************************************************************
// Clipboard

this.copyToClipboard = function(string)
{
    var clipboard = this.CCSV("@mozilla.org/widget/clipboardhelper;1", "nsIClipboardHelper");
    clipboard.copyString(string);
};

// ************************************************************************************************
// Graphics

this.getClientOffset = function(elt)
{
    function addOffset(elt, coords, view)
    {
        var p = elt.offsetParent;

        var style = view.getComputedStyle(elt, "");

        if (elt.offsetLeft)
            coords.x += elt.offsetLeft + parseInt(style.borderLeftWidth);
        if (elt.offsetTop)
            coords.y += elt.offsetTop + parseInt(style.borderTopWidth);

        if (p)
        {
            if (p.nodeType == 1)
                addOffset(p, coords, view);
        }
        else if (elt.ownerDocument.defaultView.frameElement)
            addOffset(elt.ownerDocument.defaultView.frameElement, coords, elt.ownerDocument.defaultView);
    }

    var coords = {x: 0, y: 0};
    if (elt)
    {
        var view = elt.ownerDocument.defaultView;
        addOffset(elt, coords, view);
    }

    return coords;
};

this.getLTRBWH = function(elt)
{
    var bcrect, od, odb, odde,
        dims = {"left": 0, "top": 0, "right": 0, "bottom": 0, "width": 0, "height": 0};

    if (elt)
    {
        od = elt.ownerDocument;
        odb = od.body;
        odde = od.documentElement;
        bcrect = elt.getBoundingClientRect();
        dims.left = bcrect.left;
        dims.top = bcrect.top;
        dims.right = bcrect.right;
        dims.bottom = bcrect.bottom;

        if(bcrect.width)
        {
            dims.width = bcrect.width;
            dims.height = bcrect.height;
        }
        else
        {
            dims.width = dims.right - dims.left;
            dims.height = dims.bottom - dims.top;
        }

        if(odb && odb.scrollTop)
        {
            dims.top += odb.scrollTop;
            dims.left += odb.scrollLeft;
        }
        else if(odde && odde.scrollTop)
        {
            dims.top += odde.scrollTop;
            dims.left += odde.scrollLeft;
        }
    }
    return dims;
};

this.applyBodyOffsets = function(elt, clientRect)
{
    var od = elt.ownerDocument;
    if (!od.body)
        return clientRect;

    var style = od.defaultView.getComputedStyle(od.body, null);

    var pos = style.getPropertyValue('position');
    if(pos === 'absolute' || pos === 'relative')
    {
        var borderLeft = parseInt(style.getPropertyValue('border-left-width').replace('px', ''),10) || 0;
        var borderTop = parseInt(style.getPropertyValue('border-top-width').replace('px', ''),10) || 0;
        var paddingLeft = parseInt(style.getPropertyValue('padding-left').replace('px', ''),10) || 0;
        var paddingTop = parseInt(style.getPropertyValue('padding-top').replace('px', ''),10) || 0;
        var marginLeft = parseInt(style.getPropertyValue('margin-left').replace('px', ''),10) || 0;
        var marginTop = parseInt(style.getPropertyValue('margin-top').replace('px', ''),10) || 0;

        var offsetX = borderLeft + paddingLeft + marginLeft;
        var offsetY = borderTop + paddingTop + marginTop;

        clientRect.left -= offsetX;
        clientRect.top -= offsetY;
        clientRect.right -= offsetX;
        clientRect.bottom -= offsetY;
    }

    return clientRect;
};

this.getOffsetSize = function(elt)
{
    return {width: elt.offsetWidth, height: elt.offsetHeight};
};

this.getOverflowParent = function(element)
{
    for (var scrollParent = element.parentNode; scrollParent; scrollParent = scrollParent.offsetParent)
    {
        if (scrollParent.scrollHeight > scrollParent.offsetHeight)
            return scrollParent;
    }
};

this.isScrolledToBottom = function(element)
{
    var onBottom = (element.scrollTop + element.offsetHeight) == element.scrollHeight;
    if (FBTrace.DBG_CONSOLE)
        FBTrace.sysout("isScrolledToBottom offsetHeight: "+element.offsetHeight +" onBottom:"+onBottom);
    return onBottom;
};

this.scrollToBottom = function(element)
{
        element.scrollTop = element.scrollHeight;

        if (FBTrace.DBG_CONSOLE)
        {
            FBTrace.sysout("scrollToBottom reset scrollTop "+element.scrollTop+" = "+element.scrollHeight);
            if (element.scrollHeight == element.offsetHeight)
                FBTrace.sysout("scrollToBottom attempt to scroll non-scrollable element "+element, element);
        }

        return (element.scrollTop == element.scrollHeight);
};

this.move = function(element, x, y)
{
    element.style.left = x + "px";
    element.style.top = y + "px";
};

this.resize = function(element, w, h)
{
    element.style.width = w + "px";
    element.style.height = h + "px";
};

this.linesIntoCenterView = function(element, scrollBox)  // {before: int, after: int}
{
    if (!scrollBox)
        scrollBox = this.getOverflowParent(element);

    if (!scrollBox)
        return;

    var offset = this.getClientOffset(element);

    var topSpace = offset.y - scrollBox.scrollTop;
    var bottomSpace = (scrollBox.scrollTop + scrollBox.clientHeight)
            - (offset.y + element.offsetHeight);

    if (topSpace < 0 || bottomSpace < 0)
    {
        var split = (scrollBox.clientHeight/2);
        var centerY = offset.y - split;
        scrollBox.scrollTop = centerY;
        topSpace = split;
        bottomSpace = split -  element.offsetHeight;
    }

    return {before: Math.round((topSpace/element.offsetHeight) + 0.5),
            after: Math.round((bottomSpace/element.offsetHeight) + 0.5) }
};

this.scrollIntoCenterView = function(element, scrollBox, notX, notY)
{
    if (!element)
        return;

    if (!scrollBox)
        scrollBox = this.getOverflowParent(element);

    if (!scrollBox)
        return;

    var offset = this.getClientOffset(element);

    if (!notY)
    {
        var topSpace = offset.y - scrollBox.scrollTop;
        var bottomSpace = (scrollBox.scrollTop + scrollBox.clientHeight)
            - (offset.y + element.offsetHeight);

        if (topSpace < 0 || bottomSpace < 0)
        {
            var centerY = offset.y - (scrollBox.clientHeight/2);
            scrollBox.scrollTop = centerY;
        }
    }

    if (!notX)
    {
        var leftSpace = offset.x - scrollBox.scrollLeft;
        var rightSpace = (scrollBox.scrollLeft + scrollBox.clientWidth)
            - (offset.x + element.clientWidth);

        if (leftSpace < 0 || rightSpace < 0)
        {
            var centerX = offset.x - (scrollBox.clientWidth/2);
            scrollBox.scrollLeft = centerX;
        }
    }
    if (FBTrace.DBG_SOURCEFILES)
        FBTrace.sysout("lib.scrollIntoCenterView ","Element:"+element.innerHTML);
};

// ************************************************************************************************
// CSS

var cssKeywordMap = null;
var cssPropNames = null;
var cssColorNames = null;

this.getCSSKeywordsByProperty = function(propName)
{
    if (!cssKeywordMap)
    {
        cssKeywordMap = {};

        for (var name in this.cssInfo)
        {
            var list = [];

            var types = this.cssInfo[name];
            for (var i = 0; i < types.length; ++i)
            {
                var keywords = this.cssKeywords[types[i]];
                if (keywords)
                    list.push.apply(list, keywords);
            }

            cssKeywordMap[name] = list;
        }
    }

    return propName in cssKeywordMap ? cssKeywordMap[propName] : [];
};

this.getCSSPropertyNames = function()
{
    if (!cssPropNames)
    {
        cssPropNames = [];

        for (var name in this.cssInfo)
            cssPropNames.push(name);
    }

    return cssPropNames;
};

this.isColorKeyword = function(keyword)
{
    if (keyword == "transparent")
        return false;

    if (!cssColorNames)
    {
        cssColorNames = [];

        var colors = this.cssKeywords["color"];
        for (var i = 0; i < colors.length; ++i)
            cssColorNames.push(colors[i].toLowerCase());

        var systemColors = this.cssKeywords["systemColor"];
        for (var i = 0; i < systemColors.length; ++i)
            cssColorNames.push(systemColors[i].toLowerCase());
    }

    return cssColorNames.indexOf(keyword.toLowerCase()) != -1;
};

this.copyTextStyles = function(fromNode, toNode, style)
{
    var view = fromNode.ownerDocument.defaultView;
    if (view)
    {
        if (!style)
            style = view.getComputedStyle(fromNode, "");

        toNode.style.fontFamily = style.getPropertyCSSValue("font-family").cssText;
        toNode.style.fontSize = style.getPropertyCSSValue("font-size").cssText;
        toNode.style.fontWeight = style.getPropertyCSSValue("font-weight").cssText;
        toNode.style.fontStyle = style.getPropertyCSSValue("font-style").cssText;

        return style;
    }
};

this.copyBoxStyles = function(fromNode, toNode, style)
{
    var view = fromNode.ownerDocument.defaultView;
    if (view)
    {
        if (!style)
            style = view.getComputedStyle(fromNode, "");

        toNode.style.marginTop = style.getPropertyCSSValue("margin-top").cssText;
        toNode.style.marginRight = style.getPropertyCSSValue("margin-right").cssText;
        toNode.style.marginBottom = style.getPropertyCSSValue("margin-bottom").cssText;
        toNode.style.marginLeft = style.getPropertyCSSValue("margin-left").cssText;
        toNode.style.borderTopWidth = style.getPropertyCSSValue("border-top-width").cssText;
        toNode.style.borderRightWidth = style.getPropertyCSSValue("border-right-width").cssText;
        toNode.style.borderBottomWidth = style.getPropertyCSSValue("border-bottom-width").cssText;
        toNode.style.borderLeftWidth = style.getPropertyCSSValue("border-left-width").cssText;

        return style;
    }
};

this.readBoxStyles = function(style)
{
    const styleNames = {
        "margin-top": "marginTop", "margin-right": "marginRight",
        "margin-left": "marginLeft", "margin-bottom": "marginBottom",
        "border-top-width": "borderTop", "border-right-width": "borderRight",
        "border-left-width": "borderLeft", "border-bottom-width": "borderBottom",
        "padding-top": "paddingTop", "padding-right": "paddingRight",
        "padding-left": "paddingLeft", "padding-bottom": "paddingBottom",
        "z-index": "zIndex",
    };

    var styles = {};
    for (var styleName in styleNames)
        styles[styleNames[styleName]] = parseInt(style.getPropertyCSSValue(styleName).cssText);
    if (FBTrace.DBG_INSPECT)
        FBTrace.sysout("readBoxStyles ", styles);
    return styles;
};

this.getBoxFromStyles = function(style, element)
{
    var args = this.readBoxStyles(style);
    args.width = element.offsetWidth
        - (args.paddingLeft+args.paddingRight+args.borderLeft+args.borderRight);
    args.height = element.offsetHeight
        - (args.paddingTop+args.paddingBottom+args.borderTop+args.borderBottom);
    return args;
};

this.getElementCSSSelector = function(element)
{
    var label = element.localName.toLowerCase();
    if (element.id)
        label += "#" + element.id;
    if (element.hasAttribute("class"))
        label += "." + element.getAttribute("class").split(" ")[0];

    return label;
};

this.getURLForStyleSheet= function(styleSheet)
{
    //http://www.w3.org/TR/DOM-Level-2-Style/stylesheets.html#StyleSheets-StyleSheet. For inline style sheets, the value of this attribute is null.
    return (styleSheet.href ? styleSheet.href : styleSheet.ownerNode.ownerDocument.URL);
};

this.getDocumentForStyleSheet = function(styleSheet)
{
    while (styleSheet.parentStyleSheet && !styleSheet.ownerNode)
    {
        styleSheet = styleSheet.parentStyleSheet;
    }
    if (styleSheet.ownerNode)
      return styleSheet.ownerNode.ownerDocument;
};

/**
 * Retrieves the instance number for a given style sheet. The instance number
 * is sheet's index within the set of all other sheets whose URL is the same.
 */
this.getInstanceForStyleSheet = function(styleSheet, ownerDocument)
{
    // System URLs are always unique (or at least we are making this assumption)
    if (FBL.isSystemStyleSheet(styleSheet))
        return 0;

    // ownerDocument is an optional hint for performance
    ownerDocument = ownerDocument || FBL.getDocumentForStyleSheet(styleSheet);

    var ret = 0,
        styleSheets = ownerDocument.styleSheets,
        href = styleSheet.href;
    for (var i = 0; i < styleSheets.length; i++)
    {
        var curSheet = styleSheets[i];
        if (curSheet == styleSheet)
            break;
        if (curSheet.href == href)
            ret++;
    }
    return ret;
};

// ************************************************************************************************
// HTML and XML Serialization


this.isSelfClosing = function (element)
{
    var tag = element.localName.toLowerCase();
    return (this.selfClosingTags.hasOwnProperty(tag));
};

this.getElementHTML = function(element)
{
    var isXhtml= element.ownerDocument.documentElement.namespaceURI == "http://www.w3.org/1999/xhtml";

    var self=this;
    function toHTML(elt)
    {
        if (elt.nodeType == 1)
        {
            html.push('<', elt.localName.toLowerCase());

            for (var i = 0; i < elt.attributes.length; ++i)
            {
                var attr = elt.attributes[i];

                // Hide attributes set by Firebug
                if (attr.localName.indexOf("firebug-") == 0)
                    continue;

                html.push(' ', attr.localName, '=', escapeHTMLAttribute(attr.nodeValue));
            }

            if (elt.firstChild)
            {
                html.push('>');

                var pureText=true;
                for (var child = element.firstChild; child; child = child.nextSibling)
                    pureText=pureText && (child.nodeType == 3);

                if (pureText)
                    html.push(elt.innerHTML)
                else {
                    for (var child = elt.firstChild; child; child = child.nextSibling)
                        toHTML(child);
                }

                html.push('</', elt.localName.toLowerCase(), '>');
            }
            else if (self.isSelfClosing(elt))
            {
                html.push(isXhtml?'/>':'>');
            }
            else
            {
                html.push('></', elt.localName.toLowerCase(), '>');
            }
        }
        else if (elt.nodeType == 3)
            html.push(escapeHTMLnoQuote(elt.nodeValue));
        else if (elt.nodeType == 4)
            html.push('<![CDATA[', elt.nodeValue, ']]>');
        else if (elt.nodeType == 8)
            html.push('<!--', elt.nodeValue, '-->');
    }

    var html = [];
    toHTML(element);
    return html.join("");
};

this.getElementXML = function(element)
{
    function toXML(elt)
    {
        if (elt.nodeType == 1)
        {
            xml.push('<', elt.localName.toLowerCase());

            for (var i = 0; i < elt.attributes.length; ++i)
            {
                var attr = elt.attributes[i];

                // Hide attributes set by Firebug
                if (attr.localName.indexOf("firebug-") == 0)
                    continue;

                xml.push(' ', attr.localName, '=', escapeHTMLAttribute(attr.nodeValue));
            }

            if (elt.firstChild)
            {
                xml.push('>');

                for (var child = elt.firstChild; child; child = child.nextSibling)
                    toXML(child);

                xml.push('</', elt.localName.toLowerCase(), '>');
            }
            else
                xml.push('/>');
        }
        else if (elt.nodeType == 3)
            xml.push(elt.nodeValue);
        else if (elt.nodeType == 4)
            xml.push('<![CDATA[', elt.nodeValue, ']]>');
        else if (elt.nodeType == 8)
            xml.push('<!--', elt.nodeValue, '-->');
    }

    var xml = [];
    toXML(element);
    return xml.join("");
};

// ************************************************************************************************
// String escaping

this.escapeNewLines = function(value)
{
    return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
};

this.stripNewLines = function(value)
{
    return typeof(value) == "string" ? value.replace(/[\r\n]/g, " ") : value;
};

this.escapeJS = function(value)
{
    return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace('"', '\\"', "g");
};

function escapeHTMLAttribute(value)
{
    function replaceChars(ch)
    {
        switch (ch)
        {
            case "&":
                return "&amp;";
            case "'":
                return apos;
            case '"':
                return quot;
        }
        return "?";
    };
    var apos = "&#39;", quot = "&quot;", around = '"';
    if( value.indexOf('"') == -1 ) {
        quot = '"';
        apos = "'";
    } else if( value.indexOf("'") == -1 ) {
        quot = '"';
        around = "'";
    }
    return around + (String(value).replace(/[&'"]/g, replaceChars)) + around;
}

function escapeHTML(value)
{
    function replaceChars(ch)
    {
        switch (ch)
        {
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case "&":
                return "&amp;";
            case "'":
                return "&#39;";
            case '"':
                return "&quot;";
        }
        return "?";
    };
    return String(value).replace(/[<>&"']/g, replaceChars);
}

this.escapeHTML = escapeHTML;

function escapeHTMLnoQuote(value)
{
    function replaceChars(ch)
    {
        switch (ch)
        {
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case "&":
                return "&amp;";
            case "\xa0":
                return "&nbsp;";
        }
        return "?";
    };
    return String(value).replace(/[<>&\xa0]/g, replaceChars);
};

this.escapeHTMLnoQuote = escapeHTMLnoQuote;

this.unEscapeHTML = function(str)
{
    return str.replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
};

this.cropString = function(text, limit, alterText)
{
    if (!alterText)
        alterText = "...";

    text = text + "";

    if (!limit)
        var halfLimit = 50;
    else
        var halfLimit = limit / 2;

    if (text.length > limit)
        return text.substr(0, halfLimit) + alterText + text.substr(text.length-halfLimit);
    else
        return text;
};

this.cropMultipleLines = function(text, limit)
{
    return this.escapeNewLines(this.cropString(text, limit));
};

this.isWhitespace = function(text)
{
    return !reNotWhitespace.exec(text);
};

this.splitLines = function(text)
{
    const reSplitLines2 = /.*(:?\r\n|\n|\r)?/mg;
    var lines;
    if (text.match)
    {
        lines = text.match(reSplitLines2);
    }
    else
    {
        var str = text+"";
        lines = str.match(reSplitLines2);
    }
    lines.pop();
    return lines;
};

this.trimLeft = function(text)
{
    return text.replace(/^\s*|\s*$/g,"");
}

this.wrapText = function(text, noEscapeHTML)
{
    var reNonAlphaNumeric = /[^A-Za-z_$0-9'"-]/;

    var html = [];
    var wrapWidth = Firebug.textWrapWidth;

    // Split long text into lines and put every line into an <code> element (only in case
    // if noEscapeHTML is false). This is useful for automatic scrolling when searching
    // within response body (in order to scroll we need an element).
    // Don't use <pre> elements since these adds addiontanl new line ending when copying
    // selected source code using Firefox->Edit->Copy (Ctrl+C) (issue 2093).
    var lines = this.splitLines(text);
    for (var i = 0; i < lines.length; ++i)
    {
        var line = lines[i];
        while (line.length > wrapWidth)
        {
            var m = reNonAlphaNumeric.exec(line.substr(wrapWidth, 100));
            var wrapIndex = wrapWidth + (m ? m.index : 0);
            var subLine = line.substr(0, wrapIndex);
            line = line.substr(wrapIndex);

            if (!noEscapeHTML) html.push("<code class=\"wrappedText focusRow\" role=\"listitem\">");
            html.push(noEscapeHTML ? subLine : escapeHTML(subLine));
            if (!noEscapeHTML) html.push("</code>");
        }

        if (!noEscapeHTML) html.push("<code class=\"wrappedText focusRow\" role=\"listitem\">");
        html.push(noEscapeHTML ? line : escapeHTML(line));
        if (!noEscapeHTML) html.push("</code>");
    }

    return html;
}

this.insertWrappedText = function(text, textBox, noEscapeHTML)
{
    var html = this.wrapText(text, noEscapeHTML);
    textBox.innerHTML = "<pre role=\"list\">" + html.join("") + "</pre>";
}

// ************************************************************************************************
// Menus

this.createMenu = function(popup, label)
{
    var menu = popup.ownerDocument.createElement("menu");
    menu.setAttribute("label", label);

    var menuPopup = popup.ownerDocument.createElement("menupopup");

    popup.appendChild(menu);
    menu.appendChild(menuPopup);

    return menuPopup;
};

this.createMenuItem = function(popup, item, before)
{
    if (typeof(item) == "string" && item.indexOf("-") == 0)
        return this.createMenuSeparator(popup, before);

    var menuitem = popup.ownerDocument.createElement("menuitem");

    this.setItemIntoElement(menuitem, item);

    if (before)
        popup.insertBefore(menuitem, before);
    else
        popup.appendChild(menuitem);
    return menuitem;
};

this.setItemIntoElement = function(element, item)
{
    var label = item.nol10n ? item.label : this.$STR(item.label);

    element.setAttribute("label", label);
    element.setAttribute("type", item.type);
    if (item.checked)
        element.setAttribute("checked", "true");
    if (item.disabled)
        element.setAttribute("disabled", "true");
    if (item.image)
    {
        element.setAttribute("class", "element-iconic");
        element.setAttribute("image", item.image);
    }

    if (item.command)
        element.addEventListener("command", item.command, false);

    if (item.commandID)
        element.setAttribute("command", item.commandID);

    if (item.option)
        element.setAttribute("option", item.option);

    if (item.tooltiptext)
        element.setAttribute("tooltiptext", item.tooltiptext);

    return element;
}


this.createMenuHeader = function(popup, item)
{
    var header = popup.ownerDocument.createElement("label");
    header.setAttribute("class", "menuHeader");

    var label = item.nol10n ? item.label : this.$STR(item.label);

    header.setAttribute("value", label);

    popup.appendChild(header);
    return header;
};

this.createMenuSeparator = function(popup, before)
{
    if (!popup.firstChild)
        return;

    var menuitem = popup.ownerDocument.createElement("menuseparator");
    if (before)
        popup.insertBefore(menuitem, before);
    else
        popup.appendChild(menuitem);
    return menuitem;
};

this.optionMenu = function(label, option)
{
    return {label: label, type: "checkbox", checked: Firebug[option], option: option,
        command: this.bindFixed(Firebug.setPref, Firebug, Firebug.prefDomain, option, !Firebug[option]) };
};

this.serviceOptionMenu = function(label, option)
{
    return {label: label, type: "checkbox", checked: Firebug[option], option: option,
        command: this.bindFixed(Firebug.setPref, Firebug, Firebug.servicePrefDomain, option, !Firebug[option]) };
};

// ************************************************************************************************
// Stack Traces

this.getCurrentStackTrace = function(context)
{
    var trace = null;

    Firebug.Debugger.halt(function(frame)
    {
        if (FBTrace.DBG_STACK) FBTrace.sysout("lib.getCurrentStackTrace frame:", frame);
        trace = FBL.getStackTrace(frame, context);
        if (FBTrace.DBG_STACK) FBTrace.sysout("lib.getCurrentStackTrace trace:", trace);
    });

    return trace;
};

this.getStackTrace = function(frame, context)
{
    var trace = new this.StackTrace();

    for (; frame && frame.isValid; frame = frame.callingFrame)
    {
        if (!(Firebug.filterSystemURLs && this.isSystemURL(FBL.normalizeURL(frame.script.fileName))))
        {
            var stackFrame = this.getStackFrame(frame, context);
            if (stackFrame)
                trace.frames.push(stackFrame);
        }
        else
        {
            if (FBTrace.DBG_STACK)
                FBTrace.sysout("lib.getStackTrace isSystemURL frame.script.fileName "+frame.script.fileName+"\n");
        }
    }

    if (trace.frames.length > 100)
    {
        var originalLength = trace.frames.length;
        trace.frames.splice(50, originalLength - 100);
        var excuse = "(eliding "+(originalLength - 100)+" frames)";
        trace.frames[50] = new this.StackFrame(context, excuse, null, excuse, 0, []);
    }

    return trace;
};

this.getStackFrame = function(frame, context)
{
    if (frame.isNative || frame.isDebugger)
    {
        var excuse = (frame.isNative) ?  "(native)" : "(debugger)";
        if (FBTrace.DBG_STACK) FBTrace.sysout("lib.getStackFrame "+excuse+" frame\n");
        return new this.StackFrame(context, excuse, null, excuse, 0, []);
    }
    try
    {
        var sourceFile = Firebug.SourceFile.getSourceFileByScript(context, frame.script);
        if (sourceFile)
        {
            var url = sourceFile.href;
            var analyzer = sourceFile.getScriptAnalyzer(frame.script);

            var lineNo = analyzer.getSourceLineFromFrame(context, frame);
            var fncSpec = analyzer.getFunctionDescription(frame.script, context, frame);
            if (!fncSpec.name)
                fncSpec.name = frame.script.functionName;

            if (FBTrace.DBG_STACK) FBTrace.sysout("lib.getStackFrame "+fncSpec.name, {sourceFile: sourceFile, script: frame.script, fncSpec: fncSpec});
            return new this.StackFrame(context, fncSpec.name, frame.script, url, lineNo, fncSpec.args, frame.pc);
        }
        else
        {
            if (FBTrace.DBG_STACK)
                FBTrace.sysout("lib.getStackFrame NO sourceFile tag@file:"+frame.script.tag+"@"+frame.script.fileName, frame.script.functionSource);

            var script = frame.script;

            return new this.StackFrame(context, script.functionName, frame.script, FBL.normalizeURL(script.fileName), frame.line, [], frame.pc);
        }
    }
    catch (exc)
    {
        if (FBTrace.DBG_STACK) FBTrace.sysout("getStackTrace fails:", exc);
        return null;
    }
};

this.getStackDump = function()
{
    var lines = [];
    for (var frame = Components.stack; frame; frame = frame.caller)
        lines.push(frame.filename + " (" + frame.lineNumber + ")");

    return lines.join("\n");
};

this.getStackSourceLink = function()
{
    for (var frame = Components.stack; frame; frame = frame.caller)
    {
        if (frame.filename && frame.filename.indexOf("chrome://firebug/") == 0)
        {
            for (; frame; frame = frame.caller)
            {
                var firebugComponent = "/components/firebug-";
                if (frame.filename && frame.filename.indexOf("chrome://firebug/") != 0 &&
                    frame.filename.indexOf(firebugComponent) == -1)
                    break;
            }
            break;
        }
    }
    return this.getFrameSourceLink(frame);
}

this.getFrameSourceLink = function(frame)
{
    if (frame && frame.filename && frame.filename.indexOf("XPCSafeJSObjectWrapper") == -1)
        return new FBL.SourceLink(frame.filename, frame.lineNumber, "js");
    else
        return null;
};

this.getStackFrameId = function()
{
    for (var frame = Components.stack; frame; frame = frame.caller)
    {
        if (frame.languageName == "JavaScript"
            && !(frame.filename && frame.filename.indexOf("chrome://firebug/") == 0))
        {
            return frame.filename + "/" + frame.lineNumber;
        }
    }
    return null;
};

// ************************************************************************************************
// Event Monitoring

this.toggleMonitorEvents = function(object, type, state, context)
{
    if (state)
        this.unmonitorEvents(object, type, context);
    else
        this.monitorEvents(object, type, context);
};

this.monitorEvents = function(object, type, context)
{
    if (!this.areEventsMonitored(object, type, context) && object && object.addEventListener)
    {
        if (!context.onMonitorEvent)
            context.onMonitorEvent = function(event) { Firebug.Console.log(event, context); };

        if (!context.eventsMonitored)
            context.eventsMonitored = [];

        context.eventsMonitored.push({object: object, type: type});

        if (!type)
            this.attachAllListeners(object, context.onMonitorEvent, context);
        else
            object.addEventListener(type, context.onMonitorEvent, false);
    }
};

this.unmonitorEvents = function(object, type, context)
{
    var eventsMonitored = context.eventsMonitored;

    for (var i = 0; i < eventsMonitored.length; ++i)
    {
        if (eventsMonitored[i].object == object && eventsMonitored[i].type == type)
        {
            eventsMonitored.splice(i, 1);

            if (!type)
                this.detachAllListeners(object, context.onMonitorEvent, context);
            else
                object.removeEventListener(type, context.onMonitorEvent, false);
            break;
        }
    }
};

this.areEventsMonitored = function(object, type, context)
{
    var eventsMonitored = context.eventsMonitored;
    if (eventsMonitored)
    {
        for (var i = 0; i < eventsMonitored.length; ++i)
        {
            if (eventsMonitored[i].object == object && eventsMonitored[i].type == type)
                return true;
        }
    }

    return false;
};

// ************************************************************************************************
// Functions

this.findScripts = function(context, url, line)
{
    var sourceFile = context.sourceFileMap[url];
    if (sourceFile)
        var scripts = sourceFile.scriptsIfLineCouldBeExecutable(line);
    else
    {
        if (FBTrace.DBG_STACK)
            FBTrace.sysout("lib.findScript, no sourceFile in context for url=", url);
    }
    return scripts;
};

this.findScriptForFunctionInContext = function(context, fn)
{
    var found = null;

    if (!fn || !fn.toString)
        return found;

    var fns = fn.toSource();
    var found = this.forEachFunction(context, function findMatchingScript(script, aFunction)
    {
        if (!aFunction['toSource'] || typeof(aFunction['toSource']) != "function")
            return;
        try {
            var tfs = aFunction.toSource();
        } catch (etfs) {
            FBTrace.sysout("unwrapped.toSource fails for unwrapped: "+etfs, aFunction);
        }

        if (tfs == fns)
            return script;
    });

    if (FBTrace.DBG_FUNCTION_NAMES)
        FBTrace.sysout("findScriptForFunctionInContext found "+(found?found.tag:"none")+"\n");

    return found;
}

this.forEachFunction = function(context, cb)
{
    for (var url in context.sourceFileMap)
    {
        var sourceFile = context.sourceFileMap[url];
        if (FBTrace.DBG_FUNCTION_NAMES)
            FBTrace.sysout("lib.forEachFunction Looking in "+sourceFile+"\n");
        var rc = sourceFile.forEachScript(function seekFn(script, sourceFile)
        {
            if (!script.isValid)
                return;
            try
            {
                var testFunctionObject = script.functionObject;
                if (!testFunctionObject.isValid)
                    return false;
                var theFunction = testFunctionObject.getWrappedValue();

                var rc = cb(script, theFunction, sourceFile);
                if (rc)
                    return rc;
            }
            catch(exc)
            {
                if (FBTrace.DBG_ERRORS)
                {
                    if (exc.name == "NS_ERROR_NOT_AVAILABLE")
                    {
                        if(FBTrace.DBG_FUNCTION_NAMES)
                            FBTrace.sysout("lib.forEachFunction no functionObject for "+script.tag+"_"+script.fileName+"\n");
                    }
                    else
                       FBTrace.sysout("lib.forEachFunction FAILS "+exc,exc);
                }
            }
        });
        if (rc)
            return rc;
    }
    return false;
}

this.findScriptForFunction = function(fn)
{
    var found = {tag: "not set"};

    this.jsd.enumerateScripts({enumerateScript: function findScriptMatchingFn(script)
    {
        try {
            if (script.isValid)
            {

                var iValueFunctionObject = script.functionObject;
                //FBTrace.dumpIValue("lib.findScriptForFunction iValueFunctionObject", iValueFunctionObject);
                var testFunctionObject = script.functionObject.getWrappedValue();
                if (testFunctionObject instanceof Function)
                    FBTrace.sysout("lib.findScriptForFunction testFunctionObject "+testFunctionObject+" vs "+fn+"\n");
                if (testFunctionObject == fn)
                {
                    found = script;
                    return;
                }
            }
        } catch (exc) {
            if (FBTrace.DBG_ERRORS)
            {
                if (exc.name == "NS_ERROR_NOT_AVAILABLE")
                    FBTrace.sysout("lib.findScriptForFunction no functionObject for "+script.tag+"_"+script.fileName+"\n");
                else
                    FBTrace.sysout("lib.findScriptForFunction FAILS ",exc);
            }
        }
    }});

    FBTrace.sysout("findScriptForFunction found ", found.tag);
    return found;
};

this.findSourceForFunction = function(fn, context)
{
    var script = this.findScriptForFunctionInContext(context, fn);
    return (script)? this.getSourceLinkForScript(script, context) : null;
};

this.getSourceLinkForScript = function(script, context)
{
    var sourceFile = Firebug.SourceFile.getSourceFileByScript(context, script);
    if (sourceFile)
    {
        var scriptAnalyzer = sourceFile.getScriptAnalyzer(script);
        return scriptAnalyzer.getSourceLinkForScript(script);
    }
};

this.getFunctionName = function(script, context, frame)
{
    if (!script)
    {
        if (FBTrace.DBG_STACK) FBTrace.sysout("lib.getFunctionName FAILS typeof(script)="+typeof(script)+"\n");
        return "(no script)";
    }
    var name = script.functionName;

    if (!name || (name == "anonymous"))
    {
        var analyzer = Firebug.SourceFile.getScriptAnalyzer(context, script);
        if (analyzer)
        {
            if (FBTrace.DBG_STACK) FBTrace.sysout("getFunctionName analyzer.sourceFile:", analyzer.sourceFile);
            var functionSpec = analyzer.getFunctionDescription(script, context, frame);
            name = functionSpec.name +"("+functionSpec.args.join(',')+")";
        }
        else
        {
            if (FBTrace.DBG_STACK) FBTrace.sysout("getFunctionName no analyzer, "+script.baseLineNumber+"@"+script.fileName+"\n");
            name =  this.guessFunctionName(FBL.normalizeURL(script.fileName), script.baseLineNumber, context);
        }
    }
    if (FBTrace.DBG_STACK) FBTrace.sysout("getFunctionName "+script.tag+" ="+name+"\n");

    return name;
};

this.guessFunctionName = function(url, lineNo, context)
{
    if (context)
    {
        if (context.sourceCache)
            return this.guessFunctionNameFromLines(url, lineNo, context.sourceCache);
    }
    return "? in "+this.getFileName(url)+"@"+lineNo;
};

this.guessFunctionNameFromLines = function(url, lineNo, sourceCache)
{
    // Walk backwards from the first line in the function until we find the line which
    // matches the pattern above, which is the function definition
    var line = "";
    if (FBTrace.DBG_FUNCTION_NAMES) FBTrace.sysout("getFunctionNameFromLines for line@URL="+lineNo+"@"+url+"\n");
    for (var i = 0; i < 4; ++i)
    {
        line = sourceCache.getLine(url, lineNo-i) + line;
        if (line != undefined)
        {
            var m = reGuessFunction.exec(line);
            if (m)
                return m[1];
            else
            {
                if (FBTrace.DBG_FUNCTION_NAMES)
                    FBTrace.sysout("lib.guessFunctionName re failed for lineNo-i="+lineNo+"-"+i+" line="+line+"\n");
            }
            m = reFunctionArgNames.exec(line);
            if (m && m[1])
                return m[1];
        }
    }
    return "(?)";
};

this.getFunctionArgNames = function(fn)
{
    var m = reFunctionArgNames.exec(this.safeToString(fn));
    if (m)
    {
        var argNames = m[2].split(", ");
        if (argNames.length && argNames[0])
            return argNames;
    }
    return [];
};

this.getFunctionArgValues = function(fn, frame)
{
    var values = [];

    var argNames = this.getFunctionArgNames(fn);
    for (var i = 0; i < argNames.length; ++i)
    {
        var argName = argNames[i];
        var pvalue = frame.scope.getProperty(argName);
        var value = pvalue ? pvalue.value.getWrappedValue() : undefined;
        values.push({name: argName, value: value});
    }

    return values;
};

// ************************************************************************************************
// Source Files

this.getSourceFileByHref = function(url, context)
{
    return context.sourceFileMap[url];
};

this.getAllStyleSheets = function(context)
{
    var styleSheets = [];

    function addSheet(sheet)
    {
        var sheetLocation =  FBL.getURLForStyleSheet(sheet);

        if (!Firebug.showUserAgentCSS && FBL.isSystemURL(sheetLocation))
            return;

        styleSheets.push(sheet);
        try
        {
            for (var i = 0; i < sheet.cssRules.length; ++i)
            {
                var rule = sheet.cssRules[i];
                if (rule instanceof CSSImportRule)
                    addSheet(rule.styleSheet);
            }
        }
        catch(e)
        {
            if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("getAllStyleSheets sheet.cssRules FAILS for "+(sheet?sheet.href:"null sheet")+e, e);
        }
    }

    this.iterateWindows(context.window, function(subwin)
    {
        var rootSheets = subwin.document.styleSheets;
        for (var i = 0; i < rootSheets.length; ++i)
            addSheet(rootSheets[i]);
    });

    return styleSheets;
};

this.getStyleSheetByHref = function(url, context)
{
    if (FBTrace.DBG_ERRORS && FBTrace.DBG_CSS)
    {
        var r = FBL.totalRules;
        var s = FBL.totalSheets;
        var t = new Date();
    }

    if (!context.styleSheetMap)
        FBL.createStyleSheetMap(context);  // fill cache

    if (FBTrace.DBG_ERRORS && FBTrace.DBG_CSS)
        FBTrace.sysout((FBL.totalRules-r)+" rules in "+ (FBL.totalSheets-s)+" sheets required "+(new Date().getTime() - t.getTime())+" ms", context.styleSheetMap);

    // hasOwnProperty is called to prevent possible conflicts with prototype extensions and strict mode warnings
    return context.styleSheetMap.hasOwnProperty(url) ? context.styleSheetMap[url] : undefined;
};

this.createStyleSheetMap = function(context)
{
    context.styleSheetMap = {};

    function addSheet(sheet)
    {
        var sheetURL = FBL.getURLForStyleSheet(sheet);
        context.styleSheetMap[sheetURL] = sheet;

        if (FBTrace.DBG_ERRORS && FBTrace.DBG_CSS)
        {
            FBL.totalSheets++;
            FBTrace.sysout("addSheet "+FBL.totalSheets+" "+sheetURL);
        }

        // recurse for imported sheets

        for (var i = 0; i < sheet.cssRules.length; ++i)
        {
            if (FBTrace.DBG_ERRORS && FBTrace.DBG_CSS)
                FBL.totalRules++;

            var rule = sheet.cssRules[i];
            if (rule instanceof CSSStyleRule)
            {
                if (rule.type == CSSRule.STYLE_RULE)  // once we get here no more imports
                    return;
            }
            else if (rule instanceof CSSImportRule)
            {
                addSheet(rule.styleSheet);
            }
        }
    }

    this.iterateWindows(context.window, function(subwin)
    {
        var rootSheets = subwin.document.styleSheets;
        for (var i = 0; i < rootSheets.length; ++i)
        {
            addSheet(rootSheets[i]);
        }
    });

    if (FBTrace.DBG_ERRORS && FBTrace.DBG_CSS)
        FBTrace.sysout("createStyleSheetMap for "+context.getName(), context.styleSheetMap);

    return context.styleSheetMap;
};

this.sourceURLsAsArray = function(context)
{
    var urls = [];
    var sourceFileMap = context.sourceFileMap;
    for (var url in sourceFileMap)
        urls.push(url);

    if (FBTrace.DBG_SOURCEFILES) FBTrace.sysout("sourceURLsAsArray urls="+urls.length+" in context "+context.getName()+"\n");

    return urls;
};

this.sourceFilesAsArray = function(sourceFileMap)
{
    var sourceFiles = [];
    for (var url in sourceFileMap)
        sourceFiles.push(sourceFileMap[url]);
    if (FBTrace.DBG_SOURCEFILES) FBTrace.sysout("sourceFilesAsArray sourcefiles="+sourceFiles.length+"\n");
    return sourceFiles;
};


// ************************************************************************************************
// Firefox browsing

this.openNewTab = function(url, postText)
{
    if (!url)
        return;

    var postData = null;
    if (postText)
    {
        var stringStream = this.getInputStreamFromString(postText);
        postData = this.CCIN("@mozilla.org/network/mime-input-stream;1", "nsIMIMEInputStream");
        postData.addHeader("Content-Type", "application/x-www-form-urlencoded");
        postData.addContentLength = true;
        postData.setData(stringStream);
    }

    gBrowser.selectedTab = gBrowser.addTab(url, null, null, postData);
};

this.openWindow = function(windowType, url, features, params)
{
    var win = windowType ? wm.getMostRecentWindow(windowType) : null;
    if (win) {
      if ("initWithParams" in win)
        win.initWithParams(params);
      win.focus();
    }
    else {
      var winFeatures = "resizable,dialog=no,centerscreen" + (features != "" ? ("," + features) : "");
      var parentWindow = (this.instantApply || !window.opener || window.opener.closed) ? window : window.opener;
      win = parentWindow.openDialog(url, "_blank", winFeatures, params);
    }
    return win;
};

this.viewSource = function(url, lineNo)
{
    window.openDialog("chrome://global/content/viewSource.xul", "_blank",
        "all,dialog=no", url, null, null, lineNo);
};

// Iterate over all opened firefox windows of the given type. If the callback returns true
// the iteration is stopped.
this.iterateBrowserWindows = function(windowType, callback)
{
    var windowList = wm.getZOrderDOMWindowEnumerator(windowType, true);
    if (!windowList.hasMoreElements())
        windowList = wm.getEnumerator(windowType);

    while (windowList.hasMoreElements()) {
        if (callback(windowList.getNext()))
            return true;
    }

    return false;
};

this.iterateBrowserTabs = function(browserWindow, callback)
{
    var tabBrowser = browserWindow.getBrowser();
    var numTabs = tabBrowser.browsers.length;
    for(var index=0; index<numTabs; index++)
    {
        var currentBrowser = tabBrowser.getBrowserAtIndex(index);
        if (callback(tabBrowser.mTabs[index], currentBrowser))
            return true;
    }

    return false;
}

this.safeGetWindowLocation = function(window)
{
    try
    {
        if (window)
        {
            if (window.closed)
                return "about:closed";
            if ("location" in window)
            {
                if ("toString" in window.location)
                    return window.location.toString();
                else
                    return "(window.location has no toString)";
            }
            else
                return "(no window.location)";
        }
        else
            return "(no context.window)";
    }
    catch(exc)
    {
        //if (FBTrace.DBG_WINDOWS || FBTrace.DBG_ERRORS)
            FBTrace.sysout("TabContext.getWindowLocation failed "+exc, exc);
            FBTrace.sysout("TabContext.getWindowLocation failed window:", window);
        return "(getWindowLocation: "+exc+")";
    }
};

this.safeGetContentType = function(request)
{
    try
    {
        return new String(request.contentType).toLowerCase();
    }
    catch (err)
    {
    }

    return null;
}

// ************************************************************************************************
// JavaScript Parsing

this.getExpressionAt = function(text, charOffset)
{
    var offset = 0;
    for (var m = reWord.exec(text); m; m = reWord.exec(text.substr(offset)))
    {
        var word = m[0];
        var wordOffset = offset+m.index;
        if (charOffset >= wordOffset && charOffset <= wordOffset+word.length)
        {
            var innerOffset = charOffset-wordOffset;
            var dots = word.substr(0, innerOffset).split(".").length;
            var subExpr = word.split(".").slice(0, dots).join(".");
            return {expr: subExpr, offset: wordOffset};
        }

        offset = wordOffset+word.length;
    }

    return {expr: null, offset: -1};
};

var jsKeywords =
{
    "var": 1,
    "const": 1,
    "class": 1,
    "extends": 1,
    "import": 1,
    "namespace": 1,
    "function": 1,
    "debugger": 1,
    "new": 1,
    "delete": 1,
    "null": 1,
    "undefined": 1,
    "true": 1,
    "false": 1,
    "void": 1,
    "typeof": 1,
    "instanceof": 1,
    "break": 1,
    "continue": 1,
    "return": 1,
    "throw": 1,
    "try": 1,
    "catch": 1,
    "finally": 1,
    "if": 1,
    "else": 1,
    "for": 1,
    "while": 1,
    "do": 1,
    "with": 1,
    "switch": 1,
    "case": 1,
    "default": 1
};

this.isJavaScriptKeyword = function(name)
{
    return name in jsKeywords;
};

// ************************************************************************************************
// Events

this.cancelEvent = function(event)
{
    event.stopPropagation();
    event.preventDefault();
};

this.isLeftClick = function(event)
{
    return event.button == 0 && this.noKeyModifiers(event);
};

this.isMiddleClick = function(event)
{
    return event.button == 1 && this.noKeyModifiers(event);
};

this.isRightClick = function(event)
{
    return event.button == 2 && this.noKeyModifiers(event);
};

this.noKeyModifiers = function(event)
{
    return !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
};

this.isControlClick = function(event)
{
    return event.button == 0 && this.isControl(event);
};

this.isShiftClick = function(event)
{
    return event.button == 0 && this.isShift(event);
};

this.isControl = function(event)
{
    return (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
};

this.isControlShift = function(event)
{
    return (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey;
};

this.isShift = function(event)
{
    return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
};

this.dispatch = function(listeners, name, args)
{
    if (!listeners)
        return;

    try {
        if (FBTrace.DBG_DISPATCH)
            var noMethods = [];

        for (var i = 0; i < listeners.length; ++i)
        {
            var listener = listeners[i];
            if ( listener[name] )
            {
                //FBTrace.sysout("FBL.dispatch "+i+") "+name+" to "+listener.dispatchName);
                try
                {
                    listener[name].apply(listener, args);
                }
                catch(exc)
                {
                    if (FBTrace.DBG_ERRORS)
                    {
                        if (exc.stack)
                        {
                            var stack = exc.stack;
                            exc.stack = stack.split('\n');
                        }
                        var culprit = listeners[i] ? listeners[i].dispatchName : null;
                        FBTrace.sysout(" Exception in lib.dispatch "+(culprit?culprit+".":"")+ name+": "+exc+" in "+(exc.fileName?exc.fileName:"")+(exc.lineNumber?":"+exc.lineNumber:""), exc);
                    }
                }
            }
            else
            {
                if (FBTrace.DBG_DISPATCH)
                {
                    //FBTrace.sysout("FBL.dispatch noMethod in "+i+"/"+listeners.length+") "+name+" to "+listener.dispatchName);
                    noMethods.push(listener);
                }
            }
        }
        if (FBTrace.DBG_DISPATCH)
            FBTrace.sysout("FBL.dispatch "+name+" to "+listeners.length+" listeners, "+noMethods.length+" had no such method:", noMethods);
    }
    catch (exc)
    {
        if (FBTrace.DBG_ERRORS)
        {
            if (exc.stack)
            {
                var stack = exc.stack;
                exc.stack = stack.split('\n');
            }
            var culprit = listeners[i] ? listeners[i].dispatchName : null;
            FBTrace.sysout(" Exception in lib.dispatch "+(culprit?culprit+".":"")+ name+": "+exc, exc);
            window.dump(FBL.getStackDump());
        }
    }
};

this.dispatch2 = function(listeners, name, args)
{
    try
    {
        if (FBTrace.DBG_DISPATCH)
            var noMethods = [];

        for (var i = 0; i < listeners.length; ++i)
        {
            var listener = listeners[i];
            if ( listener.hasOwnProperty(name) )
            {
                var result = listener[name].apply(listener, args);
                if ( result )
                {
                    if (FBTrace.DBG_DISPATCH)
                        FBTrace.sysout("dispatch2 result "+result, result);
                    return result;
                }
            }
            else
            {
                if (FBTrace.DBG_DISPATCH)
                    noMethods.push(listener);
            }
        }
        if (FBTrace.DBG_DISPATCH)
            FBTrace.sysout("FBL.dispatch2 "+name+" to "+listeners.length+" listeners, "+noMethods.length+" had no such method:", noMethods);
    }
    catch (exc)
    {
        if (FBTrace.DBG_ERRORS)
        {
            if (exc.stack) exc.stack = exc.stack.split('/n');
            FBTrace.sysout(" Exception in lib.dispatch2 "+ name, exc);
        }
    }
};

// ************************************************************************************************
// DOM Events

const eventTypes =
{
    composition: [
        "composition",
        "compositionstart",
        "compositionend" ],
    contextmenu: [
        "contextmenu" ],
    drag: [
        "dragenter",
        "dragover",
        "dragexit",
        "dragdrop",
        "draggesture" ],
    focus: [
        "focus",
        "blur" ],
    form: [
        "submit",
        "reset",
        "change",
        "select",
        "input" ],
    key: [
        "keydown",
        "keyup",
        "keypress" ],
    load: [
        "load",
        "beforeunload",
        "unload",
        "abort",
        "error" ],
    mouse: [
        "mousedown",
        "mouseup",
        "click",
        "dblclick",
        "mouseover",
        "mouseout",
        "mousemove" ],
    mutation: [
        "DOMSubtreeModified",
        "DOMNodeInserted",
        "DOMNodeRemoved",
        "DOMNodeRemovedFromDocument",
        "DOMNodeInsertedIntoDocument",
        "DOMAttrModified",
        "DOMCharacterDataModified" ],
    paint: [
        "paint",
        "resize",
        "scroll" ],
    scroll: [
        "overflow",
        "underflow",
        "overflowchanged" ],
    text: [
        "text" ],
    ui: [
        "DOMActivate",
        "DOMFocusIn",
        "DOMFocusOut" ],
    xul: [
        "popupshowing",
        "popupshown",
        "popuphiding",
        "popuphidden",
        "close",
        "command",
        "broadcast",
        "commandupdate" ]
};

this.getEventFamily = function(eventType)
{
    if (!this.families)
    {
        this.families = {};

        for (var family in eventTypes)
        {
            var types = eventTypes[family];
            for (var i = 0; i < types.length; ++i)
                this.families[types[i]] = family;
        }
    }

    return this.families[eventType];
};

this.attachAllListeners = function(object, listener)
{
    for (var family in eventTypes)
    {
        if (family != "mutation" || Firebug.attachMutationEvents)
            this.attachFamilyListeners(family, object, listener);
    }
};

this.detachAllListeners = function(object, listener)
{
    for (var family in eventTypes)
    {
        if (family != "mutation" || Firebug.attachMutationEvents)
            this.detachFamilyListeners(family, object, listener);
    }
};

this.attachFamilyListeners = function(family, object, listener)
{
    var types = eventTypes[family];
    for (var i = 0; i < types.length; ++i)
        object.addEventListener(types[i], listener, false);
};

this.detachFamilyListeners = function(family, object, listener)
{
    var types = eventTypes[family];
    for (var i = 0; i < types.length; ++i)
        object.removeEventListener(types[i], listener, false);
};

// ************************************************************************************************
// URLs

this.getFileName = function(url)
{
    var split = this.splitURLBase(url);
    return split.name;
};

this.splitURLBase = function(url)
{
    if (this.isDataURL(url))
        return this.splitDataURL(url);
    return this.splitURLTrue(url);
};

this.splitDataURL = function(url)
{
    var mark = url.indexOf(':', 3);
    if (mark != 4)
        return false; //  the first 5 chars must be 'data:'

    var point = url.indexOf(',', mark+1);
    if (point < mark)
        return false; // syntax error

    var props = { encodedContent: url.substr(point+1) };

    var metadataBuffer = url.substr(mark+1, point);
    var metadata = metadataBuffer.split(';');
    for (var i = 0; i < metadata.length; i++)
    {
        var nv = metadata[i].split('=');
        if (nv.length == 2)
            props[nv[0]] = nv[1];
    }

    // Additional Firebug-specific properties
    if (props.hasOwnProperty('fileName'))
    {
         var caller_URL = decodeURIComponent(props['fileName']);
         var caller_split = this.splitURLTrue(caller_URL);

        if (props.hasOwnProperty('baseLineNumber'))  // this means it's probably an eval()
        {
            props['path'] = caller_split.path;
            props['line'] = props['baseLineNumber'];
            var hint = decodeURIComponent(props['encodedContent']).substr(0,200).replace(/\s*$/, "");
            props['name'] =  'eval->'+hint;
        }
        else
        {
            props['name'] = caller_split.name;
            props['path'] = caller_split.path;
        }
    }
    else
    {
        if (!props.hasOwnProperty('path'))
            props['path'] = "data:";
        if (!props.hasOwnProperty('name'))
            props['name'] =  decodeURIComponent(props['encodedContent']).substr(0,200).replace(/\s*$/, "");
    }

    return props;
};

this.splitURLTrue = function(url)
{
    var m = reSplitFile.exec(url);
    if (!m)
        return {name: url, path: url};
    else if (!m[2])
        return {path: m[1], name: m[1]};
    else
        return {path: m[1], name: m[2]+m[3]};
};

this.getFileExtension = function(url)
{
    if (!url)
        return null;

    var lastDot = url.lastIndexOf(".");
    return url.substr(lastDot+1);
};

this.isSystemURL = function(url)
{
    if (!url) return true;
    if (url.length == 0) return true;
    if (url[0] == 'h') return false;
    if (url.substr(0, 9) == "resource:")
        return true;
    else if (url.substr(0, 16) == "chrome://firebug")
        return true;
    else if (url  == "XPCSafeJSObjectWrapper.cpp")
        return true;
    else if (url.substr(0, 6) == "about:")
        return true;
    else if (url.indexOf("firebug-service.js") != -1)
        return true;
    else
        return false;
};

this.isSystemPage = function(win)
{
    try
    {
        var doc = win.document;
        if (!doc)
            return false;

        // Detect pages for pretty printed XML
        if ((doc.styleSheets.length && doc.styleSheets[0].href
                == "chrome://global/content/xml/XMLPrettyPrint.css")
            || (doc.styleSheets.length > 1 && doc.styleSheets[1].href
                == "chrome://browser/skin/feeds/subscribe.css"))
            return true;

        return FBL.isSystemURL(win.location.href);
    }
    catch (exc)
    {
        // Sometimes documents just aren't ready to be manipulated here, but don't let that
        // gum up the works
        ERROR("tabWatcher.isSystemPage document not ready:"+ exc);
        return false;
    }
}

this.isSystemStyleSheet = function(sheet)
{
    var href = sheet && sheet.href;
    return href && FBL.isSystemURL(href);
};

this.getURIHost = function(uri)
{
    try
    {
        if (uri)
            return uri.host;
        else
            return "";
    }
    catch (exc)
    {
        return "";
    }
}

this.isLocalURL = function(url)
{
    if (url.substr(0, 5) == "file:")
        return true;
    else if (url.substr(0, 8) == "wyciwyg:")
        return true;
    else
        return false;
};

this.isDataURL = function(url)
{
    return (url && url.substr(0,5) == "data:");
};

this.getLocalPath = function(url)
{
    if (this.isLocalURL(url))
    {
        var fileHandler = ioService.getProtocolHandler("file").QueryInterface(Ci.nsIFileProtocolHandler);
        var file = fileHandler.getFileFromURLSpec(url);
        return file.path;
    }
};

this.getURLFromLocalFile = function(file)
{
    var fileHandler = ioService.getProtocolHandler("file").QueryInterface(Ci.nsIFileProtocolHandler);
    var URL = fileHandler.getURLSpecFromFile(file);
    return URL;
};

this.getDataURLForContent = function(content, url)
{
    // data:text/javascript;fileName=x%2Cy.js;baseLineNumber=10,<the-url-encoded-data>
    var uri = "data:text/html;";
    uri += "fileName="+encodeURIComponent(url)+ ","
    uri += encodeURIComponent(content);
    return uri;
},

this.getDomain = function(url)
{
    var m = /[^:]+:\/{1,3}([^\/]+)/.exec(url);
    return m ? m[1] : "";
};

this.getURLPath = function(url)
{
    var m = /[^:]+:\/{1,3}[^\/]+(\/.*?)$/.exec(url);
    return m ? m[1] : "";
};

this.getPrettyDomain = function(url)
{
    var m = /[^:]+:\/{1,3}(www\.)?([^\/]+)/.exec(url);
    return m ? m[2] : "";
};

this.absoluteURL = function(url, baseURL)
{
    return this.absoluteURLWithDots(url, baseURL).replace("/./", "/", "g");
};

this.absoluteURLWithDots = function(url, baseURL)
{
    if (url[0] == "?")
        return baseURL + url;

    var reURL = /(([^:]+:)\/{1,2}[^\/]*)(.*?)$/;
    var m = reURL.exec(url);
    if (m)
        return url;

    var m = reURL.exec(baseURL);
    if (!m)
        return "";

    var head = m[1];
    var tail = m[3];
    if (url.substr(0, 2) == "//")
        return m[2] + url;
    else if (url[0] == "/")
    {
        return head + url;
    }
    else if (tail[tail.length-1] == "/")
        return baseURL + url;
    else
    {
        var parts = tail.split("/");
        return head + parts.slice(0, parts.length-1).join("/") + "/" + url;
    }
}

this.normalizeURL = function(url)  // this gets called a lot, any performance improvement welcome
{
    if (!url)
        return "";
    // Replace one or more characters that are not forward-slash followed by /.., by space.
    if (url.length < 255) // guard against monsters.
    {
        // Replace one or more characters that are not forward-slash followed by /.., by space.
        url = url.replace(/[^/]+\/\.\.\//, "", "g");
        // Issue 1496, avoid #
        url = url.replace(/#.*/,"");
        // For some reason, JSDS reports file URLs like "file:/" instead of "file:///", so they
        // don't match up with the URLs we get back from the DOM
        url = url.replace(/file:\/([^/])/g, "file:///$1");
        if (url.indexOf('chrome:')==0)
        {
            var m = reChromeCase.exec(url);  // 1 is package name, 2 is path
            if (m)
            {
                url = "chrome://"+m[1].toLowerCase()+"/"+m[2];
            }
        }
    }
    return url;
};

this.denormalizeURL = function(url)
{
    return url.replace(/file:\/\/\//g, "file:/");
};

this.parseURLParams = function(url)
{
    var q = url ? url.indexOf("?") : -1;
    if (q == -1)
        return [];

    var search = url.substr(q+1);
    var h = search.lastIndexOf("#");
    if (h != -1)
        search = search.substr(0, h);

    if (!search)
        return [];

    return this.parseURLEncodedText(search);
};

this.parseURLEncodedText = function(text)
{
    const maxValueLength = 25000;

    var params = [];

    // Unescape '+' characters that are used to encode a space.
    // See section 2.2.in RFC 3986: http://www.ietf.org/rfc/rfc3986.txt
    text = text.replace(/\+/g, " ");

    function decodeText(text)
    {
        try
        {
            return decodeURIComponent(text);
        }
        catch (e)
        {
            return decodeURIComponent(unescape(text));
        }
    }

    var args = text.split("&");
    for (var i = 0; i < args.length; ++i)
    {
        try
        {
            var index = args[i].indexOf("=");
            if (index != -1)
            {
                var paramName = args[i].substring(0, index);
                var paramValue = args[i].substring(index + 1);

                if (paramValue.length > maxValueLength)
                    paramValue = this.$STR("LargeData");

                params.push({name: decodeText(paramName), value: decodeText(paramValue)});
            }
            else
            {
                var paramName = args[i];
                params.push({name: decodeText(paramName), value: ""});
            }
        }
        catch (e)
        {
            if (FBTrace.DBG_ERRORS)
            {
                FBTrace.sysout("parseURLEncodedText EXCEPTION ", e);
                FBTrace.sysout("parseURLEncodedText EXCEPTION URI", args[i]);
            }
        }
    }

    params.sort(function(a, b) { return a.name <= b.name ? -1 : 1; });

    return params;
};

this.reEncodeURL = function(file, text)
{
    var lines = text.split("\n");
    var params = this.parseURLEncodedText(lines[lines.length-1]);

    var args = [];
    for (var i = 0; i < params.length; ++i)
        args.push(encodeURIComponent(params[i].name)+"="+encodeURIComponent(params[i].value));

    var url = file.href;
    url += (url.indexOf("?") == -1 ? "?" : "&") + args.join("&");

    return url;
};

this.getResource = function(aURL)
{
    try
    {
        var channel=ioService.newChannel(aURL,null,null);
        var input=channel.open();
        return FBL.readFromStream(input);
    }
    catch (e)
    {
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("lib.getResource FAILS for "+aURL, e);
    }
};

this.parseJSONString = function(jsonString, originURL)
{
    // See if this is a Prototype style *-secure request.
    var regex = new RegExp(/^\/\*-secure-([\s\S]*)\*\/\s*$/);
    var matches = regex.exec(jsonString);

    if (matches)
    {
        jsonString = matches[1];

        if (jsonString[0] == "\\" && jsonString[1] == "n")
            jsonString = jsonString.substr(2);

        if (jsonString[jsonString.length-2] == "\\" && jsonString[jsonString.length-1] == "n")
            jsonString = jsonString.substr(0, jsonString.length-2);
    }

    if (jsonString.indexOf("&&&START&&&"))
    {
        regex = new RegExp(/&&&START&&& (.+) &&&END&&&/);
        matches = regex.exec(jsonString);
        if (matches)
            jsonString = matches[1];
    }

    // throw on the extra parentheses
    jsonString = "(" + jsonString + ")";

    var s = Components.utils.Sandbox(originURL);
    var jsonObject = null;

    try
    {
        jsonObject = Components.utils.evalInSandbox(jsonString, s);
    }
    catch(e)
    {
        if (e.message.indexOf("is not defined"))
        {
            var parts = e.message.split(" ");
            s[parts[0]] = function(str){ return str; };
            try {
                jsonObject = Components.utils.evalInSandbox(jsonString, s);
            } catch(ex) {
                if (FBTrace.DBG_ERRORS || FBTrace.DBG_JSONVIEWER)
                    FBTrace.sysout("jsonviewer.parseJSON EXCEPTION", e);
                return null;
            }
        }
        else
        {
            if (FBTrace.DBG_ERRORS || FBTrace.DBG_JSONVIEWER)
                FBTrace.sysout("jsonviewer.parseJSON EXCEPTION", e);
            return null;
        }
    }

    return jsonObject;
};

// ************************************************************************************************
// Network

this.readFromStream = function(stream, charset, noClose)
{
    var sis = this.CCSV("@mozilla.org/binaryinputstream;1", "nsIBinaryInputStream");
    sis.setInputStream(stream);

    var segments = [];
    for (var count = stream.available(); count; count = stream.available())
        segments.push(sis.readBytes(count));

    if (!noClose)
        sis.close();

    var text = segments.join("");

    try
    {
        return this.convertToUnicode(text, charset);
    }
    catch (err)
    {
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("LIB.readFromStream EXCEPTION charset: " + charset, err);
    }

    return text;
};

this.readPostTextFromPage = function(url, context)
{
    if (url == context.browser.contentWindow.location.href)
    {
        try
        {
            var webNav = context.browser.webNavigation;
            var descriptor = this.QI(webNav, Ci.nsIWebPageDescriptor).currentDescriptor;
            var entry = this.QI(descriptor, Ci.nsISHEntry);
            if (entry && entry.postData)
            {
                var postStream = this.QI(entry.postData, Ci.nsISeekableStream);
                postStream.seek(NS_SEEK_SET, 0);

                var charset = context.window.document.characterSet;
                return this.readFromStream(postStream, charset, true);
            }
         }
         catch (exc)
         {
             if (FBTrace.DBG_ERRORS)
                FBTrace.sysout("lib.readPostText FAILS, url:"+url, exc);
         }
     }
};

this.readPostTextFromRequest = function(request, context)
{
    try
    {
        var is = this.QI(request, Ci.nsIUploadChannel).uploadStream;
        if (is)
        {
            var ss = this.QI(is, Ci.nsISeekableStream);
            var prevOffset;
            if (ss)
            {
                prevOffset = ss.tell();
                ss.seek(NS_SEEK_SET, 0);
            }

            // Read data from the stream..
            var charset = (context && context.window) ? context.window.document.characterSet : null;
            var text = this.readFromStream(is, charset, true);

            // Seek locks the file so, seek to the beginning only if necko hasn't read it yet,
            // since necko doesn't seek to 0 before reading (at lest not till 459384 is fixed).
            if (ss && prevOffset == 0)
                ss.seek(NS_SEEK_SET, 0);

            return text;
        }
    }
    catch(exc)
    {
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("lib.readPostTextFromRequest FAILS ", exc);
    }

    return null;
};

this.getInputStreamFromString = function(dataString)
{
    var stringStream = this.CCIN("@mozilla.org/io/string-input-stream;1", "nsIStringInputStream");

    if ("data" in stringStream) // Gecko 1.9 or newer
        stringStream.data = dataString;
    else // 1.8 or older
        stringStream.setData(dataString, dataString.length);

    return stringStream;
};

this.getWindowForRequest = function(request)
{
    var webProgress = this.getRequestWebProgress(request);
    try {
        if (webProgress)
            return webProgress.DOMWindow;
    }
    catch (ex) {
    }

    return null;
};

this.getRequestWebProgress = function(request)
{
    try
    {
        if (request && request.notificationCallbacks)
            return request.notificationCallbacks.getInterface(Ci.nsIWebProgress);
    } catch (exc) {}

    try
    {
        if (request && request.loadGroup && request.loadGroup.groupObserver)
            return request.loadGroup.groupObserver.QueryInterface(Ci.nsIWebProgress);
    } catch (exc) {}

    return null;
};

/**
 * Returns <browser> element for specified content window.
 * @param {Object} win - Content window
 */
this.getBrowserForWindow = function(win)
{
    var tabBrowser = document.getElementById("content");
    for (var i=0; i<tabBrowser.browsers.length; ++i)
    {
        var browser = tabBrowser.browsers[i];
        if (browser.contentWindow == win)
            return browser;
    }

    return null;
};

// ************************************************************************************************

this.BaseProgressListener =
{
    QueryInterface : function(iid)
    {
        if (iid.equals(Ci.nsIWebProgressListener) ||
            iid.equals(Ci.nsISupportsWeakReference) ||
            iid.equals(Ci.nsISupports))
        {
            return this;
        }

        throw Components.results.NS_NOINTERFACE;
    },

    stateIsRequest: false,
    onLocationChange: function() {},
    onStateChange : function() {},
    onProgressChange : function() {},
    onStatusChange : function() {},
    onSecurityChange : function() {},
    onLinkIconAvailable : function() {}
};

// ************************************************************************************************
// Network Tracing

this.getStateDescription = function(flag)
{
    var state = [];
    var nsIWebProgressListener = Ci.nsIWebProgressListener;
    if (flag & nsIWebProgressListener.STATE_START) state.push("STATE_START");
    else if (flag & nsIWebProgressListener.STATE_REDIRECTING) state.push("STATE_REDIRECTING");
    else if (flag & nsIWebProgressListener.STATE_TRANSFERRING) state.push("STATE_TRANSFERRING");
    else if (flag & nsIWebProgressListener.STATE_NEGOTIATING) state.push("STATE_NEGOTIATING");
    else if (flag & nsIWebProgressListener.STATE_STOP) state.push("STATE_STOP");

    if (flag & nsIWebProgressListener.STATE_IS_REQUEST) state.push("STATE_IS_REQUEST");
    if (flag & nsIWebProgressListener.STATE_IS_DOCUMENT) state.push("STATE_IS_DOCUMENT");
    if (flag & nsIWebProgressListener.STATE_IS_NETWORK) state.push("STATE_IS_NETWORK");
    if (flag & nsIWebProgressListener.STATE_IS_WINDOW) state.push("STATE_IS_WINDOW");
    if (flag & nsIWebProgressListener.STATE_RESTORING) state.push("STATE_RESTORING");
    if (flag & nsIWebProgressListener.STATE_IS_INSECURE) state.push("STATE_IS_INSECURE");
    if (flag & nsIWebProgressListener.STATE_IS_BROKEN) state.push("STATE_IS_BROKEN");
    if (flag & nsIWebProgressListener.STATE_IS_SECURE) state.push("STATE_IS_SECURE");
    if (flag & nsIWebProgressListener.STATE_SECURE_HIGH) state.push("STATE_SECURE_HIGH");
    if (flag & nsIWebProgressListener.STATE_SECURE_MED) state.push("STATE_SECURE_MED");
    if (flag & nsIWebProgressListener.STATE_SECURE_LOW) state.push("STATE_SECURE_LOW");

    return state.join(", ");
};

this.getStatusDescription = function(status)
{
    var nsISocketTransport = Ci.nsISocketTransport;
    var nsITransport = Ci.nsITransport;

    if (status == nsISocketTransport.STATUS_RESOLVING) return "STATUS_RESOLVING";
    if (status == nsISocketTransport.STATUS_CONNECTING_TO) return "STATUS_CONNECTING_TO";
    if (status == nsISocketTransport.STATUS_CONNECTED_TO) return "STATUS_CONNECTED_TO";
    if (status == nsISocketTransport.STATUS_SENDING_TO) return "STATUS_SENDING_TO";
    if (status == nsISocketTransport.STATUS_WAITING_FOR) return "STATUS_WAITING_FOR";
    if (status == nsISocketTransport.STATUS_RECEIVING_FROM) return "STATUS_RECEIVING_FROM";
    if (status == nsITransport.STATUS_READING) return "STATUS_READING";
    if (status == nsITransport.STATUS_WRITING) return "STATUS_WRITING";
};

this.getLoadFlagsDescription = function(loadFlags)
{
    var flags = [];
    var nsIChannel = Ci.nsIChannel;
    var nsICachingChannel = Ci.nsICachingChannel;

    if (loadFlags & nsIChannel.LOAD_DOCUMENT_URI) flags.push("LOAD_DOCUMENT_URI");
    if (loadFlags & nsIChannel.LOAD_RETARGETED_DOCUMENT_URI) flags.push("LOAD_RETARGETED_DOCUMENT_URI");
    if (loadFlags & nsIChannel.LOAD_REPLACE) flags.push("LOAD_REPLACE");
    if (loadFlags & nsIChannel.LOAD_INITIAL_DOCUMENT_URI) flags.push("LOAD_INITIAL_DOCUMENT_URI");
    if (loadFlags & nsIChannel.LOAD_TARGETED) flags.push("LOAD_TARGETED");
    if (loadFlags & nsIChannel.LOAD_CALL_CONTENT_SNIFFERS) flags.push("LOAD_CALL_CONTENT_SNIFFERS");
    if (loadFlags & nsICachingChannel.LOAD_NO_NETWORK_IO) flags.push("LOAD_NO_NETWORK_IO");
    if (loadFlags & nsICachingChannel.LOAD_CHECK_OFFLINE_CACHE) flags.push("LOAD_CHECK_OFFLINE_CACHE");
    if (loadFlags & nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE) flags.push("LOAD_BYPASS_LOCAL_CACHE");
    if (loadFlags & nsICachingChannel.LOAD_BYPASS_LOCAL_CACHE_IF_BUSY) flags.push("LOAD_BYPASS_LOCAL_CACHE_IF_BUSY");
    if (loadFlags & nsICachingChannel.LOAD_ONLY_FROM_CACHE) flags.push("LOAD_ONLY_FROM_CACHE");
    if (loadFlags & nsICachingChannel.LOAD_ONLY_IF_MODIFIED) flags.push("LOAD_ONLY_IF_MODIFIED");

    return flags.join(", ");
};

// ************************************************************************************************
// Programs

this.launchProgram = function(exePath, args)
{
    try {
        var file = this.CCIN("@mozilla.org/file/local;1", "nsILocalFile");
        file.initWithPath(exePath);
        if (this.getPlatformName() == "Darwin" && file.isDirectory())
        {
            args = this.extendArray(["-a", exePath], args);
            file.initWithPath("/usr/bin/open");
        }
        if (!file.exists())
            return false;
        var process = this.CCIN("@mozilla.org/process/util;1", "nsIProcess");
        process.init(file);
        process.run(false, args, args.length, {});
        return true;
    }
    catch(exc)
    {
        this.ERROR(exc);
    }
    return false;
};

this.getIconURLForFile = function(path)
{
    var fileHandler = ioService.getProtocolHandler("file").QueryInterface(Ci.nsIFileProtocolHandler);
    try {
        var file = this.CCIN("@mozilla.org/file/local;1", "nsILocalFile");
        file.initWithPath(path);
        if ((this.getPlatformName() == "Darwin") && !file.isDirectory() && (path.indexOf(".app/") != -1))
        {
            path = path.substr(0,path.lastIndexOf(".app/")+4);
            file.initWithPath(path);
        }
        return "moz-icon://" + fileHandler.getURLSpecFromFile(file) + "?size=16";
    }
    catch(exc)
    {
        this.ERROR(exc);
    }
    return null;
}

this.makeURI = function(urlString)
{
    try
    {
        return ioService.newURI(urlString, null, null);
    }
    catch(exc)
    {
        //var explain = {message: "Firebug.lib.makeURI FAILS", url: urlString, exception: exc};
        // todo convert explain to json and then to data url
        if (FBTrace.DBG_ERRORS)
            FBTrace.sysout("makeURI FAILS for "+urlString+" ", exc);
        return false;
    }
}

// ************************************************************************************************

this.persistObjects = function(panel, panelState)
{
    // Persist the location and selection so we can restore them in case of a reload
    if (panel.location)
        panelState.persistedLocation = this.persistObject(panel.location, panel.context); // fn(context)->location

    if (panel.selection)
        panelState.persistedSelection = this.persistObject(panel.selection, panel.context);
    if (FBTrace.DBG_INITIALIZE)
        FBTrace.sysout("lib.persistObjects panel.location:"+panel.location+" panel.selection:"+panel.selection+" panelState:", panelState);

};

this.persistObject = function(object, context)
{
    var rep = Firebug.getRep(object);
    return rep ? rep.persistObject(object, context) : null;
};

this.restoreLocation =  function(panel, panelState)
{
    var restored = false;

    if (!panel.location && panelState && panelState.persistedLocation)
    {
        var location = panelState.persistedLocation(panel.context);

        if (FBTrace.DBG_INITIALIZE)
            FBTrace.sysout("lib.restoreObjects persistedLocation: "+location+" panelState:", panelState);

        if (location)
        {
            panel.navigate(location);
            restored = true;
        }
    }

    if (!panel.location)
        panel.navigate(null);

    if (FBTrace.DBG_INITIALIZE)
        FBTrace.sysout("lib.restoreLocation panel.location: "+panel.location+" restored: "+restored+" panelState:", panelState);

    return restored;
};

this.restoreSelection = function(panel, panelState)
{
    var needRetry = false;

    if (!panel.selection && panelState && panelState.persistedSelection)
    {
        var selection = panelState.persistedSelection(panel.context);
        if (selection)
            panel.select(selection);
        else
            needRetry = true;
    }

    if (!panel.selection)  // Couldn't restore the selection, so select the default object
        panel.select(null);

    if (needRetry)
    {
        function overrideDefaultWithPersistedSelection()
        {
            if (panel.selection == panel.getDefaultSelection(panel.context) && panelState.persistedSelection)
            {
                var selection = panelState.persistedSelection(panel.context);
                if (selection)
                    panel.select(selection);
            }

            if (FBTrace.DBG_INITIALIZE)
                FBTrace.sysout("lib.overrideDefaultsWithPersistedValues panel.location: "+panel.location+" panel.selection: "+panel.selection+" panelState:", panelState);
        }

        // If we couldn't restore the selection, wait a bit and try again
        panel.context.setTimeout(overrideDefaultWithPersistedSelection, overrideDefaultsWithPersistedValuesTimeout);
    }

    if (FBTrace.DBG_INITIALIZE)
        FBTrace.sysout("lib.restore panel.selection: "+panel.selection+" panelState:", panelState);
};

this.restoreObjects = function(panel, panelState)
{
    this.restoreLocation(panel, panelState);
    this.restoreSelection(panel, panelState);
};

this.getPersistedState = function(context, panelName)
{
    if (!context)
        return null;

    var persistedState = context.persistedState;
    if (!persistedState)
        persistedState = context.persistedState = {};

    if (!persistedState.panelState)
        persistedState.panelState = {};

    var panelState = persistedState.panelState[panelName];
    if (!panelState)
        panelState = persistedState.panelState[panelName] = {};

    return panelState;
};

// ************************************************************************************************

this.ErrorMessage = function(message, href, lineNo, source, category, context, trace)
{
    this.message = message;
    this.href = href;
    this.lineNo = lineNo;
    this.source = source;
    this.category = category;
    this.context = context;
    this.trace = trace;
};

this.ErrorMessage.prototype =
{
    getSourceLine: function()
    {
        return this.context.sourceCache.getLine(this.href, this.lineNo);
    }
};

// ************************************************************************************************

/**
 * @class Searches for text in a given node.
 *
 * @constructor
 * @param {Node} rootNode Node to search
 * @param {Function} rowFinder results filter. On find this method will be called
 *      with the node containing the matched text as the first parameter. This may
 *      be undefined to return the node as is.
 */
this.TextSearch = function(rootNode, rowFinder)
{
    var doc = rootNode.ownerDocument;
    var count, searchRange, startPt;

    /**
     * Find the first result in the node.
     *
     * @param {String} text Text to search for
     * @param {boolean} reverse true to perform a reverse search
     * @param {boolean} caseSensitive true to perform a case sensitive search
     */
    this.find = function(text, reverse, caseSensitive)
    {
        this.text = text;

        finder.findBackwards = !!reverse;
        finder.caseSensitive = !!caseSensitive;

        var range = this.range = finder.Find(
                text, searchRange,
                startPt || searchRange,
                searchRange);
        var match = range ?  range.startContainer : null;
        return this.currentNode = (rowFinder && match ? rowFinder(match) : match);
    };

    /**
     * Find the next search result
     *
     * @param {boolean} wrapAround true to wrap the search if the end of range is reached
     * @param {boolean} sameNode true to return multiple results from the same text node
     * @param {boolean} reverse true to search in reverse
     * @param {boolean} caseSensitive true to perform a case sensitive search
     */
    this.findNext = function(wrapAround, sameNode, reverse, caseSensitive)
    {
        startPt = undefined;

        if (sameNode && this.range)
        {
            startPt = this.range.cloneRange();
            if (reverse)
            {
                startPt.setEnd(startPt.startContainer, startPt.startOffset);
            }
            else
            {
                startPt.setStart(startPt.startContainer, startPt.startOffset+1);
            }
        }

        if (!startPt)
        {
            var curNode = this.currentNode ? this.currentNode : rootNode;
            startPt = doc.createRange();
            try
            {
                if (reverse)
                {
                    startPt.setStartBefore(curNode);
                }
                else
                {
                    startPt.setStartAfter(curNode);
                }
            }
            catch (e)
            {
                if (FBTrace.DBG_ERRORS)
                    FBTrace.sysout("lib.TextSearch.findNext setStartAfter fails for nodeType:"+(this.currentNode?this.currentNode.nodeType:rootNode.nodeType),e);
                try {
                    FBTrace.sysout("setStart try\n");
                    startPt.setStart(curNode);
                    FBTrace.sysout("setStart success\n");
                } catch (exc) {
                    return;
                }
            }
        }

        var match = startPt && this.find(this.text, reverse, caseSensitive);
        if (!match && wrapAround)
        {
            this.reset();
            return this.find(this.text, reverse, caseSensitive);
        }

        return match;
    };

    /**
     * Resets the instance state to the initial state.
     */
    this.reset = function()
    {
        searchRange = doc.createRange();
        searchRange.selectNode(rootNode);

        startPt = searchRange;
    };

    this.reset();
};

// ************************************************************************************************

this.SourceBoxTextSearch = function(sourceBox)
{
    this.find = function(text, reverse, caseSensitive)
    {
        this.text = text;

        this.re = new FBL.ReversibleRegExp(text);

        return this.findNext(false, reverse, caseSensitive);
    };

    this.findNext = function(wrapAround, reverse, caseSensitive)
    {
        var lines = sourceBox.lines;
        var match = null;
        for (var iter = new FBL.ReversibleIterator(lines.length, this.mark, reverse); iter.next();)
        {
            match = this.re.exec(lines[iter.index], false, caseSensitive);
            if (match)
            {
                this.mark = iter.index;
                return iter.index;
            }
        }

        if (!match && wrapAround)
        {
            this.reset();
            return this.findNext(false, reverse, caseSensitive);
        }

        return match;
    };

    this.reset = function()
    {
        delete this.mark;
    };

    this.reset();
};
//************************************************************************************************

this.Continued = function()
{

};

this.Continued.prototype =
{
    complete: function()
    {
        if (this.callback)
            this.callback.apply(top, arguments);
        else
            this.result = cloneArray(arguments);
    },

    wait: function(cb)
    {
        if ("result" in this)
            cb.apply(top, this.result);
        else
            this.callback = cb;
    }
};

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.SourceLink = function(url, line, type, object, instance)
{
    this.href = url;
    this.instance = instance;
    this.line = line;
    this.type = type;
    this.object = object;
};

this.SourceLink.prototype =
{
    toString: function()
    {
        return this.href;
    },
    toJSON: function() // until 3.1...
    {
        return "{\"href\":\""+this.href+"\", "+
            (this.line?("\"line\":"+this.line+","):"")+
            (this.type?(" \"type\":\""+this.type+"\","):"")+
                    "}";
    }

};

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.SourceText = function(lines, owner)
{
    this.lines = lines;
    this.owner = owner;
};

this.SourceText.getLineAsHTML = function(lineNo)
{
    return escapeHTML(this.lines[lineNo-1]);
};

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.StackTrace = function()
{
    this.frames = [];
};

this.StackTrace.prototype =
{
    toString: function()
    {
        var trace = "<top>\n";
        for (var i = 0; i < this.frames.length; i++)
        {
            trace += "[" + i + "]"+ this.frames[i]+"\n";
        }
        trace += "<bottom>\n";
        return trace;
    },
    reverse: function()
    {
        this.frames.reverse();
        return this;
    },

    destroy: function()
    {
        for (var i = 0; i < this.frames.length; i++)
        {
            this.frames[i].destroy();
        }
        if (FBTrace.DBG_STACK) FBTrace.sysout("lib.StackTrace destroy "+this.uid+"\n");
    }
};

this.traceToString = function(trace)                /*@explore*/
{                                                   /*@explore*/
    var str = "<top>";                              /*@explore*/
    for(var i = 0; i < trace.frames.length; i++)    /*@explore*/
        str += "\n" + trace.frames[i];              /*@explore*/
    str += "\n<bottom>";                            /*@explore*/
    return str;                                     /*@explore*/
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.StackFrame = function(context, fn, script, href, lineNo, args, pc)
{
    this.context = context;
    this.fn = fn;
    this.script = script;
    this.href = href;
    this.lineNo = lineNo;
    this.args = args;
    this.flags = (script?script.flags:null);
    this.pc = pc;
};

this.StackFrame.prototype =
{
    toString: function()
    {
        // XXXjjb analyze args and fn?
        if (this.script)
            return "("+this.flags+")"+this.href+":"+this.script.baseLineNumber+"-"
                  +(this.script.baseLineNumber+this.script.lineExtent)+"@"+this.lineNo;
        else
            return this.href;
    },
    destroy: function()
    {
        if (FBTrace.DBG_STACK)
            FBTrace.sysout("StackFrame destroyed:"+this.uid+"\n");
        this.script = null;
        this.fn = null;
    },
    signature: function()
    {
        return this.script.tag +"." + this.pc;
    }
};
//-----------------------111111----222222-----33---444  1 All 'Not a (' followed by (; 2 All 'Not a )' followed by a ); 3 text between @ and : digits
var reErrorStackLine = /([^\(]*)\(([^\)]*)\)@(.*):(\d*)/;
this.parseToStackFrame = function(line) // function name (arg, arg, arg)@fileName:lineNo
{
    var m = reErrorStackLine.exec(line);
    if (m)
        return new this.StackFrame(null, m[1], null, m[3], m[4], m[2].split(','), 0);
}
this.parseToStackTrace = function(stack)
{
    var lines = stack.split('\n');
    var trace = new this.StackTrace();
    for (var i = 0; i < lines.length; i++)
    {
        var frame = this.parseToStackFrame(lines[i]);
        FBTrace.sysout("parseToStackTrace i "+i+" line:"+lines[i]+ "->frame: "+frame, frame);
        if (frame)
            trace.frames.push(frame);
    }
    return trace;
}

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.Property = function(object, name)
{
    this.object = object;
    this.name = name;

    this.getObject = function()
    {
        return object[name];
    };
};

this.ErrorCopy = function(message)
{
    this.message = message;
};

function EventCopy(event)
{
    // Because event objects are destroyed arbitrarily by Gecko, we must make a copy of them to
    // represent them long term in the inspector.
    for (var name in event)
    {
        try {
            this[name] = event[name];
        } catch (exc) { }
    }
}

this.EventCopy = EventCopy;

// ************************************************************************************************
// DOM Constants

this.getDOMMembers = function(object)
{
    if (!domMemberCache)
    {
        domMemberCache = {};

        for (var name in domMemberMap)
        {
            var builtins = domMemberMap[name];
            var cache = domMemberCache[name] = {};

            for (var i = 0; i < builtins.length; ++i)
                cache[builtins[i]] = i;
        }
    }

    if (object instanceof Window)
        { return domMemberCache.Window; }
    else if (object instanceof Document || object instanceof XMLDocument)
        { return domMemberCache.Document; }
    else if (object instanceof Location)
        { return domMemberCache.Location; }
    else if (object instanceof HTMLImageElement)
        { return domMemberCache.HTMLImageElement; }
    else if (object instanceof HTMLAnchorElement)
        { return domMemberCache.HTMLAnchorElement; }
    else if (object instanceof HTMLInputElement)
        { return domMemberCache.HTMLInputElement; }
    else if (object instanceof HTMLButtonElement)
        { return domMemberCache.HTMLButtonElement; }
    else if (object instanceof HTMLFormElement)
        { return domMemberCache.HTMLFormElement; }
    else if (object instanceof HTMLBodyElement)
        { return domMemberCache.HTMLBodyElement; }
    else if (object instanceof HTMLHtmlElement)
        { return domMemberCache.HTMLHtmlElement; }
    else if (object instanceof HTMLScriptElement)
        { return domMemberCache.HTMLScriptElement; }
    else if (object instanceof HTMLTableElement)
        { return domMemberCache.HTMLTableElement; }
    else if (object instanceof HTMLTableRowElement)
        { return domMemberCache.HTMLTableRowElement; }
    else if (object instanceof HTMLTableCellElement)
        { return domMemberCache.HTMLTableCellElement; }
    else if (object instanceof HTMLIFrameElement)
        { return domMemberCache.HTMLIFrameElement; }
    else if (object instanceof SVGSVGElement)
        { return domMemberCache.SVGSVGElement; }
    else if (object instanceof SVGElement)
        { return domMemberCache.SVGElement; }
    else if (object instanceof Element)
        { return domMemberCache.Element; }
    else if (object instanceof Text || object instanceof CDATASection)
        { return domMemberCache.Text; }
    else if (object instanceof Attr)
        { return domMemberCache.Attr; }
    else if (object instanceof Node)
        { return domMemberCache.Node; }
    else if (object instanceof Event || object instanceof EventCopy)
        { return domMemberCache.Event; }
    else
        return {};
};

this.isDOMMember = function(object, propName)
{
    var members = this.getDOMMembers(object);
    return members && propName in members;
};

var domMemberCache = null;
var domMemberMap = {};

domMemberMap.Window =
[
    "document",
    "frameElement",

    "innerWidth",
    "innerHeight",
    "outerWidth",
    "outerHeight",
    "screenX",
    "screenY",
    "pageXOffset",
    "pageYOffset",
    "scrollX",
    "scrollY",
    "scrollMaxX",
    "scrollMaxY",

    "status",
    "defaultStatus",

    "parent",
    "opener",
    "top",
    "window",
    "content",
    "self",

    "location",
    "history",
    "frames",
    "navigator",
    "screen",
    "menubar",
    "toolbar",
    "locationbar",
    "personalbar",
    "statusbar",
    "directories",
    "scrollbars",
    "fullScreen",
    "netscape",
    "java",
    "console",
    "Components",
    "controllers",
    "closed",
    "crypto",
    "pkcs11",

    "name",
    "property",
    "length",

    "sessionStorage",
    "globalStorage",

    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "getComputedStyle",
    "captureEvents",
    "releaseEvents",
    "routeEvent",
    "enableExternalCapture",
    "disableExternalCapture",
    "moveTo",
    "moveBy",
    "resizeTo",
    "resizeBy",
    "scroll",
    "scrollTo",
    "scrollBy",
    "scrollByLines",
    "scrollByPages",
    "sizeToContent",
    "setResizable",
    "getSelection",
    "open",
    "openDialog",
    "close",
    "alert",
    "confirm",
    "prompt",
    "dump",
    "focus",
    "blur",
    "find",
    "back",
    "forward",
    "home",
    "stop",
    "print",
    "atob",
    "btoa",
    "updateCommands",
    "XPCNativeWrapper",
    "GeckoActiveXObject",
    "applicationCache"      // FF3
];

domMemberMap.Location =
[
    "href",
    "protocol",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "hash",

    "assign",
    "reload",
    "replace"
];

domMemberMap.Node =
[
    "id",
    "className",

    "nodeType",
    "tagName",
    "nodeName",
    "localName",
    "prefix",
    "namespaceURI",
    "nodeValue",

    "ownerDocument",
    "parentNode",
    "offsetParent",
    "nextSibling",
    "previousSibling",
    "firstChild",
    "lastChild",
    "childNodes",
    "attributes",

    "dir",
    "baseURI",
    "textContent",
    "innerHTML",

    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "cloneNode",
    "appendChild",
    "insertBefore",
    "replaceChild",
    "removeChild",
    "compareDocumentPosition",
    "hasAttributes",
    "hasChildNodes",
    "lookupNamespaceURI",
    "lookupPrefix",
    "normalize",
    "isDefaultNamespace",
    "isEqualNode",
    "isSameNode",
    "isSupported",
    "getFeature",
    "getUserData",
    "setUserData"
];

domMemberMap.Document = extendArray(domMemberMap.Node,
[
    "documentElement",
    "body",
    "title",
    "location",
    "referrer",
    "cookie",
    "contentType",
    "lastModified",
    "characterSet",
    "inputEncoding",
    "xmlEncoding",
    "xmlStandalone",
    "xmlVersion",
    "strictErrorChecking",
    "documentURI",
    "URL",

    "defaultView",
    "doctype",
    "implementation",
    "styleSheets",
    "images",
    "links",
    "forms",
    "anchors",
    "embeds",
    "plugins",
    "applets",

    "width",
    "height",

    "designMode",
    "compatMode",
    "async",
    "preferredStylesheetSet",

    "alinkColor",
    "linkColor",
    "vlinkColor",
    "bgColor",
    "fgColor",
    "domain",

    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "captureEvents",
    "releaseEvents",
    "routeEvent",
    "clear",
    "open",
    "close",
    "execCommand",
    "execCommandShowHelp",
    "getElementsByName",
    "getSelection",
    "queryCommandEnabled",
    "queryCommandIndeterm",
    "queryCommandState",
    "queryCommandSupported",
    "queryCommandText",
    "queryCommandValue",
    "write",
    "writeln",
    "adoptNode",
    "appendChild",
    "removeChild",
    "renameNode",
    "cloneNode",
    "compareDocumentPosition",
    "createAttribute",
    "createAttributeNS",
    "createCDATASection",
    "createComment",
    "createDocumentFragment",
    "createElement",
    "createElementNS",
    "createEntityReference",
    "createEvent",
    "createExpression",
    "createNSResolver",
    "createNodeIterator",
    "createProcessingInstruction",
    "createRange",
    "createTextNode",
    "createTreeWalker",
    "domConfig",
    "evaluate",
    "evaluateFIXptr",
    "evaluateXPointer",
    "getAnonymousElementByAttribute",
    "getAnonymousNodes",
    "addBinding",
    "removeBinding",
    "getBindingParent",
    "getBoxObjectFor",
    "setBoxObjectFor",
    "getElementById",
    "getElementsByTagName",
    "getElementsByTagNameNS",
    "hasAttributes",
    "hasChildNodes",
    "importNode",
    "insertBefore",
    "isDefaultNamespace",
    "isEqualNode",
    "isSameNode",
    "isSupported",
    "load",
    "loadBindingDocument",
    "lookupNamespaceURI",
    "lookupPrefix",
    "normalize",
    "normalizeDocument",
    "getFeature",
    "getUserData",
    "setUserData"
]);

domMemberMap.Element = extendArray(domMemberMap.Node,
[
    "clientWidth",
    "clientHeight",
    "offsetLeft",
    "offsetTop",
    "offsetWidth",
    "offsetHeight",
    "scrollLeft",
    "scrollTop",
    "scrollWidth",
    "scrollHeight",

    "style",

    "tabIndex",
    "title",
    "lang",
    "align",
    "spellcheck",

    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "focus",
    "blur",
    "cloneNode",
    "appendChild",
    "insertBefore",
    "replaceChild",
    "removeChild",
    "compareDocumentPosition",
    "getElementsByTagName",
    "getElementsByTagNameNS",
    "getAttribute",
    "getAttributeNS",
    "getAttributeNode",
    "getAttributeNodeNS",
    "setAttribute",
    "setAttributeNS",
    "setAttributeNode",
    "setAttributeNodeNS",
    "removeAttribute",
    "removeAttributeNS",
    "removeAttributeNode",
    "hasAttribute",
    "hasAttributeNS",
    "hasAttributes",
    "hasChildNodes",
    "lookupNamespaceURI",
    "lookupPrefix",
    "normalize",
    "isDefaultNamespace",
    "isEqualNode",
    "isSameNode",
    "isSupported",
    "getFeature",
    "getUserData",
    "setUserData"
]);

domMemberMap.SVGElement = extendArray(domMemberMap.Element,
[
    "x",
    "y",
    "width",
    "height",
    "rx",
    "ry",
    "transform",
    "href",

    "ownerSVGElement",
    "viewportElement",
    "farthestViewportElement",
    "nearestViewportElement",

    "getBBox",
    "getCTM",
    "getScreenCTM",
    "getTransformToElement",
    "getPresentationAttribute",
    "preserveAspectRatio"
]);

domMemberMap.SVGSVGElement = extendArray(domMemberMap.Element,
[
    "x",
    "y",
    "width",
    "height",
    "rx",
    "ry",
    "transform",

    "viewBox",
    "viewport",
    "currentView",
    "useCurrentView",
    "pixelUnitToMillimeterX",
    "pixelUnitToMillimeterY",
    "screenPixelToMillimeterX",
    "screenPixelToMillimeterY",
    "currentScale",
    "currentTranslate",
    "zoomAndPan",

    "ownerSVGElement",
    "viewportElement",
    "farthestViewportElement",
    "nearestViewportElement",
    "contentScriptType",
    "contentStyleType",

    "getBBox",
    "getCTM",
    "getScreenCTM",
    "getTransformToElement",
    "getEnclosureList",
    "getIntersectionList",
    "getViewboxToViewportTransform",
    "getPresentationAttribute",
    "getElementById",
    "checkEnclosure",
    "checkIntersection",
    "createSVGAngle",
    "createSVGLength",
    "createSVGMatrix",
    "createSVGNumber",
    "createSVGPoint",
    "createSVGRect",
    "createSVGString",
    "createSVGTransform",
    "createSVGTransformFromMatrix",
    "deSelectAll",
    "preserveAspectRatio",
    "forceRedraw",
    "suspendRedraw",
    "unsuspendRedraw",
    "unsuspendRedrawAll",
    "getCurrentTime",
    "setCurrentTime",
    "animationsPaused",
    "pauseAnimations",
    "unpauseAnimations"
]);

domMemberMap.HTMLImageElement = extendArray(domMemberMap.Element,
[
    "src",
    "naturalWidth",
    "naturalHeight",
    "width",
    "height",
    "x",
    "y",
    "name",
    "alt",
    "longDesc",
    "lowsrc",
    "border",
    "complete",
    "hspace",
    "vspace",
    "isMap",
    "useMap",
]);

domMemberMap.HTMLAnchorElement = extendArray(domMemberMap.Element,
[
    "name",
    "target",
    "accessKey",
    "href",
    "protocol",
    "host",
    "hostname",
    "port",
    "pathname",
    "search",
    "hash",
    "hreflang",
    "coords",
    "shape",
    "text",
    "type",
    "rel",
    "rev",
    "charset"
]);

domMemberMap.HTMLIFrameElement = extendArray(domMemberMap.Element,
[
    "contentDocument",
    "contentWindow",
    "frameBorder",
    "height",
    "longDesc",
    "marginHeight",
    "marginWidth",
    "name",
    "scrolling",
    "src",
    "width"
]);

domMemberMap.HTMLTableElement = extendArray(domMemberMap.Element,
[
    "bgColor",
    "border",
    "caption",
    "cellPadding",
    "cellSpacing",
    "frame",
    "rows",
    "rules",
    "summary",
    "tBodies",
    "tFoot",
    "tHead",
    "width",

    "createCaption",
    "createTFoot",
    "createTHead",
    "deleteCaption",
    "deleteRow",
    "deleteTFoot",
    "deleteTHead",
    "insertRow"
]);

domMemberMap.HTMLTableRowElement = extendArray(domMemberMap.Element,
[
    "bgColor",
    "cells",
    "ch",
    "chOff",
    "rowIndex",
    "sectionRowIndex",
    "vAlign",

    "deleteCell",
    "insertCell"
]);

domMemberMap.HTMLTableCellElement = extendArray(domMemberMap.Element,
[
    "abbr",
    "axis",
    "bgColor",
    "cellIndex",
    "ch",
    "chOff",
    "colSpan",
    "headers",
    "height",
    "noWrap",
    "rowSpan",
    "scope",
    "vAlign",
    "width"

]);

domMemberMap.HTMLScriptElement = extendArray(domMemberMap.Element,
[
    "src"
]);

domMemberMap.HTMLButtonElement = extendArray(domMemberMap.Element,
[
    "accessKey",
    "disabled",
    "form",
    "name",
    "type",
    "value",

    "click"
]);

domMemberMap.HTMLInputElement = extendArray(domMemberMap.Element,
[
    "type",
    "value",
    "checked",
    "accept",
    "accessKey",
    "alt",
    "controllers",
    "defaultChecked",
    "defaultValue",
    "disabled",
    "form",
    "maxLength",
    "name",
    "readOnly",
    "selectionEnd",
    "selectionStart",
    "size",
    "src",
    "textLength",
    "useMap",

    "click",
    "select",
    "setSelectionRange"
]);

domMemberMap.HTMLFormElement = extendArray(domMemberMap.Element,
[
    "acceptCharset",
    "action",
    "author",
    "elements",
    "encoding",
    "enctype",
    "entry_id",
    "length",
    "method",
    "name",
    "post",
    "target",
    "text",
    "url",

    "reset",
    "submit"
]);

domMemberMap.HTMLBodyElement = extendArray(domMemberMap.Element,
[
    "aLink",
    "background",
    "bgColor",
    "link",
    "text",
    "vLink"
]);

domMemberMap.HTMLHtmlElement = extendArray(domMemberMap.Element,
[
    "version"
]);

domMemberMap.Text = extendArray(domMemberMap.Node,
[
    "data",
    "length",

    "appendData",
    "deleteData",
    "insertData",
    "replaceData",
    "splitText",
    "substringData"
]);

domMemberMap.Attr = extendArray(domMemberMap.Node,
[
    "name",
    "value",
    "specified",
    "ownerElement"
]);

domMemberMap.Event =
[
    "type",
    "target",
    "currentTarget",
    "originalTarget",
    "explicitOriginalTarget",
    "relatedTarget",
    "rangeParent",
    "rangeOffset",
    "view",

    "keyCode",
    "charCode",
    "screenX",
    "screenY",
    "clientX",
    "clientY",
    "layerX",
    "layerY",
    "pageX",
    "pageY",

    "detail",
    "button",
    "which",
    "ctrlKey",
    "shiftKey",
    "altKey",
    "metaKey",

    "eventPhase",
    "timeStamp",
    "bubbles",
    "cancelable",
    "cancelBubble",

    "isTrusted",
    "isChar",

    "getPreventDefault",
    "initEvent",
    "initMouseEvent",
    "initKeyEvent",
    "initUIEvent",
    "preventBubble",
    "preventCapture",
    "preventDefault",
    "stopPropagation"
];

// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *

this.domConstantMap =
{
    "ELEMENT_NODE": 1,
    "ATTRIBUTE_NODE": 1,
    "TEXT_NODE": 1,
    "CDATA_SECTION_NODE": 1,
    "ENTITY_REFERENCE_NODE": 1,
    "ENTITY_NODE": 1,
    "PROCESSING_INSTRUCTION_NODE": 1,
    "COMMENT_NODE": 1,
    "DOCUMENT_NODE": 1,
    "DOCUMENT_TYPE_NODE": 1,
    "DOCUMENT_FRAGMENT_NODE": 1,
    "NOTATION_NODE": 1,

    "DOCUMENT_POSITION_DISCONNECTED": 1,
    "DOCUMENT_POSITION_PRECEDING": 1,
    "DOCUMENT_POSITION_FOLLOWING": 1,
    "DOCUMENT_POSITION_CONTAINS": 1,
    "DOCUMENT_POSITION_CONTAINED_BY": 1,
    "DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC": 1,

    "UNKNOWN_RULE": 1,
    "STYLE_RULE": 1,
    "CHARSET_RULE": 1,
    "IMPORT_RULE": 1,
    "MEDIA_RULE": 1,
    "FONT_FACE_RULE": 1,
    "PAGE_RULE": 1,

    "CAPTURING_PHASE": 1,
    "AT_TARGET": 1,
    "BUBBLING_PHASE": 1,

    "SCROLL_PAGE_UP": 1,
    "SCROLL_PAGE_DOWN": 1,

    "MOUSEUP": 1,
    "MOUSEDOWN": 1,
    "MOUSEOVER": 1,
    "MOUSEOUT": 1,
    "MOUSEMOVE": 1,
    "MOUSEDRAG": 1,
    "CLICK": 1,
    "DBLCLICK": 1,
    "KEYDOWN": 1,
    "KEYUP": 1,
    "KEYPRESS": 1,
    "DRAGDROP": 1,
    "FOCUS": 1,
    "BLUR": 1,
    "SELECT": 1,
    "CHANGE": 1,
    "RESET": 1,
    "SUBMIT": 1,
    "SCROLL": 1,
    "LOAD": 1,
    "UNLOAD": 1,
    "XFER_DONE": 1,
    "ABORT": 1,
    "ERROR": 1,
    "LOCATE": 1,
    "MOVE": 1,
    "RESIZE": 1,
    "FORWARD": 1,
    "HELP": 1,
    "BACK": 1,
    "TEXT": 1,

    "ALT_MASK": 1,
    "CONTROL_MASK": 1,
    "SHIFT_MASK": 1,
    "META_MASK": 1,

    "DOM_VK_TAB": 1,
    "DOM_VK_PAGE_UP": 1,
    "DOM_VK_PAGE_DOWN": 1,
    "DOM_VK_UP": 1,
    "DOM_VK_DOWN": 1,
    "DOM_VK_LEFT": 1,
    "DOM_VK_RIGHT": 1,
    "DOM_VK_CANCEL": 1,
    "DOM_VK_HELP": 1,
    "DOM_VK_BACK_SPACE": 1,
    "DOM_VK_CLEAR": 1,
    "DOM_VK_RETURN": 1,
    "DOM_VK_ENTER": 1,
    "DOM_VK_SHIFT": 1,
    "DOM_VK_CONTROL": 1,
    "DOM_VK_ALT": 1,
    "DOM_VK_PAUSE": 1,
    "DOM_VK_CAPS_LOCK": 1,
    "DOM_VK_ESCAPE": 1,
    "DOM_VK_SPACE": 1,
    "DOM_VK_END": 1,
    "DOM_VK_HOME": 1,
    "DOM_VK_PRINTSCREEN": 1,
    "DOM_VK_INSERT": 1,
    "DOM_VK_DELETE": 1,
    "DOM_VK_0": 1,
    "DOM_VK_1": 1,
    "DOM_VK_2": 1,
    "DOM_VK_3": 1,
    "DOM_VK_4": 1,
    "DOM_VK_5": 1,
    "DOM_VK_6": 1,
    "DOM_VK_7": 1,
    "DOM_VK_8": 1,
    "DOM_VK_9": 1,
    "DOM_VK_SEMICOLON": 1,
    "DOM_VK_EQUALS": 1,
    "DOM_VK_A": 1,
    "DOM_VK_B": 1,
    "DOM_VK_C": 1,
    "DOM_VK_D": 1,
    "DOM_VK_E": 1,
    "DOM_VK_F": 1,
    "DOM_VK_G": 1,
    "DOM_VK_H": 1,
    "DOM_VK_I": 1,
    "DOM_VK_J": 1,
    "DOM_VK_K": 1,
    "DOM_VK_L": 1,
    "DOM_VK_M": 1,
    "DOM_VK_N": 1,
    "DOM_VK_O": 1,
    "DOM_VK_P": 1,
    "DOM_VK_Q": 1,
    "DOM_VK_R": 1,
    "DOM_VK_S": 1,
    "DOM_VK_T": 1,
    "DOM_VK_U": 1,
    "DOM_VK_V": 1,
    "DOM_VK_W": 1,
    "DOM_VK_X": 1,
    "DOM_VK_Y": 1,
    "DOM_VK_Z": 1,
    "DOM_VK_CONTEXT_MENU": 1,
    "DOM_VK_NUMPAD0": 1,
    "DOM_VK_NUMPAD1": 1,
    "DOM_VK_NUMPAD2": 1,
    "DOM_VK_NUMPAD3": 1,
    "DOM_VK_NUMPAD4": 1,
    "DOM_VK_NUMPAD5": 1,
    "DOM_VK_NUMPAD6": 1,
    "DOM_VK_NUMPAD7": 1,
    "DOM_VK_NUMPAD8": 1,
    "DOM_VK_NUMPAD9": 1,
    "DOM_VK_MULTIPLY": 1,
    "DOM_VK_ADD": 1,
    "DOM_VK_SEPARATOR": 1,
    "DOM_VK_SUBTRACT": 1,
    "DOM_VK_DECIMAL": 1,
    "DOM_VK_DIVIDE": 1,
    "DOM_VK_F1": 1,
    "DOM_VK_F2": 1,
    "DOM_VK_F3": 1,
    "DOM_VK_F4": 1,
    "DOM_VK_F5": 1,
    "DOM_VK_F6": 1,
    "DOM_VK_F7": 1,
    "DOM_VK_F8": 1,
    "DOM_VK_F9": 1,
    "DOM_VK_F10": 1,
    "DOM_VK_F11": 1,
    "DOM_VK_F12": 1,
    "DOM_VK_F13": 1,
    "DOM_VK_F14": 1,
    "DOM_VK_F15": 1,
    "DOM_VK_F16": 1,
    "DOM_VK_F17": 1,
    "DOM_VK_F18": 1,
    "DOM_VK_F19": 1,
    "DOM_VK_F20": 1,
    "DOM_VK_F21": 1,
    "DOM_VK_F22": 1,
    "DOM_VK_F23": 1,
    "DOM_VK_F24": 1,
    "DOM_VK_NUM_LOCK": 1,
    "DOM_VK_SCROLL_LOCK": 1,
    "DOM_VK_COMMA": 1,
    "DOM_VK_PERIOD": 1,
    "DOM_VK_SLASH": 1,
    "DOM_VK_BACK_QUOTE": 1,
    "DOM_VK_OPEN_BRACKET": 1,
    "DOM_VK_BACK_SLASH": 1,
    "DOM_VK_CLOSE_BRACKET": 1,
    "DOM_VK_QUOTE": 1,
    "DOM_VK_META": 1,

    "SVG_ZOOMANDPAN_DISABLE": 1,
    "SVG_ZOOMANDPAN_MAGNIFY": 1,
    "SVG_ZOOMANDPAN_UNKNOWN": 1
};

this.cssInfo =
{
    "background": ["bgRepeat", "bgAttachment", "bgPosition", "color", "systemColor", "none"],
    "background-attachment": ["bgAttachment"],
    "background-color": ["color", "systemColor"],
    "background-image": ["none"],
    "background-position": ["bgPosition"],
    "background-repeat": ["bgRepeat"],

    "border": ["borderStyle", "thickness", "color", "systemColor", "none"],
    "border-top": ["borderStyle", "borderCollapse", "color", "systemColor", "none"],
    "border-right": ["borderStyle", "borderCollapse", "color", "systemColor", "none"],
    "border-bottom": ["borderStyle", "borderCollapse", "color", "systemColor", "none"],
    "border-left": ["borderStyle", "borderCollapse", "color", "systemColor", "none"],
    "border-collapse": ["borderCollapse"],
    "border-color": ["color", "systemColor"],
    "border-top-color": ["color", "systemColor"],
    "border-right-color": ["color", "systemColor"],
    "border-bottom-color": ["color", "systemColor"],
    "border-left-color": ["color", "systemColor"],
    "border-spacing": [],
    "border-style": ["borderStyle"],
    "border-top-style": ["borderStyle"],
    "border-right-style": ["borderStyle"],
    "border-bottom-style": ["borderStyle"],
    "border-left-style": ["borderStyle"],
    "border-width": ["thickness"],
    "border-top-width": ["thickness"],
    "border-right-width": ["thickness"],
    "border-bottom-width": ["thickness"],
    "border-left-width": ["thickness"],

    "bottom": ["auto"],
    "caption-side": ["captionSide"],
    "clear": ["clear", "none"],
    "clip": ["auto"],
    "color": ["color", "systemColor"],
    "content": ["content", "none"],
    "counter-increment": ["none"],
    "counter-reset": ["none"],
    "cursor": ["cursor", "none"],
    "direction": ["direction"],
    "display": ["display", "none"],
    "empty-cells": [],
    "float": ["float", "none"],
    "font": ["fontStyle", "fontVariant", "fontWeight", "fontFamily"],

    "font-family": ["fontFamily"],
    "font-size": ["fontSize"],
    "font-size-adjust": [],
    "font-stretch": [],
    "font-style": ["fontStyle"],
    "font-variant": ["fontVariant"],
    "font-weight": ["fontWeight"],

    "height": ["auto"],
    "ime-mode": ["imeMode", "auto"],
    "left": ["auto"],
    "letter-spacing": [],
    "line-height": [],

    "list-style": ["listStyleType", "listStylePosition", "none"],
    "list-style-image": ["none"],
    "list-style-position": ["listStylePosition"],
    "list-style-type": ["listStyleType", "none"],

    "margin": [],
    "margin-top": [],
    "margin-right": [],
    "margin-bottom": [],
    "margin-left": [],

    "marker-offset": ["auto"],
    "min-height": ["none"],
    "max-height": ["none"],
    "min-width": ["width", "none"],
    "max-width": ["width", "none"],

    "opacity": [],

    "outline": ["borderStyle", "color", "systemColor", "none"],
    "outline-color": ["color", "systemColor"],
    "outline-style": ["borderStyle"],
    "outline-width": [],

    "overflow": ["overflow", "auto"],
    "overflow-x": ["overflow", "auto"],
    "overflow-y": ["overflow", "auto"],

    "padding": [],
    "padding-top": [],
    "padding-right": [],
    "padding-bottom": [],
    "padding-left": [],

    "position": ["position"],
    "quotes": ["none"],
    "right": ["auto"],
    "table-layout": ["tableLayout", "auto"],
    "text-align": ["textAlign"],
    "text-decoration": ["textDecoration", "none"],
    "text-indent": [],
    "text-rendering": ["textRendering", "auto"],
    "text-shadow": [],
    "text-transform": ["textTransform", "none"],
    "top": ["auto"],
    "unicode-bidi": [],
    "vertical-align": ["verticalAlign"],
    "white-space": ["whiteSpace"],
    "width": ["width", "auto"],
    "word-spacing": [],
    "word-wrap": ["wordWrap"],
    "z-index": [],

    "-moz-appearance": ["mozAppearance"],
    "-moz-border-image": ["mozBorderImage", "thickness", "none"],
    "-moz-border-radius": [],
    "-moz-border-radius-bottomleft": [],
    "-moz-border-radius-bottomright": [],
    "-moz-border-radius-topleft": [],
    "-moz-border-radius-topright": [],
    "-moz-border-top-colors": ["color", "systemColor"],
    "-moz-border-right-colors": ["color", "systemColor"],
    "-moz-border-bottom-colors": ["color", "systemColor"],
    "-moz-border-left-colors": ["color", "systemColor"],
    "-moz-border-start": ["borderStyle", "borderCollapse", "color", "systemColor", "none"],
    "-moz-border-end": ["borderStyle", "borderCollapse", "color", "systemColor", "none"],
    "-moz-border-start-color": ["color", "systemColor"],
    "-moz-border-end-color": ["color", "systemColor"],
    "-moz-border-start-style": ["borderStyle"],
    "-moz-border-end-style": ["borderStyle"],
    "-moz-border-start-width": ["thickness"],
    "-moz-border-end-width": ["thickness"],
    "-moz-box-align": ["mozBoxAlign"],
    "-moz-box-direction": ["mozBoxDirection"],
    "-moz-box-flex": [],
    "-moz-box-ordinal-group": [],
    "-moz-box-orient": ["mozBoxOrient"],
    "-moz-box-pack": ["mozBoxPack"],
    "-moz-box-shadow": ["mozBoxShadow", "none"],
    "-moz-box-sizing": ["mozBoxSizing"],
    "-moz-user-focus": ["userFocus", "none"],
    "-moz-user-input": ["userInput"],
    "-moz-user-modify": [],
    "-moz-user-select": ["userSelect", "none"],
    "-moz-background-clip": [],
    "-moz-background-inline-policy": [],
    "-moz-background-origin": [],
    "-moz-binding": [],
    "-moz-column-count": [],
    "-moz-column-gap": [],
    "-moz-column-rule": ["thickness", "borderStyle", "color", "systemColor"],
    "-moz-column-rule-width": ["thickness"],
    "-moz-column-rule-style": ["borderStyle"],
    "-moz-column-rule-color": ["color",  "systemColor"],
    "-moz-column-width": [],
    "-moz-image-region": [],
    "-moz-transform": ["mozTransformFunction", "none"],
    "-moz-transform-origin": ["bgPosition"]
};

this.inheritedStyleNames =
{
    "border-collapse": 1,
    "border-spacing": 1,
    "border-style": 1,
    "caption-side": 1,
    "color": 1,
    "cursor": 1,
    "direction": 1,
    "empty-cells": 1,
    "font": 1,
    "font-family": 1,
    "font-size-adjust": 1,
    "font-size": 1,
    "font-style": 1,
    "font-variant": 1,
    "font-weight": 1,
    "letter-spacing": 1,
    "line-height": 1,
    "list-style": 1,
    "list-style-image": 1,
    "list-style-position": 1,
    "list-style-type": 1,
    "opacity": 1,
    "quotes": 1,
    "text-align": 1,
    "text-decoration": 1,
    "text-indent": 1,
    "text-shadow": 1,
    "text-transform": 1,
    "white-space": 1,
    "word-spacing": 1,
    "word-wrap": 1
};

this.cssKeywords =
{
    "appearance":
    [
        "button",
        "button-small",
        "checkbox",
        "checkbox-container",
        "checkbox-small",
        "dialog",
        "listbox",
        "menuitem",
        "menulist",
        "menulist-button",
        "menulist-textfield",
        "menupopup",
        "progressbar",
        "radio",
        "radio-container",
        "radio-small",
        "resizer",
        "scrollbar",
        "scrollbarbutton-down",
        "scrollbarbutton-left",
        "scrollbarbutton-right",
        "scrollbarbutton-up",
        "scrollbartrack-horizontal",
        "scrollbartrack-vertical",
        "separator",
        "statusbar",
        "tab",
        "tab-left-edge",
        "tabpanels",
        "textfield",
        "toolbar",
        "toolbarbutton",
        "toolbox",
        "tooltip",
        "treeheadercell",
        "treeheadersortarrow",
        "treeitem",
        "treetwisty",
        "treetwistyopen",
        "treeview",
        "window"
    ],

    "systemColor":
    [
        "ActiveBorder",
        "ActiveCaption",
        "AppWorkspace",
        "Background",
        "ButtonFace",
        "ButtonHighlight",
        "ButtonShadow",
        "ButtonText",
        "CaptionText",
        "GrayText",
        "Highlight",
        "HighlightText",
        "InactiveBorder",
        "InactiveCaption",
        "InactiveCaptionText",
        "InfoBackground",
        "InfoText",
        "Menu",
        "MenuText",
        "Scrollbar",
        "ThreeDDarkShadow",
        "ThreeDFace",
        "ThreeDHighlight",
        "ThreeDLightShadow",
        "ThreeDShadow",
        "Window",
        "WindowFrame",
        "WindowText",
        "-moz-field",
        "-moz-fieldtext",
        "-moz-workspace",
        "-moz-visitedhyperlinktext",
        "-moz-nativehyperlinktext",
        "-moz-use-text-color"
    ],

    "color":
    [
        "AliceBlue",
        "AntiqueWhite",
        "Aqua",
        "Aquamarine",
        "Azure",
        "Beige",
        "Bisque",
        "Black",
        "BlanchedAlmond",
        "Blue",
        "BlueViolet",
        "Brown",
        "BurlyWood",
        "CadetBlue",
        "Chartreuse",
        "Chocolate",
        "Coral",
        "CornflowerBlue",
        "Cornsilk",
        "Crimson",
        "Cyan",
        "DarkBlue",
        "DarkCyan",
        "DarkGoldenRod",
        "DarkGray",
        "DarkGreen",
        "DarkKhaki",
        "DarkMagenta",
        "DarkOliveGreen",
        "DarkOrange",
        "DarkOrchid",
        "DarkRed",
        "DarkSalmon",
        "DarkSeaGreen",
        "DarkSlateBlue",
        "DarkSlateGray",
        "DarkTurquoise",
        "DarkViolet",
        "DeepPink",
        "DarkSkyBlue",
        "DimGray",
        "DodgerBlue",
        "Feldspar",
        "FireBrick",
        "FloralWhite",
        "ForestGreen",
        "Fuchsia",
        "Gainsboro",
        "GhostWhite",
        "Gold",
        "GoldenRod",
        "Gray",
        "Green",
        "GreenYellow",
        "HoneyDew",
        "HotPink",
        "IndianRed",
        "Indigo",
        "Ivory",
        "Khaki",
        "Lavender",
        "LavenderBlush",
        "LawnGreen",
        "LemonChiffon",
        "LightBlue",
        "LightCoral",
        "LightCyan",
        "LightGoldenRodYellow",
        "LightGrey",
        "LightGreen",
        "LightPink",
        "LightSalmon",
        "LightSeaGreen",
        "LightSkyBlue",
        "LightSlateBlue",
        "LightSlateGray",
        "LightSteelBlue",
        "LightYellow",
        "Lime",
        "LimeGreen",
        "Linen",
        "Magenta",
        "Maroon",
        "MediumAquaMarine",
        "MediumBlue",
        "MediumOrchid",
        "MediumPurple",
        "MediumSeaGreen",
        "MediumSlateBlue",
        "MediumSpringGreen",
        "MediumTurquoise",
        "MediumVioletRed",
        "MidnightBlue",
        "MintCream",
        "MistyRose",
        "Moccasin",
        "NavajoWhite",
        "Navy",
        "OldLace",
        "Olive",
        "OliveDrab",
        "Orange",
        "OrangeRed",
        "Orchid",
        "PaleGoldenRod",
        "PaleGreen",
        "PaleTurquoise",
        "PaleVioletRed",
        "PapayaWhip",
        "PeachPuff",
        "Peru",
        "Pink",
        "Plum",
        "PowderBlue",
        "Purple",
        "Red",
        "RosyBrown",
        "RoyalBlue",
        "SaddleBrown",
        "Salmon",
        "SandyBrown",
        "SeaGreen",
        "SeaShell",
        "Sienna",
        "Silver",
        "SkyBlue",
        "SlateBlue",
        "SlateGray",
        "Snow",
        "SpringGreen",
        "SteelBlue",
        "Tan",
        "Teal",
        "Thistle",
        "Tomato",
        "Turquoise",
        "Violet",
        "VioletRed",
        "Wheat",
        "White",
        "WhiteSmoke",
        "Yellow",
        "YellowGreen",
        "transparent",
        "invert"
    ],

    "auto":
    [
        "auto"
    ],

    "none":
    [
        "none"
    ],

    "captionSide":
    [
        "top",
        "bottom",
        "left",
        "right"
    ],

    "clear":
    [
        "left",
        "right",
        "both"
    ],

    "cursor":
    [
        "auto",
        "cell",
        "context-menu",
        "crosshair",
        "default",
        "help",
        "pointer",
        "progress",
        "move",
        "e-resize",
        "all-scroll",
        "ne-resize",
        "nw-resize",
        "n-resize",
        "se-resize",
        "sw-resize",
        "s-resize",
        "w-resize",
        "ew-resize",
        "ns-resize",
        "nesw-resize",
        "nwse-resize",
        "col-resize",
        "row-resize",
        "text",
        "vertical-text",
        "wait",
        "alias",
        "copy",
        "move",
        "no-drop",
        "not-allowed",
        "-moz-alias",
        "-moz-cell",
        "-moz-copy",
        "-moz-grab",
        "-moz-grabbing",
        "-moz-contextmenu",
        "-moz-zoom-in",
        "-moz-zoom-out",
        "-moz-spinning"
    ],

    "direction":
    [
        "ltr",
        "rtl"
    ],

    "bgAttachment":
    [
        "scroll",
        "fixed"
    ],

    "bgPosition":
    [
        "top",
        "center",
        "bottom",
        "left",
        "right"
    ],

    "bgRepeat":
    [
        "repeat",
        "repeat-x",
        "repeat-y",
        "no-repeat"
    ],

    "borderStyle":
    [
        "hidden",
        "dotted",
        "dashed",
        "solid",
        "double",
        "groove",
        "ridge",
        "inset",
        "outset",
        "-moz-bg-inset",
        "-moz-bg-outset",
        "-moz-bg-solid"
    ],

    "borderCollapse":
    [
        "collapse",
        "separate"
    ],

    "overflow":
    [
        "visible",
        "hidden",
        "scroll",
        "-moz-scrollbars-horizontal",
        "-moz-scrollbars-none",
        "-moz-scrollbars-vertical"
    ],

    "listStyleType":
    [
        "disc",
        "circle",
        "square",
        "decimal",
        "decimal-leading-zero",
        "lower-roman",
        "upper-roman",
        "lower-greek",
        "lower-alpha",
        "lower-latin",
        "upper-alpha",
        "upper-latin",
        "hebrew",
        "armenian",
        "georgian",
        "cjk-ideographic",
        "hiragana",
        "katakana",
        "hiragana-iroha",
        "katakana-iroha",
        "inherit"
    ],

    "listStylePosition":
    [
        "inside",
        "outside"
    ],

    "content":
    [
        "open-quote",
        "close-quote",
        "no-open-quote",
        "no-close-quote",
        "inherit"
    ],

    "fontStyle":
    [
        "normal",
        "italic",
        "oblique",
        "inherit"
    ],

    "fontVariant":
    [
        "normal",
        "small-caps",
        "inherit"
    ],

    "fontWeight":
    [
        "normal",
        "bold",
        "bolder",
        "lighter",
        "inherit"
    ],

    "fontSize":
    [
        "xx-small",
        "x-small",
        "small",
        "medium",
        "large",
        "x-large",
        "xx-large",
        "smaller",
        "larger"
    ],

    "fontFamily":
    [
        "Arial",
        "Comic Sans MS",
        "Georgia",
        "Tahoma",
        "Verdana",
        "Times New Roman",
        "Trebuchet MS",
        "Lucida Grande",
        "Helvetica",
        "serif",
        "sans-serif",
        "cursive",
        "fantasy",
        "monospace",
        "caption",
        "icon",
        "menu",
        "message-box",
        "small-caption",
        "status-bar",
        "inherit"
    ],

    "display":
    [
        "block",
        "inline",
        "inline-block",
        "list-item",
        "marker",
        "run-in",
        "compact",
        "table",
        "inline-table",
        "table-row-group",
        "table-column",
        "table-column-group",
        "table-header-group",
        "table-footer-group",
        "table-row",
        "table-cell",
        "table-caption",
        "-moz-box",
        "-moz-compact",
        "-moz-deck",
        "-moz-grid",
        "-moz-grid-group",
        "-moz-grid-line",
        "-moz-groupbox",
        "-moz-inline-block",
        "-moz-inline-box",
        "-moz-inline-grid",
        "-moz-inline-stack",
        "-moz-inline-table",
        "-moz-marker",
        "-moz-popup",
        "-moz-runin",
        "-moz-stack"
    ],

    "position":
    [
        "static",
        "relative",
        "absolute",
        "fixed",
        "inherit"
    ],

    "float":
    [
        "left",
        "right"
    ],

    "textAlign":
    [
        "left",
        "right",
        "center",
        "justify"
    ],

    "tableLayout":
    [
        "fixed"
    ],

    "textDecoration":
    [
        "underline",
        "overline",
        "line-through",
        "blink"
    ],

    "textTransform":
    [
        "capitalize",
        "lowercase",
        "uppercase",
        "inherit"
    ],

    "unicodeBidi":
    [
        "normal",
        "embed",
        "bidi-override"
    ],

    "whiteSpace":
    [
        "normal",
        "pre",
        "nowrap",
        "pre-wrap",
        "pre-line",
        "inherit"
    ],

    "verticalAlign":
    [
        "baseline",
        "sub",
        "super",
        "top",
        "text-top",
        "middle",
        "bottom",
        "text-bottom",
        "inherit"
    ],

    "thickness":
    [
        "thin",
        "medium",
        "thick"
    ],

    "userFocus":
    [
        "ignore",
        "normal"
    ],

    "userInput":
    [
        "disabled",
        "enabled"
    ],

    "userSelect":
    [
        "normal"
    ],

    "mozBoxSizing":
    [
        "content-box",
        "padding-box",
        "border-box"
    ],

    "mozBoxAlign":
    [
        "start",
        "center",
        "end",
        "baseline",
        "stretch"
    ],

    "mozBoxDirection":
    [
        "normal",
        "reverse"
    ],

    "mozBoxOrient":
    [
        "horizontal",
        "vertical"
    ],

    "mozBoxPack":
    [
        "start",
        "center",
        "end"
    ],

    "mozBoxShadow":
    [
        "inset"
    ],

    "mozBorderImage":
    [
        "stretch",
        "round",
        "repeat"
    ],

    "mozTransformFunction":
    [
        "matrix",
        "rotate",
        "scale",
        "scaleX",
        "scaleY",
        "skew",
        "skewX",
        "skewY",
        "translate",
        "translateX",
        "translateY"
    ],

    "width":
    [
        "-moz-max-content",
        "-moz-min-content",
        "-moz-fit-content",
        "-moz-available"
    ],

    "imeMode":
    [
        "normal",
        "active",
        "inactive",
        "disabled"
    ],

    "textRendering":
    [
        "optimizeSpeed",
        "optimizeLegibility",
        "geometricPrecision"
    ],

    "wordWrap":
    [
        "normal",
        "break-word",
        "inherit"
    ]
};

this.nonEditableTags =
{
    "HTML": 1,
    "HEAD": 1,
    "html": 1,
    "head": 1
};

this.innerEditableTags =
{
    "BODY": 1,
    "body": 1
};

this.selfClosingTags =
{
    "meta": 1,
    "link": 1,
    "area": 1,
    "base": 1,
    "basefont": 1,
    "input": 1,
    "img": 1,
    "br": 1,
    "hr": 1
};

const invisibleTags = this.invisibleTags =
{
    "HTML": 1,
    "HEAD": 1,
    "TITLE": 1,
    "META": 1,
    "LINK": 1,
    "STYLE": 1,
    "SCRIPT": 1,
    "NOSCRIPT": 1,
    "BR": 1,

    "html": 1,
    "head": 1,
    "title": 1,
    "meta": 1,
    "link": 1,
    "style": 1,
    "script": 1,
    "noscript": 1,
    "br": 1,
    /*
    "window": 1,
    "browser": 1,
    "frame": 1,
    "tabbrowser": 1,
    "WINDOW": 1,
    "BROWSER": 1,
    "FRAME": 1,
    "TABBROWSER": 1,
    */
};

// ************************************************************************************************
// Debug Logging

this.ERROR = function(exc)
{
    if (FBTrace) {
        if (exc.stack) exc.stack = exc.stack.split('\n');
        FBTrace.sysout("lib.ERROR: "+exc, exc);
    }

        ddd("FIREBUG WARNING: " + exc);
}

// ************************************************************************************************
// Math Utils

this.formatNumber = function(number)
{
    number += "";
    var x = number.split(".");
    var x1 = x[0];
    var x2 = x.length > 1 ? "." + x[1] : "";
    var rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1))
        x1 = x1.replace(rgx, "$1" + "," + "$2");
    return x1 + x2;
}

// ************************************************************************************************
// File Size Utils

this.formatSize = function(bytes)
{
    if (bytes == -1 || bytes == undefined)
        return "?";
    else if (bytes == 0)
        return "0";
    else if (bytes < 1024)
        return bytes + " B";
    else if (bytes < (1024*1024))
        return Math.round(bytes/1024) + " KB";
    else
        return Math.round((bytes/(1024*1024))*100)/100 + " MB";
}

// ************************************************************************************************
// Time Utils

this.formatTime = function(elapsed)
{
    if (elapsed == -1)
        return "_"; // should be &nbsp; but this will be escaped so we need something that is no whitespace
    else if (elapsed == 0)
        return "0";
    else if (elapsed < 1000)
        return elapsed + "ms";
    else if (elapsed < 60000)
        return (Math.round(elapsed/10) / 100) + "s";
    else
    {
        var min = Math.floor(elapsed/60000);
        var sec = (elapsed % 60000);
        return min + "m " + (Math.round((elapsed/1000)%60)) + "s";
    }
}

// ************************************************************************************************

this.ReversibleIterator = function(length, start, reverse)
{
    this.length = length;
    this.index = start;
    this.reversed = !!reverse;

    this.next = function() {
        if (this.index === undefined || this.index === null) {
            this.index = this.reversed ? length : -1;
        }
        this.index += this.reversed ? -1 : 1;

        return 0 <= this.index && this.index < length;
    };
    this.reverse = function() {
        this.reversed = !this.reversed;
    };
};

this.ReversibleRegExp = function(regex, flags)
{
    var re = {};

    function expression(text, reverse) {
        return text + (reverse ? "(?![\\s\\S]*" + text + ")" : "");
    }
    function flag(flags, caseSensitive) {
        return (flags || "") + (caseSensitive ? "" : "i");
    }

    this.exec = function(text, reverse, caseSensitive, lastMatch)
    {
        // Ensure we have a regex
        var key = (reverse ? "r" : "n") + (caseSensitive ? "n" : "i");
        if (!re[key])
        {
            re[key] = new RegExp(expression(regex, reverse), flag(flags, caseSensitive));
        }

        // Modify as needed to all for iterative searches
        var indexOffset = 0;
        var searchText = text;
        if (lastMatch) {
            if (reverse) {
                searchText = text.substr(0, lastMatch.index);
            } else {
                indexOffset = lastMatch.index+lastMatch[0].length;
                searchText = text.substr(indexOffset);
            }
        }

        var ret = re[key].exec(searchText);
        if (ret) {
            ret.input = text;
            ret.index = ret.index + indexOffset;
            ret.reverse = reverse;
            ret.caseSensitive = caseSensitive;
        }
        return ret;
    };
};

}).apply(FBL);
} catch(e) /*@explore*/
{ /*@explore*/
    dump("FBL Fails "+e+"\n"); /*@explore*/
    dump("If the service @joehewitt.com/firebug;1 fails, try deleting compreg.dat, xpti.dat\n"); /*@explore*/
    dump("Another cause can be mangled install.rdf.\n"); /*@explore*/
} /*@explore*/
