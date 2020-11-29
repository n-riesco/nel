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

/** @module nel
 *
 * @description Module `nel` provides a Javascript REPL session. A Javascript
 * session can be used to run Javascript code within `Node.js`, pass the result
 * to a callback function and even capture its `stdout` and `stderr` streams.
 *
 */
module.exports = {
    Session: Session,
};


var spawn = require("child_process").spawn;
var util = require("util");

var doc = require("./mdn.js"); // Documentation for Javascript builtins
var log = require("./log.js")("NEL:");
var server = require("./server/index.js"); // Server source code


function isPromise(x) {
    if (!global.Promise || typeof global.Promise !== "function") {
        return false;
    }
    return x instanceof global.Promise;
}


// File paths
var paths = {
    node: process.argv[0],
};


/**
 * Javascript session configuration.
 *
 * @typedef Config
 *
 * @property {string}  [cwd]        Session current working directory
 * @property {module:nel~Transpiler}
 *                     [transpile]  Function that transpiles the request code
 *                                  into Javascript that can be run by the
 *                                  Node.js session.
 *
 * @see {@link module:nel~Session}
 */


/**
 * Function that transpiles the request code into Javascript that can be run by
 * the Node.js session.
 *
 * @typedef Transpiler
 *
 * @type    {function}
 * @param   {string}  code  Request code
 * @returns {(string|Promise<string>)}  Transpiled code
 *
 * @see {@link module:nel~Config}
 */


/**
 * @class
 * @classdesc Implements a Node.js session
 * @param {module:nel~Config} [nelConfig] Session configuration.
 */
function Session(nelConfig) {
    nelConfig = nelConfig || {};

    /**
     * Function that transpiles the request code into Javascript that can be run
     * by the Node.js session (null/undefined if no transpilation is needed).
     * @member {?module:nel~Transpiler}
     */
    this.transpile = nelConfig.transpile;

    /**
     * Queue of tasks to be run
     * @member {module:nel~Task[]}
     * @private
     */
    this._tasks = [];

    /**
     * Task currently being run (null if the last running task has finished)
     * @member {module:nel~Task}
     * @private
     */
    this._currentTask = null;

    /**
     * Table of execution contexts
     * (execution contexts are created to allow asynchronous execution of cells)
     * (indexed by execution context ID)
     * (contexts that complete their execution are removed from this table)
     * @member {Object.<number, module:nel~Task>}
     * @private
     */
    this._contextTable = {};

    /**
     * Table of execution contexts that create a display ID
     * (displays are created to allow multiple outputs per cell)
     * (indexed by execution context ID)
     * (cannot use this._contextTable)
     * @member {Object.<number, module:nel~Task>}
     * @private
     */
    this._displayTable = {};

    /**
     * Last execution context id (0 if none have been created)
     * @member {number}
     * @private
     */
    this._lastContextId = 0;

    /**
     * Last run task (null if none have been run)
     * @member {module:nel~Task}
     * @private
     */
    this._lastTask = null;

    /**
     * Session configuration
     * @member {module:nel~Config}
     * @private
     */
    this._config = {
        cwd: nelConfig.cwd,
        stdio: global.DEBUG ?
            [process.stdin, process.stdout, process.stderr, "ipc"] :
            ["ignore", "ignore", "ignore", "ipc"],
    };

    /**
     * Server that runs the code requests for this session
     * @member {module:child_process~ChildProcess}
     * @private
     */
    this._server = spawn(Session._command, Session._args, this._config);
    this._server.on("message", Session.prototype._onMessage.bind(this));
    this._server.on("exit", (function(code, signal) {
        log("SESSION: EXIT:", code, signal);
        this._status = "dead";
    }).bind(this));

    /**
     * Server status as a string that can take the following values:
     *   "starting" (status from the time the server is spawned until the time
     *              the server is ready to receive requests);
     *   "online"   (status when the server is ready to receive requests);
     *   "dead"     (status after receiving a request to kill the server
     *              {@link module:nel~Session.kill}).
     * @member {string}
     * @private
     */
    this._status = "starting";
}

/**
 * Path to node executable
 * @member {String}
 * @private
 */
Session._command = paths.node;

/**
 * Arguments passed onto the node executable
 * @member {String[]}
 * @private
 */
Session._args = ["--eval", server]; // --eval workaround

