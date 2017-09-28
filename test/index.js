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
var fs = require("fs");
var nel = require("../index.js");
var path = require("path");

var depth = 2;
var inspect = require("util").inspect;
var log = process.env.DEBUG ? console.log : function() {};


function waitForSession(session, done) {
    _waitForSession();

    function _waitForSession() {
        if (session._status === "starting") {
            setTimeout(_waitForSession, 50);

        } else if (session._status === "online") {
            done();

        } else if (session._status === "dead") {
            throw new Error("NEL server died!");

        } else {
            throw new Error("Unknown NEL status: " + session._status);
        }
    }
}


function deepEqual(actual, expected, memoise) {
    if (typeof expected === "undefined" || expected === null) {
        return actual === expected;
    }

    if (typeof actual === "undefined" || actual === null) {
        return false;
    }

    if (typeof expected !== 'object') {
        return actual === expected;
    }

    // memoise calls to avoid circular comparisons
    memoise = (Array.isArray(memoise)) ? memoise : [];

    if (isMemoised(actual, expected)) {
        return true; // skip memoised cases by returning `true`
    }

    memoise.push([actual, expected]);

    function isMemoised(actual, expected) {
        for (var i = 0; i < memoise.length; i++) {
            var memoised = memoise[i];
            var memoisedActual = memoised[0];
            var memoisedExpected = memoised[1];
            if (memoisedActual === actual && memoisedExpected === expected) {
                return true;
            }
        }
        return false;
    }

    // only compare property names present in `expected`
    var expectedPropertyNames = Object.getOwnPropertyNames(expected);
    if (expectedPropertyNames.length === 0) {
        return true;
    }

    return expectedPropertyNames.map(function(name) {
        var isEqual = deepEqual(actual[name], expected[name], memoise);
        return isEqual;
    }).filter(function(isEqual) {
        return !isEqual;
    }).length === 0;
}

var customMatchers = {
    toDeepEqual: function(util, customEqualityTesters) {
        return {
            compare: function(actual, expected) {
                var pass = deepEqual(actual, expected);

                var result = {
                    pass: pass,
                    message:
                        "Expected " +
                        inspect(actual, { depth: depth }) +
                        ((pass) ? " not " : " ") + "to deep equal " +
                        inspect(expected, { depth: depth }),
                };

                return result;
            }
        };
    },
};

