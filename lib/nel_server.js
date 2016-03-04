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

    function Context(id) {
        this._id = id;

        this._stdout = new Stdout(id);
        this._stderr = new Stderr(id);
        this._console = new Console(this._stdout, this._stderr);

        this._async = false;
        this._done = false;
    }

    Context.prototype = Object.create(null);

    Context.prototype.async = function async() {
        if (this._done) {
            log("RESULT: ASYNC: DROPPED: id =", this._id);
            return;
        }
        log("RESULT: ASYNC: id =", this._id);

        process.send({
            id: this._id,
            async: true,
        });

        this._async = true;
    };

    Context.prototype.done = function done(result) {
        Context.prototype.update.apply(this, arguments);

        if (this._done) {
            log("RESULT: END: DROPPED: id =", this._id);
            return;
        }
        log("RESULT: END: id =", this._id);

        process.send({
            id: this._id,
            end: true,
        });

        this._async = false;
        this._done = true;
    };

    Context.prototype.update = function update(result) {
        if (arguments.length !== 0) {
            this.mime(toMime(result));
        }
    };

    Context.prototype.error = function(error) {
        var message = {
            id: this._id,
            error: formatError(error),
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    Context.prototype.mime = function(mime) {
        var message = {
            id: this._id,
            mime: mime,
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    Context.prototype.text = function(text) {
        var message = {
            id: this._id,
            mime: {
                "text/plain": text,
            },
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    Context.prototype.html = function(html) {
        var message = {
            id: this._id,
            mime: {
                "text/html": html,
            },
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    Context.prototype.svg = function(svg) {
        var message = {
            id: this._id,
            mime: {
                "image/svg+xml": svg,
            },
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    Context.prototype.png = function(png) {
        var message = {
            id: this._id,
            mime: {
                "image/png": png,
            },
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    Context.prototype.jpeg = function(jpeg) {
        var message = {
            id: this._id,
            mime: {
                "image/jpeg": jpeg,
            },
        };
        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }
        log("RESULT:", message);
        process.send(message);
    };

    var contextTable = {};

    function captureContext(id) {
        var context = new Context(id);

        contextTable[id] = context;

        delete process.stdout;
        process.stdout = context._stdout;

        delete process.stderr;
        process.stderr = context._stderr;

        delete global.console;
        global.console = context._console;

        if (typeof global.$$mimer$$ !== "function") {
            global.$$mimer$$ = defaultMimer;
        }

        delete global.$$mime$$;
        Object.defineProperty(global, "$$mime$$", {
            set: function(value) {
                context.mime(value);
            },
            configurable: true,
            enumerable: false,
        });

        delete global.$$html$$;
        Object.defineProperty(global, "$$html$$", {
            set: function(value) {
                context.html(value);
            },
            configurable: true,
            enumerable: false,
        });

        delete global.$$svg$$;
        Object.defineProperty(global, "$$svg$$", {
            set: function(value) {
                context.svg(value);
            },
            configurable: true,
            enumerable: false,
        });

        delete global.$$png$$;
        Object.defineProperty(global, "$$png$$", {
            set: function(value) {
                context.png(value);
            },
            configurable: true,
            enumerable: false,
        });

        delete global.$$jpeg$$;
        Object.defineProperty(global, "$$jpeg$$", {
            set: function(value) {
                context.jpeg(value);
            },
            configurable: true,
            enumerable: false,
        });

        delete global.$$async$$;
        Object.defineProperty(global, "$$async$$", {
            get: function() {
                return context._async;
            },
            set: function(value) {
                if (value) {
                    context.async();
                }
                context._async = value;
            },
            configurable: true,
            enumerable: false,
        });

        // Set global.$$done$$ to a function that can be invoked to return a
        // response to the current run request.
        global.$$done$$ = Context.prototype.done.bind(context);

        return context;
    }

    function releaseContext(id) {
        var context = contextTable[id];

        if (!context) {
            return;
        }

        delete contextTable[id];

        if (process.stdout === context._stdout) {
            delete process.stdout;
            process.stdout = context._stdout._old;
        }

        if (process.stderr === context._stderr) {
            delete process.stderr;
            process.stderr = context._stderr._old;
        }

        if (global.console === context._console) {
            delete global.console;
            global.console = context._console._old;
        }
    }

    init();

    return;

    function init() {
        Object.defineProperty(global, "$$defaultMimer$$", {
            value: defaultMimer,
            configurable: false,
            writable: false,
            enumerable: false,
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

        var context = captureContext(id);

        try {
            if (action === "getAllPropertyNames") {
                onNameRequest(code, context);
            } else if (action === "inspect") {
                onInspectRequest(code, context);
            } else if (action === "run") {
                onRunRequest(code, context);
            } else {
                throw new Error("NEL: Unhandled action request: " + action);
            }
        } catch (error) {
            context.error(error);
            context.done();
        }

        releaseContext(id);
    }

    function onNameRequest(code, context) {
        var message = {
            id: context._id,
            names: getAllPropertyNames(run(code)),
        };
        log("RESULT:", message);
        process.send(message);

        context.done();
    }

    function onInspectRequest(code, context) {
        var message = {
            id: context._id,
            inspection: inspect(run(code)),
        };
        log("RESULT:", message);
        process.send(message);

        context.done();
    }

    function onRunRequest(code, context) {
        var result = run(code);

        // Drop result if the run request initiated the async mode
        if (context._async) {
            return;
        }
        
        // Drop result if the run request has already invoked context.done()
        if (context._done) {
            return;
        }

        context.done(result);
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
        if (typeof result === "undefined") {
            return {
                "text/plain": "undefined"
            };
        }

        if (result === null) {
            return {
                "text/plain": "null"
            };
        }

        var mime;
        if (result._toMime) {
            try {
                mime = result._toMime();
            } catch (error) {}
        }
        if (typeof mime !== "object") {
            mime = {};
        }

        if (!("text/plain" in mime)) {
            try {
                if (typeof result === "function") {
                    mime["text/plain"] = result.toString();
                } else if (result.inspect) {
                    mime["text/plain"] = result.inspect();
                }
            } catch (error) {}
        }
        if (!("text/plain" in mime)) {
            try {
                mime["text/plain"] = util.inspect(result);
            } catch (error) {}
        }

        if (result._toHtml && !("text/html" in mime)) {
            try {
                mime["text/html"] = result._toHtml();
            } catch (error) {}
        }

        if (result._toSvg && !("image/svg+xml" in mime)) {
            try {
                mime["image/svg+xml"] = result._toSvg();
            } catch (error) {}
        }

        if (result._toPng && !("image/png" in mime)) {
            try {
                mime["image/png"] = result._toPng();
            } catch (error) {}
        }

        if (result._toJpeg && !("image/jpeg" in mime)) {
            try {
                mime["image/jpeg"] = result._toJpeg();
            } catch (error) {}
        }

        return mime;
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

    function run(code) {
        return vm.runInThisContext(code);
    }
})();