/**
 * Combination of a piece of code to be run within a session and all the
 * associated callbacks.
 * @see {@link module:nel~Session#_run}
 *
 * @typedef Task
 *
 * @property {string}                 action      Type of task:
 *                                                "run" to evaluate a piece of
 *                                                code and return the result;
 *                                                "getAllPropertyNames" to
 *                                                evaluate a piece of code and
 *                                                return all the property names
 *                                                of the result;
 *                                                "inspect" to inspect an object
 *                                                and return information such as
 *                                                the list of constructors,
 *                                                string representation,
 *                                                length...
 * @property {string}                 code        Code to evaluate
 * @property {module:nel~OnSuccessCB} [onSuccess] Called if no errors occurred
 * @property {module:nel~OnErrorCB}   [onError]   Called if an error occurred
 * @property {module:nel~BeforeRunCB} [beforeRun] Called before running the code
 * @property {module:nel~AfterRunCB}  [afterRun]  Called after running the code
 * @property {module:nel~OnStdioCB}   [onStdout]  Called if process.stdout data
 * @property {module:nel~OnStdioCB}   [onStderr]  Called if process.stderr data
 * @property {module:nel~OnDisplayCB} [onDisplay] Called on display updates
 * @property {module:nel~OnRequestCB} [onRequest] Called on requests
 *
 * @private
 */

/**
 * Callback run with a request
 * @see {@link module:nel~Session#execute}
 *
 * @callback OnRequestCB
 * @param {module:nel~RequestMessage} request  Request
 * @param {module:nel~onReplyCB}      onReply  Callback invoked with the reply
 */

/**
 * Callback run with a reply
 * @see {@link module:nel~Session#execute}
 *
 * @callback OnReplyCB
 * @param {module:nel~ReplyMessage} reply  Reply
 */

/**
 * Callback run with a display update
 * @see {@link module:nel~Session#execute}
 *
 * @callback OnDisplayCB
 * @param {module:nel~DisplayMessage} update  Display ID and MIME bundle
 */

/**
 * Callback invoked with the data written on `process.stdout` or
 * `process.stderr` after a request to the server.
 * @see {@link module:nel~Task}
 *
 * @callback OnStdioCB
 * @param {string} data
 */

/**
 * Callback invoked before running a task
 * @see {@link module:nel~Task}
 *
 * @callback BeforeRunCB
 */

/**
 * Callback invoked after running a task (regardless of success or failure)
 * @see {@link module:nel~Task}
 *
 * @callback AfterRunCB
 */

/**
 * Callback invoked with the error obtained while running a task
 * @see {@link module:nel~Task}
 *
 * @callback OnErrorCB
 * @param {module:nel~ErrorResult} error
 */

/**
 * Callback invoked with the result of a task
 * @see {@link module:nel~Task}
 *
 * @typedef OnSuccessCB {
 *     module:nel~OnExecutionSuccessCB |
 *     module:nel~OnCompletionSuccessCB |
 *     module:nel~OnInspectionSuccessCB |
 *     module:nel~OnNameListSuccessCB
 * }
 */

/**
 * Callback run with the result of an execution request
 * @see {@link module:nel~Session#execute}
 *
 * @callback OnExecutionSuccessCB
 * @param {module:nel~ExecutionMessage} result  MIME representations
 */

/**
 * Callback run with the result of an completion request
 * @see {@link module:nel~Session#complete}
 *
 * @callback OnCompletionSuccessCB
 * @param {module:nel~CompletionMessage} result  Completion request results
 */

/**
 * Callback run with the result of an inspection request
 * @see {@link module:nel~Session#inspect}
 *
 * @callback OnInspectionSuccessCB
 * @param {module:nel~InspectionMessage} result Inspection request result
 */

/**
 * Callback run with the list of all the property names
 *
 * @callback OnNameListSuccessCB
 * @param {module:nel~NameListMessage} result  List of all the property names
 *
 * @private
 */

/**
 * Callback run after the session server has been killed
 * @see {@link module:nel~Session#kill}
 *
 * @callback KillCB
 * @param {Number} [code]    Exit code from session server if exited normally
 * @param {String} [signal]  Signal passed to kill the session server
 */

/**
 * Callback run after the session server has been restarted
 * @see {@link module:nel~Session#restart}
 *
 * @callback RestartCB
 * @param {Number} [code]    Exit code from old session if exited normally
 * @param {String} [signal]  Signal passed to kill the old session
 */

/**
 * Message received from the session server
 *
 * @typedef Message {
 *     module:nel~LogMessage |
 *     module:nel~RequestMessage |
 *     module:nel~DisplayMessage |
 *     module:nel~StatusMessage |
 *     module:nel~StdoutMessage |
 *     module:nel~StderrMessage |
 *     module:nel~ErrorMessage |
 *     module:nel~SuccessMessage
 * }
 */

/**
 * Log message received from the session server
 *
 * @typedef LogMessage
 *
 * @property {string}   log     Message for logging purposes
 *
 * @private
 */

