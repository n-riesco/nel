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

(function() {
    var DEBUG = false;

    var fs = require("fs");
    var path = require("path");
    var util = require("util");
    var vm = require("vm");

    var logFile = path.join(path.dirname(module.filename), "nel.log");

    function log() {
        fs.appendFileSync(logFile, util.format.apply(this, arguments) + "\n");
    }

    Object.defineProperty(global, "$$defaultMimer$$", {
        value: defaultMimer,
        configurable: false,
        writable: false,
        enumarable: false,
    });

    process.on("message", onMessage.bind(this));
    process.on("uncaughtException", onUncaughtException.bind(this));

    function onUncaughtException(error) {
        if (DEBUG) log("NEL: UNCAUGHTEXCEPTION:", error);
        sendError(error);
    }

    function onMessage(request) {
        if (DEBUG) log("NEL: MESSAGE: REQUEST:", request);

        var action = request[0];
        var code = request[1];

        resetGlobals();

        try {
            if (action === "getAllPropertyNames") {
                doPropertyRequest(code);
            } else if (action === "inspect") {
                doInspectRequest(code);
            } else if (action === "run") {
                doRunRequest(code);
            } else {
                throw new Error("NEL: Unhandled action request: " + action);
            }
        } catch (error) {
            sendError(error);
        }
    }

    function resetGlobals() {
        if (typeof global.$$mimer$$ !== "function") {
            global.$$mimer$$ = defaultMimer;
        }

        delete global.$$html$$;
        delete global.$$jpeg$$;
        delete global.$$png$$;
        delete global.$$svg$$;
        delete global.$$mime$$;

        delete global.$$async$$;

        // Set global.$$done$$ to a function that can be invoked to return a
        // response to the current run request.
        // To avoid sending multiple responses, global.$$done$$ is deleted
        // immediately after sending the response.
        global.$$done$$ = sendResult;
    }

    function doPropertyRequest(code) {
        var response = {
            names: getAllPropertyNames(run(code))
        };
        send(response);
    }

    function doInspectRequest(code) {
        var response = {
            inspection: inspect(run(code))
        };
        send(response);
    }

    function doRunRequest(code) {
        var result = run(code);

        // Send the result only if global.$$async$$ hasn't been set.
        if (!global.$$async$$) {
            sendResult(result);
        }
    }

    function sendResult(result) {
        // If no response has been sent yet, send the result as a response.
        // Otherwise, send the result via stdout.
        if (global.$$done$$) {
            var mimer = (typeof global.$$mimer$$ === "function") ?
                global.$$mimer$$ :
                defaultMimer;
            send({
                mime: mimer(result)
            });
        } else {
            console.log(result);
        }
    }

    function sendError(error) {
        // If no response has been sent yet, send the error as a response.
        // Otherwise, send the error stack via stderr.
        if (global.$$done$$) {
            send(formatError(error));
        } else {
            console.warn(error.stack);
        }
    }

    function send(message) {
        if (DEBUG) log("NEL: SEND:", message);

        process.send(message);

        // Delete global.$$done$$ to flag that a response has just been sent
        delete global.$$done$$;
    }

    function defaultMimer(result) {
        var mime = (typeof global.$$mime$$ === "object") ? global.$$mime$$ : {};

        if (global.$$html$$) {
            mime["text/html"] = global.$$html$$;
        }

        if (global.$$jpeg$$) {
            mime["image/jpeg"] = global.$$jpeg$$;
        }

        if (global.$$png$$) {
            mime["image/png"] = global.$$png$$;
        }

        if (global.$$svg$$) {
            mime["image/svg+xml"] = global.$$svg$$;
        }

        if (Object.keys(mime).length === 0) {
            mime["text/plain"] = toString(result);
        }

        return mime;

        function toString(obj) {
            var s;
            if (typeof obj === "function") {
                s = obj.toString();
            } else {
                s = util.inspect(obj);
            }
            return s;
        }
    }

    function formatError(error) {
        return {
            error: {
                ename: (error && error.name) ?
                    error.name : typeof error,
                evalue: (error && error.message) ?
                    error.message : util.inspect(error),
                traceback: (error && error.stack) ?
                    error.stack.split("\n") : "",
            },
        };
    }

    function run(code) {
        return vm.runInThisContext(code);
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

        while (true) {
            var names;
            try {
                names = Object.getOwnPropertyNames(prototype).sort();
            } catch (e) {
                break;
            }
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

            var prototype = Object.getPrototypeOf(object);
            while (true) {
                try {
                    constructorList.push(prototype.constructor.name);
                } catch (e) {
                    break;
                }
                prototype = Object.getPrototypeOf(prototype);
            }

            return constructorList;
        }
    }
})();
