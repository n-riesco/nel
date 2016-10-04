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

import stream from "stream";
import util from "util";
import vm from "vm";
import console from "console";
import io from 'socket.io';
import EventEmitter from 'events';

let channel;
const DEBUG = !!process.env.DEBUG;

let log = DEBUG ?
  function doLog() {
    var msg = {
        log: "SERVER: " + util.format.apply(this, arguments),
    }
    if(channel) {
      channel.send(msg);
    }
    console.log(msg);
  } : function noop() {};


function Stdout(id, opt) {
    stream.Transform.call(this, opt);

    this._id = id;
}

Stdout.prototype = Object.create(stream.Transform.prototype);

Stdout.prototype._transform = function(data, encoding, callback) {
    var response = {
        id: this._id,
        stdout: data.toString(),
    };
    log("STDOUT:", response);
    channel.send(response);
    this.push(data);
    callback();
};

function Stderr(id, opt) {
    stream.Transform.call(this, opt);

    this._id = id;
}

Stderr.prototype = Object.create(stream.Transform.prototype);

Stderr.prototype._transform = function(data, encoding, callback) {
    var response = {
        id: this._id,
        stderr: data.toString(),
    };
    log("STDERR:", response);
    channel.send(response);
    this.push(data);
    callback();
};

function Context(id) {
    this.id = id;

    this.stdout = new Stdout(this.id);
    this.stderr = new Stderr(this.id);
    this.console = new console.Console(this.stdout, this.stderr);

    this._capturedStdout = null;
    this._capturedStderr = null;
    this._capturedConsole = null;

    this._async = false;
    this._done = false;

    // `$$` provides an interface for users to access the execution context
    this.$$ = Object.create(null);

    this.$$.async = Context.prototype.async.bind(this);
    this.$$.sendResult = Context.prototype.sendResult.bind(this);
    this.$$.sendError = Context.prototype.sendError.bind(this);
    this.$$.done = Context.prototype.done.bind(this);

    this.$$.mime = (function sendMime(mimeBundle) {
        this.done({
            mime: mimeBundle
        });
    }).bind(this);

    this.$$.text = (function sendText(text) {
        this.done({
            mime: {
                "text/plain": text
            }
        });
    }).bind(this);

    this.$$.html = (function sendHtml(html) {
        this.done({
            mime: {
                "text/html": html
            }
        });
    }).bind(this);

    this.$$.svg = (function sendSvg(svg) {
        this.done({
            mime: {
                "image/svg+xml": svg
            }
        });
    }).bind(this);

    this.$$.png = (function sendPng(png) {
        this.done({
            mime: {
                "image/png": png
            }
        });
    }).bind(this);

    this.$$.jpeg = (function sendJpeg(jpeg) {
        this.done({
            mime: {
                "image/jpeg": jpeg
            }
        });
    }).bind(this);
}

Context.prototype.send = function send(message) {
    message.id = this.id;

    if (this._done) {
        log("RESULT: DROPPED:", message);
        return;
    }

    log("RESULT:", message);

    channel.send(message);
};

Context.prototype.async = function async() {
    this._async = true;
};

Context.prototype.sendResult = function sendResult(result) {
    this.done({
        mime: toMime(result)
    });
};

Context.prototype.sendError = function sendError(error) {
    this.done({
        error: formatError(error)
    });
};

Context.prototype.done = function done(response) {
    response = response || {};
    response.end = true;

    this.send(response);

    this._async = false;
    this._done = true;
};

Context.prototype.captureGlobalContext = function captureGlobalContext() {
    this._capturedStdout = process.stdout;
    this._capturedStderr = process.stderr;
    this._capturedConsole = console;

    this.stdout.pipe(this._capturedStdout);
    this.stderr.pipe(this._capturedStderr);
    this.console.Console = this._capturedConsole.Console;

    delete process.stdout;
    process.stdout = this.stdout;

    delete process.stderr;
    process.stderr = this.stderr;

    delete global.console;
    global.console = this.console;

    delete global.$$;
    global.$$ = this.$$;

    if (typeof global.$$mimer$$ !== "function") {
        global.$$mimer$$ = defaultMimer;
    }

    delete global.$$mime$$;
    Object.defineProperty(global, "$$mime$$", {
        set: this.$$.mime,
        configurable: true,
        enumerable: false,
    });

    delete global.$$html$$;
    Object.defineProperty(global, "$$html$$", {
        set: this.$$.html,
        configurable: true,
        enumerable: false,
    });

    delete global.$$svg$$;
    Object.defineProperty(global, "$$svg$$", {
        set: this.$$.svg,
        configurable: true,
        enumerable: false,
    });

    delete global.$$png$$;
    Object.defineProperty(global, "$$png$$", {
        set: this.$$.png,
        configurable: true,
        enumerable: false,
    });

    delete global.$$jpeg$$;
    Object.defineProperty(global, "$$jpeg$$", {
        set: this.$$.jpeg,
        configurable: true,
        enumerable: false,
    });

    delete global.$$async$$;
    Object.defineProperty(global, "$$async$$", {
        get: (function() {
            return this._async;
        }).bind(this),
        set: (function(value) {
            if (value) {
                this.async();
            }
            this._async = value;
        }).bind(this),
        configurable: true,
        enumerable: false,
    });

    global.$$done$$ = this.$$.sendResult;
};