/**
 * Request message
 *
 * @typedef RequestMessage
 *
 * @property {number}   [id]  Execution context id
 *                            (deleted before the message reaches the API user)
 *
 * @property {object}   request
 * @property {number}   [request.id]  Request id
 *                                    (deleted before reaching the API user)
 * @property {object}   [request.input]           Input request
 * @property {string}   [request.input.prompt]    Prompt message
 * @property {boolean}  [request.input.password]  Treat input as a password
 *
 * @property {object}   [request.clear]       Request to clear the output
 * @property {boolean}  [request.clear.wait]  Whether to wait for an update
 *                                            before clearing the output
 */

/**
 * Reply message
 *
 * @typedef ReplyMessage
 *
 * @property {string}  [input]  Input reply
 */

/**
 * Display message received from the session server
 *
 * @typedef DisplayMessage
 *
 * @property {number}  [id]  Execution context id
 *                           (deleted before the message reaches the API user)
 * @property {string}  [open]        Display id
 *                                   (only present in the opening message)
 * @property {string}  [display_id]  Display id
 *                                   (only present in update messages)
 * @property {string}  [close]       Display id
 *                                   (only present in the closing message)
 * @property           [mime]  (not present in the opening and closing messages)
 * @property {string}  [mime."text/plain"]     Plain text
 * @property {string}  [mime."text/html"]      HTML format
 * @property {string}  [mime."image/svg+xml"]  SVG format
 * @property {string}  [mime."image/png"]      PNG as a base64 string
 * @property {string}  [mime."image/jpeg"]     JPEG as a base64 string
 *
 * @private
 */

/**
 * Status message received from the session server
 *
 * @typedef StatusMessage
 *
 * @property {string}   status  Message for reporting a server status change:
 *                                "online" (when the server is ready to process
 *                                         requests).
 *
 * @private
 */

/**
 * Stdout message received from the session server
 *
 * @typedef StdoutMessage
 *
 * @property {number}   id      Execution context id
 * @property {string}   stdout  Data written on the session stdout
 *
 * @private
 */

/**
 * Stderr message received from the session server
 *
 * @typedef StderrMessage
 *
 * @property {number}   id      Execution context id
 * @property {string}   stderr  Data written on the session stderr
 *
 * @private
 */

/**
 * Error thrown when running a task within a session
 * @see {@link module:nel~Session#execute}, {@link module:nel~Session#complete},
 * and {@link module:nel~Session#inspect}
 *
 * @typedef ErrorMessage
 *
 * @property {number}   [id]             Execution context id
 *                                       (deleted before passing the message
 *                                       onto the API user)
 * @property {boolean}  [end]            Flag to terminate the execution context
 * @property            error
 * @property {String}   error.ename      Error name
 * @property {String}   error.evalue     Error value
 * @property {String[]} error.traceback  Error traceback
 */

/**
 * Request result
 * @see {@link module:nel~Session#execute}, {@link module:nel~Session#complete},
 * and {@link module:nel~Session#inspect}
 *
 * @typedef SuccessMessage {
 *     module:nel~ExecutionMessage |
 *     module:nel~CompletionMessage |
 *     module:nel~InspectionMessage |
 *     module:nel~NameListMessage
 * }
 */

/**
 * MIME representations of the result of an execution request
 * @see {@link module:nel~Session#execute}
 *
 * @typedef ExecutionMessage
 *
 * @property {number}  [id]    Execution context id
 *                             (deleted before the message reaches the API user)
 * @property {boolean} [end]   Flag to terminate the execution context
 * @property           mime
 * @property {string}  [mime."text/plain"]    Result in plain text
 * @property {string}  [mime."text/html"]     Result in HTML format
 * @property {string}  [mime."image/svg+xml"] Result in SVG format
 * @property {string}  [mime."image/png"]     Result as PNG in a base64 string
 * @property {string}  [mime."image/jpeg"]    Result as JPEG in a base64 string
 */

/**
 * Results of a completion request
 * @see {@link module:nel~Session#complete}
 *
 * @typedef CompletionMessage
 *
 * @property {number}   [id]                    Execution context id
 *                                              (deleted before passing the
 *                                              message onto the API user)
 * @property            completion
 * @property {String[]} completion.list         Array of completion matches
 * @property {String}   completion.code         Javascript code to be completed
 * @property {Integer}  completion.cursorPos    Cursor position within
 *                                              `completion.code`
 * @property {String}   completion.matchedText  Text within `completion.code`
 *                                              that has been matched
 * @property {Integer}  completion.cursorStart  Position of the start of
 *                                              `completion.matchedText` within
 *                                              `completion.code`
 * @property {Integer}  completion.cursorEnd    Position of the end of
 *                                              `completion.matchedText` within
 *                                              `completion.code`
 */

