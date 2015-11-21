#!/usr/bin/env node

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

var assert = require("assert");
var nel = require("../index.js");
var util = require("util");

var session = new nel.Session();

testNext(session, [
    testSessionRestart,
    testSessionRun,
    testSessionInspect,
    testSessionComplete,
    testSessionKill,
]);

/**
 * @callback Test
 * @param {module:nel~Session} session
 * @param {(Test|Test[])}      [tests]
 * @description Run a test over session and call the next test in tests
 */

/**
 * @type Test
 * @description This function is called by each test to ensure all tests are run
 */
function testNext(session, tests) {
    if (!tests) {
        return;
    }

    if (!Array.isArray(tests)) {
        tests(session);
        return;
    }

    var test = tests.shift();
    if (test) {
        test(session, tests);
    }
}

function testSessionRestart(session, tests) {
    session.restart("SIGTERM", function(code, signal) {
        testNext(session, tests);
    });
}

function testSessionKill(session, tests) {
    session.kill("SIGTERM", function(code, signal) {
        testNext(session, tests);
    });
}

function testSessionRun(session, tests) {
    var testCases = [{
        code: "var msg = 'Hello, World!';" +
            "console.log(msg);" +
            "console.error(msg);" +
            "throw msg;",
        result: {
            error: {
                ename: "string",
                evalue: "'Hello, World!'",
                traceback: "",
            }
        },
        stdout: "Hello, World!\n",
        stderr: "Hello, World!\n"
    }, {
        code: "msg;",
        result: {
            mime: {
                "text/plain": "'Hello, World!'",
            }
        },
    }, ].map(function(testCase) {
        return makeSessionRunTestCase(
            testCase.code,
            testCase.result,
            testCase.stdout,
            testCase.stderr
        );
    });

    testNext(session, testCases.concat(tests));
}

function makeSessionRunTestCase(code, result, stdout, stderr) {
    function makeErrorMessage() {
        var messages = ["testSessionRun"];
        for (var i = 0; i < arguments.length; i++) {
            messages.push(arguments[i]);
        }
        return messages.join(": ");
    }

    return function(session, tests) {
        var hasRun = [];

        var task = {
            action: "run",
            code: code,
            beforeRun: function(session) {
                hasRun.push("beforeRun");
            },
            afterRun: function(session) {
                hasRun.push("afterRun");
                check(session);
            },
            onSuccess: function(session) {
                hasRun.push("onSuccess");
            },
            onError: function(session) {
                hasRun.push("onError");
            },
        };

        session.run(task);

        function check(session) {
            if (session.result.error) {
                assert.deepEqual(
                    hasRun, ["beforeRun", "onError", "afterRun"],
                    makeErrorMessage("Unexpected callbacks were run", hasRun)
                );
            } else {
                assert.deepEqual(
                    hasRun, ["beforeRun", "onSuccess", "afterRun"],
                    makeErrorMessage("Unexpected callbacks were run", hasRun)
                );
            }

            assert.deepEqual(
                session.result, result,
                makeErrorMessage(
                    "Unexpected result",
                    util.inspect(session.result),
                    "Expected",
                    util.inspect(result)
                )
            );

            var expected = stdout || null;
            var obtained = session.stdout.read();
            assert.equal(
                obtained, expected,
                makeErrorMessage(
                    "Unexpected stdout",
                    obtained,
                    "Expected",
                    expected
                )
            );

            expected = stderr || null;
            obtained = session.stderr.read();
            assert.equal(
                obtained, expected,
                makeErrorMessage(
                    "Unexpected stderr",
                    obtained,
                    "Expected",
                    expected
                )
            );

            testNext(session, tests);
        }
    };
}

function testSessionInspect(session, tests) {
    var testCases = [{
        code: "var msg = 'Hello, World!';",
        cursorPos: 7,
        result: {
            inspection: {
                string: 'Hello, World!',
                type: 'String',
                constructorList: ['String', 'Object'],
                length: 13,
                code: "var msg = 'Hello, World!';",
                cursorPos: 7,
                matchedText: 'msg'
            },
        },
    }, {
        code: "var a = [1, 2, 3];",
        cursorPos: 5,
        result: {
            inspection: {
                string: '[ 1, 2, 3 ]',
                type: 'Array',
                constructorList: ['Array', 'Object'],
                length: 3,
                code: 'var a = [1, 2, 3];',
                cursorPos: 5,
                matchedText: 'a'
            },
        },
    }, {
        code: "parseInt",
        cursorPos: 8,
        result: {
            inspection: {
                string: 'function parseInt() { [native code] }',
                type: 'Function',
                constructorList: ['Function', 'Object'],
                length: 2,
                code: 'parseInt',
                cursorPos: 8,
                matchedText: 'parseInt',
            },
            doc: {
                description: 'The parseInt() function parses a string argument and returns an integer of the specified radix (the base in mathematical numeral systems).',
                url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt',
                usage: 'parseInt(string, radix);'
            },
        },
    }, ].map(function(testCase) {
        return makeSessionInspectTestCase(
            testCase.code,
            testCase.cursorPos,
            testCase.result
        );
    });

    testNext(session, testCases.concat(tests));
}

function makeSessionInspectTestCase(code, cursorPos, result) {
    function makeErrorMessage() {
        var messages = ["testSessionInspect"];
        for (var i = 0; i < arguments.length; i++) {
            messages.push(arguments[i]);
        }
        return messages.join(": ");
    }

    return function(session, tests) {
        // First run the code, then inspect the expression at cursorPos.
        var task = {
            action: "run",
            code: code,
            onSuccess: function(session) {
                session.inspect(code, cursorPos, check, onError);
            },
            onError: onError,
        };

        session.run(task);

        function onError(session) {
            assert(
                false,
                makeErrorMessage("Evaluation error", session.result)
            );
        }

        function check(session) {
            assert.deepEqual(
                session.result, result,
                makeErrorMessage(
                    "Unexpected result",
                    util.inspect(result),
                    "Expected",
                    util.inspect(session.result)
                )
            );

            testNext(session, tests);
        }
    };
}

function testSessionComplete(session, tests) {
    var testCases = [{
        code: "set",
        cursorPos: 2,
        result: {
            completion: {
                list: ['setImmediate', 'setInterval', 'setTimeout'],
                code: 'set',
                cursorPos: 2,
                matchedText: 'se',
                cursorStart: 0,
                cursorEnd: 3,
            },
        },
    }, ].map(function(testCase) {
        return makeSessionCompleteTestCase(
            testCase.code,
            testCase.cursorPos,
            testCase.result
        );
    });

    testNext(session, testCases.concat(tests));
}

function makeSessionCompleteTestCase(code, cursorPos, result) {
    function makeErrorMessage() {
        var messages = ["testSessionComplete"];
        for (var i = 0; i < arguments.length; i++) {
            messages.push(arguments[i]);
        }
        return messages.join(": ");
    }

    return function(session, tests) {
        session.complete(code, cursorPos, check, onError);

        function onError(session) {
            assert(
                false,
                makeErrorMessage("Error", session.result)
            );
        }

        function check(session) {
            assert.deepEqual(
                session.result, result,
                makeErrorMessage(
                    "Unexpected result",
                    util.inspect(result),
                    "Expected",
                    util.inspect(session.result)
                )
            );

            testNext(session, tests);
        }
    };
}
