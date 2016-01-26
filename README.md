# Node.js Evaluation Loop (NEL)

`NEL` is an [npm module](https://www.npmjs.com/) for running
[Node.js](https://nodejs.org/) REPL sessions.

`NEL` is a spin-off library from
[IJavascript](https://n-riesco.github.io/ijavascript). This fact explains some
of the design decisions in `NEL` such as returning results in MIME format, and
the functionality provided for completion and inspection of Javascript
expressions.  See the section on usage for more details.

Please, consider this repository as an alpha release. The API is likely to
change.

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

## Announcements

- `NEL` is in the process of being refactored to maximise the amount shared
  amongst [ijavascript](https://n-riesco.github.io/ijavascript),
  [jp-babel](https://github.com/n-riesco/jp-babel) and
  [jp-coffeescript](https://github.com/n-riesco/jp-coffeescript).
- `NEL v0.3`: New API (simplify API by hiding type module:nel~Task)
- `NEL v0.2`: API change (removed Session#executionCount)
- `NEL v0.1.1`: New experimental `$$mimer$$` and `$$defaultMimer$$`
- `NEL v0.1`: Output change (changed function output)
- `NEL v0.0`: Initial release

## Install

```sh
npm install nel
```

## Usage

### Hello, World!

```js
// Load `nel` module
var nel = require("nel");

// Setup a new Javascript session
var session = new nel.Session();

// Define callbacks to handle results and errors
var onSuccess = function printResult(result) { console.log(result); }
var onError = function printError(error) { console.log(error); }

// Example of an execution request
// Output:
// { mime: { 'text/plain': '\'Hello, World!\'' } }
var code = "['Hello', 'World!'].join(', ');";
session.execute(code, onSuccess, onError);
```

### Exceptions

```js
// Example of throwing an exception
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
code = "throw new Error('Hello, World!');";
session.execute(code, onSuccess, onError);
```

### `stdout` and `stderr`

```js
// Example of use of console.log()
// Output:
// { mime: { 'text/plain': 'undefined' } }
code = "console.log('Hello, World!');";
session.execute(code, onSuccess, onError);

// Example of reading the session stdout
// Output:
// Hello, World!
process.stdout.write(session.stdout.read());
```

### MIME output

A session may return results in MIME formats other than 'text/plain'.

```js
// HTML example
// Output:
// { mime: { 'text/html': '<div style=\'background-color:olive;width:50px;height:50px\'></div>' } }
code = "$$html$$ = \"<div style='background-color:olive;width:50px;height:50px'></div>\";";
session.execute(code, onSuccess, onError);

// SVG example
// Output:
// { mime: { 'image/svg+xml': '<svg><rect width=80 height=80 style=\'fill: orange;\'/></svg>' } }
code = "$$svg$$ = \"<svg><rect width=80 height=80 style='fill: orange;'/></svg>\";";
session.execute(code, onSuccess, onError);

// PNG example
code = "$$png$$ = require('fs').readFileSync('image.png').toString('base64');";
session.execute(code, onSuccess, onError);

// JPEG example
code = "$$jpeg$$ = require('fs').readFileSync('image.jpg').toString('base64');";
session.execute(code, onSuccess, onError);

// MIME example
code = "$$mime$$ = {\"text/html\": \"<div style='background-color:olive;width:50px;height:50px'></div>\"};";
session.execute(code, onSuccess, onError);
```

### Generate a completion list

`NEL` can parse simple Javascript variable expressions and generate a list of
completion options:

```js
session.complete(
    "set",     // code
    3,         // cursorPos
    onSuccess, // onSucess
    onError    // onError
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
    "set",     // code
    2,         // cursorPos
    onSuccess, // onSucess
    onError    // onError
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
code = "var a = [1, 2, 3];";
session.execute(code, null, onError);
session.inspect(
    code,      // code
    5,         // cursorPos
    onSuccess, // onSucess
    onError    // onError
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
    "parseInt", // code
    8,          // cursorPos
    onSuccess,  // onSucess
    onError     // onError
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

### Callbacks `beforeRequest` and `afterRequest`

```js
var beforeRequest = function() { console.log("This callback runs first"); }
code = "'I run next'";
var afterRequest = function() { console.log("This callback runs last"); }
session.execute(code, onSuccess, onError, beforeRequest, afterRequest);

// Output:
// This callback runs first
// { mime: { 'text/plain': '\'I run next\'' } }
// This callback runs last
```

## Contributions

First of all, thank you for taking the time to contribute. Please, read
[CONTRIBUTING.md](https://github.com/n-riesco/nel/blob/master/CONTRIBUTING.md)
and use the [issue tracker](https://github.com/n-riesco/nel/issues) for
any contributions: support requests, bug reports, enhancement requests, pull
requests, ...

## TODO

- Implement `$$text$$`, `$$update$$()`
- Add tests for `$$async$$` and `$$done()$$`
- Add tests for `$$html$$`, `$$png$$`, `$$jpeg$$`, `$$mime$$`, `$$mimer$$`, ...
- Session#complete and Session#inspect: make `cursorPos` argument default to
  `code.length`
- Add `Node.js` documentation