/**
 * Results of an inspection request
 * @see {@link module:nel~Session#inspect}
 *
 * @typedef InspectionMessage
 *
 * @property {number}   [id]                    Execution context id
 *                                              (deleted before passing the
 *                                              message onto the API user)
 * @property            inspection
 * @property {String}   inspection.code         Javascript code to be inspected
 * @property {Integer}  inspection.cursorPos    Cursor position within
 *                                              `inspection.code`.
 * @property {String}   inspection.matchedText  Text within `inspection.code`
 *                                              that has been matched as an
 *                                              expression.
 * @property {String}   inspection.string       String representation
 * @property {String}   inspection.type         Javascript type
 * @property {String[]} [inspection.constructorList]
 *                                              List of constructors (not
 *                                              defined for `null` or
 *                                              `undefined`).
 * @property {Integer}  [inspection.length]     Length property (if present)
 *
 * @property            [doc]                   Defined only for calls to {@link
 *                                              module:nel~inspect} that succeed
 *                                              to find documentation for a
 *                                              Javascript expression
 * @property {String}   doc.description         Description
 * @property {String}   [doc.usage]             Usage
 * @property {String}   doc.url                 Link to the documentation source
 */

/**
 * Results of an "getAllPropertyNames" action
 * @see {@link module:nel~Task}
 *
 * @typedef NameListMessage
 *
 * @property {number}   [id]   Execution context id
 *                             (deleted before the message reaches the API user)
 * @property {String[]} names  List of all property names
 *
 * @private
 */

/* eslint-disable complexity */
/**
 * Callback to handle messages from the session server
 *
 * @param {module:nel~Message} message
 * @private
 */
Session.prototype._onMessage = function(message) {
    // Handle message.log
    if (message.hasOwnProperty("log")) {
        log(message.log);
        return;
    }

    log("SESSION: RECEIVED:", message);

    // Handle message.status
    if (message.status === "online") {
        log("SESSION: ONLINE");
        this._status = message.status;
        this._runNext();
        return;
    }

    var contextId = message.id;
    delete message.id;

    var endMessage = message.end;
    delete message.end;

    // Handle message.display
    if (message.hasOwnProperty("display")) {
        var displayId;
        var displayTask;

        // Handle message.display.open
        // (keep track of the task that opened the display id,
        // so that it can be updated by other execution requests)
        if (message.display.hasOwnProperty("open")) {
            displayId = message.display.open;
            displayTask = this._contextTable[contextId] || this._lastTask;

            if (displayTask && displayTask.onDisplay) {
                this._displayTable[displayId] = displayTask;
            } else {
                log("SESSION: RECEIVED: DISPLAY: OPEN: Missing onDisplay");
            }

            return;
        }

        // Handle message.display.mime
        if (message.display.hasOwnProperty("mime")) {
            if (message.display.hasOwnProperty("display_id")) {
                displayId = message.display.display_id;
                displayTask = this._displayTable[displayId] || this._lastTask;
            } else {
                displayTask = this._contextTable[contextId] || this._lastTask;
            }

            if (displayTask && displayTask.onDisplay) {
                displayTask.onDisplay(message.display);
            } else {
                log("SESSION: RECEIVED: DISPLAY: UPDATE: Missing onDisplay");
            }

            return;
        }

        // Handle message.display.close
        // (unsupported by Jupyter Messaging Protocol)
        if (message.display.hasOwnProperty("close")) {
            displayId = message.display.close;
            delete this._displayTable[displayId];
            return;
        }
    }

    // Get execution context
    // (if context is missing, default to using the last context)
    var task = this._contextTable[contextId];

    if (!task) {
        log(
            "SESSION: CONTEXT: Missing context, using last context, id =",
            contextId
        );

        task = this._lastTask;
        if (!task) {
            log("SESSION: RECEIVED: DROPPED: There is no last context");
            return;
        }
    }

    // Handle message.request
    if (message.hasOwnProperty("request")) {
        if (task.onRequest) {
            var request = message.request;
            if (request.hasOwnProperty("clear")) {
                // clear_output requests don't get a reply
                task.onRequest(request);
            } else {
                var requestId = message.request.id;
                delete request.id;

                task.onRequest(request, function onReply(reply) {
                    // TODO: handle the case when reply is an instance of Error
                    this._server.send(["reply", reply, contextId, requestId]);
                }.bind(this));
            }
        } else {
            log("SESSION: RECEIVED: REQUEST: Missing request callback");
        }
        return;
    }

    // Handle message.stdout
    if (message.hasOwnProperty("stdout")) {
        if (task.onStdout) {
            task.onStdout(message.stdout);
        } else {
            log("SESSION: RECEIVED: STDOUT: Missing stdout callback");
        }
        return;
    }

    // Handle message.stderr
    if (message.hasOwnProperty("stderr")) {
        if (task.onStderr) {
            task.onStderr(message.stderr);
        } else {
            log("SESSION: RECEIVED: STDERR: Missing stderr callback");
        }
        return;
    }

    // Handle error and success messages
    if (message.hasOwnProperty("error")) {
        if (task.onError) {
            task.onError(message);
        } else {
            log("SESSION: RECEIVED: ERROR: Missing onError callback");
        }
    } else {
        if (task.onSuccess) {
            task.onSuccess(message);
        } else {
            log("SESSION: RECEIVED: SUCCESS: Missing onSuccess callback");
        }
    }

    // Handle message.end
    if (endMessage) {
        if (task) {
            log("SESSION: RECEIVED: END: id =", contextId);

            delete this._contextTable[contextId];

            if (task.afterRun) {
                task.afterRun();
            }
        } else {
            log("SESSION: RECEIVED: END: DROPPED: id =", contextId);
        }
    }

    // If the task for this message is the last running task,
    // proceed to run the next task on the queue.
    if (task && task === this._currentTask) {
        this._currentTask = null;
        this._runNext();
    }
};
/* eslint-enable complexity */