Context.prototype.releaseGlobalContext = function releaseGlobalContext() {
    if (process.stdout === this.stdout) {
        this.stdout.unpipe();

        delete process.stdout;
        process.stdout = this._capturedStdout;

        this._capturedStdout = null;
    }

    if (process.stderr === this.stderr) {
        this.stderr.unpipe();

        delete process.stderr;
        process.stderr = this._capturedStderr;

        this._capturedStderr = null;
    }

    if (global.console === this.console) {
        delete global.console;
        global.console = this._capturedConsole;

        this._capturedConsole = null;
    }
};

class IpcChannel {
  constructor() {
    if(!process.send) {
      throw new Error('Process must be spawned with ipc channel');
    }
  }
  onMessage(callback) {
    process.on("message", callback);
  }

  send(msg) {
    process.send(msg);
  }
}

class SocketChannel {
  constructor(port = 6001) {
    this.emitter = new EventEmitter();
    this.channel = new io(port);
    this.channel.on('connection', (socket) => {
      log('client connected');
      socket.on("message", (msg) => this.emitter.emit('message', msg));
    });
    log(`listening on ${port}`);
  }

  onMessage(callback) {
    this.emitter.on('message', callback);
  }

  send(msg) {
    this.channel.send(msg)
  }
}

export class Server {
  constructor(config = {}) {
    this.config = config;
  }

  start() {
    channel = this.channel = (this.config.port || !process.send)
      ? new SocketChannel(this.config.port)
      : new IpcChannel()
    // Capture the initial context
    // (id left undefined to indicate this is the initial context)
    this.initialContext = new Context();
    this.initialContext.captureGlobalContext();

    Object.defineProperty(global, "$$defaultMimer$$", {
        value: defaultMimer,
        configurable: false,
        writable: false,
        enumerable: false,
    });

    channel.onMessage(this.onMessage.bind(this));
    process.on("uncaughtException", this.onUncaughtException.bind(this));
  }

  onUncaughtException(error) {
      log("UNCAUGHTEXCEPTION:", error.stack);
      channel.send({
          stderr: error.stack.toString(),
      });
  }

  onMessage(request) {
      log("REQUEST:", request);

      var action = request[0];
      var code = request[1];
      var id = request[2];

      this.initialContext.releaseGlobalContext();
      var context = new Context(id);
      context.captureGlobalContext();

      var cleanup = () => {
        context.releaseGlobalContext();
        this.initialContext.captureGlobalContext();
        this.initialContext._done = false;
      };

      return new Promise((resolve, reject) => {
        if (action === "getAllPropertyNames") {
            this.onNameRequest(code, context).then(resolve, reject);
        } else if (action === "inspect") {
            this.onInspectRequest(code, context).then(resolve, reject);
        } else if (action === "run") {
            this.onRunRequest(code, context).then(resolve, reject);
        } else {
            this.context.sendError(new Error("NEL: Unhandled action request: " + action));
            resolve();
        }
      }).then(cleanup, cleanup);
  }

  onNameRequest(code, context) {
      var message = {
          id: context.id,
          names: getAllPropertyNames(this.run(code)),
      };
      log("RESULT:", message);
      context.done(message);
      return Promise.resolve();
  }

  onInspectRequest(code, context) {
      var message = {
          id: context.id,
          inspection: inspect(this.run(code)),
      };
      log("RESULT:", message);
      context.done(message);
      return Promise.resolve();
  }

  onRunRequest(code, context) {
    const result = new Promise((resolve) => resolve(this.run(code)));

    // Drop result if the run request initiated the async mode
    if (context._async) {
        return Promise.resolve();
    }

    // Drop result if the run request has already invoked context.done()
    if (context._done) {
        return Promise.resolve();
    }

    return result.then((value) => {
      context.sendResult(value);
    }, (error) => {
      context.sendError(error);
    });
  }

  run(code) {
    return vm.runInThisContext(code);
  }
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