describe("NEL:", function() {
    var session;

    beforeEach(function(done) {
        jasmine.addMatchers(customMatchers);

        if (!session || session._status === "dead") {
            session = new nel.Session();
        }

        waitForSession(session, done);
    });

    it("Session#restart can restart a session", function(done) {
        var expectedSignal = (process.version.indexOf("v0.10.") === 0) ?
            null: "SIGTERM";
        var expectedCode = (process.version.indexOf("v0.10.") === 0) ?
            143: null;

        session.restart(expectedSignal, function(code, signal) {
            expect(code).toBe(expectedCode, "Unexpected restart code");
            expect(signal).toBe(expectedSignal, "Unexpected restart signal");

            done();
        });
    });

    it("Session#kill can kill a session", function(done) {
        var expectedSignal = (process.version.indexOf("v0.10.") === 0) ?
            null: "SIGTERM";
        var expectedCode = (process.version.indexOf("v0.10.") === 0) ?
            143: null;

        session.kill(expectedSignal, function(code, signal) {
            expect(code).toBe(expectedCode, "Unexpected kill code");
            expect(signal).toBe(expectedSignal, "Unexpected kill signal");

            done();
        });
    });

    describe("Session#execute", function() {
        var testCases = JSON.parse(
            fs.readFileSync(path.join(__dirname, "execute.json"))
        );

        testCases.forEach(testSessionExecutionCase);
    });

    function testSessionExecutionCase(testCase) {
        log("Added execution test case:", testCase.code);

        var code = testCase.code;
        var expectedResult = testCase.result || {};
        var stdout = testCase.stdout;
        var stderr = testCase.stderr;
        var display = testCase.display || [];

        it("can execute '" + code + "'", function(done) {
            log("Test execution case:", code);

            var hasRun = [];
            var executionResult = [];
            var executionError = [];
            var stdoutResult = "";
            var stderrResult = "";
            var displayUpdates = [];

            session.execute(code, {
                onSuccess: onSuccess,
                onError: onError,
                beforeRun: beforeRequest,
                afterRun: afterRequest,
                onStdout: onStdout,
                onStderr: onStderr,
                onDisplay: onDisplay,
            });

            function beforeRequest() {
                hasRun.push("beforeRequest");
            }

            function afterRequest() {
                hasRun.push("afterRequest");
                check();
            }

            function onSuccess(result) {
                hasRun.push("onSuccess");
                executionResult.push(result.mime);
            }

            function onError(error) {
                hasRun.push("onError");
                executionError.push(error.error);
            }

            function onStdout(data) {
                stdoutResult += data;
            }

            function onStderr(data) {
                stderrResult += data;
            }

            function onDisplay(update) {
                displayUpdates.push(update);
            }

            function check() {
                checkHasRun();
                checkResult();
            }

            function checkHasRun() {
                expect(hasRun[0]).toDeepEqual(
                    "beforeRequest",
                    "Unexpected callbacks were run"
                );

                expect(hasRun[hasRun.length - 1]).toDeepEqual(
                    "afterRequest",
                    "Unexpected callbacks were run"
                );

                var counter = {};
                hasRun.forEach(function(event) {
                    var n = counter[event];
                    counter[event] = (n) ? n+1 : 1;
                });

                var expectedCounter = {};
                if (Array.isArray(expectedResult.mime)) {
                    expectedResult.mime.forEach(function(r) {
                        var n = expectedCounter.onSuccess;
                        expectedCounter.onSuccess = (n) ? n + 1 : 1;
                    });
                } else {
                    if (expectedResult.mime) expectedCounter.onSuccess = 1;
                }
                if (Array.isArray(expectedResult.error)) {
                    expectedResult.error.forEach(function(r) {
                        var n = expectedCounter.onError;
                        expectedCounter.onError = (n) ? n + 1 : 1;
                    });
                } else {
                    if (expectedResult.error) expectedCounter.onError = 1;
                }

                expect(counter).toDeepEqual(
                    expectedCounter,
                    "Unexpected callbacks were run"
                );
            }

            function checkResult() {
                if (Array.isArray(expectedResult.mime)) {
                    expectedResult.mime.forEach(function(r, i) {
                        expect(executionResult[i]).toDeepEqual(r,
                            "Unexpected execution result"
                        );
                    });
                } else if (expectedResult.mime){
                    expect(executionResult[0]).toDeepEqual(expectedResult.mime,
                        "Unexpected execution result"
                    );
                }

                if (Array.isArray(expectedResult.error)) {
                    expectedResult.error.forEach(function(r, i) {
                        expect(executionError[i]).toDeepEqual(r,
                            "Unexpected execution error"
                        );
                    });
                } else if (expectedResult.error) {
                    expect(executionError[0]).toDeepEqual(expectedResult.error,
                        "Unexpected execution error"
                    );
                } else {
                    expect(executionError[0]).toDeepEqual(expectedResult.error,
                        "Unexpected execution error"
                    );
                }

                if (stdout) {
                    expect(stdoutResult).toEqual(stdout, "Unexpected stdout");
                }

                if (stderr) {
                    expect(stderrResult).toEqual(stderr, "Unexpected stderr");
                }

                if (display) {
                    expect(displayUpdates).toDeepEqual(display,
                        "Unexpected display updates"
                    );
                }

                done();
            }
        });
    }

    describe("Session#inspect", function() {
        var testCases = JSON.parse(
            fs.readFileSync(path.join(__dirname, "inspect.json"))
        );

        testCases.forEach(testSessionInspectCase);
    });

    function testSessionInspectCase(testCase) {
        var code = testCase.code;
        var cursorPos = testCase.cursorPos;
        var expectedResult = testCase.result;

        it("can inspect '" + code + "'", function(done) {
            log("Test inspection case:", testCase.code);

            // First run the code, then inspect the expression at cursorPos.
            session.execute(code, {
                onSuccess: onExecution,
                onError: onExecution,
            });

            function onExecution(executionResult) {
                session.inspect(code, cursorPos, {
                    onSuccess: check,
                    onError: check,
                });
            }

            function check(inspectionResult) {
                expect(inspectionResult).toDeepEqual(expectedResult,
                    "Unexpected inspection result"
                );

                done();
            }
        });
    }

    describe("Session#complete", function() {
        var testCases = JSON.parse(
            fs.readFileSync(path.join(__dirname, "complete.json"))
        );

        testCases.forEach(testSessionCompleteCase);
    });

    function testSessionCompleteCase(testCase) {
        var code = testCase.code;
        var cursorPos = testCase.cursorPos;
        var expectedResult = testCase.result;

        it("can complete '" + code + "'", function(done) {
            log("Test completion case:", testCase.code);

            // First run the code, then inspect the expression at cursorPos.
            session.execute(code, {
                onSuccess: onExecution,
                onError: onExecution,
            });

            function onExecution(executionResult) {
                session.complete(code, cursorPos, {
                    onSuccess: check,
                    onError: check,
                });
            }

            function check(completionResult) {
                expect(completionResult).toDeepEqual(expectedResult,
                    "Unexpected completion result"
                );

                done();
            }
        });
    }
});