/**
 * Run a task
 *
 * @param {module:nel~Task} task
 * @private
 */
Session.prototype._run = function(task) {
    if (this._status === "online" && this._currentTask === null) {
        this._runNow(task);
    } else if (this._status !== "dead") {
        this._runLater(task);
    }
};

/**
 * Run a task now
 *
 * @param {module:nel~Task} task
 * @private
 */
Session.prototype._runNow = function(task) {
    var id = this._lastContextId + 1;

    log("SESSION: RUN: TASK:", id, task);

    this._currentTask = task;
    this._lastTask = task;
    this._lastContextId = id;

    this._contextTable[id] = task;

    if (task.beforeRun) {
        task.beforeRun();
    }

    var sendTask = (function sendTask() {
        this._server.send([task.action, task.code, id]);
    }).bind(this);

    var sendError = (function sendError(error) {
        this._onMessage({
            error: {
                ename: (error && error.name) ?
                    error.name : typeof error,
                evalue: (error && error.message) ?
                    error.message : util.inspect(error),
                traceback: (error && error.stack) ?
                    error.stack.split("\n") : "",
            },
        });
    }).bind(this);

    if (this.transpile && task.action === "run") {
        try {
            // Adapted from https://github.com/n-riesco/nel/issues/1 by kebot
            var transpiledCode = this.transpile(task.code);
            log("SESSION: RUN: TRANSPILE:\n" + transpiledCode + "\n");
            if (isPromise(transpiledCode)) {
                transpiledCode.then(function(value) {
                    task.code = value;
                    sendTask();
                }).catch(sendError);
                return;
            } else {
                task.code = transpiledCode;
            }
        } catch (error) {
            sendError(error);
            return;
        }
    }

    sendTask();
    return;
};

/**
 * Run a task later
 *
 * @param {module:nel~Task} task
 * @private
 */
Session.prototype._runLater = function(task) {
    log("SESSION: QUEUE: TASK:", task);
    this._tasks.push(task);
};

/**
 * Run next task (if any)
 *
 * @private
 */
Session.prototype._runNext = function() {
    var task = this._tasks.shift();

    if (task) {
        this._runNow(task);
    }
};

/**
 * Make an execution request
 *
 * @param {String}               code                 Code to execute in session
 * @param                        [callbacks]
 * @param {OnExecutionSuccessCB} [callbacks.onSuccess]
 * @param {OnErrorCB}            [callbacks.onError]
 * @param {BeforeRunCB}          [callbacks.beforeRun]
 * @param {AfterRunCB}           [callbacks.afterRun]
 * @param {OnStdioCB}            [callbacks.onStdout]
 * @param {OnStdioCB}            [callbacks.onStderr]
 * @param {OnDisplayCB}          [callbacks.onDisplay]
 * @param {OnRequestCB}          [callbacks.onRequest]
 */
