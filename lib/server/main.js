/*
 * BSD 3-Clause License
 *
 * Copyright (c) 2015, Nicolas Riesco and others as credited in the AUTHORS file
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 * may be used to endorse or promote products derived from this software without
 * specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 */

/* global util */
/* global vm */

/* global Context */
/* global defaultMimer */
/* global Requester */

// Shared variables
var DEBUG = !!process.env.DEBUG;
var log;
var requester;
var initialContext;

// Init IPC server
init();

return;

function init() {
    // Setup logger
    log = DEBUG ?
        function log() {
            process.send({
                log: "SERVER: " + util.format.apply(this, arguments),
            });
        } :
        function noop() {};

    // Create instance to send requests
    requester = new Requester();

    // Capture the initial context
    // (id left undefined to indicate this is the initial context)
    initialContext = new Context(requester);
    initialContext.captureGlobalContext();

    Object.defineProperty(global, "$$defaultMimer$$", {
        value: defaultMimer,
        configurable: false,
        writable: false,
        enumerable: false,
    });

    process.on("message", onMessage.bind(this));

    process.on("uncaughtException", onUncaughtException.bind(this));

    process.send({
        status: "online",
    });
}

function onUncaughtException(error) {
    log("UNCAUGHTEXCEPTION:", error.stack);
    process.send({
        stderr: error.stack.toString(),
    });
}

function onMessage(message) {
    log("RECEIVED:", message);

    var action = message[0];
    var code = message[1];
    var id = message[2];

    initialContext.releaseGlobalContext();
    var context = new Context(requester, id);
    context.captureGlobalContext();

    try {
        if (action === "getAllPropertyNames") {
            onNameRequest(code, context);
        } else if (action === "inspect") {
            onInspectRequest(code, context);
        } else if (action === "run") {
            onRunRequest(code, context);
        } else if (action === "reply") {
            onReply(message);
        } else {
            throw new Error("NEL: Unhandled action: " + action);
        }
    } catch (error) {
        context.$$.sendError(error);
    }

    context.releaseGlobalContext();
    initialContext.captureGlobalContext();
    initialContext._done = false;
}

function onReply(message) {
    var reply = message[1];
    var id = message[3];
    requester.receive(id, reply);
}

function onNameRequest(code, context) {
    var message = {
        id: context.id,
        names: getAllPropertyNames(run(code)),
        end: true,
    };
    context.send(message);
}

function onInspectRequest(code, context) {
    var message = {
        id: context.id,
        inspection: inspect(run(code)),
        end: true,
    };
    context.send(message);
}

function onRunRequest(code, context) {
    var result = run(code);

    // If a result has already been sent, do not send this result.
    if (context._done) {
        return;
    }

    // If the result is a Promise, send the result fulfilled by the promise
    if (isPromise(result)) {
        context.$$.sendResult(result);
        return;
    }

    // If async mode has been enabled (and the result is not a Promise),
    // do not send this result.
    if (context._async) {
        return;
    }

    // If no result has been sent yet and async mode has not been enabled,
    // send this result.
    context.$$.sendResult(result);

    return;

    function isPromise(output) {
        if (!global.Promise || typeof global.Promise !== "function") {
            return false;
        }
        return output instanceof global.Promise;
    }
}

function getAllPropertyNames(object) {
    var propertyList = [];

    if (object === undefined) {
        return [];
    }

    if (object === null) {
        return [];
    }

    var prototype;
    if (typeof object === "boolean") {
        prototype = Boolean.prototype;
    } else if (typeof object === "number") {
        prototype = Number.prototype;
    } else if (typeof object === "string") {
        prototype = String.prototype;
    } else {
        prototype = object;
    }

    var prototypeList = [prototype];

    function pushToPropertyList(e) {
        if (propertyList.indexOf(e) === -1) {
            propertyList.push(e);
        }
    }

    while (prototype) {
        var names = Object.getOwnPropertyNames(prototype).sort();
        names.forEach(pushToPropertyList);

        prototype = Object.getPrototypeOf(prototype);
        if (prototype === null) {
            break;
        }

        if (prototypeList.indexOf(prototype) === -1) {
            prototypeList.push(prototype);
        }
    }

    return propertyList;
}

function inspect(object) {
    if (object === undefined) {
        return {
            string: "undefined",
            type: "Undefined",
        };
    }

    if (object === null) {
        return {
            string: "null",
            type: "Null",
        };
    }

    if (typeof object === "boolean") {
        return {
            string: object ? "true" : "false",
            type: "Boolean",
            constructorList: ["Boolean", "Object"],
        };
    }

    if (typeof object === "number") {
        return {
            string: util.inspect(object),
            type: "Number",
            constructorList: ["Number", "Object"],
        };
    }

    if (typeof object === "string") {
        return {
            string: object,
            type: "String",
            constructorList: ["String", "Object"],
            length: object.length,
        };
    }

    if (typeof object === "function") {
        return {
            string: object.toString(),
            type: "Function",
            constructorList: ["Function", "Object"],
            length: object.length,
        };
    }

    var constructorList = getConstructorList(object);
    var result = {
        string: toString(object),
        type: constructorList[0] || "",
        constructorList: constructorList,
    };

    if ("length" in object) {
        result.length = object.length;
    }

    return result;

    function toString(object) {
        try {
            return util.inspect(object.valueOf());
        } catch (e) {
            return util.inspect(object);
        }
    }

    function getConstructorList(object) {
        var constructorList = [];

        for (
            var prototype = Object.getPrototypeOf(object);
            prototype && prototype.constructor;
            prototype = Object.getPrototypeOf(prototype)
        ) {
            constructorList.push(prototype.constructor.name);
        }

        return constructorList;
    }
}

function run(code) {
    return vm.runInThisContext(code);
}
