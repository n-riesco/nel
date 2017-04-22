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


var customMatchers = {
    toDeepEqual: function(util, customEqualityTesters) {
        return {
            compare: function(actual, expected) {
                var result = {};

                try {
                    assert.deepEqual(actual, expected);
                    result.pass = true;
                    result.message =
                        "Expected " + actual + " to deep equal " + expected;

                } catch (err) {
                    result.pass = false;
                    result.message =
                        "Expected " + actual + " not to deep equal " + expected;
                }

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
        var signal = "SIGTERM";

        session.restart(signal, function(code, signal) {
            expect(code).toBe(null, "Unexpected restart code");
            expect(signal).toBe(signal, "Unexpected restart signal");

            done();
        });
    });

    it("Session#kill can kill a session", function(done) {
        var signal = "SIGTERM";

        session.kill(signal, function(code, signal) {
            expect(code).toBe(null, "Unexpected kill code");
            expect(signal).toBe(signal, "Unexpected kill signal");

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
        var code = testCase.code;
        var expectedResult = testCase.result;
        var stdout = testCase.stdout;
        var stderr = testCase.stderr;

        it("can execute '" + code + "'", function(done) {
            var hasRun = [];
            var executionResult;
            var stdoutResult = "";
            var stderrResult = "";

            session.execute(code, {
                onSuccess: onSuccess,
                onError: onError,
                beforeRun: beforeRequest,
                afterRun: afterRequest,
                onStdout: onStdout,
                onStderr: onStderr,
            });

            function beforeRequest() {
                hasRun.push("beforeRequest");
            }

            function afterRequest() {
                hasRun.push("afterRequest");
                checkResult();
            }

            function onSuccess(result) {
                hasRun.push("onSuccess");
                executionResult = result;
            }

            function onError(error) {
                hasRun.push("onError");
                executionResult = error;
            }

            function onStdout(data) {
                stdoutResult += data;
            }

            function onStderr(data) {
                stderrResult += data;
            }

            function checkResult() {
                if (expectedResult.error) {
                    expect(hasRun).toDeepEqual(
                        ["beforeRequest", "onError", "afterRequest"],
                        "Unexpected callbacks were run"
                    );
                } else {
                    expect(hasRun).toDeepEqual(
                        ["beforeRequest", "onSuccess", "afterRequest"],
                        "Unexpected callbacks were run"
                    );
                }

                expect(executionResult).toDeepEqual(expectedResult,
                    "Unexpected execution result"
                );

                if (stdout) {
                    expect(stdoutResult).toEqual(stdout, "Unexpected stdout");
                }

                if (stderr) {
                    expect(stderrResult).toEqual(stderr, "Unexpected stderr");
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
            // First run the code, then inspect the expression at cursorPos.
            session.execute(code, {
                onSuccess: onExecutionSuccess,
                onError: function onError(error) {
                    throw error;
                },
            });

            function onExecutionSuccess(executionResult) {
                session.inspect(code, cursorPos, {
                    onSuccess: check,
                    onError: function onError(error) {
                        throw error;
                    },
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
            session.complete(code, cursorPos, {
                onSuccess: check,
                onError: onError,
            });

            function onError(error) {
                throw error;
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