Session.prototype.execute = function(code, callbacks) {
    log("SESSION: EXECUTE:", code);

    var task = {
        action: "run",
        code: code,
    };

    if (callbacks) {
        if (callbacks.onSuccess) {
            task.onSuccess = callbacks.onSuccess;
        }
        if (callbacks.onError) {
            task.onError = callbacks.onError;
        }
        if (callbacks.beforeRun) {
            task.beforeRun = callbacks.beforeRun;
        }
        if (callbacks.afterRun) {
            task.afterRun = callbacks.afterRun;
        }
        if (callbacks.onStdout) {
            task.onStdout = callbacks.onStdout;
        }
        if (callbacks.onStderr) {
            task.onStderr = callbacks.onStderr;
        }
        if (callbacks.onDisplay) {
            task.onDisplay = callbacks.onDisplay;
        }
        if (callbacks.onRequest) {
            task.onRequest = callbacks.onRequest;
        }
    }

    this._run(task);
};

/* eslint-disable complexity */
/**
 * Complete a Javascript expression
 *
 * @param {String}                code                  Javascript code
 * @param {Number}                cursorPos             Cursor position in code
 * @param                         [callbacks]
 * @param {OnCompletionSuccessCB} [callbacks.onSuccess]
 * @param {OnErrorCB}             [callbacks.onError]
 * @param {BeforeRunCB}           [callbacks.beforeRun]
 * @param {AfterRunCB}            [callbacks.afterRun]
 * @param {OnStdioCB}             [callbacks.onStdout]
 * @param {OnStdioCB}             [callbacks.onStderr]
 */
Session.prototype.complete = function(code, cursorPos, callbacks) {
    var matchList = [];
    var matchedText;
    var cursorStart;
    var cursorEnd;

    var expression = parseExpression(code, cursorPos);
    log("SESSION: COMPLETE: expression", expression);

    if (expression === null) {
        if (callbacks) {
            if (callbacks.beforeRun) {
                callbacks.beforeRun();
            }

            if (callbacks.onSuccess) {
                callbacks.onSuccess({
                    completion: {
                        list: matchList,
                        code: code,
                        cursorPos: cursorPos,
                        matchedText: "",
                        cursorStart: cursorPos,
                        cursorEnd: cursorPos,
                    },
                });
            }

            if (callbacks.afterRun) {
                callbacks.afterRun();
            }
        }

        return;
    }

    var task = {
        action: "getAllPropertyNames",
        code: (expression.scope === "") ? "global" : expression.scope,
    };

    if (callbacks) {
        if (callbacks.onError) {
            task.onError = callbacks.onError;
        }
        if (callbacks.beforeRun) {
            task.beforeRun = callbacks.beforeRun;
        }
        if (callbacks.afterRun) {
            task.afterRun = callbacks.afterRun;
        }
        if (callbacks.onStdout) {
            task.onStdout = callbacks.onStdout;
        }
        if (callbacks.onStderr) {
            task.onStderr = callbacks.onStderr;
        }
    }

    task.onSuccess = function(result) {
        // append list of all property names
        matchList = matchList.concat(result.names);

        // append list of reserved words
        if (expression.scope === "") {
            matchList = matchList.concat(javascriptKeywords);
        }

        // filter matches
        if (expression.selector) {
            matchList = matchList.filter(function(e) {
                return e.lastIndexOf(expression.selector, 0) === 0;
            });
        }

        // append expression.rightOp to each match
        var left = expression.scope + expression.leftOp;
        var right = expression.rightOp;
        if (left || right) {
            matchList = matchList.map(function(e) {
                return left + e + right;
            });
        }

        // find range of text that should be replaced
        if (matchList.length > 0) {
            var shortestMatch = matchList.reduce(function(p, c) {
                return p.length <= c.length ? p : c;
            });

            cursorStart = code.indexOf(expression.matchedText);
            cursorEnd = cursorStart;
            var cl = code.length;
            var ml = shortestMatch.length;
            for (var i = 0; i < ml && cursorEnd < cl; i++, cursorEnd++) {
                if (shortestMatch.charAt(i) !== code.charAt(cursorEnd)) {
                    break;
                }
            }
        } else {
            cursorStart = cursorPos;
            cursorEnd = cursorPos;
        }

        // return completion results to the callback
        matchedText = expression.matchedText;

        if (callbacks && callbacks.onSuccess) {
            callbacks.onSuccess({
                completion: {
                    list: matchList,
                    code: code,
                    cursorPos: cursorPos,
                    matchedText: matchedText,
                    cursorStart: cursorStart,
                    cursorEnd: cursorEnd,
                },
            });
        }
    };

    this._run(task);
};
/* eslint-enable complexity */

