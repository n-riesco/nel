# Node.js Evaluation Loop (NEL)

`NEL` is an [npm module](https://www.npmjs.com/) for running
[Node.js](https://nodejs.org/) REPL sessions.

`NEL` is a spin-off library from
[IJavascript](https://n-riesco.github.io/ijavascript). This fact explains design
decisions in `NEL` such as returning results in MIME format, and the
functionality provided for completion and inspection of Javascript expressions.
See the section on usage for more details.

Please, consider this repository as an alpha release. The API is likely to
change.

## Install

```sh
npm install nel
```

## Main Features

- Run Javascript code within a `Node.js` session. The result can be formatted
  as:
  - [plain text](http://n-riesco.github.io/ijavascript/doc/hello.ipynb.html)
  - [other MIME
    formats](http://n-riesco.github.io/ijavascript/doc/graphics.ipynb.html)
    (`HTML`, `SVG`, `PNG`...)
- Run Javascript code
  [asynchronously](http://n-riesco.github.io/ijavascript/doc/async.ipynb.html).
- Generate a list of [completion
  options](http://n-riesco.github.io/ijavascript/doc/complete.md.html) for an
  incomplete piece of Javascript code.
- [Inspect a Javascript
  expression](http://n-riesco.github.io/ijavascript/doc/inspect.md.html) and
  return information such as type or even documentation (currently, only for
  Javascript builtins).

## Usage

### Hello, World!

```js
// Load `nel` module
var nel = require("nel");

// Setup a new Javascript session
var session = new nel.Session();

// Define callbacks to handle results and errors
function printResult(session) { console.log(session.result); }
function printError(session) { console.log(session.result); }

// Setup a task
var task = {
    action: "run",
    code: "['Hello', 'World!'].join(', ');",
    onSuccess: printResult,
    onError: printError,
};

// Run task
session.run(task);

// Output:
// { mime: { 'text/plain': '\'Hello, World!\'' } }
```

### Exceptions

```js
task.code = "throw new Error('Hello, World!');";
session.run(task);

// Output:
// { error:
//  { ename: 'Error',
//    evalue: 'Hello, World!',
//    traceback:
//     [ 'Error: Hello, World!',
//       '    at evalmachine.<anonymous>:1:7',
//       '    at run ([eval]:182:19)',
//       '    at onMessage ([eval]:63:41)',
//       '    at process.EventEmitter.emit (events.js:98:17)',
//       '    at handleMessage (child_process.js:318:10)',
//       '    at Pipe.channel.onread (child_process.js:345:11)' ] } }
```

### `stdout` and `stderr`

```js
task.code = "console.log('Hello, World!');"
session.run(task);

// Output:
// { mime: { 'text/plain': 'undefined' } }

process.stdout.write(session.stdout.read());

// Output:
// Hello, World!
```

### MIME output

A session may return results in MIME formats other than 'text/plain'.

```js
// HTML example
task.code = "$$html$$ = \"<div style='background-color:olive;width:50px;height:50px'></div>\";";
session.run(task);

// Output:
// { mime: { 'text/html': '<div style=\'background-color:olive;width:50px;height:50px\'></div>' } }

// SVG example
task.code = "$$svg$$ = \"<svg><rect width=80 height=80 style='fill: orange;'/></svg>\";";
session.run(task);

// Output:
// { mime: { 'image/svg+xml': '<svg><rect width=80 height=80 style=\'fill: orange;\'/></svg>' } }

// PNG example
task.code = "$$png$$ = require('fs').readFileSync('image.png').toString('base64');"
session.run(task);

// JPEG example
task.code = "$$jpeg$$ = require('fs').readFileSync('image.jpg').toString('base64');"
session.run(task);

// MIME example
task.code = "$$mime$$ = {\"text/html\": \"<div style='background-color:olive;width:50px;height:50px'></div>\"};"
session.run(task);
```

### Generate a completion list

`NEL` can parse simple Javascript variable expressions and generate a list of
completion options:

```js
session.complete(
    "set",        // code
    3,            // cursorPos
    printResult,  // onSucess
    printError    // onError
);

// Output:
// { completion:
//    { list: [ 'setImmediate', 'setInterval', 'setTimeout' ],
//      code: 'set',
//      cursorPos: 3,
//      matchedText: 'set',
//      cursorStart: 0,
//      cursorEnd: 3 } }
```

Note that the cursor position can be located anywhere within the Javascript
code:

```js
session.complete(
    "set",        // code
    2,            // cursorPos
    printResult,  // onSucess
    printError    // onError
);

// Output:
// { completion:
//    { list: [ 'setImmediate', 'setInterval', 'setTimeout' ],
//      code: 'set',
//      cursorPos: 2,
//      matchedText: 'se',
//      cursorStart: 0,
//      cursorEnd: 3 } }
```

### Inspect an expression

`NEL` can parse simple Javascript variable expressions and inspect their value:

```js
task.code = "var a = [1, 2, 3];";
session.run(task);

// Output:
// { mime: { 'text/plain': 'undefined' } }

session.inspect(
    task.code,    // code
    5,            // cursorPos
    printResult,  // onSucess
    printError    // onError
);

// Output:
// { inspection:
//    { string: '[ 1, 2, 3 ]',
//      type: 'Array',
//      constructorList: [ 'Array', 'Object' ],
//      length: 3,
//      code: 'var a = [1, 2, 3];',
//      cursorPos: 5,
//      matchedText: 'a' } }
```

`NEL` can also provide relevant documentation (currently only available for
Javascript builtins):

```js
session.inspect(
    "parseInt",   // code
    8,            // cursorPos
    printResult,  // onSucess
    printError    // onError
);

// Output:
// { inspection:
//    { string: '[Function: parseInt]',
//      type: 'Object',
//      constructorList: [ 'Function', 'Object' ],
//      length: 2,
//      code: 'parseInt',
//      cursorPos: 8,
//      matchedText: 'parseInt' },
//   doc:
//    { description: 'The parseInt() function parses a string argument and returns an integer of the specified radix (the base in mathematical numeral systems).',
//      url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt',
//      usage: 'parseInt(string, radix);' } }
```

### Callbacks `beforeRun` and `afterRun`

```js
task.beforeRun = function(session) { console.log("This callback runs first"); }
task.code = "'I run next'";
task.afterRun = function(session) { console.log("This callback runs last"); }
session.run(task);

// Output:
// This callback runs first
// { mime: { 'text/plain': '\'I run next\'' } }
// This callback runs last
```

# Announcements

- `Session.executionCount` is deprecated. It will be removed in version 0.1.0.
- `Task.action` will default to `run` in version 0.1.0.

# Contributions

First of all, thank you for taking the time to contribute. Please, read
[CONTRIBUTING.md](https://github.com/n-riesco/nel/blob/master/CONTRIBUTING.md)
and use the [issue tracker](https://github.com/n-riesco/nel/issues) for
any contributions: support requests, bug reports, enhancement requests, pull
requests, ...

# TODO

- Remove `session.executionCount` automatically
- Implement `$$mimer$$` and `$$text$$`
- Add tests for `$$async$$` and `$$done()$$`
- Add tests for `$$html$$`, `$$png$$`, `$$jpeg$$` and `$$mime$$`
- Make `Task.action` default to `run`
- Make `onSuccess`, `onError` callbacks options
- Make `cursorPos` default to `code.length`
- Add `Node.js` documentation
