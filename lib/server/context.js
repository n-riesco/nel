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

var console = require("console");
var stream = require("stream");
var util = require("util");

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
    process.send(response);
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
    process.send(response);
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

    this.$$.async = (function async(value) {
        this._async = (arguments.length === 0) ? true : !!value;
        return this._async;
    }).bind(this);

    this.$$.done = (function done(result) {
        return this.send((arguments.length === 0) ? {
            end: true,
        } : {
            mime: toMime(result),
            end: true,
        });
    }).bind(this);

    this.$$.sendResult = sendMime.bind(this, toMime);

    this.$$.sendError = (function sendError(error, keepAlive) {
        if (keepAlive) this.$$.async();

        return this.send({
            error: formatError(error),
            end: !keepAlive,
        });
    }).bind(this);

    this.$$.mime = sendMime.bind(this, identity);

    this.$$.text = sendMime.bind(this, buildPropertyMime.bind(this, "text/plain"));

    this.$$.html = sendMime.bind(this, buildPropertyMime.bind(this, "text/html"));

    this.$$.svg = sendMime.bind(this, buildPropertyMime.bind(this, "image/svg+xml"));

    this.$$.png = sendMime.bind(this, buildPropertyMime.bind(this, "image/png"));

    this.$$.jpeg = sendMime.bind(this, buildPropertyMime.bind(this, "image/jpeg"));

    this.$$.json = sendMime.bind(this, buildPropertyMime.bind(this, "application/json"));

    this.$$.display = (function createDisplay(id) {
        return (arguments.length === 0) ?
            new Display(this) :
            new Display(this, id);
    }).bind(this);
}

Context.prototype.send = function send(message) {
    message.id = this.id;

    if (this._done) {
        log("RESULT: DROPPED:", message);
        return;
    }

    if(message.end) {
        this._done = true;
        this._async = false;
    }

    log("RESULT:", message);
    return Promise.resolve(message.mime)
        .then(function (mime) {
            message.mime = mime;
            return asyncSend(message);
        })
        .catch(this.$$.sendError);
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
            this._async = !!value;
        }).bind(this),
        configurable: true,
        enumerable: false,
    });

    global.$$done$$ = this.$$.done.bind(this);

    if (!global.hasOwnProperty("$$defaultMimer$$")) {
        Object.defineProperty(global, "$$defaultMimer$$", {
            value: defaultMimer,
            configurable: false,
            writable: false,
            enumerable: false,
        });
    }
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

function buildPropertyMime (property, result) {
    var mime = {};
    mime[property] = result;
    return mime;
}

function identity (value) {
    return value;
}

function asyncSend (message) {
    return new Promise(function (resolve, reject) {
        try {
            process.send(message);
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

function sendMime (buildMime, result, keepAlive) {
    if (keepAlive) this.$$.async();

    return this.send({
        mime: Promise.resolve(result).then(buildMime.bind(this)),
        end: !keepAlive
    });
}