/**
 * Inspect a Javascript expression
 *
 * @param {String}                code                  Javascript code
 * @param {Number}                cursorPos             Cursor position in code
 * @param                         [callbacks]
 * @param {OnInspectionSuccessCB} [callbacks.onSuccess]
 * @param {OnErrorCB}             [callbacks.onError]
 * @param {BeforeRunCB}           [callbacks.beforeRun]
 * @param {AfterRunCB}            [callbacks.afterRun]
 * @param {OnStdioCB}             [callbacks.onStdout]
 * @param {OnStdioCB}             [callbacks.onStderr]
 */
Session.prototype.inspect = function(code, cursorPos, callbacks) {
    var expression = parseExpression(code, cursorPos);
    log("SESSION: INSPECT: expression:", expression);

    if (expression === null) {
        if (callbacks) {
            if (callbacks.beforeRun) {
                callbacks.beforeRun();
            }

            if (callbacks.onSuccess) {
                callbacks.onSuccess({
                    inspection: {
                        code: code,
                        cursorPos: cursorPos,
                        matchedText: "",
                        string: "",
                        type: ""
                    },
                });
            }

            if (callbacks.afterRun) {
                callbacks.afterRun();
            }
        }

        return;
    }

    var inspectionResult;

    var task = {
        action: "inspect",
        code: expression.matchedText,
    };

    if (callbacks) {
        if (callbacks.onError) {
            task.onError = callbacks.onError;
        }
        if (callbacks.beforeRun) {
            task.beforeRun = callbacks.beforeRun;
        }
        if (callbacks.onStdout) {
            task.onStdout = callbacks.onStdout;
        }
        if (callbacks.onStderr) {
            task.onStderr = callbacks.onStderr;
        }
    }

    task.onSuccess = (function(result) {
        inspectionResult = result;
        inspectionResult.inspection.code = code;
        inspectionResult.inspection.cursorPos = cursorPos;
        inspectionResult.inspection.matchedText = expression.matchedText;

        getDocumentationAndInvokeCallbacks.call(this);
    }).bind(this);

    this._run(task);

    return;

    function getDocumentationAndInvokeCallbacks() {
        var doc;

        // Find documentation associated with the matched text
        if (!expression.scope) {
            doc = getDocumentation(expression.matchedText);
            if (doc) {
                inspectionResult.doc = doc;
            }


            if (callbacks) {
                if (callbacks.onSuccess) {
                    callbacks.onSuccess(inspectionResult);
                }
                if (callbacks.afterRun) {
                    callbacks.afterRun();
                }
            }

            return;
        }

        // Find documentation by searching the chain of constructors
        var task = {
            action: "inspect",
            code: expression.scope,
        };

        if (callbacks) {
            if (callbacks.onError) {
                task.onError = callbacks.onError;
            }
            if (callbacks.afterRun) {
                task.afterRun = callbacks.afterRun;
            }
            if (callbacks.onStdout) {
                task.onStdout = callbacks.onStdout;
            }
            if (callbacks.onStderr) {
                task.onStderr = callbacks.onStderr;
            }
        }

        task.onSuccess = function(result) {
            var constructorList = result.inspection.constructorList;
            if (constructorList) {
                for (var i in constructorList) {
                    var constructorName = constructorList[i];
                    doc = getDocumentation(
                        constructorName +
                        ".prototype." +
                        expression.selector
                    );
                    if (doc) {
                        inspectionResult.doc = doc;
                        break;
                    }
                }
            }

            if (callbacks && callbacks.onSuccess) {
                callbacks.onSuccess(inspectionResult);
            }
        };

        this._run(task);
    }
};

/**
 * Kill session
 *
 * @param {String}              [signal="SIGTERM"] Signal passed to kill the
 *                                                 session server
 * @param {module:nel~KillCB}   [killCB]           Callback run after the
 *                                                 session server has been
 *                                                 killed
 */
Session.prototype.kill = function(signal, killCB) {
    this._status = "dead";
    this._server.removeAllListeners();
    this._server.on("exit", (function(code, signal) {
        if (killCB) {
            killCB(code, signal);
        }
    }).bind(this));
    this._server.kill(signal || "SIGTERM");
};

/**
 * Restart session
 *
 * @param {String}               [signal="SIGTERM"] Signal passed to kill the
 *                                                  old session
 * @param {module:nel~RestartCB} [restartCB]        Callback run after restart
 */
Session.prototype.restart = function(signal, restartCB) {
    this.kill(signal || "SIGTERM", (function(code, signal) {
        Session.call(this, this._config);
        if (restartCB) {
            restartCB(code, signal);
        }
    }).bind(this));
};

/**
 * List of Javascript reserved words (ecma-262)
 * @member {RegExp}
 * @private
 */
