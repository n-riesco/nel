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
    var DEBUG = false || !!process.env.DEBUG;

    var console = require("console");
    var stream = require("stream");
    var util = require("util");
    var vm = require("vm");

    var initialStdout = process.stdout;
    var initialStderr = process.stderr;
    var initialConsole = new console.Console(initialStdout, initialStderr);
    delete global.console;
    global.console = initialConsole;

    var log = DEBUG ?
        function log() {
            process.send({
                log: "SERVER: " + util.format.apply(this, arguments),
            });
        } : function noop() {};

    var contextStdout = {};
    var contextStderr = {};
    var contextConsole = {};

    function Stdout(id, opt) {
        stream.Transform.call(this, opt);

        this._id = id;
        this._old = process.stdout;

        this.pipe(process.stdout);
    }

    Stdout.prototype = Object.create(stream.Transform.prototype);

    Stdout.prototype._transform = function(data, encoding, callback) {
        var response = {
            id: this._id,
            stdout: data.toString(),
        };
        log("STDOUT:", response);
        process.send(response);
        this.push(data);
        callback();
    };

    function Stderr(id, opt) {
        stream.Transform.call(this, opt);

        this._id = id;
        this._old = process.stderr;

        this.pipe(process.stderr);
    }

    Stderr.prototype = Object.create(stream.Transform.prototype);

    Stderr.prototype._transform = function(data, encoding, callback) {
        var response = {
            id: this._id,
            stderr: data.toString(),
        };
        log("STDERR:", response);
        process.send(response);
        this.push(data);
        callback();
    };

    function Console() {
        console.Console.apply(this, arguments);
        this._old = global.console;
        this.Console = global.console.Console;
    }

    Console.prototype = Object.create(console.Console.prototype);

    init();

    return;

    function init() {
        Object.defineProperty(global, "$$defaultMimer$$", {
            value: defaultMimer,
            configurable: false,
            writable: false,
            enumarable: false,
        });

        process.on("message", onMessage.bind(this));

        process.on("uncaughtException", onUncaughtException.bind(this));
    }

    function onUncaughtException(error) {
        log("UNCAUGHTEXCEPTION:", error.stack);
        process.send({
            stderr: error.stack.toString(),
        });
    }

    function onMessage(request) {
        log("REQUEST:", request);

        var action = request[0];
        var code = request[1];
        var id = request[2];

        setupContext(id);

        try {
            if (action === "getAllPropertyNames") {
                onNameRequest(code, id);
            } else if (action === "inspect") {
                onInspectRequest(code, id);
            } else if (action === "run") {
                onRunRequest(code, id);
            } else {
                throw new Error("NEL: Unhandled action request: " + action);
            }
        } catch (error) {
            sendResult({
                error: formatError(error),
            }, id);
        }
    }

    function onNameRequest(code, id) {
        sendResult({
            names: getAllPropertyNames(run(code))
        }, id);
    }

    function onInspectRequest(code, id) {
        sendResult({
            inspection: inspect(run(code))
        }, id);
    }

    function onRunRequest(code, id) {
        var result = run(code);

        // Do not send a result if global.$$async$$ has been set
        if (global.$$async$$) {
            return;
        }

        sendResult({
            mime: toMime(result)
        }, id);
    }

    function sendResult(message, id) {
        // Do not send a response if global.$$done$$ has already been deleted
        if (!global.$$done$$) {
            log("RESULT: DROPPED:", message);
            return;
        }

        log("RESULT:", message);

        message.id = id;
        process.send(message);

        // Delete global.$$done$$ to avoid sending multiple responses
        destroyContext(id);
    }

    function formatError(error) {
        return {
            ename: (error && error.name) ?
                error.name : typeof error,
            evalue: (error && error.message) ?
                error.message : util.inspect(error),
            traceback: (error && error.stack) ?
                error.stack.split("\n") : "",
        };
    }

    function toMime(result) {
        var mimer = (typeof global.$$mimer$$ === "function") ?
            global.$$mimer$$ :
            defaultMimer;
        return mimer(result);
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
            mime["text/plain"] = toPlainText(result);
        }

        return mime;

        function toPlainText(obj) {
            var s;
            if (typeof obj === "function") {
                s = obj.toString();
            } else {
                s = util.inspect(obj);
            }
            return s;
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

    function setupContext(id) {
        var stdout = new Stdout(id);
        contextStdout[id] = stdout;
        delete process.stdout;
        process.stdout = stdout;

        var stderr = new Stderr(id);
        contextStderr[id] = stderr;
        delete process.stderr;
        process.stderr = stderr;

        var console = new Console(stdout, stderr);
        contextConsole[id] = console;
        delete global.console;
        global.console = console;

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
        global.$$done$$ = function $$done$$(result) {
            sendResult({
                mime: toMime(result)
            }, id);
        };
    }

    function destroyContext(id) {
        var stdout = contextStdout[id];
        delete contextStdout[id];
        delete process.stdout;
        process.stdout = stdout._old;

        var stderr = contextStderr[id];
        delete contextStderr[id];
        delete process.stderr;
        process.stderr = stderr._old;

        var console = contextConsole[id];
        delete contextConsole[id];
        delete global.console;
        global.console = console._old;

        delete global.$$done$$;
    }

    function run(code) {
        return vm.runInThisContext(code);
    }
})();
