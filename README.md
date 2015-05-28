# `simple-sm`

`simple-sm` is an [npm module](https://www.npmjs.com/) for running
[node.js](https://nodejs.org/) REPL sessions.

Please, consider this repository as an alpha release. The API is likely to
change.

## Install

```sh
npm install simple-sm
```

## Usage

Example of usage taken from
[IJavascript](https://github.com/n-riesco/ijavascript):

```javascript
var sm = require("simple-sm");
var session = new sm.Session();

// Callback called before running the Javascript code.
var beforeRun = function (session) {
    session.executionCount++;
};
// Callback called after running the Javascript code.
var afterRun = function (session) {
    console.log(session.executionCount);
};
// Callback called only if no errors occurred.
var onSuccess = function (session) {
    console.log(session.result);
};
// Callback called only if errors occurred.
var onError = function (session) {
    console.log(session.result);
};

var task = {
    action: "run",
    code: "var msg = 'Hello, World!';",
    beforeRun: beforeRun,
    afterRun: afterRun,
    onSuccess: onSuccess,
    onError: onError,
};
session.run(task);
// Output:
// { mime:
//    { 'text/plain': 'undefined',
//      'text/html': '<pre>undefined</pre>' },
// }
// 1

task.code = "msg;";
session.run(task);
// Output:
// { mime:
//    { 'text/plain': '\'Hello, World!\'',
//      'text/html': '<pre>&#39;Hello, World!&#39;</pre>' },
// }
// 2

task.code = "console.log(msg);";
session.run(task);
process.stdout.write(session.stdout.read());
// Output:
// { mime:
//    { 'text/plain': 'undefined',
//      'text/html': '<pre>undefined</pre>' },
// }
// 3
// Hello, World!

task.code = "console.warn(msg);";
session.run(task);
process.stderr.write(session.stderr.read());
// Output:
// { mime:
//    { 'text/plain': 'undefined',
//      'text/html': '<pre>undefined</pre>' },
// }
// 4
// Hello, World!

task.code = "throw new Error('This is a test!');";
session.run(task);
// Output:
// { error:
//    { ename: 'Error',
//      evalue: 'This is a test!',
//      traceback:
//       [ 'Error: This is a test!',
//         '    at evalmachine.<anonymous>:1:7',
//         '    at run ([eval]:116:19)',
//         '    at onMessage ([eval]:63:41)',
//         '    at process.EventEmitter.emit (events.js:98:17)',
//         '    at handleMessage (child_process.js:318:10)',
//         '    at Pipe.channel.onread (child_process.js:345:11)' ] },
// }
// 5

task.action = "inspect";
task.code = "msg";
task.beforeRun = undefined;
task.afterRun = undefined;
session.run(task);
// Output:
// { string: 'Hello, World!',
//   type: 'String',
//   constructorList: [ 'String', 'Object' ],
//   length: 13,
// }

task.action = "run";
task.code = "var obj = {};";
task.beforeRun = beforeRun;
task.afterRun = afterRun;
session.run(task);
// Output:
// { mime:
//    { 'text/plain': 'undefined',
//      'text/html': '<pre>undefined</pre>' },
// }
// 6

task.action = "getAllPropertyNames";
task.code = "obj";
task.beforeRun = undefined;
task.afterRun = undefined;
session.run(task);
// Output:
// { names:
//    [ '__defineGetter__',
//      '__defineSetter__',
//      '__lookupGetter__',
//      '__lookupSetter__',
//      'constructor',
//      'hasOwnProperty',
//      'isPrototypeOf',
//      'propertyIsEnumerable',
//      'toLocaleString',
//      'toString',
//      'valueOf' ],
// }

task.action = "run";
task.code = "$$html$$ = \"<div style='background-color:olive;width:50px;height:50px'></div>\";";
task.beforeRun = beforeRun;
task.afterRun = afterRun;
session.run(task);
// Output:
// { mime: { 'text/html': '<div style=\'background-color:olive;width:50px;height:50px\'></div>' } }
// 7

task.action = "run";
task.code = "$$svg$$ = \"<svg><rect width=80 height=80 style='fill: orange;'/></svg>\";";
task.beforeRun = beforeRun;
task.afterRun = afterRun;
session.run(task);
// Output:
// { mime: { 'image/svg+xml': '<svg><rect width=80 height=80 style=\'fill: orange;\'/></svg>' } }
// 8
```

# Contributions

First of all, thank you for taking the time to contribute. Please, read
[CONTRIBUTING.md](https://github.com/n-riesco/simple-sm/blob/master/CONTRIBUTING.md)
and use the [issue tracker](https://github.com/n-riesco/simple-sm/issues) for
any contributions: support requests, bug reports, enhancement requests, pull
requests, ...