var javascriptKeywords = [
    // keywords
    "break", "case", "catch", "continue", "debugger", "default",
    "delete", "do", "else", "finally", "for", "function", "if",
    "in", "instanceof", "new", "return", "switch", "this",
    "throw", "try", "typeof", "var", "void", "while", "with",
    // future reserved words
    "class", "const", "enum", "export", "extends", "import",
    "super",
    // future reserved words in strict mode
    "implements", "interface", "let", "package", "private",
    "protected", "public", "static", "yield",
    // null literal
    "null",
    // boolean literals
    "true", "false"
];

/**
 * RegExp for whitespace
 * @member {RegExp}
 * @private
 */
var whitespaceRE = /\s/;

/**
 * RegExp for a simple identifier in Javascript
 * @member {RegExp}
 * @private
 */
var simpleIdentifierRE = /[_$a-zA-Z][_$a-zA-Z0-9]*$/;

/**
 * RegExp for a complex identifier in Javascript
 * @member {RegExp}
 * @private
 */
var complexIdentifierRE = /[_$a-zA-Z][_$a-zA-Z0-9]*(?:[_$a-zA-Z][_$a-zA-Z0-9]*|\.[_$a-zA-Z][_$a-zA-Z0-9]*|\[".*"\]|\['.*'\])*$/; // eslint-disable-line max-len

/**
 * Javascript expression
 *
 * @typedef Expression
 *
 * @property {String} matchedText Matched expression, e.g. `foo["bar`
 * @property {String} scope       Scope of the matched property, e.g. `foo`
 * @property {String} leftOp      Left-hand-side selector operator, e.g. `["`
 * @property {String} selector    Stem of the property being matched, e.g. `bar`
 * @property {String} rightOp     Right-hand-side selector operator, e.g. `"]`
 *
 * @see {@link module:nel~parseExpression}
 * @private
 */

/**
 * Parse a Javascript expression
 *
 * @param {String} code       Javascript code
 * @param {Number} cursorPos  Cursor position within `code`
 *
 * @returns {module:nel~Expression}
 *
 * @todo Parse expressions with parenthesis
 * @private
 */
function parseExpression(code, cursorPos) {
    var expression = code.slice(0, cursorPos);
    if (!expression ||
        whitespaceRE.test(expression[expression.length - 1])) {
        return {
            matchedText: "",
            scope: "",
            leftOp: "",
            selector: "",
            rightOp: "",
        };
    }

    var selector;
    var re = simpleIdentifierRE.exec(expression);
    if (re === null) {
        selector = "";
    } else {
        selector = re[0];
        expression = expression.slice(0, re.index);
    }

    var leftOp;
    var rightOp;
    if (expression[expression.length - 1] === ".") {
        leftOp = ".";
        rightOp = "";
        expression = expression.slice(0, expression.length - 1);
    } else if (
        (expression[expression.length - 2] === "[") &&
        (expression[expression.length - 1] === "\"")
    ) {
        leftOp = "[\"";
        rightOp = "\"]";
        expression = expression.slice(0, expression.length - 2);
    } else if (
        (expression[expression.length - 2] === "[") &&
        (expression[expression.length - 1] === "'")
    ) {
        leftOp = "['";
        rightOp = "']";
        expression = expression.slice(0, expression.length - 2);
    } else {
        return {
            matchedText: code.slice(expression.length, cursorPos),
            scope: "",
            leftOp: "",
            selector: selector,
            rightOp: "",
        };
    }

    var scope;
    re = complexIdentifierRE.exec(expression);
    if (re) {
        scope = re[0];
        return {
            matchedText: code.slice(re.index, cursorPos),
            scope: scope,
            leftOp: leftOp,
            selector: selector,
            rightOp: rightOp,
        };
    } else if (!leftOp) {
        scope = "";
        return {
            matchedText: code.slice(expression.length, cursorPos),
            scope: scope,
            leftOp: leftOp,
            selector: selector,
            rightOp: rightOp,
        };
    }

    // Not implemented
    return null;
}

/**
 * Javascript documentation
 *
 * @typedef Documentation
 *
 * @property {String} description Description
 * @property {String} [usage]     Usage
 * @property {String} url         Link to documentation source
 * @private
 */

/**
 * Get Javascript documentation
 *
 * @param {String} name Javascript name
 *
 * @returns {?module:parser~Documentation}
 * @private
 */
function getDocumentation(name) {
    var builtinName = name;
    if (builtinName in doc) {
        return doc[builtinName];
    }

    builtinName = name.replace(/^[a-zA-Z]+Error./, "Error.");
    if (builtinName in doc) {
        return doc[builtinName];
    }

    builtinName = name.replace(/^[a-zA-Z]+Array./, "TypedArray.");
    if (builtinName in doc) {
        return doc[builtinName];
    }

    return null;
}
